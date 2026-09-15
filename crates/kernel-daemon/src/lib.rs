//! Business-agnostic owner of a persistent rule space and JSON State.
//! Node bodies run in clients; only generic causal operations live here.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use graphvideo_kernel::{
    ActiveChange, BeginError, ChangeOutcome, DeliveryFeedback, Kernel, SubmissionState,
};
use serde_json::{json, Map, Value};

const ERROR_INFO_TYPE: &str = "@error/NodeFailed";

struct NodeRecord {
    state: Map<String, Value>,
    version: u64,
    generation: u64,
}

struct SubmissionRequest {
    target: String,
    info: Value,
    feedback: Value,
}

struct Lease {
    session_id: u64,
    generation: u64,
}

pub struct Session {
    id: u64,
    active: HashMap<u64, ActiveChange>,
    claims: BTreeSet<String>,
}

impl Session {
    pub fn new(id: u64) -> Self {
        Self {
            id,
            active: HashMap::new(),
            claims: BTreeSet::new(),
        }
    }

    pub fn disconnect(&mut self, space: &mut Space) {
        for (_, token) in self.active.drain() {
            space.fail_change(token, "Node worker disconnected");
        }
        space.leases.retain(|_, lease| lease.session_id != self.id);
        self.claims.clear();
    }
}

#[derive(Default)]
pub struct Space {
    kernel: Kernel,
    nodes: BTreeMap<String, NodeRecord>,
    submissions: BTreeMap<String, SubmissionRequest>,
    leases: BTreeMap<String, Lease>,
    error_target: Option<String>,
}

enum Operation {
    Write(String, Value),
    Patch(Map<String, Value>),
    Send(String, String, Value),
}

fn required_str<'a>(value: &'a Value, key: &str) -> Result<&'a str, String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| format!("{key} must be a nonempty string"))
}

fn info_type(info: &Value) -> Result<&str, String> {
    if !info.is_object() {
        return Err("info must be an object".into());
    }
    required_str(info, "type")
}

fn state_object(value: &Value, key: &str) -> Result<Map<String, Value>, String> {
    value
        .get(key)
        .and_then(Value::as_object)
        .cloned()
        .ok_or_else(|| format!("{key} must be an object"))
}

fn feedback(value: DeliveryFeedback) -> Value {
    match value {
        DeliveryFeedback::Enqueued => json!({"status":"enqueued"}),
        DeliveryFeedback::Dropped(reason) => {
            json!({"status":"dropped","reason":format!("{reason:?}")})
        }
    }
}

impl Space {
    pub fn handle(&mut self, session: &mut Session, request: &Value, token: &str) -> Value {
        let id = request.get("id").cloned().unwrap_or(Value::Null);
        let result = if request.get("version") != Some(&json!(1)) {
            Err("unsupported protocol version".into())
        } else if request.get("token").and_then(Value::as_str) != Some(token) {
            Err("unauthorized".into())
        } else {
            self.execute(session, request)
        };
        match result {
            Ok(value) => json!({"id":id,"ok":true,"result":value}),
            Err(error) => json!({"id":id,"ok":false,"error":error}),
        }
    }

    fn execute(&mut self, session: &mut Session, request: &Value) -> Result<Value, String> {
        match required_str(request, "op")? {
            "health" => Ok(json!({
                "pid":std::process::id(),
                "nodes":self.nodes.len(),
                "pending":self.kernel.pending_total(),
                "leases":self.leases.len(),
            })),
            "admit" => {
                let id = required_str(request, "nodeId")?.to_owned();
                let state = state_object(request, "initialState")?;
                let facts = request
                    .get("analysisFacts")
                    .filter(|v| !v.is_null())
                    .cloned();
                let generation = self.kernel.admit(id.clone()).map_err(|e| e.to_string())?;
                if let Some(facts) = facts {
                    if let Err(error) =
                        self.kernel
                            .set_analysis_facts(&id, generation, facts.to_string())
                    {
                        self.kernel.evict(&id);
                        return Err(error.to_string());
                    }
                }
                self.nodes.insert(
                    id.clone(),
                    NodeRecord {
                        state,
                        version: 0,
                        generation,
                    },
                );
                Ok(json!({"generation":generation}))
            }
            "evict" => {
                let id = required_str(request, "nodeId")?;
                if !self.kernel.evict(id) {
                    return Err("node is not admitted".into());
                }
                self.nodes.remove(id);
                self.leases.remove(id);
                Ok(json!({"evicted":true}))
            }
            "replace" => {
                let id = required_str(request, "nodeId")?.to_owned();
                let state = state_object(request, "initialState")?;
                let generation = self.kernel.replace(&id).map_err(|e| e.to_string())?;
                if let Some(facts) = request.get("analysisFacts").filter(|v| !v.is_null()) {
                    self.kernel
                        .set_analysis_facts(&id, generation, facts.to_string())
                        .map_err(|e| e.to_string())?;
                }
                self.nodes.insert(
                    id.clone(),
                    NodeRecord {
                        state,
                        version: 0,
                        generation,
                    },
                );
                self.leases.remove(&id);
                Ok(json!({"generation":generation}))
            }
            "claim" => {
                let ids = request
                    .get("nodeIds")
                    .and_then(Value::as_array)
                    .ok_or("nodeIds must be an array")?
                    .iter()
                    .map(|value| {
                        value
                            .as_str()
                            .filter(|id| !id.is_empty())
                            .map(str::to_owned)
                            .ok_or_else(|| "nodeIds must contain nonempty strings".to_owned())
                    })
                    .collect::<Result<BTreeSet<_>, _>>()?;
                if ids.is_empty() {
                    return Err("nodeIds must not be empty".into());
                }
                for id in &ids {
                    let node = self.nodes.get(id).ok_or("claimed node is not admitted")?;
                    if self
                        .leases
                        .get(id)
                        .is_some_and(|lease| lease.session_id != session.id)
                    {
                        return Err(format!("node is already claimed: {id}"));
                    }
                    if self.kernel.generation(id) != Some(node.generation) {
                        return Err(format!("node generation is stale: {id}"));
                    }
                }
                for id in ids {
                    let generation = self.nodes[&id].generation;
                    self.leases.insert(
                        id.clone(),
                        Lease {
                            session_id: session.id,
                            generation,
                        },
                    );
                    session.claims.insert(id);
                }
                Ok(json!({"nodeIds":session.claims}))
            }
            "release" => {
                if !session.active.is_empty() {
                    return Err("cannot release while a change is active".into());
                }
                let ids = request
                    .get("nodeIds")
                    .and_then(Value::as_array)
                    .ok_or("nodeIds must be an array")?;
                for value in ids {
                    let id = value.as_str().ok_or("nodeIds must contain strings")?;
                    if self
                        .leases
                        .get(id)
                        .is_some_and(|lease| lease.session_id == session.id)
                    {
                        self.leases.remove(id);
                        session.claims.remove(id);
                    }
                }
                Ok(json!({"nodeIds":session.claims}))
            }
            "inject" => {
                let target = required_str(request, "targetNodeId")?;
                let info = request.get("info").ok_or("info is required")?;
                let kind = info_type(info)?;
                let submission = required_str(request, "submissionId")?.to_owned();
                if let Some(previous) = self.submissions.get(&submission) {
                    if previous.target != target || previous.info != *info {
                        return Err("submissionId was already used for another injection".into());
                    }
                    return Ok(json!({"duplicate":true,"feedback":previous.feedback}));
                }
                let outcome = self.kernel.inject_root_json(
                    target,
                    kind.to_owned(),
                    Some(info.to_string()),
                    submission.clone(),
                );
                let feedback = feedback(outcome);
                self.submissions.insert(
                    submission,
                    SubmissionRequest {
                        target: target.to_owned(),
                        info: info.clone(),
                        feedback: feedback.clone(),
                    },
                );
                Ok(json!({"duplicate":false,"feedback":feedback}))
            }
            "poll" => {
                if !session.active.is_empty() {
                    return Err("settle the active change before polling".into());
                }
                if session.claims.is_empty() {
                    return Err("claim at least one node before polling".into());
                }
                let mut polled = None;
                for id in session.claims.clone() {
                    let valid_lease = self.leases.get(&id).is_some_and(|lease| {
                        lease.session_id == session.id
                            && self.nodes.get(&id).map(|node| node.generation)
                                == Some(lease.generation)
                    });
                    if !valid_lease {
                        session.claims.remove(&id);
                        continue;
                    }
                    match self.kernel.begin_change(&id) {
                        Ok(change) => {
                            polled = Some(change);
                            break;
                        }
                        Err(BeginError::Empty(_) | BeginError::Busy(_) | BeginError::Sealed(_)) => {
                        }
                    }
                }
                let Some((token, view)) = polled else {
                    return Ok(Value::Null);
                };
                let change_id = view.change_id;
                let state = self
                    .nodes
                    .get(&view.entity)
                    .map(|node| Value::Object(node.state.clone()))
                    .unwrap_or(Value::Null);
                let info = view
                    .payload_json
                    .as_deref()
                    .and_then(|value| serde_json::from_str::<Value>(value).ok())
                    .unwrap_or_else(|| json!({"type":view.info_type}));
                let response = json!({"change":{
                    "changeId":change_id,"infoId":view.info_id,"nodeId":view.entity,
                    "generation":view.generation,"sender":view.sender,"info":info,
                    "causedBy":view.caused_by,"submissionId":view.submission,
                },"state":state});
                session.active.insert(change_id, token);
                Ok(response)
            }
            "commit" => {
                let change_id = request
                    .get("changeId")
                    .and_then(Value::as_u64)
                    .ok_or("changeId must be an integer")?;
                let token = session
                    .active
                    .get(&change_id)
                    .ok_or("change is not owned by this connection")?;
                let entity = token.entity().to_owned();
                let generation = token.generation();
                if self.nodes.get(&entity).map(|node| node.generation) != Some(generation) {
                    return Err("stale or removed node".into());
                }
                let operations = request
                    .get("operations")
                    .and_then(Value::as_array)
                    .ok_or("operations must be an array")?;
                let parsed = operations
                    .iter()
                    .map(parse_operation)
                    .collect::<Result<Vec<_>, _>>()?;
                let token = session.active.remove(&change_id).unwrap();
                let mut results = Vec::with_capacity(parsed.len());
                for operation in parsed {
                    match operation {
                        Operation::Write(key, value) => {
                            let node = self.nodes.get_mut(&entity).unwrap();
                            node.state.insert(key, value);
                            node.version += 1;
                            results.push(Value::Null);
                        }
                        Operation::Patch(patch) => {
                            let node = self.nodes.get_mut(&entity).unwrap();
                            node.state.extend(patch);
                            node.version += 1;
                            results.push(Value::Null);
                        }
                        Operation::Send(target, kind, info) => {
                            let outcome = self.kernel.send_json(
                                entity.clone(),
                                kind,
                                Some(info.to_string()),
                                &target,
                                Some(change_id),
                                token.submission().cloned(),
                            );
                            results.push(feedback(outcome));
                        }
                    }
                }
                if let Some(message) = request.get("error").and_then(Value::as_str) {
                    self.fail_change(token, message);
                } else if !self.kernel.settle_change(token, ChangeOutcome::Completed) {
                    return Err("change settlement rejected".into());
                }
                Ok(json!({"results":results,"version":self.nodes[&entity].version,"settled":true}))
            }
            "projection" => {
                let nodes: BTreeMap<_, _> = self.nodes.iter().map(|(id, node)| (id.clone(), json!({
                    "state":node.state,"version":node.version,"generation":node.generation,
                }))).collect();
                let submissions: BTreeMap<_, _> = self
                    .submissions
                    .keys()
                    .map(|id| {
                        let status = match self.kernel.submission_state(id) {
                            Some(SubmissionState::Open { pending }) => {
                                json!({"status":"open","pending":pending})
                            }
                            Some(SubmissionState::Completed) => json!({"status":"completed"}),
                            Some(SubmissionState::Cancelled) => json!({"status":"cancelled"}),
                            Some(SubmissionState::Failed(message)) => {
                                json!({"status":"failed","message":message})
                            }
                            None => json!({"status":"unknown"}),
                        };
                        (id.clone(), status)
                    })
                    .collect();
                Ok(
                    json!({"nodes":nodes,"submissions":submissions,"pending":self.kernel.pending_total()}),
                )
            }
            "analysisFacts" => {
                let facts: BTreeMap<_, _> = self
                    .kernel
                    .all_analysis_facts()
                    .into_iter()
                    .filter_map(|(id, text)| {
                        serde_json::from_str::<Value>(&text).ok().map(|v| (id, v))
                    })
                    .collect();
                Ok(json!({"nodes":facts}))
            }
            "setErrorTarget" => {
                let id = required_str(request, "nodeId")?;
                if !self.nodes.contains_key(id) {
                    return Err("error target is not admitted".into());
                }
                self.error_target = Some(id.to_owned());
                Ok(json!({"nodeId":id}))
            }
            "intervene" => {
                let id = required_str(request, "nodeId")?.to_owned();
                let patch = state_object(request, "patch")?;
                let expected_generation = request
                    .get("expectedGeneration")
                    .and_then(Value::as_u64)
                    .ok_or("expectedGeneration must be an integer")?;
                let expected_version = request
                    .get("expectedVersion")
                    .and_then(Value::as_u64)
                    .ok_or("expectedVersion must be an integer")?;
                let current = self.nodes.get(&id).ok_or("node is not admitted")?;
                if current.generation != expected_generation || current.version != expected_version
                {
                    return Err("state version conflict".into());
                }
                let generation = self.kernel.begin_edit(&id).map_err(|e| e.to_string())?;
                if generation != expected_generation {
                    self.kernel.abort_edit(&id);
                    return Err("state generation conflict".into());
                }
                let node = self.nodes.get_mut(&id).unwrap();
                node.state.extend(patch);
                node.version += 1;
                if !self.kernel.end_edit(&id, generation) {
                    return Err("state intervention settlement rejected".into());
                }
                Ok(
                    json!({"nodeId":id,"generation":generation,"version":node.version,"state":node.state}),
                )
            }
            "cancel" => {
                let submission = required_str(request, "submissionId")?;
                Ok(json!({"cancelled":self.kernel.cancel(submission)}))
            }
            _ => Err("unknown operation".into()),
        }
    }

    fn fail_change(&mut self, token: ActiveChange, message: &str) {
        let source = token.entity().to_owned();
        if let Some(target) = self
            .error_target
            .as_ref()
            .filter(|target| *target != &source)
        {
            let info = json!({"type":ERROR_INFO_TYPE,"nodeId":source,
                "changeId":token.change_id(),"generation":token.generation(),"message":message});
            self.kernel.send_json(
                source,
                ERROR_INFO_TYPE.to_owned(),
                Some(info.to_string()),
                target,
                Some(token.change_id()),
                token.submission().cloned(),
            );
        }
        self.kernel.settle_change(token, ChangeOutcome::Completed);
    }
}

fn parse_operation(value: &Value) -> Result<Operation, String> {
    match required_str(value, "op")? {
        "write" => Ok(Operation::Write(
            required_str(value, "key")?.to_owned(),
            value
                .get("value")
                .cloned()
                .ok_or("write.value is required")?,
        )),
        "patchState" => Ok(Operation::Patch(state_object(value, "patch")?)),
        "send" => {
            let target = required_str(value, "targetNodeId")?.to_owned();
            let info = value.get("info").ok_or("send.info is required")?.clone();
            let kind = info_type(&info)?.to_owned();
            Ok(Operation::Send(target, kind, info))
        }
        _ => Err("unknown change operation".into()),
    }
}

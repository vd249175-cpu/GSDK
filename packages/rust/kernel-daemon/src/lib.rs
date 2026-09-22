//! Business-agnostic owner of a persistent rule space and JSON State.
//! Node bodies run in clients; only generic causal operations live here.

use std::collections::{BTreeMap, BTreeSet, HashMap, VecDeque};

use graphframework_kernel::{
    ActiveChange, BeginError, ChangeOutcome, DeliveryFeedback, Kernel, SubmissionState,
};
use serde_json::{json, Map, Value};

/// Stable JSON Lines operations accepted by [`Space`]. The machine-readable
/// twin lives in `packages/contract/operations.json` and is checked in tests.
pub const PUBLIC_OPERATIONS: &[&str] = &[
    "shutdown",
    "health",
    "admit",
    "evict",
    "replace",
    "claim",
    "release",
    "inject",
    "poll",
    "commit",
    "cancel",
    "projection",
    "analysisFacts",
    "setErrorTarget",
    "intervene",
    "setAnalysisContext",
    "analyze",
    "agentInspect",
    "agentInject",
    "agentInterveneState",
    "claimEffects",
    "releaseEffects",
    "pollEffect",
    "requestEffect",
    "awaitEffect",
    "completeEffect",
];

const ERROR_INFO_TYPE: &str = "@error/NodeFailed";
/// Raw per-Node facts larger than this are rejected before touching the Node.
const MAX_FACT_BYTES: usize = 256 * 1024;
/// Analysis responses larger than this are rejected as protocol errors.
const MAX_ANALYSIS_RESPONSE_BYTES: usize = 512 * 1024;
/// Frontend context arrays longer than this are rejected as protocol errors.
const MAX_CONTEXT_ITEMS: usize = 1024;
/// Bounded in-memory causal event ring for the Agent control plane.
const MAX_EVENTS: usize = 1000;

struct NodeRecord {
    state: Map<String, Value>,
    version: u64,
    generation: u64,
    effect_capabilities: BTreeSet<String>,
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

enum EffectStatus {
    Queued,
    Active(u64),
    Completed { ok: bool, value: Value },
}

struct EffectRecord {
    id: u64,
    requester_session: u64,
    change_id: u64,
    node_id: String,
    generation: u64,
    adapter_id: String,
    request: Value,
    status: EffectStatus,
}

pub struct Session {
    id: u64,
    active: HashMap<u64, ActiveChange>,
    claims: BTreeSet<String>,
    effect_claims: BTreeSet<String>,
}

impl Session {
    pub fn new(id: u64) -> Self {
        Self {
            id,
            active: HashMap::new(),
            claims: BTreeSet::new(),
            effect_claims: BTreeSet::new(),
        }
    }

    pub fn disconnect(&mut self, space: &mut Space) {
        space.effects.retain(|_, effect| {
            if effect.requester_session == self.id {
                return false;
            }
            if matches!(effect.status, EffectStatus::Active(id) if id == self.id) {
                effect.status = EffectStatus::Queued;
            }
            true
        });
        for (_, token) in self.active.drain() {
            space.fail_change(token, "Node worker disconnected");
        }
        space.leases.retain(|_, lease| lease.session_id != self.id);
        space.effect_leases.retain(|_, owner| *owner != self.id);
        self.claims.clear();
        self.effect_claims.clear();
    }
}

#[derive(Default)]
pub struct Space {
    kernel: Kernel,
    nodes: BTreeMap<String, NodeRecord>,
    submissions: BTreeMap<String, SubmissionRequest>,
    leases: BTreeMap<String, Lease>,
    effect_leases: BTreeMap<String, u64>,
    effects: BTreeMap<u64, EffectRecord>,
    next_effect_id: u64,
    error_target: Option<String>,
    /// Bumped on admit/replace/evict/analysis-context change/new State key.
    /// Plain State value changes do not invalidate cached analysis views.
    analysis_revision: u64,
    /// Views keyed by `(analysisRevision, request)`; cleared on every bump.
    analysis_cache: BTreeMap<String, Value>,
    frontend_links: Vec<Value>,
    frontend_service_links: Vec<Value>,
    state_keys: BTreeMap<String, BTreeSet<String>>,
    events: VecDeque<Value>,
    next_cursor: u64,
}

/// Owned, immutable analysis input cloned under the scheduling lock so the
/// caller can run `graphframework-analysis` after releasing it.
pub struct PendingAnalysis {
    /// Echoed protocol request id for the response envelope.
    pub id: Value,
    /// `{snapshots, liveStates}` facts DTO.
    pub facts: Value,
    /// `{frontendLinks, frontendServiceLinks}` context DTO.
    pub context: Value,
    /// The analysis request DTO (`view`, `path`, `health`, ...).
    pub request: Value,
    /// Revision bound at snapshot time; the only key the result may fill.
    pub revision: u64,
    /// Revision-keyed hit; the server returns it without running compute.
    pub cached: Option<Value>,
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

fn string_set(value: Option<&Value>, key: &str) -> Result<BTreeSet<String>, String> {
    let Some(value) = value else {
        return Ok(BTreeSet::new());
    };
    value
        .as_array()
        .ok_or_else(|| format!("{key} must be an array"))?
        .iter()
        .map(|item| {
            item.as_str()
                .filter(|text| !text.is_empty())
                .map(str::to_owned)
                .ok_or_else(|| format!("{key} must contain nonempty strings"))
        })
        .collect()
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
    fn push_event(&mut self, kind: &str, fields: Map<String, Value>) {
        let mut event = Map::new();
        event.insert("cursor".to_owned(), json!(self.next_cursor));
        event.insert("kind".to_owned(), Value::String(kind.to_owned()));
        for (key, value) in fields {
            event.insert(key, value);
        }
        self.next_cursor += 1;
        self.events.push_back(Value::Object(event));
        while self.events.len() > MAX_EVENTS {
            self.events.pop_front();
        }
    }

    fn bump_analysis_revision(&mut self) {
        self.analysis_revision += 1;
        // Cached views only depend on facts, context and State keys, so a
        // revision bump is the single invalidation signal.
        self.analysis_cache.clear();
    }

    /// View cache key: revision plus the canonical request DTO. State values
    /// never enter the key because analysis only observes State keys.
    fn cache_key(revision: u64, request: &Value) -> String {
        format!("{revision}\0{request}")
    }

    /// Fill the cache only under the snapshot's own revision. A result
    /// computed from an older snapshot can never match a newer lookup.
    pub fn store_analysis(&mut self, revision: u64, request: &Value, result: Value) {
        if self.is_closed() || revision != self.analysis_revision {
            return;
        }
        if self.analysis_cache.len() >= 16 {
            if let Some(first) = self.analysis_cache.keys().next().cloned() {
                self.analysis_cache.remove(&first);
            }
        }
        self.analysis_cache
            .insert(Self::cache_key(revision, request), result);
    }

    /// Validate portable facts before they touch the Node: schema, node
    /// binding, size and generation-independent snapshot checks.
    fn checked_facts(&self, node_id: &str, facts: &Value) -> Result<String, String> {
        let text = facts.to_string();
        if text.len() > MAX_FACT_BYTES {
            return Err("analysisFacts exceeds size limit".into());
        }
        let snapshot: Value = serde_json::from_str(&text)
            .map_err(|_| "analysisFacts must be a JSON object".to_owned())?;
        if snapshot.get("nodeId").and_then(Value::as_str) != Some(node_id) {
            return Err("analysisFacts.nodeId must match the admitted Node".into());
        }
        graphframework_analysis::validate_snapshot(&snapshot)
            .map_err(|error| format!("invalid analysisFacts: {error}"))?;
        Ok(text)
    }

    fn track_state_keys(&mut self, node_id: &str) {
        if let Some(node) = self.nodes.get(node_id) {
            let keys: BTreeSet<String> = node.state.keys().cloned().collect();
            let known = self.state_keys.entry(node_id.to_owned()).or_default();
            if keys.difference(known).next().is_some() {
                *known = keys;
                self.bump_analysis_revision();
            }
        }
    }

    fn context_array(request: &Value, key: &str) -> Result<Vec<Value>, String> {
        match request.get(key) {
            None | Some(Value::Null) => Ok(Vec::new()),
            Some(Value::Array(items)) => {
                if items.len() > MAX_CONTEXT_ITEMS {
                    return Err(format!("{key} exceeds item limit"));
                }
                Ok(items.clone())
            }
            Some(_) => Err(format!("{key} must be an array")),
        }
    }

    /// Clone an immutable analysis snapshot under the scheduling lock. The
    /// caller runs `graphframework-analysis` after releasing the lock so
    /// centrality/community computation never blocks the mailbox.
    pub fn prepare_analyze(
        &mut self,
        _session: &mut Session,
        request: &Value,
        token: &str,
    ) -> Result<PendingAnalysis, String> {
        if request.get("version") != Some(&json!(1)) {
            return Err("unsupported protocol version".into());
        }
        if request.get("token").and_then(Value::as_str) != Some(token) {
            return Err("unauthorized".into());
        }
        if self.is_closed() { return Err("rule space is closed".into()); }
        let inner = request.get("request").ok_or("request is required")?.clone();
        let snapshots: Vec<Value> = self
            .kernel
            .all_analysis_facts()
            .into_iter()
            .filter_map(|(_, text)| serde_json::from_str::<Value>(&text).ok())
            .collect();
        let live_states: BTreeMap<String, Value> = self
            .nodes
            .iter()
            .map(|(id, node)| {
                let keys = node
                    .state
                    .keys()
                    .map(|key| (key.clone(), Value::Null))
                    .collect();
                (id.clone(), Value::Object(keys))
            })
            .collect();
        let revision = self.analysis_revision;
        Ok(PendingAnalysis {
            id: request.get("id").cloned().unwrap_or(Value::Null),
            facts: json!({"snapshots": snapshots, "liveStates": live_states}),
            context: json!({
                "frontendLinks": self.frontend_links.clone(),
                "frontendServiceLinks": self.frontend_service_links.clone(),
            }),
            cached: self
                .analysis_cache
                .get(&Self::cache_key(revision, &inner))
                .cloned(),
            request: inner,
            revision,
        })
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

    pub fn is_closed(&self) -> bool { self.kernel.is_closed() }

    fn execute(&mut self, session: &mut Session, request: &Value) -> Result<Value, String> {
        let op = required_str(request, "op")?;
        if self.is_closed() && !matches!(op, "health" | "shutdown") {
            return Err("rule space is closed".into());
        }
        match op {
            "shutdown" => {
                if self.effects.values().any(|effect| !matches!(effect.status, EffectStatus::Completed { .. })) {
                    return Err("rule space busy: pending Effects remain".into());
                }
                self.kernel.shutdown().map_err(|error| error.to_string())?;
                self.nodes.clear();
                self.leases.clear();
                self.effect_leases.clear();
                self.effects.clear();
                self.submissions.clear();
                self.analysis_cache.clear();
                self.state_keys.clear();
                self.frontend_links.clear();
                self.frontend_service_links.clear();
                self.error_target = None;
                Ok(json!({"shutdown":true}))
            }
            "health" => Ok(json!({
                "closed":self.is_closed(),
                "pid":std::process::id(),
                "nodes":self.nodes.len(),
                "pending":self.kernel.pending_total(),
                "leases":self.leases.len(),
                "effectLeases":self.effect_leases.len(),
                "effects":self.effects.len(),
            })),
            "admit" => {
                let id = required_str(request, "nodeId")?.to_owned();
                let state = state_object(request, "initialState")?;
                let effect_capabilities =
                    string_set(request.get("effectCapabilities"), "effectCapabilities")?;
                // Schema, node binding and snapshot checks run before the Node
                // exists, so invalid facts never leave a half-admitted Node.
                let facts = request
                    .get("analysisFacts")
                    .filter(|v| !v.is_null())
                    .map(|facts| self.checked_facts(&id, facts))
                    .transpose()?;
                let generation = self.kernel.admit(id.clone()).map_err(|e| e.to_string())?;
                if let Some(facts) = facts {
                    if let Err(error) = self.kernel.set_analysis_facts(&id, generation, facts) {
                        self.kernel.evict(&id);
                        return Err(error.to_string());
                    }
                }
                let keys: BTreeSet<String> = state.keys().cloned().collect();
                self.state_keys.insert(id.clone(), keys);
                self.nodes.insert(
                    id.clone(),
                    NodeRecord {
                        state,
                        version: 0,
                        generation,
                        effect_capabilities,
                    },
                );
                self.bump_analysis_revision();
                let mut fields = Map::new();
                fields.insert("nodeId".to_owned(), Value::String(id.clone()));
                fields.insert("generation".to_owned(), json!(generation));
                self.push_event("node_admitted", fields);
                Ok(json!({"generation":generation}))
            }
            "evict" => {
                let id = required_str(request, "nodeId")?;
                if !self.kernel.evict(id) {
                    return Err("node is not admitted".into());
                }
                self.nodes.remove(id);
                self.leases.remove(id);
                self.state_keys.remove(id);
                self.bump_analysis_revision();
                let mut fields = Map::new();
                fields.insert("nodeId".to_owned(), Value::String(id.to_owned()));
                self.push_event("node_evicted", fields);
                Ok(json!({"evicted":true}))
            }
            "replace" => {
                let id = required_str(request, "nodeId")?.to_owned();
                let state = state_object(request, "initialState")?;
                let effect_capabilities =
                    string_set(request.get("effectCapabilities"), "effectCapabilities")?;
                // Destructive generation semantics: validate the new facts
                // before discarding the old backlog, State and leases.
                let facts = request
                    .get("analysisFacts")
                    .filter(|v| !v.is_null())
                    .map(|facts| self.checked_facts(&id, facts))
                    .transpose()?;
                let generation = self.kernel.replace(&id).map_err(|e| e.to_string())?;
                if let Some(facts) = facts {
                    self.kernel
                        .set_analysis_facts(&id, generation, facts)
                        .map_err(|e| e.to_string())?;
                }
                let keys: BTreeSet<String> = state.keys().cloned().collect();
                self.state_keys.insert(id.clone(), keys);
                self.nodes.insert(
                    id.clone(),
                    NodeRecord {
                        state,
                        version: 0,
                        generation,
                        effect_capabilities,
                    },
                );
                self.leases.remove(&id);
                self.bump_analysis_revision();
                let mut fields = Map::new();
                fields.insert("nodeId".to_owned(), Value::String(id.clone()));
                fields.insert("generation".to_owned(), json!(generation));
                self.push_event("node_replaced", fields);
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
            "claimEffects" => {
                let ids = string_set(request.get("adapterIds"), "adapterIds")?;
                if ids.is_empty() {
                    return Err("adapterIds must not be empty".into());
                }
                for id in &ids {
                    if self
                        .effect_leases
                        .get(id)
                        .is_some_and(|owner| *owner != session.id)
                    {
                        return Err(format!("EffectAdapter is already claimed: {id}"));
                    }
                }
                for id in ids {
                    self.effect_leases.insert(id.clone(), session.id);
                    session.effect_claims.insert(id);
                }
                Ok(json!({"adapterIds":session.effect_claims}))
            }
            "releaseEffects" => {
                let ids = string_set(request.get("adapterIds"), "adapterIds")?;
                for id in ids {
                    if self.effect_leases.get(&id) == Some(&session.id) {
                        self.effect_leases.remove(&id);
                        session.effect_claims.remove(&id);
                    }
                }
                Ok(json!({"adapterIds":session.effect_claims}))
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
                let result = feedback(outcome.clone());
                self.submissions.insert(
                    submission.clone(),
                    SubmissionRequest {
                        target: target.to_owned(),
                        info: info.clone(),
                        feedback: result.clone(),
                    },
                );
                let mut fields = Map::new();
                fields.insert("targetNodeId".to_owned(), Value::String(target.to_owned()));
                fields.insert("infoType".to_owned(), Value::String(kind.to_owned()));
                fields.insert("submissionId".to_owned(), Value::String(submission));
                self.push_event("root_injected", fields);
                if let DeliveryFeedback::Dropped(reason) = outcome {
                    let mut dropped = Map::new();
                    dropped.insert("targetNodeId".to_owned(), Value::String(target.to_owned()));
                    dropped.insert("infoType".to_owned(), Value::String(kind.to_owned()));
                    dropped.insert("reason".to_owned(), Value::String(format!("{reason:?}")));
                    self.push_event("delivery_dropped", dropped);
                }
                Ok(json!({"duplicate":false,"feedback":result}))
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
                let mut started = Map::new();
                started.insert("nodeId".to_owned(), Value::String(view.entity.clone()));
                started.insert("changeId".to_owned(), json!(change_id));
                started.insert("infoId".to_owned(), json!(view.info_id));
                started.insert("infoType".to_owned(), Value::String(view.info_type.clone()));
                started.insert("sender".to_owned(), Value::String(view.sender.clone()));
                if let Some(submission) = view.submission.clone() {
                    started.insert("submissionId".to_owned(), Value::String(submission));
                }
                self.push_event("change_started", started);
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
                            node.state.insert(key.clone(), value);
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
                                kind.clone(),
                                Some(info.to_string()),
                                &target,
                                Some(change_id),
                                token.submission().cloned(),
                            );
                            results.push(feedback(outcome.clone()));
                            let mut fields = Map::new();
                            fields.insert("nodeId".to_owned(), Value::String(entity.clone()));
                            fields.insert("changeId".to_owned(), json!(change_id));
                            fields.insert("targetNodeId".to_owned(), Value::String(target));
                            fields.insert("infoType".to_owned(), Value::String(kind));
                            if let Some(submission) = token.submission() {
                                fields.insert(
                                    "submissionId".to_owned(),
                                    Value::String(submission.clone()),
                                );
                            }
                            match outcome {
                                DeliveryFeedback::Enqueued => {
                                    self.push_event("info_sent", fields);
                                }
                                DeliveryFeedback::Dropped(reason) => {
                                    fields.insert(
                                        "reason".to_owned(),
                                        Value::String(format!("{reason:?}")),
                                    );
                                    self.push_event("delivery_dropped", fields);
                                }
                            }
                        }
                    }
                }
                // Only a new State key invalidates cached analysis views;
                // plain value changes keep the current revision.
                self.track_state_keys(&entity);
                if let Some(message) = request.get("error").and_then(Value::as_str) {
                    self.fail_change(token, message);
                } else if !self.kernel.settle_change(token, ChangeOutcome::Completed) {
                    return Err("change settlement rejected".into());
                }
                let mut settled = Map::new();
                settled.insert("nodeId".to_owned(), Value::String(entity.clone()));
                settled.insert("changeId".to_owned(), json!(change_id));
                settled.insert("version".to_owned(), json!(self.nodes[&entity].version));
                self.push_event("change_settled", settled);
                Ok(json!({"results":results,"version":self.nodes[&entity].version,"settled":true}))
            }
            "requestEffect" => {
                let change_id = request
                    .get("changeId")
                    .and_then(Value::as_u64)
                    .ok_or("changeId must be an integer")?;
                let adapter_id = required_str(request, "adapterId")?.to_owned();
                let token = session
                    .active
                    .get(&change_id)
                    .ok_or("change is not owned by this connection")?;
                let node = self
                    .nodes
                    .get(token.entity())
                    .ok_or("node is not admitted")?;
                if !node.effect_capabilities.contains(&adapter_id) {
                    return Err("EffectAdapter capability was not granted to this Node".into());
                }
                if !self.effect_leases.contains_key(&adapter_id) {
                    return Err("EffectAdapter has no connected provider".into());
                }
                self.next_effect_id += 1;
                let id = self.next_effect_id;
                let node_id = token.entity().to_owned();
                let generation = token.generation();
                let adapter = adapter_id.clone();
                self.effects.insert(
                    id,
                    EffectRecord {
                        id,
                        requester_session: session.id,
                        change_id,
                        node_id: node_id.clone(),
                        generation,
                        adapter_id: adapter.clone(),
                        request: request.get("request").cloned().unwrap_or(Value::Null),
                        status: EffectStatus::Queued,
                    },
                );
                let mut fields = Map::new();
                fields.insert("effectId".to_owned(), json!(id));
                fields.insert("changeId".to_owned(), json!(change_id));
                fields.insert("nodeId".to_owned(), Value::String(node_id));
                fields.insert("adapterId".to_owned(), Value::String(adapter));
                self.push_event("effect_requested", fields);
                Ok(json!({"effectId":id}))
            }
            "awaitEffect" => {
                let effect_id = request
                    .get("effectId")
                    .and_then(Value::as_u64)
                    .ok_or("effectId must be an integer")?;
                let effect = self
                    .effects
                    .get(&effect_id)
                    .ok_or("Effect request is not pending")?;
                if effect.requester_session != session.id {
                    return Err("Effect request is owned by another connection".into());
                }
                let completed = match &effect.status {
                    EffectStatus::Completed { ok, value } => Some((*ok, value.clone())),
                    _ => None,
                };
                let Some((ok, value)) = completed else {
                    return Ok(Value::Null);
                };
                self.effects.remove(&effect_id);
                Ok(json!({"ok":ok,"value":value}))
            }
            "pollEffect" => {
                if session.effect_claims.is_empty() {
                    return Err("claim at least one EffectAdapter before polling".into());
                }
                let candidate = self.effects.iter().find_map(|(id, effect)| {
                    (matches!(effect.status, EffectStatus::Queued)
                        && session.effect_claims.contains(&effect.adapter_id)
                        && self.effect_leases.get(&effect.adapter_id) == Some(&session.id))
                    .then_some(*id)
                });
                let Some(effect_id) = candidate else {
                    return Ok(Value::Null);
                };
                let effect = self.effects.get_mut(&effect_id).unwrap();
                effect.status = EffectStatus::Active(session.id);
                Ok(json!({
                    "effectId":effect.id,"changeId":effect.change_id,"nodeId":effect.node_id,
                    "generation":effect.generation,"adapterId":effect.adapter_id,"request":effect.request,
                }))
            }
            "completeEffect" => {
                let effect_id = request
                    .get("effectId")
                    .and_then(Value::as_u64)
                    .ok_or("effectId must be an integer")?;
                let ok = request
                    .get("ok")
                    .and_then(Value::as_bool)
                    .ok_or("ok must be a boolean")?;
                let effect = self
                    .effects
                    .get_mut(&effect_id)
                    .ok_or("Effect request is not pending")?;
                if !matches!(effect.status, EffectStatus::Active(id) if id == session.id) {
                    return Err("Effect request is not owned by this provider".into());
                }
                let value = if ok {
                    request.get("observation").cloned().unwrap_or(Value::Null)
                } else {
                    Value::String(required_str(request, "error")?.to_owned())
                };
                effect.status = EffectStatus::Completed { ok, value };
                let mut fields = Map::new();
                fields.insert("effectId".to_owned(), json!(effect_id));
                fields.insert("completed".to_owned(), json!(ok));
                self.push_event("effect_completed", fields);
                Ok(json!({"effectId":effect_id,"completed":true}))
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
                let (generation, version, before, after) =
                    self.patch_state(&id, patch, expected_generation, expected_version)?;
                self.track_state_keys(&id);
                let mut fields = Map::new();
                fields.insert("nodeId".to_owned(), Value::String(id.clone()));
                fields.insert(
                    "actor".to_owned(),
                    Value::String("legacy/intervene".to_owned()),
                );
                fields.insert("generation".to_owned(), json!(generation));
                fields.insert("versionBefore".to_owned(), json!(expected_version));
                fields.insert("versionAfter".to_owned(), json!(version));
                fields.insert("stateBefore".to_owned(), Value::Object(before));
                fields.insert("stateAfter".to_owned(), Value::Object(after));
                self.push_event("state_intervened", fields);
                let state = self.nodes[&id].state.clone();
                Ok(json!({"nodeId":id,"generation":generation,"version":version,"state":state}))
            }
            "cancel" => {
                let submission = required_str(request, "submissionId")?.to_owned();
                let cancelled = self.kernel.cancel(&submission);
                if cancelled {
                    let mut fields = Map::new();
                    fields.insert("submissionId".to_owned(), Value::String(submission));
                    self.push_event("submission_cancelled", fields);
                }
                Ok(json!({"cancelled":cancelled}))
            }
            "setAnalysisContext" => {
                let links = Self::context_array(request, "frontendLinks")?;
                let service_links = Self::context_array(request, "frontendServiceLinks")?;
                self.frontend_links = links;
                self.frontend_service_links = service_links;
                self.bump_analysis_revision();
                let mut fields = Map::new();
                fields.insert("frontendLinks".to_owned(), json!(self.frontend_links.len()));
                fields.insert(
                    "frontendServiceLinks".to_owned(),
                    json!(self.frontend_service_links.len()),
                );
                fields.insert("analysisRevision".to_owned(), json!(self.analysis_revision));
                self.push_event("analysis_context_updated", fields);
                Ok(json!({"analysisRevision":self.analysis_revision}))
            }
            "analyze" => {
                // Inline path for embedded/test callers. The TCP server in
                // main.rs instead uses `prepare_analyze` and runs the same
                // crate call after releasing the scheduling lock.
                let inner = request.get("request").ok_or("request is required")?.clone();
                let result = self.analyze_inline(&inner)?;
                if result.to_string().len() > MAX_ANALYSIS_RESPONSE_BYTES {
                    return Err("analysis response exceeds size limit".into());
                }
                Ok(result)
            }
            "agentInspect" => {
                let after = request.get("after").and_then(Value::as_u64).unwrap_or(0);
                let limit = request
                    .get("limit")
                    .and_then(Value::as_u64)
                    .unwrap_or(100)
                    .clamp(1, 1000) as usize;
                Ok(self.inspect(after, limit))
            }
            "agentInject" => {
                let actor = required_str(request, "actor")?.to_owned();
                let reason = required_str(request, "reason")?.to_owned();
                let target = required_str(request, "targetNodeId")?.to_owned();
                let info = request.get("info").ok_or("info is required")?.clone();
                let kind = info_type(&info)?.to_owned();
                let submission = required_str(request, "submissionId")?.to_owned();
                if let Some(previous) = self.submissions.get(&submission) {
                    if previous.target != target || previous.info != info {
                        return Err("submissionId was already used for another injection".into());
                    }
                    return Ok(json!({"duplicate":true,"feedback":previous.feedback}));
                }
                let outcome = self.kernel.inject_root_json(
                    &target,
                    kind.clone(),
                    Some(info.to_string()),
                    submission.clone(),
                );
                let result = feedback(outcome.clone());
                self.submissions.insert(
                    submission.clone(),
                    SubmissionRequest {
                        target: target.clone(),
                        info: info.clone(),
                        feedback: result.clone(),
                    },
                );
                let mut fields = Map::new();
                fields.insert("actor".to_owned(), Value::String(actor));
                fields.insert("reason".to_owned(), Value::String(reason));
                fields.insert("targetNodeId".to_owned(), Value::String(target.clone()));
                fields.insert("infoType".to_owned(), Value::String(kind.clone()));
                fields.insert("submissionId".to_owned(), Value::String(submission));
                self.push_event("agent_injected", fields);
                if let DeliveryFeedback::Dropped(reason) = outcome {
                    let mut dropped = Map::new();
                    dropped.insert("targetNodeId".to_owned(), Value::String(target));
                    dropped.insert("infoType".to_owned(), Value::String(kind));
                    dropped.insert("reason".to_owned(), Value::String(format!("{reason:?}")));
                    self.push_event("delivery_dropped", dropped);
                }
                Ok(json!({"duplicate":false,"feedback":result}))
            }
            "agentInterveneState" => {
                let actor = required_str(request, "actor")?.to_owned();
                let reason = required_str(request, "reason")?.to_owned();
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
                let (generation, version, before, after) =
                    self.patch_state(&id, patch, expected_generation, expected_version)?;
                self.track_state_keys(&id);
                let mut fields = Map::new();
                fields.insert("nodeId".to_owned(), Value::String(id.clone()));
                fields.insert("actor".to_owned(), Value::String(actor));
                fields.insert("reason".to_owned(), Value::String(reason));
                fields.insert("generation".to_owned(), json!(generation));
                fields.insert("versionBefore".to_owned(), json!(expected_version));
                fields.insert("versionAfter".to_owned(), json!(version));
                fields.insert("stateBefore".to_owned(), Value::Object(before));
                fields.insert("stateAfter".to_owned(), Value::Object(after));
                self.push_event("state_intervened", fields);
                let state = self.nodes[&id].state.clone();
                Ok(json!({"nodeId":id,"generation":generation,"version":version,"state":state}))
            }
            _ => Err("unknown operation".into()),
        }
    }

    fn fail_change(&mut self, token: ActiveChange, message: &str) {
        let mut failed = Map::new();
        failed.insert(
            "nodeId".to_owned(),
            Value::String(token.entity().to_owned()),
        );
        failed.insert("changeId".to_owned(), json!(token.change_id()));
        failed.insert("message".to_owned(), Value::String(message.to_owned()));
        if let Some(submission) = token.submission().cloned() {
            failed.insert("submissionId".to_owned(), Value::String(submission));
        }
        self.push_event("change_failed", failed);
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
    /// Patch-only State intervention in the single-flight gap. Returns
    /// (generation, version, stateBefore, stateAfter). Whole-object replace
    /// is rejected: callers send an explicit object patch instead.
    #[allow(clippy::type_complexity)]
    fn patch_state(
        &mut self,
        id: &str,
        patch: Map<String, Value>,
        expected_generation: u64,
        expected_version: u64,
    ) -> Result<(u64, u64, Map<String, Value>, Map<String, Value>), String> {
        let current = self.nodes.get(id).ok_or("node is not admitted")?;
        if current.generation != expected_generation || current.version != expected_version {
            return Err("state version conflict".into());
        }
        let before = current.state.clone();
        let generation = self.kernel.begin_edit(id).map_err(|e| e.to_string())?;
        if generation != expected_generation {
            self.kernel.abort_edit(id);
            return Err("state generation conflict".into());
        }
        let node = self.nodes.get_mut(id).unwrap();
        node.state.extend(patch);
        node.version += 1;
        let (version, after) = (node.version, node.state.clone());
        if !self.kernel.end_edit(id, generation) {
            return Err("state intervention settlement rejected".into());
        }
        Ok((generation, version, before, after))
    }

    fn analyze_inline(&mut self, inner: &Value) -> Result<Value, String> {
        let revision = self.analysis_revision;
        if let Some(hit) = self
            .analysis_cache
            .get(&Self::cache_key(revision, inner))
            .cloned()
        {
            return Ok(hit);
        }
        let snapshots: Vec<Value> = self
            .kernel
            .all_analysis_facts()
            .into_iter()
            .filter_map(|(_, text)| serde_json::from_str::<Value>(&text).ok())
            .collect();
        let live_states: BTreeMap<String, Value> = self
            .nodes
            .iter()
            .map(|(id, node)| {
                let keys = node
                    .state
                    .keys()
                    .map(|key| (key.clone(), Value::Null))
                    .collect();
                (id.clone(), Value::Object(keys))
            })
            .collect();
        let facts = json!({"snapshots": snapshots, "liveStates": live_states});
        let context = json!({
            "frontendLinks": self.frontend_links.clone(),
            "frontendServiceLinks": self.frontend_service_links.clone(),
        });
        let result = graphframework_analysis::analyze_json(inner, &facts, &context)?;
        self.store_analysis(revision, inner, result.clone());
        Ok(result)
    }

    /// Consistency read for the Agent control plane: Projection, pending
    /// Info, drops, active changes, leases, pending Effects, submissions and
    /// a cursor-paged slice of the bounded causal event ring.
    fn inspect(&self, after: u64, limit: usize) -> Value {
        let nodes: BTreeMap<String, Value> = self
            .nodes
            .iter()
            .map(|(id, node)| {
                (
                    id.clone(),
                    json!({
                        "state": node.state, "version": node.version,
                        "generation": node.generation,
                    }),
                )
            })
            .collect();
        let pending: Vec<Value> = self
            .kernel
            .queued_infos()
            .into_iter()
            .map(|info| {
                json!({
                    "nodeId": info.target, "infoId": info.info_id,
                    "infoType": info.info_type, "sender": info.sender,
                    "generation": info.generation, "causedBy": info.caused_by,
                    "submissionId": info.submission,
                })
            })
            .collect();
        let drops: Vec<Value> = self
            .kernel
            .drops()
            .iter()
            .map(|drop_| {
                json!({
                    "targetNodeId": drop_.target, "generation": drop_.generation,
                    "submissionId": drop_.submission,
                    "reason": format!("{:?}", drop_.reason),
                })
            })
            .collect();
        let active: Vec<Value> = self
            .kernel
            .active_changes()
            .into_iter()
            .map(|(entity, change_id, generation)| {
                json!({"nodeId": entity, "changeId": change_id, "generation": generation})
            })
            .collect();
        let leases: BTreeMap<String, Value> = self
            .leases
            .iter()
            .map(|(id, lease)| {
                (
                    id.clone(),
                    json!({"sessionId": lease.session_id, "generation": lease.generation}),
                )
            })
            .collect();
        let pending_effects: Vec<Value> = self
            .effects
            .values()
            .map(|effect| {
                let status = match &effect.status {
                    EffectStatus::Queued => json!("queued"),
                    EffectStatus::Active(owner) => json!({"active": owner}),
                    EffectStatus::Completed { ok, .. } => json!({"completed": ok}),
                };
                json!({
                    "effectId": effect.id, "changeId": effect.change_id,
                    "nodeId": effect.node_id, "generation": effect.generation,
                    "adapterId": effect.adapter_id, "status": status,
                })
            })
            .collect();
        let submissions: BTreeMap<String, Value> = self
            .submissions
            .keys()
            .map(|id| {
                let status = match self.kernel.submission_state(id) {
                    Some(SubmissionState::Open { pending }) => {
                        json!({"status": "open", "pending": pending})
                    }
                    Some(SubmissionState::Completed) => json!({"status": "completed"}),
                    Some(SubmissionState::Cancelled) => json!({"status": "cancelled"}),
                    Some(SubmissionState::Failed(message)) => {
                        json!({"status": "failed", "message": message})
                    }
                    None => json!({"status": "unknown"}),
                };
                (id.clone(), status)
            })
            .collect();
        let oldest = self
            .events
            .front()
            .and_then(|event| event.get("cursor"))
            .and_then(Value::as_u64);
        // `truncated` reports that events at or before `after` were already
        // evicted from the bounded ring; the caller must re-read from scratch.
        let truncated = oldest.is_some_and(|cursor| after.saturating_add(1) < cursor);
        let page: Vec<Value> = self
            .events
            .iter()
            .filter(|event| {
                event
                    .get("cursor")
                    .and_then(Value::as_u64)
                    .is_some_and(|cursor| cursor > after)
            })
            .take(limit)
            .cloned()
            .collect();
        let next_cursor = page
            .last()
            .and_then(|event| event.get("cursor"))
            .and_then(Value::as_u64)
            .unwrap_or(after);
        json!({
            "projection": {"nodes": nodes, "pending": self.kernel.pending_total(),
                "analysisRevision": self.analysis_revision},
            "pending": pending, "drops": drops, "activeChanges": active,
            "leases": leases, "effectLeases": self.effect_leases.clone(),
            "pendingEffects": pending_effects, "submissions": submissions,
            "events": {"events": page, "nextCursor": next_cursor, "truncated": truncated},
        })
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

#[cfg(test)]
mod tests {
    use super::*;

    const TOKEN: &str = "test-token-at-least-16-bytes";

    fn setup() -> (Space, Session) {
        (Space::default(), Session::new(1))
    }

    fn call(space: &mut Space, session: &mut Session, op: &str, payload: Value) -> Value {
        let mut request = payload.as_object().cloned().unwrap_or_default();
        request.insert("version".to_owned(), json!(1));
        request.insert("id".to_owned(), json!(1));
        request.insert("token".to_owned(), Value::String(TOKEN.to_owned()));
        request.insert("op".to_owned(), Value::String(op.to_owned()));
        space.handle(session, &Value::Object(request), TOKEN)
    }

    fn facts(node_id: &str) -> Value {
        json!({
            "version": 1, "nodeId": node_id,
            "entities": [{"address": format!("node:{node_id}"), "kind": "node", "id": node_id}],
            "edges": [],
        })
    }

    #[test]
    fn machine_contract_matches_the_public_operation_catalog() {
        let contract: Value =
            serde_json::from_str(include_str!("../../../contract/operations.json"))
                .expect("operations contract must be valid JSON");
        let names: Vec<&str> = contract["operations"]
            .as_array()
            .expect("operations must be an array")
            .iter()
            .map(|operation| {
                operation["name"]
                    .as_str()
                    .expect("every operation must have a string name")
            })
            .collect();
        assert_eq!(names, PUBLIC_OPERATIONS);
    }

    #[test]
    fn invalid_facts_are_rejected_before_admit() {
        let (mut space, mut session) = setup();
        let bad = json!({"version": 1, "nodeId": "other", "entities": [], "edges": []});
        let response = call(
            &mut space,
            &mut session,
            "admit",
            json!({"nodeId": "counter", "initialState": {}, "analysisFacts": bad}),
        );
        assert_eq!(response["ok"], json!(false));
        // No half-admitted Node remains behind the rejection.
        assert!(!space.nodes.contains_key("counter"));
        assert!(space.kernel.generation("counter").is_none());
    }

    #[test]
    fn replace_discards_old_facts_state_and_backlog() {
        let (mut space, mut session) = setup();
        assert_eq!(
            call(
                &mut space,
                &mut session,
                "admit",
                json!({"nodeId": "counter", "initialState": {"count": 1},
                    "analysisFacts": facts("counter")}),
            )["ok"],
            json!(true)
        );
        assert_eq!(space.kernel.all_analysis_facts().len(), 1);
        let response = call(
            &mut space,
            &mut session,
            "replace",
            json!({"nodeId": "counter", "initialState": {"count": 0}}),
        );
        assert_eq!(response["ok"], json!(true));
        // No facts carried over, State reset, generation bumped, no rollback.
        assert!(space.kernel.all_analysis_facts().is_empty());
        assert_eq!(space.nodes["counter"].version, 0);
        assert_eq!(space.nodes["counter"].generation, 1);
        assert!(space.kernel.queued_infos().is_empty());
    }

    #[test]
    fn agent_inject_is_idempotent_and_conflicts_on_reuse() {
        let (mut space, mut session) = setup();
        call(
            &mut space,
            &mut session,
            "admit",
            json!({"nodeId": "owner", "initialState": {}}),
        );
        let payload = json!({"actor": "agent/test", "reason": "probe",
            "submissionId": "agent/1", "targetNodeId": "owner", "info": {"type": "ProbeInfo"}});
        let first = call(&mut space, &mut session, "agentInject", payload.clone());
        assert_eq!(first["result"]["duplicate"], json!(false));
        let replay = call(&mut space, &mut session, "agentInject", payload);
        assert_eq!(replay["result"]["duplicate"], json!(true));
        let conflict = call(
            &mut space,
            &mut session,
            "agentInject",
            json!({"actor": "agent/test", "reason": "probe",
                "submissionId": "agent/1", "targetNodeId": "owner", "info": {"type": "OtherInfo"}}),
        );
        assert_eq!(conflict["ok"], json!(false));
    }

    #[test]
    fn agent_state_patch_checks_versions_and_records_audit() {
        let (mut space, mut session) = setup();
        call(
            &mut space,
            &mut session,
            "admit",
            json!({"nodeId": "owner", "initialState": {"count": 1}}),
        );
        let ok = call(
            &mut space,
            &mut session,
            "agentInterveneState",
            json!({"actor": "agent/test", "reason": "repair", "nodeId": "owner",
                "patch": {"count": 2}, "expectedGeneration": 0, "expectedVersion": 0}),
        );
        assert_eq!(ok["result"]["version"], json!(1));
        assert_eq!(space.nodes["owner"].state["count"], json!(2));
        let stale = call(
            &mut space,
            &mut session,
            "agentInterveneState",
            json!({"actor": "agent/test", "reason": "repair", "nodeId": "owner",
                "patch": {"count": 3}, "expectedGeneration": 0, "expectedVersion": 0}),
        );
        assert_eq!(stale["ok"], json!(false));
        assert_eq!(space.nodes["owner"].state["count"], json!(2));
        let inspect = call(&mut space, &mut session, "agentInspect", json!({}));
        let kinds: Vec<String> = inspect["result"]["events"]["events"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|event| event.get("kind").and_then(Value::as_str).map(str::to_owned))
            .collect();
        assert!(kinds.contains(&"state_intervened".to_owned()));
    }

    #[test]
    fn agent_inspect_pages_events_with_truncation() {
        let (mut space, mut session) = setup();
        call(
            &mut space,
            &mut session,
            "admit",
            json!({"nodeId": "owner", "initialState": {}}),
        );
        // Overflow the 1000-entry ring so the cursor reports truncation.
        for index in 0..1005 {
            call(
                &mut space,
                &mut session,
                "agentInject",
                json!({"actor": "agent/test", "reason": "flood",
                    "submissionId": format!("agent/{index}"),
                    "targetNodeId": "owner", "info": {"type": "ProbeInfo"}}),
            );
        }
        let page = call(
            &mut space,
            &mut session,
            "agentInspect",
            json!({"after": 0, "limit": 100}),
        );
        let events = &page["result"]["events"];
        assert_eq!(events["events"].as_array().unwrap().len(), 100);
        assert_eq!(events["truncated"], json!(true));
        let next = events["nextCursor"].as_u64().unwrap();
        let tail = call(
            &mut space,
            &mut session,
            "agentInspect",
            json!({"after": next, "limit": 1000}),
        );
        assert_eq!(tail["result"]["events"]["truncated"], json!(false));
    }

    #[test]
    fn inline_analyze_serves_views_over_admitted_facts() {
        let (mut space, mut session) = setup();
        call(
            &mut space,
            &mut session,
            "admit",
            json!({"nodeId": "a", "initialState": {"count": 0},
            "analysisFacts": {
                "version": 1, "nodeId": "a",
                "entities": [
                    {"address": "node:a", "kind": "node", "id": "a"},
                    {"address": "change:a::TickInfo", "kind": "change",
                        "id": "a", "nodeId": "a", "subId": "TickInfo"},
                ],
                "edges": [],
            }}),
        );
        let view = call(
            &mut space,
            &mut session,
            "analyze",
            json!({"request": {"op": "view"}}),
        );
        assert_eq!(view["ok"], json!(true));
        assert!(view["result"]["nodes"].get("a").is_some());
        // New State keys bump the revision; value writes do not.
        let before = space.analysis_revision;
        call(
            &mut space,
            &mut session,
            "intervene",
            json!({"nodeId": "a", "patch": {"count": 1},
                "expectedGeneration": 0, "expectedVersion": 0}),
        );
        assert_eq!(space.analysis_revision, before);
    }

    #[test]
    fn change_cycle_drop_and_cancel_leave_a_dynamic_event_trail() {
        let (mut space, mut session) = setup();
        let mut worker = Session::new(2);
        call(
            &mut space,
            &mut session,
            "admit",
            json!({"nodeId": "a", "initialState": {}}),
        );
        call(&mut space, &mut worker, "claim", json!({"nodeIds": ["a"]}));
        call(
            &mut space,
            &mut session,
            "agentInject",
            json!({"actor": "agent/test", "reason": "cycle",
                "submissionId": "agent/cycle", "targetNodeId": "a",
                "info": {"type": "TickInfo"}}),
        );
        let polled = call(&mut space, &mut worker, "poll", json!({}));
        let change_id = polled["result"]["change"]["changeId"].as_u64().unwrap();
        // Unknown targets never run: the drop is a causal fact, not silence.
        let committed = call(
            &mut space,
            &mut worker,
            "commit",
            json!({"changeId": change_id, "operations": [
                {"op": "send", "targetNodeId": "ghost",
                    "info": {"type": "TickInfo"}},
            ]}),
        );
        assert_eq!(committed["ok"], json!(true));
        assert_eq!(
            committed["result"]["results"][0]["status"],
            json!("dropped")
        );
        call(
            &mut space,
            &mut session,
            "cancel",
            json!({"submissionId": "agent/cycle"}),
        );
        let inspect = call(&mut space, &mut session, "agentInspect", json!({}));
        let kinds: Vec<String> = inspect["result"]["events"]["events"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|event| event.get("kind").and_then(Value::as_str).map(str::to_owned))
            .collect();
        for expected in [
            "agent_injected",
            "change_started",
            "delivery_dropped",
            "change_settled",
            "submission_cancelled",
        ] {
            assert!(kinds.contains(&expected.to_owned()), "missing {expected}");
        }
        // The drop ledger stays queryable alongside the event trail.
        let drops = inspect["result"]["drops"].as_array().unwrap();
        assert!(drops
            .iter()
            .any(|drop_| drop_["targetNodeId"] == json!("ghost")));
    }

    #[test]
    fn cached_views_never_survive_a_revision_bump() {
        let (mut space, mut session) = setup();
        call(
            &mut space,
            &mut session,
            "admit",
            json!({"nodeId": "a", "initialState": {"count": 0},
                "analysisFacts": facts("a")}),
        );
        let first = call(
            &mut space,
            &mut session,
            "analyze",
            json!({"request": {"op": "view"}}),
        );
        assert!(first["result"]["nodes"].get("a").is_some());
        assert!(first["result"]["nodes"].get("b").is_none());
        // Value-only writes keep the revision: the cached view is reused.
        let revision = space.analysis_revision;
        call(
            &mut space,
            &mut session,
            "intervene",
            json!({"nodeId": "a", "patch": {"count": 1},
                "expectedGeneration": 0, "expectedVersion": 0}),
        );
        assert_eq!(space.analysis_revision, revision);
        let cached = call(
            &mut space,
            &mut session,
            "analyze",
            json!({"request": {"op": "view"}}),
        );
        assert_eq!(cached["result"], first["result"]);
        // Structural change bumps the revision: the same request rebuilds.
        call(
            &mut space,
            &mut session,
            "admit",
            json!({"nodeId": "b", "initialState": {}, "analysisFacts": facts("b")}),
        );
        assert!(space.analysis_revision > revision);
        let rebuilt = call(
            &mut space,
            &mut session,
            "analyze",
            json!({"request": {"op": "view"}}),
        );
        assert!(rebuilt["result"]["nodes"].get("b").is_some());
    }
}

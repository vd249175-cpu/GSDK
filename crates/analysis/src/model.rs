//! Portable causal index: DTO parsing, snapshot merge, live-state synthesis.
//! Mirrors `sdk/analysis/model.ts` + `portable-index.ts`. No business semantics.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{json, Map, Value};

pub const MAX_ENTITIES_PER_SNAPSHOT: usize = 5000;
pub const MAX_EDGES_PER_SNAPSHOT: usize = 20000;

#[derive(Debug, Clone)]
pub struct Entity {
    pub address: String,
    pub kind: String,
    pub id: String,
    pub sub_id: Option<String>,
    pub node_id: Option<String>,
    pub raw: Value,
}

#[derive(Debug, Clone)]
pub struct Edge {
    pub id: String,
    pub from: String,
    pub to: String,
    pub edge_type: String,
    pub confidence: String,
    pub raw: Value,
}

#[derive(Debug, Clone, Default)]
#[allow(dead_code)]
pub struct Index {
    pub entities: BTreeMap<String, Entity>,
    pub edges: Vec<Edge>,
    pub nodes: BTreeSet<String>,
    pub frontend_links: Vec<Value>,
    pub frontend_service_links: Vec<Value>,
}

fn entity_kind(entity: &Value) -> Result<String, String> {
    entity
        .get("kind")
        .and_then(Value::as_str)
        .filter(|k| {
            matches!(
                *k,
                "node" | "change" | "state" | "info" | "effect" | "entry" | "ui"
            )
        })
        .map(str::to_owned)
        .ok_or_else(|| "entity.kind must be a known kind".to_owned())
}

fn edge_type(edge: &Value) -> Result<String, String> {
    edge.get("type")
        .and_then(Value::as_str)
        .filter(|t| {
            matches!(
                *t,
                "trigger" | "send" | "read-by" | "write" | "effect" | "inject" | "project"
            )
        })
        .map(str::to_owned)
        .ok_or_else(|| "edge.type must be a known relation".to_owned())
}

fn confidence(edge: &Value) -> Result<String, String> {
    edge.get("confidence")
        .and_then(Value::as_str)
        .filter(|c| matches!(*c, "high" | "medium" | "low"))
        .map(str::to_owned)
        .ok_or_else(|| "edge.confidence must be high|medium|low".to_owned())
}

fn parse_entity(value: &Value) -> Result<Entity, String> {
    let address = value
        .get("address")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "entity.address must be a nonempty string".to_owned())?;
    let kind = entity_kind(value)?;
    let id = value
        .get("id")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "entity.id must be a nonempty string".to_owned())?;
    Ok(Entity {
        address: address.to_owned(),
        kind,
        id: id.to_owned(),
        sub_id: value
            .get("subId")
            .and_then(Value::as_str)
            .map(str::to_owned),
        node_id: value
            .get("nodeId")
            .and_then(Value::as_str)
            .map(str::to_owned),
        raw: value.clone(),
    })
}

fn parse_edge(value: &Value) -> Result<Edge, String> {
    let id = value
        .get("id")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "edge.id must be a nonempty string".to_owned())?;
    let from = value
        .get("from")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "edge.from must be a nonempty string".to_owned())?;
    let to = value
        .get("to")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "edge.to must be a nonempty string".to_owned())?;
    Ok(Edge {
        id: id.to_owned(),
        from: from.to_owned(),
        to: to.to_owned(),
        edge_type: edge_type(value)?,
        confidence: confidence(value)?,
        raw: value.clone(),
    })
}

pub fn validate_snapshot(snapshot: &Value) -> Result<(String, Vec<Entity>, Vec<Edge>), String> {
    let version = snapshot.get("version").and_then(Value::as_u64);
    if version != Some(1) {
        return Err("snapshot.version must be 1".into());
    }
    let node_id = snapshot
        .get("nodeId")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "snapshot.nodeId must be a nonempty string".to_owned())?;
    let entities = snapshot
        .get("entities")
        .and_then(Value::as_array)
        .ok_or_else(|| "snapshot.entities must be an array".to_owned())?;
    let edges = snapshot
        .get("edges")
        .and_then(Value::as_array)
        .ok_or_else(|| "snapshot.edges must be an array".to_owned())?;
    if entities.len() > MAX_ENTITIES_PER_SNAPSHOT {
        return Err("snapshot exceeds entity limit".into());
    }
    if edges.len() > MAX_EDGES_PER_SNAPSHOT {
        return Err("snapshot exceeds edge limit".into());
    }
    let parsed: Vec<Entity> = entities
        .iter()
        .map(parse_entity)
        .collect::<Result<_, _>>()?;
    let node_count = parsed
        .iter()
        .filter(|e| e.kind == "node" && e.id == node_id)
        .count();
    if node_count != 1 {
        return Err(format!(
            "Snapshot must identify exactly one source Node: {node_id}"
        ));
    }
    let mut seen = BTreeSet::new();
    for entity in &parsed {
        if !seen.insert(entity.address.clone()) {
            return Err(format!("Duplicate analysis entity: {}", entity.address));
        }
    }
    let local: BTreeSet<&str> = parsed.iter().map(|e| e.address.as_str()).collect();
    let parsed_edges: Vec<Edge> = edges.iter().map(parse_edge).collect::<Result<_, _>>()?;
    for edge in &parsed_edges {
        if !local.contains(edge.from.as_str()) || !local.contains(edge.to.as_str()) {
            // Cross-snapshot references are resolved at merge time; per-snapshot
            // dangling endpoints are reported by `validate`, not rejected here.
            continue;
        }
    }
    Ok((node_id.to_owned(), parsed, parsed_edges))
}

/// Merge snapshots + frontend context + live states into one causal index.
pub fn build_index(
    snapshots: &[Value],
    frontend_links: &[Value],
    frontend_service_links: &[Value],
    live_states: &BTreeMap<String, BTreeMap<String, Value>>,
) -> Result<Index, String> {
    let mut index = Index {
        frontend_links: frontend_links.to_vec(),
        frontend_service_links: frontend_service_links.to_vec(),
        ..Default::default()
    };
    let mut edge_ids = BTreeSet::new();
    let mut sources = BTreeSet::new();
    for snapshot in snapshots {
        let (node_id, entities, edges) = validate_snapshot(snapshot)?;
        if !sources.insert(node_id.clone()) || index.nodes.contains(&node_id) {
            return Err(format!("Duplicate source Node facts: {node_id}"));
        }
        for entity in entities {
            if let Some(existing) = index.entities.get(&entity.address) {
                if existing.kind != entity.kind
                    || existing.id != entity.id
                    || existing.node_id != entity.node_id
                {
                    return Err(format!("Conflicting analysis entity: {}", entity.address));
                }
                continue;
            }
            if entity.kind == "node" {
                index.nodes.insert(entity.id.clone());
            }
            index.entities.insert(entity.address.clone(), entity);
        }
        for edge in edges {
            if !edge_ids.insert(edge.id.clone()) {
                return Err(format!("Duplicate analysis relation: {}", edge.id));
            }
            index.edges.push(edge);
        }
        for key in ["unresolvedInfoTypes", "unresolvedSendTargets"] {
            if let Some(list) = snapshot.get(key).and_then(Value::as_array) {
                for _item in list {
                    // Stored implicitly via raw snapshots; surfaced by validate.
                }
            }
        }
    }
    // Frontend links: entry/info/inject/project synthesis (portable-index.ts).
    for link in frontend_links {
        let method = link
            .get("applicationMethod")
            .and_then(Value::as_str)
            .ok_or_else(|| "frontendLinks[].applicationMethod must be a string".to_owned())?;
        let injection = link
            .get("injection")
            .ok_or_else(|| "frontendLinks[].injection is required".to_owned())?;
        let target = injection
            .get("targetNodeId")
            .and_then(Value::as_str)
            .ok_or_else(|| "frontendLinks[].injection.targetNodeId must be a string".to_owned())?;
        let info_type = injection
            .get("infoType")
            .and_then(Value::as_str)
            .ok_or_else(|| "frontendLinks[].injection.infoType must be a string".to_owned())?;
        let entry_address = format!("entry:{method}");
        let info_address = format!("info:{info_type}@{target}");
        index.entities.entry(entry_address.clone()).or_insert(Entity {
            address: entry_address.clone(),
            kind: "entry".to_owned(),
            id: method.to_owned(),
            sub_id: None,
            node_id: None,
            raw: json!({"address": entry_address, "kind": "entry", "id": method}),
        });
        index.entities.entry(info_address.clone()).or_insert(Entity {
            address: info_address.clone(),
            kind: "info".to_owned(),
            id: info_type.to_owned(),
            sub_id: Some(target.to_owned()),
            node_id: Some(target.to_owned()),
            raw: json!({"address": info_address, "kind": "info", "id": info_type,
                "subId": target, "nodeId": target}),
        });
        let inject_id = format!("inject:{entry_address}->{info_address}");
        if edge_ids.insert(inject_id.clone()) {
            index.edges.push(Edge {
                id: inject_id.clone(),
                from: entry_address,
                to: info_address,
                edge_type: "inject".to_owned(),
                confidence: "high".to_owned(),
                raw: json!({"id": inject_id, "type": "inject", "confidence": "high"}),
            });
        }
        if let Some(projections) = link.get("projections").and_then(Value::as_array) {
            for projection in projections {
                let owner = projection
                    .get("ownerNodeId")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                let field = projection
                    .get("ownerField")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                let path = projection
                    .get("applicationStatePath")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                let state_address = format!("state:{owner}::{field}");
                let ui_address = format!("ui:{path}");
                index.entities.entry(ui_address.clone()).or_insert(Entity {
                    address: ui_address.clone(),
                    kind: "ui".to_owned(),
                    id: path.to_owned(),
                    sub_id: None,
                    node_id: None,
                    raw: json!({"address": ui_address, "kind": "ui", "id": path}),
                });
                let project_id = format!("project:{state_address}->{ui_address}");
                if edge_ids.insert(project_id.clone()) {
                    index.edges.push(Edge {
                        id: project_id,
                        from: state_address,
                        to: ui_address,
                        edge_type: "project".to_owned(),
                        confidence: "high".to_owned(),
                        raw: json!({"type": "project", "confidence": "high"}),
                    });
                }
            }
        }
    }
    // Live-state synthesis: no-facts Node => opaque-handler + per-key states.
    let mut live_nodes: BTreeSet<String> = live_states.keys().cloned().collect();
    for id in index.nodes.iter().cloned().collect::<Vec<_>>() {
        live_nodes.insert(id);
    }
    for node_id in live_nodes {
        let address = format!("node:{node_id}");
        if !index.entities.contains_key(&address) {
            index.entities.insert(
                address.clone(),
                Entity {
                    address: address.clone(),
                    kind: "node".to_owned(),
                    id: node_id.clone(),
                    sub_id: None,
                    node_id: None,
                    raw: json!({"address": address, "kind": "node", "id": node_id,
                        "name": node_id, "meta": {"analysis": "opaque-handler"}}),
                },
            );
            index.nodes.insert(node_id.clone());
        }
        if let Some(fields) = live_states.get(&node_id) {
            for field in fields.keys() {
                let state_address = format!("state:{node_id}::{field}");
                index.entities.entry(state_address.clone()).or_insert(Entity {
                    address: state_address.clone(),
                    kind: "state".to_owned(),
                    id: node_id.clone(),
                    sub_id: Some(field.clone()),
                    node_id: Some(node_id.clone()),
                    raw: json!({"address": state_address, "kind": "state", "id": node_id,
                        "nodeId": node_id, "subId": field, "meta": {"analysis": "live-state"}}),
                });
            }
        }
    }
    Ok(index)
}

pub fn entity_to_json(entity: &Entity) -> Value {
    let mut map = Map::new();
    map.insert("address".to_owned(), Value::String(entity.address.clone()));
    map.insert("kind".to_owned(), Value::String(entity.kind.clone()));
    map.insert("id".to_owned(), Value::String(entity.id.clone()));
    if let Some(name) = entity.raw.get("name") {
        map.insert("name".to_owned(), name.clone());
    }
    if let Some(sub) = entity.raw.get("subId").or_else(|| {
        entity.sub_id.as_ref().map(|_| &entity.raw as &Value).and(None)
    }) {
        map.insert("subId".to_owned(), sub.clone());
    } else if let Some(sub) = &entity.sub_id {
        map.insert("subId".to_owned(), Value::String(sub.clone()));
    }
    if let Some(owner) = &entity.node_id {
        map.insert("nodeId".to_owned(), Value::String(owner.clone()));
    }
    for key in ["location", "meta"] {
        if let Some(value) = entity.raw.get(key) {
            map.insert(key.to_owned(), value.clone());
        }
    }
    Value::Object(map)
}

pub fn edge_to_json(edge: &Edge) -> Value {
    let mut map = Map::new();
    map.insert("id".to_owned(), Value::String(edge.id.clone()));
    map.insert("from".to_owned(), Value::String(edge.from.clone()));
    map.insert("to".to_owned(), Value::String(edge.to.clone()));
    map.insert("type".to_owned(), Value::String(edge.edge_type.clone()));
    map.insert(
        "confidence".to_owned(),
        Value::String(edge.confidence.clone()),
    );
    for key in ["location", "unresolved"] {
        if let Some(value) = edge.raw.get(key) {
            map.insert(key.to_owned(), value.clone());
        }
    }
    Value::Object(map)
}

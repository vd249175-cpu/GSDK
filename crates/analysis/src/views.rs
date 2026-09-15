//! Node-level views and fold-depth expansion.
//! Mirrors `sdk/analysis/views.ts` + `fold-depth.ts`.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{json, Map, Value};

use crate::model::{entity_to_json, Index};

#[derive(Debug, Clone)]
pub struct Route {
    pub id: String,
    pub from: String,
    pub to: String,
    pub info_type: String,
    pub route_count: u64,
    pub internal: bool,
    pub witnesses: Vec<Value>,
}

impl Route {
    fn to_json(&self) -> Value {
        let mut map = Map::new();
        map.insert("id".to_owned(), Value::String(self.id.clone()));
        map.insert("from".to_owned(), Value::String(self.from.clone()));
        map.insert("to".to_owned(), Value::String(self.to.clone()));
        map.insert("infoType".to_owned(), Value::String(self.info_type.clone()));
        map.insert("routeCount".to_owned(), json!(self.route_count));
        map.insert("internal".to_owned(), Value::Bool(self.internal));
        map.insert("witnesses".to_owned(), Value::Array(self.witnesses.clone()));
        Value::Object(map)
    }
}

#[derive(Debug, Clone)]
pub struct View {
    pub id: String,
    pub kind: String,
    pub root: String,
    pub expanded: Vec<String>,
    pub nodes: BTreeMap<String, ViewNode>,
    pub routes: Vec<Route>,
    pub base_map: BTreeMap<String, String>,
}

#[derive(Debug, Clone)]
pub struct ViewNode {
    pub id: String,
    pub name: String,
    pub aggregate: bool,
    pub sources: Vec<String>,
    pub states: Vec<Value>,
    pub changes: Vec<Value>,
    pub infos: Vec<Value>,
    pub effects: Vec<Value>,
}

fn parse_change(address: &str) -> Option<(String, String)> {
    let rest = address.strip_prefix("change:")?;
    let sep = rest.find("::")?;
    if sep == 0 || sep + 2 >= rest.len() {
        return None;
    }
    Some((rest[..sep].to_owned(), rest[sep + 2..].to_owned()))
}

fn parse_info(address: &str) -> Option<(String, String)> {
    let rest = address.strip_prefix("info:")?;
    let sep = rest.find('@')?;
    if sep == 0 || sep + 1 >= rest.len() {
        return None;
    }
    Some((rest[..sep].to_owned(), rest[sep + 1..].to_owned()))
}

pub fn build_all_nodes(index: &Index) -> View {
    let mut routes: BTreeMap<String, Route> = BTreeMap::new();
    for edge in &index.edges {
        if edge.edge_type != "send" {
            continue;
        }
        let (from_node, _) = match parse_change(&edge.from) {
            Some(parsed) => parsed,
            None => continue,
        };
        let (info_type, to_node) = match parse_info(&edge.to) {
            Some(parsed) => parsed,
            None => continue,
        };
        if !index.nodes.contains(&from_node) || !index.nodes.contains(&to_node) {
            continue;
        }
        let id = format!("route:{from_node}->{to_node}:{info_type}");
        let mut witness = Map::new();
        witness.insert("edgeId".to_owned(), Value::String(edge.id.clone()));
        witness.insert("sourceNodeId".to_owned(), Value::String(from_node.clone()));
        witness.insert(
            "sourceChangeAddress".to_owned(),
            Value::String(edge.from.clone()),
        );
        witness.insert("targetNodeId".to_owned(), Value::String(to_node.clone()));
        witness.insert(
            "targetInfoAddress".to_owned(),
            Value::String(edge.to.clone()),
        );
        witness.insert("infoType".to_owned(), Value::String(info_type.clone()));
        if let Some(location) = edge.raw.get("location") {
            witness.insert("location".to_owned(), location.clone());
        }
        let entry = routes.entry(id.clone()).or_insert(Route {
            id: id.clone(),
            from: from_node.clone(),
            to: to_node.clone(),
            info_type: info_type.clone(),
            route_count: 0,
            internal: from_node == to_node,
            witnesses: Vec::new(),
        });
        entry.route_count += 1;
        entry.witnesses.push(Value::Object(witness));
    }
    let mut ordered: Vec<Route> = routes.into_values().collect();
    ordered.sort_by(|a, b| {
        a.from
            .cmp(&b.from)
            .then(a.to.cmp(&b.to))
            .then(a.info_type.cmp(&b.info_type))
    });
    let mut nodes = BTreeMap::new();
    for node_id in &index.nodes {
        let entity = index.entities.get(&format!("node:{node_id}"));
        let mut states = Vec::new();
        let mut changes = Vec::new();
        let mut infos = Vec::new();
        let mut effects = Vec::new();
        let mut ordered_entities: Vec<&crate::model::Entity> =
            index.entities.values().collect();
        ordered_entities.sort_by(|a, b| a.address.cmp(&b.address));
        for candidate in ordered_entities {
            if candidate.node_id.as_deref() != Some(node_id.as_str()) {
                continue;
            }
            match candidate.kind.as_str() {
                "state" => states.push(entity_to_json(candidate)),
                "change" => changes.push(entity_to_json(candidate)),
                "info" => infos.push(entity_to_json(candidate)),
                "effect" => effects.push(entity_to_json(candidate)),
                _ => {}
            }
        }
        nodes.insert(
            node_id.clone(),
            ViewNode {
                id: node_id.clone(),
                name: entity
                    .and_then(|e| e.raw.get("name"))
                    .and_then(Value::as_str)
                    .unwrap_or(node_id)
                    .to_owned(),
                aggregate: false,
                sources: vec![node_id.clone()],
                states,
                changes,
                infos,
                effects,
            },
        );
    }
    let mut base_map = BTreeMap::new();
    for node_id in nodes.keys() {
        base_map.insert(node_id.clone(), node_id.clone());
    }
    View {
        id: "all-nodes".to_owned(),
        kind: "all-nodes".to_owned(),
        root: String::new(),
        expanded: Vec::new(),
        nodes,
        routes: ordered,
        base_map,
    }
}

pub fn view_to_json(view: &View) -> Value {
    let mut nodes = Map::new();
    for (id, node) in &view.nodes {
        let inbound: Vec<Value> = view
            .routes
            .iter()
            .filter(|r| !r.internal && r.to == *id)
            .map(Route::to_json)
            .collect();
        let internal: Vec<Value> = view
            .routes
            .iter()
            .filter(|r| r.internal && r.from == *id)
            .map(Route::to_json)
            .collect();
        let outbound: Vec<Value> = view
            .routes
            .iter()
            .filter(|r| !r.internal && r.from == *id)
            .map(Route::to_json)
            .collect();
        let mut map = Map::new();
        map.insert("id".to_owned(), Value::String(node.id.clone()));
        map.insert("name".to_owned(), Value::String(node.name.clone()));
        map.insert("aggregate".to_owned(), Value::Bool(node.aggregate));
        map.insert(
            "sourceNodeIds".to_owned(),
            Value::Array(node.sources.iter().map(|s| Value::String(s.clone())).collect()),
        );
        map.insert("states".to_owned(), Value::Array(node.states.clone()));
        map.insert("changes".to_owned(), Value::Array(node.changes.clone()));
        map.insert("infos".to_owned(), Value::Array(node.infos.clone()));
        map.insert("effects".to_owned(), Value::Array(node.effects.clone()));
        map.insert("inbound".to_owned(), Value::Array(inbound));
        map.insert("internal".to_owned(), Value::Array(internal));
        map.insert("outbound".to_owned(), Value::Array(outbound));
        nodes.insert(id.clone(), Value::Object(map));
    }
    let mut base_map = Map::new();
    for (from, to) in &view.base_map {
        base_map.insert(from.clone(), Value::String(to.clone()));
    }
    json!({
        "id": view.id, "kind": view.kind, "root": view.root,
        "expanded": view.expanded, "nodes": nodes,
        "routes": view.routes.iter().map(Route::to_json).collect::<Vec<_>>(),
        "baseNodeToViewNode": base_map,
    })
}

pub fn build_fold_view(base: &View, folds: &Value, fold_depth: usize) -> Result<View, String> {
    let version = folds.get("version").and_then(Value::as_u64);
    if version != Some(1) {
        return Err("Fold root is missing or has an unsupported version".into());
    }
    let root = folds
        .get("root")
        .and_then(Value::as_str)
        .ok_or_else(|| "Fold root is missing or has an unsupported version".to_owned())?;
    let groups = folds
        .get("groups")
        .and_then(Value::as_object)
        .ok_or_else(|| "Fold root is missing or has an unsupported version".to_owned())?;
    if !groups.contains_key(root) {
        return Err("Fold root is missing or has an unsupported version".into());
    }
    if groups.len() > 64 {
        return Err("Fold definition exceeds group limit".into());
    }
    let group_ids: BTreeSet<String> = groups.keys().cloned().collect();
    for group_id in &group_ids {
        if base.nodes.contains_key(group_id)
            || base.nodes.contains_key(&format!("fold:{group_id}"))
        {
            return Err(format!("Fold group conflicts with Node ID: {group_id}"));
        }
    }
    // DFS with cycle/duplicate/coverage checks (fold-depth.ts).
    let mut visiting = BTreeSet::new();
    let mut reached_groups = BTreeSet::new();
    let mut reached_leaves = BTreeSet::new();
    let mut group_leaves: BTreeMap<String, Vec<String>> = BTreeMap::new();
    #[allow(clippy::too_many_arguments)]
    fn collect(
        group_id: &str,
        groups: &Map<String, Value>,
        group_ids: &BTreeSet<String>,
        base: &View,
        visiting: &mut BTreeSet<String>,
        reached_groups: &mut BTreeSet<String>,
        reached_leaves: &mut BTreeSet<String>,
        group_leaves: &mut BTreeMap<String, Vec<String>>,
    ) -> Result<Vec<String>, String> {
        if visiting.contains(group_id) {
            return Err(format!("Fold cycle detected: {group_id}"));
        }
        if reached_groups.contains(group_id) {
            return Err(format!("Duplicate fold group: {group_id}"));
        }
        visiting.insert(group_id.to_owned());
        reached_groups.insert(group_id.to_owned());
        let children = groups
            .get(group_id)
            .and_then(|g| g.get("children"))
            .and_then(Value::as_array)
            .ok_or_else(|| format!("Fold children must be an array: {group_id}"))?;
        if children.len() > 5000 {
            return Err("Fold group exceeds child limit".into());
        }
        let mut leaves = Vec::new();
        for child in children {
            let child = child
                .as_str()
                .ok_or_else(|| format!("Fold children must be an array: {group_id}"))?;
            if group_ids.contains(child) {
                leaves.extend(collect(
                    child,
                    groups,
                    group_ids,
                    base,
                    visiting,
                    reached_groups,
                    reached_leaves,
                    group_leaves,
                )?);
            } else {
                if !base.nodes.contains_key(child) {
                    return Err(format!("Unknown fold leaf: {child}"));
                }
                if !reached_leaves.insert(child.to_owned()) {
                    return Err(format!("Duplicate fold leaf: {child}"));
                }
                leaves.push(child.to_owned());
            }
        }
        visiting.remove(group_id);
        group_leaves.insert(group_id.to_owned(), leaves.clone());
        Ok(leaves)
    }
    collect(
        root,
        groups,
        &group_ids,
        base,
        &mut visiting,
        &mut reached_groups,
        &mut reached_leaves,
        &mut group_leaves,
    )?;
    if reached_groups.len() != group_ids.len() || reached_leaves.len() != base.nodes.len() {
        return Err("Fold coverage must include every group and Node exactly once".into());
    }
    let mut nodes: BTreeMap<String, ViewNode> = BTreeMap::new();
    let mut base_map: BTreeMap<String, String> = BTreeMap::new();
    let mut expanded = Vec::new();
    fn add_node(
        id: String,
        sources: &[String],
        aggregate: bool,
        base: &View,
        nodes: &mut BTreeMap<String, ViewNode>,
        base_map: &mut BTreeMap<String, String>,
    ) {
        let mut ordered: Vec<String> = sources.to_vec();
        ordered.sort();
        let mut states = Vec::new();
        let mut changes = Vec::new();
        let mut infos = Vec::new();
        let mut effects = Vec::new();
        for source in &ordered {
            if let Some(member) = base.nodes.get(source) {
                states.extend(member.states.clone());
                changes.extend(member.changes.clone());
                infos.extend(member.infos.clone());
                effects.extend(member.effects.clone());
            }
        }
        for list in [&mut states, &mut changes, &mut infos, &mut effects] {
            list.sort_by(|a: &Value, b: &Value| {
                a.get("address")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .cmp(b.get("address").and_then(Value::as_str).unwrap_or(""))
            });
        }
        let name = if aggregate {
            id.strip_prefix("fold:").unwrap_or(&id).to_owned()
        } else {
            base.nodes
                .get(&ordered[0])
                .map(|n| n.name.clone())
                .unwrap_or_else(|| ordered[0].clone())
        };
        nodes.insert(
            id.clone(),
            ViewNode {
                id: id.clone(),
                name,
                aggregate,
                sources: ordered.clone(),
                states,
                changes,
                infos,
                effects,
            },
        );
        for source in ordered {
            base_map.insert(source, id.clone());
        }
    }
    #[allow(clippy::too_many_arguments)]
    fn expand(
        group_id: &str,
        depth: usize,
        fold_depth: usize,
        groups: &Map<String, Value>,
        group_ids: &BTreeSet<String>,
        group_leaves: &BTreeMap<String, Vec<String>>,
        base: &View,
        nodes: &mut BTreeMap<String, ViewNode>,
        base_map: &mut BTreeMap<String, String>,
        expanded: &mut Vec<String>,
    ) {
        if depth >= fold_depth {
            add_node(
                format!("fold:{group_id}"),
                &group_leaves[group_id],
                true,
                base,
                nodes,
                base_map,
            );
            return;
        }
        expanded.push(group_id.to_owned());
        for child in groups[group_id]
            .get("children")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
        {
            let child = child.as_str().unwrap_or("").to_owned();
            if group_ids.contains(&child) {
                expand(
                    &child,
                    depth + 1,
                    fold_depth,
                    groups,
                    group_ids,
                    group_leaves,
                    base,
                    nodes,
                    base_map,
                    expanded,
                );
            } else {
                add_node(child.clone(), &[child], false, base, nodes, base_map);
            }
        }
    }
    expand(
        root,
        0,
        fold_depth,
        groups,
        &group_ids,
        &group_leaves,
        base,
        &mut nodes,
        &mut base_map,
        &mut expanded,
    );
    let mut merged: BTreeMap<String, Route> = BTreeMap::new();
    for source in &base.routes {
        let from = base_map.get(&source.from).cloned().ok_or_else(|| {
            format!("Fold route has an unmapped Node: {}", source.id)
        })?;
        let to = base_map.get(&source.to).cloned().ok_or_else(|| {
            format!("Fold route has an unmapped Node: {}", source.id)
        })?;
        let id = format!("route:{from}->{to}:{}", source.info_type);
        let entry = merged.entry(id.clone()).or_insert(Route {
            id,
            from,
            to,
            info_type: source.info_type.clone(),
            route_count: 0,
            internal: false,
            witnesses: Vec::new(),
        });
        entry.route_count += source.route_count;
        entry.witnesses.extend(source.witnesses.clone());
    }
    let mut routes: Vec<Route> = merged.into_values().collect();
    for route in &mut routes {
        route.internal = route.from == route.to;
    }
    routes.sort_by(|a, b| {
        a.from
            .cmp(&b.from)
            .then(a.to.cmp(&b.to))
            .then(a.info_type.cmp(&b.info_type))
    });
    Ok(View {
        id: format!("fold-depth:{fold_depth}"),
        kind: "configured".to_owned(),
        root: root.to_owned(),
        expanded,
        nodes,
        routes,
        base_map,
    })
}

//! Entity, expansion, path, subg raph and validation queries.
//! Mirrors `sdk/analysis/query.ts`, `path.ts`, `shortest-path.ts`,
//! `select.ts`, `validate-index.ts`.

use std::collections::{BTreeMap, BTreeSet, VecDeque};

use serde_json::{json, Value};

use crate::model::{edge_to_json, entity_to_json, Index};

const CAUSAL_TYPES: [&str; 6] = ["inject", "trigger", "send", "write", "read-by", "project"];

pub fn query_entity(index: &Index, address: &str) -> Result<Option<Value>, String> {
    if let Some(entity) = index.entities.get(address) {
        return Ok(Some(entity_to_json(entity)));
    }
    if !address.starts_with("info:") || address.contains('@') {
        return Ok(None);
    }
    let id = &address["info:".len()..];
    let mut candidates: Vec<&str> = index
        .entities
        .iter()
        .filter(|(_, e)| e.kind == "info" && e.id == id)
        .map(|(addr, _)| addr.as_str())
        .collect();
    candidates.sort_unstable();
    if candidates.len() > 1 {
        return Err(format!(
            "Ambiguous Info address {address}; use one of: {}",
            candidates.join(", ")
        ));
    }
    Ok(candidates
        .first()
        .and_then(|addr| index.entities.get(*addr))
        .map(entity_to_json))
}

fn resolved_address(index: &Index, address: &str) -> Option<String> {
    if index.entities.contains_key(address) {
        return Some(address.to_owned());
    }
    if !address.starts_with("info:") || address.contains('@') {
        return None;
    }
    let id = &address["info:".len()..];
    let mut candidates: Vec<&str> = index
        .entities
        .iter()
        .filter(|(_, e)| e.kind == "info" && e.id == id)
        .map(|(addr, _)| addr.as_str())
        .collect();
    candidates.sort_unstable();
    if candidates.len() == 1 {
        return Some(candidates[0].to_owned());
    }
    None
}

pub fn expand_entity(index: &Index, address: &str) -> Result<Option<Value>, String> {
    let target = match query_entity(index, address)? {
        Some(value) => value,
        None => return Ok(None),
    };
    let target_address = target
        .get("address")
        .and_then(Value::as_str)
        .unwrap_or(address)
        .to_owned();
    let target_kind = target
        .get("kind")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_owned();
    if target_kind == "node" {
        let node_id = target.get("id").and_then(Value::as_str).unwrap_or("");
        let selected = select_subgraph(index, &[node_id.to_owned()])?;
        let inbound: Vec<Value> = selected["boundaryIn"]
            .as_array()
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .map(|edge| {
                let from = edge.get("from").and_then(Value::as_str).unwrap_or("");
                json!({"edge": edge, "entity": index.entities.get(from).map(entity_to_json).unwrap_or(Value::Null)})
            })
            .collect();
        let outbound: Vec<Value> = selected["boundaryOut"]
            .as_array()
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .map(|edge| {
                let to = edge.get("to").and_then(Value::as_str).unwrap_or("");
                json!({"edge": edge, "entity": index.entities.get(to).map(entity_to_json).unwrap_or(Value::Null)})
            })
            .collect();
        return Ok(Some(
            json!({"target": target, "inbound": inbound, "outbound": outbound}),
        ));
    }
    let mut inbound = Vec::new();
    let mut outbound = Vec::new();
    for edge in &index.edges {
        if edge.to == target_address {
            if let Some(entity) = index.entities.get(&edge.from) {
                inbound.push(json!({"edge": edge_to_json(edge), "entity": entity_to_json(entity)}));
            }
        }
        if edge.from == target_address {
            if let Some(entity) = index.entities.get(&edge.to) {
                outbound
                    .push(json!({"edge": edge_to_json(edge), "entity": entity_to_json(entity)}));
            }
        }
    }
    Ok(Some(
        json!({"target": target, "inbound": inbound, "outbound": outbound}),
    ))
}

fn bfs_distances(
    origins: &[String],
    adjacency: &BTreeMap<String, Vec<String>>,
) -> BTreeMap<String, usize> {
    let mut dist = BTreeMap::new();
    let mut queue = VecDeque::new();
    for origin in origins {
        if !dist.contains_key(origin) {
            dist.insert(origin.clone(), 0);
            queue.push_back(origin.clone());
        }
    }
    while let Some(current) = queue.pop_front() {
        let depth = dist[&current];
        if let Some(nexts) = adjacency.get(&current) {
            for next in nexts {
                if !dist.contains_key(next) {
                    dist.insert(next.clone(), depth + 1);
                    queue.push_back(next.clone());
                }
            }
        }
    }
    dist
}

#[allow(clippy::type_complexity)]
#[allow(clippy::too_many_lines)]
fn shortest_paths(
    edges: Vec<&crate::model::Edge>,
    starts: &[String],
    targets: &[String],
    max_paths: usize,
    max_depth: usize,
) -> (Vec<(Vec<String>, Vec<Value>)>, Value) {
    let mut sorted: Vec<&&crate::model::Edge> = edges.iter().collect();
    sorted.sort_by(|a, b| {
        a.from
            .cmp(&b.from)
            .then(a.to.cmp(&b.to))
            .then(a.id.cmp(&b.id))
    });
    let mut adjacency: BTreeMap<String, Vec<*const crate::model::Edge>> = BTreeMap::new();
    let mut reverse: BTreeMap<String, Vec<String>> = BTreeMap::new();
    let mut undirected: BTreeMap<String, Vec<String>> = BTreeMap::new();
    let mut seen = BTreeSet::new();
    // SAFETY-adjacent: store indexes instead of raw pointers for clarity.
    let mut adjacency_idx: BTreeMap<String, Vec<usize>> = BTreeMap::new();
    let mut edge_list: Vec<&crate::model::Edge> = Vec::new();
    for edge in sorted {
        let key = format!("{}\0{}\0{}", edge.from, edge.to, edge.id);
        if !seen.insert(key) {
            continue;
        }
        let idx = edge_list.len();
        edge_list.push(edge);
        adjacency_idx
            .entry(edge.from.clone())
            .or_default()
            .push(idx);
        reverse
            .entry(edge.to.clone())
            .or_default()
            .push(edge.from.clone());
        undirected
            .entry(edge.from.clone())
            .or_default()
            .push(edge.to.clone());
        undirected
            .entry(edge.to.clone())
            .or_default()
            .push(edge.from.clone());
        let _ = adjacency.entry(edge.from.clone()).or_default();
    }
    let start_set: BTreeSet<String> = starts.iter().cloned().collect();
    let mut starts_sorted: Vec<String> = start_set.iter().cloned().collect();
    starts_sorted.sort();
    let mut depth: BTreeMap<String, usize> = BTreeMap::new();
    let mut queue: Vec<String> = Vec::new();
    for start in &starts_sorted {
        depth.insert(start.clone(), 0);
        queue.push(start.clone());
    }
    let mut predecessors: BTreeMap<String, Vec<usize>> = BTreeMap::new();
    let mut head = 0;
    while head < queue.len() {
        let current = queue[head].clone();
        head += 1;
        let next_depth = depth[&current] + 1;
        if let Some(idxs) = adjacency_idx.get(&current) {
            for &idx in idxs {
                let edge = edge_list[idx];
                if !depth.contains_key(&edge.to) {
                    depth.insert(edge.to.clone(), next_depth);
                    queue.push(edge.to.clone());
                }
                if depth[&edge.to] == next_depth {
                    predecessors.entry(edge.to.clone()).or_default().push(idx);
                }
            }
        }
    }
    let mut target_depths = Vec::new();
    for target in targets {
        if let Some(d) = depth.get(target) {
            target_depths.push(*d);
        }
    }
    let shortest: Option<usize> = target_depths.into_iter().min();
    let status = match shortest {
        None => "unreachable",
        Some(d) if d > max_depth => "depth-limited",
        Some(_) => "found",
    };
    if status != "found" {
        let candidates: Vec<String> = if status == "depth-limited" {
            let to_target = bfs_distances(targets, &reverse);
            let shortest = shortest.unwrap_or(usize::MAX);
            queue
                .iter()
                .filter(|id| {
                    depth.get(*id) == Some(&max_depth)
                        && depth.get(*id).unwrap_or(&usize::MAX)
                            + to_target.get(*id).unwrap_or(&usize::MAX)
                            == shortest
                })
                .cloned()
                .collect()
        } else {
            let proximity = bfs_distances(targets, &undirected);
            let mut nearest = usize::MAX;
            for id in &queue {
                nearest = nearest.min(proximity.get(id).copied().unwrap_or(usize::MAX));
            }
            let mut list: Vec<String> = queue
                .iter()
                .filter(|id| proximity.get(*id).copied().unwrap_or(usize::MAX) == nearest)
                .cloned()
                .collect();
            if nearest == usize::MAX && !list.is_empty() {
                let furthest = depth.get(&queue[queue.len() - 1]).copied().unwrap_or(0);
                list.retain(|id| depth.get(id).copied().unwrap_or(0) == furthest);
            }
            list
        };
        let mut frontier: Vec<Value> = candidates
            .into_iter()
            .map(|address| {
                json!({"address": address, "distance": depth.get(&address).copied().unwrap_or(0)})
            })
            .collect();
        frontier.sort_by(|a, b| {
            let da = a.get("distance").and_then(Value::as_u64).unwrap_or(0);
            let db = b.get("distance").and_then(Value::as_u64).unwrap_or(0);
            db.cmp(&da).then(
                a.get("address")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .cmp(b.get("address").and_then(Value::as_str).unwrap_or("")),
            )
        });
        return (
            Vec::new(),
            json!({"status": status, "shortestDistance": shortest, "truncated": false, "frontier": frontier}),
        );
    }
    let shortest = shortest.unwrap_or(0);
    let mut paths = Vec::new();
    let mut truncated = false;
    let mut unique_targets: Vec<String> = targets
        .iter()
        .cloned()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    unique_targets.sort();
    'outer: for target in unique_targets {
        if depth.get(&target).copied() != Some(shortest) {
            continue;
        }
        let mut stack: Vec<(String, usize)> = vec![(target.clone(), 0)];
        let mut path_edges: Vec<usize> = Vec::new();
        while let Some((vertex, _)) = stack.last().cloned() {
            let parents = predecessors.get(&vertex).cloned().unwrap_or_default();
            let frame_next = stack.last().map(|(_, n)| *n).unwrap_or(0);
            if start_set.contains(&vertex) {
                if paths.len() == max_paths {
                    truncated = true;
                    break 'outer;
                }
                let vertices: Vec<String> = stack.iter().map(|(v, _)| v.clone()).rev().collect();
                let edges: Vec<Value> = path_edges
                    .iter()
                    .rev()
                    .map(|&i| edge_to_json(edge_list[i]))
                    .collect();
                paths.push((vertices, edges));
                stack.pop();
                path_edges.pop();
            } else if frame_next < parents.len() {
                let edge_idx = parents[frame_next];
                stack.last_mut().unwrap().1 += 1;
                path_edges.push(edge_idx);
                stack.push((edge_list[edge_idx].from.clone(), 0));
            } else {
                stack.pop();
                path_edges.pop();
            }
        }
    }
    (
        paths,
        json!({"status": "found", "shortestDistance": shortest, "truncated": truncated, "frontier": []}),
    )
}

pub fn find_paths(
    index: &Index,
    from_address: &str,
    to_address: &str,
    max_depth: Option<usize>,
    max_paths: Option<usize>,
) -> Result<Value, String> {
    let from = resolved_address(index, from_address)
        .ok_or_else(|| format!("Entity not found: {from_address}"))?;
    let to = resolved_address(index, to_address)
        .ok_or_else(|| format!("Entity not found: {to_address}"))?;
    let from_entity = index.entities.get(&from).unwrap();
    let to_entity = index.entities.get(&to).unwrap();
    let endpoints = |entity: &crate::model::Entity| -> Vec<String> {
        if entity.kind == "node" {
            let mut list: Vec<String> = index
                .entities
                .values()
                .filter(|candidate| {
                    candidate.node_id.as_deref() == Some(entity.id.as_str())
                        && (candidate.kind == "change" || candidate.kind == "state")
                })
                .map(|candidate| candidate.address.clone())
                .collect();
            list.sort();
            if list.is_empty() {
                vec![entity.address.clone()]
            } else {
                list
            }
        } else {
            vec![entity.address.clone()]
        }
    };
    let starts = endpoints(from_entity);
    let targets = endpoints(to_entity);
    let causal: Vec<&crate::model::Edge> = index
        .edges
        .iter()
        .filter(|edge| {
            CAUSAL_TYPES.contains(&edge.edge_type.as_str())
                && index.entities.contains_key(&edge.from)
                && index.entities.contains_key(&edge.to)
        })
        .collect();
    let max_depth = max_depth.unwrap_or(15);
    let max_paths = max_paths.unwrap_or(50);
    if max_paths < 1 {
        return Err("maxPaths must be a positive safe integer".into());
    }
    let (paths, diagnostics) = shortest_paths(causal, &starts, &targets, max_paths, max_depth);
    let rendered: Vec<Value> = paths
        .into_iter()
        .map(|(vertices, edges)| {
            let steps: Vec<Value> = vertices
                .iter()
                .map(|address| {
                    index
                        .entities
                        .get(address)
                        .map(entity_to_json)
                        .unwrap_or(Value::Null)
                })
                .collect();
            json!({"steps": steps, "edges": edges, "length": edges_len(&vertices)})
        })
        .collect();
    Ok(json!({"from": from, "to": to, "paths": rendered, "diagnostics": diagnostics}))
}

fn edges_len(vertices: &[String]) -> usize {
    vertices.len().saturating_sub(1)
}

pub fn find_chain(
    index: &Index,
    addresses: &[String],
    max_depth: Option<usize>,
    max_paths: Option<usize>,
) -> Result<Value, String> {
    if addresses.len() < 2 {
        return Err("A path requires at least two addresses".into());
    }
    let mut waypoints = Vec::new();
    for address in addresses {
        let resolved = resolved_address(index, address)
            .ok_or_else(|| format!("Entity not found: {address}"))?;
        waypoints.push(resolved);
    }
    let mut segments = Vec::new();
    let mut connected = true;
    let mut failed = Vec::new();
    for position in 1..waypoints.len() {
        let from = waypoints[position - 1].clone();
        let to = waypoints[position].clone();
        let result = find_paths(index, &from, &to, max_depth, max_paths)?;
        let is_connected = result
            .get("diagnostics")
            .and_then(|d| d.get("status"))
            .and_then(Value::as_str)
            == Some("found");
        let (reverse_paths, reverse_diagnostics) = if is_connected {
            (Value::Array(vec![]), Value::Null)
        } else {
            match find_paths(index, &to, &from, max_depth, max_paths) {
                Ok(reverse) => (
                    reverse.get("paths").cloned().unwrap_or(Value::Null),
                    reverse.get("diagnostics").cloned().unwrap_or(Value::Null),
                ),
                Err(_) => (Value::Array(vec![]), Value::Null),
            }
        };
        if !is_connected {
            connected = false;
            failed.push(position - 1);
        }
        let mut segment = result.as_object().cloned().unwrap_or_default();
        segment.insert("connected".to_owned(), Value::Bool(is_connected));
        segment.insert("reversePaths".to_owned(), reverse_paths);
        segment.insert("reverseDiagnostics".to_owned(), reverse_diagnostics);
        segments.push(Value::Object(segment));
    }
    Ok(json!({"waypoints": waypoints, "connected": connected,
        "failedSegmentIndexes": failed, "segments": segments}))
}

pub fn select_subgraph(index: &Index, node_ids: &[String]) -> Result<Value, String> {
    let mut set = BTreeSet::new();
    for id in node_ids {
        set.insert(id.clone());
    }
    if set.is_empty() {
        return Err("Select at least one Node".into());
    }
    for id in &set {
        if !index.nodes.contains(id) {
            return Err(format!("Node not found: {id}"));
        }
    }
    let mut matched: Vec<Value> = Vec::new();
    let mut inside = BTreeSet::new();
    let mut ordered: Vec<&crate::model::Entity> = index.entities.values().collect();
    ordered.sort_by(|a, b| a.address.cmp(&b.address));
    for entity in ordered {
        let mut belongs = false;
        if entity.kind == "node" && set.contains(&entity.id) {
            belongs = true;
        }
        if let Some(owner) = &entity.node_id {
            if set.contains(owner) {
                belongs = true;
            }
        }
        if entity.kind == "info" {
            if let Some(target) = &entity.sub_id {
                if set.contains(target) {
                    belongs = true;
                }
            }
        }
        if belongs {
            inside.insert(entity.address.clone());
            matched.push(entity_to_json(entity));
        }
    }
    let mut inner = Vec::new();
    let mut boundary_in = Vec::new();
    let mut boundary_out = Vec::new();
    for edge in &index.edges {
        let from_inside = inside.contains(&edge.from);
        let to_inside = inside.contains(&edge.to);
        if from_inside && to_inside {
            inner.push(edge_to_json(edge));
        } else if to_inside {
            boundary_in.push(edge_to_json(edge));
        } else if from_inside {
            boundary_out.push(edge_to_json(edge));
        }
    }
    let sourced: BTreeSet<String> = index
        .edges
        .iter()
        .filter(|edge| edge.edge_type == "send" || edge.edge_type == "inject")
        .map(|edge| edge.to.clone())
        .collect();
    let root_infos: Vec<Value> = matched
        .iter()
        .filter(|entity| {
            entity.get("kind").and_then(Value::as_str) == Some("info")
                && !sourced.contains(entity.get("address").and_then(Value::as_str).unwrap_or(""))
        })
        .cloned()
        .collect();
    let entry_addresses: BTreeSet<String> = boundary_in
        .iter()
        .filter_map(|edge| edge.get("to").and_then(Value::as_str).map(str::to_owned))
        .chain(root_infos.iter().filter_map(|entity| {
            entity
                .get("address")
                .and_then(Value::as_str)
                .map(str::to_owned)
        }))
        .collect();
    let exit_addresses: BTreeSet<String> = boundary_out
        .iter()
        .filter_map(|edge| edge.get("from").and_then(Value::as_str).map(str::to_owned))
        .collect();
    let entry_points: Vec<Value> = matched
        .iter()
        .filter(|entity| {
            entry_addresses.contains(entity.get("address").and_then(Value::as_str).unwrap_or(""))
        })
        .cloned()
        .collect();
    let exit_points: Vec<Value> = matched
        .iter()
        .filter(|entity| {
            exit_addresses.contains(entity.get("address").and_then(Value::as_str).unwrap_or(""))
        })
        .cloned()
        .collect();
    let mut selected: Vec<String> = set.into_iter().collect();
    selected.sort();
    Ok(json!({
        "selectedNodeIds": selected, "entities": matched, "edges": inner,
        "boundaryIn": boundary_in, "boundaryOut": boundary_out,
        "rootInfos": root_infos, "entryPoints": entry_points, "exitPoints": exit_points,
    }))
}

pub fn validate_index(index: &Index, snapshots: &[Value]) -> Value {
    let mut issues = Vec::new();
    for snapshot in snapshots {
        for item in snapshot
            .get("unresolvedInfoTypes")
            .and_then(Value::as_array)
            .map(Vec::as_slice)
            .unwrap_or(&[])
        {
            issues.push(json!({"severity": "error", "code": "unresolved-info-type",
                "message": "Unresolved Info type expression",
                "entityAddress": item.get("sourceChange").and_then(Value::as_str)}));
        }
        for item in snapshot
            .get("unresolvedSendTargets")
            .and_then(Value::as_array)
            .map(Vec::as_slice)
            .unwrap_or(&[])
        {
            issues.push(
                json!({"severity": "error", "code": "unresolved-send-target",
                "message": "Unresolved send target expression",
                "entityAddress": item.get("sourceChange").and_then(Value::as_str)}),
            );
        }
    }
    for edge in &index.edges {
        if !index.entities.contains_key(&edge.from) {
            issues.push(json!({"severity": "error", "code": "dangling-edge",
                "message": format!("Edge {} has unknown source {}", edge.id, edge.from)}));
        }
        if !index.entities.contains_key(&edge.to) {
            issues.push(json!({"severity": "error", "code": "dangling-edge",
                "message": format!("Edge {} has unknown target {}", edge.id, edge.to)}));
        }
    }
    for link in &index.frontend_links {
        let target = link
            .pointer("/injection/targetNodeId")
            .and_then(Value::as_str)
            .unwrap_or("");
        let info_type = link
            .pointer("/injection/infoType")
            .and_then(Value::as_str)
            .unwrap_or("");
        if !index.nodes.contains(target) {
            issues.push(
                json!({"severity": "error", "code": "unknown-frontend-target",
                "message": format!("Frontend link targets unknown Node: {target}")}),
            );
        }
        let trigger = format!("change:{target}::{info_type}");
        if !index.entities.contains_key(&trigger) {
            issues.push(
                json!({"severity": "warning", "code": "missing-frontend-trigger",
                "message": format!("Frontend trigger has no change evidence: {trigger}"),
                "entityAddress": trigger}),
            );
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
                let state = format!("state:{owner}::{field}");
                if !index.entities.contains_key(&state) {
                    issues.push(
                        json!({"severity": "warning", "code": "missing-frontend-state",
                        "message": format!("Frontend projection has no state evidence: {state}"),
                        "entityAddress": state}),
                    );
                }
            }
        }
    }
    let valid = !issues
        .iter()
        .any(|issue| issue.get("severity").and_then(Value::as_str) == Some("error"));
    json!({"valid": valid, "issues": issues})
}

#[allow(dead_code)]
struct UnusedDirectedEdge {
    id: String,
    from: String,
    to: String,
}

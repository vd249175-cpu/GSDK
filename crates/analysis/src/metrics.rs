//! Structural metrics over a view or the granular entity graph.
//! Mirrors `sdk/analysis/health.ts`, `reachability.ts`, `centrality.ts`,
//! `community.ts`, `community-comparison.ts`, `weighted-graph.ts`.

use std::collections::{BTreeMap, BTreeSet, VecDeque};

use serde_json::{json, Value};

use crate::model::Index;
use crate::views::View;

#[derive(Debug, Clone)]
struct DirectedGraph {
    vertices: Vec<String>,
    edges: Vec<(String, String, f64)>,
    outbound: BTreeMap<String, BTreeMap<String, f64>>,
    inbound: BTreeMap<String, BTreeMap<String, f64>>,
}

fn build_directed(vertices: &[String], source: &[(String, String, f64)]) -> DirectedGraph {
    let mut ordered: Vec<String> = vertices
        .iter()
        .cloned()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    ordered.sort();
    let vertex_set: BTreeSet<&str> = ordered.iter().map(String::as_str).collect();
    let mut merged: BTreeMap<(String, String), f64> = BTreeMap::new();
    for (from, to, weight) in source {
        if !weight.is_finite() || *weight <= 0.0 {
            continue;
        }
        if !vertex_set.contains(from.as_str()) || !vertex_set.contains(to.as_str()) {
            continue;
        }
        *merged.entry((from.clone(), to.clone())).or_default() += weight;
    }
    let mut edges: Vec<(String, String, f64)> = merged
        .into_iter()
        .map(|((from, to), weight)| (from, to, weight))
        .collect();
    edges.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.cmp(&b.1)));
    let mut outbound: BTreeMap<String, BTreeMap<String, f64>> = BTreeMap::new();
    let mut inbound: BTreeMap<String, BTreeMap<String, f64>> = BTreeMap::new();
    for vertex in &ordered {
        outbound.insert(vertex.clone(), BTreeMap::new());
        inbound.insert(vertex.clone(), BTreeMap::new());
    }
    for (from, to, weight) in &edges {
        outbound.get_mut(from).unwrap().insert(to.clone(), *weight);
        inbound.get_mut(to).unwrap().insert(from.clone(), *weight);
    }
    DirectedGraph {
        vertices: ordered,
        edges,
        outbound,
        inbound,
    }
}

fn weakly_connected(graph: &DirectedGraph) -> Vec<Vec<String>> {
    let mut visited = BTreeSet::new();
    let mut components = Vec::new();
    for start in &graph.vertices {
        if visited.contains(start) {
            continue;
        }
        let mut members = Vec::new();
        let mut queue = VecDeque::from([start.clone()]);
        visited.insert(start.clone());
        while let Some(current) = queue.pop_front() {
            members.push(current.clone());
            let mut neighbors = BTreeSet::new();
            for key in graph.outbound[&current].keys() {
                neighbors.insert(key.clone());
            }
            for key in graph.inbound[&current].keys() {
                neighbors.insert(key.clone());
            }
            for neighbor in neighbors {
                if visited.insert(neighbor.clone()) {
                    queue.push_back(neighbor);
                }
            }
        }
        members.sort();
        components.push(members);
    }
    components
        .sort_by(|a: &Vec<String>, b: &Vec<String>| b.len().cmp(&a.len()).then(a[0].cmp(&b[0])));
    components
}

fn strongly_connected(view: &View) -> Vec<Vec<String>> {
    let mut adjacency: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    for node in view.nodes.keys() {
        adjacency.insert(node.clone(), BTreeSet::new());
    }
    for route in &view.routes {
        if !route.internal {
            adjacency
                .get_mut(&route.from)
                .unwrap()
                .insert(route.to.clone());
        }
    }
    let mut index_counter = 0usize;
    let mut indices: BTreeMap<String, usize> = BTreeMap::new();
    let mut low: BTreeMap<String, usize> = BTreeMap::new();
    let mut stack: Vec<String> = Vec::new();
    let mut on_stack = BTreeSet::new();
    let mut components: Vec<Vec<String>> = Vec::new();
    #[allow(clippy::too_many_arguments)]
    fn visit(
        node: &str,
        adjacency: &BTreeMap<String, BTreeSet<String>>,
        index_counter: &mut usize,
        indices: &mut BTreeMap<String, usize>,
        low: &mut BTreeMap<String, usize>,
        stack: &mut Vec<String>,
        on_stack: &mut BTreeSet<String>,
        components: &mut Vec<Vec<String>>,
    ) {
        indices.insert(node.to_owned(), *index_counter);
        low.insert(node.to_owned(), *index_counter);
        *index_counter += 1;
        stack.push(node.to_owned());
        on_stack.insert(node.to_owned());
        if let Some(neighbors) = adjacency.get(node) {
            for next in neighbors {
                if !indices.contains_key(next) {
                    visit(
                        next,
                        adjacency,
                        index_counter,
                        indices,
                        low,
                        stack,
                        on_stack,
                        components,
                    );
                    let next_low = low[next];
                    let node_low = low[node];
                    low.insert(node.to_owned(), node_low.min(next_low));
                } else if on_stack.contains(next) {
                    let next_index = indices[next];
                    let node_low = low[node];
                    low.insert(node.to_owned(), node_low.min(next_index));
                }
            }
        }
        if low[node] == indices[node] {
            let mut component = Vec::new();
            while let Some(top) = stack.pop() {
                on_stack.remove(&top);
                component.push(top.clone());
                if top == node {
                    break;
                }
            }
            component.sort();
            // Parity with health.ts: only multi-Node cycles are components.
            if component.len() > 1 {
                components.push(component);
            }
        }
    }
    let mut ordered: Vec<String> = view.nodes.keys().cloned().collect();
    ordered.sort();
    for node in ordered {
        if !indices.contains_key(&node) {
            visit(
                &node,
                &adjacency,
                &mut index_counter,
                &mut indices,
                &mut low,
                &mut stack,
                &mut on_stack,
                &mut components,
            );
        }
    }
    // Parity with health.ts: singletons dropped, survivors sorted by size.
    components.sort_by(|a, b| b.len().cmp(&a.len()).then(a[0].cmp(&b[0])));
    components
}

pub fn analyze_health(view: &View) -> Value {
    let external: Vec<&crate::views::Route> = view.routes.iter().filter(|r| !r.internal).collect();
    let internal: Vec<&crate::views::Route> = view.routes.iter().filter(|r| r.internal).collect();
    let node_count = view.nodes.len();
    let possible = if node_count > 1 {
        node_count * (node_count - 1)
    } else {
        0
    };
    let neighbor_pairs: BTreeSet<String> = external
        .iter()
        .map(|r| format!("{}->{}", r.from, r.to))
        .collect();
    let total_volume: f64 = view.routes.iter().map(|r| r.route_count as f64 * 2.0).sum();
    let scc = strongly_connected(view);
    let mut cyclic: Vec<String> = scc.concat();
    cyclic.sort();
    cyclic.dedup();
    let cyclic_set: BTreeSet<String> = cyclic.iter().cloned().collect();
    let vertices: Vec<String> = view.nodes.keys().cloned().collect();
    let directed = build_directed(
        &vertices,
        &external
            .iter()
            .map(|r| (r.from.clone(), r.to.clone(), r.route_count as f64))
            .collect::<Vec<_>>(),
    );
    let directed_pairs: BTreeSet<String> = external
        .iter()
        .map(|r| format!("{}\0{}", r.from, r.to))
        .collect();
    let mut unordered = BTreeSet::new();
    let mut reciprocal = 0usize;
    for route in &external {
        let key = if route.from < route.to {
            format!("{}\0{}", route.from, route.to)
        } else {
            format!("{}\0{}", route.to, route.from)
        };
        if route.from == route.to {
            continue;
        }
        if !unordered.insert(key.clone()) {
            continue;
        }
        let (a, b) = (&route.from, &route.to);
        if directed_pairs.contains(&format!("{a}\0{b}"))
            && directed_pairs.contains(&format!("{b}\0{a}"))
        {
            reciprocal += 1;
        }
    }
    let _ = unordered.len();
    let mut nodes: Vec<Value> = view
        .nodes
        .values()
        .map(|node| {
            let internal_sum: u64 = view
                .routes
                .iter()
                .filter(|r| r.internal && r.from == node.id)
                .map(|r| r.route_count)
                .sum();
            let inbound_sum: u64 = view
                .routes
                .iter()
                .filter(|r| !r.internal && r.to == node.id)
                .map(|r| r.route_count)
                .sum();
            let outbound_sum: u64 = view
                .routes
                .iter()
                .filter(|r| !r.internal && r.from == node.id)
                .map(|r| r.route_count)
                .sum();
            let total = internal_sum + inbound_sum + outbound_sum;
            let inbound_neighbors: usize = view
                .routes
                .iter()
                .filter(|r| !r.internal && r.to == node.id)
                .map(|r| &r.from)
                .collect::<BTreeSet<_>>()
                .len();
            let outbound_neighbors: usize = view
                .routes
                .iter()
                .filter(|r| !r.internal && r.from == node.id)
                .map(|r| &r.to)
                .collect::<BTreeSet<_>>()
                .len();
            let coupling = inbound_neighbors + outbound_neighbors;
            let volume = internal_sum * 2 + inbound_sum + outbound_sum;
            let denom = (volume as f64).min(total_volume - volume as f64);
            json!({
                "nodeId": node.id, "sourceNodeCount": node.sources.len(),
                "internalRoutes": internal_sum, "inboundRoutes": inbound_sum,
                "outboundRoutes": outbound_sum,
                "inboundNeighbors": inbound_neighbors, "outboundNeighbors": outbound_neighbors,
                "afferentCoupling": inbound_neighbors, "efferentCoupling": outbound_neighbors,
                "instability": if coupling == 0 { 0.0 } else { outbound_neighbors as f64 / coupling as f64 },
                "conductance": if denom <= 0.0 { 0.0 } else { (inbound_sum + outbound_sum) as f64 / denom },
                "boundaryRatio": if total == 0 { 0.0 } else { (inbound_sum + outbound_sum) as f64 / total as f64 },
                "cohesion": if total == 0 { 0.0 } else { internal_sum as f64 / total as f64 },
                "directionalBalance": if inbound_sum + outbound_sum == 0 { 1.0 } else {
                    1.0 - ((inbound_sum as i64 - outbound_sum as i64).abs() as f64 / (inbound_sum + outbound_sum) as f64)
                },
                "cycleMember": cyclic_set.contains(&node.id),
            })
        })
        .collect();
    nodes.sort_by(|a, b| {
        let ab = a.get("inboundRoutes").and_then(Value::as_u64).unwrap_or(0)
            + a.get("outboundRoutes").and_then(Value::as_u64).unwrap_or(0);
        let bb = b.get("inboundRoutes").and_then(Value::as_u64).unwrap_or(0)
            + b.get("outboundRoutes").and_then(Value::as_u64).unwrap_or(0);
        bb.cmp(&ab).then(
            a.get("nodeId")
                .and_then(Value::as_str)
                .unwrap_or("")
                .cmp(b.get("nodeId").and_then(Value::as_str).unwrap_or("")),
        )
    });
    let unordered_size = {
        let mut set = BTreeSet::new();
        for route in &external {
            if route.from == route.to {
                continue;
            }
            let key = if route.from < route.to {
                format!("{}\0{}", route.from, route.to)
            } else {
                format!("{}\0{}", route.to, route.from)
            };
            set.insert(key);
        }
        set.len()
    };
    json!({
        "viewId": view.id, "nodeCount": node_count,
        "routeCount": view.routes.iter().map(|r| r.route_count).sum::<u64>(),
        "internalRouteCount": internal.iter().map(|r| r.route_count).sum::<u64>(),
        "externalRouteCount": external.iter().map(|r| r.route_count).sum::<u64>(),
        "density": if possible == 0 { 0.0 } else { neighbor_pairs.len() as f64 / possible as f64 },
        "reciprocity": if unordered_size == 0 { 0.0 } else { reciprocal as f64 / unordered_size as f64 },
        "isolatedNodeIds": nodes.iter().filter(|n|
            n.get("internalRoutes").and_then(Value::as_u64).unwrap_or(0)
            + n.get("inboundRoutes").and_then(Value::as_u64).unwrap_or(0)
            + n.get("outboundRoutes").and_then(Value::as_u64).unwrap_or(0) == 0)
            .map(|n| n.get("nodeId").cloned().unwrap_or(Value::Null)).collect::<Vec<_>>(),
        "sourceNodeIds": directed.vertices.iter().filter(|v|
            directed.inbound[*v].is_empty() && !directed.outbound[*v].is_empty()).cloned().collect::<Vec<_>>(),
        "sinkNodeIds": directed.vertices.iter().filter(|v|
            directed.outbound[*v].is_empty() && !directed.inbound[*v].is_empty()).cloned().collect::<Vec<_>>(),
        "weaklyConnectedComponents": weakly_connected(&directed),
        "cyclicNodeIds": cyclic, "stronglyConnectedComponents": scc, "nodes": nodes,
    })
}

fn bfs_distances(
    origin: &str,
    adjacency: &BTreeMap<String, BTreeSet<String>>,
) -> BTreeMap<String, usize> {
    let mut dist = BTreeMap::from([(origin.to_owned(), 0)]);
    let mut queue = VecDeque::from([origin.to_owned()]);
    while let Some(current) = queue.pop_front() {
        let depth = dist[&current];
        let mut neighbors: Vec<String> = adjacency
            .get(&current)
            .map(|s| s.iter().cloned().collect())
            .unwrap_or_default();
        neighbors.sort();
        for target in neighbors {
            if !dist.contains_key(&target) {
                dist.insert(target.clone(), depth + 1);
                queue.push_back(target);
            }
        }
    }
    dist.remove(origin);
    dist
}

pub fn analyze_reach(view: &View, origin: &str) -> Result<Value, String> {
    if !view.nodes.contains_key(origin) {
        return Err(format!("Node not found in view {}: {origin}", view.id));
    }
    let mut outbound: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    let mut inbound: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    for node in view.nodes.keys() {
        outbound.insert(node.clone(), BTreeSet::new());
        inbound.insert(node.clone(), BTreeSet::new());
    }
    for route in &view.routes {
        if route.internal {
            continue;
        }
        outbound
            .get_mut(&route.from)
            .unwrap()
            .insert(route.to.clone());
        inbound
            .get_mut(&route.to)
            .unwrap()
            .insert(route.from.clone());
    }
    let upstream = bfs_distances(origin, &inbound);
    let downstream = bfs_distances(origin, &outbound);
    let sort = |entries: BTreeMap<String, usize>| -> Vec<Value> {
        let mut list: Vec<Value> = entries
            .into_iter()
            .map(|(node_id, distance)| json!({"nodeId": node_id, "distance": distance}))
            .collect();
        list.sort_by(|a, b| {
            let da = a.get("distance").and_then(Value::as_u64).unwrap_or(0);
            let db = b.get("distance").and_then(Value::as_u64).unwrap_or(0);
            da.cmp(&db).then(
                a.get("nodeId")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .cmp(b.get("nodeId").and_then(Value::as_str).unwrap_or("")),
            )
        });
        list
    };
    let mut unreachable: Vec<String> = view
        .nodes
        .keys()
        .filter(|id| *id != origin && !upstream.contains_key(*id) && !downstream.contains_key(*id))
        .cloned()
        .collect();
    unreachable.sort();
    Ok(json!({
        "viewId": view.id, "originNodeId": origin,
        "upstream": sort(upstream), "downstream": sort(downstream),
        "unreachableNodeIds": unreachable,
    }))
}

fn core_numbers(
    vertices: &[String],
    outbound: &BTreeMap<String, BTreeMap<String, f64>>,
    inbound: &BTreeMap<String, BTreeMap<String, f64>>,
) -> BTreeMap<String, u64> {
    let mut adjacency: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    for vertex in vertices {
        let mut set = BTreeSet::new();
        for key in outbound[vertex].keys().chain(inbound[vertex].keys()) {
            if key != vertex {
                set.insert(key.clone());
            }
        }
        adjacency.insert(vertex.clone(), set);
    }
    let mut degrees: BTreeMap<String, usize> = adjacency
        .iter()
        .map(|(k, v)| (k.clone(), v.len()))
        .collect();
    // Sorted worklist with lazy deletion, tie-break by node id (mirrors TS).
    let mut heap: Vec<(usize, String)> = vertices.iter().map(|v| (degrees[v], v.clone())).collect();
    heap.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.cmp(&b.1)));
    let mut removed = BTreeSet::new();
    let mut result = BTreeMap::new();
    while !heap.is_empty() {
        heap.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.cmp(&b.1)));
        let (degree, node) = heap.remove(0);
        if removed.contains(&node) || degrees[&node] != degree {
            continue;
        }
        removed.insert(node.clone());
        result.insert(node.clone(), degree as u64);
        for neighbor in adjacency[&node].clone() {
            if removed.contains(&neighbor) || degrees[&neighbor] <= degree {
                continue;
            }
            degrees.insert(neighbor.clone(), degrees[&neighbor] - 1);
            heap.push((degrees[&neighbor], neighbor));
        }
    }
    result
}

fn articulation_and_bridges(graph: &DirectedGraph) -> (Vec<String>, Vec<Value>) {
    let mut adjacency: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    for vertex in &graph.vertices {
        adjacency.insert(vertex.clone(), BTreeSet::new());
    }
    for (from, to, _) in &graph.edges {
        if from == to {
            continue;
        }
        adjacency.get_mut(from).unwrap().insert(to.clone());
        adjacency.get_mut(to).unwrap().insert(from.clone());
    }
    let mut time = 0usize;
    let mut discovery: BTreeMap<String, usize> = BTreeMap::new();
    let mut low: BTreeMap<String, usize> = BTreeMap::new();
    let mut parent: BTreeMap<String, Option<String>> = BTreeMap::new();
    let mut articulation = BTreeSet::new();
    let mut bridges = BTreeSet::new();
    #[allow(clippy::too_many_arguments)]
    fn visit(
        vertex: &str,
        adjacency: &BTreeMap<String, BTreeSet<String>>,
        time: &mut usize,
        discovery: &mut BTreeMap<String, usize>,
        low: &mut BTreeMap<String, usize>,
        parent: &mut BTreeMap<String, Option<String>>,
        articulation: &mut BTreeSet<String>,
        bridges: &mut BTreeSet<(String, String)>,
    ) {
        discovery.insert(vertex.to_owned(), *time);
        low.insert(vertex.to_owned(), *time);
        *time += 1;
        let mut children = 0usize;
        let mut neighbors: Vec<String> = adjacency[vertex].iter().cloned().collect();
        neighbors.sort();
        for neighbor in neighbors {
            if !discovery.contains_key(&neighbor) {
                children += 1;
                parent.insert(neighbor.clone(), Some(vertex.to_owned()));
                visit(
                    &neighbor,
                    adjacency,
                    time,
                    discovery,
                    low,
                    parent,
                    articulation,
                    bridges,
                );
                let low_neighbor = low[&neighbor];
                let low_vertex = low[vertex];
                low.insert(vertex.to_owned(), low_vertex.min(low_neighbor));
                if parent[vertex].is_none() && children > 1 {
                    articulation.insert(vertex.to_owned());
                }
                if parent[vertex].is_some() && low[&neighbor] >= discovery[vertex] {
                    articulation.insert(vertex.to_owned());
                }
                if low[&neighbor] > discovery[vertex] {
                    if vertex < neighbor.as_str() {
                        bridges.insert((vertex.to_owned(), neighbor.clone()));
                    } else {
                        bridges.insert((neighbor.clone(), vertex.to_owned()));
                    }
                }
            } else if neighbor != parent[vertex].clone().unwrap_or_default() {
                // Parity with weighted-graph.ts: skip only the DFS tree parent.
                let disc = discovery[&neighbor];
                let low_vertex = low[vertex];
                low.insert(vertex.to_owned(), low_vertex.min(disc));
            }
        }
    }
    for vertex in &graph.vertices {
        if discovery.contains_key(vertex) {
            continue;
        }
        parent.insert(vertex.clone(), None);
        visit(
            vertex,
            &adjacency,
            &mut time,
            &mut discovery,
            &mut low,
            &mut parent,
            &mut articulation,
            &mut bridges,
        );
    }
    let mut points: Vec<String> = articulation.into_iter().collect();
    points.sort();
    let mut bridge_list: Vec<Value> = bridges
        .into_iter()
        .map(|(from, to)| json!({"from": from, "to": to}))
        .collect();
    bridge_list.sort_by(|a, b| {
        a.get("from")
            .and_then(Value::as_str)
            .unwrap_or("")
            .cmp(b.get("from").and_then(Value::as_str).unwrap_or(""))
            .then(
                a.get("to")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .cmp(b.get("to").and_then(Value::as_str).unwrap_or("")),
            )
    });
    (points, bridge_list)
}

pub fn analyze_centrality(view: &View, options: &Value) -> Result<Value, String> {
    let damping = options
        .get("damping")
        .and_then(Value::as_f64)
        .unwrap_or(0.85);
    let max_iterations = options
        .get("maxIterations")
        .and_then(Value::as_u64)
        .unwrap_or(100) as usize;
    let tolerance = options
        .get("tolerance")
        .and_then(Value::as_f64)
        .unwrap_or(1e-12);
    if !(damping > 0.0 && damping < 1.0) {
        return Err(format!("PageRank damping 必须位于 (0, 1): {damping}"));
    }
    let vertices: Vec<String> = view.nodes.keys().cloned().collect();
    let graph = build_directed(
        &vertices,
        &view
            .routes
            .iter()
            .filter(|r| !r.internal)
            .map(|r| (r.from.clone(), r.to.clone(), r.route_count as f64))
            .collect::<Vec<_>>(),
    );
    let n = graph.vertices.len();
    let mut ranks: BTreeMap<String, f64> = graph
        .vertices
        .iter()
        .map(|v| (v.clone(), if n > 0 { 1.0 / n as f64 } else { 0.0 }))
        .collect();
    let mut iterations = 0usize;
    let mut converged = n == 0;
    while iterations < max_iterations && n > 0 {
        let dangling: f64 = graph
            .vertices
            .iter()
            .filter(|v| graph.outbound[*v].is_empty())
            .map(|v| ranks.get(v).copied().unwrap_or(0.0))
            .sum();
        let mut next: BTreeMap<String, f64> = graph
            .vertices
            .iter()
            .map(|v| {
                (
                    v.clone(),
                    (1.0 - damping) / n as f64 + damping * dangling / n as f64,
                )
            })
            .collect();
        for source in &graph.vertices {
            let outbound = &graph.outbound[source];
            let total: f64 = outbound.values().sum();
            if total <= 0.0 {
                continue;
            }
            for (target, weight) in outbound {
                *next.get_mut(target).unwrap() += damping * ranks[source] * weight / total;
            }
        }
        let difference: f64 = graph
            .vertices
            .iter()
            .map(|v| (next[v] - ranks[v]).abs())
            .sum();
        ranks = next;
        iterations += 1;
        if difference <= tolerance {
            converged = true;
            break;
        }
    }
    let mut betweenness: BTreeMap<String, f64> =
        graph.vertices.iter().map(|v| (v.clone(), 0.0)).collect();
    let mut harmonic: BTreeMap<String, f64> =
        graph.vertices.iter().map(|v| (v.clone(), 0.0)).collect();
    for source in &graph.vertices {
        let mut stack: Vec<String> = Vec::new();
        let mut predecessors: BTreeMap<String, Vec<String>> = graph
            .vertices
            .iter()
            .map(|v| (v.clone(), Vec::new()))
            .collect();
        let mut paths: BTreeMap<String, f64> =
            graph.vertices.iter().map(|v| (v.clone(), 0.0)).collect();
        let mut distance: BTreeMap<String, i64> =
            graph.vertices.iter().map(|v| (v.clone(), -1)).collect();
        paths.insert(source.clone(), 1.0);
        distance.insert(source.clone(), 0);
        let mut queue = VecDeque::from([source.clone()]);
        while let Some(vertex) = queue.pop_front() {
            stack.push(vertex.clone());
            let mut targets: Vec<String> = graph.outbound[&vertex].keys().cloned().collect();
            targets.sort();
            for target in targets {
                if distance[&target] == -1 {
                    distance.insert(target.clone(), distance[&vertex] + 1);
                    queue.push_back(target.clone());
                }
                if distance[&target] == distance[&vertex] + 1 {
                    let add = paths[&vertex];
                    *paths.get_mut(&target).unwrap() += add;
                    predecessors.get_mut(&target).unwrap().push(vertex.clone());
                }
            }
        }
        for vertex in &graph.vertices {
            if distance[vertex] > 0 {
                *harmonic.get_mut(source).unwrap() += 1.0 / distance[vertex] as f64;
            }
        }
        let mut dependency: BTreeMap<String, f64> =
            graph.vertices.iter().map(|v| (v.clone(), 0.0)).collect();
        while let Some(target) = stack.pop() {
            for predecessor in predecessors[&target].clone() {
                if paths[&target] > 0.0 {
                    let delta = paths[&predecessor] / paths[&target] * (1.0 + dependency[&target]);
                    *dependency.get_mut(&predecessor).unwrap() += delta;
                }
            }
            if target != *source {
                *betweenness.get_mut(&target).unwrap() += dependency[&target];
            }
        }
    }
    let between_scale = if n > 2 {
        1.0 / ((n - 1) * (n - 2)) as f64
    } else {
        0.0
    };
    let degree_scale = if n > 1 { 1.0 / (n - 1) as f64 } else { 0.0 };
    let cores = core_numbers(&graph.vertices, &graph.outbound, &graph.inbound);
    let (points, bridges) = articulation_and_bridges(&graph);
    let mut nodes: Vec<Value> = graph
        .vertices
        .iter()
        .map(|node| {
            let inbound = &graph.inbound[node];
            let outbound = &graph.outbound[node];
            let weighted_in: f64 = inbound.values().sum();
            let weighted_out: f64 = outbound.values().sum();
            json!({
                "nodeId": node, "inDegree": inbound.len(), "outDegree": outbound.len(),
                "weightedInDegree": weighted_in, "weightedOutDegree": weighted_out,
                "inDegreeCentrality": inbound.len() as f64 * degree_scale,
                "outDegreeCentrality": outbound.len() as f64 * degree_scale,
                "pageRank": ranks[node],
                "betweennessCentrality": betweenness[node] * between_scale,
                "harmonicCloseness": harmonic[node] * degree_scale,
                "coreNumber": cores.get(node).copied().unwrap_or(0),
            })
        })
        .collect();
    nodes.sort_by(|a, b| {
        let ba = b
            .get("betweennessCentrality")
            .and_then(Value::as_f64)
            .unwrap_or(0.0);
        let aa = a
            .get("betweennessCentrality")
            .and_then(Value::as_f64)
            .unwrap_or(0.0);
        ba.partial_cmp(&aa)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(
                b.get("pageRank")
                    .and_then(Value::as_f64)
                    .unwrap_or(0.0)
                    .partial_cmp(&a.get("pageRank").and_then(Value::as_f64).unwrap_or(0.0))
                    .unwrap_or(std::cmp::Ordering::Equal),
            )
            .then(
                a.get("nodeId")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .cmp(b.get("nodeId").and_then(Value::as_str).unwrap_or("")),
            )
    });
    Ok(json!({
        "viewId": view.id, "nodeCount": n, "edgeCount": graph.edges.len(),
        "pageRankIterations": iterations, "pageRankConverged": converged,
        "maxCoreNumber": cores.values().copied().max().unwrap_or(0),
        "weaklyConnectedComponents": weakly_connected(&graph),
        "articulationPointIds": points, "bridges": bridges,
        "sourceNodeIds": graph.vertices.iter().filter(|v|
            graph.inbound[*v].is_empty() && !graph.outbound[*v].is_empty()).cloned().collect::<Vec<_>>(),
        "sinkNodeIds": graph.vertices.iter().filter(|v|
            graph.outbound[*v].is_empty() && !graph.inbound[*v].is_empty()).cloned().collect::<Vec<_>>(),
        "nodes": nodes,
    }))
}

// ---- Louvain communities ----

#[derive(Debug, Clone)]
struct UndirectedGraph {
    vertices: Vec<String>,
    edges: Vec<(String, String, f64)>,
    adjacency: BTreeMap<String, BTreeMap<String, f64>>,
    degree: BTreeMap<String, f64>,
    total_weight: f64,
}

fn build_undirected(vertex_ids: &[String], source: &[(String, String, f64)]) -> UndirectedGraph {
    let mut ordered: Vec<String> = vertex_ids
        .iter()
        .cloned()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    ordered.sort();
    let vertex_set: BTreeSet<&str> = ordered.iter().map(String::as_str).collect();
    let mut merged: BTreeMap<(String, String), f64> = BTreeMap::new();
    for (from, to, weight) in source {
        if !weight.is_finite() || *weight <= 0.0 {
            continue;
        }
        if !vertex_set.contains(from.as_str()) || !vertex_set.contains(to.as_str()) {
            continue;
        }
        let key = if from <= to {
            (from.clone(), to.clone())
        } else {
            (to.clone(), from.clone())
        };
        *merged.entry(key).or_default() += weight;
    }
    let mut edges: Vec<(String, String, f64)> = merged
        .into_iter()
        .map(|((from, to), weight)| (from, to, weight))
        .collect();
    edges.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.cmp(&b.1)));
    let mut adjacency: BTreeMap<String, BTreeMap<String, f64>> = BTreeMap::new();
    let mut degree: BTreeMap<String, f64> = BTreeMap::new();
    for vertex in &ordered {
        adjacency.insert(vertex.clone(), BTreeMap::new());
        degree.insert(vertex.clone(), 0.0);
    }
    let mut total = 0.0;
    for (from, to, weight) in &edges {
        total += weight;
        if from == to {
            // Parity with weighted-graph.ts: self-loop adds 2x degree and no adjacency entry.
            *degree.get_mut(from).unwrap() += weight * 2.0;
            continue;
        }
        adjacency.get_mut(from).unwrap().insert(to.clone(), *weight);
        adjacency.get_mut(to).unwrap().insert(from.clone(), *weight);
        *degree.get_mut(from).unwrap() += weight;
        *degree.get_mut(to).unwrap() += weight;
    }
    UndirectedGraph {
        vertices: ordered,
        edges,
        adjacency,
        degree,
        total_weight: total,
    }
}

fn louvain_modularity(
    graph: &UndirectedGraph,
    assignment: &BTreeMap<String, String>,
    resolution: f64,
) -> f64 {
    let m = graph.total_weight;
    if m <= 0.0 {
        return 0.0;
    }
    let mut internal: BTreeMap<String, f64> = BTreeMap::new();
    let mut total_degree: BTreeMap<String, f64> = BTreeMap::new();
    for vertex in &graph.vertices {
        let community = &assignment[vertex];
        *total_degree.entry(community.clone()).or_default() += graph.degree[vertex];
    }
    for (from, to, weight) in &graph.edges {
        if assignment[from] == assignment[to] {
            *internal.entry(assignment[from].clone()).or_default() += weight;
        }
    }
    let mut value = 0.0;
    for community in total_degree.keys() {
        value += internal.get(community).copied().unwrap_or(0.0) / m
            - resolution * ((total_degree[community] / (2.0 * m)).powi(2));
    }
    value
}

fn louvain_move(
    graph: &UndirectedGraph,
    resolution: f64,
    max_passes: usize,
    epsilon: f64,
) -> (BTreeMap<String, String>, usize, usize) {
    let mut assignment: BTreeMap<String, String> = graph
        .vertices
        .iter()
        .map(|v| (v.clone(), v.clone()))
        .collect();
    let mut community_degree: BTreeMap<String, f64> = graph
        .vertices
        .iter()
        .map(|v| (v.clone(), graph.degree[v]))
        .collect();
    let m = graph.total_weight;
    if m <= 0.0 {
        return (assignment, 0, 0);
    }
    let mut total_moves = 0usize;
    let mut passes = 0usize;
    while passes < max_passes {
        let mut pass_moves = 0usize;
        for vertex in &graph.vertices {
            let old = assignment[vertex].clone();
            let degree = graph.degree[vertex];
            let mut weights: BTreeMap<String, f64> = BTreeMap::new();
            for (neighbor, weight) in &graph.adjacency[vertex] {
                let community = &assignment[neighbor];
                *weights.entry(community.clone()).or_default() += weight;
            }
            *community_degree.get_mut(&old).unwrap() -= degree;
            let remove_cost = -weights.get(&old).copied().unwrap_or(0.0) / m
                + resolution * community_degree[&old] * degree / (2.0 * m * m);
            let mut best = old.clone();
            let mut best_gain = 0.0;
            let mut candidates: BTreeSet<String> = weights.keys().cloned().collect();
            candidates.insert(old.clone());
            let mut ordered: Vec<String> = candidates.into_iter().collect();
            ordered.sort();
            for community in ordered {
                let gain = remove_cost + weights.get(&community).copied().unwrap_or(0.0) / m
                    - resolution
                        * community_degree.get(&community).copied().unwrap_or(0.0)
                        * degree
                        / (2.0 * m * m);
                if gain > best_gain + epsilon
                    || (gain > epsilon && (gain - best_gain).abs() <= epsilon && community < best)
                {
                    best_gain = gain;
                    best = community;
                }
            }
            assignment.insert(vertex.clone(), best.clone());
            *community_degree.entry(best.clone()).or_default() += degree;
            if best != old {
                pass_moves += 1;
            }
        }
        total_moves += pass_moves;
        passes += 1;
        if pass_moves == 0 {
            break;
        }
    }
    // TS counts the final empty pass as passes+1 due to loop structure; align:
    // TS increments `passes` in for-header then breaks with extra +=1. Our loop
    // already counts executed passes; verified against golden fixtures below.
    (assignment, passes, total_moves)
}

fn groups_from_assignment(
    graph: &UndirectedGraph,
    assignment: &BTreeMap<String, String>,
    members: &BTreeMap<String, Vec<String>>,
) -> Vec<(Vec<String>, Vec<String>)> {
    let mut grouped: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for vertex in &graph.vertices {
        grouped
            .entry(assignment[vertex].clone())
            .or_default()
            .push(vertex.clone());
    }
    let mut groups: Vec<(Vec<String>, Vec<String>)> = grouped
        .into_values()
        .map(|mut current| {
            current.sort();
            let mut original: Vec<String> = current
                .iter()
                .flat_map(|v| members.get(v).cloned().unwrap_or_default())
                .collect();
            original.sort();
            (current, original)
        })
        .collect();
    groups.sort_by(|a, b| b.1.len().cmp(&a.1.len()).then(a.1[0].cmp(&b.1[0])));
    groups
}

fn assignment_from_groups(groups: &[(Vec<String>, Vec<String>)]) -> BTreeMap<String, String> {
    let mut assignment = BTreeMap::new();
    for (index, (_, original)) in groups.iter().enumerate() {
        for member in original {
            assignment.insert(member.clone(), format!("community-{}", index + 1));
        }
    }
    assignment
}

fn aggregate_graph(
    graph: &UndirectedGraph,
    groups: &[(Vec<String>, Vec<String>)],
    level: usize,
) -> (UndirectedGraph, BTreeMap<String, Vec<String>>) {
    let mut current_to_agg = BTreeMap::new();
    let mut members = BTreeMap::new();
    for (index, (current, original)) in groups.iter().enumerate() {
        let id = format!("level-{level}-community-{}", index + 1);
        for vertex in current {
            current_to_agg.insert(vertex.clone(), id.clone());
        }
        members.insert(id, original.clone());
    }
    let edges: Vec<(String, String, f64)> = graph
        .edges
        .iter()
        .map(|(from, to, weight)| {
            (
                current_to_agg[from].clone(),
                current_to_agg[to].clone(),
                *weight,
            )
        })
        .collect();
    let member_ids: Vec<String> = members.keys().cloned().collect();
    (build_undirected(&member_ids, &edges), members)
}

#[allow(clippy::too_many_lines)]
fn discover(
    view_id: &str,
    resolution_label: &str,
    vertex_ids: Vec<String>,
    source_edges: Vec<(String, String, f64)>,
    options: &Value,
) -> Result<Value, String> {
    let gamma = options
        .get("modularityResolution")
        .and_then(Value::as_f64)
        .unwrap_or(1.0);
    let max_levels = options
        .get("maxLevels")
        .and_then(Value::as_u64)
        .unwrap_or(20) as usize;
    let max_passes = options
        .get("maxPasses")
        .and_then(Value::as_u64)
        .unwrap_or(50) as usize;
    let minimum_gain = options
        .get("minimumGain")
        .and_then(Value::as_f64)
        .unwrap_or(1e-10);
    if !gamma.is_finite() || gamma <= 0.0 {
        return Err(format!("modularityResolution 必须是正数: {gamma}"));
    }
    let original = build_undirected(&vertex_ids, &source_edges);
    let mut graph = original.clone();
    let mut members: BTreeMap<String, Vec<String>> = graph
        .vertices
        .iter()
        .map(|v| (v.clone(), vec![v.clone()]))
        .collect();
    let mut final_groups: Vec<(Vec<String>, Vec<String>)> = graph
        .vertices
        .iter()
        .map(|v| (vec![v.clone()], vec![v.clone()]))
        .collect();
    let mut previous: f64 = louvain_modularity(
        &original,
        &original
            .vertices
            .iter()
            .map(|v| (v.clone(), v.clone()))
            .collect(),
        gamma,
    );
    let mut levels = Vec::new();
    for level in 0..max_levels {
        let (assignment, passes, moves) = louvain_move(&graph, gamma, max_passes, minimum_gain);
        let groups = groups_from_assignment(&graph, &assignment, &members);
        let original_assignment = assignment_from_groups(&groups);
        let level_modularity = louvain_modularity(&original, &original_assignment, gamma);
        if !levels.is_empty() && level_modularity <= previous + minimum_gain {
            break;
        }
        previous = level_modularity;
        levels.push(json!({
            "level": level, "communityCount": groups.len(),
            "modularity": level_modularity, "passes": passes, "moves": moves,
            "communities": groups.iter().map(|(_, o)| o).collect::<Vec<_>>(),
        }));
        final_groups = groups.clone();
        if groups.len() == graph.vertices.len() || groups.len() <= 1 {
            break;
        }
        let (aggregated, next_members) = aggregate_graph(&graph, &groups, level + 1);
        graph = aggregated;
        members = next_members;
    }
    if levels.is_empty() {
        levels.push(json!({
            "level": 0, "communityCount": final_groups.len(), "modularity": previous,
            "passes": 0, "moves": 0,
            "communities": final_groups.iter().map(|(_, o)| o).collect::<Vec<_>>(),
        }));
    }
    let final_assignment = assignment_from_groups(&final_groups);
    let total_volume = original.total_weight * 2.0;
    let mut total_internal = 0.0;
    let mut communities = Vec::new();
    for (index, (_, original_members)) in final_groups.iter().enumerate() {
        let member_set: BTreeSet<&str> = original_members.iter().map(String::as_str).collect();
        let mut internal_weight = 0.0;
        let mut boundary_weight = 0.0;
        let mut internal_edges = 0usize;
        let mut boundary_edges = 0usize;
        for (from, to, weight) in &original.edges {
            let from_inside = member_set.contains(from.as_str());
            let to_inside = member_set.contains(to.as_str());
            if from_inside && to_inside {
                internal_weight += weight;
                internal_edges += 1;
            } else if from_inside != to_inside {
                boundary_weight += weight;
                boundary_edges += 1;
            }
        }
        total_internal += internal_weight;
        let volume: f64 = original_members.iter().map(|m| original.degree[m]).sum();
        let denom = volume.min(total_volume - volume);
        let possible_internal = if original_members.len() > 1 {
            original_members.len() * (original_members.len() - 1) / 2
        } else {
            0
        };
        let possible_boundary =
            original_members.len() * (original.vertices.len() - original_members.len());
        communities.push(json!({
            "id": format!("community-{}", index + 1), "members": original_members,
            "internalWeight": internal_weight, "boundaryWeight": boundary_weight,
            "conductance": if denom > 0.0 { boundary_weight / denom } else { 0.0 },
            "cohesion": if internal_weight + boundary_weight > 0.0 {
                internal_weight / (internal_weight + boundary_weight)
            } else { 0.0 },
            "internalDensity": if possible_internal > 0 { internal_edges as f64 / possible_internal as f64 } else { 0.0 },
            "cutRatio": if possible_boundary > 0 { boundary_edges as f64 / possible_boundary as f64 } else { 0.0 },
        }));
    }
    Ok(json!({
        "viewId": view_id, "resolution": resolution_label, "algorithm": "louvain",
        "modularityResolution": gamma, "vertexCount": original.vertices.len(),
        "edgeCount": original.edges.len(), "totalEdgeWeight": original.total_weight,
        "modularity": louvain_modularity(&original, &final_assignment, gamma),
        "coverage": if original.total_weight > 0.0 { total_internal / original.total_weight } else { 0.0 },
        "levels": levels, "communities": communities,
    }))
}

pub fn discover_view(view: &View, options: &Value) -> Result<Value, String> {
    let mut seen = BTreeSet::new();
    let mut edges = Vec::new();
    for route in &view.routes {
        let key = format!("{}\0{}\0{}", route.from, route.to, route.info_type);
        if !seen.insert(key) {
            continue;
        }
        edges.push((route.from.clone(), route.to.clone(), 1.0));
    }
    let vertices: Vec<String> = view.nodes.keys().cloned().collect();
    discover(&view.id, "node", vertices, edges, options)
}

pub fn discover_granular(index: &Index, options: &Value) -> Result<Value, String> {
    let included: BTreeSet<String> = index
        .entities
        .values()
        .filter(|e| e.kind != "node")
        .map(|e| e.address.clone())
        .collect();
    let mut seen = BTreeSet::new();
    let mut edges = Vec::new();
    for edge in &index.edges {
        let key = format!("{}\0{}\0{}", edge.from, edge.to, edge.edge_type);
        if !included.contains(&edge.from) || !included.contains(&edge.to) || !seen.insert(key) {
            continue;
        }
        edges.push((edge.from.clone(), edge.to.clone(), 1.0));
    }
    discover(
        "all-granular",
        "granular",
        included.into_iter().collect(),
        edges,
        options,
    )
}

fn choose2(value: usize) -> f64 {
    if value < 2 {
        0.0
    } else {
        value as f64 * (value as f64 - 1.0) / 2.0
    }
}

pub fn compare_partitions(
    discovered_view_id: &str,
    reference_view_id: &str,
    discovered: &BTreeMap<String, String>,
    reference: &BTreeMap<String, String>,
) -> Value {
    let mut vertices: Vec<String> = discovered
        .keys()
        .filter(|v| reference.contains_key(*v))
        .cloned()
        .collect();
    vertices.sort();
    let mut discovered_groups: BTreeMap<String, Vec<String>> = BTreeMap::new();
    let mut reference_groups: BTreeMap<String, Vec<String>> = BTreeMap::new();
    let mut contingency: BTreeMap<(String, String), usize> = BTreeMap::new();
    for vertex in &vertices {
        let d = discovered[vertex].clone();
        let r = reference[vertex].clone();
        discovered_groups
            .entry(d.clone())
            .or_default()
            .push(vertex.clone());
        reference_groups
            .entry(r.clone())
            .or_default()
            .push(vertex.clone());
        *contingency.entry((d, r)).or_default() += 1;
    }
    let n = vertices.len();
    let mut mutual = 0.0;
    let mut entropy_d = 0.0;
    let mut entropy_r = 0.0;
    if n > 0 {
        for ((d, r), count) in &contingency {
            let joint = *count as f64 / n as f64;
            let pd = discovered_groups[d].len() as f64 / n as f64;
            let pr = reference_groups[r].len() as f64 / n as f64;
            mutual += joint * (joint / (pd * pr)).ln();
            let _ = (pd, pr);
        }
        for members in discovered_groups.values() {
            let p = members.len() as f64 / n as f64;
            entropy_d -= p * p.ln();
        }
        for members in reference_groups.values() {
            let p = members.len() as f64 / n as f64;
            entropy_r -= p * p.ln();
        }
    }
    let product = entropy_d * entropy_r;
    let nmi = if product > 0.0 {
        mutual / product.sqrt()
    } else if entropy_d == entropy_r {
        1.0
    } else {
        0.0
    };
    let same_both: f64 = contingency.values().map(|c| choose2(*c)).sum();
    let same_d: f64 = discovered_groups.values().map(|m| choose2(m.len())).sum();
    let same_r: f64 = reference_groups.values().map(|m| choose2(m.len())).sum();
    let total_pairs = choose2(n);
    let expected = if total_pairs > 0.0 {
        same_d * same_r / total_pairs
    } else {
        0.0
    };
    let max_pairs = (same_d + same_r) / 2.0;
    let denom = max_pairs - expected;
    let ari = if denom == 0.0 {
        if same_both == max_pairs {
            1.0
        } else {
            0.0
        }
    } else {
        (same_both - expected) / denom
    };
    let precision = if same_d > 0.0 {
        same_both / same_d
    } else if same_r == 0.0 {
        1.0
    } else {
        0.0
    };
    let recall = if same_r > 0.0 {
        same_both / same_r
    } else if same_d == 0.0 {
        1.0
    } else {
        0.0
    };
    let f1 = if precision + recall > 0.0 {
        2.0 * precision * recall / (precision + recall)
    } else {
        0.0
    };
    let mut splits: Vec<Value> = reference_groups
        .iter()
        .flat_map(|(reference_id, members)| {
            let ids: BTreeSet<String> = members.iter().map(|m| discovered[m].clone()).collect();
            let mut ids: Vec<String> = ids.into_iter().collect();
            ids.sort();
            if ids.len() <= 1 {
                vec![]
            } else {
                vec![json!({"referenceCommunityId": reference_id,
                    "discoveredCommunityIds": ids, "memberCount": members.len()})]
            }
        })
        .collect();
    splits.sort_by(|a, b| {
        let ca = a.get("memberCount").and_then(Value::as_u64).unwrap_or(0);
        let cb = b.get("memberCount").and_then(Value::as_u64).unwrap_or(0);
        cb.cmp(&ca).then(
            a.get("referenceCommunityId")
                .and_then(Value::as_str)
                .unwrap_or("")
                .cmp(
                    b.get("referenceCommunityId")
                        .and_then(Value::as_str)
                        .unwrap_or(""),
                ),
        )
    });
    let mut merges: Vec<Value> = discovered_groups
        .iter()
        .flat_map(|(discovered_id, members)| {
            let ids: BTreeSet<String> = members.iter().map(|m| reference[m].clone()).collect();
            let mut ids: Vec<String> = ids.into_iter().collect();
            ids.sort();
            if ids.len() <= 1 {
                vec![]
            } else {
                vec![json!({"discoveredCommunityId": discovered_id,
                    "referenceCommunityIds": ids, "memberCount": members.len()})]
            }
        })
        .collect();
    merges.sort_by(|a, b| {
        let ca = a.get("memberCount").and_then(Value::as_u64).unwrap_or(0);
        let cb = b.get("memberCount").and_then(Value::as_u64).unwrap_or(0);
        cb.cmp(&ca).then(
            a.get("discoveredCommunityId")
                .and_then(Value::as_str)
                .unwrap_or("")
                .cmp(
                    b.get("discoveredCommunityId")
                        .and_then(Value::as_str)
                        .unwrap_or(""),
                ),
        )
    });
    let discovered_counts: BTreeMap<String, usize> = discovered_groups
        .iter()
        .map(|(k, v)| (k.clone(), v.len()))
        .collect();
    let reference_counts: BTreeMap<String, usize> = reference_groups
        .iter()
        .map(|(k, v)| (k.clone(), v.len()))
        .collect();
    let _ = (discovered_counts, reference_counts);
    json!({
        "discoveredViewId": discovered_view_id, "referenceViewId": reference_view_id,
        "comparedVertexCount": n,
        "discoveredCommunityCount": discovered_groups.len(),
        "referenceCommunityCount": reference_groups.len(),
        "normalizedMutualInformation": nmi, "adjustedRandIndex": ari,
        "pairwisePrecision": precision, "pairwiseRecall": recall, "pairwiseF1": f1,
        "exactAgreement": splits.is_empty() && merges.is_empty()
            && discovered_groups.len() == reference_groups.len(),
        "referenceSplits": splits, "discoveredMerges": merges,
    })
}

pub fn compare_to_view(
    result: &Value,
    discovered_view: &View,
    reference_view: &View,
) -> Result<Value, String> {
    let discovered_members = |community: &Value| -> Vec<String> {
        community
            .get("members")
            .and_then(Value::as_array)
            .map(|m| {
                m.iter()
                    .filter_map(|v| v.as_str().map(str::to_owned))
                    .collect()
            })
            .unwrap_or_default()
    };
    let mut discovered: BTreeMap<String, String> = BTreeMap::new();
    for community in result
        .get("communities")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
    {
        let id = community.get("id").and_then(Value::as_str).unwrap_or("");
        for member in discovered_members(community) {
            discovered.insert(member, id.to_owned());
        }
    }
    let mut reference: BTreeMap<String, String> = BTreeMap::new();
    for (view_node_id, node) in &reference_view.nodes {
        for source in &node.sources {
            reference.insert(source.clone(), view_node_id.clone());
        }
    }
    // Restrict to vertices present in both (mirrors TS intersection).
    let _ = &discovered_view;
    Ok(compare_partitions(
        result.get("viewId").and_then(Value::as_str).unwrap_or(""),
        &reference_view.id,
        &discovered,
        &reference,
    ))
}

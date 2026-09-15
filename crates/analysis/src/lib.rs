//! Authoritative portable causal analysis.
//! Language adapters supply facts; all graph computation lives here.

mod metrics;
mod model;
mod query;
mod views;

use std::collections::BTreeMap;

use serde_json::{json, Value};

use model::{build_index, entity_to_json, Index};

fn index_to_json(index: &Index) -> Value {
    let entities: BTreeMap<String, Value> = index
        .entities
        .iter()
        .map(|(address, entity)| (address.clone(), entity_to_json(entity)))
        .collect();
    let partition = |kind: &str, nodes_by_id: bool| -> BTreeMap<String, Value> {
        index
            .entities
            .values()
            .filter(|entity| entity.kind == kind)
            .map(|entity| {
                let key = if nodes_by_id {
                    entity.id.clone()
                } else {
                    entity.address.clone()
                };
                (key, entity_to_json(entity))
            })
            .collect()
    };
    json!({
        "timestamp": 0,
        "entities": entities,
        "edges": index.edges.iter().map(model::edge_to_json).collect::<Vec<_>>(),
        "nodes": partition("node", true),
        "changes": partition("change", false),
        "states": partition("state", false),
        "infos": partition("info", false),
        "effects": partition("effect", false),
        "entries": partition("entry", false),
        "uiPaths": partition("ui", false),
        "frontendLinks": index.frontend_links,
        "frontendServiceLinks": index.frontend_service_links,
        "nodeObjectFacts": [],
        "unresolvedInfoTypes": index.unresolved_info_types,
        "unresolvedSendTargets": index.unresolved_send_targets,
    })
}

fn parse_usize(value: Option<&Value>, name: &str) -> Result<Option<usize>, String> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Number(number)) => number
            .as_u64()
            .map(|v| Some(v as usize))
            .ok_or_else(|| format!("{name} must be a non-negative safe integer")),
        Some(_) => Err(format!("{name} must be a non-negative safe integer")),
    }
}

fn view_selection(index: &model::Index, request: &Value) -> Result<views::View, String> {
    let base = views::build_all_nodes(index);
    let folds = request.get("folds");
    let fold_depth = parse_usize(request.get("foldDepth"), "foldDepth")?;
    if folds.is_none() && fold_depth.is_none() {
        return Ok(base);
    }
    let depth = fold_depth.unwrap_or(1);
    let folds_value = match folds {
        Some(value) if !value.is_null() => value.clone(),
        _ => {
            let mut auto = "world".to_owned();
            while base.nodes.contains_key(&auto) || base.nodes.contains_key(&format!("fold:{auto}"))
            {
                auto = format!("_{auto}");
            }
            let mut leaves: Vec<String> = base.nodes.keys().cloned().collect();
            leaves.sort();
            let mut groups = serde_json::Map::new();
            groups.insert(auto.clone(), json!({"children": leaves}));
            json!({"version": 1, "root": auto, "groups": groups})
        }
    };
    views::build_fold_view(&base, &folds_value, depth)
}

#[allow(clippy::type_complexity)]
fn facts_parts(
    facts: &Value,
) -> Result<(Vec<Value>, BTreeMap<String, BTreeMap<String, Value>>), String> {
    let snapshots = facts
        .get("snapshots")
        .and_then(Value::as_array)
        .ok_or_else(|| "facts.snapshots must be an array".to_owned())?
        .clone();
    if snapshots.len() > 512 {
        return Err("snapshot count exceeds limit".into());
    }
    let mut live = BTreeMap::new();
    match facts.get("liveStates") {
        None | Some(Value::Null) => {}
        Some(Value::Object(states)) => {
            for (node_id, state) in states {
                if node_id.is_empty() {
                    return Err("facts.liveStates keys must be nonempty Node IDs".to_owned());
                }
                let fields = state
                    .as_object()
                    .ok_or_else(|| "facts.liveStates values must be objects".to_owned())?;
                live.insert(
                    node_id.clone(),
                    fields
                        .keys()
                        .map(|key| (key.clone(), Value::Null))
                        .collect(),
                );
            }
        }
        Some(_) => return Err("facts.liveStates must be an object".to_owned()),
    }
    Ok((snapshots, live))
}

fn context_parts(context: &Value) -> Result<(Vec<Value>, Vec<Value>), String> {
    let links = context
        .get("frontendLinks")
        .map(|v| {
            v.as_array()
                .cloned()
                .ok_or_else(|| "frontendLinks must be an array".to_owned())
        })
        .transpose()?
        .unwrap_or_default();
    let service = context
        .get("frontendServiceLinks")
        .map(|v| {
            v.as_array()
                .cloned()
                .ok_or_else(|| "frontendServiceLinks must be an array".to_owned())
        })
        .transpose()?
        .unwrap_or_default();
    if links.len() > 1024 || service.len() > 1024 {
        return Err("analysis context exceeds limit".into());
    }
    Ok((links, service))
}

/// Validate one portable snapshot without building an index.
pub fn validate_snapshot(value: &Value) -> Result<Value, String> {
    let (node_id, entities, edges) = model::validate_snapshot(value)?;
    Ok(json!({"nodeId": node_id, "entities": entities.len(), "edges": edges.len()}))
}

/// Core entry: one analysis request over portable facts + context.
/// `facts = {snapshots, liveStates}`, `context = {frontendLinks, frontendServiceLinks}`.
/// No `instances` op: JS instance evidence never crosses the Rust protocol.
pub fn analyze_json(request: &Value, facts: &Value, context: &Value) -> Result<Value, String> {
    let (snapshots, live_states) = facts_parts(facts)?;
    let (links, service_links) = context_parts(context)?;
    let index = build_index(&snapshots, &links, &service_links, &live_states)?;
    let op = request
        .get("op")
        .and_then(Value::as_str)
        .ok_or_else(|| "request.op is required".to_owned())?;
    match op {
        "index" => Ok(index_to_json(&index)),
        "facts" => Ok(Value::Array(snapshots)),
        "validate" => Ok(query::validate_index(&index, &snapshots)),
        "entity" => {
            let address = request
                .get("address")
                .and_then(Value::as_str)
                .ok_or_else(|| "entity.address is required".to_owned())?;
            Ok(query::query_entity(&index, address)?.unwrap_or(Value::Null))
        }
        "expand" => {
            let address = request
                .get("address")
                .and_then(Value::as_str)
                .ok_or_else(|| "expand.address is required".to_owned())?;
            Ok(query::expand_entity(&index, address)?.unwrap_or(Value::Null))
        }
        "path" => {
            let addresses = request
                .get("addresses")
                .and_then(Value::as_array)
                .ok_or_else(|| "path.addresses must be an array".to_owned())?;
            let list: Vec<String> = addresses
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect();
            Ok(query::find_chain(
                &index,
                &list,
                parse_usize(request.get("maxDepth"), "maxDepth")?,
                parse_usize(request.get("maxPaths"), "maxPaths")?,
            )?)
        }
        "select" => {
            let ids = request
                .get("nodeIds")
                .and_then(Value::as_array)
                .ok_or_else(|| "select.nodeIds must be an array".to_owned())?;
            let list: Vec<String> = ids
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect();
            Ok(query::select_subgraph(&index, &list)?)
        }
        "view" => Ok(views::view_to_json(&view_selection(&index, request)?)),
        "health" => Ok(metrics::analyze_health(&view_selection(&index, request)?)),
        "reach" => {
            let view = view_selection(&index, request)?;
            let node = request
                .get("nodeId")
                .and_then(Value::as_str)
                .ok_or_else(|| "reach.nodeId is required".to_owned())?;
            Ok(metrics::analyze_reach(&view, node)?)
        }
        "centrality" => Ok(metrics::analyze_centrality(
            &view_selection(&index, request)?,
            request,
        )?),
        "communities" => Ok(metrics::discover_view(
            &view_selection(&index, request)?,
            request,
        )?),
        "granularCommunities" => Ok(metrics::discover_granular(&index, request)?),
        "compareCommunities" => {
            let discovered_view = view_selection(&index, request)?;
            let discovered = metrics::discover_view(&discovered_view, request)?;
            let reference_folds = request
                .get("referenceFolds")
                .ok_or_else(|| "compareCommunities.referenceFolds is required".to_owned())?;
            let reference_depth =
                parse_usize(request.get("referenceFoldDepth"), "referenceFoldDepth")?.ok_or_else(
                    || "compareCommunities.referenceFoldDepth is required".to_owned(),
                )?;
            let base = views::build_all_nodes(&index);
            let reference = views::build_fold_view(&base, reference_folds, reference_depth)?;
            Ok(metrics::compare_to_view(
                &discovered,
                &discovered_view,
                &reference,
            )?)
        }
        "instances" => Err(
            "instances is a JS-only diagnostic and is not part of the Rust analysis protocol"
                .into(),
        ),
        _ => Err(format!("Unknown analysis operation: {op}")),
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{analyze_json, validate_snapshot};

    fn facts(snapshots: serde_json::Value) -> (serde_json::Value, serde_json::Value) {
        (
            json!({"snapshots": snapshots, "liveStates": {}}),
            json!({"frontendLinks": [], "frontendServiceLinks": []}),
        )
    }

    #[test]
    fn empty_graph_reports_unreachable_and_empty_view() {
        let (facts, context) = facts(json!([]));
        let view = analyze_json(&json!({"op": "view"}), &facts, &context).unwrap();
        assert_eq!(view["routes"].as_array().unwrap().len(), 0);
        let health = analyze_json(&json!({"op": "health"}), &facts, &context).unwrap();
        assert_eq!(health["nodeCount"], json!(0));
    }

    #[test]
    fn unknown_node_selection_is_rejected() {
        let (facts, context) = facts(json!([]));
        let error = analyze_json(
            &json!({"op": "select", "nodeIds": ["ghost"]}),
            &facts,
            &context,
        )
        .unwrap_err();
        assert!(error.contains("Node not found"));
    }

    #[test]
    fn duplicate_snapshot_sources_are_rejected() {
        let snapshot = json!({"version": 1, "nodeId": "a",
            "entities": [{"address": "node:a", "kind": "node", "id": "a"}], "edges": []});
        let (facts, context) = facts(json!([snapshot.clone(), snapshot]));
        let error = analyze_json(&json!({"op": "index"}), &facts, &context).unwrap_err();
        assert!(error.contains("Duplicate source"));
    }

    #[test]
    fn instances_op_stays_js_only() {
        let (facts, context) = facts(json!([]));
        let error = analyze_json(&json!({"op": "instances"}), &facts, &context).unwrap_err();
        assert!(error.contains("JS-only"));
    }

    #[test]
    fn index_uses_the_complete_language_neutral_dto() {
        let snapshot = json!({
            "version": 1,
            "nodeId": "worker",
            "entities": [
                {"address": "node:worker", "kind": "node", "id": "worker"},
                {"address": "change:worker::RunInfo", "kind": "change", "id": "worker",
                    "nodeId": "worker", "subId": "RunInfo"},
                {"address": "state:worker::count", "kind": "state", "id": "worker",
                    "nodeId": "worker", "subId": "count"},
                {"address": "info:RunInfo@worker", "kind": "info", "id": "RunInfo",
                    "nodeId": "worker", "subId": "worker"}
            ],
            "edges": [{"id": "trigger", "from": "info:RunInfo@worker",
                "to": "change:worker::RunInfo", "type": "trigger", "confidence": "high"}],
            "unresolvedInfoTypes": [{"sourceChange": "change:worker::RunInfo",
                "targetNodeId": null, "infoExpression": "dynamic"}],
            "unresolvedSendTargets": []
        });
        let facts = json!({"snapshots": [snapshot], "liveStates": {"worker": {"count": null}}});
        let context = json!({
            "frontendLinks": [{"id": "run", "applicationMethod": "run",
                "injection": {"targetNodeId": "worker", "infoType": "RunInfo"},
                "projections": [{"ownerNodeId": "worker", "ownerField": "count",
                    "applicationStatePath": "worker.count", "consumers": ["Counter"]}]}],
            "frontendServiceLinks": [{"id": "clock", "applicationMethod": "now",
                "provider": "clock", "consumers": ["Counter"]}]
        });
        let result = analyze_json(&json!({"op": "index"}), &facts, &context).unwrap();

        for key in [
            "entities",
            "edges",
            "nodes",
            "changes",
            "states",
            "infos",
            "effects",
            "entries",
            "uiPaths",
            "frontendLinks",
            "frontendServiceLinks",
            "nodeObjectFacts",
            "unresolvedInfoTypes",
            "unresolvedSendTargets",
        ] {
            assert!(result.get(key).is_some(), "missing index field {key}");
        }
        assert_eq!(result["nodes"]["worker"]["address"], json!("node:worker"));
        assert_eq!(result["entries"]["entry:run"]["name"], json!("run"));
        assert_eq!(
            result["uiPaths"]["ui:worker.count"]["meta"]["consumers"],
            json!(["Counter"])
        );
        assert_eq!(result["unresolvedInfoTypes"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn portable_snapshot_rejects_cross_owner_facts_and_relations() {
        let bad_owner = json!({"version": 1, "nodeId": "a", "entities": [
            {"address": "node:a", "kind": "node", "id": "a"},
            {"address": "state:b::count", "kind": "state", "id": "b",
                "nodeId": "b", "subId": "count"}
        ], "edges": []});
        assert!(validate_snapshot(&bad_owner)
            .unwrap_err()
            .contains("impersonates another source Node"));

        let dangling = json!({"version": 1, "nodeId": "a", "entities": [
            {"address": "node:a", "kind": "node", "id": "a"},
            {"address": "change:a::RunInfo", "kind": "change", "id": "a",
                "nodeId": "a", "subId": "RunInfo"}
        ], "edges": [{"id": "send", "from": "change:a::RunInfo",
            "to": "info:RunInfo@b", "type": "send", "confidence": "high"}]});
        assert!(validate_snapshot(&dangling)
            .unwrap_err()
            .contains("Invalid causal relation"));
    }

    fn two_node_facts() -> (serde_json::Value, serde_json::Value) {
        let info_b = json!({"address": "info:TickInfo@b", "kind": "info",
            "id": "TickInfo", "nodeId": "b", "subId": "b"});
        facts(json!([
            {"version": 1, "nodeId": "a", "entities": [
                {"address": "node:a", "kind": "node", "id": "a"},
                {"address": "change:a::TickInfo", "kind": "change", "id": "a",
                    "nodeId": "a", "subId": "TickInfo"},
                info_b,
            ], "edges": [
                {"id": "e1", "from": "change:a::TickInfo", "to": "info:TickInfo@b",
                    "type": "send", "confidence": "high"},
            ]},
            {"version": 1, "nodeId": "b", "entities": [
                {"address": "node:b", "kind": "node", "id": "b"},
                {"address": "change:b::TickInfo", "kind": "change", "id": "b",
                    "nodeId": "b", "subId": "TickInfo"},
                {"address": "info:TickInfo@b", "kind": "info", "id": "TickInfo",
                    "nodeId": "b", "subId": "b"},
            ], "edges": [
                {"id": "e3", "from": "info:TickInfo@b", "to": "change:b::TickInfo",
                    "type": "trigger", "confidence": "high"},
            ]},
        ]))
    }

    #[test]
    fn unreachable_and_depth_limited_paths_report_diagnostics() {
        let (facts, context) = two_node_facts();
        let unreachable = analyze_json(
            &json!({"op": "path", "addresses": ["node:b", "node:a"]}),
            &facts,
            &context,
        )
        .unwrap();
        assert_eq!(unreachable["connected"], json!(false));
        assert_eq!(
            unreachable["segments"][0]["diagnostics"]["status"],
            json!("unreachable")
        );
        let limited = analyze_json(
            &json!({"op": "path", "addresses": ["node:a", "node:b"], "maxDepth": 0}),
            &facts,
            &context,
        )
        .unwrap();
        assert_eq!(
            limited["segments"][0]["diagnostics"]["status"],
            json!("depth-limited")
        );
    }

    #[test]
    fn illegal_folds_are_rejected() {
        let (facts, context) = two_node_facts();
        let unknown = analyze_json(
            &json!({"op": "view", "foldDepth": 1, "folds": {"version": 1,
                "root": "world", "groups": {"world": {"children": ["ghost"]}}}}),
            &facts,
            &context,
        )
        .unwrap_err();
        assert!(unknown.contains("Unknown fold leaf"));
        let cycle = analyze_json(
            &json!({"op": "view", "foldDepth": 1, "folds": {"version": 1,
                "root": "world", "groups": {
                    "world": {"children": ["loop", "a", "b"]},
                    "loop": {"children": ["world"]}}}}),
            &facts,
            &context,
        )
        .unwrap_err();
        assert!(cycle.contains("Fold cycle"));
        let partial = analyze_json(
            &json!({"op": "view", "foldDepth": 0, "folds": {"version": 1,
                "root": "world", "groups": {"world": {"children": ["a"]}}}}),
            &facts,
            &context,
        )
        .unwrap_err();
        assert!(partial.contains("Fold coverage"));
    }
}

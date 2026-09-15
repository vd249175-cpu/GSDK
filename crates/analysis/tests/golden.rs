//! Golden parity with the TypeScript portable analysis runtime.
//! Fixture: a --TickInfo--> b, b self-loop. Expected values were produced by
//! `sdk/analysis/*` on the same snapshots; floats use an explicit tolerance.

use serde_json::{json, Value};

fn facts() -> (Value, Value) {
    let info_b = json!({"address": "info:TickInfo@b", "kind": "info",
        "id": "TickInfo", "nodeId": "b", "subId": "b"});
    let snapshots = json!([
        {"version": 1, "nodeId": "a", "entities": [
            {"address": "node:a", "kind": "node", "id": "a"},
            {"address": "change:a::TickInfo", "kind": "change", "id": "a",
                "nodeId": "a", "subId": "TickInfo"},
            {"address": "state:a::count", "kind": "state", "id": "a",
                "nodeId": "a", "subId": "count"},
            info_b,
        ], "edges": [
            {"id": "e1", "from": "change:a::TickInfo", "to": "info:TickInfo@b",
                "type": "send", "confidence": "high"},
            {"id": "e2", "from": "change:a::TickInfo", "to": "state:a::count",
                "type": "write", "confidence": "high"},
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
            {"id": "e4", "from": "change:b::TickInfo", "to": "info:TickInfo@b",
                "type": "send", "confidence": "high"},
        ]},
    ]);
    (
        json!({"snapshots": snapshots, "liveStates": {}}),
        json!({"frontendLinks": [], "frontendServiceLinks": []}),
    )
}

fn analyze(op: Value) -> Value {
    let (facts, context) = facts();
    graphvideo_analysis::analyze_json(&op, &facts, &context)
        .unwrap_or_else(|error| panic!("{op:?} failed: {error}"))
}

fn approx(left: &Value, right: f64) -> bool {
    left.as_f64().is_some_and(|value| (value - right).abs() <= 1e-9)
}

#[test]
fn golden_view_health_centrality_community_fold_and_path() {
    let view = analyze(json!({"op": "view"}));
    let routes: Vec<String> = view["routes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|route| route["id"].as_str().unwrap().to_owned())
        .collect();
    assert_eq!(
        routes,
        vec![
            "route:a->b:TickInfo".to_owned(),
            "route:b->b:TickInfo".to_owned(),
        ]
    );
    assert_eq!(view["routes"][0]["routeCount"], json!(1));
    assert_eq!(view["routes"][1]["internal"], json!(true));

    let health = analyze(json!({"op": "health"}));
    assert_eq!(health["nodeCount"], json!(2));
    assert!(approx(&health["density"], 0.5));
    assert!(approx(&health["reciprocity"], 0.0));
    assert_eq!(health["cyclicNodeIds"], json!([]));
    assert_eq!(health["stronglyConnectedComponents"], json!([]));
    let by_id = |id: &str| {
        health["nodes"]
            .as_array()
            .unwrap()
            .iter()
            .find(|node| node["nodeId"] == id)
            .cloned()
            .unwrap()
    };
    assert_eq!(by_id("a")["outboundRoutes"], json!(1));
    assert_eq!(by_id("b")["inboundRoutes"], json!(1));
    assert!(approx(&by_id("a")["instability"], 1.0));

    let centrality = analyze(json!({"op": "centrality"}));
    assert_eq!(centrality["pageRankIterations"], json!(33));
    assert_eq!(centrality["pageRankConverged"], json!(true));
    let nodes = centrality["nodes"].as_array().unwrap();
    assert_eq!(nodes[0]["nodeId"], json!("b"));
    assert_eq!(nodes[1]["nodeId"], json!("a"));
    assert!(approx(&nodes[0]["pageRank"], 0.6491228070176251));
    assert!(approx(&nodes[1]["pageRank"], 0.35087719298237474));
    assert!(approx(&nodes[0]["betweennessCentrality"], 0.0));
    assert!(approx(&nodes[1]["harmonicCloseness"], 1.0));
    assert_eq!(centrality["bridges"], json!([{"from": "a", "to": "b"}]));
    assert_eq!(
        centrality["weaklyConnectedComponents"],
        json!([["a", "b"]])
    );

    let communities = analyze(json!({"op": "communities"}));
    assert_eq!(communities["vertexCount"], json!(2));
    assert_eq!(communities["edgeCount"], json!(2));
    assert!(approx(&communities["modularity"], 0.0));
    assert!(approx(&communities["coverage"], 1.0));
    assert_eq!(communities["levels"][0]["communityCount"], json!(1));
    assert_eq!(communities["levels"][0]["passes"], json!(2));
    assert_eq!(communities["levels"][0]["moves"], json!(1));
    assert_eq!(
        communities["communities"][0]["members"],
        json!(["a", "b"])
    );

    let folded = analyze(json!({
        "op": "view", "foldDepth": 1,
        "folds": {"version": 1, "root": "world",
            "groups": {"world": {"children": ["g1", "b"]}, "g1": {"children": ["a"]}}},
    }));
    let mut node_ids: Vec<String> = folded["nodes"]
        .as_object()
        .unwrap()
        .keys()
        .cloned()
        .collect();
    node_ids.sort();
    assert_eq!(node_ids, vec!["b".to_owned(), "fold:g1".to_owned()]);
    let folded_routes: Vec<String> = folded["routes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|route| route["id"].as_str().unwrap().to_owned())
        .collect();
    assert_eq!(
        folded_routes,
        vec![
            "route:b->b:TickInfo".to_owned(),
            "route:fold:g1->b:TickInfo".to_owned(),
        ]
    );

    let chain = analyze(json!({"op": "path", "addresses": ["node:a", "node:b"]}));
    assert_eq!(chain["connected"], json!(true));
    assert_eq!(
        chain["segments"][0]["diagnostics"]["status"],
        json!("found")
    );
    assert_eq!(
        chain["segments"][0]["diagnostics"]["shortestDistance"],
        json!(2)
    );
}

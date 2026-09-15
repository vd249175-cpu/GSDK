use std::io::{BufRead, BufReader, Write};
use std::net::TcpStream;
use std::process::{Child, Command, Stdio};
use std::thread;
use std::time::Duration;

use serde_json::{json, Value};

struct Daemon {
    child: Child,
    address: String,
}

impl Daemon {
    fn start() -> Self {
        let mut child = Command::new(env!("CARGO_BIN_EXE_graphvideo-kernel-daemon"))
            .env("GRAPHVIDEO_DAEMON_TOKEN", "fixture-secret-0001")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("start daemon");
        let mut line = String::new();
        BufReader::new(child.stdout.take().unwrap())
            .read_line(&mut line)
            .expect("read daemon address");
        let ready: Value = serde_json::from_str(&line).expect("daemon ready JSON");
        Self {
            child,
            address: ready["address"].as_str().unwrap().to_owned(),
        }
    }

    fn connect(&self) -> Client {
        let stream = TcpStream::connect(&self.address).expect("connect to daemon");
        stream
            .set_read_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        Client {
            reader: BufReader::new(stream.try_clone().unwrap()),
            writer: stream,
            next_id: 0,
        }
    }
}

impl Drop for Daemon {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

struct Client {
    reader: BufReader<TcpStream>,
    writer: TcpStream,
    next_id: u64,
}

impl Client {
    fn request(&mut self, op: &str, args: Value) -> Value {
        self.next_id += 1;
        let mut request =
            json!({"version":1,"id":self.next_id,"token":"fixture-secret-0001","op":op});
        request
            .as_object_mut()
            .unwrap()
            .extend(args.as_object().unwrap().clone());
        writeln!(self.writer, "{request}").unwrap();
        let mut line = String::new();
        self.reader.read_line(&mut line).expect("daemon response");
        let response: Value = serde_json::from_str(&line).expect("response JSON");
        assert_eq!(response["id"], self.next_id);
        response
    }

    fn call(&mut self, op: &str, args: Value) -> Value {
        let response = self.request(op, args);
        assert_eq!(response["ok"], true, "{response}");
        response["result"].clone()
    }
}

#[test]
fn unauthorized_and_invalid_changes_do_not_mutate_state() {
    let daemon = Daemon::start();
    let mut client = daemon.connect();
    let unauthorized = client.request(
        "admit",
        json!({
            "token":"wrong-secret","nodeId":"bad","initialState":{}
        }),
    );
    assert_eq!(unauthorized["ok"], false);
    client.call(
        "admit",
        json!({"nodeId":"owner","initialState":{"count":0}}),
    );
    client.call("claim", json!({"nodeIds":["owner"]}));
    let first = client.call(
        "inject",
        json!({
            "targetNodeId":"owner","info":{"type":"IncrementInfo"},"submissionId":"s1"
        }),
    );
    assert_eq!(first["duplicate"], false);
    let duplicate = client.call(
        "inject",
        json!({
            "targetNodeId":"owner","info":{"type":"IncrementInfo"},"submissionId":"s1"
        }),
    );
    assert_eq!(duplicate["duplicate"], true);
    let change = client.call("poll", json!({}));
    assert_eq!(change["change"]["nodeId"], "owner");
    let invalid = client.request(
        "commit",
        json!({
            "changeId":change["change"]["changeId"],"operations":[
                {"op":"write","key":"count","value":1},
                {"op":"send","targetNodeId":"owner","info":{"bad":true}}
            ]
        }),
    );
    assert_eq!(invalid["ok"], false);
    assert_eq!(
        client.call("projection", json!({}))["nodes"]["owner"]["state"]["count"],
        0
    );
    client.call(
        "commit",
        json!({"changeId":change["change"]["changeId"],"operations":[]}),
    );
    assert_eq!(client.call("poll", json!({})), Value::Null);
}

#[test]
fn state_intervention_uses_generation_and_version_preconditions() {
    let daemon = Daemon::start();
    let mut client = daemon.connect();
    client.call(
        "admit",
        json!({"nodeId":"owner","initialState":{"count":0}}),
    );
    let edited = client.call(
        "intervene",
        json!({
            "nodeId":"owner","patch":{"count":5},"expectedGeneration":0,"expectedVersion":0
        }),
    );
    assert_eq!(edited["version"], 1);
    assert_eq!(edited["state"]["count"], 5);
    let conflict = client.request(
        "intervene",
        json!({
            "nodeId":"owner","patch":{"count":9},"expectedGeneration":0,"expectedVersion":0
        }),
    );
    assert_eq!(conflict["ok"], false);
    assert_eq!(
        client.call("projection", json!({}))["nodes"]["owner"]["state"]["count"],
        5
    );
}

#[test]
fn node_claim_is_exclusive_and_released_when_the_worker_disconnects() {
    let daemon = Daemon::start();
    let mut owner = daemon.connect();
    owner.call("admit", json!({"nodeId":"worker.node","initialState":{}}));
    owner.call("claim", json!({"nodeIds":["worker.node"]}));

    let mut contender = daemon.connect();
    let conflict = contender.request("claim", json!({"nodeIds":["worker.node"]}));
    assert_eq!(conflict["ok"], false);
    drop(owner);
    let mut reclaimed = false;
    for _ in 0..20 {
        let response = contender.request("claim", json!({"nodeIds":["worker.node"]}));
        if response["ok"] == true {
            reclaimed = true;
            break;
        }
        thread::sleep(Duration::from_millis(5));
    }
    assert!(reclaimed, "worker lease was not released after disconnect");
    assert_eq!(contender.call("health", json!({}))["leases"], 1);
}

#[test]
fn long_poll_wakes_when_another_client_injects_work() {
    let daemon = Daemon::start();
    let mut control = daemon.connect();
    control.call("admit", json!({"nodeId":"worker.node","initialState":{}}));
    let mut worker = daemon.connect();
    worker.call("claim", json!({"nodeIds":["worker.node"]}));
    let waiting = thread::spawn(move || worker.call("poll", json!({"waitMs":1000})));
    thread::sleep(Duration::from_millis(25));
    control.call(
        "inject",
        json!({
            "targetNodeId":"worker.node","info":{"type":"RunInfo"},"submissionId":"wake/1"
        }),
    );
    let change = waiting.join().unwrap();
    assert_eq!(change["change"]["nodeId"], "worker.node");
}

#[test]
fn effect_capability_brokers_opaque_requests_without_business_semantics() {
    let daemon = Daemon::start();
    let mut control = daemon.connect();
    control.call(
        "admit",
        json!({
            "nodeId":"world","initialState":{"result":null},
            "effectCapabilities":["fixture/effect"]
        }),
    );
    control.call(
        "inject",
        json!({
            "targetNodeId":"world","info":{"type":"RunInfo"},"submissionId":"effect/1"
        }),
    );
    let mut worker = daemon.connect();
    worker.call("claim", json!({"nodeIds":["world"]}));
    let change = worker.call("poll", json!({}));

    let unavailable = worker.request("requestEffect", json!({
        "changeId":change["change"]["changeId"],"adapterId":"fixture/effect","request":{"value":4}
    }));
    assert_eq!(unavailable["ok"], false);

    let mut provider = daemon.connect();
    provider.call("claimEffects", json!({"adapterIds":["fixture/effect"]}));
    let requested = worker.call("requestEffect", json!({
        "changeId":change["change"]["changeId"],"adapterId":"fixture/effect","request":{"value":4}
    }));
    let effect = provider.call("pollEffect", json!({}));
    assert_eq!(effect["adapterId"], "fixture/effect");
    assert_eq!(effect["request"]["value"], 4);
    provider.call(
        "completeEffect",
        json!({
            "effectId":effect["effectId"],"ok":true,"observation":{"value":8}
        }),
    );
    let observed = worker.call("awaitEffect", json!({"effectId":requested["effectId"]}));
    assert_eq!(observed, json!({"ok":true,"value":{"value":8}}));
    worker.call(
        "commit",
        json!({
            "changeId":change["change"]["changeId"],"operations":[
                {"op":"write","key":"result","value":observed["value"]}
            ]
        }),
    );
    assert_eq!(
        control.call("projection", json!({}))["nodes"]["world"]["state"]["result"]["value"],
        8
    );
}

#[test]
fn disconnecting_mid_change_releases_single_flight_and_routes_an_error_info() {
    let daemon = Daemon::start();
    let mut worker = daemon.connect();
    worker.call("admit", json!({"nodeId":"owner","initialState":{}}));
    worker.call("admit", json!({"nodeId":"errors","initialState":{}}));
    worker.call("setErrorTarget", json!({"nodeId":"errors"}));
    worker.call("claim", json!({"nodeIds":["owner"]}));
    worker.call(
        "inject",
        json!({
            "targetNodeId":"owner","info":{"type":"RunInfo"},"submissionId":"s1"
        }),
    );
    let change = worker.call("poll", json!({}));
    assert_eq!(change["change"]["nodeId"], "owner");
    drop(worker);

    let mut recovery = daemon.connect();
    recovery.call("claim", json!({"nodeIds":["errors"]}));
    let error = recovery.call("poll", json!({"waitMs":1000}));
    assert_eq!(error["change"]["nodeId"], "errors");
    assert_eq!(error["change"]["info"]["type"], "@error/NodeFailed");
    assert_eq!(error["change"]["info"]["nodeId"], "owner");
    recovery.call(
        "commit",
        json!({"changeId":error["change"]["changeId"],"operations":[]}),
    );
    assert_eq!(
        recovery.call("projection", json!({}))["submissions"]["s1"]["status"],
        "completed"
    );
}

#[test]
fn state_and_causal_queue_survive_a_client_disconnect() {
    let daemon = Daemon::start();
    let pid = daemon.child.id();
    let mut first = daemon.connect();
    first.call(
        "admit",
        json!({"nodeId":"source","initialState":{"count":0}}),
    );
    first.call("admit", json!({"nodeId":"sink","initialState":{"seen":0}}));
    first.call("claim", json!({"nodeIds":["source"]}));
    first.call(
        "inject",
        json!({"targetNodeId":"source","info":{"type":"IncrementInfo"},"submissionId":"s1"}),
    );
    let source = first.call("poll", json!({}));
    assert_eq!(source["change"]["nodeId"], "source");
    assert_eq!(source["state"]["count"], 0);
    first.call(
        "commit",
        json!({"changeId":source["change"]["changeId"],"operations":[
            {"op":"write","key":"count","value":1},
            {"op":"send","targetNodeId":"sink","info":{"type":"CountChangedInfo","count":1}}
        ]}),
    );
    drop(first);

    let mut second = daemon.connect();
    assert_eq!(second.call("health", json!({}))["pid"], pid);
    second.call("claim", json!({"nodeIds":["sink"]}));
    let sink = second.call("poll", json!({}));
    assert_eq!(sink["change"]["nodeId"], "sink");
    assert_eq!(sink["change"]["info"]["count"], 1);
    second.call(
        "commit",
        json!({"changeId":sink["change"]["changeId"],"operations":[
            {"op":"write","key":"seen","value":1}
        ]}),
    );
    let projection = second.call("projection", json!({}));
    assert_eq!(projection["nodes"]["source"]["state"]["count"], 1);
    assert_eq!(projection["nodes"]["sink"]["state"]["seen"], 1);
    assert_eq!(projection["submissions"]["s1"]["status"], "completed");
}

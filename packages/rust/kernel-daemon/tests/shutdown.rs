use graphvideo_kernel_daemon::{Session, Space};
use serde_json::{json, Value};

fn call(space: &mut Space, session: &mut Session, op: &str, args: Value) -> Value {
    let mut request = json!({"version":1,"id":1,"token":"fixture-secret-0001","op":op});
    request.as_object_mut().unwrap().extend(args.as_object().unwrap().clone());
    space.handle(session, &request, "fixture-secret-0001")
}

#[test]
fn shutdown_requires_explicit_eviction_and_is_terminal() {
    let mut space = Space::default();
    let mut owner = Session::new(1);
    assert_eq!(call(&mut space, &mut owner, "admit", json!({"nodeId":"owner","initialState":{}}))["ok"], true);
    assert_eq!(call(&mut space, &mut owner, "shutdown", json!({}))["ok"], false);
    call(&mut space, &mut owner, "evict", json!({"nodeId":"owner"}));
    assert_eq!(call(&mut space, &mut owner, "shutdown", json!({}))["ok"], true);
    assert!(space.is_closed());
    assert_eq!(call(&mut space, &mut owner, "shutdown", json!({}))["ok"], true);
    assert_eq!(call(&mut space, &mut owner, "admit", json!({"nodeId":"late","initialState":{}}))["ok"], false);
}

#[test]
fn disconnect_and_unauthorized_requests_do_not_shutdown() {
    let mut space = Space::default();
    let mut owner = Session::new(1);
    owner.disconnect(&mut space);
    assert!(!space.is_closed());
    let unauthorized = call(&mut space, &mut owner, "shutdown", json!({"token":"wrong-secret"}));
    assert_eq!(unauthorized["ok"], false);
    assert!(!space.is_closed());
}

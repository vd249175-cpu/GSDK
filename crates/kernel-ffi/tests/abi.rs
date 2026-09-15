use std::ffi::{CStr, CString};

use graphvideo_kernel_ffi::*;

fn c(value: &str) -> CString {
    CString::new(value).unwrap()
}

#[test]
fn c_abi_drives_changes_and_exposes_generation_scoped_analysis_facts() {
    assert_eq!(gv_abi_version(), 1);
    let kernel = gv_kernel_new();
    let source = c("foreign");
    let target = c("target");
    let work = c("WorkInfo");
    let done = c("DoneInfo");
    let submission = c("sub/foreign");
    let facts = c("{\"version\":1,\"nodeId\":\"foreign\"}");
    assert_eq!(gv_admit(kernel, source.as_ptr()), 0);
    assert_eq!(gv_admit(kernel, target.as_ptr()), 0);
    assert!(gv_set_analysis_facts(
        kernel,
        source.as_ptr(),
        0,
        facts.as_ptr()
    ));
    assert_eq!(
        gv_inject_root(
            kernel,
            source.as_ptr(),
            work.as_ptr(),
            std::ptr::null(),
            submission.as_ptr()
        ),
        0
    );
    let first = gv_poll_next(kernel);
    assert!(!first.is_null());
    let change_id = unsafe { (*first).change_id };
    assert_eq!(
        gv_send(
            kernel,
            source.as_ptr(),
            done.as_ptr(),
            std::ptr::null(),
            target.as_ptr(),
            change_id,
            true,
            submission.as_ptr()
        ),
        0
    );
    assert!(gv_settle_change(kernel, first, std::ptr::null()));
    let second = gv_poll_next(kernel);
    assert!(!second.is_null());
    assert_eq!(
        unsafe { CStr::from_ptr((*second).info_type).to_str().unwrap() },
        "DoneInfo"
    );
    assert!(gv_settle_change(kernel, second, std::ptr::null()));
    assert_eq!(gv_pending_total(kernel), 0);
    let snapshot = gv_analysis_facts(kernel, source.as_ptr());
    assert_eq!(
        unsafe { CStr::from_ptr(snapshot).to_str().unwrap() },
        facts.to_str().unwrap()
    );
    gv_string_free(snapshot);
    let all = gv_analysis_snapshot(kernel);
    assert_eq!(unsafe { (*all).len }, 1);
    let entry = unsafe { &*(*all).entries };
    assert_eq!(
        unsafe { CStr::from_ptr(entry.entity).to_str().unwrap() },
        "foreign"
    );
    gv_analysis_snapshot_free(all);
    assert_eq!(gv_replace(kernel, source.as_ptr()), 1);
    assert!(gv_analysis_facts(kernel, source.as_ptr()).is_null());
    assert!(!gv_set_analysis_facts(
        kernel,
        source.as_ptr(),
        0,
        facts.as_ptr()
    ));
    gv_kernel_free(kernel);
}

/// The generic JSON analysis entry shares the daemon's crate call: the same
/// request over the same facts returns the same key-sorted route DTO.
#[test]
fn c_abi_analysis_matches_the_shared_rust_compute() {
    let request = c("{\"op\":\"view\"}");
    let facts = c("{\"snapshots\":[{\"version\":1,\"nodeId\":\"a\",\"entities\":[{\"address\":\"node:a\",\"kind\":\"node\",\"id\":\"a\"},{\"address\":\"change:a::TickInfo\",\"kind\":\"change\",\"id\":\"a\",\"nodeId\":\"a\",\"subId\":\"TickInfo\"},{\"address\":\"info:TickInfo@b\",\"kind\":\"info\",\"id\":\"TickInfo\",\"nodeId\":\"b\",\"subId\":\"b\"}],\"edges\":[{\"id\":\"e1\",\"from\":\"change:a::TickInfo\",\"to\":\"info:TickInfo@b\",\"type\":\"send\",\"confidence\":\"high\"}]}],\"liveStates\":{\"a\":{\"count\":0},\"b\":{}}}");
    let raw = gv_analyze(request.as_ptr(), facts.as_ptr());
    assert!(!raw.is_null());
    let text = unsafe { CStr::from_ptr(raw).to_str().unwrap().to_owned() };
    gv_analysis_free(raw);
    let value: serde_json::Value = serde_json::from_str(&text).unwrap();
    let routes: Vec<&str> = value["routes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|route| route["id"].as_str().unwrap())
        .collect();
    // `b` is synthesized from live State as an opaque handler; the send
    // route survives with its witness.
    assert_eq!(routes, vec!["route:a->b:TickInfo"]);
    assert_eq!(value["routes"][0]["routeCount"], serde_json::json!(1));
    // Invalid input is NULL, never a daemon party trick: no crash, no string.
    let bad = gv_analyze(c("{\"op\":\"nope\"}").as_ptr(), facts.as_ptr());
    assert!(bad.is_null());
}

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

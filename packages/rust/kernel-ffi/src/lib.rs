//! C ABI for hosts written in languages other than Rust or JavaScript.
//! The host owns business State and change execution; this crate owns the
//! same Rust scheduler used by the N-API facade. Each handle is synchronized.

use std::ffi::{c_char, CStr, CString};
use std::ptr;
use std::sync::Mutex;

use graphvideo_kernel::{
    ActiveChange, ChangeOutcome, DeliveryFeedback, DropReason, Kernel, SubmissionState,
};

pub struct GvKernel {
    inner: Mutex<Kernel>,
}

#[repr(C)]
pub struct GvChange {
    pub change_id: u64,
    pub info_id: u64,
    pub caused_by: u64,
    pub has_caused_by: bool,
    pub generation: u64,
    pub entity: *mut c_char,
    pub info_type: *mut c_char,
    pub sender: *mut c_char,
    pub payload_json: *mut c_char,
    pub submission: *mut c_char,
}

#[repr(C)]
pub struct GvAnalysisEntry {
    pub entity: *mut c_char,
    pub facts_json: *mut c_char,
}

#[repr(C)]
pub struct GvAnalysisSnapshot {
    pub len: usize,
    pub entries: *mut GvAnalysisEntry,
}

fn input(ptr: *const c_char) -> Option<String> {
    if ptr.is_null() {
        return None;
    }
    // SAFETY: callers must pass a valid NUL-terminated UTF-8 string.
    unsafe { CStr::from_ptr(ptr).to_str().ok().map(str::to_owned) }
}

fn output(value: String) -> *mut c_char {
    CString::new(value)
        .map(CString::into_raw)
        .unwrap_or(ptr::null_mut())
}

fn optional_output(value: Option<String>) -> *mut c_char {
    value.map(output).unwrap_or(ptr::null_mut())
}

fn feedback_code(feedback: DeliveryFeedback) -> i32 {
    match feedback {
        DeliveryFeedback::Enqueued => 0,
        DeliveryFeedback::Dropped(DropReason::UnknownTarget) => 1,
        DeliveryFeedback::Dropped(DropReason::SealedTarget) => 2,
        DeliveryFeedback::Dropped(DropReason::StaleGeneration) => 3,
        DeliveryFeedback::Dropped(DropReason::Cancelled) => 4,
        DeliveryFeedback::Dropped(DropReason::Evicted) => 5,
    }
}

fn with_mut<R>(handle: *mut GvKernel, fallback: R, action: impl FnOnce(&mut Kernel) -> R) -> R {
    // SAFETY: ownership stays with the caller until gv_kernel_free.
    let Some(space) = (unsafe { handle.as_ref() }) else {
        return fallback;
    };
    let Ok(mut kernel) = space.inner.lock() else {
        return fallback;
    };
    action(&mut kernel)
}

#[no_mangle]
pub extern "C" fn gv_kernel_new() -> *mut GvKernel {
    Box::into_raw(Box::new(GvKernel {
        inner: Mutex::new(Kernel::new()),
    }))
}

#[no_mangle]
pub extern "C" fn gv_abi_version() -> u32 {
    1
}

#[no_mangle]
/// # Safety
/// `handle` must be null or the unique live pointer returned by
/// `gv_kernel_new`; it must not be used after this call.
pub unsafe extern "C" fn gv_kernel_free(handle: *mut GvKernel) {
    if !handle.is_null() {
        // SAFETY: the caller transfers its one live handle back here.
        unsafe {
            drop(Box::from_raw(handle));
        }
    }
}

#[no_mangle]
pub extern "C" fn gv_admit(handle: *mut GvKernel, id: *const c_char) -> i64 {
    let Some(id) = input(id) else {
        return -1;
    };
    with_mut(handle, -1, |kernel| {
        kernel.admit(id).map(|value| value as i64).unwrap_or(-1)
    })
}

#[no_mangle]
pub extern "C" fn gv_evict(handle: *mut GvKernel, id: *const c_char) -> bool {
    let Some(id) = input(id) else {
        return false;
    };
    with_mut(handle, false, |kernel| kernel.evict(&id))
}

#[no_mangle]
pub extern "C" fn gv_replace(handle: *mut GvKernel, id: *const c_char) -> i64 {
    let Some(id) = input(id) else {
        return -1;
    };
    with_mut(handle, -1, |kernel| {
        kernel.replace(&id).map(|value| value as i64).unwrap_or(-1)
    })
}

#[no_mangle]
pub extern "C" fn gv_generation(handle: *mut GvKernel, id: *const c_char) -> i64 {
    let Some(id) = input(id) else {
        return -1;
    };
    with_mut(handle, -1, |kernel| {
        kernel
            .generation(&id)
            .map(|value| value as i64)
            .unwrap_or(-1)
    })
}

#[no_mangle]
pub extern "C" fn gv_begin_edit(handle: *mut GvKernel, id: *const c_char) -> i64 {
    let Some(id) = input(id) else {
        return -1;
    };
    with_mut(handle, -1, |kernel| {
        kernel
            .begin_edit(&id)
            .map(|value| value as i64)
            .unwrap_or(-1)
    })
}

#[no_mangle]
pub extern "C" fn gv_end_edit(handle: *mut GvKernel, id: *const c_char, generation: u64) -> bool {
    let Some(id) = input(id) else {
        return false;
    };
    with_mut(handle, false, |kernel| kernel.end_edit(&id, generation))
}

#[no_mangle]
pub extern "C" fn gv_abort_edit(handle: *mut GvKernel, id: *const c_char) {
    if let Some(id) = input(id) {
        with_mut(handle, (), |kernel| kernel.abort_edit(&id));
    }
}

#[no_mangle]
pub extern "C" fn gv_send(
    handle: *mut GvKernel,
    sender: *const c_char,
    info_type: *const c_char,
    payload_json: *const c_char,
    target: *const c_char,
    caused_by: u64,
    has_caused_by: bool,
    submission: *const c_char,
) -> i32 {
    let (Some(sender), Some(info_type), Some(target)) =
        (input(sender), input(info_type), input(target))
    else {
        return -1;
    };
    with_mut(handle, -1, |kernel| {
        feedback_code(kernel.send_json(
            sender,
            info_type,
            input(payload_json),
            &target,
            has_caused_by.then_some(caused_by),
            input(submission),
        ))
    })
}

#[no_mangle]
pub extern "C" fn gv_inject_root(
    handle: *mut GvKernel,
    target: *const c_char,
    info_type: *const c_char,
    payload_json: *const c_char,
    submission: *const c_char,
) -> i32 {
    let (Some(target), Some(info_type), Some(submission)) =
        (input(target), input(info_type), input(submission))
    else {
        return -1;
    };
    with_mut(handle, -1, |kernel| {
        feedback_code(kernel.inject_root_json(&target, info_type, input(payload_json), submission))
    })
}

#[no_mangle]
pub extern "C" fn gv_poll_next(handle: *mut GvKernel) -> *mut GvChange {
    with_mut(handle, ptr::null_mut(), |kernel| {
        let Some((token, view)) = kernel.poll_next() else {
            return ptr::null_mut();
        };
        Box::into_raw(Box::new(GvChange {
            change_id: token.change_id(),
            info_id: view.info_id,
            caused_by: view.caused_by.unwrap_or(0),
            has_caused_by: view.caused_by.is_some(),
            generation: view.generation,
            entity: output(view.entity),
            info_type: output(view.info_type),
            sender: output(view.sender),
            payload_json: optional_output(view.payload_json),
            submission: optional_output(view.submission),
        }))
    })
}

#[no_mangle]
/// # Safety
/// `change` must be the unique unconsumed pointer returned by `gv_poll_next`.
/// All string pointers must be null or valid NUL-terminated UTF-8 strings.
pub unsafe extern "C" fn gv_settle_change(
    handle: *mut GvKernel,
    change: *mut GvChange,
    failed_message: *const c_char,
) -> bool {
    if change.is_null() {
        return false;
    }
    // SAFETY: this function consumes the one polled change allocation.
    let change = unsafe { Box::from_raw(change) };
    let Some(entity) = input(change.entity) else {
        free_change_fields(&change);
        return false;
    };
    let submission = input(change.submission);
    let token = ActiveChange::from_parts(change.change_id, entity, change.generation, submission);
    let outcome = input(failed_message)
        .map(ChangeOutcome::Failed)
        .unwrap_or(ChangeOutcome::Completed);
    free_change_fields(&change);
    with_mut(handle, false, |kernel| kernel.settle_change(token, outcome))
}

fn free_change_fields(change: &GvChange) {
    for value in [
        change.entity,
        change.info_type,
        change.sender,
        change.payload_json,
        change.submission,
    ] {
        // SAFETY: every field was allocated by output / optional_output and
        // this helper is called exactly once while consuming the change.
        unsafe { gv_string_free(value) };
    }
}

#[no_mangle]
/// # Safety
/// `change` must be null or the unique unconsumed pointer returned by
/// `gv_poll_next`; it must not be used after this call.
pub unsafe extern "C" fn gv_change_free(change: *mut GvChange) {
    if !change.is_null() {
        // SAFETY: the caller returns one unconsumed polled change.
        let change = unsafe { Box::from_raw(change) };
        free_change_fields(&change);
    }
}

#[no_mangle]
pub extern "C" fn gv_cancel(handle: *mut GvKernel, submission: *const c_char) -> bool {
    let Some(submission) = input(submission) else {
        return false;
    };
    with_mut(handle, false, |kernel| kernel.cancel(&submission))
}

#[no_mangle]
pub extern "C" fn gv_pending_total(handle: *mut GvKernel) -> usize {
    with_mut(handle, 0, |kernel| kernel.pending_total())
}

#[no_mangle]
pub extern "C" fn gv_submission_state(
    handle: *mut GvKernel,
    submission: *const c_char,
) -> *mut c_char {
    let Some(submission) = input(submission) else {
        return ptr::null_mut();
    };
    with_mut(handle, ptr::null_mut(), |kernel| {
        optional_output(
            kernel
                .submission_state(&submission)
                .map(|state| match state {
                    SubmissionState::Open { pending } => format!("open:{pending}"),
                    SubmissionState::Completed => "completed".to_owned(),
                    SubmissionState::Cancelled => "cancelled".to_owned(),
                    SubmissionState::Failed(message) => format!("failed:{message}"),
                }),
        )
    })
}

#[no_mangle]
pub extern "C" fn gv_set_analysis_facts(
    handle: *mut GvKernel,
    id: *const c_char,
    generation: u64,
    facts_json: *const c_char,
) -> bool {
    let (Some(id), Some(facts_json)) = (input(id), input(facts_json)) else {
        return false;
    };
    with_mut(handle, false, |kernel| {
        kernel
            .set_analysis_facts(&id, generation, facts_json)
            .is_ok()
    })
}

#[no_mangle]
pub extern "C" fn gv_analysis_facts(handle: *mut GvKernel, id: *const c_char) -> *mut c_char {
    let Some(id) = input(id) else {
        return ptr::null_mut();
    };
    with_mut(handle, ptr::null_mut(), |kernel| {
        optional_output(kernel.analysis_facts(&id).map(str::to_owned))
    })
}

#[no_mangle]
pub extern "C" fn gv_analysis_snapshot(handle: *mut GvKernel) -> *mut GvAnalysisSnapshot {
    with_mut(handle, ptr::null_mut(), |kernel| {
        let entries: Box<[GvAnalysisEntry]> = kernel
            .all_analysis_facts()
            .into_iter()
            .map(|(entity, facts_json)| GvAnalysisEntry {
                entity: output(entity),
                facts_json: output(facts_json),
            })
            .collect::<Vec<_>>()
            .into_boxed_slice();
        let len = entries.len();
        let entries = Box::into_raw(entries) as *mut GvAnalysisEntry;
        Box::into_raw(Box::new(GvAnalysisSnapshot { len, entries }))
    })
}

#[no_mangle]
/// # Safety
/// `snapshot` must be null or the unique pointer returned by
/// `gv_analysis_snapshot`; it must not be used after this call.
pub unsafe extern "C" fn gv_analysis_snapshot_free(snapshot: *mut GvAnalysisSnapshot) {
    if snapshot.is_null() {
        return;
    }
    // SAFETY: caller returns the one snapshot allocation from gv_analysis_snapshot.
    let snapshot = unsafe { Box::from_raw(snapshot) };
    let entries = ptr::slice_from_raw_parts_mut(snapshot.entries, snapshot.len);
    // SAFETY: entries was created by Box::into_raw on a boxed slice.
    let entries = unsafe { Box::from_raw(entries) };
    for entry in entries.iter() {
        // SAFETY: both strings are owned by this consumed snapshot entry.
        unsafe {
            gv_string_free(entry.entity);
            gv_string_free(entry.facts_json);
        }
    }
}

#[no_mangle]
/// # Safety
/// `value` must be null or the unique pointer returned by a `gv_*` string
/// function; it must not be used after this call.
pub unsafe extern "C" fn gv_string_free(value: *mut c_char) {
    if !value.is_null() {
        // SAFETY: this pointer was returned by output / optional_output.
        unsafe {
            drop(CString::from_raw(value));
        }
    }
}

/// Authoritative analysis compute over portable facts, shared with the daemon
/// and the N-API facade. `request_json` is one supported analysis request DTO;
/// `facts_json` carries `{snapshots:[], liveStates:{}}` plus
/// optional `frontendLinks` / `frontendServiceLinks` context arrays (a bare
/// snapshot array is also accepted). Returns key-sorted result JSON, or NULL
/// on invalid input; free with `gv_analysis_free`. No algorithms live here.
#[no_mangle]
pub extern "C" fn gv_analyze(
    request_json: *const c_char,
    facts_json: *const c_char,
) -> *mut c_char {
    let (Some(request_text), Some(facts_text)) = (input(request_json), input(facts_json)) else {
        return ptr::null_mut();
    };
    let (Ok(request), Ok(facts_value)) = (
        serde_json::from_str::<serde_json::Value>(&request_text),
        serde_json::from_str::<serde_json::Value>(&facts_text),
    ) else {
        return ptr::null_mut();
    };
    let (facts, context) = split_facts_context(&facts_value);
    match graphvideo_analysis::analyze_json(&request, &facts, &context) {
        Ok(value) => output(value.to_string()),
        Err(_) => ptr::null_mut(),
    }
}

fn split_facts_context(value: &serde_json::Value) -> (serde_json::Value, serde_json::Value) {
    if value.is_array() {
        return (
            serde_json::json!({"snapshots": value, "liveStates": {}}),
            serde_json::json!({"frontendLinks": [], "frontendServiceLinks": []}),
        );
    }
    let facts = serde_json::json!({
        "snapshots": value.get("snapshots").cloned().unwrap_or_else(|| serde_json::json!([])),
        "liveStates": value.get("liveStates").cloned().unwrap_or_else(|| serde_json::json!({})),
    });
    let context = serde_json::json!({
        "frontendLinks": value.get("frontendLinks").cloned().unwrap_or_else(|| serde_json::json!([])),
        "frontendServiceLinks": value.get("frontendServiceLinks").cloned().unwrap_or_else(|| serde_json::json!([])),
    });
    (facts, context)
}

/// Free a string returned by `gv_analyze`. Aliases `gv_string_free`.
///
/// # Safety
/// `value` must be null or the unique pointer returned by `gv_analyze`; it
/// must not be used after this call.
#[no_mangle]
pub unsafe extern "C" fn gv_analysis_free(value: *mut c_char) {
    // SAFETY: this function has the same ownership contract as the alias.
    unsafe { gv_string_free(value) };
}

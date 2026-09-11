//! M1 acceptance: scheduling and entity turnover on the Rust core.
//!
//! Mirrors the TS reference semantics (admit/evict, enqueued|dropped,
//! single-flight, exact settlement, cancel) with deterministic stubs.

use graphvideo_kernel::{
    BeginError, ChangeOutcome, DeliveryFeedback, DropReason, Kernel, KernelError, SubmissionState,
};

fn enqueued(feedback: DeliveryFeedback) {
    assert_eq!(feedback, DeliveryFeedback::Enqueued);
}

#[test]
fn admits_entities_with_zero_generation_and_rejects_duplicates() {
    let mut kernel = Kernel::new();
    assert_eq!(kernel.admit("a".to_owned()), Ok(0));
    assert!(kernel.admit("a".to_owned()).is_err());
    assert_eq!(kernel.generation("a"), Some(0));
}

#[test]
fn drops_sends_to_missing_targets_without_hanging() {
    let mut kernel = Kernel::new();
    let feedback = kernel.inject_root("ghost", "PingInfo".to_owned(), "sub/1".to_owned());
    assert_eq!(
        feedback,
        DeliveryFeedback::Dropped(DropReason::UnknownTarget)
    );
    assert_eq!(kernel.pending_total(), 0);
    assert_eq!(
        kernel.submission_state("sub/1"),
        Some(SubmissionState::Completed)
    );
    assert_eq!(kernel.drops().len(), 1);
    assert_eq!(kernel.drops()[0].reason, DropReason::UnknownTarget);
}

#[test]
fn holds_single_flight_on_one_entity_while_others_progress() {
    let mut kernel = Kernel::new();
    kernel.admit("slow".to_owned()).unwrap();
    kernel.admit("fast".to_owned()).unwrap();
    enqueued(kernel.send(
        "external-root".to_owned(),
        "WorkInfo".to_owned(),
        "slow",
        None,
        Some("sub/slow".to_owned()),
    ));
    enqueued(kernel.send(
        "external-root".to_owned(),
        "WorkInfo".to_owned(),
        "fast",
        None,
        Some("sub/fast".to_owned()),
    ));
    let (token, view) = kernel.begin_change("slow").expect("slow opens");
    assert_eq!(view.entity, "slow");
    assert_eq!(view.info_type, "WorkInfo");
    assert!(matches!(
        kernel.begin_change("slow"),
        Err(BeginError::Busy(_))
    ));
    let (fast_token, _) = kernel
        .begin_change("fast")
        .expect("fast runs independently");
    assert!(kernel.settle_change(fast_token, ChangeOutcome::Completed));
    assert_eq!(
        kernel.submission_state("sub/fast"),
        Some(SubmissionState::Completed)
    );
    assert!(kernel.settle_change(token, ChangeOutcome::Completed));
    assert_eq!(
        kernel.submission_state("sub/slow"),
        Some(SubmissionState::Completed)
    );
    assert_eq!(kernel.pending_total(), 0);
}

#[test]
fn settles_every_counted_delivery_exactly_once() {
    let mut kernel = Kernel::new();
    kernel.admit("worker".to_owned()).unwrap();
    for index in 0..5 {
        enqueued(kernel.inject_root(
            "worker",
            format!("WorkInfo#{index}"),
            "sub/batch".to_owned(),
        ));
    }
    let ran = kernel.pump_until_idle(|_| ChangeOutcome::Completed);
    assert_eq!(ran, 5);
    assert_eq!(
        kernel.submission_state("sub/batch"),
        Some(SubmissionState::Completed)
    );
    assert_eq!(kernel.pending_total(), 0);
    assert!(kernel.drops().is_empty());
}

#[test]
fn records_business_failure_without_cancelling_siblings() {
    let mut kernel = Kernel::new();
    kernel.admit("failer".to_owned()).unwrap();
    kernel.admit("sibling".to_owned()).unwrap();
    enqueued(kernel.inject_root("failer", "WorkInfo".to_owned(), "sub/1".to_owned()));
    enqueued(kernel.inject_root("sibling", "WorkInfo".to_owned(), "sub/1".to_owned()));
    let ran = kernel.pump_until_idle(|view| {
        if view.entity == "failer" {
            ChangeOutcome::Failed("boom".to_owned())
        } else {
            ChangeOutcome::Completed
        }
    });
    assert_eq!(ran, 2);
    assert_eq!(
        kernel.submission_state("sub/1"),
        Some(SubmissionState::Failed("boom".to_owned()))
    );
    assert_eq!(kernel.pending_total(), 0);
}

#[test]
fn cancels_queued_work_while_in_flight_settles_normally() {
    let mut kernel = Kernel::new();
    kernel.admit("worker".to_owned()).unwrap();
    enqueued(kernel.inject_root("worker", "FirstInfo".to_owned(), "sub/1".to_owned()));
    enqueued(kernel.inject_root("worker", "SecondInfo".to_owned(), "sub/1".to_owned()));
    assert!(kernel.cancel("sub/1"));
    assert!(!kernel.cancel("missing"));
    let ran = kernel.pump_until_idle(|_| ChangeOutcome::Completed);
    assert_eq!(ran, 0);
    assert_eq!(
        kernel.submission_state("sub/1"),
        Some(SubmissionState::Cancelled)
    );
    assert_eq!(kernel.pending_total(), 0);
    assert!(kernel
        .drops()
        .iter()
        .all(|drop| drop.reason == DropReason::Cancelled));
}

#[test]
fn evicts_backlog_as_dropped_and_readmits_with_next_generation() {
    let mut kernel = Kernel::new();
    kernel.admit("worker".to_owned()).unwrap();
    enqueued(kernel.inject_root("worker", "KeepInfo".to_owned(), "sub/old".to_owned()));
    enqueued(kernel.inject_root("worker", "DropInfo".to_owned(), "sub/old".to_owned()));
    let (token, _) = kernel.begin_change("worker").expect("first opens");
    assert!(kernel.evict("worker"));
    assert!(!kernel.evict("worker"));
    assert_eq!(kernel.generation("worker"), Some(1));
    assert!(kernel.settle_change(token, ChangeOutcome::Completed));
    assert_eq!(
        kernel.submission_state("sub/old"),
        Some(SubmissionState::Completed)
    );
    assert_eq!(kernel.drops().len(), 1);
    assert_eq!(kernel.drops()[0].reason, DropReason::Evicted);
    assert_eq!(kernel.admit("worker".to_owned()), Ok(1));
    enqueued(kernel.inject_root("worker", "NewInfo".to_owned(), "sub/new".to_owned()));
    assert_eq!(kernel.pump_until_idle(|_| ChangeOutcome::Completed), 1);
    assert_eq!(
        kernel.submission_state("sub/new"),
        Some(SubmissionState::Completed)
    );
}

#[test]
fn freezes_sealed_queues_and_resumes_after_unseal() {
    let mut kernel = Kernel::new();
    kernel.admit("worker".to_owned()).unwrap();
    kernel.seal("worker").unwrap();
    assert_eq!(
        kernel.send(
            "source".to_owned(),
            "WorkInfo".to_owned(),
            "worker",
            None,
            None,
        ),
        DeliveryFeedback::Dropped(DropReason::SealedTarget)
    );
    assert!(matches!(
        kernel.begin_change("worker"),
        Err(BeginError::Sealed(_))
    ));
    kernel.unseal("worker").unwrap();
    enqueued(kernel.send(
        "source".to_owned(),
        "WorkInfo".to_owned(),
        "worker",
        None,
        None,
    ));
    assert_eq!(kernel.pump_until_idle(|_| ChangeOutcome::Completed), 1);
}

#[test]
fn rejects_stale_tokens_and_double_settles() {
    let mut kernel = Kernel::new();
    kernel.admit("worker".to_owned()).unwrap();
    enqueued(kernel.inject_root("worker", "WorkInfo".to_owned(), "sub/1".to_owned()));
    let (token, _) = kernel.begin_change("worker").expect("opens");
    assert!(kernel.settle_change(token.clone(), ChangeOutcome::Completed));
    assert!(!kernel.settle_change(token, ChangeOutcome::Completed));
    assert_eq!(
        kernel.submission_state("sub/1"),
        Some(SubmissionState::Completed)
    );
    assert_eq!(kernel.pending_total(), 0);
}

#[test]
fn replaces_idle_entity_dropping_backlog_and_bumping_generation() {
    let mut kernel = Kernel::new();
    kernel.admit("worker".to_owned()).unwrap();
    kernel.admit("other".to_owned()).unwrap();
    enqueued(kernel.inject_root("worker", "OldInfo".to_owned(), "sub/old".to_owned()));
    enqueued(kernel.send(
        "other".to_owned(),
        "StaleInfo".to_owned(),
        "worker",
        None,
        Some("sub/stale".to_owned()),
    ));
    enqueued(kernel.inject_root("other", "KeepInfo".to_owned(), "sub/keep".to_owned()));
    assert_eq!(kernel.replace("worker"), Ok(1));
    assert_eq!(kernel.generation("worker"), Some(1));
    assert_eq!(kernel.drops().len(), 2);
    assert!(kernel
        .drops()
        .iter()
        .all(|drop| drop.reason == DropReason::Evicted));
    assert_eq!(
        kernel.submission_state("sub/old"),
        Some(SubmissionState::Completed)
    );
    assert_eq!(
        kernel.submission_state("sub/stale"),
        Some(SubmissionState::Completed)
    );
    assert_eq!(kernel.pump_until_idle(|_| ChangeOutcome::Completed), 1);
    assert_eq!(
        kernel.submission_state("sub/keep"),
        Some(SubmissionState::Completed)
    );
    enqueued(kernel.inject_root("worker", "NewInfo".to_owned(), "sub/new".to_owned()));
    assert_eq!(kernel.pump_until_idle(|_| ChangeOutcome::Completed), 1);
    assert_eq!(
        kernel.submission_state("sub/new"),
        Some(SubmissionState::Completed)
    );
    assert_eq!(kernel.pending_total(), 0);
}

#[test]
fn refuses_replace_on_unknown_and_busy_entities() {
    let mut kernel = Kernel::new();
    assert_eq!(
        kernel.replace("ghost"),
        Err(KernelError::UnknownEntity("ghost".to_owned()))
    );
    kernel.admit("worker".to_owned()).unwrap();
    enqueued(kernel.inject_root("worker", "WorkInfo".to_owned(), "sub/1".to_owned()));
    let (token, _) = kernel.begin_change("worker").expect("opens");
    assert_eq!(
        kernel.replace("worker"),
        Err(KernelError::Busy("worker".to_owned()))
    );
    assert!(kernel.settle_change(token, ChangeOutcome::Completed));
    assert_eq!(kernel.replace("worker"), Ok(1));
    assert_eq!(
        kernel.submission_state("sub/1"),
        Some(SubmissionState::Completed)
    );
}

#[test]
fn replace_keeps_generations_monotonic_across_turnover() {
    let mut kernel = Kernel::new();
    kernel.admit("worker".to_owned()).unwrap();
    assert!(kernel.evict("worker"));
    assert_eq!(kernel.admit("worker".to_owned()), Ok(1));
    assert_eq!(kernel.replace("worker"), Ok(2));
    assert_eq!(kernel.replace("worker"), Ok(3));
    assert_eq!(kernel.generation("worker"), Some(3));
    enqueued(kernel.inject_root("worker", "WorkInfo".to_owned(), "sub/1".to_owned()));
    assert_eq!(kernel.pump_until_idle(|_| ChangeOutcome::Completed), 1);
    assert_eq!(
        kernel.submission_state("sub/1"),
        Some(SubmissionState::Completed)
    );
}

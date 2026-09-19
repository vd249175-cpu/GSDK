use graphframework_kernel::{ChangeOutcome, DeliveryFeedback, DropReason, Kernel, KernelError};

#[test]
fn shutdown_is_explicit_empty_only_and_terminal() {
    let mut kernel = Kernel::new();
    kernel.admit("owner".into()).unwrap();
    assert!(kernel.shutdown().is_err());
    kernel.inject_root("owner", "Work".into(), "root".into());
    let (active, _) = kernel.poll_next().unwrap();
    kernel.evict("owner");
    assert!(kernel.shutdown().is_err());
    kernel.settle_change(active, ChangeOutcome::Completed);
    assert_eq!(kernel.shutdown(), Ok(()));
    assert_eq!(kernel.shutdown(), Ok(()));
    assert_eq!(kernel.admit("owner".into()), Err(KernelError::Shutdown));
    assert_eq!(kernel.inject_root("owner", "Late".into(), "late".into()),
        DeliveryFeedback::Dropped(DropReason::KernelShutdown));
    assert!(kernel.poll_next().is_none());
    assert_eq!(kernel.pending_total(), 0);
}

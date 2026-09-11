//! Physical rule space: zero business semantics.
//!
//! Owns entity registry, mailboxes, single-flight dispatch, submissions and
//! the drop ledger. Business `change` code runs outside (JS entities in M2,
//! deterministic stubs in tests); this crate only moves causally-identified
//! deliveries and settles them exactly once.

/// Stable entity identity (the `nodeId` in TS).
pub type EntityId = String;
/// Submission identity (the `submissionId` in TS).
pub type SubmissionId = String;
/// Causal change identity.
pub type ChangeId = u64;
/// Causal info identity.
pub type InfoId = u64;
/// Entity generation: bumped on every evict/replace, never reused.
pub type Generation = u64;

mod error;
mod registry;
mod scheduler;

pub use error::{BeginError, KernelError};
pub use registry::{DropReason, DroppedDelivery, Tombstone};
pub use scheduler::{
    ActiveChange, ChangeOutcome, ChangeView, DeliveryFeedback, Kernel, QueuedView, SubmissionState,
};

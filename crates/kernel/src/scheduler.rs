//! Deterministic single-threaded scheduler.
//!
//! The pump order is fixed (admitted-id order), every counted delivery
//! settles exactly once, and a cancelled submission never starts new work.
//! Business logic runs outside via [`Kernel::pump_once`]: the caller supplies
//! the change body, the kernel supplies causal identity and settlement.

use std::collections::BTreeMap;

use crate::error::{BeginError, KernelError};
use crate::registry::{DropReason, DroppedDelivery, QueuedInfo, Registry};
use crate::{ChangeId, EntityId, Generation, SubmissionId};

/// Immediate physical delivery feedback: describes the delivery layer only,
/// never downstream business results.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DeliveryFeedback {
    /// Entered the target mailbox.
    Enqueued,
    /// Not admitted this time, with the reason.
    Dropped(DropReason),
}

/// What the change body observed and decided.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ChangeOutcome {
    /// Normal settlement.
    Completed,
    /// Business failure captured as a causal fact (error-as-Info upstream).
    Failed(String),
}

/// Read-only view handed to the change body.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChangeView {
    /// Running change identity.
    pub change_id: ChangeId,
    /// Entity executing the change.
    pub entity: EntityId,
    /// Entity generation at begin time.
    pub generation: Generation,
    /// Pulse discriminator and sender.
    pub info_type: String,
    pub sender: EntityId,
    /// Owning submission, if any.
    pub submission: Option<SubmissionId>,
}

/// Token proving a change is the entity's current single-flight execution.
/// Must be returned via [`Kernel::settle_change`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ActiveChange {
    change_id: ChangeId,
    entity: EntityId,
    generation: Generation,
    submission: Option<SubmissionId>,
}

/// A queued delivery visible without dequeuing (introspection only).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QueuedView {
    /// Entity holding the queue.
    pub entity: EntityId,
    /// Depth of the mailbox.
    pub depth: usize,
}

/// Lifecycle of one root submission.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SubmissionState {
    /// Still has unsettled deliveries.
    Open { pending: usize },
    /// All deliveries settled, none failed or cancelled.
    Completed,
    /// Cancel requested; remaining queued work is skipped.
    Cancelled,
    /// A delivery reported business failure (informational only;
    /// siblings keep running).
    Failed(String),
}

#[derive(Debug)]
struct Submission {
    pending: usize,
    cancelled: bool,
    failure: Option<String>,
}

/// The rule space.
#[derive(Debug, Default)]
pub struct Kernel {
    registry: Registry,
    submissions: BTreeMap<SubmissionId, Submission>,
    drops: Vec<DroppedDelivery>,
    next_info: u64,
    next_change: ChangeId,
}

impl Kernel {
    /// Empty rule space.
    pub fn new() -> Self {
        Kernel::default()
    }

    // -- entities ----------------------------------------------------------

    /// Admit an entity. Returns its starting generation.
    pub fn admit(&mut self, id: EntityId) -> Result<Generation, KernelError> {
        self.registry.admit(id)
    }

    /// Evict an entity: queued deliveries settle as dropped, tombstone bumps.
    /// Returns false when the id was not admitted.
    pub fn evict(&mut self, id: &str) -> bool {
        let Some(queue) = self.registry.evict(id) else {
            return false;
        };
        for info in queue {
            self.settle_dropped(info, DropReason::Evicted);
        }
        true
    }

    /// Seal an admitted entity for replace: the queue freezes, new sends drop.
    pub fn seal(&mut self, id: &str) -> Result<(), KernelError> {
        let Some(slot) = self.registry.get_mut(id) else {
            return Err(KernelError::UnknownEntity(id.to_owned()));
        };
        slot.sealed = true;
        Ok(())
    }

    /// Lift a replace seal.
    pub fn unseal(&mut self, id: &str) -> Result<(), KernelError> {
        let Some(slot) = self.registry.get_mut(id) else {
            return Err(KernelError::UnknownEntity(id.to_owned()));
        };
        slot.sealed = false;
        Ok(())
    }

    /// Current generation of an admitted entity, or its tombstone.
    pub fn generation(&self, id: &str) -> Option<Generation> {
        self.registry.generation(id)
    }

    /// Directional pulse: enqueue into the target mailbox, fire-and-forget.
    pub fn send(
        &mut self,
        sender: EntityId,
        info_type: String,
        target: &str,
        caused_by: Option<ChangeId>,
        submission: Option<SubmissionId>,
    ) -> DeliveryFeedback {
        enum Route {
            Enqueue(Generation),
            Drop(Option<Generation>, DropReason),
        }
        let route = match self.registry.get(target) {
            None => Route::Drop(None, DropReason::UnknownTarget),
            Some(slot) if slot.sealed => {
                Route::Drop(Some(slot.generation), DropReason::SealedTarget)
            }
            Some(slot)
                if submission
                    .as_ref()
                    .is_some_and(|sub| self.is_cancelled(sub)) =>
            {
                Route::Drop(Some(slot.generation), DropReason::Cancelled)
            }
            Some(slot) => Route::Enqueue(slot.generation),
        };
        match route {
            Route::Drop(generation, reason) => {
                self.record_drop(target.to_owned(), generation, submission, reason.clone());
                DeliveryFeedback::Dropped(reason)
            }
            Route::Enqueue(generation) => {
                let info = QueuedInfo {
                    info_id: self.take_info_id(),
                    sender,
                    target: target.to_owned(),
                    info_type,
                    generation,
                    caused_by,
                    submission: submission.clone(),
                };
                if let Some(sub) = submission {
                    self.count_enqueued(&sub);
                }
                self.registry
                    .get_mut(target)
                    .expect("admitted above")
                    .mailbox
                    .push_back(info);
                DeliveryFeedback::Enqueued
            }
        }
    }

    /// Root pulse from outside the graph; opens (or reuses) a submission.
    pub fn inject_root(
        &mut self,
        target: &str,
        info_type: String,
        submission: SubmissionId,
    ) -> DeliveryFeedback {
        self.submissions
            .entry(submission.clone())
            .or_insert(Submission {
                pending: 0,
                cancelled: false,
                failure: None,
            });
        self.send(
            "external-root".to_owned(),
            info_type,
            target,
            None,
            Some(submission),
        )
    }

    // -- single-flight execution -------------------------------------------

    /// Open the next queued change on an entity, returning the settlement
    /// token plus the view for the change body. Cancelled or stale deliveries
    /// settle as dropped without running.
    pub fn begin_change(&mut self, entity: &str) -> Result<(ActiveChange, ChangeView), BeginError> {
        let id = entity.to_owned();
        let info = {
            let slot = self
                .registry
                .get_mut(entity)
                .ok_or_else(|| BeginError::Empty(id.clone()))?;
            if slot.sealed {
                return Err(BeginError::Sealed(id));
            }
            if slot.active_change.is_some() {
                return Err(BeginError::Busy(id));
            }
            slot.mailbox
                .pop_front()
                .ok_or_else(|| BeginError::Empty(id.clone()))?
        };
        let current = self.registry.generation(&info.target);
        if Some(info.generation) != current {
            self.settle_dropped(info, DropReason::StaleGeneration);
            return Err(BeginError::Empty(id));
        }
        if let Some(sub) = info.submission.clone() {
            if self.is_cancelled(&sub) {
                self.settle_dropped(info, DropReason::Cancelled);
                return Err(BeginError::Empty(id));
            }
        }
        let change_id = self.take_change_id();
        let slot = self.registry.get_mut(entity).expect("admitted above");
        slot.active_change = Some(change_id);
        let view = ChangeView {
            change_id,
            entity: id.clone(),
            generation: info.generation,
            info_type: info.info_type.clone(),
            sender: info.sender.clone(),
            submission: info.submission.clone(),
        };
        let token = ActiveChange {
            change_id,
            entity: id,
            generation: info.generation,
            submission: info.submission,
        };
        Ok((token, view))
    }

    /// Settle the running change. A stale token (entity evicted and
    /// re-admitted, or a double settle) is rejected and settles nothing.
    pub fn settle_change(&mut self, token: ActiveChange, outcome: ChangeOutcome) -> bool {
        if self.registry.get(&token.entity).is_none() {
            return self.settle_tombstone(token, outcome);
        }
        {
            let slot = self.registry.get_mut(&token.entity).expect("checked above");
            if slot.active_change != Some(token.change_id) || slot.generation != token.generation {
                return false;
            }
            slot.active_change = None;
        }
        let submission = token.submission.clone();
        match outcome {
            ChangeOutcome::Completed => self.settle_counted(submission, None),
            ChangeOutcome::Failed(message) => self.settle_counted(submission, Some(message)),
        }
        true
    }

    /// Settle a change whose entity was evicted mid-flight (TS parity: the
    /// old instance runs on and settles normally exactly once).
    fn settle_tombstone(&mut self, token: ActiveChange, outcome: ChangeOutcome) -> bool {
        let Some(tomb) = self.registry.tombstone(&token.entity) else {
            return false;
        };
        if tomb.active_change != Some(token.change_id)
            || tomb.generation != token.generation.saturating_add(1)
        {
            return false;
        }
        self.registry
            .clear_tombstone_change(&token.entity, token.change_id);
        let submission = token.submission.clone();
        match outcome {
            ChangeOutcome::Completed => self.settle_counted(submission, None),
            ChangeOutcome::Failed(message) => self.settle_counted(submission, Some(message)),
        }
        true
    }
    /// Run at most one queued change across the space in admitted-id order.
    /// Returns true when a change ran or a stale/cancelled delivery settled.
    pub fn pump_once<H>(&mut self, mut body: H) -> bool
    where
        H: FnMut(ChangeView) -> ChangeOutcome,
    {
        let pending_before = self.pending_total();
        for id in self.registry.ordered_ids() {
            let (token, view) = match self.begin_change(&id) {
                Ok(opened) => opened,
                Err(_) => continue,
            };
            let outcome = body(view);
            self.settle_change(token, outcome);
            return true;
        }
        self.pending_total() < pending_before
    }

    /// Run until no entity can make progress. Returns the number of changes
    /// executed (drop settlements do not count).
    pub fn pump_until_idle<H>(&mut self, mut body: H) -> usize
    where
        H: FnMut(ChangeView) -> ChangeOutcome,
    {
        let mut ran = 0;
        while self.pump_once(|view| {
            ran += 1;
            body(view)
        }) {}
        ran
    }

    // -- submissions --------------------------------------------------------

    /// Cancel a submission: queued deliveries skip, in-flight work settles
    /// normally, already-written facts are not rolled back.
    pub fn cancel(&mut self, submission: &str) -> bool {
        let Some(sub) = self.submissions.get_mut(submission) else {
            return false;
        };
        if sub.cancelled {
            return false;
        }
        sub.cancelled = true;
        true
    }

    /// Current lifecycle of a submission.
    pub fn submission_state(&self, submission: &str) -> Option<SubmissionState> {
        let sub = self.submissions.get(submission)?;
        if sub.pending > 0 {
            if sub.cancelled {
                return Some(SubmissionState::Cancelled);
            }
            return Some(SubmissionState::Open {
                pending: sub.pending,
            });
        }
        if sub.cancelled {
            return Some(SubmissionState::Cancelled);
        }
        if let Some(failure) = &sub.failure {
            return Some(SubmissionState::Failed(failure.clone()));
        }
        Some(SubmissionState::Completed)
    }

    // -- introspection -------------------------------------------------------

    /// Queued depths in admitted-id order.
    pub fn queued(&self) -> Vec<QueuedView> {
        self.registry
            .ordered_ids()
            .into_iter()
            .filter_map(|entity| {
                self.registry.get(&entity).map(|slot| QueuedView {
                    entity,
                    depth: slot.mailbox.len(),
                })
            })
            .collect()
    }

    /// Drop ledger, in settle order.
    pub fn drops(&self) -> &[DroppedDelivery] {
        &self.drops
    }

    /// Total unsettled deliveries across all submissions.
    pub fn pending_total(&self) -> usize {
        self.submissions.values().map(|sub| sub.pending).sum()
    }

    // -- internals -----------------------------------------------------------

    fn take_info_id(&mut self) -> u64 {
        self.next_info += 1;
        self.next_info
    }

    fn take_change_id(&mut self) -> ChangeId {
        self.next_change += 1;
        self.next_change
    }

    fn is_cancelled(&self, submission: &str) -> bool {
        self.submissions
            .get(submission)
            .is_some_and(|sub| sub.cancelled)
    }

    fn count_enqueued(&mut self, submission: &str) {
        self.submissions
            .entry(submission.to_owned())
            .or_insert(Submission {
                pending: 0,
                cancelled: false,
                failure: None,
            })
            .pending += 1;
    }

    fn settle_counted(&mut self, submission: Option<SubmissionId>, failure: Option<String>) {
        let Some(sub_id) = submission else { return };
        let Some(sub) = self.submissions.get_mut(&sub_id) else {
            return;
        };
        sub.pending = sub.pending.saturating_sub(1);
        if failure.is_some() && sub.failure.is_none() {
            sub.failure = failure;
        }
    }

    fn settle_dropped(&mut self, info: QueuedInfo, reason: DropReason) {
        let target = info.target.clone();
        let generation = Some(info.generation);
        let submission = info.submission.clone();
        self.settle_counted(submission.clone(), None);
        self.record_drop(target, generation, submission, reason);
    }

    fn record_drop(
        &mut self,
        target: EntityId,
        generation: Option<Generation>,
        submission: Option<SubmissionId>,
        reason: DropReason,
    ) {
        self.drops.push(DroppedDelivery {
            target,
            generation,
            submission,
            reason,
        });
    }
}

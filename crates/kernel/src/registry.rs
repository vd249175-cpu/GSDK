//! Entity slots: generation, seal flag, mailbox and single-flight state.
//!
//! State never crosses entity lifetimes: evict drops the queue and bumps the
//! tombstone generation, so a re-admitted id starts clean and stale
//! in-flight deliveries are recognizable by their captured generation.

use std::collections::{BTreeMap, VecDeque};

use crate::error::KernelError;
use crate::{ChangeId, EntityId, Generation, InfoId, SubmissionId};

/// Why a delivery never reached a change.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DropReason {
    /// Target id is not admitted.
    UnknownTarget,
    /// Target is sealed for replace.
    SealedTarget,
    /// Target was evicted after enqueue; stale generation.
    StaleGeneration,
    /// Submission was cancelled before the delivery ran.
    Cancelled,
    /// Queue discarded by evict.
    Evicted,
}

/// A settled-without-execution delivery, kept for causal diagnosis.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DroppedDelivery {
    /// Entity the delivery was addressed to.
    pub target: EntityId,
    /// Generation captured at enqueue time.
    pub generation: Option<Generation>,
    /// Owning submission, if any.
    pub submission: Option<SubmissionId>,
    /// Why it never ran.
    pub reason: DropReason,
}

/// One queued pulse with its causal identity.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QueuedInfo {
    /// Causal info identity.
    pub info_id: InfoId,
    /// Sender entity, or `"external-root"` for root injection.
    pub sender: EntityId,
    /// Addressed entity.
    pub target: EntityId,
    /// Payload discriminator (the `Info.type` in TS).
    pub info_type: String,
    /// Target generation captured at enqueue.
    pub generation: Generation,
    /// Change that caused this send, if any.
    pub caused_by: Option<ChangeId>,
    /// Owning submission, if any.
    pub submission: Option<SubmissionId>,
}

/// Per-entity slot. The mailbox never outlives the slot; the running change
/// may settle once through the tombstone (see [`Tombstone`]).
#[derive(Debug)]
pub struct EntitySlot {
    /// Current generation; assigned at admit from the tombstone counter.
    pub generation: Generation,
    /// Sealed for replace: no new change may begin, queue stays frozen.
    pub sealed: bool,
    /// FIFO mailbox.
    pub mailbox: VecDeque<QueuedInfo>,
    /// Running change, if any (single-flight).
    pub active_change: Option<ChangeId>,
}

impl EntitySlot {
    fn fresh(generation: Generation) -> Self {
        EntitySlot {
            generation,
            sealed: false,
            mailbox: VecDeque::new(),
            active_change: None,
        }
    }
}

/// What remains after evict: the next generation plus the in-flight change,
/// if any, so it can still settle exactly once.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Tombstone {
    /// Generation a re-admitted entity will start with.
    pub generation: Generation,
    /// Change that was running at evict time.
    pub active_change: Option<ChangeId>,
}

/// Registry: admitted entities plus tombstones for the evicted.
#[derive(Debug, Default)]
pub struct Registry {
    slots: BTreeMap<EntityId, EntitySlot>,
    tombstones: BTreeMap<EntityId, Tombstone>,
}

impl Registry {
    /// Admit a new entity; id must be absent. Returns its generation.
    pub fn admit(&mut self, id: EntityId) -> Result<Generation, KernelError> {
        if self.slots.contains_key(&id) {
            return Err(KernelError::DuplicateEntity(id));
        }
        let generation = self.tombstones.get(&id).map(|t| t.generation).unwrap_or(0);
        self.slots.insert(id, EntitySlot::fresh(generation));
        Ok(generation)
    }

    /// Evict an entity: discard its queue, bump the tombstone, keep the
    /// in-flight change marker so it settles exactly once. Returns the
    /// discarded queue.
    pub fn evict(&mut self, id: &str) -> Option<Vec<QueuedInfo>> {
        let slot = self.slots.remove(id)?;
        self.tombstones.insert(
            id.to_owned(),
            Tombstone {
                generation: slot.generation + 1,
                active_change: slot.active_change,
            },
        );
        Some(slot.mailbox.into_iter().collect())
    }

    /// Current generation of an admitted entity, or its tombstone.
    pub fn generation(&self, id: &str) -> Option<Generation> {
        if let Some(slot) = self.slots.get(id) {
            return Some(slot.generation);
        }
        self.tombstones.get(id).map(|t| t.generation)
    }

    /// Tombstone for an evicted id, if any.
    pub fn tombstone(&self, id: &str) -> Option<Tombstone> {
        self.tombstones.get(id).copied()
    }

    /// Clear the tombstone's in-flight marker after it settles.
    pub fn clear_tombstone_change(&mut self, id: &str, change: ChangeId) {
        if let Some(tomb) = self.tombstones.get_mut(id) {
            if tomb.active_change == Some(change) {
                tomb.active_change = None;
            }
        }
    }

    pub fn get(&self, id: &str) -> Option<&EntitySlot> {
        self.slots.get(id)
    }

    pub fn get_mut(&mut self, id: &str) -> Option<&mut EntitySlot> {
        self.slots.get_mut(id)
    }

    /// Deterministic iteration order for the scheduler pump.
    pub fn ordered_ids(&self) -> Vec<EntityId> {
        self.slots.keys().cloned().collect()
    }
}

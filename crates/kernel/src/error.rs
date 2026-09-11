//! Kernel-level errors: all fallible operations name their failure.

use core::fmt;

use crate::EntityId;

/// Every fallible kernel operation returns one of these.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum KernelError {
    /// Admitting an id that is already admitted.
    DuplicateEntity(EntityId),
    /// Operating on an id that was never admitted or was evicted.
    UnknownEntity(EntityId),
    /// A new instance is already bound to this space.
    AlreadyBound(EntityId),
}

impl fmt::Display for KernelError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            KernelError::DuplicateEntity(id) => write!(f, "entity already admitted: {id}"),
            KernelError::UnknownEntity(id) => write!(f, "entity not admitted: {id}"),
            KernelError::AlreadyBound(id) => write!(f, "entity already bound: {id}"),
        }
    }
}

impl std::error::Error for KernelError {}

/// Failure to open a single-flight change on an entity.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BeginError {
    /// Another change is still running on this entity.
    Busy(EntityId),
    /// The entity is sealed for replace; its queue is frozen.
    Sealed(EntityId),
    /// Nothing queued.
    Empty(EntityId),
}

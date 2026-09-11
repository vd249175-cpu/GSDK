//! Node-API boundary: JS business entities on the Rust rule space.
//!
//! The kernel owns scheduling facts (registry, mailboxes, submissions, drop
//! ledger). JS owns business state and change bodies, and drives the pump:
//! `poll_next` opens one change, JS runs the handler (possibly across an
//! await), then `settle_change` returns the token. No threads cross the
//! boundary, so there is nothing to join on release.

use std::sync::Mutex;

use graphvideo_kernel::{ActiveChange, ChangeOutcome, DeliveryFeedback, DropReason, Kernel};
use napi::bindgen_prelude::*;
use napi_derive::napi;

/// `u64` causal ids cross as `f64` (lossless below 2^53, documented).
fn id_to_js(id: u64) -> f64 {
    id as f64
}

fn id_from_js(id: f64) -> u64 {
    id as u64
}

fn feedback_to_js(feedback: DeliveryFeedback) -> JsDeliveryFeedback {
    match feedback {
        DeliveryFeedback::Enqueued => JsDeliveryFeedback {
            status: "enqueued".to_owned(),
            reason: None,
        },
        DeliveryFeedback::Dropped(reason) => JsDeliveryFeedback {
            status: "dropped".to_owned(),
            reason: Some(drop_reason_name(&reason).to_owned()),
        },
    }
}

fn drop_reason_name(reason: &DropReason) -> &'static str {
    match reason {
        DropReason::UnknownTarget => "unknown-target",
        DropReason::SealedTarget => "sealed-target",
        DropReason::StaleGeneration => "stale-generation",
        DropReason::Cancelled => "cancelled",
        DropReason::Evicted => "evicted",
    }
}

fn kernel_error_to_js(error: graphvideo_kernel::KernelError) -> napi::Error {
    napi::Error::new(Status::GenericFailure, format!("{error}"))
}

/// Immediate delivery feedback for one send.
#[napi(object)]
pub struct JsDeliveryFeedback {
    /// `"enqueued"` or `"dropped"`.
    pub status: String,
    /// Machine-readable drop cause, if dropped.
    pub reason: Option<String>,
}

/// Opaque settlement token: plain data, validated back on settle.
#[napi(object)]
pub struct JsChangeToken {
    pub change_id: f64,
    pub entity: String,
    pub generation: f64,
    pub submission: Option<String>,
}

/// Read-only change view for the JS handler.
#[napi(object)]
pub struct JsChangeView {
    pub change_id: f64,
    pub entity: String,
    pub generation: f64,
    pub info_type: String,
    pub sender: String,
    pub payload_json: Option<String>,
    pub submission: Option<String>,
}

/// One opened change: token plus view.
#[napi(object)]
pub struct JsPolledChange {
    pub token: JsChangeToken,
    pub view: JsChangeView,
}

/// One drop-ledger entry, in settle order.
#[napi(object)]
pub struct JsDroppedDelivery {
    pub target: String,
    pub generation: Option<f64>,
    pub submission: Option<String>,
    pub reason: String,
}

/// One mailbox depth.
#[napi(object)]
pub struct JsQueuedDepth {
    pub entity: String,
    pub depth: f64,
}

/// The rule space. Synchronous only; JS drives the pump.
#[napi]
pub struct RuleSpace {
    inner: Mutex<Kernel>,
}

#[napi]
impl RuleSpace {
    /// Create an empty rule space.
    #[napi(constructor)]
    pub fn new() -> Self {
        RuleSpace {
            inner: Mutex::new(Kernel::new()),
        }
    }

    /// Admit an entity; returns its starting generation.
    #[napi]
    pub fn admit(&self, id: String) -> Result<f64> {
        let mut kernel = self.inner.lock().map_err(lock_error)?;
        kernel
            .admit(id)
            .map(|generation| generation as f64)
            .map_err(kernel_error_to_js)
    }

    /// Evict an entity, settling its queue as dropped.
    #[napi]
    pub fn evict(&self, id: String) -> Result<bool> {
        let mut kernel = self.inner.lock().map_err(lock_error)?;
        Ok(kernel.evict(&id))
    }

    /// Seal an entity for replace: queue freezes, new sends drop.
    #[napi]
    pub fn seal(&self, id: String) -> Result<()> {
        let mut kernel = self.inner.lock().map_err(lock_error)?;
        kernel.seal(&id).map_err(kernel_error_to_js)
    }

    /// Lift a replace seal.
    #[napi]
    pub fn unseal(&self, id: String) -> Result<()> {
        let mut kernel = self.inner.lock().map_err(lock_error)?;
        kernel.unseal(&id).map_err(kernel_error_to_js)
    }

    /// Current generation, or the tombstone after evict.
    #[napi]
    pub fn generation(&self, id: String) -> Result<Option<f64>> {
        let kernel = self.inner.lock().map_err(lock_error)?;
        Ok(kernel.generation(&id).map(|generation| generation as f64))
    }

    /// Directional pulse from one entity to another.
    #[napi]
    pub fn send(
        &self,
        sender: String,
        info_type: String,
        payload_json: Option<String>,
        target: String,
        caused_by: Option<f64>,
        submission: Option<String>,
    ) -> Result<JsDeliveryFeedback> {
        let mut kernel = self.inner.lock().map_err(lock_error)?;
        Ok(feedback_to_js(kernel.send_json(
            sender,
            info_type,
            payload_json,
            &target,
            caused_by.map(id_from_js),
            submission,
        )))
    }

    /// Root pulse from outside the graph.
    #[napi]
    pub fn inject_root(
        &self,
        target: String,
        info_type: String,
        payload_json: Option<String>,
        submission: String,
    ) -> Result<JsDeliveryFeedback> {
        let mut kernel = self.inner.lock().map_err(lock_error)?;
        Ok(feedback_to_js(kernel.inject_root_json(
            &target,
            info_type,
            payload_json,
            submission,
        )))
    }

    /// Open the next runnable change in admitted-id order, if any.
    #[napi]
    pub fn poll_next(&self) -> Result<Option<JsPolledChange>> {
        let mut kernel = self.inner.lock().map_err(lock_error)?;
        let Some((token, view)) = kernel.poll_next() else {
            return Ok(None);
        };
        Ok(Some(JsPolledChange {
            token: JsChangeToken {
                change_id: id_to_js(token.change_id()),
                entity: token.entity().to_owned(),
                generation: token.generation() as f64,
                submission: token.submission().cloned(),
            },
            view: JsChangeView {
                change_id: id_to_js(view.change_id),
                entity: view.entity,
                generation: view.generation as f64,
                info_type: view.info_type,
                sender: view.sender,
                payload_json: view.payload_json,
                submission: view.submission,
            },
        }))
    }

    /// Settle a previously polled change. `failed_message` marks a captured
    /// business failure; `None` settles normally. Stale tokens settle nothing.
    #[napi]
    pub fn settle_change(
        &self,
        token: JsChangeToken,
        failed_message: Option<String>,
    ) -> Result<bool> {
        let mut kernel = self.inner.lock().map_err(lock_error)?;
        let outcome = match failed_message {
            Some(message) => ChangeOutcome::Failed(message),
            None => ChangeOutcome::Completed,
        };
        Ok(kernel.settle_change(
            ActiveChange::from_parts(
                id_from_js(token.change_id),
                token.entity,
                token.generation as u64,
                token.submission,
            ),
            outcome,
        ))
    }

    /// Cancel a submission: queued work skips, in-flight settles normally.
    #[napi]
    pub fn cancel(&self, submission: String) -> Result<bool> {
        let mut kernel = self.inner.lock().map_err(lock_error)?;
        Ok(kernel.cancel(&submission))
    }

    /// Submission lifecycle: `"open"`, `"completed"`, `"cancelled"` or
    /// `"failed:<message>"`. Unknown ids return `None`.
    #[napi]
    pub fn submission_state(&self, submission: String) -> Result<Option<String>> {
        let kernel = self.inner.lock().map_err(lock_error)?;
        Ok(kernel
            .submission_state(&submission)
            .map(|state| match state {
                graphvideo_kernel::SubmissionState::Open { pending } => {
                    format!("open:{pending}")
                }
                graphvideo_kernel::SubmissionState::Completed => "completed".to_owned(),
                graphvideo_kernel::SubmissionState::Cancelled => "cancelled".to_owned(),
                graphvideo_kernel::SubmissionState::Failed(message) => format!("failed:{message}"),
            }))
    }

    /// Total unsettled deliveries.
    #[napi]
    pub fn pending_total(&self) -> Result<f64> {
        let kernel = self.inner.lock().map_err(lock_error)?;
        Ok(kernel.pending_total() as f64)
    }

    /// Mailbox depths in admitted-id order.
    #[napi]
    pub fn queued_depths(&self) -> Result<Vec<JsQueuedDepth>> {
        let kernel = self.inner.lock().map_err(lock_error)?;
        Ok(kernel
            .queued()
            .into_iter()
            .map(|entry| JsQueuedDepth {
                entity: entry.entity,
                depth: entry.depth as f64,
            })
            .collect())
    }

    /// Drop ledger, in settle order.
    #[napi]
    pub fn drops(&self) -> Result<Vec<JsDroppedDelivery>> {
        let kernel = self.inner.lock().map_err(lock_error)?;
        Ok(kernel
            .drops()
            .iter()
            .map(|drop| JsDroppedDelivery {
                target: drop.target.clone(),
                generation: drop.generation.map(|generation| generation as f64),
                submission: drop.submission.clone(),
                reason: drop_reason_name(&drop.reason).to_owned(),
            })
            .collect())
    }
}

fn lock_error(_: std::sync::PoisonError<std::sync::MutexGuard<'_, Kernel>>) -> napi::Error {
    napi::Error::new(Status::GenericFailure, "rule space lock poisoned")
}

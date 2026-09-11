import type { Node } from './node';
import type { DeliveryFeedback, Info, InfoEnvelope, Probe } from './types';
import type { TraceSession, RuntimeIdKind } from './observation';
import { nodeRuntimeCapability } from './internal-access';
export interface KernelDeliveryOptions {
  infoId?: string;
  causedByChangeId?: string;
  causeInfoId?: string;
  submissionId?: string;
  signal?: AbortSignal;
}

export interface DeliveryKernelContext {
  nodes: Map<string, Node<any>>;
  envelopes: InfoEnvelope[];
  probes: Probe[];
  traceSession: TraceSession;
  logicalClock: number;
  pendingDeliveryCount: number;
  scheduledMailboxNodeIds: Set<string>;
  mount(...nodes: Node<any>[]): any;
  ensureInitialStateSnapshot(): void;
  publishSchedulerState(): void;
  now(): number;
  nextId(kind: RuntimeIdKind): string;
  trackSubmissionDeliveryEnqueued(submissionId?: string): void;
  trackSubmissionDeliverySettled(submissionId?: string, error?: unknown): void;
}

export function deliverSendNowHelper(
  ctx: DeliveryKernelContext,
  source: Node<any>,
  info: Info,
  target: Node<any> | string,
  options?: KernelDeliveryOptions,
): DeliveryFeedback {
  ctx.ensureInitialStateSnapshot();
  const targetNode = typeof target === 'string' ? ctx.nodes.get(target) : target;
  const targetId = typeof target === 'string' ? target : target.id;
  if (!targetNode) {
    console.warn(
      `[Kernel]: Target node "${targetId}" not found for send from "${source.name}" (${source.id}); delivery dropped`,
    );
    return { status: 'dropped', reason: `Target node not found: ${targetId}` };
  }
  if ('_sealedForReplace' in targetNode && targetNode._sealedForReplace === true) {
    return { status: 'dropped', reason: `Target node sealed for replace: ${targetNode.id}` };
  }
  const now = ctx.now();
  const infoId = options?.infoId ?? ctx.nextId('info');

  ctx.logicalClock++;
  const envelope: InfoEnvelope = {
    infoId,
    senderNodeId: source.id,
    targetNodeId: targetNode.id,
    causedByChangeId: options?.causedByChangeId,
    causeInfoId: options?.causeInfoId,
    submissionId: options?.submissionId,
    sequence: ctx.logicalClock,
    timestamp: now,
    payload: info,
  };

  if (ctx.envelopes.length >= 1000) {
    ctx.envelopes.shift();
  }
  ctx.envelopes.push(envelope);

  if (envelope.causedByChangeId) {
    ctx.traceSession.record({ type: 'InfoEmitted', envelope });
  }
  ctx.traceSession.record({ type: 'InfoDelivered', envelope });

  enqueueMailboxDeliveryHelper(ctx, targetNode, info, envelope, { signal: options?.signal });
  return { status: 'enqueued' };
}

export function injectRootInfoNowHelper(
  ctx: DeliveryKernelContext,
  target: Node<any>,
  info: Info,
  options: { signal?: AbortSignal; submissionId?: string } = {},
): void {
  options.signal?.throwIfAborted();
  ctx.ensureInitialStateSnapshot();
  const now = ctx.now();
  const infoId = ctx.nextId('info-root');
  const envelope: InfoEnvelope = {
    infoId,
    senderNodeId: 'external-root',
    targetNodeId: target.id,
    submissionId: options.submissionId,
    sequence: ++ctx.logicalClock,
    timestamp: now,
    payload: info,
  };

  if (ctx.envelopes.length >= 1000) {
    ctx.envelopes.shift();
  }
  ctx.envelopes.push(envelope);
  ctx.traceSession.record({ type: 'InfoDelivered', envelope });

  enqueueMailboxDeliveryHelper(ctx, target, info, envelope, { signal: options?.signal });
}

export function enqueueMailboxDeliveryHelper(
  ctx: DeliveryKernelContext,
  target: Node<any>,
  info: Info,
  envelope: InfoEnvelope,
  options: { signal?: AbortSignal },
): void {
  ctx.trackSubmissionDeliveryEnqueued(envelope.submissionId);
  ctx.pendingDeliveryCount += 1;
  ctx.publishSchedulerState();
  const completion = target._enqueueMailbox(nodeRuntimeCapability, info, envelope, options);
  void completion.then(
    () => settleMailboxDeliveryHelper(ctx, envelope.submissionId),
    (error) => settleMailboxDeliveryHelper(ctx, envelope.submissionId, error),
  );
  scheduleMailboxDrainHelper(ctx, target);
}

export function scheduleMailboxDrainHelper(
  ctx: DeliveryKernelContext,
  target: Node<any>,
): void {
  if (ctx.scheduledMailboxNodeIds.has(target.id)) return;
  ctx.scheduledMailboxNodeIds.add(target.id);
  queueMicrotask(async () => {
    try {
      await target._drainMailbox(nodeRuntimeCapability);
    } finally {
      ctx.scheduledMailboxNodeIds.delete(target.id);
      if (target.getMailboxSize() > 0 && !target._sealedForReplace) scheduleMailboxDrainHelper(ctx, target);
    }
  });
}

export function settleMailboxDeliveryHelper(
  ctx: DeliveryKernelContext,
  submissionId?: string,
  error?: unknown,
): void {
  ctx.pendingDeliveryCount = Math.max(0, ctx.pendingDeliveryCount - 1);
  ctx.trackSubmissionDeliverySettled(submissionId, error);
  ctx.publishSchedulerState();
}

import { Node } from '@graphvideo/sdk/node';
import type { DomainChangeContext, Info } from '@graphvideo/sdk/protocol';

export interface StudioApplicationLifecycleState {
  phase: 'Idle' | 'Starting' | 'Ready' | 'StoppingGeneration' | 'AwaitingDrain' | 'Saving' | 'ClosingWindow' | 'ShutdownReady' | 'StartFailed' | 'ShutdownFailed';
  requestId: string;
  hasProject: boolean;
  lastError: string | null;
}

/** Owns application intent; kernel and topology commands remain host operations. */
export class StudioApplicationLifecycleNode extends Node<StudioApplicationLifecycleState> {
  constructor(id = 'node-application-lifecycle') {
    super(id, 'Studio 应用生命周期', { phase: 'Idle', requestId: '', hasProject: false, lastError: null });
  }

  protected override change(info: Info, ctx: DomainChangeContext<StudioApplicationLifecycleState>): void {
    const phase = ctx.read('phase');
    if (info.type === 'SystemStartRequestedInfo') {
      if (!['Idle', 'StartFailed'].includes(phase) || typeof info.requestId !== 'string') return;
      ctx.patchState({ phase: 'Starting', requestId: info.requestId, lastError: null });
      ctx.send({ type: 'DesktopStartRequestedInfo', lifecycleRequestId: info.requestId }, 'host-el');
      return;
    }
    if (info.type === 'SystemShutdownRequestedInfo') {
      if (typeof info.requestId !== 'string' || ['StoppingGeneration', 'AwaitingDrain', 'Saving', 'ClosingWindow', 'ShutdownReady'].includes(phase)) return;
      ctx.patchState({ phase: 'StoppingGeneration', requestId: info.requestId, hasProject: info.hasProject === true, lastError: null });
      ctx.send({ type: 'StudioGenerationPrepareShutdownInfo', requestId: info.requestId }, 'node-generation-task');
      return;
    }
    if (info.type === '@error/NodeFailed' && ['Starting', 'StoppingGeneration', 'AwaitingDrain', 'Saving', 'ClosingWindow'].includes(phase)) {
      ctx.patchState({ phase: phase === 'Starting' ? 'StartFailed' : 'ShutdownFailed', lastError: String(info.message ?? 'Node failed') });
      return;
    }
    if (info.requestId !== ctx.read('requestId')) return;
    if (info.type === 'SystemLifecycleTimeoutObservedInfo' && ['Starting', 'StoppingGeneration', 'AwaitingDrain', 'Saving', 'ClosingWindow'].includes(phase)) {
      ctx.patchState({ phase: phase === 'Starting' ? 'StartFailed' : 'ShutdownFailed', lastError: String(info.error ?? 'Lifecycle timed out') });
      return;
    }
    if (info.type === 'SystemShutdownDrainObservedInfo' && phase === 'AwaitingDrain') {
      ctx.write('phase', 'Saving');
      ctx.send({ type: 'StudioPersistencePrepareShutdownInfo', requestId: info.requestId, hasProject: ctx.read('hasProject') }, 'node-md-source');
      return;
    }
    if (info.type !== 'StudioLifecycleParticipantPreparedInfo') return;
    const expected = phase === 'Starting' || phase === 'ClosingWindow' ? 'window'
      : phase === 'StoppingGeneration' ? 'generation' : phase === 'Saving' ? 'persistence' : null;
    if (!expected || info.participant !== expected) return;
    if (info.ok !== true) {
      ctx.patchState({ phase: phase === 'Starting' ? 'StartFailed' : 'ShutdownFailed', lastError: String(info.error ?? `${expected} failed`) });
      return;
    }
    if (phase === 'Starting') ctx.write('phase', 'Ready');
    else if (phase === 'StoppingGeneration') ctx.write('phase', 'AwaitingDrain');
    else if (phase === 'Saving') {
      ctx.write('phase', 'ClosingWindow');
      ctx.send({ type: 'DesktopCloseRequestedInfo', lifecycleRequestId: info.requestId }, 'host-el');
    } else if (phase === 'ClosingWindow') ctx.write('phase', 'ShutdownReady');
  }
}

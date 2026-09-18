import { ExecutionWorldNode, Node, ObservationWorldNode } from '@graphvideo/sdk/node';
import type { DomainChangeContext, Info, WorldChangeContext } from '@graphvideo/sdk/protocol';
import type { EffectAdapter } from '@graphvideo/sdk/node';
import {
  InMemoryElectronWindowAdapter,
  type ElectronWindowObservation,
  type ElectronWindowRequest,
} from '../effects/electron-window-adapter';

export interface WindowConfig {
  title: string;
  width: number;
  height: number;
  frameless?: boolean;
}

export interface ElectronHostState {
  lifecycleRequestId: string | null;
  isWindowOpen: boolean;
  config: WindowConfig;
  lastStatePayload: unknown;
  lastOperation: ElectronWindowObservation['type'] | null;
  lastError: string | null;
}

export interface ElectronHostTargets {
  readonly lifecycle: string;
  readonly windowExec: string;
  readonly windowObs?: string;
  readonly host?: string;
}

/** Owns desktop lifecycle intent and the projected window state. It performs no I/O. */
export class ElectronHostNode extends Node<ElectronHostState> {
  constructor(
    id = 'host-el',
    name = '桌面生命周期控制器',
    private readonly targets: ElectronHostTargets = {
      lifecycle: 'node-application-lifecycle',
      windowExec: 'sink-electron-window',
    },
  ) {
    super(id, name, {
      lifecycleRequestId: null,
      isWindowOpen: false,
      config: { title: 'GraphVideo Desktop', width: 1440, height: 900, frameless: true },
      lastStatePayload: null,
      lastOperation: null,
      lastError: null,
    });
  }

  protected override change(info: Info, ctx: DomainChangeContext<ElectronHostState>): void {
    if (info.type === 'DesktopStartRequestedInfo' || info.type === 'OpenWindowTaskInfo' || info.type === 'BootInfo') {
      if (ctx.read('isWindowOpen')) {
        if (typeof info.lifecycleRequestId === 'string') ctx.send({ type: 'StudioLifecycleParticipantPreparedInfo', participant: 'window', requestId: info.lifecycleRequestId, ok: true }, this.targets.lifecycle);
        return;
      }
      ctx.write('lifecycleRequestId', typeof info.lifecycleRequestId === 'string' ? info.lifecycleRequestId : null);
      const config = info.config && typeof info.config === 'object'
        ? { ...ctx.read('config'), ...(info.config as Partial<WindowConfig>) }
        : ctx.read('config');
      ctx.send({ type: 'ElectronWindowEffectRequestedInfo', lifecycleRequestId: info.lifecycleRequestId, request: { type: 'OPEN', config } }, this.targets.windowExec);
      return;
    }
    if (info.type === 'DesktopCloseRequestedInfo') {
      if (!ctx.read('isWindowOpen')) {
        if (typeof info.lifecycleRequestId === 'string') ctx.send({ type: 'StudioLifecycleParticipantPreparedInfo', participant: 'window', requestId: info.lifecycleRequestId, ok: true }, this.targets.lifecycle);
        return;
      }
      ctx.write('lifecycleRequestId', typeof info.lifecycleRequestId === 'string' ? info.lifecycleRequestId : null);
      ctx.send({ type: 'ElectronWindowEffectRequestedInfo', lifecycleRequestId: info.lifecycleRequestId, request: { type: 'CLOSE' } }, this.targets.windowExec);
      return;
    }
    if (info.type === 'ConfigureWindowTaskInfo' && info.config && typeof info.config === 'object') {
      ctx.send({ type: 'ElectronWindowEffectRequestedInfo', request: { type: 'CONFIGURE', config: info.config } }, this.targets.windowExec);
      return;
    }
    if (info.type === 'WindowActionTaskInfo' && info.action) {
      const action = String(info.action).toUpperCase();
      if (action === 'MINIMIZE' || action === 'TOGGLE_MAXIMIZE' || action === 'RELOAD' || action === 'CLOSE') {
        ctx.send({ type: 'ElectronWindowEffectRequestedInfo', request: { type: action } }, this.targets.windowExec);
      }
      return;
    }
    if (info.type === 'DesktopWindowObservedInfo' && info.observation && typeof info.observation === 'object') {
      const observation = info.observation as ElectronWindowObservation;
      ctx.patchState({
        isWindowOpen: observation.isWindowOpen,
        config: { ...ctx.read('config'), ...observation.config },
        lastOperation: observation.type,
        lastError: null,
      });
      const requestId = ctx.read('lifecycleRequestId');
      if (requestId && info.lifecycleRequestId === requestId) {
        ctx.write('lifecycleRequestId', null);
        ctx.send({ type: 'StudioLifecycleParticipantPreparedInfo', participant: 'window', requestId, ok: true }, this.targets.lifecycle);
      }
      return;
    }
    if (info.type === 'ElectronWindowEffectFailedInfo') {
      ctx.write('lastError', String(info.message));
      const requestId = ctx.read('lifecycleRequestId');
      if (requestId && info.lifecycleRequestId === requestId) {
        ctx.write('lifecycleRequestId', null);
        ctx.send({ type: 'StudioLifecycleParticipantPreparedInfo', participant: 'window', requestId, ok: false, error: info.message }, this.targets.lifecycle);
      }
      return;
    }
    if (info.type === 'UiStateInfo') ctx.write('lastStatePayload', info.payload);
  }

}

/** Executes a single physical window action, then finishes its change. */
export class ElectronWindowExecutionNode extends ExecutionWorldNode<Record<never, never>> {
  constructor(
    id = 'sink-electron-window',
    name = '桌面窗口执行端',
    private readonly adapter: EffectAdapter<ElectronWindowRequest, ElectronWindowObservation> = new InMemoryElectronWindowAdapter(),
    private readonly targets: { readonly windowObs: string; readonly host: string } = {
      windowObs: 'src-electron-window',
      host: 'host-el',
    },
  ) {
    super(id, name, {});
  }

  protected override async change(info: Info, ctx: WorldChangeContext<Record<never, never>>): Promise<void> {
    if (info.type !== 'ElectronWindowEffectRequestedInfo') return;
    try {
      const observation = await ctx.effectAdapter(this.adapter, info.request as ElectronWindowRequest);
      ctx.send({ type: 'ElectronWindowEffectObservedInfo', lifecycleRequestId: info.lifecycleRequestId, observation }, this.targets.windowObs);
    } catch (error) {
      ctx.send({
        type: 'ElectronWindowEffectFailedInfo',
        lifecycleRequestId: info.lifecycleRequestId,
        message: error instanceof Error ? error.message : String(error),
      }, this.targets.host);
    }
  }
}

/** Promotes adapter results and OS window events into graph observations. */
export class ElectronWindowObservationNode extends ObservationWorldNode<Record<never, never>> {
  constructor(
    id = 'src-electron-window',
    name = '桌面窗口观测端',
    private readonly targets: { readonly host: string } = { host: 'host-el' },
  ) {
    super(id, name, {});
  }

  protected override change(info: Info, ctx: WorldChangeContext<Record<never, never>>): void {
    if (info.type === 'ElectronWindowEffectObservedInfo') {
      ctx.send({ type: 'DesktopWindowObservedInfo', lifecycleRequestId: info.lifecycleRequestId, observation: info.observation }, this.targets.host);
    } else if (info.type === 'ElectronWindowClosedObservedInfo') {
      ctx.send({
        type: 'DesktopWindowObservedInfo',
        observation: { type: 'CLOSED', isWindowOpen: false },
      }, this.targets.host);
    }
  }
}

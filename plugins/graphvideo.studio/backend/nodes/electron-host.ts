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
  isWindowOpen: boolean;
  config: WindowConfig;
  lastStatePayload: unknown;
  lastOperation: ElectronWindowObservation['type'] | null;
  lastError: string | null;
}

/** Owns desktop lifecycle intent and the projected window state. It performs no I/O. */
export class ElectronHostNode extends Node<ElectronHostState> {
  constructor(id = 'host-el', name = '桌面生命周期控制器') {
    super(id, name, {
      isWindowOpen: false,
      config: { title: 'GraphVideo Desktop', width: 1440, height: 900, frameless: true },
      lastStatePayload: null,
      lastOperation: null,
      lastError: null,
    });
  }

  protected override change(info: Info, ctx: DomainChangeContext<ElectronHostState>): void {
    if (info.type === 'DesktopStartRequestedInfo' || info.type === 'OpenWindowTaskInfo' || info.type === 'BootInfo') {
      if (ctx.read('isWindowOpen')) return;
      const config = info.config && typeof info.config === 'object'
        ? { ...ctx.read('config'), ...(info.config as Partial<WindowConfig>) }
        : ctx.read('config');
      ctx.send({ type: 'ElectronWindowEffectRequestedInfo', request: { type: 'OPEN', config } }, 'sink-electron-window');
      return;
    }
    if (info.type === 'DesktopCloseRequestedInfo') {
      if (!ctx.read('isWindowOpen')) return;
      ctx.send({ type: 'ElectronWindowEffectRequestedInfo', request: { type: 'CLOSE' } }, 'sink-electron-window');
      return;
    }
    if (info.type === 'ConfigureWindowTaskInfo' && info.config && typeof info.config === 'object') {
      ctx.send({ type: 'ElectronWindowEffectRequestedInfo', request: { type: 'CONFIGURE', config: info.config } }, 'sink-electron-window');
      return;
    }
    if (info.type === 'WindowActionTaskInfo' && info.action) {
      const action = String(info.action).toUpperCase();
      if (action === 'MINIMIZE' || action === 'TOGGLE_MAXIMIZE' || action === 'RELOAD' || action === 'CLOSE') {
        ctx.send({ type: 'ElectronWindowEffectRequestedInfo', request: { type: action } }, 'sink-electron-window');
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
      return;
    }
    if (info.type === 'ElectronWindowEffectFailedInfo') {
      ctx.write('lastError', String(info.message));
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
  ) {
    super(id, name, {});
  }

  protected override async change(info: Info, ctx: WorldChangeContext<Record<never, never>>): Promise<void> {
    if (info.type !== 'ElectronWindowEffectRequestedInfo') return;
    try {
      const observation = await ctx.effectAdapter(this.adapter, info.request as ElectronWindowRequest);
      ctx.send({ type: 'ElectronWindowEffectObservedInfo', observation }, 'src-electron-window');
    } catch (error) {
      ctx.send({
        type: 'ElectronWindowEffectFailedInfo',
        message: error instanceof Error ? error.message : String(error),
      }, 'host-el');
    }
  }
}

/** Promotes adapter results and OS window events into graph observations. */
export class ElectronWindowObservationNode extends ObservationWorldNode<Record<never, never>> {
  constructor(id = 'src-electron-window', name = '桌面窗口观测端') {
    super(id, name, {});
  }

  protected override change(info: Info, ctx: WorldChangeContext<Record<never, never>>): void {
    if (info.type === 'ElectronWindowEffectObservedInfo') {
      ctx.send({ type: 'DesktopWindowObservedInfo', observation: info.observation }, 'host-el');
    } else if (info.type === 'ElectronWindowClosedObservedInfo') {
      ctx.send({
        type: 'DesktopWindowObservedInfo',
        observation: { type: 'CLOSED', isWindowOpen: false },
      }, 'host-el');
    }
  }
}

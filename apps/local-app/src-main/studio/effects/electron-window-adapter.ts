import type { EffectAdapter, EffectContext } from '@graphvideo/kernel';

export interface WindowConfig {
  title?: string;
  width?: number;
  height?: number;
  frameless?: boolean;
}

export type ElectronWindowRequest =
  | { readonly type: 'OPEN'; readonly config: WindowConfig }
  | { readonly type: 'CONFIGURE'; readonly config: Partial<WindowConfig> }
  | { readonly type: 'MINIMIZE' | 'TOGGLE_MAXIMIZE' | 'RELOAD' | 'CLOSE' };

export interface ElectronWindowObservation {
  readonly type:
    | 'OPENED'
    | 'CONFIGURED'
    | 'MINIMIZED'
    | 'MAXIMIZED'
    | 'UNMAXIMIZED'
    | 'RELOADED'
    | 'CLOSED';
  readonly isWindowOpen: boolean;
  readonly config?: WindowConfig;
}

export interface ElectronWindowPort {
  readonly id: string;
  execute(
    request: ElectronWindowRequest,
    context: EffectContext,
  ): Promise<ElectronWindowObservation>;
}

export const electronWindowAdapterId = 'graphvideo/electron-window-v1';

export class ElectronWindowAdapter implements EffectAdapter<
  ElectronWindowRequest,
  ElectronWindowObservation
> {
  readonly id = electronWindowAdapterId;

  constructor(private readonly port: ElectronWindowPort) {}

  async execute(request: ElectronWindowRequest, context: EffectContext) {
    if (context.signal?.aborted) {
      throw context.signal.reason ?? new Error('Electron Window 操作已取消');
    }
    context.recordTransport?.({
      portId: this.port.id,
      operation: request.type,
    });
    const observation = await this.port.execute(request, context);
    if (!observation?.type || typeof observation.isWindowOpen !== 'boolean') {
      throw new Error('Electron Window Observation 不完整');
    }
    return observation;
  }
}

export class InMemoryElectronWindowAdapter implements EffectAdapter<
  ElectronWindowRequest,
  ElectronWindowObservation
> {
  readonly id = electronWindowAdapterId;
  private config: WindowConfig = {
    title: 'GraphVideo Desktop',
    width: 1400,
    height: 900,
    frameless: true,
  };
  private open = false;
  private maximized = false;

  async execute(request: ElectronWindowRequest): Promise<ElectronWindowObservation> {
    if (request.type === 'OPEN') {
      this.config = { ...request.config };
      this.open = true;
      return { type: 'OPENED', isWindowOpen: true, config: this.config };
    }
    if (request.type === 'CONFIGURE') {
      this.config = { ...this.config, ...request.config };
      return { type: 'CONFIGURED', isWindowOpen: this.open, config: this.config };
    }
    if (request.type === 'CLOSE') {
      this.open = false;
      return { type: 'CLOSED', isWindowOpen: false, config: this.config };
    }
    if (request.type === 'TOGGLE_MAXIMIZE') {
      this.maximized = !this.maximized;
      return {
        type: this.maximized ? 'MAXIMIZED' : 'UNMAXIMIZED',
        isWindowOpen: this.open,
        config: this.config,
      };
    }
    return {
      type: request.type === 'MINIMIZE' ? 'MINIMIZED' : 'RELOADED',
      isWindowOpen: this.open,
      config: this.config,
    };
  }
}

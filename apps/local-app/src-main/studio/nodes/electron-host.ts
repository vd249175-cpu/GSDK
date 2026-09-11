import { WorldNode } from '@graphvideo/kernel';
import type { Info, WorldChangeContext } from '@graphvideo/kernel';
import type { EffectAdapter } from '@graphvideo/kernel';
import { InMemoryElectronWindowAdapter, type ElectronWindowObservation, type ElectronWindowRequest, } from '../effects/electron-window-adapter';
export interface WindowConfig {
    title: string;
    width: number;
    height: number;
    frameless?: boolean;
}
export interface UserUiEvent {
    action: string;
    payload: any;
    timestamp: number;
}
export interface ElectronHostState {
    isWindowOpen: boolean;
    config: WindowConfig;
    lastStatePayload: any;
    lastOperation: ElectronWindowObservation['type'] | null;
    lastError: string | null;
}
export class ElectronHostNode extends WorldNode<ElectronHostState> {
    constructor(id: string = 'host-el', name: string = '应用级桌面渲染宿主', private readonly adapter: EffectAdapter<ElectronWindowRequest, ElectronWindowObservation> = new InMemoryElectronWindowAdapter()) {
        super(id, name, {
            isWindowOpen: false,
            config: {
                title: 'GraphVideo Desktop',
                width: 1400,
                height: 900,
                frameless: true,
            },
            lastStatePayload: null,
            lastOperation: null,
            lastError: null,
        });
        this.icon = '🖥️';
        this.description =
            '【桌面独立视窗】管理 Electron 原生渲染进程与窗口生命周期\n【UI 桥接总线】接收全图 State 投影推流原生视口\n【物理反向触发】向 Input 平台节点广播 WindowEvent 与用户交互事实';
    }
    protected override async change(info: Info, ctx: WorldChangeContext<ElectronHostState>): Promise<void> {
        const handleObservation = (observation: ElectronWindowObservation) => {
            const isWindowOpen = observation.isWindowOpen;
            const config = observation.config
                ? {
                    title: observation.config.title ?? this.state.config.title,
                    width: observation.config.width ?? this.state.config.width,
                    height: observation.config.height ?? this.state.config.height,
                    frameless: observation.config.frameless ?? this.state.config.frameless,
                }
                : this.state.config;
            {
                ctx.write('isWindowOpen', isWindowOpen);
                ctx.write('config', config);
                ctx.write('lastOperation', observation.type);
                ctx.write('lastError', null);
            }
        };
        const executeAdapter = async (request: ElectronWindowRequest) => {
            try {
                const observation = await ctx.effectAdapter(this.adapter, request);
                handleObservation(observation);
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                ctx.write('lastError', message);
            }
        };
        if (info.type === 'OpenWindowTaskInfo' || info.type === 'BootInfo') {
            const config = info.config || this.state.config;
            await executeAdapter({ type: 'OPEN', config });
            return;
        }
        if (info.type === 'ConfigureWindowTaskInfo' && info.config) {
            await executeAdapter({ type: 'CONFIGURE', config: info.config });
            return;
        }
        if (info.type === 'WindowActionTaskInfo' && info.action) {
            const action = String(info.action).toUpperCase();
            if (action === 'MINIMIZE' ||
                action === 'TOGGLE_MAXIMIZE' ||
                action === 'RELOAD' ||
                action === 'CLOSE') {
                await executeAdapter({ type: action });
            }
            return;
        }
        if (info.type === 'UiStateInfo' && info.payload) {
            {
                ctx.write('lastStatePayload', info.payload);
            }
        }
    }
    public getBodySummaryText(): string {
        return this.state.isWindowOpen
            ? `窗口已开启 (${this.state.config.width}x${this.state.config.height}) [${this.state.lastOperation || 'IDLE'}]`
            : '窗口已关闭/未激活';
    }
}

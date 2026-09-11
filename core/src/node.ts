import type {
  Info,
  InfoEnvelope,
  ChangeRecord,
  DomainChangeContext,
  WorldChangeContext,
} from './types';
import type { NodeStateSnapshot, EncodedValue, RuntimeIdKind } from './observation';
import {
  TimeRandomIdProvider,
  systemClock,
  systemRandomSource,
} from './observation';
import { ChangeContextImpl } from './context';
import { changeContextCapability, nodeRuntimeCapability } from './internal-access';

export { ChangeContextImpl };

const fallbackIdProvider = new TimeRandomIdProvider(systemClock, systemRandomSource);

function cancellationError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  if (signal.reason && typeof signal.reason === 'object') {
    const reason = signal.reason as { name?: unknown; message?: unknown };
    if (typeof reason.message === 'string') {
      const error = new Error(reason.message);
      if (typeof reason.name === 'string') error.name = reason.name;
      return error;
    }
  }
  const error = new Error(
    typeof signal.reason === 'string' ? signal.reason : 'Graph execution canceled',
  );
  error.name = 'AbortError';
  return error;
}

export type NodeStatus = 'IDLE' | 'RUNNING' | 'ERROR' | 'ABORTED';
export type Disposer = () => void | Promise<void>;

interface MailboxEntry {
  readonly info: Info;
  readonly envelope?: InfoEnvelope;
  readonly options: { signal?: AbortSignal };
  readonly resolve: () => void;
  readonly reject: (error: unknown) => void;
}

/**
 * Minimal Graph Node Base Class
 */
export abstract class Node<
  S = any,
  C extends DomainChangeContext<S> = DomainChangeContext<S>,
> {
  public readonly factoryKey: string;
  public isWorldNode: boolean = false;

  public status: NodeStatus = 'IDLE';
  public executionCount: number = 0;
  public lastActiveTime: number = 0;
  public lastErrorMessage: string | null = null;

  protected state: S;
  private regionVersions: Map<string, number> = new Map();
  private globalVersion: number = 0;

  private readonly mailbox: MailboxEntry[] = [];
  private drainingMailbox = false;
  private activeChangeId: string | undefined;

  private disposers: Set<Disposer> = new Set();
  private abortController: AbortController = new AbortController();

  private kernel: any = null;

  constructor(
    public readonly id: string,
    public name: string,
    initialState: S = {} as S,
    factoryKey?: string,
  ) {
    this.factoryKey = factoryKey || id;
    this.state = { ...initialState };
  }

  public getState(): Readonly<S> {
    return this.state;
  }

  public getStateRegionVersions(): Readonly<Record<string, number>> {
    return Object.fromEntries(this.regionVersions.entries());
  }

  public getGlobalStateVersion(): number {
    return this.globalVersion;
  }

  public getMailboxSize(): number {
    return this.mailbox.length;
  }

  public getActiveChangeId(): string | undefined {
    return this.activeChangeId;
  }

  public _restoreStateSnapshot(
    capability: typeof nodeRuntimeCapability,
    snapshot: NodeStateSnapshot,
    decodedState: unknown,
  ): void {
    if (capability !== nodeRuntimeCapability) throw new Error('[Kernel]: Invalid runtime capability');
    if (snapshot.nodeId !== this.id) {
      throw new Error(`State Snapshot 节点不匹配: 期望 ${this.id}，实际 ${snapshot.nodeId}`);
    }
    this.state = decodedState as S;
    this.globalVersion = snapshot.globalVersion;
    this.regionVersions = new Map(Object.entries(snapshot.regionVersions || {}));
  }

  /** @internal Runtime ownership boundary. Domain nodes cannot reach the engine directly. */
  public _mountKernel(capability: typeof nodeRuntimeCapability, kernel: unknown): void {
    if (capability !== nodeRuntimeCapability) throw new Error('[Kernel]: Invalid runtime capability');
    if (this.kernel && this.kernel !== kernel) {
      throw new Error(`[Kernel]: Node "${this.name}" (${this.id}) 已挂载到其他 Runtime`);
    }
    this.kernel = kernel;
  }

  /** @internal Runtime ownership boundary. */
  public _unmountKernel(capability: typeof nodeRuntimeCapability, kernel: unknown): void {
    if (capability !== nodeRuntimeCapability) throw new Error('[Kernel]: Invalid runtime capability');
    if (this.kernel === kernel) this.kernel = null;
  }

  public _enqueueMailbox(
    capability: typeof nodeRuntimeCapability,
    info: Info,
    envelope?: InfoEnvelope,
    options: { signal?: AbortSignal } = {},
  ): Promise<void> {
    if (capability !== nodeRuntimeCapability) {
      return Promise.reject(new Error('[Kernel]: Invalid runtime capability'));
    }
    return new Promise((resolve, reject) => {
      this.mailbox.push({ info, envelope, options, resolve, reject });
    });
  }

  public async _drainMailbox(capability: typeof nodeRuntimeCapability): Promise<void> {
    if (capability !== nodeRuntimeCapability) throw new Error('[Kernel]: Invalid runtime capability');
    if (this.drainingMailbox) return;
    this.drainingMailbox = true;
    try {
      while (this.mailbox.length > 0) {
        const item = this.mailbox.shift()!;
        try {
          if (item.options.signal?.aborted) {
            item.reject(cancellationError(item.options.signal));
            continue;
          }
          await this.runWithinChangeContext(item.info, item.envelope, item.options);
          item.resolve();
        } catch (error) {
          item.reject(error);
        }
      }
    } finally {
      this.drainingMailbox = false;
    }
  }

  private async runWithinChangeContext(
    info: Info,
    envelope?: InfoEnvelope,
    options: { signal?: AbortSignal } = {},
  ): Promise<void> {
    if (this.activeChangeId) {
      throw new Error(
        `[Single-Flight Violation]: 节点 "${this.name}" (${this.id}) 正在运行变迁 ${this.activeChangeId}，严禁并发执行 change`,
      );
    }

    const changeId = this.runtimeId('change');
    this.activeChangeId = changeId;
    const versionBefore = this.globalVersion;
    const causeInfoId = envelope?.infoId || this.runtimeId('info-root');
    const causeInfoType = info.type || 'Info';

    this.recordChangeStarted({
      changeId,
      nodeId: this.id,
      causeInfoId,
      causeInfoType,
      stateVersionBefore: versionBefore,
    });
    this.kernel?.beginChangeExecution?.(changeId);

    const context = this.createChangeContext(info, changeId, envelope, options.signal);
    const startMonotonic = this.runtimeMonotonicNow();
    const startWall = this.runtimeNow();
    this.status = 'RUNNING';

    try {
      await this.change(info, context as any);

      if (context.stateDeltas.length > 0) {
        this.kernel?.traceSession?.record?.({
          type: 'StateDeltaCommitted',
          changeId,
          nodeId: this.id,
          stateVersionAfter: this.globalVersion,
          deltas: context.stateDeltas,
        });
      }

      this.status = 'IDLE';
      this.executionCount++;
      this.lastActiveTime = this.runtimeNow();

      const record: ChangeRecord = {
        changeId,
        nodeId: this.id,
        causeInfoId,
        causeInfoType,
        causedByChangeId: envelope?.causedByChangeId,
        stateVersionBefore: versionBefore,
        stateVersionAfter: this.globalVersion,
        reads: Array.from(context.reads),
        writes: Array.from(context.writes),
        stateDeltas: context.stateDeltas,
        spans: context.spans,
        durationMs: this.runtimeMonotonicNow() - startMonotonic,
        timestamp: startWall,
      };
      this.recordChange(record);
    } catch (err: any) {
      const isAbort =
        options.signal?.aborted ||
        err?.name === 'AbortError' ||
        (typeof err?.message === 'string' && err.message.toLowerCase().includes('abort'));
      this.status = isAbort ? 'ABORTED' : 'ERROR';
      this.lastErrorMessage = err?.message || String(err);
      const record: ChangeRecord = {
        changeId,
        nodeId: this.id,
        causeInfoId,
        causeInfoType,
        causedByChangeId: envelope?.causedByChangeId,
        stateVersionBefore: versionBefore,
        stateVersionAfter: this.globalVersion,
        reads: Array.from(context.reads),
        writes: Array.from(context.writes),
        stateDeltas: context.stateDeltas,
        spans: context.spans,
        durationMs: this.runtimeMonotonicNow() - startMonotonic,
        timestamp: startWall,
        error: this.lastErrorMessage || undefined,
      };
      this.recordChange(record);
      throw err;
    } finally {
      this.kernel?.endChangeExecution?.(changeId);
      this.activeChangeId = undefined;
    }
  }

  protected createChangeContext(
    info: Info,
    changeId: string,
    envelope?: InfoEnvelope,
    signal?: AbortSignal,
  ): ChangeContextImpl<S> {
    return new ChangeContextImpl<S>(this, info, changeId, envelope, signal);
  }

  public get stateVersion(): number {
    return this.globalVersion;
  }

  public commitStateFromChange(
    capability: typeof changeContextCapability,
    changeId: string,
    patch: Partial<S>,
    causeInfo?: Info,
  ): void {
    if (capability !== changeContextCapability) {
      throw new Error(`[State Write Violation]: Node ${this.id} 拒绝非 ChangeContext 写入`);
    }
    if (!this.activeChangeId || this.activeChangeId !== changeId) {
      throw new Error(`[State Write Violation]: Node ${this.id} 只能在 change context 内提交 State`);
    }
    const region = (causeInfo?.type as string) || 'change';
    this.regionVersions.set(region, (this.regionVersions.get(region) || 0) + 1);
    this.globalVersion += 1;
    this.state = { ...this.state, ...patch };
  }

  public _sendFromChange(
    capability: typeof changeContextCapability,
    info: Info,
    target: Node<any> | string,
    options?: {
      infoId?: string;
      causedByChangeId?: string;
      causeInfoId?: string;
      submissionId?: string;
      signal?: AbortSignal;
    },
  ): void {
    if (capability !== changeContextCapability) {
      throw new Error(`[Send Violation]: Node ${this.id} 拒绝非 ChangeContext 发信`);
    }
    if (!this.activeChangeId || options?.causedByChangeId !== this.activeChangeId) {
      throw new Error(`[Send Violation]: Node ${this.id} 只能通过当前 change context 发信`);
    }
    if (!this.kernel) {
      throw new Error(`[Kernel]: Node "${this.name}" (${this.id}) 尚未挂载，无法发信`);
    }
    this.kernel._deliverSendFromChange(this, info, target, options);
  }

  protected change(_info: Info, _ctx: C): void | Promise<void> {}

  public runtimeNow(): number {
    return this.kernel?.now?.() ?? systemClock.now();
  }

  public runtimeMonotonicNow(): number {
    return this.kernel?.monotonicNow?.() ?? systemClock.monotonicNow();
  }

  public runtimeId(kind: RuntimeIdKind): string {
    return this.kernel?.nextId?.(kind) ?? fallbackIdProvider.nextId(kind);
  }

  public encodeTraceValue(field: string, value: unknown): EncodedValue {
    return this.kernel?.encodeTraceValue?.(this.id, field, value) ?? {
      $type: 'primitive',
      value: (value as any) ?? null,
    };
  }

  public runtimeValueRef(kind: string, value: unknown): string {
    return this.kernel?.recordValueRef?.(kind, value) ?? `${kind}:${this.runtimeId('effect')}`;
  }

  public recordChangeStarted(input: {
    changeId: string;
    nodeId: string;
    causeInfoId: string;
    causeInfoType: string;
    stateVersionBefore: number;
  }): void {
    this.kernel?.recordChangeStarted?.(input);
  }

  public recordChange(record: ChangeRecord): void {
    this.kernel?.recordChange?.(record);
  }

  public recordEffectRequested(input: {
    effectId: string;
    changeId: string;
    nodeId: string;
    name?: string;
    adapterId?: string;
    requestRef?: string;
  }): void {
    this.kernel?.recordEffectRequested?.(input);
  }

  public recordEffectObserved(input: {
    effectId: string;
    changeId: string;
    nodeId: string;
    name?: string;
    status: 'succeeded' | 'failed';
    adapterId?: string;
    requestRef?: string;
    observationRef?: string;
  }): void {
    this.kernel?.recordEffectObserved?.(input);
  }

  public onMount(): void {}
  public onUnmount(): void {}

  public registerDisposer(disposer: Disposer): void {
    this.disposers.add(disposer);
  }

  public async dispose(): Promise<void> {
    this.abort();
    for (const disposer of this.disposers) {
      try {
        await disposer();
      } catch (err) {
        console.error(`[Node ${this.id}] Disposer failed:`, err);
      }
    }
    this.disposers.clear();
    this.onUnmount();
    this.status = 'IDLE';
  }

  public abort(reason?: string): void {
    this.abortController.abort(reason);
    this.status = 'ABORTED';
    this.lastErrorMessage = reason || 'Execution aborted';
    this.abortController = new AbortController();
  }

  public reset(): void {
    this.status = 'IDLE';
    this.lastErrorMessage = null;
    this.mailbox.length = 0;
  }
}

export type WorldNodeKind = 'execution' | 'observation';

/**
 * WorldNode Base Class
 * 物理节点基类。架构约束：WorldNode 必须分为执行与观察两类，两者职责严格物理分离。
 */
export abstract class WorldNode<
  S = any,
  C extends WorldChangeContext<S> = WorldChangeContext<S>,
> extends Node<S, C> {
  public override isWorldNode = true;
  public worldKind?: WorldNodeKind;
}

/**
 * 执行类物理节点（Execution WorldNode）：
 * 负责主动向外部物理系统发起动作、修改外部世界、启动外部任务并获取提交句柄（handle）。
 * 架构红线：执行类节点零持续监听职责，不兼任状态轮询或物理事件捕获。
 */
export abstract class ExecutionWorldNode<
  S = any,
  C extends WorldChangeContext<S> = WorldChangeContext<S>,
> extends WorldNode<S, C> {
  public override readonly worldKind: WorldNodeKind = 'execution';
}

/**
 * 观察类物理节点（Observation WorldNode）：
 * 负责监听物理世界事件、轮询外部状态/进度，并将物理感知事实（Observation）
 * 转化为 Info 定向回传给业务领域 Node。
 * 架构红线：观察类节点零外部主动写操作，不兼任动作执行与副作用下发。
 */
export abstract class ObservationWorldNode<
  S = any,
  C extends WorldChangeContext<S> = WorldChangeContext<S>,
> extends WorldNode<S, C> {
  public override readonly worldKind: WorldNodeKind = 'observation';
}

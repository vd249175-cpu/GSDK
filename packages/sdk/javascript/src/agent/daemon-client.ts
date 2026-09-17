import { createConnection, type Socket } from 'node:net';
import { createInterface, type Interface } from 'node:readline';

export interface KernelDaemonClientOptions {
  readonly address: string;
  readonly token: string;
  readonly connectTimeoutMs?: number;
}

export type DaemonChangeOperation =
  | { readonly op: 'write'; readonly key: string; readonly value: unknown }
  | { readonly op: 'patchState'; readonly patch: Record<string, unknown> }
  | { readonly op: 'send'; readonly targetNodeId: string; readonly info: { readonly type: string; readonly [key: string]: unknown } };

export interface DaemonPolledChange {
  readonly change: {
    readonly changeId: number;
    readonly infoId: number;
    readonly nodeId: string;
    readonly generation: number;
    readonly sender: string;
    readonly info: { readonly type: string; readonly [key: string]: unknown };
    readonly causedBy?: number;
    readonly submissionId?: string;
  };
  readonly state: Readonly<Record<string, unknown>>;
}

export interface DaemonPolledEffect {
  readonly effectId: number;
  readonly changeId: number;
  readonly nodeId: string;
  readonly generation: number;
  readonly adapterId: string;
  readonly request: unknown;
}

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
}

function splitAddress(address: string): { host: string; port: number } {
  const separator = address.lastIndexOf(':');
  if (separator < 1) throw new Error(`Invalid kernel daemon address: ${address}`);
  const host = address.slice(0, separator).replace(/^\[|\]$/g, '');
  const port = Number(address.slice(separator + 1));
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid kernel daemon address: ${address}`);
  }
  return { host, port };
}

/** Thin DTO client. Business Node adapters may wrap it without embedding any domain protocol in Rust. */
export class KernelDaemonClient {
  private readonly pending = new Map<number, PendingRequest>();
  private nextId = 0;
  private closed = false;
  private shutdownPromise?: Promise<{ shutdown: boolean }>;

  private constructor(
    private readonly socket: Socket,
    private readonly lines: Interface,
    private readonly token: string,
  ) {
    lines.on('line', (line) => this.receive(line));
    socket.on('error', (error) => this.failAll(error));
    socket.on('close', () => this.failAll(new Error('Kernel daemon connection closed')));
  }

  static async connect(options: KernelDaemonClientOptions): Promise<KernelDaemonClient> {
    if (options.token.length < 16) throw new Error('Kernel daemon token must have at least 16 bytes');
    const { host, port } = splitAddress(options.address);
    const socket = createConnection({ host, port });
    const timeoutMs = options.connectTimeoutMs ?? 5000;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error(`Kernel daemon connection timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      socket.once('connect', () => { clearTimeout(timer); resolve(); });
      socket.once('error', (error) => { clearTimeout(timer); reject(error); });
    });
    return new KernelDaemonClient(
      socket,
      createInterface({ input: socket, crlfDelay: Infinity }),
      options.token,
    );
  }

  request<T = unknown>(op: string, payload: Record<string, unknown> = {}): Promise<T> {
    if (this.closed || !this.socket.writable) return Promise.reject(new Error('Kernel daemon connection is closed'));
    const id = ++this.nextId;
    const frame = JSON.stringify({ ...payload, version: 1, id, token: this.token, op });
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.socket.write(`${frame}\n`, (error) => {
        if (!error) return;
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  health() { return this.request<{ closed: boolean; pid: number; nodes: number; pending: number; leases: number; effectLeases: number; effects: number }>('health'); }
  /** Explicitly stop an owned, empty daemon. close() only disconnects this client. */
  shutdown(): Promise<{ shutdown: boolean }> {
    if (this.shutdownPromise) return this.shutdownPromise;
    const operation = this.request<{ shutdown: boolean }>('shutdown');
    this.shutdownPromise = operation;
    void operation.catch(() => { if (this.shutdownPromise === operation) this.shutdownPromise = undefined; });
    return operation;
  }
  admit(nodeId: string, initialState: Record<string, unknown>, analysisFacts?: unknown, effectCapabilities: readonly string[] = []) {
    return this.request<{ generation: number }>('admit', { nodeId, initialState, analysisFacts, effectCapabilities });
  }
  evict(nodeId: string) {
    return this.request<{ evicted: boolean }>('evict', { nodeId });
  }
  replace(nodeId: string, initialState: Record<string, unknown>, analysisFacts?: unknown, effectCapabilities: readonly string[] = []) {
    return this.request<{ generation: number }>('replace', { nodeId, initialState, analysisFacts, effectCapabilities });
  }
  inject(targetNodeId: string, info: { type: string; [key: string]: unknown }, submissionId: string) {
    return this.request('inject', { targetNodeId, info, submissionId });
  }
  claim(nodeIds: readonly string[]) { return this.request<{ nodeIds: string[] }>('claim', { nodeIds }); }
  release(nodeIds: readonly string[]) { return this.request<{ nodeIds: string[] }>('release', { nodeIds }); }
  poll(waitMs = 0) { return this.request<DaemonPolledChange | null>('poll', { waitMs }); }
  commit(changeId: number, operations: readonly DaemonChangeOperation[], error?: string) {
    return this.request('commit', { changeId, operations, error });
  }
  claimEffects(adapterIds: readonly string[]) { return this.request('claimEffects', { adapterIds }); }
  releaseEffects(adapterIds: readonly string[]) { return this.request('releaseEffects', { adapterIds }); }
  requestEffect(changeId: number, adapterId: string, request: unknown) {
    return this.request<{ effectId: number }>('requestEffect', { changeId, adapterId, request });
  }
  awaitEffect(effectId: number, waitMs = 30_000) {
    return this.request<{ ok: boolean; value: unknown } | null>('awaitEffect', { effectId, waitMs });
  }
  pollEffect(waitMs = 0) { return this.request<DaemonPolledEffect | null>('pollEffect', { waitMs }); }
  completeEffect(effectId: number, result: { ok: true; observation: unknown } | { ok: false; error: string }) {
    return this.request('completeEffect', { effectId, ...result });
  }
  projection() { return this.request('projection'); }
  analysisFacts() { return this.request('analysisFacts'); }
  intervene(nodeId: string, patch: Record<string, unknown>, expectedGeneration: number, expectedVersion: number) {
    return this.request('intervene', { nodeId, patch, expectedGeneration, expectedVersion });
  }
  cancel(submissionId: string) { return this.request('cancel', { submissionId }); }
  /** Authoritative Rust analysis: pure DTO passthrough, no local computation. */
  analyze(request: Record<string, unknown>) {
    return this.request('analyze', { request });
  }
  setAnalysisContext(frontendLinks: readonly unknown[] = [], frontendServiceLinks: readonly unknown[] = []) {
    return this.request('setAnalysisContext', { frontendLinks, frontendServiceLinks });
  }
  agentInspect(after?: number, limit?: number) {
    return this.request('agentInspect', { ...(after !== undefined ? { after } : {}), ...(limit !== undefined ? { limit } : {}) });
  }
  agentInject(actor: string, reason: string, submissionId: string, targetNodeId: string, info: Record<string, unknown>) {
    return this.request('agentInject', { actor, reason, submissionId, targetNodeId, info });
  }
  agentInterveneState(actor: string, reason: string, nodeId: string, patch: Record<string, unknown>, expectedGeneration: number, expectedVersion: number) {
    return this.request('agentInterveneState', { actor, reason, nodeId, patch, expectedGeneration, expectedVersion });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.lines.close();
    this.socket.end();
    this.failAll(new Error('Kernel daemon connection closed by client'));
  }

  private receive(line: string): void {
    let frame: { id?: unknown; ok?: unknown; result?: unknown; error?: unknown };
    try { frame = JSON.parse(line); } catch { this.failAll(new Error('Kernel daemon returned invalid JSON')); return; }
    if (!Number.isSafeInteger(frame.id)) return;
    const pending = this.pending.get(frame.id as number);
    if (!pending) return;
    this.pending.delete(frame.id as number);
    if (frame.ok === true) pending.resolve(frame.result);
    else pending.reject(new Error(typeof frame.error === 'string' ? frame.error : 'Kernel daemon request failed'));
  }

  private failAll(error: Error): void {
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
  }
}

export function connectKernelDaemon(options: KernelDaemonClientOptions): Promise<KernelDaemonClient> {
  return KernelDaemonClient.connect(options);
}

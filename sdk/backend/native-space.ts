import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface NativeInfo {
  readonly type: string;
  [key: string]: unknown;
}

export type NativeDeliveryStatus = 'enqueued' | 'dropped';

export interface NativeDeliveryFeedback {
  readonly status: NativeDeliveryStatus;
  readonly reason?: string;
}

export interface NativeChangeContext<S = any> {
  read<K extends keyof S>(key: K): S[K];
  write<K extends keyof S>(key: K, value: S[K]): void;
  patchState(patch: Partial<S>): void;
  send(info: NativeInfo, targetNodeId: string): NativeDeliveryFeedback;
}

export type NativeHandler<S = any> = (
  info: NativeInfo,
  ctx: NativeChangeContext<S>,
) => void | Promise<void>;

interface BindingFeedback {
  status: string;
  reason?: string;
}

interface BindingToken {
  changeId: number;
  entity: string;
  generation: number;
  submission?: string;
}

interface BindingView {
  changeId: number;
  entity: string;
  generation: number;
  infoType: string;
  sender: string;
  payloadJson?: string;
  submission?: string;
}

interface BindingPolled {
  token: BindingToken;
  view: BindingView;
}

interface BindingSpace {
  admit(id: string): number;
  evict(id: string): boolean;
  seal(id: string): void;
  unseal(id: string): void;
  generation(id: string): number | null;
  send(
    sender: string,
    infoType: string,
    payloadJson: string | null,
    target: string,
    causedBy: number | null,
    submission?: string,
  ): BindingFeedback;
  injectRoot(
    target: string,
    infoType: string,
    payloadJson: string | null,
    submission: string,
  ): BindingFeedback;
  pollNext(): BindingPolled | null;
  settleChange(token: BindingToken, failedMessage: string | null): boolean;
  cancel(submission: string): boolean;
  submissionState(submission: string): string | null;
  pendingTotal(): number;
}

interface RegisteredNode {
  state: Record<string, unknown>;
  handler: NativeHandler<any>;
}

const ERROR_INFO_TYPE = '@error/NodeFailed';

/** Absolute path of the built native module, if present. */
export function locateNativeBinding(): string | null {
  if (process.env.GRAPHVIDEO_NATIVE_NODE && existsSync(process.env.GRAPHVIDEO_NATIVE_NODE)) {
    return process.env.GRAPHVIDEO_NATIVE_NODE;
  }
  const here = dirname(fileURLToPath(import.meta.url));
  const candidate = resolve(
    here,
    '..',
    '..',
    'crates',
    'kernel-node',
    'graphvideo-kernel-node.win32-x64-msvc.node',
  );
  return existsSync(candidate) ? candidate : null;
}

function loadBinding(): BindingSpace {
  const path = locateNativeBinding();
  if (!path) {
    throw new Error(
      'Native rule space not built: run cargo build -p graphvideo-kernel-node and copy the cdylib to crates/kernel-node/',
    );
  }
  const require = createRequire(import.meta.url);
  const module = require(path) as { RuleSpace: new () => BindingSpace };
  return new module.RuleSpace();
}

function toFeedback(feedback: BindingFeedback): NativeDeliveryFeedback {
  if (feedback.status === 'enqueued') return { status: 'enqueued' };
  return { status: 'dropped', reason: feedback.reason };
}

function splitPayload(info: NativeInfo): string {
  const { type: _type, ...payload } = info;
  return JSON.stringify(payload);
}

function joinInfo(infoType: string, payloadJson?: string): NativeInfo {
  if (!payloadJson) return { type: infoType };
  try {
    const payload = JSON.parse(payloadJson) as Record<string, unknown>;
    return { ...payload, type: infoType };
  } catch {
    return { type: infoType };
  }
}

/**
 * JS business entities on the Rust rule space.
 *
 * Scheduling facts (registry, mailboxes, submissions, drops) live in Rust;
 * business State and change bodies live here. The pump is JS-driven and
 * non-reentrant: `pump`, `injectRoot` settlement waits and `replace` refuse
 * to run while a pump is active.
 */
export class NativeRuleSpace {
  private readonly binding: BindingSpace;
  private readonly nodes = new Map<string, RegisteredNode>();
  private readonly submissions = new Map<string, string>();
  private pumping = false;
  public errorTargetNodeId?: string;

  constructor(options: { errorTargetNodeId?: string } = {}) {
    this.binding = loadBinding();
    this.errorTargetNodeId = options.errorTargetNodeId;
  }

  register<S extends Record<string, unknown>>(
    id: string,
    initialState: S,
    handler: NativeHandler<S>,
  ): number {
    if (this.nodes.has(id)) throw new Error(`Entity already registered: ${id}`);
    const generation = this.binding.admit(id);
    this.nodes.set(id, {
      state: { ...initialState },
      handler: handler as NativeHandler<any>,
    });
    return generation;
  }

  unregister(id: string): boolean {
    if (!this.nodes.has(id)) return false;
    this.nodes.delete(id);
    return this.binding.evict(id);
  }

  replace<S extends Record<string, unknown>>(
    id: string,
    initialState: S,
    handler: NativeHandler<S>,
  ): number {
    if (this.pumping) throw new Error(`Cannot replace while pumping: ${id}`);
    const current = this.nodes.get(id);
    if (!current) throw new Error(`Cannot replace missing entity: ${id}`);
    this.binding.seal(id);
    this.binding.evict(id);
    const generation = this.binding.admit(id);
    this.nodes.set(id, {
      state: { ...initialState },
      handler: handler as NativeHandler<any>,
    });
    return generation;
  }

  getState(id: string): Record<string, unknown> | undefined {
    return this.nodes.get(id)?.state;
  }

  generation(id: string): number | null {
    return this.binding.generation(id);
  }

  pendingTotal(): number {
    return this.binding.pendingTotal();
  }

  submissionState(submissionId: string): string | null {
    return this.binding.submissionState(submissionId);
  }

  cancel(submissionId: string): boolean {
    return this.binding.cancel(submissionId);
  }

  injectRoot(targetNodeId: string, info: NativeInfo, submissionId?: string): string {
    const submission = submissionId ?? `native/${Date.now()}/${Math.random().toString(36).slice(2)}`;
    this.submissions.set(submission, submission);
    this.binding.injectRoot(targetNodeId, info.type, splitPayload(info), submission);
    return submission;
  }

  async waitForSubmission(submissionId: string): Promise<void> {
    for (let rounds = 0; rounds < 10_000; rounds++) {
      await this.pump();
      const state = this.binding.submissionState(submissionId);
      if (state === 'completed') return;
      if (state === null || state === undefined) {
        throw new Error(`Submission not found: ${submissionId}`);
      }
      if (state === 'cancelled') {
        const error = new Error(`Submission cancelled: ${submissionId}`);
        error.name = 'AbortError';
        throw error;
      }
      if (state.startsWith('failed:')) {
        throw new Error(state.slice('failed:'.length));
      }
    }
    throw new Error(`Submission did not settle: ${submissionId}`);
  }

  /** Drain every runnable change. Non-reentrant. Returns changes executed. */
  async pump(): Promise<number> {
    if (this.pumping) throw new Error('Native pump is non-reentrant');
    this.pumping = true;
    try {
      let ran = 0;
      for (;;) {
        const polled = this.binding.pollNext();
        if (!polled) return ran;
        ran++;
        await this.runOne(polled);
      }
    } finally {
      this.pumping = false;
    }
  }

  private makeContext<S>(
    entity: string,
    changeId: number,
    submission: string | undefined,
  ): NativeChangeContext<S> {
    const space = this;
    return {
      read<K extends keyof S>(key: K): S[K] {
        const node = space.nodes.get(entity);
        if (!node) throw new Error(`Entity state gone: ${entity}`);
        return node.state[key as string] as S[K];
      },
      write<K extends keyof S>(key: K, value: S[K]): void {
        const node = space.nodes.get(entity);
        if (!node) throw new Error(`Entity state gone: ${entity}`);
        node.state[key as string] = value;
      },
      patchState(patch: Partial<S>): void {
        const node = space.nodes.get(entity);
        if (!node) throw new Error(`Entity state gone: ${entity}`);
        Object.assign(node.state, patch);
      },
      send(info: NativeInfo, targetNodeId: string): NativeDeliveryFeedback {
        return toFeedback(
          space.binding.send(
            entity,
            info.type,
            splitPayload(info),
            targetNodeId,
            changeId,
            submission,
          ),
        );
      },
    };
  }

  private async runOne(polled: BindingPolled): Promise<void> {
    const node = this.nodes.get(polled.view.entity);
    if (!node) {
      this.binding.settleChange(polled.token, 'entity unregistered mid-flight');
      return;
    }
    const info = joinInfo(polled.view.infoType, polled.view.payloadJson);
    const ctx = this.makeContext(polled.view.entity, polled.view.changeId, polled.view.submission);
    try {
      await node.handler(info, ctx);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.routeErrorAsInfo(polled, info.type, message, stack);
      this.binding.settleChange(polled.token, null);
      return;
    }
    this.binding.settleChange(polled.token, null);
  }

  private routeErrorAsInfo(
    polled: BindingPolled,
    triggerType: string,
    message: string,
    stack: string | undefined,
  ): void {
    const target = this.errorTargetNodeId;
    if (!target || target === polled.view.entity) return;
    if (triggerType === ERROR_INFO_TYPE) return;
    if (!this.nodes.has(target)) return;
    this.binding.send(
      polled.view.entity,
      ERROR_INFO_TYPE,
      JSON.stringify({
        nodeId: polled.view.entity,
        generation: polled.view.generation,
        changeId: polled.view.changeId,
        submission: polled.view.submission,
        causeInfoType: triggerType,
        message,
        stack,
      }),
      target,
      polled.view.changeId,
      polled.view.submission,
    );
  }
}

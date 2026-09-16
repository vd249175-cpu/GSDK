import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { EffectAdapter } from '../effect/effects';
import type { PortableAnalysisSnapshot } from '../analysis/model';
import type { NativeChangeContext, NativeInfo } from './native-space';
import { NativeRuleSpace } from './native-space';

export interface ProcessNodeOptions {
  command: string;
  args?: string[];
  cwd?: string;
  expectedNodeId?: string;
  adapters?: Readonly<Record<string, EffectAdapter<any, any>>>;
  readyTimeoutMs?: number;
}

export interface ProcessNodeHandle {
  nodeId: string;
  dispose(): Promise<void>;
}

interface ReadyFrame {
  kind: 'ready'; version: 1; nodeId: string;
  initialState: Record<string, unknown>;
  analysisFacts: PortableAnalysisSnapshot;
  isWorldNode?: boolean;
}

interface ActiveCall {
  id: number;
  ctx: NativeChangeContext;
  resolve(): void;
  reject(error: Error): void;
}

/** A JSON-lines change/context protocol; one process owns one Node. */
export async function mountProcessNode(
  space: NativeRuleSpace,
  options: ProcessNodeOptions,
): Promise<ProcessNodeHandle> {
  const child: ChildProcessWithoutNullStreams = spawn(options.command, options.args ?? [], {
    cwd: options.cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
  });
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  let active: ActiveCall | undefined;
  let pendingCall = false;
  let ready = false;
  let disposed = false;
  let mountedId: string | undefined;
  let nextChangeId = 0;
  let stderrTail = '';
  child.stderr.on('data', (data: Buffer) => {
    stderrTail = (stderrTail + data.toString('utf8')).slice(-2048);
  });
  const send = (frame: unknown): void => {
    if (disposed || !child.stdin.writable) throw new Error('Process Node is not writable');
    child.stdin.write(`${JSON.stringify(frame)}\n`);
  };
  const dispose = async (): Promise<void> => {
    if (disposed) return;
    disposed = true;
    const id = mountedId;
    mountedId = undefined;
    if (id) space.unregister(id);
    lines.close();
    child.stdin.end();
    if (child.exitCode === null) child.kill();
  };
  let acceptReady!: (frame: ReadyFrame) => void;
  let rejectReady!: (error: Error) => void;
  const readyPromise = new Promise<ReadyFrame>((resolve, reject) => {
    acceptReady = resolve;
    rejectReady = reject;
  });
  const fail = (error: Error, fatal = false): void => {
    if (!ready) rejectReady(error);
    active?.reject(error);
    active = undefined;
    if (fatal) void dispose();
  };

  const handleCall = async (frame: Record<string, any>): Promise<void> => {
    const current = active;
    if (!current || frame.changeId !== current.id || !Number.isSafeInteger(frame.callId)
      || pendingCall) {
      throw new Error('Process Node sent a call outside its active change');
    }
    pendingCall = true;
    try {
      let value: unknown = null;
      switch (frame.op) {
        case 'read':
          if (typeof frame.key !== 'string' || !frame.key) throw new Error('read requires a State key');
          value = current.ctx.read(frame.key);
          break;
        case 'write':
          if (typeof frame.key !== 'string' || !frame.key) throw new Error('write requires a State key');
          current.ctx.write(frame.key, frame.value);
          break;
        case 'patchState':
          if (!frame.patch || typeof frame.patch !== 'object' || Array.isArray(frame.patch)) {
            throw new Error('patchState requires an object');
          }
          current.ctx.patchState(frame.patch);
          break;
        case 'send':
          if (typeof frame.info?.type !== 'string' || !frame.info.type
            || typeof frame.targetNodeId !== 'string' || !frame.targetNodeId) {
            throw new Error('send requires Info.type and targetNodeId');
          }
          value = current.ctx.send(frame.info, frame.targetNodeId);
          break;
        case 'effect': {
          if (typeof frame.adapterId !== 'string') throw new Error('effect requires adapterId');
          const adapter = options.adapters?.[frame.adapterId];
          if (!adapter) throw new Error(`Unknown EffectAdapter: ${frame.adapterId}`);
          value = await current.ctx.effectAdapter(adapter, frame.request);
          break;
        }
        default: throw new Error(`Unknown Process Node context operation: ${frame.op}`);
      }
      send({ kind: 'result', changeId: current.id, callId: frame.callId, ok: true, value });
    } catch (error) {
      send({ kind: 'result', changeId: current.id, callId: frame.callId,
        ok: false, error: error instanceof Error ? error.message : String(error) });
    } finally {
      pendingCall = false;
    }
  };

  lines.on('line', (line) => {
    try {
      const frame = JSON.parse(line) as Record<string, any>;
      if (!ready) {
        if (frame.kind !== 'ready' || frame.version !== 1 || typeof frame.nodeId !== 'string'
          || !frame.nodeId || !frame.initialState || typeof frame.initialState !== 'object'
          || Array.isArray(frame.initialState) || !frame.analysisFacts
          || frame.analysisFacts.nodeId !== frame.nodeId) {
          throw new Error('Invalid Process Node ready frame');
        }
        if (options.expectedNodeId && frame.nodeId !== options.expectedNodeId) {
          throw new Error(`Process Node ID mismatch: ${frame.nodeId}`);
        }
        ready = true;
        acceptReady(frame as unknown as ReadyFrame);
        return;
      }
      if (frame.kind === 'call') {
        void handleCall(frame).catch((error) => fail(error, true));
      } else if (frame.kind === 'settle' && active?.id === frame.changeId && !pendingCall) {
        const current = active;
        active = undefined;
        current?.resolve();
      } else if (frame.kind === 'fail' && active?.id === frame.changeId && !pendingCall) {
        fail(new Error(String(frame.error ?? 'Process Node failed')));
      } else {
        throw new Error('Unexpected Process Node frame');
      }
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)), true);
    }
  });
  child.on('error', (error) => fail(error, true));
  child.on('exit', (code, signal) => {
    if (!disposed) fail(new Error(`Process Node exited (${code ?? signal})${stderrTail ? `: ${stderrTail}` : ''}`), true);
  });

  const timeout = setTimeout(() => rejectReady(new Error('Process Node ready timeout')),
    options.readyTimeoutMs ?? 5000);
  let manifest: ReadyFrame;
  try {
    manifest = await readyPromise;
  } catch (error) {
    await dispose();
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  const handler = (info: NativeInfo, ctx: NativeChangeContext): Promise<void> => {
    if (active) return Promise.reject(new Error(`Process Node already changing: ${manifest.nodeId}`));
    return new Promise<void>((resolve, reject) => {
      const id = ++nextChangeId;
      active = { id, ctx, resolve, reject };
      try { send({ kind: 'change', changeId: id, info }); }
      catch (error) {
        active = undefined;
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  };
  try {
    space.register(manifest.nodeId, manifest.initialState, handler, {
      isWorldNode: manifest.isWorldNode ?? false,
      analysisFacts: manifest.analysisFacts,
      dispose,
    });
    mountedId = manifest.nodeId;
  } catch (error) {
    await dispose();
    throw error;
  }
  return { nodeId: manifest.nodeId, dispose };
}

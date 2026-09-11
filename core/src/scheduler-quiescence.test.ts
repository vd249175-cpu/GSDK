import { describe, expect, it, vi } from 'vitest';
import { KernelRuntime } from './runtime';
import { Node } from './node';
import type { DomainChangeContext, Info, ChangeRecord } from './types';
function deferred<T = void>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    const promise = new Promise<T>((next) => {
        resolve = next;
    });
    return { promise, resolve };
}
class GatedNode extends Node<{
    completed: boolean;
}> {
    readonly started = deferred();
    readonly gate = deferred();
    constructor() {
        super('gated', 'Gated', { completed: false });
    }
    override async change(_info: Info, ctx: DomainChangeContext<{
        completed: boolean;
    }>) {
        this.started.resolve();
        await this.gate.promise;
        ctx?.write('completed', true);
    }
}
class ForwardNode extends Node<{
    sent: boolean;
}> {
    constructor(private readonly target: Node<any>) {
        super('forward', 'Forward', { sent: false });
    }
    override change(_info: Info, ctx: DomainChangeContext<{
        sent: boolean;
    }>) {
        ctx?.send({ type: 'ForwardedInfo' }, this.target);
        ctx?.write('sent', true);
    }
}
class BackEdgeSourceNode extends Node<{
    completed: boolean;
}> {
    target: Node<any> | null = null;
    constructor() {
        super('back-source', 'Back Source', { completed: false });
    }
    override async change(info: Info, ctx: DomainChangeContext<{
        completed: boolean;
    }>) {
        if (info.type === 'BackInfo') {
            ctx?.write('completed', true);
            return;
        }
        if (this.target)
            ctx?.send({ type: 'ForwardInfo' }, this.target);
    }
}
class BackEdgeTargetNode extends Node<Record<string, never>> {
    source: Node<any> | null = null;
    constructor() {
        super('back-target', 'Back Target', {});
    }
    override change(_info: Info, ctx: DomainChangeContext<Record<string, never>>) {
        if (this.source)
            ctx?.send({ type: 'BackInfo' }, this.source);
    }
}
class OrderedNode extends Node<Record<string, never>> {
    readonly firstStarted = deferred();
    readonly firstGate = deferred();
    readonly order: string[] = [];
    constructor() {
        super('ordered', 'Ordered', {});
    }
    override async change(info: Info) {
        this.order.push(`start-${info.value}`);
        if (info.value === 1) {
            this.firstStarted.resolve();
            await this.firstGate.promise;
        }
        this.order.push(`end-${info.value}`);
    }
}
class FailingTargetNode extends Node<Record<string, never>> {
    constructor() {
        super('failing-target', 'Failing Target', {});
    }
    override change() {
        throw new Error('downstream failed');
    }
}
class ContinueAfterFaultNode extends Node<{
    processed: number[];
}> {
    constructor() {
        super('continue-after-fault', 'Continue After Fault', { processed: [] });
    }
    override change(info: Info, ctx: DomainChangeContext<{
        processed: number[];
    }>) {
        if (info.fail)
            throw new Error('node contract escaped');
        ctx?.write('processed', [...ctx.read('processed'), Number(info.value)]);
    }
}
describe('KernelRuntime scheduler and quiescence', () => {
    it('reports pending delivery and active Change until execution completes', async () => {
        const kernel = new KernelRuntime();
        const node = new GatedNode();
        kernel.mount(node);
        kernel.injectRootInfo(node, { type: 'RunInfo' });
        const execution = kernel.waitForQuiescence();
        await node.started.promise;
        expect(kernel.getSchedulerSnapshot()).toEqual({
            pendingDeliveries: 1,
            activeChanges: 1,
            scheduledGraphMicrotasks: 0,
            isQuiescent: false,
        });
        node.gate.resolve();
        await execution;
        await expect(kernel.waitForQuiescence()).resolves.toMatchObject({ isQuiescent: true });
    });
    it('tracks graph microtasks without using a sleep-based idle heuristic', async () => {
        const kernel = new KernelRuntime();
        const gate = deferred();
        const action = vi.fn(async () => gate.promise);
        const scheduled = kernel.scheduleMicrotask(action);
        expect(kernel.getSchedulerSnapshot()).toMatchObject({
            scheduledGraphMicrotasks: 1,
            isQuiescent: false,
        });
        const quiescent = kernel.waitForQuiescence();
        await Promise.resolve();
        expect(action).toHaveBeenCalledOnce();
        gate.resolve();
        await scheduled;
        await expect(quiescent).resolves.toEqual({
            pendingDeliveries: 0,
            activeChanges: 0,
            scheduledGraphMicrotasks: 0,
            isQuiescent: true,
        });
    });
    it('does not turn a graph microtask failure into a quiescence result', async () => {
        const kernel = new KernelRuntime();
        const failure = new Error('scheduled delivery failed');
        const scheduled = kernel.scheduleMicrotask(() => {
            throw failure;
        });
        const observed = scheduled.catch((error) => error);
        await expect(kernel.waitForQuiescence()).resolves.toMatchObject({ isQuiescent: true });
        await expect(observed).resolves.toBe(failure);
    });
    it('returns from send after enqueue while the downstream Change is still running', async () => {
        const kernel = new KernelRuntime();
        const target = new GatedNode();
        const source = new ForwardNode(target);
        kernel.mount(source, target);
        kernel.injectRootInfo(source, { type: 'RootInfo' });
        const execution = kernel.waitForQuiescence();
        await target.started.promise;
        expect(source.getState().sent).toBe(true);
        expect(target.getState().completed).toBe(false);
        expect(kernel.getSchedulerSnapshot().isQuiescent).toBe(false);
        target.gate.resolve();
        await execution;
        expect(kernel.getSchedulerSnapshot()).toMatchObject({ isQuiescent: true });
    });
    it('keeps receiving Info while a Change runs and consumes the Mailbox in FIFO order', async () => {
        const kernel = new KernelRuntime();
        const node = new OrderedNode();
        kernel.mount(node);
        kernel.injectRootInfo(node, { type: 'OrderedInfo', value: 1 });
        await node.firstStarted.promise;
        kernel.injectRootInfo(node, { type: 'OrderedInfo', value: 2 });
        kernel.injectRootInfo(node, { type: 'OrderedInfo', value: 3 });
        expect(node.getMailboxSize()).toBe(2);
        expect(node.order).toEqual(['start-1']);
        node.firstGate.resolve();
        await kernel.waitForQuiescence();
        expect(node.order).toEqual([
            'start-1', 'end-1',
            'start-2', 'end-2',
            'start-3', 'end-3',
        ]);
    });
    it('keeps an escaped Node failure out of send and quiescence semantics', async () => {
        const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const kernel = new KernelRuntime();
        const records: ChangeRecord[] = [];
        kernel.addProbe({ onChangeRecord: (r) => records.push(r) });
        const target = new FailingTargetNode();
        const source = new ForwardNode(target);
        kernel.mount(source, target);
        kernel.injectRootInfo(source, { type: 'RootInfo' });
        await expect(kernel.waitForQuiescence()).resolves.toMatchObject({ isQuiescent: true });
        expect(source.getState().sent).toBe(true);
        expect(records.find((record) => record.nodeId === source.id)?.error).toBeUndefined();
        expect(records.find((record) => record.nodeId === target.id)?.error).toBe('downstream failed');
        warning.mockRestore();
    });
    it('continues consuming later FIFO entries when one Node implementation leaks an exception', async () => {
        const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const kernel = new KernelRuntime();
        const records: ChangeRecord[] = [];
        kernel.addProbe({ onChangeRecord: (r) => records.push(r) });
        const node = new ContinueAfterFaultNode();
        kernel.mount(node);
        kernel.injectRootInfo(node, { type: 'WorkInfo', fail: true });
        kernel.injectRootInfo(node, { type: 'WorkInfo', value: 2 });
        await kernel.waitForQuiescence();
        expect(node.getState().processed).toEqual([2]);
        expect(records).toHaveLength(2);
        expect(records[0].error).toBe('node contract escaped');
        expect(records[1].error).toBeUndefined();
        warning.mockRestore();
    });
    it('executes an ordinary feedback edge through the persistent FIFO Mailbox', async () => {
        const kernel = new KernelRuntime();
        const source = new BackEdgeSourceNode();
        const target = new BackEdgeTargetNode();
        source.target = target;
        target.source = source;
        kernel.mount(source, target);
        kernel.injectRootInfo(source, { type: 'RootInfo' });
        await kernel.waitForQuiescence();
        expect(source.getState().completed).toBe(true);
        expect(kernel.getSchedulerSnapshot()).toMatchObject({ isQuiescent: true });
        const deferredChange = kernel.events.find((event) => (
            event.type === 'ChangeCompleted' && event.record.nodeId === target.id
        ));
        expect(deferredChange?.type).toBe('ChangeCompleted');
        expect(kernel.envelopes.find((envelope) => envelope.payload.type === 'BackInfo')).toMatchObject({
            causedByChangeId: deferredChange?.type === 'ChangeCompleted'
                ? deferredChange.record.changeId
                : undefined,
            senderNodeId: target.id,
            targetNodeId: source.id,
        });
    });
    it('supports cancellation while waiting for scheduler state changes', async () => {
        const kernel = new KernelRuntime();
        const gate = deferred();
        const scheduled = kernel.scheduleMicrotask(() => gate.promise);
        const controller = new AbortController();
        const waiting = kernel.waitForQuiescence({ signal: controller.signal });
        controller.abort();
        await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
        gate.resolve();
        await scheduled;
    });
});

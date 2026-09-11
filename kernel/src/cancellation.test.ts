import { describe, expect, it, vi } from 'vitest';
import { Node, WorldNode } from './node';
import { KernelRuntime } from './runtime';
import { MemoryTraceStore } from './observation';
import type { EffectAdapter } from './effects';
import type { DomainChangeContext, Info, WorldChangeContext } from './types';
class SourceNode extends Node<Record<string, never>> {
    target: WorldSinkNode | null = null;
    constructor() {
        super('cancel-source', 'Cancel Source', {});
    }
    override async change(_info: Info, ctx: DomainChangeContext<Record<string, never>>) {
        if (this.target)
            ctx.send({ type: 'RunWorldInfo' }, this.target);
    }
}
class WorldSinkNode extends WorldNode<{
    completed: boolean;
}> {
    constructor(private readonly adapter: EffectAdapter<{}, {
        ok: true;
    }>, id = 'cancel-world') {
        super(id, 'Cancel World', { completed: false });
    }
    override async change(_info: Info, ctx: WorldChangeContext<{
        completed: boolean;
    }>) {
        ;
        await ctx.effectAdapter(this.adapter, {});
        ctx.write('completed', true);
    }
}
describe('root execution cancellation', () => {
    it('waits for one causal scope without waiting for unrelated work', async () => {
        let releaseSlow: () => void = () => undefined;
        let markSlowStarted: () => void = () => undefined;
        const slowStarted = new Promise<void>((resolve) => { markSlowStarted = resolve; });
        const slowGate = new Promise<void>((resolve) => { releaseSlow = resolve; });
        const slow = new WorldSinkNode({
            id: 'fixture/slow-world',
            execute: async () => {
                markSlowStarted();
                await slowGate;
                return { ok: true };
            },
        }, 'slow-world');
        const fast = new WorldSinkNode({
            id: 'fixture/fast-world',
            execute: async () => ({ ok: true }),
        }, 'fast-world');
        const kernel = new KernelRuntime();
        kernel.mount(slow, fast);

        const slowSubmission = kernel.injectRootInfo(slow, { type: 'RunWorldInfo' });
        await slowStarted;
        const fastSubmission = kernel.injectRootInfo(fast, { type: 'RunWorldInfo' });

        await kernel.waitForSubmission(fastSubmission);
        expect(fast.getState().completed).toBe(true);
        expect(slow.getState().completed).toBe(false);
        expect(kernel.getSchedulerSnapshot().isQuiescent).toBe(false);

        releaseSlow();
        await kernel.waitForSubmission(slowSubmission);
        expect(slow.getState().completed).toBe(true);
    });

    it('cancels exactly one submission and propagates its signal through sends into a World Adapter', async () => {
        let resolveStarted: () => void = () => undefined;
        const started = new Promise<void>((resolve) => {
            resolveStarted = resolve;
        });
        const adapter: EffectAdapter<{}, {
            ok: true;
        }> = {
            id: 'fixture/cancelable-world',
            execute: async (_request, context) => {
                resolveStarted();
                return new Promise((_resolve, reject) => {
                    context.signal?.addEventListener('abort', () => {
                        reject(context.signal?.reason ?? new DOMException('aborted', 'AbortError'));
                    }, { once: true });
                });
            },
        };
        const source = new SourceNode();
        const world = new WorldSinkNode(adapter);
        const independent = new WorldSinkNode({
            id: 'fixture/independent-world',
            execute: async () => ({ ok: true }),
        }, 'independent-world');
        source.target = world;
        const traceStore = new MemoryTraceStore();
        const kernel = new KernelRuntime({ traceStore });
        kernel.mount(source, world, independent);
        const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const submissionId = kernel.injectRootInfo(source, { type: 'StartInfo' });
        const execution = kernel.waitForSubmission(submissionId);
        await started;
        const independentSubmission = kernel.injectRootInfo(independent, { type: 'RunWorldInfo' });
        expect(kernel.cancel(submissionId)).toBe(true);
        await expect(execution).rejects.toMatchObject({ name: 'AbortError' });
        await kernel.waitForSubmission(independentSubmission);
        expect(world.getState()).toEqual({ completed: false });
        expect(independent.getState()).toEqual({ completed: true });
        expect(world.status).toBe('ABORTED');
        expect(kernel.getSchedulerSnapshot().isQuiescent).toBe(true);
        expect(traceStore.getEvents()).toContainEqual(expect.objectContaining({
            type: 'EffectObserved',
            adapterId: 'fixture/cancelable-world',
            status: 'failed',
        }));
        warning.mockRestore();
    });
});

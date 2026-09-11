import { describe, expect, it } from 'vitest';
import { ExecutionWorldNode, Node, ObservationWorldNode, WorldNode } from './node';
import { KernelRuntime } from './runtime';
import type { DomainChangeContext, Info, WorldChangeContext, ChangeRecord } from './types';
import type { EffectAdapter } from './effects';
interface TestState {
    count: number;
    lastAction: string;
    result: string;
}
class TestDomainNode extends Node<TestState> {
    public asyncOrder?: number[];
    private readonly invalidAdapter: EffectAdapter<void, string> = {
        id: 'fixture/illegal-domain-effect',
        execute: async () => 'physical action',
    };
    constructor(id: string = 'test-domain-node', name: string = '测试领域节点', private readonly downstreamTargetId: string = 'world-1') {
        super(id, name, { count: 0, lastAction: 'init', result: '' });
    }
    protected override async change(info: Info, ctx: DomainChangeContext<TestState>) {
        if (info.type === 'IncrementInfo') {
            await ctx.span('increment_step', () => {
                const current = ctx.read('count');
                ctx.write('count', current + (info.amount || 1));
                ctx.write('lastAction', 'incremented');
            });
            ctx.send({
                type: 'CountUpdatedInfo',
                count: ctx.read('count'),
            }, this.downstreamTargetId);
            return;
        }
        if (info.type === 'ResetInfo') {
            ctx.write('count', 0);
            ctx.write('lastAction', 'reset');
            return;
        }
        if (info.type === 'IllegalEffectInfo') {
            await (ctx as WorldChangeContext<TestState>).effectAdapter(this.invalidAdapter, undefined);
            return;
        }
        if (info.type === 'AsyncStep') {
            const step = info.step;
            this.asyncOrder?.push(step);
            await new Promise((resolve) => setTimeout(resolve, 20));
            this.asyncOrder?.push(step * 10);
            ctx.write('count', ctx.read('count') + 1);
        }
    }
}
class TestWorldNode extends WorldNode<{
    writtenCount: number;
}> {
    private readonly adapter: EffectAdapter<void, string> = {
        id: 'fixture/disk-write',
        execute: async () => 'disk written',
    };
    constructor(id: string = 'test-world-node', name: string = '测试物理节点') {
        super(id, name, { writtenCount: 0 });
    }
    protected override async change(info: Info, ctx: WorldChangeContext<{
        writtenCount: number;
    }>) {
        if (info.type === 'CountUpdatedInfo') {
            await ctx.effectAdapter(this.adapter, undefined);
            ctx.write('writtenCount', (ctx.read('writtenCount') || 0) + 1);
        }
    }
}
describe('Node Causal Observation Layer & Single-Flight Queue', () => {
    it('correctly dispatches transitions, tracks reads/writes/spans, and records ChangeRecord in Kernel', async () => {
        const kernel = new KernelRuntime();
        const records: ChangeRecord[] = [];
        kernel.addProbe({ onChangeRecord: (r) => records.push(r) });
        const domainNode = new TestDomainNode('domain-1', '领域节点', 'world-1');
        const worldNode = new TestWorldNode('world-1', '物理节点');
        kernel.mount(domainNode, worldNode);
        kernel.injectRootInfo(domainNode, { type: 'IncrementInfo', amount: 5 });
        await kernel.waitForQuiescence();
        expect(domainNode.getState().count).toBe(5);
        expect(domainNode.getState().lastAction).toBe('incremented');
        expect(worldNode.getState().writtenCount).toBe(1);
        expect(kernel.envelopes.length).toBeGreaterThan(0);
        expect(records.length).toBeGreaterThan(0);
        const lastChange = records.find((r) => r.nodeId === 'domain-1');
        expect(lastChange).toBeDefined();
        expect(lastChange?.causeInfoType).toBe('IncrementInfo');
        expect(lastChange?.reads).toContain('count');
        expect(lastChange?.writes).toContain('count');
        expect(lastChange?.writes).toContain('lastAction');
        expect(lastChange?.spans.some((s) => s.name === 'increment_step')).toBe(true);
    });
    it('strictly prohibits pure domain nodes from executing physical effects', async () => {
        const kernel = new KernelRuntime();
        const records: ChangeRecord[] = [];
        kernel.addProbe({ onChangeRecord: (r) => records.push(r) });
        const domainNode = new TestDomainNode('domain-2', '纯领域节点');
        kernel.mount(domainNode);
        kernel.injectRootInfo(domainNode, { type: 'IllegalEffectInfo' });
        await expect(kernel.waitForQuiescence()).resolves.toMatchObject({ isQuiescent: true });
        expect(records[0].error).toMatch(/Side effects are strictly restricted to World nodes/);
    });
    it('guarantees Single-Flight execution: sequential non-interleaving queue per node', async () => {
        const kernel = new KernelRuntime();
        const domainNode = new TestDomainNode('domain-3', '并发测试节点');
        kernel.mount(domainNode);
        const order: number[] = [];
        domainNode.asyncOrder = order;
        kernel.injectRootInfo(domainNode, { type: 'AsyncStep', step: 1 });
        kernel.injectRootInfo(domainNode, { type: 'AsyncStep', step: 2 });
        await kernel.waitForQuiescence();
        expect(order).toEqual([1, 10, 2, 20]);
        expect(domainNode.getState().count).toBe(2);
    });
    it('distinguishes ExecutionWorldNode and ObservationWorldNode categories', () => {
        class ExecNode extends ExecutionWorldNode<{ executed: boolean }> {
            constructor() { super('exec-1', 'Exec Node', { executed: false }); }
        }
        class ObsNode extends ObservationWorldNode<{ observed: boolean }> {
            constructor() { super('obs-1', 'Obs Node', { observed: false }); }
        }
        const exec = new ExecNode();
        const obs = new ObsNode();
        expect(exec.isWorldNode).toBe(true);
        expect(exec.worldKind).toBe('execution');
        expect(obs.isWorldNode).toBe(true);
        expect(obs.worldKind).toBe('observation');
    });
});

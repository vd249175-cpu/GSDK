import { describe, expect, it, vi } from 'vitest';
import { KernelRuntime } from './runtime';
import { Node, WorldNode } from './node';
import { MemoryTraceStore } from './observation';
import type { DomainChangeContext, Info, WorldChangeContext, ChangeRecord } from './types';
import type { EffectAdapter } from './effects';
interface DeltaState {
    count: number;
    label: string;
    nested: {
        enabled: boolean;
    };
}
class DeltaNode extends Node<DeltaState> {
    constructor() {
        super('delta-node', 'Delta Node', {
            count: 0,
            label: 'initial',
            nested: { enabled: false },
        });
    }
    override change(_info: Info, ctx: DomainChangeContext<DeltaState>) {
        ;
        ctx.write('count', 1);
        ctx.write('count', 2);
        ctx.patchState({
            label: 'updated',
            nested: { enabled: true },
        });
    }
}
class EffectNode extends WorldNode<{
    attempts: number;
}> {
    readonly adapter: EffectAdapter<{ fail?: boolean }, string> = {
        id: 'fixture/persist-project',
        execute: async ({ fail }) => {
            if (fail)
                throw new Error('effect failed');
            return 'ok';
        },
    };
    constructor() {
        super('effect-node', 'Effect Node', { attempts: 0 });
    }
    override async change(info: Info, ctx: WorldChangeContext<{
        attempts: number;
    }>) {
        ;
        ctx.write('attempts', ctx.read('attempts') + 1);
        await ctx.effectAdapter(this.adapter, { fail: info.fail });
    }
}
class LargeValueNode extends Node<{
    value: string;
}> {
    constructor() {
        super('large-value-node', 'Large Value Node', { value: 'initial' });
    }
    override change(info: Info, ctx: DomainChangeContext<{
        value: string;
    }>) {
        ctx?.write('value', info.value);
    }
}
class AdapterEffectNode extends WorldNode<{
    savedPath: string;
}> {
    readonly adapter: EffectAdapter<{
        filename: string;
    }, {
        savedPath: string;
    }> = {
        id: 'fixture/artifact-file',
        execute: async (request) => ({ savedPath: `/saved/${request.filename}` }),
    };
    constructor() {
        super('adapter-effect-node', 'Adapter Effect Node', { savedPath: '' });
    }
    override async change(info: Info, ctx: WorldChangeContext<{
        savedPath: string;
    }>) {
        ;
        const observation = await ctx.effectAdapter(this.adapter, { filename: info.filename });
        ctx.write('savedPath', observation.savedPath);
    }
}
describe('TraceSession StateDelta and Effect events', () => {
    it('captures ordered before/after values for repeated write and atomic patchState', async () => {
        const traceStore = new MemoryTraceStore();
        const kernel = new KernelRuntime({ traceStore });
        const records: ChangeRecord[] = [];
        kernel.addProbe({ onChangeRecord: (r) => records.push(r) });
        const node = new DeltaNode();
        kernel.mount(node);
        kernel.injectRootInfo(node, { type: 'UpdateStateInfo' });
        await kernel.waitForQuiescence();
        const change = records[0];
        expect(change.stateDeltas).toEqual([
            {
                ordinal: 1,
                field: 'count',
                before: { $type: 'primitive', value: 0 },
                after: { $type: 'primitive', value: 1 },
            },
            {
                ordinal: 2,
                field: 'count',
                before: { $type: 'primitive', value: 1 },
                after: { $type: 'primitive', value: 2 },
            },
            {
                ordinal: 3,
                field: 'label',
                before: { $type: 'primitive', value: 'initial' },
                after: { $type: 'primitive', value: 'updated' },
            },
            {
                ordinal: 4,
                field: 'nested',
                before: {
                    $type: 'object',
                    value: { enabled: { $type: 'primitive', value: false } },
                },
                after: {
                    $type: 'object',
                    value: { enabled: { $type: 'primitive', value: true } },
                },
            },
        ]);
        const deltaEvent = traceStore
            .getEvents()
            .find((event) => event.type === 'StateDeltaCommitted');
        expect(deltaEvent).toMatchObject({
            type: 'StateDeltaCommitted',
            changeId: change.changeId,
            nodeId: node.id,
            stateVersionAfter: 3,
            deltas: change.stateDeltas,
        });
    });
    it('does not expose direct State mutation APIs on Node', () => {
        const node = new DeltaNode() as DeltaNode & Record<string, unknown>;
        expect(node.setState).toBeUndefined();
        expect(node.commitState).toBeUndefined();
    });
    it('correlates successful and failed World effects with their Change', async () => {
        const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const traceStore = new MemoryTraceStore();
        const kernel = new KernelRuntime({ traceStore });
        const records: ChangeRecord[] = [];
        kernel.addProbe({ onChangeRecord: (r) => records.push(r) });
        const node = new EffectNode();
        kernel.mount(node);
        kernel.injectRootInfo(node, { type: 'PersistInfo' });
        await kernel.waitForQuiescence();
        kernel.injectRootInfo(node, { type: 'PersistInfo', fail: true });
        await expect(kernel.waitForQuiescence()).resolves.toMatchObject({ isQuiescent: true });
        const requested = traceStore.getEvents().filter((event) => event.type === 'EffectRequested');
        const observed = traceStore.getEvents().filter((event) => event.type === 'EffectObserved');
        expect(requested).toHaveLength(2);
        expect(observed).toHaveLength(2);
        expect(observed.map((event) => (event as any).status)).toEqual(['succeeded', 'failed']);
        expect(observed.map((event) => (event as any).effectId)).toEqual(requested.map((event) => (event as any).effectId));
        expect(observed.map((event) => (event as any).changeId)).toEqual(records.map((record) => record.changeId));
        expect(records[1].error).toBe('effect failed');
        warning.mockRestore();
    });
    it('records only Adapter Request/Observation content refs in the Trace', async () => {
        const traceStore = new MemoryTraceStore();
        const kernel = new KernelRuntime({ traceStore });
        const node = new AdapterEffectNode();
        kernel.mount(node);
        kernel.injectRootInfo(node, {
            type: 'WriteArtifactInfo',
            filename: 'fixture.png',
        });
        await kernel.waitForQuiescence();
        const requested = traceStore.getEvents().find((event) => event.type === 'EffectRequested');
        const observed = traceStore.getEvents().find((event) => event.type === 'EffectObserved');
        expect(requested).toMatchObject({
            type: 'EffectRequested',
            adapterId: 'fixture/artifact-file',
            requestRef: expect.stringMatching(/^effect-request:/),
        });
        expect(observed).toMatchObject({
            type: 'EffectObserved',
            adapterId: 'fixture/artifact-file',
            requestRef: requested && 'requestRef' in requested ? requested.requestRef : undefined,
            observationRef: expect.stringMatching(/^effect-observation:/),
            status: 'succeeded',
        });
    });
});

import { describe, expect, it, vi } from 'vitest';
import { KernelRuntime } from './runtime';
import { WorldNode } from './node';
import { MemoryTraceStore } from './observation';
import type { Info, WorldChangeContext, ChangeRecord } from './types';
import type { Clock, IdProvider, RandomSource, RuntimeIdKind, } from './observation';
class FixedClock implements Clock {
    private monotonic = 0;
    constructor(private readonly timestamp: number) { }
    now() {
        return this.timestamp;
    }
    monotonicNow() {
        this.monotonic += 1;
        return this.monotonic;
    }
}
class SequenceIdProvider implements IdProvider {
    private readonly counters = new Map<RuntimeIdKind, number>();
    nextId(kind: RuntimeIdKind) {
        const value = (this.counters.get(kind) ?? 0) + 1;
        this.counters.set(kind, value);
        return `${kind}-${value}`;
    }
}
const fixedRandom: RandomSource = { next: () => 0.5 };
class LifecycleNode extends WorldNode<{
    events: string[];
}> {
    constructor() {
        super('lifecycle', 'Lifecycle', { events: [] }, 'LifecycleNode');
    }
    override change(info: Info, ctx: WorldChangeContext<{
        events: string[];
    }>) {
        ctx?.write('events', [...ctx.read('events'), info.type]);
    }
}
function createDeterministicKernel(traceStore: MemoryTraceStore = new MemoryTraceStore()) {
    return new KernelRuntime({
        clock: new FixedClock(1700000000000),
        idProvider: new SequenceIdProvider(),
        randomSource: fixedRandom,
        traceStore,
    });
}
describe('KernelRuntime services', () => {
    it('publishes TraceEvent through Probe while preserving legacy callbacks', async () => {
        const traceStore = new MemoryTraceStore();
        const kernel = createDeterministicKernel(traceStore);
        const node = new LifecycleNode();
        const onTraceEvent = vi.fn();
        const onChangeRecord = vi.fn();
        kernel.addProbe({ onTraceEvent, onChangeRecord });
        kernel.mount(node);
        kernel.injectRootInfo(node, { type: 'ProbeInputInfo' });
        await kernel.waitForQuiescence();
        expect(traceStore.getEvents().map((event) => event.type)).toEqual([
            'TraceStarted',
            'GraphMounted',
            'StateSnapshotCaptured',
            'InfoDelivered',
            'ChangeStarted',
            'StateDeltaCommitted',
            'ChangeCompleted',
        ]);
        expect(onChangeRecord).toHaveBeenCalledOnce();
    });
    it('routes lifecycle Infos through ordinary root injection', async () => {
        const traceStore = new MemoryTraceStore();
        const kernel = createDeterministicKernel(traceStore);
        const records: ChangeRecord[] = [];
        kernel.addProbe({ onChangeRecord: (r) => records.push(r) });
        const node = new LifecycleNode();
        kernel.mount(node);
        const bootSubmission = kernel.injectRootInfo(node, { type: 'BootInfo' });
        await kernel.waitForSubmission(bootSubmission);
        const shutdownSubmission = kernel.injectRootInfo(node, { type: 'ShutdownInfo', reason: 'test' });
        await kernel.waitForSubmission(shutdownSubmission);
        expect(node.getState().events).toEqual(['BootInfo', 'ShutdownInfo']);
        expect(kernel.envelopes).toHaveLength(2);
        expect(kernel.envelopes.map((item) => ({
            infoId: item.infoId,
            type: item.payload.type,
            timestamp: item.timestamp,
        }))).toEqual([
            {
                infoId: 'info-root-1',
                type: 'BootInfo',
                timestamp: 1700000000000,
            },
            {
                infoId: 'info-root-2',
                type: 'ShutdownInfo',
                timestamp: 1700000000000,
            },
        ]);
        expect(records.map((item) => ({
            changeId: item.changeId,
            causeInfoId: item.causeInfoId,
        }))).toEqual([
            { changeId: 'change-1', causeInfoId: 'info-root-1' },
            { changeId: 'change-2', causeInfoId: 'info-root-2' },
        ]);
        await kernel.dispose();
        expect(traceStore.getEvents().map((event) => event.type)).toEqual([
            'TraceStarted',
            'GraphMounted',
            'StateSnapshotCaptured',
            'InfoDelivered',
            'ChangeStarted',
            'StateDeltaCommitted',
            'ChangeCompleted',
            'InfoDelivered',
            'ChangeStarted',
            'StateDeltaCommitted',
            'ChangeCompleted',
            'TraceCompleted',
        ]);
        expect(traceStore.getEvents().map((event) => event.sequence)).toEqual([
            1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
        ]);
    });
    it('repeats the same causal identities with the same injected services', async () => {
        const execute = async () => {
            const traceStore = new MemoryTraceStore();
            const kernel = createDeterministicKernel(traceStore);
            const records: ChangeRecord[] = [];
            kernel.addProbe({ onChangeRecord: (r) => records.push(r) });
            const node = new LifecycleNode();
            kernel.mount(node);
            kernel.injectRootInfo(node, { type: 'ReplayInputInfo' });
            await kernel.waitForQuiescence();
            return {
                envelope: kernel.envelopes[0],
                change: records[0],
                events: traceStore.getEvents(),
            };
        };
        const first = await execute();
        const second = await execute();
        expect(second).toEqual(first);
    });
});

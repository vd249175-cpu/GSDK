import { describe, expect, it } from 'vitest';
import type { GenerationBatchPlannedInfo } from '../../protocol';
import { createCausalRegionHarness, InfoCollectorNode } from '../../testing/graph';
import { SecurityGateNode } from '../generation-security';
import { GenerationTaskNode } from '../generation-task';

function plannedBatch(estimatedCredits: number): GenerationBatchPlannedInfo {
  return {
    type: 'GenerationBatchPlannedInfo',
    batchId: 'batch-budget',
    tasks: [{
      taskId: 'task-1',
      targetNodeId: 'video-1',
      destinationRelativePath: 'nodes/video-1/media/v1.mp4',
      versionId: 'v1',
      mediaType: 'video',
      estimatedCredits,
      submit: { provider: 'mock', kind: 'video' },
    }],
  };
}

describe('SecurityGateNode budget ownership', () => {
  it('accounts an admitted plan and forwards the same causal fact', async () => {
    const gate = new SecurityGateNode(undefined, undefined, { maxCreditBudget: 50 });
    const task = new GenerationTaskNode();
    const submit = new InfoCollectorNode('sink-generation-submit');
    const region = createCausalRegionHarness([gate, task, submit]);

    await region.inject(gate.id, plannedBatch(20));

    expect(gate.getState()).toMatchObject({ spentCredits: 20, lastBlockReason: null });
    expect(submit.received('GenerationSubmitBatchRequestedInfo')).toHaveLength(1);
    await region.dispose();
  });

  it('records an over-budget plan as failed without submitting or charging it', async () => {
    const gate = new SecurityGateNode(undefined, undefined, { maxCreditBudget: 10 });
    const task = new GenerationTaskNode();
    const submit = new InfoCollectorNode('sink-generation-submit');
    const region = createCausalRegionHarness([gate, task, submit]);

    await region.inject(gate.id, plannedBatch(20));

    expect(gate.getState().spentCredits).toBe(0);
    expect(gate.getState().lastBlockReason).toMatch(/超过预算/);
    expect(submit.received('GenerationSubmitBatchRequestedInfo')).toHaveLength(0);
    expect(task.getState().tasks.get('task-1')?.phase).toBe('failed');
    await region.dispose();
  });
});

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Node } from '../src/node/node';
import { mountDomainNode } from '../src/node/native-node';
import { locateNativeBinding, NativeRuleSpace } from '../src/node/native-space';
import { mountProcessNode } from '../src/node/native-node';

class Target extends Node<{ done: number }> {
  constructor() { super('target', 'Target', { done: 0 }); }
  protected change(info: any, ctx: any) {
    if (info.type === 'DoneInfo') ctx.write('done', ctx.read('done') + 1);
  }
}

const pythonAvailable = spawnSync('python', ['--version'], { windowsHide: true }).status === 0;

describe.skipIf(!pythonAvailable || !locateNativeBinding())('language-neutral process Node', () => {
  it('executes a Python Node with the same State and send semantics, then analyzes its facts', async () => {
    const space = new NativeRuleSpace();
    mountDomainNode(space, new Target());
    const worker = await mountProcessNode(space, {
      command: 'python',
      args: ['-u', fileURLToPath(new URL('./fixtures/portable-python-node.py', import.meta.url))],
    });
    try {
      const submissionId = space.injectRoot('python.worker', { type: 'RunInfo' });
      await space.waitForSubmission(submissionId);
      expect(space.getState('python.worker')).toEqual({ runs: 1 });
      expect(space.getState('target')).toEqual({ done: 1 });
      expect((await space.analyze({ op: 'view' })).routes).toContainEqual(expect.objectContaining({
        from: 'python.worker', to: 'target', infoType: 'DoneInfo',
      }));
      expect((await space.analyze({ op: 'validate' })).valid).toBe(true);
    } finally {
      space.unregister('python.worker');
      await worker.dispose();
    }
  });
});

import { describe, expect, it } from 'vitest';
import { createTestRuntime } from '@graphvideo/sdk/testing';
import { StudioApplicationLifecycleNode } from '../application-lifecycle';
import { ElectronHostNode, ElectronWindowExecutionNode, ElectronWindowObservationNode } from '../electron-host';
import { GenerationTaskNode } from '../generation-task';
import { MarkdownSourceNode } from '../markdown-source';
import { SqliteRegistryNode } from '../sqlite-registry';
import { SqliteWriterSinkNode } from '../sqlite-writer';
import { SqliteObserverSourceNode } from '../sqlite-observer';

function fixture(failSave = false) {
  const calls: string[] = [];
  const runtime = createTestRuntime({ nodes: [
    new StudioApplicationLifecycleNode(), new GenerationTaskNode(), new MarkdownSourceNode(undefined, undefined, '# draft'),
    new SqliteRegistryNode(), new SqliteWriterSinkNode(undefined, undefined, undefined, {
      id: 'test/save',
      async execute(request) {
        calls.push('save');
        if (failSave) throw new Error('disk full');
        expect(request.markdown).toBe('# draft');
        return { nodes: request.nodes, retainedNodes: request.retainedNodes, savedAt: 1, contentRef: 'project' };
      },
    }), new SqliteObserverSourceNode(),
    new ElectronHostNode(), new ElectronWindowExecutionNode(undefined, undefined, {
      id: 'test/window', async execute(request) {
        calls.push(request.type);
        return { type: request.type === 'OPEN' ? 'OPENED' : 'CLOSED', isWindowOpen: request.type === 'OPEN' };
      },
    }), new ElectronWindowObservationNode(),
  ] });
  const inject = async (info: object) => {
    await runtime.inject('node-application-lifecycle', info);
    await runtime.waitForQuiescence();
  };
  return { runtime, calls, inject };
}

describe('Studio application lifecycle', () => {
  it('requires a drain observation and an actual save before closing the window', async () => {
    const { runtime, calls, inject } = fixture();
    try {
      await inject({ type: 'SystemStartRequestedInfo', requestId: 'boot' });
      expect(runtime.getState('node-application-lifecycle')).toMatchObject({ phase: 'Ready' });
      await inject({ type: 'SystemShutdownRequestedInfo', requestId: 'quit', hasProject: true });
      expect(runtime.getState('node-application-lifecycle')).toMatchObject({ phase: 'AwaitingDrain' });
      expect(calls).toEqual(['OPEN']);
      await inject({ type: 'SystemShutdownDrainObservedInfo', requestId: 'stale' });
      expect(calls).toEqual(['OPEN']);
      await inject({ type: 'SystemShutdownDrainObservedInfo', requestId: 'quit' });
      expect(calls).toEqual(['OPEN', 'save', 'CLOSE']);
      expect(runtime.getState('node-application-lifecycle')).toMatchObject({ phase: 'ShutdownReady', requestId: 'quit' });
    } finally { await runtime.dispose(); }
  });

  it('preserves the window and reports a save failure', async () => {
    const { runtime, calls, inject } = fixture(true);
    try {
      await inject({ type: 'SystemStartRequestedInfo', requestId: 'boot' });
      await inject({ type: 'SystemShutdownRequestedInfo', requestId: 'quit', hasProject: true });
      await inject({ type: 'SystemShutdownDrainObservedInfo', requestId: 'quit' });
      expect(calls).toEqual(['OPEN', 'save']);
      expect(runtime.getState('node-application-lifecycle')).toMatchObject({ phase: 'ShutdownFailed', lastError: 'disk full' });
    } finally { await runtime.dispose(); }
  });

  it('skips project persistence when no project is open and ignores stale acknowledgements', async () => {
    const { runtime, calls, inject } = fixture();
    try {
      await inject({ type: 'SystemShutdownRequestedInfo', requestId: 'quit', hasProject: false });
      await inject({ type: 'StudioLifecycleParticipantPreparedInfo', requestId: 'old', participant: 'persistence', ok: true });
      expect(runtime.getState('node-application-lifecycle')).toMatchObject({ phase: 'AwaitingDrain' });
      await inject({ type: 'SystemShutdownDrainObservedInfo', requestId: 'quit' });
      expect(runtime.getState('node-application-lifecycle')).toMatchObject({ phase: 'ShutdownReady' });
      expect(calls).toEqual([]);
    } finally { await runtime.dispose(); }
  });
});

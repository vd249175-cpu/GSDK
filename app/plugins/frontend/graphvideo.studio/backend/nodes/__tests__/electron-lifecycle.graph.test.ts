import { describe, expect, it } from 'vitest';
import type { EffectAdapter } from '@graphvideo/sdk/node';
import { createCausalRegionHarness } from '../../testing/graph';
import { ElectronHostNode, ElectronWindowExecutionNode, ElectronWindowObservationNode } from '../electron-host';
import type { ElectronWindowObservation, ElectronWindowRequest } from '../../effects/electron-window-adapter';

describe('desktop lifecycle causal region', () => {
  it('opens and closes the window through Info, an execution Node and an Observation Node', async () => {
    const calls: ElectronWindowRequest[] = [];
    const adapter: EffectAdapter<ElectronWindowRequest, ElectronWindowObservation> = {
      id: 'test/electron-window',
      async execute(request) {
        calls.push(request);
        return {
          type: request.type === 'OPEN' ? 'OPENED' : 'CLOSED',
          isWindowOpen: request.type === 'OPEN',
          config: request.type === 'OPEN' ? request.config : undefined,
        };
      },
    };
    const graph = createCausalRegionHarness([
      new ElectronHostNode(),
      new ElectronWindowExecutionNode(undefined, undefined, adapter),
      new ElectronWindowObservationNode(),
    ]);
    try {
      await graph.inject('host-el', { type: 'DesktopStartRequestedInfo' });
      expect(calls.map((call) => call.type)).toEqual(['OPEN']);
      expect(graph.state<{ isWindowOpen: boolean }>('host-el').isWindowOpen).toBe(true);
      expect(graph.deliveredInfos('DesktopWindowObservedInfo', 'host-el')).toHaveLength(1);

      await graph.inject('host-el', { type: 'DesktopCloseRequestedInfo' });
      expect(calls.map((call) => call.type)).toEqual(['OPEN', 'CLOSE']);
      expect(graph.state<{ isWindowOpen: boolean }>('host-el').isWindowOpen).toBe(false);
      expect(graph.deliveredInfos('DesktopWindowObservedInfo', 'host-el')).toHaveLength(2);
    } finally {
      await graph.dispose();
    }
  });

  it('reconciles an OS window close as an injected observation and can reopen', async () => {
    const adapter: EffectAdapter<ElectronWindowRequest, ElectronWindowObservation> = {
      id: 'test/electron-window',
      async execute(request) {
        return { type: 'OPENED', isWindowOpen: true, config: request.type === 'OPEN' ? request.config : undefined };
      },
    };
    const graph = createCausalRegionHarness([
      new ElectronHostNode(),
      new ElectronWindowExecutionNode(undefined, undefined, adapter),
      new ElectronWindowObservationNode(),
    ]);
    try {
      await graph.inject('host-el', { type: 'DesktopStartRequestedInfo' });
      await graph.inject('src-electron-window', { type: 'ElectronWindowClosedObservedInfo' });
      expect(graph.state<{ isWindowOpen: boolean }>('host-el').isWindowOpen).toBe(false);
      await graph.inject('host-el', { type: 'DesktopStartRequestedInfo' });
      expect(graph.state<{ isWindowOpen: boolean }>('host-el').isWindowOpen).toBe(true);
    } finally {
      await graph.dispose();
    }
  });

  it('keeps a failed physical startup inside the graph and accepts a later retry', async () => {
    let fail = true;
    const adapter: EffectAdapter<ElectronWindowRequest, ElectronWindowObservation> = {
      id: 'test/electron-window',
      async execute() {
        if (fail) throw new Error('display unavailable');
        return { type: 'OPENED', isWindowOpen: true };
      },
    };
    const graph = createCausalRegionHarness([
      new ElectronHostNode(),
      new ElectronWindowExecutionNode(undefined, undefined, adapter),
      new ElectronWindowObservationNode(),
    ]);
    try {
      await graph.inject('host-el', { type: 'DesktopStartRequestedInfo' });
      expect(graph.state<{ isWindowOpen: boolean; lastError: string | null }>('host-el'))
        .toMatchObject({ isWindowOpen: false, lastError: 'display unavailable' });
      fail = false;
      await graph.inject('host-el', { type: 'DesktopStartRequestedInfo' });
      expect(graph.state<{ isWindowOpen: boolean; lastError: string | null }>('host-el'))
        .toMatchObject({ isWindowOpen: true, lastError: null });
    } finally {
      await graph.dispose();
    }
  });
});

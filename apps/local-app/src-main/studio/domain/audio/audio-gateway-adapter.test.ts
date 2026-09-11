import { describe, expect, it, vi } from 'vitest';
import { Node, WorldNode, KernelRuntime as VisualKernel, type DomainChangeContext, type Info, type WorldChangeContext } from '@graphvideo/kernel';
import { EffectHarness } from '@graphvideo/kernel';
import { AudioGatewayAdapter, type AudioGatewayClient } from '../../effects/audio-gateway-adapter';
import type { AudioGenerationResult } from './types';

function fixtureClient(result?: AudioGenerationResult) {
  const audio = result ?? {
    kind: 'audio' as const,
    url: 'fixture://audio/sfx.wav',
    filename: 'fixture-sfx.wav',
    audioBlob: new Blob(['small-audio-fixture'], { type: 'audio/wav' }),
    elapsedMs: 12,
    timestamp: 100,
  };
  return {
    setServerAddress: vi.fn(),
    getBaseUrl: vi.fn(() => 'http://fixture.invalid/api/v1'),
    setProjectId: vi.fn(),
    getProjectId: vi.fn(() => 'fixture-project'),
    designVoice: vi.fn(),
    synthesizeSpeech: vi.fn(),
    generateSfx: vi.fn(async () => audio),
  } satisfies AudioGatewayClient;
}

const fixtureRequest = {
  task: {
    type: 'SFX' as const,
    payload: {
      prompt: 'short neutral fixture tone',
      duration: 1,
      steps: 4,
      cfg_scale: 1,
    },
  },
  projectId: 'fixture-project',
};

class CaptureNode extends Node<{ latest?: Info }> {
  constructor() {
    super('audio-error-observer', 'Audio Error Observer', {});
  }
  override change(info: Info, ctx: DomainChangeContext<{ latest?: Info }>) {
    ctx?.write('latest', info);
  }
}

class TestAudioWorldNode extends WorldNode<{ progress?: number; latestAudio?: { filename: string } }> {
  constructor(id: string, name: string, private readonly adapter: AudioGatewayAdapter, private readonly observerId?: string) {
    super(id, name, { progress: 0 });
  }

  override async change(info: Info, ctx: WorldChangeContext<{ progress?: number; latestAudio?: { filename: string } }>) {
    if (info.type === 'UserAudioTaskInfo') {
      const taskInfo = info as Info & { task: typeof fixtureRequest.task; projectId: string };
      try {
        const observation = await ctx.effectAdapter(this.adapter, {
          task: taskInfo.task,
          projectId: taskInfo.projectId,
        });
        if (observation?.kind === 'audio') {
          ctx.write('progress', 100);
          ctx.write('latestAudio', { filename: observation.filename });
        }
      } catch (error) {
        if (this.observerId) {
          ctx.send({
            type: 'AudioGenerationFailedObservedInfo',
            adapterId: this.adapter.id,
            error: error instanceof Error ? error.message : String(error),
          }, this.observerId);
        }
      }
    }
  }
}

describe('AudioGatewayAdapter', () => {
  it('runs a small secret-free Gateway Fixture without Graph', async () => {
    const client = fixtureClient();
    const adapter = new AudioGatewayAdapter(client);
    const result = await new EffectHarness().run(adapter, {
      schemaVersion: 1,
      fixtureId: 'audio-gateway/sfx',
      request: fixtureRequest,
    });
    expect(client.generateSfx).toHaveBeenCalledWith(fixtureRequest.task.payload);
    expect(result.record).toMatchObject({
      adapterId: 'graphvideo/audio-gateway-v1',
      status: 'succeeded',
      transportMetadata: [expect.anything()],
      rawSummaries: [expect.objectContaining({
        kind: 'audio-gateway-response',
        text: expect.stringContaining('filename=fixture-sfx.wav'),
      })],
    });
    expect(result.observation).toMatchObject({
      kind: 'audio',
      filename: 'fixture-sfx.wav',
      audioBlob: expect.any(Blob),
    });
  });

  it('lets Audio WorldNode expose only Adapter fact refs in Trace', async () => {
    const adapter = new AudioGatewayAdapter(fixtureClient());
    const node = new TestAudioWorldNode('audio-fixture', 'Audio Fixture', adapter);
    const kernel = new VisualKernel();
    kernel.mount(node);
    kernel.injectRootInfo(node, {
      type: 'UserAudioTaskInfo',
      taskId: 'audio-fixture-task',
      targetNodeId: 'audio-target',
      task: fixtureRequest.task,
      projectId: fixtureRequest.projectId,
    });
    await kernel.waitForQuiescence();
    expect(node.getState()).toMatchObject({
      progress: 100,
      latestAudio: { filename: 'fixture-sfx.wav' },
    });
    const requested = kernel.events.find((event) => event.type === 'EffectRequested');
    const observed = kernel.events.find((event) => event.type === 'EffectObserved');
    expect(requested).toMatchObject({
      adapterId: 'graphvideo/audio-gateway-v1',
      requestRef: expect.stringMatching(/^effect-request:/),
    });
    expect(observed).toMatchObject({
      adapterId: 'graphvideo/audio-gateway-v1',
      observationRef: expect.stringMatching(/^effect-observation:/),
    });
    expect(JSON.stringify([requested, observed])).not.toContain('short neutral fixture tone');
    expect(JSON.stringify([requested, observed])).not.toContain('fixture-sfx.wav');
  });

  it('records Gateway errors as failed Harness facts', async () => {
    const client = fixtureClient();
    client.generateSfx.mockRejectedValueOnce(new Error('gateway unavailable'));
    const result = await new EffectHarness().run(new AudioGatewayAdapter(client), {
      schemaVersion: 1,
      fixtureId: 'audio-gateway/failure',
      request: fixtureRequest,
    });
    expect(result.record).toMatchObject({ status: 'failed', error: 'gateway unavailable' });
  });

  it('converts Gateway failure into an explicit World error Info', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const client = fixtureClient();
    client.generateSfx.mockRejectedValueOnce(new Error('gateway unavailable'));
    const observer = new CaptureNode();
    const node = new TestAudioWorldNode('audio-failure', 'Audio Failure', new AudioGatewayAdapter(client), observer.id);
    const kernel = new VisualKernel();
    kernel.mount(node, observer);
    kernel.injectRootInfo(node, {
      type: 'UserAudioTaskInfo',
      taskId: 'audio-fixture-task',
      targetNodeId: 'audio-target',
      task: fixtureRequest.task,
    });
    await kernel.waitForQuiescence();
    expect(observer.getState().latest).toMatchObject({
      type: 'AudioGenerationFailedObservedInfo',
      adapterId: 'graphvideo/audio-gateway-v1',
      error: 'gateway unavailable',
    });
    expect(kernel.causalRecords.find((record) => record.nodeId === node.id)?.error).toBeUndefined();
    warning.mockRestore();
  });
});

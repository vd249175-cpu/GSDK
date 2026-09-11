import { describe, expect, it, vi } from 'vitest';
import { EffectHarness } from '@graphvideo/kernel';
import {
  ComfyCloudAdapter,
  type ComfyCloudGateway,
} from '../../effects/comfy-cloud-adapter';

const DEFAULT_COMFY_IMAGE_WORKFLOW = {
  id: 'fixture-workflow',
  graph: { '3': { class_type: 'KSampler', inputs: { seed: 0 } } },
};

describe('ComfyCloudAdapter', () => {
  it('runs the GPU boundary as a secret-free Effect fixture', async () => {
    const gateway: ComfyCloudGateway = {
      executeWorkflow: vi.fn(async () => ({
        kind: 'image' as const,
        url: 'fixture://comfy/artifact.png',
        filename: 'artifact.png',
        timestamp: 100,
      })),
    }
    const result = await new EffectHarness().run(new ComfyCloudAdapter(gateway), {
      schemaVersion: 1,
      fixtureId: 'comfy-cloud/image',
      request: {
        workflow: DEFAULT_COMFY_IMAGE_WORKFLOW,
        values: { prompt: 'small fixture prompt' },
      },
    })

    expect(gateway.executeWorkflow).toHaveBeenCalledOnce()
    expect(result.record).toMatchObject({
      adapterId: 'graphvideo/comfy-cloud-v1',
      status: 'succeeded',
      transportMetadata: [expect.anything()],
      rawSummaries: [expect.objectContaining({ kind: 'comfy-cloud-artifact' })],
    })
    expect(result.observation).toMatchObject({ filename: 'artifact.png' })
  })
})

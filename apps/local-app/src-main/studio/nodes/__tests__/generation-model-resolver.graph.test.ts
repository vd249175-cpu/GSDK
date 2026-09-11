import { describe, expect, it } from 'vitest';
import { GenerationModelResolverNode } from '../generation-model-resolver';
import { GenerationTaskNode } from '../generation-task';
import type { GenerationModelResolutionRequestedInfo } from '../../protocol';
import { createCausalRegionHarness } from '../../testing/graph';
import { loadGenerationCatalogSnapshot } from '../../../electron/generation-catalog-snapshot.mjs';
import { resolve } from 'node:path';

describe('GenerationModelResolverNode', () => {
  it('owns pure model resolution without invoking a physical adapter', async () => {
    const catalog = (await loadGenerationCatalogSnapshot(resolve(process.cwd(), 'app/resources/generation-models'))).select(['audio-sfx']);
    const resolver = new GenerationModelResolverNode();
    const region = createCausalRegionHarness([resolver, new GenerationTaskNode()]);
    const info: GenerationModelResolutionRequestedInfo = {
      type: 'GenerationModelResolutionRequestedInfo',
      requestId: 'resolution-1',
      input: {
        nodeType: 'audio',
        prompt: '---\nmodel: audio-sfx\nduration: 8\n---\nRain on a metal roof.',
      },
      catalog,
    };
    await region.inject(resolver.id, info);
    expect(resolver.getState().resolutions.get('resolution-1')).toMatchObject({
      status: 'resolved',
      result: {
        kind: 'audio-payload',
        workflowType: 'audio-sfx',
        inputs: { duration: 8, prompt: 'Rain on a metal roof.' },
      },
    });
    expect(region.deliveredInfos('GenerationModelResolutionCompletedInfo', 'node-generation-task')).toHaveLength(1);
    await region.dispose();
  });
});

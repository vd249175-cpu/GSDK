import { describe, expect, it } from 'vitest';
import { createCausalRegionHarness } from './causal-region-harness';
import { InfoCollectorNode } from './info-collector';

describe('causal region test support', () => {
  it('runs deterministic submissions and exposes only local delivered Info', async () => {
    const collector = new InfoCollectorNode('fixture-collector', ['FixtureInfo']);
    const region = createCausalRegionHarness([collector]);

    await region.inject(collector.id, { type: 'FixtureInfo', value: 1 });

    expect(collector.received('FixtureInfo')).toEqual([{ type: 'FixtureInfo', value: 1 }]);
    expect(region.deliveredInfos('FixtureInfo', collector.id)).toHaveLength(1);
    await region.dispose();
  });
});

import { describe, expect, it } from 'vitest';
import { Node } from '../src/node';

class ResourceNode extends Node {
  unmounted = 0;
  change(): void {}
  onUnmount(): void { this.unmounted += 1; }
}

describe('Node cleanup confirmation', () => {
  it('shares in-flight disposal, retries failed resources, and remembers successful cleanup', async () => {
    const node = new ResourceNode('resource', 'Resource');
    let successful = 0;
    let attempted = 0;
    let fail = true;
    node.registerDisposer(async () => { successful += 1; });
    node.registerDisposer(async () => { attempted += 1; if (fail) throw new Error('resource unavailable'); });
    const first = node.dispose();
    expect(node.dispose()).toBe(first);
    await expect(first).rejects.toThrow('cleanup failed');
    fail = false;
    await node.dispose();
    await node.dispose();
    expect(successful).toBe(1);
    expect(attempted).toBe(2);
    expect(node.unmounted).toBe(1);
  });
});

import { describe, expect, it } from 'vitest';
import { KernelRuntime } from '@graphvideo/kernel';
import { createStudioNodes } from './studio-factories';

describe('Studio Node factories', () => {
  it('elaborates a fresh flat 16-node batch on every call', () => {
    const first = createStudioNodes({});
    const second = createStudioNodes({});

    expect(first).toHaveLength(16);
    expect(first.map((node) => node.id)).toEqual(second.map((node) => node.id));
    expect(new Set(first.map((node) => node.id)).size).toBe(16);
    first.forEach((node, index) => {
      expect(second[index]).not.toBe(node);
      expect(second[index].getState()).not.toBe(node.getState());
    });
  });

  it('keeps the produced Nodes ID-decoupled and mounts only ordinary Nodes', () => {
    const nodes = createStudioNodes({});
    const byId = new Map(nodes.map((node) => [node.id, node]));

    expect(byId.has('node-md-source')).toBe(true);
    expect(byId.has('node-md-parser')).toBe(true);
    expect(byId.has('node-outliner')).toBe(true);
    expect(byId.has('node-sqlite')).toBe(true);
    expect(byId.has('node-generation-task')).toBe(true);
    expect(byId.has('host-el')).toBe(true);
    for (const retiredId of [
      'node-agent-console',
      'sink-pty-stdin',
      'src-pty-stdout',
      'host-vite',
      'host-loader',
      'host-generation-adapter',
      'node-comfy-runner',
      'node-audio-runner',
      'sink-artifact-writer',
      'src-artifact-observer',
    ]) expect(byId.has(retiredId)).toBe(false);
    expect((byId.get('node-md-source') as any).parserTarget).toBeUndefined();

    const runtime = new KernelRuntime().mount(...nodes);
    expect(runtime.nodes.size).toBe(16);
  });

  it('lets each constructed Node inspect its static configuration without running change', () => {
    const taskNode = createStudioNodes({}).find((node) => node.id === 'node-generation-task');
    expect(taskNode).toBeDefined();
    expect(taskNode?.constructor.name).toBe('GenerationTaskNode');
    expect((taskNode as any)?.submitTargetId).toBe('node-sec-gate');
  });
});

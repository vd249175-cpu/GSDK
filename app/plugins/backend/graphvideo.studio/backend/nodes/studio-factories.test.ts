import { describe, expect, it } from 'vitest';
import { KernelRuntime } from '@graphvideo/sdk/node';
import type { GraphFactoryContext } from '@graphvideo/sdk/plugin';
import { createStudioNodes, type StudioNodeDependencies } from './studio-factories';

function studioCtx(instanceId: string): GraphFactoryContext<StudioNodeDependencies> {
  return {
    instanceId,
    nodeId: instanceId,
    params: {},
    bindings: {},
    dependencies: {},
    pluginId: 'graphvideo.studio',
    nodeIdFor: (local: string) => `${instanceId}/${local}`,
  };
}

describe('Studio Node factories', () => {
  it('elaborates a fresh namespaced 19-node batch on every call', () => {
    const first = createStudioNodes(studioCtx('studio'));
    const second = createStudioNodes(studioCtx('studio'));

    expect(first).toHaveLength(19);
    expect(first.map((node) => node.id)).toEqual(second.map((node) => node.id));
    expect(new Set(first.map((node) => node.id)).size).toBe(19);
    for (const node of first) expect(node.id.startsWith('studio/')).toBe(true);
    first.forEach((node, index) => {
      expect(second[index]).not.toBe(node);
      expect(second[index].getState()).not.toBe(node.getState());
    });
  });

  it('isolates two instances of the same factory', () => {
    const first = createStudioNodes(studioCtx('ns-a'));
    const second = createStudioNodes(studioCtx('ns-b'));
    const firstIds = new Set(first.map((node) => node.id));
    const secondIds = new Set(second.map((node) => node.id));
    expect([...firstIds].some((id) => secondIds.has(id))).toBe(false);
    expect(first.map((node) => node.id.split('/').slice(1).join('/')).sort()).toEqual(
      second.map((node) => node.id.split('/').slice(1).join('/')).sort(),
    );
  });

  it('keeps the produced Nodes ID-decoupled and mounts only ordinary Nodes', () => {
    const nodes = createStudioNodes(studioCtx('studio'));
    const byId = new Map(nodes.map((node) => [node.id, node]));

    expect(byId.has('studio/node-md-source')).toBe(true);
    expect(byId.has('studio/node-md-parser')).toBe(true);
    expect(byId.has('studio/node-outliner')).toBe(true);
    expect(byId.has('studio/node-sqlite')).toBe(true);
    expect(byId.has('studio/node-generation-task')).toBe(true);
    expect(byId.has('studio/host-el')).toBe(true);
    expect(byId.get('studio/host-el')?.isWorldNode).toBe(false);
    expect((byId.get('studio/sink-electron-window') as { worldKind?: string })?.worldKind).toBe('execution');
    expect((byId.get('studio/src-electron-window') as { worldKind?: string })?.worldKind).toBe('observation');
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
    ]) expect(byId.has(`studio/${retiredId}`)).toBe(false);

    const runtime = new KernelRuntime().mount(...nodes);
    expect(runtime.nodes.size).toBe(19);
  });

  it('lets each constructed Node inspect its static configuration without running change', () => {
    const taskNode = createStudioNodes(studioCtx('studio')).find((node) => node.id === 'studio/node-generation-task');
    expect(taskNode).toBeDefined();
    expect(taskNode?.constructor.name).toBe('GenerationTaskNode');
    expect((taskNode as unknown as { submitTargetId?: string })?.submitTargetId).toBe('studio/node-sec-gate');
  });
});

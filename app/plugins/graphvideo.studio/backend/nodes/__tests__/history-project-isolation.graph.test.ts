import { describe, expect, it } from 'vitest';
import { createCausalRegionHarness, InfoCollectorNode } from '../../testing/graph';
import { FileSystemSourceNode } from '../file-system';
import { HistoryManagerNode } from '../history-manager';
import { SqliteRegistryNode } from '../sqlite-registry';

describe('project history isolation', () => {
  it('clears undo and redo on every project load, including same-path snapshot restoration', async () => {
    const source = new FileSystemSourceNode();
    const registry = new SqliteRegistryNode();
    const history = new HistoryManagerNode();
    const region = createCausalRegionHarness([source, registry, history,
      new InfoCollectorNode('node-md-source'), new InfoCollectorNode('sink-sqlite-writer')]);
    const open = (path: string, description: string) => region.inject(source.id, {
      type: 'ProjectOpenedInfo', project: { path, name: path, markdown: '', retainedNodes: [], nodes: [
        { id: 'shared', type: 'text', title: 'Shared', description },
      ] },
    });
    const patch = () => region.inject(registry.id, { type: 'UserMetadataPatchInfo', patch: { id: 'shared', description: 'edited' } });
    const action = (type: 'UNDO' | 'REDO') => region.inject(history.id, { type: 'UserSnapshotActionInfo', action: { type } });
    try {
      await open('A', 'A original');
      await patch();
      expect(history.getState().past).toHaveLength(1);
      const staleEntry = history.getState().past[0];
      const staleScope = registry.getState().historyScopeId;
      await open('B', 'B original');
      await region.inject(registry.id, {
        type: 'RevertMetadataTaskInfo', entry: staleEntry, direction: 'undo', historyScopeId: staleScope,
      });
      await region.inject(history.id, {
        type: 'TaskFactObservedInfo', fact: staleEntry, historyScopeId: staleScope,
      });
      await action('UNDO');
      expect(registry.getRecord('shared')?.description).toBe('B original');
      expect(history.getState()).toMatchObject({ past: [], future: [], currentEntry: null });
      await patch();
      await action('UNDO');
      expect(history.getState().future).toHaveLength(1);
      await open('B', 'B snapshot');
      await action('REDO');
      expect(registry.getRecord('shared')?.description).toBe('B snapshot');
      await open('A', 'A persisted');
      await action('UNDO');
      expect(registry.getRecord('shared')?.description).toBe('A persisted');
    } finally { await region.dispose(); }
  });
});

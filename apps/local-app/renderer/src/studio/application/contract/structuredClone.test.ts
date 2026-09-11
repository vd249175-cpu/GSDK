import { describe, expect, it } from 'vitest'
import { createInitialState } from '../../core/state/initialState'
import type { ApplicationEventMap, ApplicationRequestMap } from './application'

type RequestExamples = {
  [K in keyof ApplicationRequestMap]: {
    input: ApplicationRequestMap[K]['input']
    output: ApplicationRequestMap[K]['output']
  }
}

const emptySnapshot = {
  revision: 1,
  state: createInitialState(),
  history: { canUndo: false, canRedo: false, undoLabel: null, redoLabel: null, revision: 0 },
}

const requests = {
  'snapshot.read': { input: undefined, output: emptySnapshot },
  'project.open': { input: {}, output: { opened: false } },
  'project.list-recent': { input: undefined, output: [] },
  'project.snapshot.list': {
    input: undefined,
    output: { activeBranchId: 'main', branches: [], snapshots: [] },
  },
  'project.snapshot.create': {
    input: { label: '初稿' },
    output: { activeBranchId: 'main', branches: [], snapshots: [] },
  },
  'project.snapshot.branch': {
    input: { snapshotId: 'snapshot-a', branchName: '方案 A' },
    output: { activeBranchId: 'branch-a', branches: [], snapshots: [] },
  },
  'project.run-markdown': { input: { markdown: '# project' }, output: undefined },
  'project.tree.edit': {
    input: { type: 'rename', key: 'node-a', title: 'A' }, output: undefined,
  },
  'project.node.patch': { input: { id: 'node-a', patch: { description: 'A' } }, output: { revision: 1 } },
  'project.node.import-version': { input: { id: 'node-a' }, output: undefined },
  'project.node.promote-version': { input: { id: 'node-a', versionId: 'v1' }, output: undefined },
  'generation-models.list': { input: undefined, output: { models: [], issues: [] } },
  'generation-models.generate-batch': {
    input: { items: [{ nodeId: 'node-a', prompt: 'A' }], maxGenerationWaitMs: 1_800_000 }, output: { status: 'completed' },
  },
  'generation-models.resolve': {
    input: { nodeType: 'image', prompt: 'A', references: [] },
    output: {
      model: {
        schemaVersion: 1, id: 'model-a', name: 'A', description: '', mediaType: 'image',
        provider: 'test', apiModel: 'test',
        entrypoints: { promptParser: 'prompt.mjs', apiAdapter: 'api.mjs' },
        capabilities: { modes: [], references: [], nativeAudio: false },
        parameters: {}, defaults: {}, prompt: {}, api: {},
      },
      body: 'A', prompt: 'A', aliases: {}, effectiveConfig: {},
    },
  },
  'generation-models.build-request': {
    input: { nodeType: 'image', prompt: 'A', references: [] }, output: {},
  },
  'generation-models.import': { input: undefined, output: { canceled: true } },
  'generation-models.delete': { input: { modelId: 'model-a' }, output: undefined },
  'prompt-library.list': { input: undefined, output: [] },
  'prompt-library.read': { input: { path: 'a.xml' }, output: '<prompts></prompts>' },
  'prompt-library.save': { input: { path: 'a.xml', content: '<prompts></prompts>' }, output: undefined },
  'prompt-library.create': { input: { path: 'a.xml', content: '<prompts></prompts>' }, output: undefined },
  'prompt-library.create-directory': { input: { path: 'folder' }, output: undefined },
  'prompt-library.rename': {
    input: { sourcePath: 'a.xml', targetPath: 'b.xml' }, output: undefined,
  },
  'prompt-library.delete': { input: { path: 'a.xml' }, output: undefined },
  'assets.url': { input: { nodeId: 'node-a', versionId: 'v1' }, output: 'graphvideo://asset' },
  'assets.copy-versions': { input: { items: [] }, output: { count: 0, mode: 'paths' } },
  'assets.export-videos': {
    input: { nodeIds: [] }, output: { canceled: false, exported: [], skipped: [] },
  },
  'agent.discover': { input: undefined, output: [] },
  'agent.launch-terminal': {
    input: { templateId: 't', agentId: 'a' },
    output: { templateId: 't', agentId: 'a', title: 'A', terminal: 'windows-terminal' },
  },
  'agent.open-directory': { input: { templateId: 't', agentId: 'a' }, output: undefined },
  'history.undo': { input: undefined, output: undefined },
  'history.redo': { input: undefined, output: undefined },
  'history.clear-redo': { input: undefined, output: undefined },
} satisfies RequestExamples

const events = {
  'snapshot.changed': emptySnapshot,
  'generation-models.catalog-changed': { reason: 'import' },
  'history.recorded': { historyId: 'h', label: 'A' },
  'history.cleared': {},
} satisfies ApplicationEventMap

describe('Application DTO contract', () => {
  it('keeps every request, response, event and snapshot structured-cloneable', () => {
    Object.values(requests).forEach(({ input, output }) => {
      expect(() => structuredClone(input)).not.toThrow()
      expect(() => structuredClone(output)).not.toThrow()
    })
    Object.values(events).forEach((event) => expect(() => structuredClone(event)).not.toThrow())
  })
})

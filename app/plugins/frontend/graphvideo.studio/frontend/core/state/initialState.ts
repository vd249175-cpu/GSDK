import type { ApplicationState } from './types'

export function createInitialState(): ApplicationState {
  return {
    project: {
      name: '未打开项目',
      localPath: null,
      markdown: '',
      lastRunMarkdown: '',
      nodes: {},
      retainedNodes: {},
      tree: [],
      issues: [],
      logicRevision: 0,
      lastLogicRunAt: null,
    },
    runtime: {
      pendingTasks: 0,
      activeBackgroundTasks: 0,
      taskGraphs: {},
      lastSavedAt: null,
      lastError: null,
      generation: {
        spentCredits: 0,
        maxBudget: 10000,
        lastBlockReason: null,
      },
    },
    plugins: {},
  }
}

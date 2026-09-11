import { useMemo, useSyncExternalStore } from 'react'
import {
  useAppState,
  useApplicationClient,
  useApplicationRevision,
  useClientSelectionActions,
  useClientState,
  useMarkdownDraft,
  useSelectedNodeId,
  useShellClient,
  useWorkbenchContext,
} from './app/AppContext'
import type { ElementRuntimeHandle } from '@graphvideo/sdk/workbench'

export {
  useAppState,
  useApplicationClient,
  useApplicationRevision,
  useClientSelectionActions,
  useClientState,
  useMarkdownDraft,
  useSelectedNodeId,
  useShellClient,
  useWorkbenchContext,
}
export type { GraphVideoApplicationClient } from './client/app/applicationClient'
export { useProjectAssetUrl } from './client/app/useProjectAssetUrl'
export {
  generationPromptModelId,
  parseGenerationPrompt,
  setGenerationPromptModel,
  stripGenerationPromptFrontMatter,
} from '../../../src-main/shared/generation-prompt.mjs'
export type { GenerationModelManifest } from '../../../src-main/shared/generation-model.mjs'
export type {
  AgentDefinitionDto as AgentDefinition,
  AgentTemplateDto as AgentTemplateDefinition,
  AgentTerminalLaunchDto as AgentTerminalLaunch,
  GenerationDagItem,
  GenerationModelReference,
  GenerationModelResolveInput,
  LocalProjectSourceDto,
  ProjectSnapshotBranchDto,
  ProjectSnapshotDto,
  ProjectSnapshotGraphDto,
  PromptLibraryEntryDto as PromptLibraryEntry,
  RecentProjectDto as RecentLocalProject,
  ResolvedGenerationPrompt,
} from './application/contract/domain'
export { copyProjectTreeItem, flattenProjectTree } from './core/project/treeEditor'
export type {
  ProjectTreeClipboardItem,
  ProjectTreeDropPosition,
  ProjectTreeEditOperation,
} from './core/project/treeEditor'
export { usesTextPayload } from './core/project/types'
export type {
  NodeType,
  NodeVersion,
  ProjectIssue,
  ProjectNode,
  ProjectTreeItem,
} from './core/project/types'

import {
  defineElement as defineWorkbenchElement,
  type ElementModule as WorkbenchElementModule,
  type ElementRegistrationContext as WorkbenchElementRegistrationContext,
} from '@graphvideo/sdk/workbench'
import type { GraphVideoApplicationClient } from './client/app/applicationClient'

export type ElementRegistrationContext = WorkbenchElementRegistrationContext<GraphVideoApplicationClient>
export type ElementModule = WorkbenchElementModule<GraphVideoApplicationClient>

export function defineElement(module: ElementModule): ElementModule {
  return defineWorkbenchElement<GraphVideoApplicationClient>(module)
}

export { defineWorkbenchContext } from '@graphvideo/sdk/workbench'
export type {
  WorkbenchContextBinding,
  WorkbenchContextHandle,
  WorkbenchContextScope,
  WorkbenchContextToken,
  ElementEventEmitter,
  ElementEventRegistration,
  ElementHostApi,
  ElementRuntimeHandle,
  ElementRuntimeValue,
  ElementServiceAccessor,
  ElementServiceRegistration,
  ElementStateBinding,
  ElementStateDefinition,
  ElementStateHandle,
  ElementStateScope,
  ExtensionDefinition,
  ExtensionProps,
  PanelDefinition,
  PanelProps,
} from '@graphvideo/sdk/workbench'

export function useElementState<T>(
  runtime: ElementRuntimeHandle,
  stateId: string,
  binding: { workspaceId?: string } = {},
) {
  const workspaceId = binding.workspaceId
  const projectId = useAppState((state) => state.project.localPath)
  const handle = useMemo(() => runtime.states.get<T>(stateId, { projectId, workspaceId }), [
    projectId,
    runtime,
    stateId,
    workspaceId,
  ])
  return [
    useSyncExternalStore(handle.subscribe, handle.read, handle.read),
    handle.write,
  ] as const
}

export function useNodeState<T = any>(nodeId: string): T | undefined
export function useNodeState<T, R>(nodeId: string, selector: (state: T) => R): R | undefined
export function useNodeState<T = any, R = T>(
  nodeId: string,
  selector?: (state: T) => R,
): R | undefined {
  return useAppState((state) => {
    const entry = (state as any).plugins?.[nodeId]
    const nodeState = entry?.state as T | undefined
    if (nodeState === undefined) return undefined
    return selector ? selector(nodeState) : (nodeState as unknown as R)
  })
}

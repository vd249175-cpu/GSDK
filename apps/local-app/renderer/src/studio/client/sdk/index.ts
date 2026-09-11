/**
 * @fileoverview GraphVideo 现代化客户端 SDK (Client SDK)
 */

import { useMemo, useSyncExternalStore } from 'react'
import {
  useAppState as useInternalAppState,
} from '../../app/AppContext'
import type { ElementRuntimeHandle } from '@graphvideo/workbench'

export {
  useAppState, useApplicationClient, useApplicationRevision, useClientSelectionActions, useClientState,
  useMarkdownDraft, useSelectedNodeId, useShellClient,
  useWorkbenchContext,
} from '../../app/AppContext'
export type { GraphVideoApplicationClient } from '../app/applicationClient'
export { useProjectAssetUrl } from '../app/useProjectAssetUrl'
export {
  generationPromptModelId, parseGenerationPrompt, setGenerationPromptModel,
  stripGenerationPromptFrontMatter,
} from '../../../shared/generation-prompt.mjs'
export type { GenerationModelManifest } from '../../../shared/generation-model.mjs'
export type {
  AgentDefinitionDto as AgentDefinition,
  AgentTemplateDto as AgentTemplateDefinition,
  AgentTerminalLaunchDto as AgentTerminalLaunch,
  GenerationDagItem, GenerationModelReference, GenerationModelResolveInput, LocalProjectSourceDto,
  ProjectSnapshotBranchDto, ProjectSnapshotDto, ProjectSnapshotGraphDto,
  PromptLibraryEntryDto as PromptLibraryEntry, RecentProjectDto as RecentLocalProject,
  ResolvedGenerationPrompt,
} from '../../application/contract/domain'
export { copyProjectTreeItem, flattenProjectTree } from '../../core/project/treeEditor'
export type {
  ProjectTreeClipboardItem, ProjectTreeDropPosition, ProjectTreeEditOperation,
} from '../../core/project/treeEditor'
export { usesTextPayload } from '../../core/project/types'
export type {
  NodeType, NodeVersion, ProjectIssue, ProjectNode, ProjectTreeItem,
} from '../../core/project/types'
export {
  defineElement, defineWorkbenchContext, AudioPlayer,
  type WorkbenchContextBinding, type WorkbenchContextHandle, type WorkbenchContextScope,
  type WorkbenchContextToken,
  type ElementEventEmitter, type ElementEventRegistration, type ElementHostApi, type ElementModule,
  type ElementRuntimeHandle, type ElementRuntimeValue, type ElementServiceAccessor,
  type ElementServiceRegistration, type ElementStateBinding, type ElementStateDefinition,
  type ElementStateHandle, type ElementStateScope, type ExtensionDefinition, type ExtensionProps,
  type PanelDefinition, type PanelProps,
} from '@graphvideo/workbench'

export function useElementState<T>(
  runtime: ElementRuntimeHandle,
  stateId: string,
  binding: { workspaceId?: string } = {},
) {
  const workspaceId = binding.workspaceId
  const projectId = useInternalAppState((state) => state.project.localPath)
  const handle = useMemo(() => runtime.states.get<T>(stateId, { projectId, workspaceId }), [
    projectId, runtime, stateId, workspaceId,
  ])
  return [
    useSyncExternalStore(handle.subscribe, handle.read, handle.read),
    handle.write,
  ] as const
}

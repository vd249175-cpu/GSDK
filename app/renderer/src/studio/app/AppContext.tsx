import {
  createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore,
  type PropsWithChildren,
} from 'react'
import type { ApplicationState } from '../core/state/types'
import type { ClientState } from '../client/state/clientStateStore'
import {
  WorkbenchHostContext, type WorkbenchHostAdapter, type ClientWorkspaceState,
  type WorkbenchContextBinding, type WorkbenchContextToken,
} from '@graphvideo/workbench'
import { appServices, type AppServices } from './services'
import { activeSelectedNodeIdToken } from '@graphvideo/sdk/tokens'
import { resolveSelectedNodeId } from '../client/state/nodeSelection'

export const ServicesContext = createContext<AppServices>(appServices)

export function AppProvider({ children }: PropsWithChildren) {
  const hostAdapter = useMemo<WorkbenchHostAdapter>(() => ({
    services: {
      commands: appServices.commands,
      panels: appServices.panels,
      extensions: appServices.extensions,
      elementEvents: appServices.elementEvents,
      elementServices: appServices.elementServices,
      elementStates: appServices.elementStates,
      elementRuntimes: appServices.elementRuntimes,
      contexts: appServices.workbenchContexts,
    },
    useWorkspaceState<T>(selector: (state: ClientWorkspaceState) => T): T {
      return useClientState((s) => selector(s.workspace))
    },
  }), [])

  return (
    <ServicesContext.Provider value={appServices}>
      <WorkbenchHostContext.Provider value={hostAdapter}>
        <ApplicationStartup initialize={appServices.initialize}>{children}</ApplicationStartup>
      </WorkbenchHostContext.Provider>
    </ServicesContext.Provider>
  )
}

export function ApplicationStartup({
  initialize,
  children,
}: PropsWithChildren<{ initialize(): Promise<void> }>) {
  useEffect(() => {
    void initialize()
  }, [initialize])
  return children
}

export function useServices() {
  return useContext(ServicesContext)
}

function shallowEqual(left: unknown, right: unknown) {
  if (Object.is(left, right)) return true
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key) => Object.is(
      (left as Record<string, unknown>)[key],
      (right as Record<string, unknown>)[key],
    ))
}

function createSelectorSnapshot<S, T>(
  state: { read(): S; subscribe(listener: () => void): () => void },
  selector: (snapshot: S) => T,
  equal: (left: T, right: T) => boolean,
) {
  let source: S | null = null
  let selected: T
  return () => {
    const nextSource = state.read()
    if (source === nextSource) return selected
    const nextSelected = selector(nextSource)
    if (source && equal(selected, nextSelected)) {
      source = nextSource
      return selected
    }
    source = nextSource
    selected = nextSelected
    return selected
  }
}

export function useStateSelector<S, T>(
  state: { read(): S; subscribe(listener: () => void): () => void },
  selector: (snapshot: S) => T,
  equal: (left: T, right: T) => boolean = shallowEqual,
) {
  const getSnapshot = useMemo(
    () => createSelectorSnapshot(state, selector, equal),
    [equal, selector, state],
  )
  return useSyncExternalStore(state.subscribe, getSnapshot, getSnapshot)
}

export function useAppState<T>(selector: (state: ApplicationState) => T) {
  const { applicationSnapshots } = useServices()
  return useStateSelector({
    read: applicationSnapshots.readState,
    subscribe: applicationSnapshots.subscribe,
  }, selector)
}

export function useApplicationClient() {
  return useServices().applicationClient
}

export function useApplicationRevision() {
  const { applicationSnapshots } = useServices()
  return useStateSelector(applicationSnapshots, (snapshot) => snapshot.revision)
}

export function useShellClient() {
  return useServices().shell
}

export function useClientState<T>(selector: (state: ClientState) => T) {
  const { clientState } = useServices()
  return useStateSelector(clientState, selector)
}

export function useWorkbenchContext<T>(
  token: WorkbenchContextToken<T>,
  binding: Omit<WorkbenchContextBinding, 'projectId'> = {},
) {
  const { workbenchContexts } = useServices()
  const projectId = useAppState((state) => state.project.localPath)
  const workspaceId = binding.workspaceId
  const instanceId = binding.instanceId
  const handle = useMemo(() => workbenchContexts.get(token, {
    projectId, workspaceId, instanceId,
  }), [instanceId, projectId, token, workbenchContexts, workspaceId])
  return [
    useSyncExternalStore(handle.subscribe, handle.read, handle.read),
    handle.write,
  ] as const
}

export function useSelectedNodeId() {
  const [tokenSelection] = useWorkbenchContext(activeSelectedNodeIdToken)
  return tokenSelection ?? null
}

export function useProjectSelectionSync() {
  const { clientState } = useServices()
  const projectPath = useAppState((state) => state.project.localPath)
  const nodes = useAppState((state) => state.project.nodes)
  const tree = useAppState((state) => state.project.tree)
  const [tokenSelection, setTokenSelection] = useWorkbenchContext(activeSelectedNodeIdToken)

  useEffect(() => {
    if (!projectPath) return
    // Project-scoped cells survive A -> B -> A. Only an uninitialized cell is restored.
    if (tokenSelection === undefined) {
      const selections = clientState.read().selectionByProjectPath
      const savedSelection = Object.hasOwn(selections, projectPath)
        ? selections[projectPath] : selections.current
      if (savedSelection === null) {
        setTokenSelection(null)
      } else if (Object.keys(nodes).length > 0) {
        setTokenSelection(resolveSelectedNodeId(savedSelection ?? null, nodes, tree)
          ?? Object.keys(nodes)[0])
      }
    } else if (tokenSelection !== null) {
      // A tree identity may arrive before its registry projection. Canonicalize once available.
      const canonical = resolveSelectedNodeId(tokenSelection, nodes, tree)
      if (canonical && canonical !== tokenSelection) setTokenSelection(canonical)
      else if (canonical) clientState.selectNode(projectPath, canonical)
    } else {
      clientState.selectNode(projectPath, null)
    }
  }, [projectPath, nodes, tree, tokenSelection, setTokenSelection, clientState])
}

export function useClientSelectionActions() {
  const { clientState, workbenchContexts, applicationSnapshots } = useServices()
  const selectNode = useCallback((projectPath: string | null, nodeId: string | null) => {
    const project = applicationSnapshots.readState().project
    const canonical = projectPath === project.localPath
      ? resolveSelectedNodeId(nodeId, project.nodes, project.tree) : nodeId
    workbenchContexts.get(activeSelectedNodeIdToken, { projectId: projectPath }).write(canonical)
    clientState.selectNode(projectPath, canonical)
  }, [applicationSnapshots, clientState, workbenchContexts])
  return { selectNode }
}

export function useMarkdownDraft(projectPath: string | null, committed: string) {
  const { clientState } = useServices()
  const stored = useClientState((state) => (
    projectPath ? state.markdownDraftByProjectPath[projectPath] : undefined
  ))
  const effective = useMemo(() => {
    if (!stored) return committed
    if (stored.startsWith('---') && !committed.startsWith('---')) {
      return committed
    }
    return stored
  }, [stored, committed])

  const setDraft = useCallback((markdown: string) => {
    clientState.setMarkdownDraft(projectPath, markdown)
  }, [clientState, projectPath])
  return [effective, setDraft] as const
}

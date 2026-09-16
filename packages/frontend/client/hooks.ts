import { useMemo, useSyncExternalStore } from 'react';
import type { ElementRuntimeHandle } from '@graphvideo/workbench';
import type {
  WorkbenchContextBinding,
  WorkbenchContextToken,
} from '@graphvideo/workbench';

export interface SnapshotSource<State> {
  read(): State;
  subscribe(listener: () => void): () => void;
}

export interface RevisionSnapshot {
  revision: number;
}

/** 客户端 hooks 所需的最小服务形状；与具体业务包无关。 */
export interface ClientHookServices<AppState, ClientState, AppClient, ShellClient> {
  readonly applicationSnapshots: SnapshotSource<RevisionSnapshot> & {
    readState(): AppState;
  };
  readonly clientState: SnapshotSource<ClientState>;
  readonly workbenchContexts: {
    get<T>(
      token: WorkbenchContextToken<T>,
      binding?: WorkbenchContextBinding,
    ): SnapshotSource<T> & {
      write(value: T | ((current: T) => T)): void;
    };
  };
  readonly applicationClient: AppClient;
  readonly shell: ShellClient;
}

export interface ClientHookOptions<AppState> {
  selectProjectId(state: AppState): string | null;
  readPluginStates(state: AppState): Record<string, { state: unknown }> | undefined;
}

function shallowEqual(left: unknown, right: unknown) {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key) => Object.is(
      (left as Record<string, unknown>)[key],
      (right as Record<string, unknown>)[key],
    ));
}

function createSelectorSnapshot<S, T>(
  state: SnapshotSource<S>,
  selector: (snapshot: S) => T,
  equal: (left: T, right: T) => boolean,
) {
  let source: S | null = null;
  let selected: T;
  return () => {
    const nextSource = state.read();
    if (source === nextSource) return selected;
    const nextSelected = selector(nextSource);
    if (source && equal(selected, nextSelected)) {
      source = nextSource;
      return selected;
    }
    source = nextSource;
    selected = nextSelected;
    return selected;
  };
}

export function useStateSelector<S, T>(
  state: SnapshotSource<S>,
  selector: (snapshot: S) => T,
  equal: (left: T, right: T) => boolean = shallowEqual,
) {
  const getSnapshot = useMemo(
    () => createSelectorSnapshot(state, selector, equal),
    [equal, selector, state],
  );
  return useSyncExternalStore(state.subscribe, getSnapshot, getSnapshot);
}

/**
 * 按业务包绑定一次，产出该包专用的客户端 hooks。
 * 特定 Node 私有 State 仍只能经 Owner 投影读取，此处只是只读订阅。
 */
export function defineClientHooks<AppState, ClientState, AppClient, ShellClient>(
  useServices: () => ClientHookServices<AppState, ClientState, AppClient, ShellClient>,
  options: ClientHookOptions<AppState>,
) {
  function useAppState<T>(selector: (state: AppState) => T) {
    const { applicationSnapshots } = useServices();
    return useStateSelector({
      read: applicationSnapshots.readState,
      subscribe: applicationSnapshots.subscribe,
    }, selector);
  }

  function useApplicationClient(): AppClient {
    return useServices().applicationClient;
  }

  function useApplicationRevision(): number {
    const { applicationSnapshots } = useServices();
    return useStateSelector(applicationSnapshots, (snapshot) => snapshot.revision);
  }

  function useShellClient(): ShellClient {
    return useServices().shell;
  }

  function useClientState<T>(selector: (state: ClientState) => T) {
    const { clientState } = useServices();
    return useStateSelector(clientState, selector);
  }

  function useWorkbenchContext<T>(
    token: WorkbenchContextToken<T>,
    binding: Omit<WorkbenchContextBinding, 'projectId'> = {},
  ) {
    const { workbenchContexts } = useServices();
    const projectId = useAppState(options.selectProjectId);
    const workspaceId = binding.workspaceId;
    const instanceId = binding.instanceId;
    const handle = useMemo(() => workbenchContexts.get(token, {
      projectId, workspaceId, instanceId,
    }), [instanceId, projectId, token, workbenchContexts, workspaceId]);
    return [
      useSyncExternalStore(handle.subscribe, handle.read, handle.read),
      handle.write,
    ] as const;
  }

  function useElementState<T>(
    runtime: ElementRuntimeHandle,
    stateId: string,
    binding: { workspaceId?: string } = {},
  ) {
    const workspaceId = binding.workspaceId;
    const projectId = useAppState(options.selectProjectId);
    const handle = useMemo(() => runtime.states.get<T>(stateId, { projectId, workspaceId }), [
      projectId, runtime, stateId, workspaceId,
    ]);
    return [
      useSyncExternalStore(handle.subscribe, handle.read, handle.read),
      handle.write,
    ] as const;
  }

  function useNodeState<T = any>(nodeId: string): T | undefined;
  function useNodeState<T, R>(nodeId: string, selector: (state: T) => R): R | undefined;
  function useNodeState<T = any, R = T>(
    nodeId: string,
    selector?: (state: T) => R,
  ): R | undefined {
    return useAppState((state) => {
      const nodeState = options.readPluginStates(state)?.[nodeId]?.state as T | undefined;
      if (nodeState === undefined) return undefined;
      return selector ? selector(nodeState) : (nodeState as unknown as R);
    });
  }

  return {
    useAppState,
    useApplicationClient,
    useApplicationRevision,
    useShellClient,
    useClientState,
    useWorkbenchContext,
    useElementState,
    useNodeState,
  };
}

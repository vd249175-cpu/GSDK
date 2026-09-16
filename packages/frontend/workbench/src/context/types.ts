declare const workbenchContextValue: unique symbol

export type WorkbenchContextScope = 'application' | 'project' | 'workspace' | 'instance'

export interface WorkbenchContextToken<T> {
  readonly id: string
  readonly scope: WorkbenchContextScope
  readonly initialValue: T
  readonly [workbenchContextValue]?: (value: T) => T
}

export interface WorkbenchContextBinding {
  projectId?: string | null
  workspaceId?: string
  instanceId?: string
}

export interface WorkbenchContextHandle<T> {
  read(): T
  write(value: T | ((current: T) => T)): void
  subscribe(listener: () => void): () => void
}

export interface WorkbenchContextAccessor {
  get<T>(token: WorkbenchContextToken<T>, binding?: WorkbenchContextBinding): WorkbenchContextHandle<T>
}

const contextIdPattern = /^[a-z][a-z0-9.-]*(\/[a-z][a-z0-9.-]*)+$/

export function defineWorkbenchContext<T>(
  id: string,
  options: { scope: WorkbenchContextScope; initialValue: T },
): WorkbenchContextToken<T> {
  if (!contextIdPattern.test(id)) throw new Error(`Workbench Context ID 无效: ${id}`)
  return Object.freeze({ id, scope: options.scope, initialValue: options.initialValue }) as WorkbenchContextToken<T>
}


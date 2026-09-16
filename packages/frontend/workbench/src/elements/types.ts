import type * as ReactRuntime from 'react'
import type { ComponentType } from 'react'
import type { EventListener, EventToken } from '../registry/eventRegistry'
import type { ServiceToken } from '../registry/serviceRegistry'
import type { WorkbenchContextAccessor } from '../context/types'

export type ElementStateScope = 'application' | 'project' | 'workspace' | 'instance'

export interface ElementStateDefinition<T = unknown> {
  id: string
  scope: ElementStateScope
  initialValue: T
}

export interface ElementStateBinding {
  projectId?: string | null
  workspaceId?: string
  instanceId?: string
}

export interface ElementStateHandle<T> {
  read(): T
  write(value: T | ((current: T) => T)): void
  subscribe(listener: () => void): () => void
}

export interface ElementRuntimeStateAccessor {
  get<T>(
    stateId: string,
    binding?: Pick<ElementStateBinding, 'projectId' | 'workspaceId'>,
  ): ElementStateHandle<T>
}

export interface ElementServiceAccessor {
  get<T>(token: ServiceToken<T>): T
  has<T>(token: ServiceToken<T>): boolean
}

export interface ElementServiceRegistration extends ElementServiceAccessor {
  provide<T>(token: ServiceToken<T>, provider: T): void
}

export interface ElementEventEmitter {
  emit<T>(event: EventToken<T>, payload: Readonly<T>): void
}

export interface ElementEventRegistration extends ElementEventEmitter {
  on<T>(event: EventToken<T>, listener: EventListener<T>): void
}

export interface ElementRuntimeHandle<T = unknown> {
  elementId: string
  instanceId: string
  value: T
  states: ElementRuntimeStateAccessor
  attach(viewId: string): void
  detach(viewId: string): void
}

export interface PanelProps {
  workspaceId: string
  areaId: string
  viewId: string
  instanceId: string
  runtime: ElementRuntimeHandle
}

export interface PanelIconProps {
  size?: number
  className?: string
}

export interface PanelDefinition {
  id: string
  title: string
  icon: ComponentType<PanelIconProps>
  component: ComponentType<PanelProps>
}

export interface ExtensionProps extends PanelProps {
  panelId: string
}

export interface ExtensionDefinition {
  id: string
  point: string
  component: ComponentType<ExtensionProps>
}

export interface ElementPackageManifest {
  id: string
  name: string
  apiVersion: 1
  entry: string
}

export interface ElementHostApi {
  getProjectId(): string | null
  executeCommand<T>(id: string, payload: T): void | Promise<void>
}

export interface ElementRuntimeContext {
  elementId: string
  instanceId: string
  host: ElementHostApi
  events: ElementEventEmitter
  services: ElementServiceAccessor
  states: ElementRuntimeStateAccessor
  contexts: WorkbenchContextAccessor
  onDispose(dispose: ElementDispose): void
}

export interface ElementRuntimeValue {
  dispose?(): void | Promise<void>
  [key: string]: unknown
}

export interface ElementRuntimeFactory {
  create(context: ElementRuntimeContext): ElementRuntimeValue | void
}

export interface ElementRegistrationContext<TApplication = unknown> {
  readonly manifest: ElementPackageManifest
  readonly react: typeof ReactRuntime
  readonly host: ElementHostApi
  readonly application?: TApplication
  events: ElementEventRegistration
  services: ElementServiceRegistration
  contexts: WorkbenchContextAccessor
  panels: { register(panel: PanelDefinition): void }
  extensions: { register(extension: ExtensionDefinition): void }
  commands: { register<T>(id: string, handler: (payload: T) => void | Promise<void>): void }
  states: { define<T>(state: ElementStateDefinition<T>): void }
  runtime: { define(factory: ElementRuntimeFactory): void }
  onDispose(dispose: ElementDispose): void
}

export type ElementDispose = () => void | Promise<void>

export interface ElementModule<TApplication = unknown> {
  register(context: ElementRegistrationContext<TApplication>): void | ElementDispose | Promise<void | ElementDispose>
}

export interface ElementCandidate {
  owner: string
  manifestText: string
  version: string
  load(manifest: ElementPackageManifest): Promise<ElementModule<any>> | ElementModule<any>
}

export function defineElement<TApplication = unknown>(module: ElementModule<TApplication>): ElementModule<TApplication> {
  return module
}

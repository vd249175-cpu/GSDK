import { createContext, useContext } from 'react'
import type { CommandRegistry } from '../commands/commandRegistry'
import type { PanelRegistry } from '../registry/panelRegistry'
import type { ExtensionRegistry } from '../registry/extensionRegistry'
import type { EventRegistry } from '../registry/eventRegistry'
import type { ServiceRegistry } from '../registry/serviceRegistry'
import type { ElementStateRegistry } from '../registry/stateRegistry'
import type { ElementRuntimeManager } from '../elements/runtimeManager'
import type { WorkbenchContextStore } from './workbenchContextStore'
import type { ClientWorkspaceState } from '../dock/workspaceTypes'

export interface WorkbenchServices {
  commands: CommandRegistry
  panels: PanelRegistry
  extensions: ExtensionRegistry
  elementEvents: EventRegistry
  elementServices: ServiceRegistry
  elementStates: ElementStateRegistry
  elementRuntimes: ElementRuntimeManager
  contexts: WorkbenchContextStore
}

export interface WorkbenchHostAdapter {
  services: WorkbenchServices
  useWorkspaceState<T>(selector: (state: ClientWorkspaceState) => T): T
}

export const WorkbenchHostContext = createContext<WorkbenchHostAdapter | null>(null)

export function useWorkbenchServices(): WorkbenchServices {
  const host = useContext(WorkbenchHostContext)
  if (!host) throw new Error('WorkbenchHostContext must be provided to render workbench components')
  return host.services
}

export function useWorkbenchWorkspace<T>(selector: (state: ClientWorkspaceState) => T): T {
  const host = useContext(WorkbenchHostContext)
  if (!host) throw new Error('WorkbenchHostContext must be provided to render workbench components')
  return host.useWorkspaceState(selector)
}

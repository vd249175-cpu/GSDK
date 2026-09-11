import './styles/index.css'

// Commands
export { CommandRegistry, type CommandHandler } from './commands/commandRegistry'

// Context
export { WorkbenchContextStore } from './context/workbenchContextStore'
export { defineWorkbenchContext } from './context/types'
export * from './context/WorkbenchHostContext'
export type {
  WorkbenchContextBinding, WorkbenchContextHandle, WorkbenchContextScope,
  WorkbenchContextToken,
} from './context/types'

// Dock
export { Workspace, type WorkspaceProps } from './dock/Workspace'
export { AreaShell } from './dock/AreaShell'
export * from './dock/workspaceTypes'
export * from './dock/layout'
export * from './dock/floatingWindow'
export * from './dock/splitResizeGesture'

// Elements
export { ElementLoader } from './elements/elementLoader'
export { ElementRuntimeManager } from './elements/runtimeManager'
export { ExtensionSlot } from './elements/ExtensionSlot'
export { parseElementManifest } from './elements/manifest'
export * from './elements/types'
export * from './elements/sourceCatalog'

// Plugins
export { PluginRuntimeManager, type PluginRuntimeManagerOptions } from './plugins/pluginManager'

// Registry
export { PanelRegistry } from './registry/panelRegistry'
export { ServiceRegistry, defineService, type ServiceToken, type ServiceProviderDefinition } from './registry/serviceRegistry'
export { EventRegistry, defineEvent, type EventToken, type EventListener, type EventListenerDefinition } from './registry/eventRegistry'
export { ElementStateRegistry } from './registry/stateRegistry'
export { ExtensionRegistry } from './registry/extensionRegistry'
export { OwnedRegistry } from './registry/ownedRegistry'

// UI
export { AudioPlayer } from './ui/AudioPlayer'
export { FloatingScrollbars } from './ui/FloatingScrollbars'
export { InlineSelect } from './ui/InlineSelect'
export { LargeTextEditorDialog, type LargeTextEditorDialogProps } from './ui/LargeTextEditorDialog'

// Workspaces
export * from './workspaces/layoutPreferences'
export * from './workspaces/manifest'
export { WorkspaceTabs } from './workspaces/WorkspaceTabs'
export { WorkspacePages } from './workspaces/WorkspacePages'
export {
  registerWorkspaceCommands, type WorkspaceCommandTarget,
} from './workspaces/workspaceCommands'

// Preferences
export * from './preferences/themePreferences'
export * from './preferences/typographyPreferences'

export interface SourceElementDescriptor {
  elementId: string
  manifestText: string
  version: string
  pluginId: string
}

export interface SourceWorkspaceDescriptor {
  workspaceId: string
  definitionText: string
  version: string
  pluginId: string
}

export interface ElementSourceCatalog {
  elements: SourceElementDescriptor[]
  workspaces: SourceWorkspaceDescriptor[]
  plugins: SourcePluginDescriptor[]
}

export interface SourcePluginDescriptor {
  pluginId: string
  version: string
  hasBackend: boolean
  elements: string[]
  workspaces: string[]
}

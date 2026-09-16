declare module 'virtual:graphvideo-application'
declare module 'virtual:graphvideo-config' {
  export const applicationDefinition: { id: string; name: string; defaultTheme?: string; defaultWorkspace?: string }
}
declare module 'virtual:graphvideo-elements' {
  export const elementModules: Record<string, () => Promise<{
    default?: import('@graphvideo/workbench').ElementModule
    register?: import('@graphvideo/workbench').ElementModule['register']
  }>>
}

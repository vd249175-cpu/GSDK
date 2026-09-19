declare module 'virtual:graphframework-application'
declare module 'virtual:graphframework-config' {
  export const applicationDefinition: { id: string; name: string; defaultTheme?: string; defaultWorkspace?: string }
}
declare module 'virtual:graphframework-elements' {
  export const elementModules: Record<string, () => Promise<{
    default?: import('@graphframework/workbench').ElementModule
    register?: import('@graphframework/workbench').ElementModule['register']
  }>>
}

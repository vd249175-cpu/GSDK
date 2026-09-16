export interface ApplicationPlugin {
  id: string
  directory: string
  manifest: { id: string; apiVersion: number; contributes?: { backend?: string; elements?: string[]; workspaces?: string[] } }
}
export interface DesktopApplication {
  definition: { id: string; name: string; defaultTheme?: string; defaultWorkspace?: string }
  applicationPath: string
  directory: string
  plugins: ApplicationPlugin[]
  runtimeRoot: string
  hostEntry: string
  rendererEntry: string
  rendererFile: string
}
export const runtimeRoot: string
export function loadApplication(file?: string): DesktopApplication

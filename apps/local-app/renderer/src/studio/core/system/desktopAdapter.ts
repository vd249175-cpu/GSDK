import type { ProjectNode } from '../project/types'
import type {
  LocalProjectSourceDto, ProjectVideoExportResultDto, RecentProjectDto,
  LocalPathRef,
} from '../../application/contract/domain'

export type LocalProjectSource = LocalProjectSourceDto

export type RecentLocalProject = RecentProjectDto
export type ProjectVideoExportResult = ProjectVideoExportResultDto

const getDesktop = () => (typeof window !== 'undefined' ? window.graphvideoDesktop : undefined)

export async function exportCurrentProjectVideos(nodeIds: string[]): Promise<ProjectVideoExportResult> {
  const desktop = getDesktop()
  if (!desktop) throw new Error('项目视频只能在 Electron 桌面模式中导出')
  const result = await desktop.project.exportCurrentVideos(nodeIds)
  if (result.error) throw new Error(result.error)
  return {
    canceled: result.canceled,
    directory: result.directory,
    exported: result.exported ?? [],
    skipped: result.skipped ?? [],
  }
}

export function listRecentLocalProjects(): Promise<RecentLocalProject[]> {
  return getDesktop()?.project?.listRecent?.() ?? Promise.resolve([])
}

export function onExternalProjectUpdate(listener: (project: LocalProjectSource) => void) {
  return getDesktop()?.project?.onExternalUpdate?.(listener) ?? (() => undefined)
}

export function onExternalProjectMarkdownUpdate(listener: (markdown: string) => void) {
  return getDesktop()?.project?.onExternalMarkdownUpdate?.(listener) ?? (() => undefined)
}

export async function openLocalProjectSource(projectPath?: string): Promise<LocalProjectSource | null> {
  const desktop = getDesktop()
  if (!desktop) throw new Error('本地项目只能在 Electron 桌面模式中打开')
  const result = await desktop.project.openLocal(projectPath)
  if (result.error) throw new Error(result.error)
  return result.project ?? null
}

export async function restoreLastLocalProject(): Promise<LocalProjectSource | null> {
  const desktop = getDesktop()
  if (!desktop) return null
  const result = await desktop.project.restoreLast()
  if (result.error) throw new Error(result.error)
  return result.project ?? null
}

export interface ProjectPersistenceAdapter {
  openLocalProject(): Promise<LocalProjectSource | null>
  importNodeVersion(nodeId: string, source?: LocalPathRef): Promise<ProjectNode | null>
  promoteNodeVersion(nodeId: string, versionId: string): Promise<ProjectNode>
}

export class DesktopAdapter implements ProjectPersistenceAdapter {
  async openLocalProject(projectPath?: string): Promise<LocalProjectSource | null> {
    return openLocalProjectSource(projectPath)
  }

  async listRecentProjects(): Promise<RecentLocalProject[]> {
    return listRecentLocalProjects()
  }

  async restoreLastProject(): Promise<LocalProjectSource | null> {
    return restoreLastLocalProject()
  }

  async importNodeVersion(nodeId: string, source?: LocalPathRef) {
    const desktop = getDesktop()
    if (!desktop) throw new Error('本地文件只能在 Electron 桌面模式中导入')
    const result = await desktop.project.importNodeVersion(nodeId, source)
    if (result.error) throw new Error(result.error)
    return result.node ?? null
  }

  async promoteNodeVersion(nodeId: string, versionId: string) {
    const desktop = getDesktop()
    if (!desktop) throw new Error('本地版本只能在 Electron 桌面模式中切换')
    return desktop.project.promoteNodeVersion(nodeId, versionId)
  }
}

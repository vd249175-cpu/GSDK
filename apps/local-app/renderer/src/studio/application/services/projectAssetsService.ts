import type { ProjectVideoExportResultDto } from '../contract/domain'

export interface ProjectVersionClipboardItem {
  nodeId: string
  versionId: string
}

export interface ProjectVersionClipboardResult {
  count: number
  mode: 'files' | 'paths'
}

export interface ProjectAssetsService {
  url(nodeId: string, versionId: string): string
  copyVersionFiles(items: ProjectVersionClipboardItem[]): Promise<ProjectVersionClipboardResult>
  exportCurrentVideos(nodeIds: string[]): Promise<ProjectVideoExportResultDto>
}

export interface DesktopProjectAssetsAdapter {
  assetUrl(nodeId: string, versionId: string): string
  copyVersionFiles(items: ProjectVersionClipboardItem[]): Promise<ProjectVersionClipboardResult>
  exportCurrentVideos(nodeIds: string[]): Promise<{
    canceled: boolean
    error?: string
    directory?: string
    exported?: ProjectVideoExportResultDto['exported']
    skipped?: ProjectVideoExportResultDto['skipped']
  }>
}

/** Stable application infrastructure. It is available before any optional Element is loaded. */
export function createProjectAssetsService(
  adapter: DesktopProjectAssetsAdapter | undefined,
): ProjectAssetsService {
  const requireAdapter = () => {
    if (!adapter) throw new Error('本地媒体资源只能在 Electron 桌面模式中访问')
    return adapter
  }

  return {
    url(nodeId, versionId) {
      return requireAdapter().assetUrl(nodeId, versionId)
    },
    copyVersionFiles(items) {
      return requireAdapter().copyVersionFiles(items)
    },
    async exportCurrentVideos(nodeIds) {
      const result = await requireAdapter().exportCurrentVideos(nodeIds)
      if (result.error) throw new Error(result.error)
      return {
        canceled: result.canceled,
        directory: result.directory,
        exported: result.exported ?? [],
        skipped: result.skipped ?? [],
      }
    },
  }
}

import type { StudioPluginManifest } from '@graphvideo/backend-sdk'
import type { WorkbenchContextStore } from '../context/workbenchContextStore'
import type { ElementLoader } from '../elements/elementLoader'

export interface PluginRuntimeManagerOptions {
  contextStore: WorkbenchContextStore
  elementLoader: ElementLoader
}

/** Renderer lifecycle only. Backend plugins are composed once in Electron main and require restart. */
export class PluginRuntimeManager {
  constructor(private readonly options: PluginRuntimeManagerOptions) {}

  async uninstall(
    manifest: StudioPluginManifest | {
      id: string
      contributes?: {
        backend?: string
        elements?: readonly string[]
        workspaces?: readonly string[]
      }
    },
  ): Promise<void> {
    // 1. 通过 ElementLoader 完整卸载前端 Elements（面板、命令、服务、事件、Runtime、状态）
    if (manifest.contributes?.elements) {
      for (const elementId of manifest.contributes.elements) {
        await this.options.elementLoader.unload(elementId)
      }
    }

    // 2. 深度清理 Manifest 显式贡献的所有 Context 命名空间
    this.options.contextStore.disposePluginContexts(manifest)
  }
}

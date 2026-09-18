import type { LocalPathRef } from '../../application/contract/domain'

export interface DesktopShellClient {
  readonly platform: string
  clipboard: {
    readText(): Promise<string>
    writeText(value: string): Promise<void>
  }
  files: {
    resolveDroppedPaths(files: File[]): LocalPathRef[]
  }
  window: {
    minimize(): void
    reload(): void
    toggleMaximize(): void
    close(): void
  }
}

export const desktopShell: DesktopShellClient = {
  platform: typeof window !== 'undefined' ? window.graphvideoDesktop?.platform ?? 'unknown' : 'node',
  clipboard: {
    readText: () => {
      if (typeof window !== 'undefined' && window.graphvideoDesktop?.agent.readClipboardText) {
        return window.graphvideoDesktop.agent.readClipboardText()
      }
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        return navigator.clipboard.readText()
      }
      return Promise.reject(new Error('系统剪贴板不可用'))
    },
    writeText: async (value: string) => {
      if (typeof window !== 'undefined' && window.graphvideoDesktop?.agent?.writeClipboardText) {
        await window.graphvideoDesktop.agent.writeClipboardText(value)
        return
      }
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(value)
        return
      }
      throw new Error('系统剪贴板不可用')
    },
  },
  files: {
    resolveDroppedPaths: (files) => {
      if (typeof window !== 'undefined' && window.graphvideoDesktop?.agent.resolveDroppedFilePaths) {
        return window.graphvideoDesktop.agent.resolveDroppedFilePaths(files).map((path) => ({ kind: 'local-path' as const, path }))
      }
      return []
    },
  },
  window: {
    minimize: () => (typeof window !== 'undefined' ? window.graphvideoDesktop?.windowControls.minimize() : undefined),
    reload: () => (typeof window !== 'undefined' ? window.graphvideoDesktop?.windowControls.reload() : undefined),
    toggleMaximize: () => (typeof window !== 'undefined' ? window.graphvideoDesktop?.windowControls.toggleMaximize() : undefined),
    close: () => (typeof window !== 'undefined' ? window.graphvideoDesktop?.windowControls.close() : undefined),
  },
}

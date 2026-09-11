interface Window {
  graphvideoDesktop?: {
    platform: string
    versions: {
      electron: string
      chrome: string
    }
    windowControls: {
      minimize(): void
      reload(): void
      toggleMaximize(): void
      close(): void
    }
    graphKernel?: {
      request<K extends keyof import('../../kernel/src').GraphSyscallRequestMap>(
        method: K,
        input: import('../../kernel/src').GraphSyscallRequestMap[K]['input'],
      ): Promise<import('../../kernel/src').GraphSyscallRequestMap[K]['output']>
      subscribe<K extends keyof import('../../kernel/src').GraphSyscallEventMap>(
        event: K,
        listener: (
          payload: import('../../kernel/src').GraphSyscallEventMap[K]
        ) => void,
      ): () => void
    }
    project: {
      openLocal(projectPath?: string): Promise<{
        canceled: boolean
        error?: string
        project?: {
          name: string
          path: string
          markdown: string
          nodes: import('./core/project/types').ProjectNode[]
          retainedNodes: import('./core/project/types').ProjectNode[]
        }
      }>
      listRecent(): Promise<Array<{
        name: string
        path: string
        openedAt: number
      }>>
      listSnapshots(): Promise<import('./application/contract/domain').ProjectSnapshotGraphDto>
      createSnapshot(label?: string): Promise<import('./application/contract/domain').ProjectSnapshotGraphDto>
      branchFromSnapshot(snapshotId: string, branchName: string): Promise<{
        graph: import('./application/contract/domain').ProjectSnapshotGraphDto
        project: import('./application/contract/domain').LocalProjectSourceDto
      }>
      restoreLast(): Promise<{
        canceled: boolean
        error?: string
        project?: {
          name: string
          path: string
          markdown: string
          nodes: import('./core/project/types').ProjectNode[]
          retainedNodes: import('./core/project/types').ProjectNode[]
        }
      }>
      importNodeVersion(
        nodeId: string,
        source?: import('./application/contract/domain').LocalPathRef,
      ): Promise<{
        canceled: boolean
        error?: string
        node?: import('./core/project/types').ProjectNode
      }>
      promoteNodeVersion(
        nodeId: string,
        versionId: string,
      ): Promise<import('./core/project/types').ProjectNode>
      exportCurrentVideos(nodeIds: string[]): Promise<{
        canceled: boolean
        error?: string
        directory?: string
        exported?: Array<{ nodeId: string; fileName: string; destinationPath: string }>
        skipped?: Array<{ nodeId: string; title: string; reason: string }>
      }>
      copyVersionFiles(items: Array<{ nodeId: string; versionId: string }>): Promise<{
        count: number
        mode: 'files' | 'paths'
      }>
      onExternalUpdate(callback: (project: {
        name: string
        path: string
        markdown: string
        nodes: import('./core/project/types').ProjectNode[]
        retainedNodes: import('./core/project/types').ProjectNode[]
        selectedNodeId: string | null
      }) => void): () => void
      onExternalMarkdownUpdate(callback: (markdown: string) => void): () => void
      assetUrl(nodeId: string, versionId: string): string
    }
    agent: {
      readClipboardText(): Promise<string>
      writeClipboardText(value: string): Promise<boolean>
      resolveDroppedFilePaths(files: File[]): string[]
      discover(): Promise<import('./application/contract/domain').AgentTemplateDto[]>
      launchNativeTerminal(
        templateId: string,
        agentId: string,
      ): Promise<import('./application/contract/domain').AgentTerminalLaunchDto>
      openDirectory(templateId: string, agentId: string): Promise<void>
    }
    generationModels: {
      list(): Promise<{
        models: import('../shared/generation-model.mjs').GenerationModelManifest[]
        issues: string[]
      }>
      evaluateDag(projectRoot?: string): Promise<import('./application/contract/domain').GenerationDagItem[]>
      prepareBatch(
        items: import('./application/contract/domain').GenerationBatchItemInput[],
        options?: { audioUrl?: string; maxGenerationWaitMs?: number },
      ): Promise<{
        batchId: string
        info: Pick<import('./protocol').GenerationBatchRequestedInfo, 'type' | 'batchId'>
      }>
      resolve(input: import('./application/contract/domain').GenerationModelResolveInput): Promise<
        import('./application/contract/domain').ResolvedGenerationPrompt
      >
      buildRequest(input: import('./application/contract/domain').GenerationModelResolveInput): Promise<unknown>
      import(): Promise<{
        canceled: boolean
        error?: string
        model?: import('../shared/generation-model.mjs').GenerationModelManifest
      }>
      delete(modelId: string): Promise<void>
    }
    promptLibrary: {
      list(): Promise<import('./application/contract/domain').PromptLibraryEntryDto[]>
      read(relativePath: string): Promise<string>
      save(relativePath: string, content: string): Promise<void>
      create(relativePath: string, content: string): Promise<void>
      createDirectory(relativePath: string): Promise<void>
      rename(sourcePath: string, targetPath: string): Promise<void>
      delete(relativePath: string): Promise<void>
    }
    elements: {
      list(): Promise<import('@graphvideo/workbench').ElementSourceCatalog>
      refresh(): Promise<import('@graphvideo/workbench').ElementSourceCatalog>
    }
    audioStudio: {
      dispatch(options: {
        url: string
        method?: string
        headers?: Record<string, string>
        body?: unknown
      }): Promise<Response>
    }
    styleProbe?: {
      listTargets(): Promise<Array<{
        fileName: string
        title: string
        updatedAt: number
        size: number
      }>>
      readTarget(fileName: string): Promise<string>
      saveTarget(fileName: string, content: string): Promise<void>
      createTarget(fileName?: string, title?: string): Promise<{ fileName: string; title: string }>
      deleteTarget(fileName: string): Promise<void>
      importMedia(sourceFilePath?: string, prefix?: string): Promise<{ canceled: boolean; relativePath?: string }>
      mediaUrl(relativePath: string): string
    }
    os: {
      launchApp(): Promise<void>
      stopApp(): Promise<void>
    }
  }
}

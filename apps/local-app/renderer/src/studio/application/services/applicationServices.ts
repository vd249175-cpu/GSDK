import type { GenerationModelManifest } from '../../../shared/generation-model.mjs'
import type {
  AgentTemplateDto,
  AgentTerminalLaunchDto,
  GenerationDagItem,
  GenerationBatchItemInput,
  GenerationModelResolveInput,
  LocalProjectSourceDto,
  ProjectSnapshotGraphDto,
  PromptLibraryEntryDto,
  RecentProjectDto,
  ResolvedGenerationPrompt,
} from '../contract/domain'
import type { GenerationBatchRequestedInfo } from '../../../../../src-main/studio/protocol'
import type { ApplicationEventMap } from '../contract/application'
import type { ProjectAssetsService } from './projectAssetsService'

export interface LocalProjectsService {
  listRecent(): Promise<RecentProjectDto[]>
  open(projectPath?: string): Promise<LocalProjectSourceDto | null>
}

export interface ProjectSnapshotsService {
  list(): Promise<ProjectSnapshotGraphDto>
  create(label?: string): Promise<ProjectSnapshotGraphDto>
  branch(snapshotId: string, branchName: string): Promise<{
    graph: ProjectSnapshotGraphDto
    project: LocalProjectSourceDto
  }>
}

export interface GenerationModelsService {
  list(): Promise<{ models: GenerationModelManifest[]; issues: string[] }>
  evaluateDag(projectRoot?: string): Promise<GenerationDagItem[]>
  prepareBatch(
    items: GenerationBatchItemInput[],
    options?: { audioUrl?: string; maxGenerationWaitMs?: number },
  ): Promise<{ batchId: string; info: Pick<GenerationBatchRequestedInfo, 'type' | 'batchId'> }>
  resolve(input: GenerationModelResolveInput): Promise<ResolvedGenerationPrompt>
  buildRequest(input: GenerationModelResolveInput): Promise<unknown>
  import(): Promise<{ canceled: boolean; model?: GenerationModelManifest }>
  delete(modelId: string): Promise<void>
}

export interface PromptLibraryService {
  list(): Promise<PromptLibraryEntryDto[]>
  read(relativePath: string): Promise<string>
  save(relativePath: string, content: string): Promise<void>
  create(relativePath: string, content: string): Promise<void>
  createDirectory(relativePath: string): Promise<void>
  rename(sourcePath: string, targetPath: string): Promise<void>
  delete(relativePath: string): Promise<void>
}

export interface AgentHostService {
  discover(): Promise<AgentTemplateDto[]>
  launchTerminal(templateId: string, agentId: string): Promise<AgentTerminalLaunchDto>
  openDirectory(templateId: string, agentId: string): Promise<void>
}

export interface ApplicationServices {
  localProjects: LocalProjectsService
  projectSnapshots: ProjectSnapshotsService
  projectAssets: ProjectAssetsService
  generationModels: GenerationModelsService
  promptLibrary: PromptLibraryService
  agentHost: AgentHostService
}

type DesktopBridge = Window['graphvideoDesktop']
type CatalogChanged = ApplicationEventMap['generation-models.catalog-changed']

export function createDesktopApplicationServices(
  desktop: DesktopBridge,
  projectAssets: ProjectAssetsService,
  catalogChanged: (payload: CatalogChanged) => void,
): ApplicationServices {
  const requireDesktop = () => {
    if (!desktop) throw new Error('该能力只能在 Electron 桌面模式中使用')
    return desktop
  }

  return {
    projectAssets,
    localProjects: {
      async listRecent() {
        return requireDesktop().project.listRecent()
      },
      async open(projectPath) {
        const result = await requireDesktop().project.openLocal(projectPath)
        if (result.error) throw new Error(result.error)
        return result.project ?? null
      },
    },
    projectSnapshots: {
      async list() {
        return requireDesktop().project.listSnapshots()
      },
      async create(label) {
        return requireDesktop().project.createSnapshot(label)
      },
      async branch(snapshotId, branchName) {
        return requireDesktop().project.branchFromSnapshot(snapshotId, branchName)
      },
    },
    generationModels: {
      async list() {
        return requireDesktop().generationModels.list()
      },
      async evaluateDag(projectRoot) {
        return requireDesktop().generationModels.evaluateDag(projectRoot)
      },
      async prepareBatch(items, options) {
        return requireDesktop().generationModels.prepareBatch(items, options)
      },
      async resolve(input) {
        return requireDesktop().generationModels.resolve(input)
      },
      async buildRequest(input) {
        return requireDesktop().generationModels.buildRequest(input)
      },
      async import() {
        const result = await requireDesktop().generationModels.import()
        if (result.error) throw new Error(result.error)
        if (!result.canceled && result.model) {
          catalogChanged({ reason: 'import', modelId: result.model.id })
        }
        return { canceled: result.canceled, model: result.model }
      },
      async delete(modelId) {
        await requireDesktop().generationModels.delete(modelId)
        catalogChanged({ reason: 'delete', modelId })
      },
    },
    promptLibrary: {
      async list() {
        return requireDesktop().promptLibrary.list()
      },
      async read(path) {
        return requireDesktop().promptLibrary.read(path)
      },
      async save(path, content) {
        return requireDesktop().promptLibrary.save(path, content)
      },
      async create(path, content) {
        return requireDesktop().promptLibrary.create(path, content)
      },
      async createDirectory(path) {
        return requireDesktop().promptLibrary.createDirectory(path)
      },
      async rename(sourcePath, targetPath) {
        return requireDesktop().promptLibrary.rename(sourcePath, targetPath)
      },
      async delete(path) {
        return requireDesktop().promptLibrary.delete(path)
      },
    },
    agentHost: {
      async discover() {
        return requireDesktop().agent.discover()
      },
      async launchTerminal(templateId, agentId) {
        return requireDesktop().agent.launchNativeTerminal(templateId, agentId)
      },
      async openDirectory(templateId, agentId) {
        return requireDesktop().agent.openDirectory(templateId, agentId)
      },
    },
  }
}

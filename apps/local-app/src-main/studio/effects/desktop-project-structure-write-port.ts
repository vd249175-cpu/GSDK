import type { EffectContext } from '@graphvideo/kernel';
import type {
  ProjectStructurePersistObservation,
  ProjectStructurePersistRequest,
  ProjectStructureWritePort,
} from './project-structure-adapter';

export class DesktopProjectStructureWritePort implements ProjectStructureWritePort {
  readonly id = 'electron/project-structure-ipc';

  async write(request: ProjectStructurePersistRequest, context: EffectContext): Promise<ProjectStructurePersistObservation> {
    const project = typeof window === 'undefined' ? undefined : (window as any).graphvideoDesktop?.project;
    if (!project) throw new Error('Project Structure 写入需要 Electron project bridge');
    const result = await project.persistStructure({
      markdown: request.markdown,
      nodes: request.nodes,
      retainedNodes: request.retainedNodes,
      mode: request.mode,
    });
    context.recordRawSummary?.({
      kind: 'electron-project-structure',
      text: `mode=${request.mode};nodes=${request.nodes.length};savedAt=${result.savedAt}`,
      redacted: false,
    });
    return {
      nodes: result.nodes ?? request.nodes,
      retainedNodes: result.retainedNodes ?? request.retainedNodes,
      savedAt: result.savedAt ?? Date.now(),
      contentRef: `project-structure:${result.savedAt ?? Date.now()}`,
    };
  }
}

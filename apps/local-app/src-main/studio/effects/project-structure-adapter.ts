import type { EffectAdapter, EffectContext } from '@graphvideo/kernel';
import type { ProjectNode } from '../domain/types';

export type ProjectStructurePersistMode = 'full' | 'structure' | 'order';

export interface ProjectStructurePersistRequest {
  readonly taskId?: string;
  readonly markdown: string;
  readonly nodes: readonly ProjectNode[];
  readonly retainedNodes: readonly ProjectNode[];
  readonly mode: ProjectStructurePersistMode;
}

export interface ProjectStructurePersistObservation {
  readonly nodes: readonly ProjectNode[];
  readonly retainedNodes: readonly ProjectNode[];
  readonly savedAt: number;
  readonly contentRef: string;
}

export interface ProjectStructureWritePort {
  readonly id: string;
  write(
    request: ProjectStructurePersistRequest,
    context: EffectContext,
  ): Promise<ProjectStructurePersistObservation>;
}

export const projectStructureAdapterId = 'graphvideo/project-structure-v1';

export class ProjectStructureAdapter implements EffectAdapter<
  ProjectStructurePersistRequest,
  ProjectStructurePersistObservation
> {
  readonly id = projectStructureAdapterId;

  constructor(private readonly port: ProjectStructureWritePort) {}

  async execute(request: ProjectStructurePersistRequest, context: EffectContext) {
    if (typeof request.markdown !== 'string') throw new Error('Project Structure Request 缺少 markdown');
    if (!Array.isArray(request.nodes) || !Array.isArray(request.retainedNodes)) {
      throw new Error('Project Structure Request nodes/retainedNodes 非数组');
    }
    const ids = new Set<string>();
    for (const node of [...request.nodes, ...request.retainedNodes]) {
      if (!node || typeof node.id !== 'string' || !node.id.trim()) {
        throw new Error('Project Structure Request Node 缺少 id');
      }
      if (ids.has(node.id)) throw new Error(`Project Structure Request Node id 重复: ${node.id}`);
      ids.add(node.id);
    }
    context.signal?.throwIfAborted();
    context.recordTransport?.({
      portId: this.port.id,
      transaction: `project-structure/${request.mode}`,
      nodeCount: request.nodes.length,
      retainedNodeCount: request.retainedNodes.length,
    });
    const observation = await this.port.write(request, context);
    if (!Number.isFinite(observation.savedAt) || !observation.contentRef.trim()) {
      throw new Error('Project Structure Observation 不完整');
    }
    return observation;
  }
}

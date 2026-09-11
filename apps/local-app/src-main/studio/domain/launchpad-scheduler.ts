import type { NodeType } from './types';
import { systemClock, type Clock } from '@graphvideo/kernel';
import { orderedGenerationReferenceIds } from '../../shared/generation-reference-order.mjs';

export interface ParsedModelHeader {
  hasHeader: boolean;
  modelId?: string;
  params: Record<string, any>;
  body: string;
}

export interface LaunchpadItem {
  id: string;
  type: NodeType;
  title: string;
  prompt: string;
  hasHeader: boolean;
  modelId?: string;
  dispatchMode: 'model' | 'manual-web';
  headerParams: Record<string, any>;
  layer: number;               // 依赖拓扑层级 (0: 无前置依赖, 1: 依赖层级0, 2: 依赖层级1...)
  dependencies: string[];      // 依赖的前置节点 ID 列表
  missingDependencies: string[]; // 尚未生成就绪的前置依赖 ID 列表
  areDependenciesReady: boolean; // 前置依赖是否全部已生成完成
  isReady: boolean;              // 提示词、模型、参数与依赖是否全部通过准入
  estimatedCredits: number;
  status: 'pending' | 'manual_waiting' | 'ready' | 'running' | 'completed' | 'error';
  statusMessage?: string;
  resultUrl?: string;
  updatedAt: number;
}

export type ExecutionMode = 'auto' | 'layer' | 'manual';

/**
 * 发射台依赖编排与层级计算引擎 (LaunchpadScheduler)
 */
export class LaunchpadScheduler {
  /**
   * 提取提示词中的 YAML 头部元数据与 Model ID
   */
  public static extractModelHeader(rawText: string): ParsedModelHeader {
    const trimmed = rawText.trim();
    if (!trimmed.startsWith('---')) {
      return { hasHeader: false, params: {}, body: trimmed };
    }
    const endIdx = trimmed.indexOf('---', 3);
    if (endIdx === -1) {
      return { hasHeader: false, params: {}, body: trimmed };
    }
    const headerStr = trimmed.slice(3, endIdx).trim();
    const body = trimmed.slice(endIdx + 3).trim();
    
    // 解析 YAML 头部键值对
    const params: Record<string, any> = {};
    const lines = headerStr.split('\n');
    for (const line of lines) {
      const match = line.match(/^\s*([a-zA-Z0-9_-]+)\s*:\s*(.*)$/);
      if (match) {
        const key = match[1].trim();
        let val = match[2].trim();
        // 去除可能的引号
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (val === 'true') params[key] = true;
        else if (val === 'false') params[key] = false;
        else if (!isNaN(Number(val)) && val !== '') params[key] = Number(val);
        else params[key] = val;
      }
    }

    const modelId = typeof params.model === 'string' ? params.model.trim() : undefined;

    return {
      hasHeader: Boolean(modelId || params.task),
      modelId,
      params,
      body,
    };
  }

  /**
   * 计算节点在整个项目中的依赖关系与拓扑层级 (DAG Layering)
   * 支持两种并行的依赖源：
   * 1. 结构树 DAG 依赖 (大纲树中父节点自动依赖其嵌套的所有子孙媒体节点)
   * 2. 显式 Prompt / YAML 依赖 (正文 ID/别名引用、voiceReference、referenceImages 等)
   */
  public static buildLaunchpadItems(
    nodes: Record<string, { id: string; type: NodeType; title: string; prompt?: string; content?: string; history?: any[]; estimatedCredits?: number }>,
    tree?: import('../core/project/types').ProjectTreeItem[],
    clock: Clock = systemClock,
    modelManifests?: Record<string, any>,
  ): LaunchpadItem[] {
    const allNodeIds = new Set(Object.keys(nodes));
    const itemsMap = new Map<string, LaunchpadItem>();

    // 建立 title + type -> nodeId 的快速查找映射表
    const titleTypeToId = new Map<string, string>();
    for (const [nid, n] of Object.entries(nodes)) {
      titleTypeToId.set(`${n.type}:${n.title}`, nid);
      titleTypeToId.set(n.title, nid);
    }

    const resolveItemNodeId = (item: import('../core/project/types').ProjectTreeItem): string | undefined => {
      if (item.nodeId && nodes[item.nodeId]) return item.nodeId;
      if (item.nodeId?.startsWith('auto:')) {
        const parts = item.nodeId.split(':');
        if (parts.length >= 3) {
          const symbol = parts[1];
          const title = parts.slice(2).join(':');
          const type = symbol === '$' ? 'text' : symbol === '@' ? 'image' : symbol === '%' ? 'video' : symbol === '~' ? 'audio' : symbol === '&' ? 'style' : undefined;
          if (type && titleTypeToId.has(`${type}:${title}`)) {
            return titleTypeToId.get(`${type}:${title}`);
          }
          if (titleTypeToId.has(title)) {
            return titleTypeToId.get(title);
          }
        }
      }
      if (item.nodeType && titleTypeToId.has(`${item.nodeType}:${item.title}`)) {
        return titleTypeToId.get(`${item.nodeType}:${item.title}`);
      }
      return titleTypeToId.get(item.title) ?? (item.nodeId && allNodeIds.has(item.nodeId) ? item.nodeId : undefined);
    };

    // 1. 从项目大纲树 (project.tree) 提取父子 DAG 生成依赖
    const treeDepsMap = new Map<string, Set<string>>();

    if (tree && Array.isArray(tree)) {
      const walkTree = (items: import('../core/project/types').ProjectTreeItem[], parentMediaId?: string) => {
        for (const item of items) {
          const realNodeId = resolveItemNodeId(item);

          // 收集当前子树中所有的媒体子节点真实 ID (图像/视频/音频)
          const collectMediaDescendants = (children: import('../core/project/types').ProjectTreeItem[]): string[] => {
            const result: string[] = [];
            for (const child of children) {
              const childRealId = resolveItemNodeId(child);
              if (childRealId) {
                const childNode = nodes[childRealId];
                if (childNode && childNode.type !== 'text' && childNode.type !== 'style') {
                  result.push(childRealId);
                }
              }
              if (child.children && child.children.length > 0) {
                result.push(...collectMediaDescendants(child.children));
              }
            }
            return result;
          };

          if (realNodeId) {
            const deps = treeDepsMap.get(realNodeId) || new Set<string>();

            // 如果当前项处于父级媒体节点下，当前项自动作为父级媒体节点的生成依赖
            if (parentMediaId && parentMediaId !== realNodeId) {
              const parentDeps = treeDepsMap.get(parentMediaId) || new Set<string>();
              parentDeps.add(realNodeId);
              treeDepsMap.set(parentMediaId, parentDeps);
            }

            // 如果当前项自身包含子条目，子孙媒体节点自动作为当前节点的依赖
            if (item.children && Array.isArray(item.children)) {
              const childMediaIds = collectMediaDescendants(item.children);
              for (const cid of childMediaIds) {
                if (cid !== realNodeId) {
                  deps.add(cid);
                }
              }
            }
            treeDepsMap.set(realNodeId, deps);
          }

          const childNode = realNodeId ? nodes[realNodeId] : undefined;
          const isMedia = childNode && childNode.type !== 'text' && childNode.type !== 'style';
          const nextParentMediaId = isMedia ? realNodeId : parentMediaId;

          if (item.children && item.children.length > 0) {
            walkTree(item.children, nextParentMediaId);
          }
        }
      };
      walkTree(tree);
    }

    // 2. 初始化每个媒体节点的基础信息
    for (const [id, node] of Object.entries(nodes)) {
      if (node.type === 'text' || node.type === 'style') continue; // 纯文本/风格作为被依赖项，不作为发射台发射主体

      const rawPrompt = (node.prompt || '').trim();
      const { hasHeader, modelId, params, body } = this.extractModelHeader(rawPrompt);

      const dependencies = orderedGenerationReferenceIds({
        prompt: rawPrompt,
        nodes: Object.values(nodes),
        targetNodeId: id,
        structuralIds: [...(treeDepsMap.get(id) || [])],
      });

      // 计算真实预估积分 (优先消费节点本身算力或模型 Manifest 报价)
      const manifestCredits = modelId
        ? modelManifests?.[modelId]?.pricing?.defaultCredits
        : undefined;
      const estimatedCredits = typeof (node as any).estimatedCredits === 'number'
        ? (node as any).estimatedCredits
        : typeof manifestCredits === 'number'
          ? manifestCredits
          : node.type === 'audio' ? 0 : node.type === 'video' ? 20 : 10;

      const hasCompletedVersion = Boolean(node.history && node.history.some((h: any) => h.current));

      itemsMap.set(id, {
        id,
        type: node.type,
        title: node.title || id,
        prompt: body,
        hasHeader,
        modelId,
        dispatchMode: modelId ? 'model' : 'manual-web',
        headerParams: params,
        layer: 0,
        dependencies,
        missingDependencies: [],
        areDependenciesReady: true,
        isReady: false,
        estimatedCredits,
        status: hasCompletedVersion ? 'completed' : 'pending',
        updatedAt: clock.now(),
      });
    }

    // 3. 拓扑排序计算依赖层级 (Layer Rank)
    const computeLayer = (itemId: string, visited: Set<string>): number => {
      if (visited.has(itemId)) return 0; // 避免循环依赖爆栈
      visited.add(itemId);

      const item = itemsMap.get(itemId);
      if (!item || item.dependencies.length === 0) return 0;

      let maxDepLayer = 0;
      for (const depId of item.dependencies) {
        const depLayer = computeLayer(depId, new Set(visited));
        if (depLayer + 1 > maxDepLayer) {
          maxDepLayer = depLayer + 1;
        }
      }
      return maxDepLayer;
    };

    for (const item of itemsMap.values()) {
      item.layer = computeLayer(item.id, new Set());

      // 计算前置依赖是否全部已产出当前版本，或文本/风格内容已经就绪
      const missing: string[] = [];
      for (const depId of item.dependencies) {
        const depNode = nodes[depId];
        const isDepCompleted = Boolean(
          depNode && (
            depNode.type === 'text' || depNode.type === 'style'
              ? Boolean(((depNode.content ?? (depNode as any).prompt) || '').trim())
              : depNode.history && depNode.history.some((h: any) => h.current)
          )
        );
        if (!isDepCompleted) {
          missing.push(depId);
        }
      }
      item.missingDependencies = missing;
      item.areDependenciesReady = missing.length === 0;
      item.isReady = Boolean(item.dispatchMode === 'model' && item.prompt.trim() && item.areDependenciesReady);

      if (item.status !== 'completed') {
        if (item.dispatchMode === 'manual-web') {
          item.status = 'manual_waiting';
          item.statusMessage = !item.prompt.trim()
            ? '手动网页生成：请先填写提示词正文'
            : !item.areDependenciesReady
              ? `手动网页生成：等待前置素材 (${missing.map(d => nodes[d]?.title || d).join(', ')})`
              : '手动网页生成：可复制提示词与依赖';
        } else if (!item.prompt.trim()) {
          item.status = 'pending';
          item.statusMessage = '生成提示词正文不能为空';
        } else if (!item.areDependenciesReady) {
          item.status = 'pending';
          item.statusMessage = `前置依赖未就绪 (${missing.map(d => nodes[d]?.title || d).join(', ')})`;
        } else {
          item.status = 'ready';
          item.statusMessage = '等待模型参数预检';
        }
      }
    }

    return Array.from(itemsMap.values());
  }
}

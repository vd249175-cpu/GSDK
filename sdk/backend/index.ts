import type { Info, Node } from '@graphvideo/kernel'

export type AnyNode = Node<any, any>

/** Creates exactly one ordinary Node and never creates or owns a Runtime. */
export type NodeFactory<Input = void, Output extends AnyNode = AnyNode> = (input: Input) => Output

/** Creates a flat batch of ordinary Nodes and never creates or owns a Runtime. */
export type GraphFactory<Input = void, Output extends AnyNode = AnyNode> = (
  input: Input,
) => readonly Output[]

export function defineNodeFactory<Input, Output extends AnyNode>(
  factory: NodeFactory<Input, Output>,
): NodeFactory<Input, Output> {
  return (input) => {
    const node = factory(input)
    if (!node.id) throw new Error('NodeFactory 必须产出具有非空 id 的 Node')
    return node
  }
}

export function defineGraphFactory<Input, Output extends AnyNode>(
  factory: GraphFactory<Input, Output>,
): GraphFactory<Input, Output> {
  return (input) => {
    const nodes = factory(input)
    const ids = new Set<string>()
    for (const node of nodes) {
      if (!node.id) throw new Error('GraphFactory 必须产出具有非空 id 的 Node')
      if (ids.has(node.id)) throw new Error(`GraphFactory 产出了重复 Node ID: ${node.id}`)
      ids.add(node.id)
    }
    return nodes
  }
}

export interface BackendPluginContext<Dependencies> {
  readonly pluginId: string
  readonly dependencies: Readonly<Dependencies>
}

export interface BackendPlugin<Dependencies = Record<string, never>> {
  readonly id: string
  createNodes(context: BackendPluginContext<Dependencies>): readonly AnyNode[]
  /** Explicit user commands only. Internal observations and WorldNode effects
   * must not be public roots. Backend code is trusted, not sandboxed. */
  readonly rendererRoots?: readonly RendererRoot[]
}

export interface RendererRoot {
  readonly targetNodeId: string
  readonly infoType: string
  readonly validate: (info: Info) => boolean
}

export function assertRendererRoot<Dependencies>(
  plugins: readonly BackendPlugin<Dependencies>[],
  input: { targetNodeId: string; info: Info },
): void {
  const root = plugins.flatMap((plugin) => plugin.rendererRoots ?? []).find((entry) => (
    entry.targetNodeId === input?.targetNodeId && entry.infoType === input?.info?.type
  ))
  if (!root || !root.validate(input.info)) throw new Error('Renderer root Info 未授权或参数无效')
}

export interface BackendPluginModule<Dependencies = Record<string, never>> {
  readonly default?: BackendPlugin<Dependencies>
  readonly plugin?: BackendPlugin<Dependencies>
}

export function defineBackendPlugin<Dependencies>(
  plugin: BackendPlugin<Dependencies>,
): BackendPlugin<Dependencies> {
  if (!plugin.id.trim()) throw new Error('Backend Plugin id 不能为空')
  if (typeof plugin.createNodes !== 'function') throw new Error(`Backend Plugin ${plugin.id} 缺少 createNodes`)
  return Object.freeze(plugin)
}

export function createPluginNodes<Dependencies>(
  plugins: readonly BackendPlugin<Dependencies>[],
  dependencies: Dependencies,
): readonly AnyNode[] {
  const pluginIds = new Set<string>()
  const nodeOwners = new Map<string, string>()
  const nodes: AnyNode[] = []
  for (const plugin of [...plugins].sort((left, right) => left.id.localeCompare(right.id))) {
    if (pluginIds.has(plugin.id)) throw new Error(`Backend Plugin ID 重复: ${plugin.id}`)
    pluginIds.add(plugin.id)
    const produced = plugin.createNodes({ pluginId: plugin.id, dependencies })
    const ownIds = new Set(produced.map((node) => node.id))
    const publicKeys = new Set<string>()
    for (const root of plugin.rendererRoots ?? []) {
      const key = `${root.targetNodeId}\0${root.infoType}`
      if (!ownIds.has(root.targetNodeId) || !root.infoType || typeof root.validate !== 'function'
        || publicKeys.has(key)) throw new Error(`Plugin ${plugin.id} renderer root 无效: ${key}`)
      publicKeys.add(key)
    }
    for (const node of produced) {
      if (!node.id) throw new Error(`Backend Plugin ${plugin.id} 产出了空 Node ID`)
      const previousOwner = nodeOwners.get(node.id)
      if (previousOwner) {
        throw new Error(`Node ID 冲突: ${node.id} (${previousOwner} / ${plugin.id})`)
      }
      nodeOwners.set(node.id, plugin.id)
      nodes.push(node)
    }
  }
  return nodes
}

export type { EffectAdapter, EffectContext } from '@graphvideo/kernel'
export { ExecutionWorldNode, Node, ObservationWorldNode, WorldNode, type WorldNodeKind } from '@graphvideo/kernel'
export type {
  ChangeContext, DeliveryFeedback, DeliveryStatus, DomainChangeContext, Info,
  NodeErrorInfo, NodeStartRequestedInfo, NodeStopRequestedInfo, WorldChangeContext,
} from '@graphvideo/kernel'
export type { StudioPluginManifest } from './plugin-manifest.mjs'
export {
  defineStudioPluginManifest, parseStudioPluginManifest,
} from './plugin-manifest.mjs'
export { NativeRuleSpace, locateNativeBinding } from './native-space'
export type {
  CausalTelemetryEvent,
  NativeChangeContext, NativeDeliveryFeedback, NativeDeliveryStatus, NativeHandler, NativeInfo,
} from './native-space'
export { describeDomainNode, mountDomainNode, replaceDomainNode } from './native-node'
export type { DescribedDomainNode } from './native-node'

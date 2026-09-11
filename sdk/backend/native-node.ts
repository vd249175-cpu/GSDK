import type { DomainChangeContext, Info, Node, WorldChangeContext } from '@graphvideo/kernel';
import { NativeRuleSpace } from './native-space';
import type { NativeHandler, NativeInfo } from './native-space';

export interface DescribedDomainNode<S extends Record<string, unknown>> {
  id: string;
  initialState: S;
  handler: NativeHandler<S>;
  isWorldNode: boolean;
  dispose: () => Promise<void>;
}

/**
 * Mount a domain `Node`'s change logic on a native rule space.
 *
 * The instance stays a logic holder: its id and construction-time state
 * seed the entity, while the live state belongs to the rule space copy
 * (`space.getState`). The instance's own `state` is never read back, so a
 * hot-swapped leftover cannot leak stale facts into the new generation.
 *
 * Supported context surface: `read`/`write`/`patchState`/`send` (feedback
 * passes through structurally), `effectAdapter` and `span`. The Node keeps
 * its construction-injected adapter; the native host supplies the effect
 * clock and the owning submission's AbortSignal.
 */
export function describeDomainNode<S extends Record<string, unknown>>(
  node: Node<S>,
): DescribedDomainNode<S> {
  const initialState = { ...(node.getState() as S) };
  const handler: NativeHandler<S> = (info, ctx) =>
    (
      node as unknown as {
        change(info: Info, ctx: DomainChangeContext<S>): void | Promise<void>;
      }
    ).change(info as Info, {
      read: (key) => ctx.read(key),
      write: (key, value) => ctx.write(key, value),
      patchState: (patch) => ctx.patchState(patch),
      send: (child, target) => ctx.send(child as NativeInfo, target),
      effectAdapter: (adapter, request, options) => ctx.effectAdapter(adapter, request, options),
      span: (name, action) => ctx.span(name, action),
    } as WorldChangeContext<S>);
  return {
    id: node.id,
    initialState,
    handler,
    isWorldNode: node.isWorldNode,
    dispose: () => node.dispose(),
  };
}

/** Register a domain `Node` on the space. Returns its starting generation. */
export function mountDomainNode<S extends Record<string, unknown>>(
  space: NativeRuleSpace,
  node: Node<S>,
): number {
  const described = describeDomainNode(node);
  const generation = space.register(described.id, described.initialState, described.handler, {
    isWorldNode: described.isWorldNode,
    dispose: described.dispose,
  });
  try {
    node.onMount();
    return generation;
  } catch (error) {
    space.unregister(described.id);
    throw error;
  }
}

/** Replace a mounted Node after preparing its lifecycle resources. */
export async function replaceDomainNode<S extends Record<string, unknown>>(
  space: NativeRuleSpace,
  node: Node<S>,
  options: { timeoutMs?: number } = {},
): Promise<number> {
  const described = describeDomainNode(node);
  node.onMount();
  try {
    return await space.replace(
      described.id,
      described.initialState,
      described.handler,
      options,
      { isWorldNode: described.isWorldNode, dispose: described.dispose },
    );
  } catch (error) {
    await node.dispose();
    throw error;
  }
}

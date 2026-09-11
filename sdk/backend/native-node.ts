import type { DomainChangeContext, Info, Node } from '@graphvideo/kernel';
import { NativeRuleSpace } from './native-space';
import type { NativeHandler, NativeInfo } from './native-space';

export interface DescribedDomainNode<S extends Record<string, unknown>> {
  id: string;
  initialState: S;
  handler: NativeHandler<S>;
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
 * passes through structurally) and `span` (runs inline; the native host
 * records no trace spans). `WorldNode`s are refused: effects need an
 * `EffectAdapter` wired to a host the native pump does not provide.
 */
export function describeDomainNode<S extends Record<string, unknown>>(
  node: Node<S>,
): DescribedDomainNode<S> {
  if (node.isWorldNode) {
    throw new Error(`WorldNodes cannot mount on the native host (no EffectAdapter): ${node.id}`);
  }
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
      span: (_name, action) => Promise.resolve().then(action),
    } as DomainChangeContext<S>);
  return { id: node.id, initialState, handler };
}

/** Register a domain `Node` on the space. Returns its starting generation. */
export function mountDomainNode<S extends Record<string, unknown>>(
  space: NativeRuleSpace,
  node: Node<S>,
): number {
  const described = describeDomainNode(node);
  return space.register(described.id, described.initialState, described.handler);
}

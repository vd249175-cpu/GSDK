import type { PanelDefinition } from '../elements/types'
import { OwnedRegistry } from './ownedRegistry'

export class PanelRegistry {
  private readonly registry = new OwnedRegistry<PanelDefinition>()

  readonly subscribe = this.registry.subscribe
  readonly getSnapshot = this.registry.getSnapshot

  register(owner: string, panel: PanelDefinition) { this.registry.register(owner, panel) }
  assertCanReplace(owner: string, panels: PanelDefinition[]) { this.registry.assertCanReplace(owner, panels) }
  replaceOwner(owner: string, panels: PanelDefinition[]) { this.registry.replaceOwner(owner, panels) }
  unregisterOwner(owner: string) { this.registry.unregisterOwner(owner) }
  get(id: string) { return this.registry.get(id) }
  list() { return this.registry.list() }
  ownerOf(id: string) { return this.registry.ownerOf(id) }
}

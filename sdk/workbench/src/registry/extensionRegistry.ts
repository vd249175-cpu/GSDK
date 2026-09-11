import type { ExtensionDefinition } from '../elements/types'
import { OwnedRegistry } from './ownedRegistry'

export class ExtensionRegistry {
  private readonly registry = new OwnedRegistry<ExtensionDefinition>()
  readonly subscribe = this.registry.subscribe
  readonly getSnapshot = this.registry.getSnapshot

  register(owner: string, extension: ExtensionDefinition) { this.registry.register(owner, extension) }
  assertCanReplace(owner: string, values: ExtensionDefinition[]) { this.registry.assertCanReplace(owner, values) }
  replaceOwner(owner: string, values: ExtensionDefinition[]) { this.registry.replaceOwner(owner, values) }
  unregisterOwner(owner: string) { this.registry.unregisterOwner(owner) }
  list(point?: string) {
    const extensions = this.registry.list()
    return point ? extensions.filter((extension) => extension.point === point) : extensions
  }
}

import { defineGraphFactory } from '@graphvideo/sdk/plugin';
import {
  createAuthoringNodes,
  createGenerationNodes,
  createPersistenceNodes,
  createPlatformNodes,
  type StudioNodeDependencies,
} from './studio-node-groups'

export type { StudioNodeDependencies } from './studio-node-groups'

/** The production composition factory creating all 18 Studio Nodes. */
export const createStudioNodes = defineGraphFactory(
  (dependencies: StudioNodeDependencies = {}) => [
    ...createAuthoringNodes(dependencies),
    ...createPersistenceNodes(dependencies),
    ...createGenerationNodes(dependencies),
    ...createPlatformNodes(dependencies),
  ],
)

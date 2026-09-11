import { defineGraphFactory } from '@graphvideo/backend-sdk'
import {
  createAuthoringNodes,
  createGenerationNodes,
  createPersistenceNodes,
  createPlatformNodes,
  type StudioNodeDependencies,
} from './studio-node-groups'

export type { StudioNodeDependencies } from './studio-node-groups'

/** The production composition factory creating all 16 Studio Nodes. */
export const createStudioNodes = defineGraphFactory(
  (dependencies: StudioNodeDependencies = {}) => [
    ...createAuthoringNodes(dependencies),
    ...createPersistenceNodes(dependencies),
    ...createGenerationNodes(dependencies),
    ...createPlatformNodes(dependencies),
  ],
)

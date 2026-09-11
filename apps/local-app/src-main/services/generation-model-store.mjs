import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { resolveProjectPath } from './project-paths.mjs'
import { evaluateGenerationProject } from '../shared/generation-batch-planner.mjs'
import {
  buildModelRequestV2, compileModelIntentV2, estimateModelBudgetV2,
} from '../shared/generation-model-intent-v2.mjs'
import { parseGenerationPrompt } from '../shared/generation-prompt.mjs'
import { GenerationCatalogSnapshotStore } from './generation-catalog-snapshot.mjs'
import { openLocalProject } from './project-store.mjs'

const stores = new Map()

async function existingMediaVersion(projectRoot, version) {
  if (!version?.relativePath) return null
  try {
    const candidate = resolveProjectPath(projectRoot, version.relativePath)
    return (await stat(candidate)).isFile() ? version : null
  } catch {
    return null
  }
}

/** Attach only physically observable media versions to a generation snapshot. */
export async function observeGenerationProjectMedia(project) {
  const projectRoot = resolve(project.path)
  const nodes = await Promise.all((project.nodes ?? []).map(async (node) => ({
    ...node,
    history: (await Promise.all((node.history ?? []).map((version) => (
      existingMediaVersion(projectRoot, version)
    )))).filter(Boolean),
  })))
  return { ...project, path: projectRoot, nodes }
}

async function storeFor(source) {
  if (source instanceof GenerationCatalogSnapshotStore) {
    if (!source.revision) await source.load()
    return source
  }
  const root = resolve(source)
  let store = stores.get(root)
  if (!store) {
    store = new GenerationCatalogSnapshotStore(root)
    stores.set(root, store)
  }
  if (!store.revision) await store.load()
  return store
}

function promptSnapshot(store, prompt) {
  const modelId = parseGenerationPrompt(prompt ?? '').modelId
  if (!modelId) throw new Error('提示词 YAML 头部必须声明 model: <model-id>')
  return store.lookup(modelId)
}

export async function listGenerationModels(source) {
  const catalog = (await storeFor(source)).read()
  return {
    models: catalog.models.map((entry) => structuredClone(entry.model)),
    issues: [],
    revision: catalog.revision,
  }
}

export async function readGenerationModel(source, modelId) {
  return structuredClone((await storeFor(source)).lookup(modelId).model)
}

export async function resolveGenerationPrompt(source, input) {
  const store = await storeFor(source)
  return compileModelIntentV2(promptSnapshot(store, input?.prompt), input)
}

export async function buildGenerationRequest(source, input) {
  const store = await storeFor(source)
  return buildModelRequestV2(promptSnapshot(store, input?.prompt), input)
}

export async function importGenerationModel(source, sourceDirectory, replaceExisting = false) {
  const imported = await (await storeFor(source)).importPackage(sourceDirectory, replaceExisting)
  return structuredClone(imported.model)
}

export async function deleteGenerationModel(source, modelId) {
  await (await storeFor(source)).deletePackage(modelId)
}

export async function estimateGenerationBudget(source, options) {
  const store = await storeFor(source)
  if (!options?.model) throw new Error('缺少模型 ID model')
  return estimateModelBudgetV2(store.lookup(options.model), options)
}

export async function evaluateGenerationDag(source, projectRoot) {
  const store = await storeFor(source)
  const project = await openLocalProject(resolve(projectRoot))
  return evaluateGenerationProject(await observeGenerationProjectMedia(project), store.read())
}

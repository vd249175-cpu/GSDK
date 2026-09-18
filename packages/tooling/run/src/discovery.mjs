import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Writes the run-scoped frontend discovery file: the only endpoint/identity
 * document the renderer host reads. Never the user-level discovery file, so
 * two frontend runs cannot steal each other's control plane.
 */
export function writeRunDiscovery(runtimeDirectory, { kernel, agentControl = null, frontend = null, runName = 'run' }) {
  if (!kernel || typeof kernel.address !== 'string') throw new Error('run discovery requires a kernel address');
  mkdirSync(runtimeDirectory, { recursive: true });
  const path = join(runtimeDirectory, 'frontend-discovery.json');
  const document = {
    version: 2,
    runName,
    kernel: { address: kernel.address, pid: kernel.pid ?? null },
    agentControl,
    frontend,
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`);
  return path;
}

export function readRunDiscovery(runtimeDirectory) {
  const path = join(runtimeDirectory, 'frontend-discovery.json');
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * Guards the renderer command surface for one run: only rendererRoots of the
 * actually assembled plugins may be injected, and only the run's own
 * discovery document supplies the endpoint. Mirrors assertRendererRoot
 * without importing business plugins into the generic tool.
 */
export function assertRunRendererRoot(assembledRoots, { targetNodeId, info }) {
  const match = assembledRoots.some((root) => (
    root.targetNodeId === targetNodeId && root.infoType === info?.type
  ));
  if (!match) throw new Error(`Renderer root is not assembled in this run: ${targetNodeId} ${info?.type}`);
  const candidate = assembledRoots.find((root) => (
    root.targetNodeId === targetNodeId && root.infoType === info?.type
  ));
  if (typeof candidate?.validate === 'function' && !candidate.validate(info)) {
    throw new Error(`Renderer root payload rejected: ${targetNodeId} ${info?.type}`);
  }
}

export function discoveryExists(runtimeDirectory) {
  return existsSync(join(runtimeDirectory, 'frontend-discovery.json'));
}

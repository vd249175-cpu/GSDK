import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/**
 * Mounts the run's real Node slice on a live daemon and runs the run's
 * lifecycle inputs through the same settlement barrier scenarios use:
 * every submission id reaches a terminal status with pending Total at zero.
 *
 * Order is fixed: assemble exactly the configured instances, admit every one
 * before any claim, claim once on the worker connection, inject init then
 * start Infos, then leave the worker running for the caller (interactive
 * run) or a scenario set. Partial admission failure evicts the admitted
 * prefix and disposes every assembled instance, so no half-mounted slice is
 * left behind.
 */
export async function mountRunSlice({ nodes, control, worker, signal }) {
  const sdkNode = await importSdkNode();
  const { assemblies, handlers } = await sdkNode.admitDaemonNodes(control, nodes);
  const admitted = Object.keys(handlers);
  let running = null;
  try {
    running = sdkNode.runDaemonNodeWorker(worker, { handlers, longPollMs: 50, ...(signal ? { signal } : {}) });
    return { assemblies, handlers, running, admitted };
  } catch (error) {
    if (running) await running.catch(() => undefined);
    for (const nodeId of admitted.reverse()) {
      await control.evict?.(nodeId).catch(() => undefined);
    }
    await Promise.allSettled(assemblies.map((assembly) => assembly.dispose()));
    throw error;
  }
}

export async function injectLifecycleInfos({ control, infos, prefix, timeoutMs = 30_000 }) {
  const submissionIds = [];
  let sequence = 0;
  for (const entry of infos) {
    sequence += 1;
    const submissionId = `${prefix}/${sequence}`;
    const feedback = await control.inject(entry.targetNodeId, entry.info, submissionId);
    if (feedback?.status === 'dropped' || feedback?.feedback?.status === 'dropped') {
      throw new Error(`lifecycle input dropped: ${entry.targetNodeId} ${entry.info.type}`);
    }
    submissionIds.push(submissionId);
  }
  await waitForSubmissions({ control, submissionIds, timeoutMs, label: prefix });
  return submissionIds;
}

export async function waitForSubmissions({ control, submissionIds, timeoutMs = 30_000, label = 'lifecycle' }) {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  for (;;) {
    const projection = await control.projection();
    const states = submissionIds.map((id) => projection.submissions?.[id]?.status ?? 'unknown');
    last = states.join(',');
    const terminal = states.every((status) => ['completed', 'failed', 'cancelled'].includes(status));
    if (terminal && (projection.pending ?? 0) === 0) {
      const failed = submissionIds.filter((id, index) => states[index] === 'failed');
      if (failed.length > 0) throw new Error(`${label} submissions failed: ${failed.join(',')}`);
      return projection;
    }
    if (Date.now() > deadline) {
      throw new Error(`${label} timed out: submissions [${last}] pending ${projection.pending ?? '?'}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

export async function unmountRunSlice({ control, workerStop, running, admitted, assemblies }) {
  workerStop?.abort();
  if (running) await running.catch(() => undefined);
  for (const nodeId of [...(admitted ?? [])].reverse()) {
    await control.evict?.(nodeId).catch(() => undefined);
  }
  await Promise.allSettled((assemblies ?? []).map((assembly) => assembly.dispose()));
}

async function importSdkNode() {
  // Tooling has no @graphvideo/sdk dependency of its own; load the shared
  // source build through the nearest vendored copy. The dist bundle tracks
  // packages/sdk/javascript/src and exposes the daemon bridge.
  const candidates = [
    '@graphvideo/sdk/node',
    '../../../sdk/javascript/dist/node.js',
  ];
  let lastError = null;
  for (const candidate of candidates) {
    try {
      if (candidate.startsWith('@')) {
        return await import(candidate);
      }
      return await import(new URL(candidate, import.meta.url).href);
    } catch (error) {
      lastError = error;
    }
  }
  void require;
  throw lastError ?? new Error('Cannot load @graphvideo/sdk/node');
}

export async function connectRunDaemon({ address, token }) {
  try {
    const direct = await import('@graphvideo/sdk/agent');
    return direct.connectKernelDaemon({ address, token });
  } catch {
    const distAgent = new URL('../../../sdk/javascript/dist/agent.js', import.meta.url).href;
    const agent = await import(distAgent);
    return agent.connectKernelDaemon({ address, token });
  }
}

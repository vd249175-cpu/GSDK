import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defaultValueCodec, daemonValueCodec } from '@graphvideo/sdk/protocol';
import { callRunControl, serveRunControl } from '../../../../../../packages/tooling/run/src/control.mjs';
import { writeJsonRecord } from '../../../../../../packages/tooling/run/src/record.mjs';

export const frontendContext = JSON.parse(readFileSync(process.argv[2], 'utf8'));

/** A read-only projection cache and authenticated host port, no runtime/State. */
export async function connectFrontendHost({ effects, stopSources, closeServices, closeIngress, quit, broadcast, rendererReady, inspectLayout }) {
  const context = frontendContext;
  const runtime = context.runtimeDirectory;
  const token = readFileSync(join(runtime, 'control-token'), 'utf8').trim();
  let projection = { revision: 0, nodes: [], scheduler: { pendingDeliveries: 0, activeChanges: 0, scheduledGraphMicrotasks: 0 } };
  let stopped = false;
  let polling;
  const qualify = (id) => id.startsWith(`${context.instance.graph}/`) ? id : `${context.instance.graph}/${id}`;
  const refresh = async () => {
    const raw = await callRunControl(runtime, 'projection');
    const nodes = Object.entries(raw.nodes).filter(([id]) => id.startsWith(`${context.instance.graph}/`)).map(([nodeId, value]) => ({ nodeId,
      state: defaultValueCodec.encode(daemonValueCodec.decode(value.state), { maxDepth: 100, maxArrayLength: Number.MAX_SAFE_INTEGER }), version: value.version, generation: value.generation, status: 'IDLE' }));
    projection = { revision: nodes.reduce((sum, node) => sum + node.version, 0), nodes,
      scheduler: { pendingDeliveries: raw.pending, activeChanges: 0, scheduledGraphMicrotasks: 0 } };
    broadcast('graph:event', { event: 'graph.projection.updated', payload: { projection } });
    return projection;
  };
  await refresh();
  const timer = setInterval(() => { if (!stopped && !polling) { polling = refresh().catch((error) => console.error(error.message)).finally(() => { polling = null; }); } }, 100);
  const server = await serveRunControl({ token, runId: context.runId, concurrent: ['effect'], handlers: {
    health: () => ({ runId: context.runId, pid: process.pid, instanceId: context.instance.id }),
    ready: async () => {
      await rendererReady;
      const layout = await inspectLayout();
      if (!layout.workspace?.height || !layout.panels.length || layout.missingPanels || layout.panels.some((panel) => !panel.width || !panel.height)) throw new Error('Studio workspace panels have no visible layout');
      return { ready: true, layout };
    },
    'inspect-layout': () => inspectLayout(),
    gate: async () => { await closeIngress(); return { gated: true }; },
    effect: async ({ adapter, request }) => {
      if (stopped || !effects[adapter]) throw new Error(`Frontend Effect unavailable: ${adapter}`);
      return daemonValueCodec.encode(await effects[adapter].execute(daemonValueCodec.decode(request), {}));
    },
    'stop-sources': async () => { await stopSources(); return { stopped: true }; },
    close: async () => {
      stopped = true; clearInterval(timer); await polling;
      await closeServices();
      setImmediate(async () => { await server.close(); quit(); });
      return { closed: true };
    },
  } });
  writeJsonRecord(join(runtime, `frontend-${context.instance.id}.json`), { runId: context.runId, address: server.address, pid: process.pid });
  return {
    readProjection: () => projection,
    readStaticTopology: () => ({ revision: projection.revision, nodes: projection.nodes.map((node) => ({ nodeId: node.nodeId })), routes: [] }),
    injectRoot: async (id, info) => {
      const result = await callRunControl(runtime, 'inject-renderer', { frontendId: context.instance.id, targetNodeId: qualify(id), info });
      return { ...result, projection: await refresh() };
    },
    injectHost: async (id, info) => callRunControl(runtime, 'inject-host', { frontendId: context.instance.id, targetNodeId: qualify(id), info }),
    requestStop: async () => callRunControl(runtime, 'request-stop'),
  };
}

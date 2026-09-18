#!/usr/bin/env node
import { createServer } from 'node:http';
import { loadRunConfig } from '../run/src/session.mjs';
import { loadRunNodes } from '../run/src/assembly.mjs';
import { NativeRuleSpace, mountDomainNode } from '../../sdk/javascript/dist/node.js';

const PORT = 51888;
const dummyAdapter = { execute: async () => ({ ok: true }) };

async function bootstrap() {
  console.log('[TelemetryServer] Assembling full Studio graph topology in NativeRuleSpace...');
  const parsed = loadRunConfig('runs/studio/run.config.json');
  const { nodes } = await loadRunNodes(parsed, () => ({
    electronWindowAdapter: dummyAdapter,
    sqlitePersistAdapter: dummyAdapter,
    projectStructurePersistAdapter: dummyAdapter,
    generationAdapterOperation: dummyAdapter,
  }));

  const space = new NativeRuleSpace();
  for (const n of nodes) {
    mountDomainNode(space, n);
  }

  const topo = space.readStaticTopology();
  const projection = space.readProjection();
  console.log(`[TelemetryServer] Assembled ${nodes.length} nodes and ${topo.routes?.length ?? 0} causal routes.`);

  const clients = new Set();

  const server = createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);

    if (url.pathname === '/api/topology') {
      const currentTopo = space.readStaticTopology();
      const currentProj = space.readProjection();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          revision: currentTopo.revision,
          scheduler: currentProj.scheduler,
          nodes: currentTopo.nodes.map((n) => {
            const state = space.getState(n.nodeId);
            return {
              nodeId: n.nodeId,
              generation: space.generation(n.nodeId),
              version: 1,
              status: 'idle',
              state: state ?? {},
            };
          }),
          routes: currentTopo.routes,
          recentEvents: [],
        })
      );
      return;
    }

    if (url.pathname === '/api/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write('retry: 3000\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }

    res.writeHead(404);
    res.end();
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[TelemetryServer] Live telemetry loopback running on http://127.0.0.1:${PORT}`);
  });
}

bootstrap().catch((err) => {
  console.error('[TelemetryServer] Failed to start:', err);
  process.exit(1);
});

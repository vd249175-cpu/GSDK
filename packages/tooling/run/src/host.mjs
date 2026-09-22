import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { serveRunControl, callRunControl } from './control.mjs';
import { loadRunNodes } from './assembly.mjs';
import { connectRunDaemon, mountRunSlice, unmountRunSlice, injectLifecycleInfos, waitForSubmissions } from './mount.mjs';
import { runtimeFor, readSnapshot, updateSession, sleep, startResult } from './session.mjs';
import { runScenarioSet, writeScenarioReport } from './scenario.mjs';
import { pathToFileURL } from 'node:url';
import { writeJsonRecord } from './record.mjs';

export async function waitForState(control, ready, timeoutMs) {
  if (!ready) return;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const entry = (await control.projection()).nodes?.[ready.nodeId];
    if (entry && Object.entries(ready.state ?? {}).every(([key, value]) => JSON.stringify(entry.state[key]) === JSON.stringify(value))) return;
    if (Date.now() >= deadline) throw new Error(`business readiness timed out: ${ready.nodeId}`);
    await sleep();
  }
}

/** Long-lived backend owns Node objects; Bash exclusively orders these operations. */
export async function runBackend(config) {
  const initial = readSnapshot(config);
  const { parsed, runId, runName } = initial;
  const runtime = runtimeFor(config);
  const token = readFileSync(join(runtime, 'control-token'), 'utf8').trim();
  const kernelToken = readFileSync(join(runtime, 'daemon-token'), 'utf8').trim();
  const control = await connectRunDaemon({ address: initial.kernel.address, token: kernelToken });
  const workerStop = new AbortController();
  const providerStop = new AbortController();
  let nodes = [];
  let backends = new Map();
  let rendererRoots = [];
  let mount = null;
  let worker = null;
  let provider = null;
  let providing = null;
  let stopWaiting;
  let pendingStop;
  let attempt = 0;
  let closing = false;
  let server;
  let outerHost;
  let resolveDone;
  const done = new Promise((resolve) => { resolveDone = resolve; });
  const mark = (stage, patch = {}) => updateSession(config, patch, stage);
  const assertReady = () => { if (closing) throw new Error('run is closing'); };
  function requestStop() {
    if (!pendingStop) {
      attempt += 1;
      pendingStop = { runId, attempt };
      closing = true;
      mark(undefined, { stopAttempt: attempt, state: 'stop-requested' });
      if (stopWaiting) { const resolve = stopWaiting; stopWaiting = null; resolve(pendingStop); }
    }
    return pendingStop;
  }
  async function injectPhase(phase) {
    const timeoutMs = parsed.lifecycle.timeouts[`${phase}Ms`];
    let index = 0;
    for (const entry of parsed.lifecycle[`${phase}Infos`]) {
      index += 1;
      await injectLifecycleInfos({ control, infos: [entry], prefix: `${runId}/${phase}/${attempt}/${index}`, timeoutMs });
      await waitForState(control, entry.await, timeoutMs);
    }
  }
  const handlers = {
    health: () => ({ runId, pid: process.pid, state: readSnapshot(config).state, stopRequested: Boolean(pendingStop) }),
    projection: () => control.projection(),
    analyze: ({ request } = {}) => control.analyze(request ?? { op: 'health' }),
    inspect: ({ after, limit } = {}) => control.agentInspect(after, limit),
    'request-stop': async () => {
      // The supervisor acknowledges a failed attempt before accepting a retry.
      while (pendingStop && readSnapshot(config).state === 'stop-failed') await sleep();
      return requestStop();
    },
    'wait-stop': async () => {
      const deadline = Date.now() + 5000;
      while (!pendingStop && Date.now() < deadline) await sleep(100);
      return pendingStop ? { ...pendingStop, requested: true } : { requested: false };
    },
    'stop-failed': ({ error }) => {
      const previous = readSnapshot(config);
      mark(undefined, { state: 'stop-failed', lastError: previous.state === 'stop-failed' ? previous.lastError : error || 'run teardown failed', stopAttempt: attempt });
      pendingStop = null;
      return { failed: true };
    },
    assemble: async () => {
      if (parsed.backend.host) {
        const module = await import(pathToFileURL(parsed.backend.host).href);
        outerHost = await module.createRunHost({ parsed, runtimeDirectory: runtime, callFrontend: (id, op, payload) => callRunControl(runtime, op, payload, parsed.lifecycle.timeouts.stopMs, `frontend-${id}.json`) });
      }
      const assembled = await loadRunNodes(parsed, outerHost?.dependenciesFor ?? parsed.backend.dependencies);
      nodes = assembled.nodes;
      backends = assembled.backends;
      rendererRoots = assembled.rendererRoots;
      mark('assembled');
      return { nodeIds: nodes.map((node) => node.id) };
    },
    admit: async () => {
      if (nodes.length) {
        worker = await connectRunDaemon({ address: initial.kernel.address, token: kernelToken });
        mount = await mountRunSlice({ nodes, control, worker, signal: workerStop.signal });
      } else mount = { assemblies: [], admitted: [], running: null };
      mark('admitted');
      const adapters = new Map();
      for (const node of nodes) {
        for (const value of Object.values(node)) {
          if (value && typeof value === 'object' && typeof value.id === 'string' && typeof value.execute === 'function') adapters.set(value.id, value);
        }
      }
      const capabilities = [...new Set(mount.assemblies.flatMap((entry) => entry.effectCapabilities))];
      const missing = capabilities.filter((id) => !adapters.has(id));
      if (missing.length) throw new Error(`missing Effect providers: ${missing.join(', ')}`);
      if (capabilities.length) {
        const sdk = await import(new URL('../../../sdk/javascript/dist/effect.js', import.meta.url));
        provider = await connectRunDaemon({ address: initial.kernel.address, token: kernelToken });
        let resolveReady;
        const ready = new Promise((resolve) => { resolveReady = resolve; });
        providing = sdk.runDaemonEffectProvider(provider, {
          onReady: resolveReady, signal: providerStop.signal, longPollMs: 50,
          adapters: Object.fromEntries(capabilities.map((id) => [id, (request, context) => adapters.get(id).execute(request, { ...context, signal: providerStop.signal })])),
        });
        void providing.catch(() => undefined);
        await Promise.race([ready, providing.then(() => { throw new Error('provider exited before readiness'); })]);
      }
      mark('workers-ready');
      return { admitted: mount.admitted };
    },
    initialize: async () => { await injectPhase('init'); mark('initialized'); return { initialized: true }; },
    start: async () => {
      assertReady();
      await injectPhase('start');
      await waitForState(control, parsed.lifecycle.ready, parsed.lifecycle.timeouts.startMs);
      outerHost?.startPolling?.({
        projection: () => control.projection(),
        inject: (targetNodeId, info) => injectLifecycleInfos({ control, infos: [{ targetNodeId, info }], prefix: `${runId}/host/${randomUUID()}` }),
      });
      const snapshot = mark('started', { state: 'running' });
      const result = { started: true, runId, runName, pid: process.pid, configPath: parsed.configPath, kernel: snapshot.kernel, stages: snapshot.stages, scenario: Boolean(parsed.scenarios?.length) };
      writeJsonRecord(join(runtime, 'business-start-result.json'), result);
      return result;
    },
    scenario: async () => {
      const report = await runScenarioSet({ parsed, runName, submitInfos: (target, info, id) => control.inject(target, info, id), readProjection: () => control.projection() });
      writeScenarioReport(parsed.resources.logsDirectory, runName, report);
      mark(undefined, { scenarioReport: report });
      return { exitCode: report.failed ? 1 : 0 };
    },
    'stop-business': async () => {
      if (readSnapshot(config).stages.includes('settled')) return { settled: true };
      closing = true;
      await outerHost?.stopPolling?.();
      mark('stopping', { state: 'stopping' });
      await waitForSubmissions({ control, submissionIds: [], timeoutMs: parsed.lifecycle.timeouts.settleMs, label: 'shutdown drain' });
      mark('settled');
      return { settled: true };
    },
    evict: async () => {
      await outerHost?.stopSources?.();
      if (mount) {
        await unmountRunSlice({ control, workerStop, running: mount.running, admitted: mount.admitted, assemblies: mount.assemblies });
        mount = null;
      } else {
        for (const node of nodes) await node.dispose();
      }
      providerStop.abort();
      if (providing) { await providing; providing = null; }
      worker?.close(); provider?.close();
      await outerHost?.dispose?.();
      mark('evicted');
      return { evicted: true };
    },
    'inject-renderer': async ({ targetNodeId, info }) => {
      assertReady();
      const root = rendererRoots.find((candidate) => candidate.infoType === info?.type && targetNodeId === candidate.targetNodeId);
      if (!root || !root.validate(info) || !nodes.some((node) => node.id === targetNodeId)) throw new Error('renderer command not authorized');
      const submissionId = `${runId}/renderer/${randomUUID()}`;
      await injectLifecycleInfos({ control, infos: [{ targetNodeId, info }], prefix: submissionId });
      return { status: 'accepted', submissionId: `${submissionId}/1`, projection: await control.projection() };
    },
    'inject-host': async ({ frontendId, targetNodeId, info }) => {
      assertReady();
      if (!outerHost?.hostRoots?.some((root) => root.frontendId === frontendId && root.targetNodeId === targetNodeId && root.infoType === info?.type)) throw new Error('host command not authorized');
      await injectLifecycleInfos({ control, infos: [{ targetNodeId, info }], prefix: `${runId}/host/${randomUUID()}` });
      return { status: 'accepted' };
    },
    close: async () => {
      control.close();
      mark('hosts-stopped');
      setImmediate(async () => {
        try { await server.close(); resolveDone(); }
        catch (error) { console.error(error); process.exitCode = 1; resolveDone(); }
      });
      return { closed: true };
    },
  };
  for (const op of ['stop-business', 'evict']) {
    const operation = handlers[op];
    handlers[op] = async (...args) => {
      try { return await operation(...args); }
      catch (error) {
        const message = [error.message, ...(error.errors ?? []).map((cause) => cause.message ?? String(cause))].join('; ');
        mark(undefined, { state: 'stop-failed', lastError: message, stopAttempt: attempt });
        throw new Error(message, { cause: error });
      }
    };
  }
  server = await serveRunControl({ token, runId, handlers });
  writeFileSync(join(runtime, 'control.json'), JSON.stringify({ runId, address: server.address, pid: process.pid }));
  mark('hosts-ready', { pid: process.pid });
  process.on('SIGINT', requestStop);
  process.on('SIGTERM', requestStop);
  await done;
}

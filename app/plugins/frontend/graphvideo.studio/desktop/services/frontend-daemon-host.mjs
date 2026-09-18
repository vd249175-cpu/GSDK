import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Frontend daemon host: resolves the run's authoritative daemon endpoint for
 * Electron without ever booting an embedded NativeRuleSpace. The run
 * supervisor writes frontend-discovery.json (address + run identity); the
 * daemon token is read from the run's generated dir via
 * GRAPHVIDEO_RUN_DAEMON_TOKEN_FILE and never bundled into the renderer.
 * Booting an embedded space here stays refused by the caller.
 */
export async function readRunDiscoveryForElectron(runOverrides) {
  const discoveryFile = runOverrides.daemonDiscoveryFile
    ?? process.env.GRAPHVIDEO_RUN_DISCOVERY_FILE
    ?? null;
  if (!discoveryFile) {
    throw new Error(
      'GRAPHVIDEO_RUN_DAEMON_ADDRESS is set but no discovery file is configured: ' +
      'set GRAPHVIDEO_RUN_DISCOVERY_FILE to the run .generated/runtime/frontend-discovery.json; ' +
      'Electron must not boot an embedded NativeRuleSpace alongside the run daemon',
    );
  }
  let discovery;
  try {
    discovery = JSON.parse(readFileSync(discoveryFile, 'utf8'));
  } catch (error) {
    throw new Error(`cannot read run discovery file ${discoveryFile}: ${error?.message ?? error}`);
  }
  const address = discovery?.kernel?.address ?? runOverrides.daemonAddress;
  if (typeof address !== 'string' || !address) {
    throw new Error('run discovery file has no kernel address; Electron must not boot an embedded NativeRuleSpace');
  }
  const tokenFile = runOverrides.daemonTokenFile ?? process.env.GRAPHVIDEO_RUN_DAEMON_TOKEN_FILE ?? null;
  let token = null;
  if (tokenFile) {
    try {
      token = readFileSync(tokenFile, 'utf8').trim();
    } catch (error) {
      throw new Error(`cannot read daemon token file ${tokenFile}: ${error?.message ?? error}`);
    }
  }
  // Minimal host surface the lifecycle/services need: daemon-backed
  // projection reads and root Info injection through the run token.
  // Full daemon RPC wiring lands with the Electron run host; until then this
  // object documents the endpoint without embedding a second State.
  return {
    daemonBacked: true,
    runName: discovery?.runName ?? null,
    kernel: { address },
    tokenConfigured: Boolean(token),
    discoveryFile,
    space: null,
    readProjection() {
      throw new Error('daemon-backed projection is not wired yet; read via the run control plane');
    },
    async injectRoot() {
      throw new Error('daemon-backed injection is not wired yet; inject via the run control plane');
    },
  };
}

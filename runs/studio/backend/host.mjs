/** Studio physical ports are selected by this run, separate from graph factories. */
export function createRunHost({ parsed, callFrontend }) {
  const frontends = new Map(parsed.frontend.instances.map((instance) => [instance.graph, instance.id]));
  const adapters = new Map();
  const dependenciesFor = (instance) => {
    const frontendId = frontends.get(instance.id);
    if (!frontendId) throw new Error(`Studio physical host requires a frontend for graph ${instance.id}`);
    if (!adapters.has(instance.id)) {
      const remote = (adapter) => ({ id: `${instance.id}/${adapter}`,
        execute: async (request) => daemonValueCodec.decode(await callFrontend(frontendId, 'effect', { adapter, request: daemonValueCodec.encode(request) })) });
      adapters.set(instance.id, {
        electronWindowAdapter: remote('window'), sqlitePersistAdapter: remote('sqlite'),
        projectStructurePersistAdapter: remote('structure'), generationAdapterOperation: remote('generation'),
      });
    }
    return adapters.get(instance.id);
  };
  const hostRoots = parsed.frontend.instances.flatMap((instance) => [
    { frontendId: instance.id, targetNodeId: `${instance.graph}/host-el`, infoType: 'WindowActionTaskInfo' },
    { frontendId: instance.id, targetNodeId: `${instance.graph}/host-el`, infoType: 'DesktopStartRequestedInfo' },
    { frontendId: instance.id, targetNodeId: `${instance.graph}/src-electron-window`, infoType: 'ElectronWindowClosedObservedInfo' },
  ]);
  return { dependenciesFor, hostRoots };
}
import { daemonValueCodec } from '../../../packages/sdk/javascript/dist/protocol.js';

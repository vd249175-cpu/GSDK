// Composition/test callers use the same root Bash lifecycle as users.
export { loadRunConfig, resolveDaemonBinary, startRun, stopRun, statusRun } from './session.mjs';
export const START_STAGES = ['validate', 'lock', 'kernel-ready', 'hosts-ready', 'assembled', 'admitted', 'workers-ready', 'initialized', 'started'];
export const STOP_STAGES = ['stopping', 'settled', 'evicted', 'kernel-stopped', 'hosts-stopped', 'closed'];

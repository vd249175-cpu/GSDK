/** Runtime-only capabilities. This module is deliberately not exported by the package entrypoint. */
export const nodeRuntimeCapability: unique symbol = Symbol('node-runtime-capability');
export const changeContextCapability: unique symbol = Symbol('change-context-capability');

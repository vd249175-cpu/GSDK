import { createNativeGraphHost } from './native-graph-host.mjs'

/**
 * 主进程图宿主（已统一至原生规则空间）。
 *
 * @deprecated 旧 TS KernelRuntime 宿主已退役不再维护；请直接使用 `./native-graph-host.mjs` 的 `createNativeGraphHost`。
 * 本函数作为过渡兼容门面，内部已全面对接 NativeRuleSpace 与 Rust 微内核调度。
 */
export function createGraphHost(options = {}) {
  return createNativeGraphHost(options)
}

export { createNativeGraphHost }

/**
 * @fileoverview GraphVideo 现代化应用服务 SDK (Application SDK)
 *
 * ⚠️【开发规范】
 * 严禁使用旧内核（Runtime / StateStore / DomainNodeExecutor）。
 * 稳定基础设施由 ApplicationHost 显式注入；本 SDK 只暴露可插拔扩展原语。
 */
export {
  defineEvent, defineService, type EventToken, type ServiceToken,
} from '@graphvideo/workbench'

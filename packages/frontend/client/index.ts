/**
 * 通用前端 SDK：工作台机制 + 客户端 hooks 工厂，不含业务语义。
 * 业务包用 `defineClientHooks` 绑定自己的 State/Client 类型；
 * 具体 Element 上下文绑定由各插件完成（如 Studio 见插件 frontend/element）。
 */
export { createServicesContext } from './services';
export type { ClientHookOptions, ClientHookServices, RevisionSnapshot, SnapshotSource } from './hooks';
export { defineClientHooks, useStateSelector } from './hooks';

export {
  defineElement as defineWorkbenchElement,
  type ElementModule as WorkbenchElementModule,
  type ElementRegistrationContext as WorkbenchElementRegistrationContext,
} from '@graphvideo/workbench';

export { defineWorkbenchContext } from '@graphvideo/workbench';
export type {
  WorkbenchContextBinding, WorkbenchContextHandle, WorkbenchContextScope,
  WorkbenchContextToken,
} from '@graphvideo/workbench';
export type {
  ElementEventEmitter, ElementEventRegistration, ElementHostApi,
  ElementRuntimeHandle, ElementRuntimeValue, ElementServiceAccessor,
  ElementServiceRegistration, ElementStateBinding, ElementStateDefinition,
  ElementStateHandle, ElementStateScope, ExtensionDefinition, ExtensionProps,
  PanelDefinition, PanelProps,
} from '@graphvideo/workbench';

import { createContext, createElement, useContext, type PropsWithChildren } from 'react';

/**
 * 通用服务上下文工厂：与业务 State/Client 类型无关。
 * 宿主或插件用自己的服务包类型调用一次，得到该包专用的 Context 与 hooks 源。
 */
export function createServicesContext<TServices>(defaultValue: TServices | null = null) {
  const ServicesContext = createContext<TServices | null>(defaultValue);

  function ServiceProvider({ value, children }: PropsWithChildren<{ value: TServices }>) {
    return createElement(ServicesContext.Provider, { value }, children);
  }

  function useServices(): TServices {
    const services = useContext(ServicesContext);
    if (!services) throw new Error('ServicesContext 未提供：外层缺少 ServiceProvider');
    return services;
  }

  return { ServicesContext, ServiceProvider, useServices };
}

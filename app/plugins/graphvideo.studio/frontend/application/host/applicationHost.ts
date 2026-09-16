import type {
  ApplicationEventMap, ApplicationRequestMap,
} from '../contract/application'
import { ApplicationError } from '../contract/transport'

export interface ApplicationHandlerContext {
  signal: AbortSignal
}

type ApplicationHandler<K extends keyof ApplicationRequestMap> = (
  input: ApplicationRequestMap[K]['input'],
  context: ApplicationHandlerContext,
) => ApplicationRequestMap[K]['output'] | Promise<ApplicationRequestMap[K]['output']>

export class ApplicationHost {
  private readonly handlers = new Map<keyof ApplicationRequestMap, ApplicationHandler<any>>()
  private readonly listeners = new Map<keyof ApplicationEventMap, Set<(payload: any) => void>>()
  private disposed = false

  register<K extends keyof ApplicationRequestMap>(method: K, handler: ApplicationHandler<K>) {
    if (this.handlers.has(method)) throw new Error(`Application handler conflict: ${method}`)
    this.handlers.set(method, handler)
    return () => this.handlers.delete(method)
  }

  async request<K extends keyof ApplicationRequestMap>(
    method: K,
    input: ApplicationRequestMap[K]['input'],
    signal: AbortSignal,
  ): Promise<ApplicationRequestMap[K]['output']> {
    if (this.disposed) throw new ApplicationError('application.disposed', 'Application Host 已停止')
    signal.throwIfAborted()
    const handler = this.handlers.get(method) as ApplicationHandler<K> | undefined
    if (!handler) throw new ApplicationError('application.method-missing', `Application 方法不可用: ${method}`)
    return handler(input, { signal })
  }

  emit<K extends keyof ApplicationEventMap>(event: K, payload: ApplicationEventMap[K]) {
    if (this.disposed) return
    this.listeners.get(event)?.forEach((listener) => listener(payload))
  }

  subscribe<K extends keyof ApplicationEventMap>(
    event: K,
    listener: (payload: ApplicationEventMap[K]) => void,
  ) {
    const listeners = this.listeners.get(event) ?? new Set()
    listeners.add(listener)
    this.listeners.set(event, listeners)
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) this.listeners.delete(event)
    }
  }

  dispose() {
    this.disposed = true
    this.handlers.clear()
    this.listeners.clear()
  }
}

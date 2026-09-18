import type {
  ApplicationEventMap, ApplicationRequestMap,
} from '../contract/application'
import {
  ApplicationError, type ApplicationRequestOptions, type ApplicationTransport,
} from '../contract/transport'
import type { ApplicationHost } from '../host/applicationHost'

function clone<T>(value: T): T {
  return structuredClone(value)
}

function normalizeError(error: unknown) {
  if (error instanceof ApplicationError) return error
  if (error instanceof Error && error.name === 'AbortError') {
    return new ApplicationError('application.canceled', '操作已取消')
  }
  if (error instanceof Error && error.message.startsWith('Service Provider 不可用:')) {
    return new ApplicationError('application.provider-missing', error.message)
  }
  return new ApplicationError(
    'application.failed',
    error instanceof Error ? error.message : 'Application 调用失败',
  )
}

export class InProcessTransport implements ApplicationTransport {
  private disposed = false
  private readonly subscriptions = new Set<() => void>()

  constructor(private readonly host: ApplicationHost) {}

  async request<K extends keyof ApplicationRequestMap>(
    method: K,
    input: ApplicationRequestMap[K]['input'],
    options: ApplicationRequestOptions = {},
  ): Promise<ApplicationRequestMap[K]['output']> {
    if (this.disposed) throw new ApplicationError('transport.disposed', 'Application Transport 已停止')
    const controller = new AbortController()
    const cancel = () => controller.abort(options.signal?.reason)
    if (options.signal?.aborted) cancel()
    else options.signal?.addEventListener('abort', cancel, { once: true })
    try {
      await Promise.resolve()
      const output = await this.host.request(method, clone(input), controller.signal)
      return clone(output)
    } catch (error) {
      throw normalizeError(error)
    } finally {
      options.signal?.removeEventListener('abort', cancel)
    }
  }

  subscribe<K extends keyof ApplicationEventMap>(
    event: K,
    listener: (payload: ApplicationEventMap[K]) => void,
  ) {
    if (this.disposed) return () => undefined
    const unsubscribe = this.host.subscribe(event, (payload) => listener(clone(payload)))
    this.subscriptions.add(unsubscribe)
    return () => {
      if (!this.subscriptions.delete(unsubscribe)) return
      unsubscribe()
    }
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.subscriptions.forEach((unsubscribe) => unsubscribe())
    this.subscriptions.clear()
  }
}

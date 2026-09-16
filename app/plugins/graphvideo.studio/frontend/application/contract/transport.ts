import type {
  ApplicationEventMap, ApplicationRequestMap,
} from './application'

export interface ApplicationRequestOptions {
  signal?: AbortSignal
}

export interface ApplicationTransport {
  request<K extends keyof ApplicationRequestMap>(
    method: K,
    input: ApplicationRequestMap[K]['input'],
    options?: ApplicationRequestOptions,
  ): Promise<ApplicationRequestMap[K]['output']>

  subscribe<K extends keyof ApplicationEventMap>(
    event: K,
    listener: (payload: ApplicationEventMap[K]) => void,
  ): () => void
}

export class ApplicationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ApplicationError'
  }
}

import type {
  ApplicationEventMap, ApplicationRequestMap,
} from '../../application/contract/application'
import type {
  ApplicationRequestOptions, ApplicationTransport,
} from '../../application/contract/transport'
import type { ClientStateStore } from '../state/clientStateStore'

export class ClientTransport implements ApplicationTransport {
  constructor(
    private readonly inner: ApplicationTransport,
    private readonly state: ClientStateStore,
  ) {}

  async request<K extends keyof ApplicationRequestMap>(
    method: K,
    input: ApplicationRequestMap[K]['input'],
    options?: ApplicationRequestOptions,
  ): Promise<ApplicationRequestMap[K]['output']> {
    this.state.requestStarted()
    try {
      const output = await this.inner.request(method, input, options)
      this.state.requestFinished()
      return output
    } catch (error) {
      this.state.requestFinished(error)
      throw error
    }
  }

  subscribe<K extends keyof ApplicationEventMap>(
    event: K,
    listener: (payload: ApplicationEventMap[K]) => void,
  ) {
    return this.inner.subscribe(event, listener)
  }
}

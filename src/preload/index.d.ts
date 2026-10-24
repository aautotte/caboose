import type { Api, Channel, Events } from '../shared/api'
import type { Result } from '../shared/types'

export {}

declare global {
  interface Window {
    gc: {
      platform: string
      invoke<C extends Channel>(channel: C, input: Api[C]['in']): Promise<Result<Api[C]['out']>>
      on<E extends keyof Events>(event: E, cb: (payload: Events[E]) => void): () => void
    }
    __gcShot?: (screen: string) => Promise<boolean>
  }
}

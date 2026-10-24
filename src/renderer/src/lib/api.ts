import type { Api, Channel, Events } from '../../../shared/api'
import type { GcError } from '../../../shared/types'

export class ApiError extends Error {
  code: GcError['code']
  detail?: string
  constructor(e: GcError) {
    super(e.message)
    this.code = e.code
    this.detail = e.detail
  }
}

/** Calls the main process. Resolves with the value or throws ApiError with a user-facing message. */
export async function call<C extends Channel>(channel: C, input: Api[C]['in']): Promise<Api[C]['out']> {
  const res = await window.gc.invoke(channel, input)
  if (!res.ok) throw new ApiError(res.error)
  return res.value
}

export function on<E extends keyof Events>(event: E, cb: (payload: Events[E]) => void): () => void {
  return window.gc.on(event, cb)
}

export const newOpId = (): string => crypto.randomUUID()

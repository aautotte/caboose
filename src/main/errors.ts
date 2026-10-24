import type { GcError } from '../shared/types'

export class GcFail extends Error {
  constructor(
    public code: GcError['code'],
    message: string,
    public detail?: string
  ) {
    super(message)
  }

  toJSON(): GcError {
    return { code: this.code, message: this.message, detail: this.detail }
  }
}

export function invalid(message: string): GcFail {
  return new GcFail('invalid', message)
}

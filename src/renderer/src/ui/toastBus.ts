// Lets non-React code (actions.ts) show toasts. ToastProvider registers the real handler on mount.
export interface ToastInput {
  tone: 'info' | 'success' | 'error'
  title: string
  body?: string
  action?: { label: string; onClick: () => void }
}

let handler: ((t: ToastInput) => void) | null = null
const queued: ToastInput[] = []

export function setToastHandler(h: ((t: ToastInput) => void) | null): void {
  handler = h
  if (h) while (queued.length) h(queued.shift()!)
}

export function toast(t: ToastInput): void {
  if (handler) handler(t)
  else queued.push(t)
}

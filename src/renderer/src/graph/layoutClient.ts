import { computeLanes, type Layout, type LaneInput } from './lanes'

let worker: Worker | null = null
let workerFailed = false
let seq = 0
const waiting = new Map<number, (l: Layout) => void>()

function getWorker(): Worker | null {
  if (worker || workerFailed) return worker
  try {
    worker = new Worker(new URL('./lanes.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<{ id: number; layout: Layout }>) => {
      waiting.get(e.data.id)?.(e.data.layout)
      waiting.delete(e.data.id)
    }
    worker.onerror = () => {
      // Fall back to the main thread for this and every later call.
      workerFailed = true
      worker?.terminate()
      worker = null
    }
  } catch {
    workerFailed = true
  }
  return worker
}

/** Lane layout runs in a Web Worker so big histories don't block the UI (main thread if workers are unavailable). */
export function layoutInWorker(rows: LaneInput[], pinned: string[] = []): Promise<Layout> {
  const plain = rows.map((r) => ({ sha: r.sha, parents: r.parents }))
  const w = getWorker()
  if (!w) return Promise.resolve(computeLanes(plain, pinned))
  const id = ++seq
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      waiting.delete(id)
      resolve(computeLanes(plain, pinned))
    }, 3000)
    waiting.set(id, (l) => {
      clearTimeout(timer)
      resolve(l)
    })
    w.postMessage({ id, rows: plain, pinned })
  })
}

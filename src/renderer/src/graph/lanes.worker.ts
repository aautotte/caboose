import { computeLanes, type LaneInput } from './lanes'

self.onmessage = (e: MessageEvent<{ id: number; rows: LaneInput[]; pinned?: string[] }>) => {
  const { id, rows, pinned } = e.data
  self.postMessage({ id, layout: computeLanes(rows, pinned) })
}

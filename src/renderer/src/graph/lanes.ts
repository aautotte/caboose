// Lane layout for the commit graph. Pure and incremental-free: recomputed for all loaded rows (fast enough
// for tens of thousands of rows in a worker). Rows must be in topological order, newest first.

export interface LaneInput {
  sha: string
  parents: string[]
}

/** A line inside one row. 'top' runs from the row's top edge to its middle, 'bottom' from the middle down. */
export interface Edge {
  from: number
  to: number
  color: number
  part: 'top' | 'bottom'
}

export interface RowLayout {
  col: number
  color: number
  edges: Edge[]
}

export interface Layout {
  rows: RowLayout[]
  maxCols: number
}

/**
 * `pinned`: commits of a branch pinned to the left (its first-parent line). They always take lane 0,
 * and nothing else may use it, so that branch reads as a straight line down the left edge.
 */
export function computeLanes(input: LaneInput[], pinned: string[] = []): Layout {
  const lanes: Array<string | null> = [] // lane i waits for this sha to appear
  const colors: number[] = []
  let nextColor = 0
  let maxCols = 0
  const rows: RowLayout[] = []
  // Position along the pinned line (tip = 0). Lane 0 goes to these in order, so a commit further down
  // the line can't take it early just because another branch reaches it first.
  const pinIndex = new Map(pinned.map((sha, i) => [sha, i]))
  let nextPin = 0
  const reserve = pinIndex.size > 0
  const isNextPin = (sha: string): boolean => pinIndex.get(sha) === nextPin
  if (reserve) {
    lanes[0] = null
    colors[0] = nextColor++
  }

  const freeLane = (): number => {
    for (let i = reserve ? 1 : 0; i < lanes.length; i++) if (lanes[i] === null || lanes[i] === undefined) return i
    return Math.max(lanes.length, reserve ? 1 : 0)
  }
  const pinLaneFree = (): boolean => reserve && (lanes[0] === null || lanes[0] === undefined)

  for (const { sha, parents } of input) {
    const edges: Edge[] = []
    const before = lanes.slice()
    const beforeColors = colors.slice()

    let col = lanes.indexOf(sha)
    if (col === -1) {
      // A branch tip nothing above points to.
      col = isNextPin(sha) && pinLaneFree() ? 0 : freeLane()
      lanes[col] = sha
      if (col !== 0 || !reserve) colors[col] = nextColor++
    }
    const color = colors[col]
    if (pinIndex.has(sha)) nextPin = pinIndex.get(sha)! + 1

    // Top half: every lane that was active above this row either ends here (it was waiting for us) or passes through.
    for (let i = 0; i < before.length; i++) {
      if (before[i] === null || before[i] === undefined) continue
      if (before[i] === sha) {
        edges.push({ from: i, to: col, color: beforeColors[i], part: 'top' })
        if (i !== col) lanes[i] = null
      } else {
        edges.push({ from: i, to: i, color: beforeColors[i], part: 'top' })
      }
    }

    // Bottom half: this commit's parents.
    lanes[col] = null
    const fresh = new Set<number>()
    parents.forEach((p, k) => {
      if (isNextPin(p) && pinLaneFree()) {
        // The pinned line always continues in lane 0, even if another lane already waits for the same
        // commit; both lanes meet where it appears.
        lanes[0] = p
        fresh.add(0)
        edges.push({ from: col, to: 0, color: colors[0], part: 'bottom' })
        return
      }
      const existing = lanes.indexOf(p)
      if (existing !== -1) {
        // Another lane already waits for this parent: join it.
        edges.push({ from: col, to: existing, color: k === 0 ? color : colors[existing], part: 'bottom' })
        return
      }
      // Lane 0 belongs to the pinned line; anything else leaving it moves over.
      const target = k === 0 && !(reserve && col === 0) ? col : freeLane()
      lanes[target] = p
      colors[target] = k === 0 && target === col ? color : nextColor++
      fresh.add(target)
      edges.push({ from: col, to: target, color: colors[target], part: 'bottom' })
    })

    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] !== null && lanes[i] !== undefined && !fresh.has(i)) {
        edges.push({ from: i, to: i, color: colors[i], part: 'bottom' })
      }
    }

    while (lanes.length > (reserve ? 1 : 0) && lanes[lanes.length - 1] === null) {
      lanes.pop()
      colors.pop()
    }
    const width = Math.max(col + 1, ...edges.map((e) => Math.max(e.from, e.to) + 1))
    maxCols = Math.max(maxCols, width)
    rows.push({ col, color, edges })
  }
  return { rows, maxCols }
}

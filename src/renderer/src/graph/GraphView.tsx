import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Archive, ArchiveRestore, ArrowDown, ArrowUp, Combine, Copy, Focus, GitBranch, GitMerge, GitPullRequestArrow, ListOrdered, Pencil, Plus, RotateCcw, Tag, Trash2, Undo, Upload } from 'lucide-react'
import type { CommitRow, GraphColumn, GraphColumnKey, Ref } from '../../../shared/types'
import { Avatar, ContextMenu, DropdownMenu, EmptyState, IconButton, RefPill, Tooltip, type MenuEntry } from '@/ui'
import { cn } from '@/ui/cn'
import { fullDate, relativeTime, shortSha } from '@/lib/format'
import { DEFAULT_COLUMNS, useApp, useRepo } from '@/store'
import * as act from '@/actions'
import type { Edge, RowLayout } from './lanes'
import { DropMenu, type DropTarget } from './DropMenu'
import { pushEntry, tagMenu } from '@/shell/refMenus'

const ROW = 28 // matches --gc-graph-row-h
const HEADER = 26 // --gc-list-row-h, the sticky column header
const LANE = 16 // --gc-lane-w
const NODE_R = 5 // --gc-node-r
const MAX_GRAPH_W = 400
const MIN_MESSAGE_W = 240

const laneVar = (c: number): string => `var(--gc-color-lane-${((c % 8) + 8) % 8})`
const x = (i: number): number => LANE / 2 + i * LANE

function edgePath(e: Edge): string {
  const [y1, y2] = e.part === 'top' ? [0, ROW / 2] : [ROW / 2, ROW]
  const x1 = x(e.from)
  const x2 = x(e.to)
  if (x1 === x2) return `M${x1} ${y1}V${y2}`
  const m = (y1 + y2) / 2
  return `M${x1} ${y1}C${x1} ${m} ${x2} ${m} ${x2} ${y2}`
}

const Lanes = memo(function Lanes({ layout, kind, isHead }: { layout: RowLayout; kind: CommitRow['kind'] | 'wip'; isHead: boolean }) {
  const width = Math.max(layout.col + 1, ...layout.edges.map((e) => Math.max(e.from, e.to) + 1)) * LANE
  const cx = x(layout.col)
  const color = laneVar(layout.color)
  return (
    <svg width={width} height={ROW} aria-hidden className="block shrink-0 overflow-visible">
      {layout.edges.map((e, i) => (
        <path
          key={i}
          d={edgePath(e)}
          fill="none"
          stroke={laneVar(e.color)}
          strokeWidth={2}
          strokeDasharray={kind === 'wip' && e.part === 'bottom' && e.from === layout.col ? '3 3' : undefined}
        />
      ))}
      {isHead ? <circle cx={cx} cy={ROW / 2} r={NODE_R + 3} fill="none" stroke="var(--gc-color-focus-ring)" strokeWidth={2} /> : null}
      {kind === 'wip' ? (
        <circle cx={cx} cy={ROW / 2} r={NODE_R} fill="var(--gc-color-bg)" stroke={color} strokeWidth={2} strokeDasharray="2.5 2" />
      ) : kind === 'stash' ? (
        <rect x={cx - NODE_R} y={ROW / 2 - NODE_R} width={NODE_R * 2} height={NODE_R * 2} rx={1.5} fill="var(--gc-color-bg)" stroke={color} strokeWidth={2} />
      ) : (
        <circle cx={cx} cy={ROW / 2} r={NODE_R} fill={color} />
      )}
    </svg>
  )
})

interface DisplayRef {
  key: string
  name: string // what checkout / merge use
  label: string
  kind: 'local' | 'remote' | 'both' | 'tag'
  remote?: string
  isHead: boolean
  local?: Ref
}

/** Groups refs by commit; a local branch and its same-named remote branch on the same commit become one pill. */
function refsBySha(refs: Ref[]): Map<string, DisplayRef[]> {
  const map = new Map<string, DisplayRef[]>()
  const add = (sha: string, d: DisplayRef): void => {
    map.set(sha, [...(map.get(sha) ?? []), d])
  }
  const locals = refs.filter((r) => r.kind === 'local')
  const merged = new Set<string>()
  for (const l of locals) {
    const twin = refs.find((r) => r.kind === 'remote' && r.name === l.upstream && r.sha === l.sha)
    if (twin) merged.add(twin.name)
    add(l.sha, { key: l.name, name: l.short, label: l.short, kind: twin ? 'both' : 'local', isHead: l.isHead, local: l })
  }
  for (const r of refs) {
    if (r.kind === 'remote' && !merged.has(r.name)) {
      add(r.sha, { key: r.name, name: r.short, label: r.short.slice((r.remote?.length ?? 0) + 1), kind: 'remote', remote: r.remote, isHead: false })
    } else if (r.kind === 'tag') add(r.sha, { key: r.name, name: r.short, label: r.short, kind: 'tag', isHead: false })
  }
  for (const list of map.values()) list.sort((a, b) => Number(b.isHead) - Number(a.isHead))
  return map
}

const columnNames: Record<GraphColumnKey, string> = { author: 'Author', date: 'Date', sha: 'SHA' }

/**
 * The user's visible columns, and the width the rows need for all of them with at least ~240px of message. When the
 * graph is wide or the window narrow, the history scrolls sideways rather than dropping columns.
 */
function useColumns(ref: React.RefObject<HTMLDivElement | null>, graphW: number, columns: GraphColumn[]): { refsW: number; shown: GraphColumn[]; minW: number } {
  const [w, setW] = useState(1000)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  const refsW = w < 700 ? 140 : 190
  const shown = columns.filter((c) => c.visible)
  return { refsW, shown, minW: refsW + graphW + MIN_MESSAGE_W + shown.reduce((n, c) => n + c.width, 0) }
}

/** Every commit reachable from `start` among the loaded rows: the hovered branch's history. */
function ancestry(start: string | null, bySha: Map<string, CommitRow>): Set<string> | null {
  if (!start) return null
  const seen = new Set<string>()
  const stack = [start]
  while (stack.length) {
    const sha = stack.pop()!
    if (seen.has(sha)) continue
    seen.add(sha)
    for (const p of bySha.get(sha)?.parents ?? []) stack.push(p)
  }
  return seen
}

/**
 * The Graph column's header, with a handle on its right edge: drag it or use the arrow keys (a lane at a time);
 * double-click it to fit the lanes again. onDone(null) means fit.
 */
function GraphHeader({ width, lanesW, onResize, onDone }: { width: number; lanesW: number; onResize: (w: number) => void; onDone: (w: number | null) => void }): React.JSX.Element {
  const start = useRef<{ x: number; w: number } | null>(null)
  const clamp = (n: number): number => Math.max(3 * LANE + 8, Math.min(Math.max(lanesW, MAX_GRAPH_W), Math.round(n)))
  return (
    <span role="columnheader" className="relative shrink-0 px-1" style={{ width }}>
      Graph
      <span
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the Graph column (double-click to fit the lanes)"
        aria-valuenow={width}
        tabIndex={0}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          start.current = { x: e.clientX, w: width }
        }}
        onPointerMove={(e) => start.current && onResize(clamp(start.current.w + (e.clientX - start.current.x)))}
        onPointerUp={() => {
          if (start.current) onDone(width)
          start.current = null
        }}
        onDoubleClick={() => onDone(null)}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
          e.preventDefault()
          onDone(clamp(width + (e.key === 'ArrowRight' ? LANE : -LANE)))
        }}
        className="absolute inset-y-0 right-0 w-1.5 translate-x-1/2 cursor-col-resize outline-none hover:bg-accent focus-visible:bg-accent"
      />
    </span>
  )
}

/** Drag (or arrow keys) on a column's left edge to change its width. */
function ColumnHeader({ col, onResize, onDone }: { col: GraphColumn; onResize: (w: number) => void; onDone: () => void }): React.JSX.Element {
  const start = useRef<{ x: number; w: number } | null>(null)
  const clamp = (n: number): number => Math.max(48, Math.min(480, Math.round(n)))
  return (
    <span role="columnheader" className="relative shrink-0 truncate px-2" style={{ width: col.width }}>
      <span
        role="separator"
        aria-orientation="vertical"
        aria-label={`Resize the ${columnNames[col.key]} column`}
        aria-valuenow={col.width}
        tabIndex={0}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          start.current = { x: e.clientX, w: col.width }
        }}
        onPointerMove={(e) => start.current && onResize(clamp(start.current.w - (e.clientX - start.current.x)))}
        onPointerUp={() => {
          start.current = null
          onDone()
        }}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
          e.preventDefault()
          onResize(clamp(col.width + (e.key === 'ArrowLeft' ? 8 : -8)))
          onDone()
        }}
        className="absolute inset-y-0 left-0 w-1.5 -translate-x-1/2 cursor-col-resize outline-none hover:bg-accent focus-visible:bg-accent"
      />
      {columnNames[col.key]}
    </span>
  )
}

export function GraphView({ repoId }: { repoId: string }): React.JSX.Element {
  const commits = useRepo(repoId, (r) => r.commits)
  const layout = useRepo(repoId, (r) => r.layout)
  const refs = useRepo(repoId, (r) => r.refs)
  const status = useRepo(repoId, (r) => r.status)
  const selected = useRepo(repoId, (r) => r.selected)
  const multi = useRepo(repoId, (r) => r.multi)
  const hits = useRepo(repoId, (r) => r.searchHits)
  const hasMore = useRepo(repoId, (r) => r.hasMore)
  const loading = useRepo(repoId, (r) => r.loading)
  const parentRef = useRef<HTMLDivElement>(null)
  const [drop, setDrop] = useState<DropTarget | null>(null)
  const [hoverSha, setHoverSha] = useState<string | null>(null)
  const columns = useRepo(repoId, (r) => r.columns)
  const focusHead = useRepo(repoId, (r) => r.focusHead)
  const [draft, setDraft] = useState<GraphColumn[] | null>(null)
  const liveColumns = draft ?? columns

  const dirty = (status?.changes.length ?? 0) > 0
  const rows: Array<CommitRow & { kind: CommitRow['kind'] }> = useMemo(() => {
    const wip: CommitRow = {
      sha: 'wip',
      parents: refs?.head.sha ? [refs.head.sha] : [],
      authorName: '',
      authorEmail: '',
      authorTime: 0,
      summary: '',
      kind: 'wip'
    }
    return dirty ? [wip, ...commits] : commits
  }, [commits, dirty, refs?.head.sha])

  // Hidden branches lose their labels too, on commits that other branches keep in view.
  const hidden = useRepo(repoId, (r) => r.refView.hidden)
  const byRef = useMemo(() => {
    const off = new Set(hidden)
    return refsBySha((refs?.refs ?? []).filter((r) => !off.has(r.name)))
  }, [refs, hidden])
  const hitSet = useMemo(() => (hits ? new Set(hits) : null), [hits])
  const bySha = useMemo(() => new Map(rows.map((r) => [r.sha, r])), [rows])
  const lit = useMemo(() => ancestry(hoverSha, bySha), [hoverSha, bySha])
  const order = useMemo(() => rows.filter((r) => r.kind === 'commit').map((r) => r.sha), [rows])
  const multiSet = useMemo(() => new Set(multi), [multi])
  // The current branch's own line, newest first: what move up / down and squash work on.
  const line = useMemo(() => {
    const out: string[] = []
    for (let sha = refs?.head.sha ?? null; sha && bySha.has(sha); sha = bySha.get(sha)!.parents[0] ?? null) out.push(sha)
    return out
  }, [refs?.head.sha, bySha])
  // Fits the lanes up to MAX_GRAPH_W, unless the user dragged the column to a width of their own.
  const fitW = Math.min(MAX_GRAPH_W, Math.max(3, layout?.maxCols ?? 1) * LANE + 8)
  const savedGraphW = useRepo(repoId, (r) => r.graphWidth)
  const [graphDraft, setGraphDraft] = useState<number | null>(null)
  const graphW = graphDraft ?? savedGraphW ?? fitW

  const outerRef = useRef<HTMLDivElement>(null)
  const cols = useColumns(outerRef, graphW, liveColumns)
  const resize = (key: GraphColumnKey, width: number): void => setDraft(liveColumns.map((c) => (c.key === key ? { ...c, width } : c)))
  const commitDraft = (): void => {
    if (draft) act.setColumns(repoId, draft)
    setDraft(null)
  }
  const headerMenu: MenuEntry[] = [
    ...columns.map(
      (c): MenuEntry => ({
        type: 'item',
        label: `${c.visible ? 'Hide' : 'Show'} the ${columnNames[c.key]} column`,
        onSelect: () => act.setColumns(repoId, columns.map((x) => (x.key === c.key ? { ...x, visible: !x.visible } : x)))
      })
    ),
    { type: 'separator' },
    ...columns.flatMap((c, i): MenuEntry[] => {
      const move = (to: number): void => {
        const next = [...columns]
        next.splice(i, 1)
        next.splice(to, 0, c)
        act.setColumns(repoId, next)
      }
      return [
        ...(i > 0 ? [{ type: 'item' as const, label: `Move ${columnNames[c.key]} left`, onSelect: () => move(i - 1) }] : []),
        ...(i < columns.length - 1 ? [{ type: 'item' as const, label: `Move ${columnNames[c.key]} right`, onSelect: () => move(i + 1) }] : [])
      ]
    }),
    { type: 'separator' },
    { type: 'item', label: 'Reset columns', onSelect: () => act.setColumns(repoId, DEFAULT_COLUMNS) }
  ]
  const v = useVirtualizer({ count: rows.length, getScrollElement: () => parentRef.current, estimateSize: () => ROW, overscan: 20, scrollPaddingStart: HEADER })
  const items = v.getVirtualItems()

  useEffect(() => {
    const last = items[items.length - 1]
    if (last && hasMore && !loading && last.index > rows.length - 200) void act.loadMore(repoId)
  }, [items, hasMore, loading, rows.length, repoId])

  // Keep the selected row (or the moving end of a Shift selection) in view when it changes from the keyboard.
  const selIndex = rows.findIndex((r) => r.sha === selected)
  const [extent, setExtent] = useState<string | null>(null)
  const extentIndex = multi.length && extent ? rows.findIndex((r) => r.sha === extent) : -1
  const viewIndex = extentIndex >= 0 ? extentIndex : selIndex
  useEffect(() => {
    if (viewIndex >= 0) v.scrollToIndex(viewIndex, { align: 'auto' })
  }, [viewIndex, v])

  const clickRow = (e: React.MouseEvent, sha: string): void => {
    if (sha !== 'wip' && bySha.get(sha)?.kind === 'commit' && (e.ctrlKey || e.metaKey)) {
      setExtent(null)
      return act.toggleSelect(repoId, sha, order)
    }
    if (sha !== 'wip' && bySha.get(sha)?.kind === 'commit' && e.shiftKey) {
      setExtent(sha)
      return act.extendSelect(repoId, sha, order)
    }
    setExtent(null)
    act.select(repoId, sha)
  }

  const onKey = (e: React.KeyboardEvent): void => {
    const move = (d: number): void => {
      e.preventDefault()
      if (e.shiftKey && selected && selected !== 'wip') {
        // Shift: grow or shrink the selection from its moving end, over commits only.
        const from = order.indexOf(extentIndex >= 0 && extent ? extent : selected)
        const to = order[Math.max(0, Math.min(order.length - 1, from + d))]
        if (from < 0 || !to) return
        setExtent(to)
        return act.extendSelect(repoId, to, order)
      }
      setExtent(null)
      const i = Math.max(0, Math.min(rows.length - 1, (selIndex === -1 ? -1 : selIndex) + d))
      if (rows[i]) act.select(repoId, rows[i].sha)
    }
    if (e.key === 'ArrowDown' || e.key === 'j' || e.key === 'J') move(1)
    else if (e.key === 'ArrowUp' || e.key === 'k' || e.key === 'K') move(-1)
    else if (e.key === 'Escape' && multi.length) {
      e.preventDefault()
      setExtent(null)
      act.select(repoId, selected)
    }
    else if (e.key === 'Home' && e.ctrlKey) move(-rows.length)
    else if (e.key === 'End' && e.ctrlKey) move(rows.length)
    else if (e.key === 'PageDown') move(20)
    else if (e.key === 'PageUp') move(-20)
  }

  if (!loading && rows.length === 0) {
    return (
      <div className="grid flex-1 place-items-center">
        <EmptyState
          icon={GitBranch}
          title="A blank history"
          body="Stage some files on the right and make the very first commit. No pressure."
        />
      </div>
    )
  }

  const headBranch = refs?.head.branch ?? null

  return (
    <div ref={outerRef} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div
        ref={parentRef}
        role="grid"
        aria-label="Commit history"
        aria-multiselectable
        aria-rowcount={rows.length + 1}
        tabIndex={0}
        onKeyDown={onKey}
        className="relative min-h-0 flex-1 overflow-auto outline-none focus-visible:outline-2 focus-visible:-outline-offset-2"
      >
        {/* The column header is the grid's first row, kept in view while the history scrolls. */}
        <ContextMenu items={headerMenu}>
          <div role="row" aria-rowindex={1} aria-label="Columns (right-click to show or hide)" className="sticky top-0 z-(--gc-z-panel) flex h-(--gc-list-row-h) shrink-0 items-center border-b border-border bg-surface text-xs text-muted select-none" style={{ minWidth: cols.minW }}>
            <span role="columnheader" className="flex shrink-0 items-center gap-1 px-2" style={{ width: cols.refsW }}>
              <span className="flex-1 truncate">Branch / tag</span>
              <Tooltip content={focusHead ? 'Show every branch again' : 'Show only this branch, what it tracks, and main'}>
                <IconButton label="Focus on this branch" size="sm" pressed={focusHead} onClick={() => void act.setFocusHead(repoId, !focusHead)}>
                  <Focus size={12} />
                </IconButton>
              </Tooltip>
            </span>
            <GraphHeader
              width={graphW}
              lanesW={Math.max(3, layout?.maxCols ?? 1) * LANE + 8}
              onResize={setGraphDraft}
              onDone={(w) => {
                setGraphDraft(null)
                act.setGraphWidth(repoId, w)
              }}
            />
            <span role="columnheader" className="min-w-0 flex-1 px-2">Message</span>
            {cols.shown.map((c) => (
              <ColumnHeader key={c.key} col={c} onResize={(w) => resize(c.key, w)} onDone={commitDraft} />
            ))}
          </div>
        </ContextMenu>
        <div style={{ height: v.getTotalSize(), minWidth: cols.minW, position: 'relative' }}>
          {items.map((it) => {
            const row = rows[it.index]
            const lay = layout?.rows[it.index]
            const rowRefs = byRef.get(row.sha) ?? []
            const isSel = multi.length ? multiSet.has(row.sha) : row.sha === selected
            const dimmed = (hitSet && row.kind === 'commit' && !hitSet.has(row.sha)) || (lit && !lit.has(row.sha))
            const isHead = row.kind === 'commit' && row.sha === refs?.head.sha
            const label =
              row.kind === 'wip'
                ? `Uncommitted changes, ${status?.changes.length ?? 0} files`
                : row.kind === 'stash'
                  ? `Stash: ${row.summary}`
                  : `${row.summary}, by ${row.authorName}, ${relativeTime(row.authorTime)}${rowRefs.length ? `, on ${rowRefs.map((r) => r.name).join(' and ')}` : ''}`
            return (
              <ContextMenu key={row.sha} items={multi.length && multiSet.has(row.sha) ? multiMenu(repoId, multi, line, headBranch) : rowMenu(repoId, row, rowRefs, headBranch, refs?.head.sha ?? null, line, bySha)}>
                <div
                  role="row"
                  aria-rowindex={it.index + 2}
                  aria-selected={isSel}
                  aria-label={label}
                  onClick={(e) => clickRow(e, row.sha)}
                  onDoubleClick={() => {
                    const local = rowRefs.find((r) => r.kind !== 'tag' && r.kind !== 'remote') ?? rowRefs.find((r) => r.kind === 'remote')
                    if (local && !local.isHead) void act.checkout(repoId, local.name)
                  }}
                  className={cn(
                    'absolute left-0 flex w-full cursor-default items-center text-base select-none',
                    isSel ? 'bg-row-selected' : 'hover:bg-row-hover',
                    dimmed && 'opacity-40'
                  )}
                  style={{ top: it.start, height: ROW }}
                >
                  <div
                    role="gridcell"
                    className="flex shrink-0 items-center gap-1 overflow-hidden px-2"
                    style={{ width: cols.refsW }}
                    onMouseEnter={() => rowRefs.length && setHoverSha(row.sha)}
                    onMouseLeave={() => setHoverSha(null)}
                  >
                    {rowRefs.slice(0, 1).map((r) => (
                      <DraggableRef key={r.key} r={r} lane={lay?.color ?? 0} onDrop={(t) => setDrop(t)} repoId={repoId} />
                    ))}
                    {rowRefs.length > 1 ? (
                      // Only the first branch gets a pill; the rest are one click away, with the same actions as the row menu.
                      <DropdownMenu
                        trigger={
                          <button
                            type="button"
                            aria-label={`${rowRefs.length - 1} more on this commit: ${rowRefs.slice(1).map((r) => r.name).join(', ')}`}
                            title={rowRefs.slice(1).map((r) => r.name).join(', ')}
                            onClick={(e) => e.stopPropagation()}
                            className="shrink-0 rounded-pill border border-border bg-surface-raised px-1.5 text-xs text-muted hover:bg-row-hover hover:text-text"
                          >
                            +{rowRefs.length - 1}
                          </button>
                        }
                        items={rowMenu(repoId, row, rowRefs.slice(1), headBranch, refs?.head.sha ?? null, line, bySha).filter((e) => e.type === 'sub')}
                      />
                    ) : null}
                  </div>
                  <div role="gridcell" className="shrink-0 overflow-hidden" style={{ width: graphW }}>
                    {lay ? <Lanes layout={lay} kind={row.kind} isHead={isHead} /> : null}
                  </div>
                  <div role="gridcell" className="flex min-w-0 flex-1 items-center gap-2 px-2">
                    {row.kind === 'wip' ? (
                      <span className="truncate text-muted italic">
                        Uncommitted changes
                        <span className="ml-2 text-sm not-italic">{summarizeChanges(status?.changes ?? [])}</span>
                      </span>
                    ) : row.kind === 'stash' ? (
                      <span className="flex min-w-0 items-center gap-1.5 text-muted">
                        <Archive size={14} aria-hidden className="shrink-0" />
                        <span className="truncate">{row.summary}</span>
                      </span>
                    ) : (
                      <span className={cn('truncate text-text', isHead && 'font-medium')}>{row.summary}</span>
                    )}
                  </div>
                  {cols.shown.map((c) =>
                    c.key === 'author' ? (
                      <div key="author" role="gridcell" className="flex shrink-0 items-center gap-1.5 overflow-hidden px-2" style={{ width: c.width }}>
                        {row.kind === 'commit' ? (
                          <>
                            <Avatar name={row.authorName} email={row.authorEmail} decorative />
                            <span className="truncate text-sm text-muted">{row.authorName}</span>
                          </>
                        ) : null}
                      </div>
                    ) : c.key === 'date' ? (
                      <div key="date" role="gridcell" className="shrink-0 truncate px-2 text-sm text-muted" style={{ width: c.width }} title={row.authorTime ? fullDate(row.authorTime) : undefined}>
                        {row.authorTime ? relativeTime(row.authorTime) : ''}
                      </div>
                    ) : (
                      <div key="sha" role="gridcell" className="shrink-0 truncate px-2 font-mono text-xs text-muted" style={{ width: c.width }}>
                        {row.kind === 'commit' ? shortSha(row.sha) : ''}
                      </div>
                    )
                  )}
                </div>
              </ContextMenu>
            )
          })}
        </div>
        {loading && rows.length === 0 ? <GraphSkeleton /> : null}
      </div>
      {drop ? <DropMenu repoId={repoId} target={drop} headBranch={headBranch} onClose={() => setDrop(null)} /> : null}
    </div>
  )
}

function summarizeChanges(changes: { index: string; worktree: string }[]): string {
  const staged = changes.filter((c) => c.index !== '.' && c.index !== '?').length
  const unstaged = changes.length - staged
  return [staged ? `${staged} staged` : '', unstaged ? `${unstaged} not staged` : ''].filter(Boolean).join(', ')
}

function GraphSkeleton(): React.JSX.Element {
  return (
    <div className="absolute inset-0 flex flex-col" aria-label="Loading history" role="status">
      {Array.from({ length: 12 }, (_, i) => (
        <div key={i} className="flex h-7 items-center gap-3 px-3">
          <div className="h-3 w-28 rounded-sm bg-surface-raised" />
          <div className="size-3 rounded-pill bg-surface-raised" />
          <div className="h-3 rounded-sm bg-surface-raised" style={{ width: `${30 + ((i * 37) % 40)}%` }} />
        </div>
      ))}
    </div>
  )
}

function DraggableRef({ r, lane, onDrop, repoId }: { r: DisplayRef; lane: number; onDrop: (t: DropTarget) => void; repoId: string }): React.JSX.Element {
  const [over, setOver] = useState(false)
  const canDrag = r.kind !== 'tag'
  return (
    <span
      draggable={canDrag}
      onDragStart={(e: DragEvent) => {
        e.dataTransfer.setData('application/x-caboose-ref', JSON.stringify({ repoId, name: r.name, kind: r.kind }))
        e.dataTransfer.effectAllowed = 'move'
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('application/x-caboose-ref')) {
          e.preventDefault()
          setOver(true)
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false)
        const data = e.dataTransfer.getData('application/x-caboose-ref')
        if (!data) return
        const src = JSON.parse(data) as { repoId: string; name: string; kind: string }
        if (src.repoId !== repoId || src.name === r.name) return
        onDrop({ source: src.name, sourceKind: src.kind, target: r.name, targetKind: r.kind, x: e.clientX, y: e.clientY })
      }}
      className={cn('min-w-0 rounded-sm', over && 'outline-2 outline-dashed outline-accent')}
    >
      <RefPill name={r.label} kind={r.kind} remote={r.remote} lane={lane} current={r.isHead} />
    </span>
  )
}

export function stashMenu(repoId: string, sha: string, label: string): MenuEntry[] {
  return [
    { type: 'item', label: 'Pop (apply and delete)', icon: <ArchiveRestore size={14} />, onSelect: () => void act.stashApply(repoId, sha, true) },
    { type: 'item', label: 'Apply (keep the stash)', onSelect: () => void act.stashApply(repoId, sha, false) },
    { type: 'item', label: 'Rename…', icon: <Pencil size={14} />, onSelect: () => act.openDialog({ kind: 'renameStash', repoId, sha, message: label.replace(/^On [^:]+: /, '') }) },
    { type: 'separator' },
    { type: 'item', label: 'Delete stash…', danger: true, icon: <Trash2 size={14} />, onSelect: () => act.stashDrop(repoId, sha, label) }
  ]
}

/** Can these commits (newest first) be squashed: all on the branch's line, side by side, no merges, not the first commit? */
export function squashProblem(shas: string[], line: string[], parentsOf: (sha: string) => string[] | undefined): string | null {
  const idx = shas.map((s) => line.indexOf(s)).sort((a, b) => a - b)
  if (idx.some((i) => i < 0)) return 'Only commits on the checked-out branch’s own line can be squashed.'
  if (idx.some((v, i) => i > 0 && v !== idx[i - 1] + 1)) return 'Pick commits that sit next to each other.'
  if (shas.some((s) => (parentsOf(s)?.length ?? 1) > 1)) return 'Merge commits can’t be squashed here.'
  if (shas.some((s) => parentsOf(s)?.length === 0)) return 'The very first commit can’t be squashed into.'
  if (line.slice(0, idx[0]).some((s) => (parentsOf(s)?.length ?? 1) > 1)) return 'There’s a merge commit after these on the branch, and squashing would flatten it.'
  return null
}

/** The right-click menu for several selected commits. */
function multiMenu(repoId: string, shas: string[], line: string[], headBranch: string | null): MenuEntry[] {
  const r = useApp.getState().repos[repoId]
  const parentsOf = (sha: string): string[] | undefined => r?.commits.find((c) => c.sha === sha)?.parents
  const here = headBranch ?? 'HEAD'
  const onLine = shas.every((s) => line.includes(s))
  const offLine = shas.every((s) => !line.includes(s))
  return [
    { type: 'item', label: `Squash ${shas.length} commits into one…`, icon: <Combine size={14} />, disabled: !!squashProblem(shas, line, parentsOf), onSelect: () => act.askSquash(repoId, shas) },
    { type: 'item', label: `Rebase these ${shas.length} commits…`, icon: <ListOrdered size={14} />, disabled: !onLine, onSelect: () => act.rebaseRange(repoId, shas) },
    { type: 'item', label: `Cherry-pick ${shas.length} commits onto ${here}`, icon: <GitPullRequestArrow size={14} />, disabled: !offLine, onSelect: () => void act.cherryPick(repoId, [...shas].reverse()) },
    { type: 'separator' },
    { type: 'item', label: 'Copy commit SHAs', icon: <Copy size={14} />, onSelect: () => void navigator.clipboard.writeText(shas.join('\n')) },
    { type: 'item', label: 'Clear the selection', shortcut: 'Esc', onSelect: () => act.select(repoId, shas[0]) }
  ]
}

function rowMenu(repoId: string, row: CommitRow, refs: DisplayRef[], headBranch: string | null, headSha: string | null, line: string[], bySha: Map<string, CommitRow>): MenuEntry[] {
  if (row.kind === 'wip') {
    return [
      { type: 'item', label: 'Stage all changes', onSelect: () => void act.stage(repoId, 'all') },
      { type: 'item', label: 'Stash changes…', icon: <Archive size={14} />, onSelect: () => act.openDialog({ kind: 'stash', repoId }) },
      { type: 'item', label: 'Discard all changes…', danger: true, icon: <Trash2 size={14} />, onSelect: () => act.discard(repoId, 'all') }
    ]
  }
  if (row.kind === 'stash') return stashMenu(repoId, row.sha, row.summary)
  const entries: MenuEntry[] = []
  const remotes = useApp.getState().repos[repoId]?.refs?.remotes ?? []
  for (const r of refs.filter((x) => x.kind !== 'tag')) {
    const items: MenuEntry[] = []
    if (!r.isHead) items.push({ type: 'item', label: `Check out ${r.name}`, icon: <GitBranch size={14} />, onSelect: () => void act.checkout(repoId, r.name) })
    if (headBranch && !r.isHead) {
      items.push({ type: 'item', label: `Merge ${r.name} into ${headBranch}`, icon: <GitMerge size={14} />, onSelect: () => void act.mergeInto(repoId, r.name, headBranch) })
      items.push({ type: 'item', label: `Rebase ${headBranch} onto ${r.name}`, icon: <GitPullRequestArrow size={14} />, onSelect: () => void act.rebaseOnto(repoId, headBranch, r.name) })
    }
    if (r.local) {
      items.push(pushEntry(repoId, { name: r.name, isHead: r.isHead, upstream: r.local.upstream }, remotes))
      items.push({ type: 'item', label: 'Rename…', onSelect: () => act.openDialog({ kind: 'renameBranch', repoId, name: r.name }) })
      items.push({ type: 'item', label: 'Delete…', danger: true, icon: <Trash2 size={14} />, disabled: r.isHead, onSelect: () => act.deleteBranch(repoId, r.name) })
    }
    const onRemote = act.remoteBranchOf(repoId, r.kind === 'remote' ? r.key : r.local?.upstream)
    if (onRemote) {
      items.push({ type: 'item', label: `Delete ${onRemote.remote}/${onRemote.name}…`, danger: true, icon: <Trash2 size={14} />, onSelect: () => act.deleteRemoteBranch(repoId, onRemote.remote, onRemote.name) })
    }
    entries.push({ type: 'sub', label: r.name, icon: <GitBranch size={14} />, items })
  }
  for (const r of refs.filter((x) => x.kind === 'tag')) entries.push({ type: 'sub', label: r.name, icon: <Tag size={14} />, items: tagMenu(repoId, r.name, remotes) })
  if (entries.length) entries.push({ type: 'separator' })
  const short = shortSha(row.sha)
  const here = headBranch ?? 'HEAD'
  const isHead = row.sha === headSha
  entries.push(
    { type: 'item', label: 'Create branch here…', icon: <Plus size={14} />, shortcut: 'Ctrl+B', onSelect: () => act.openDialog({ kind: 'createBranch', repoId, at: row.sha, atLabel: short }) },
    { type: 'item', label: 'Create tag here…', icon: <Tag size={14} />, onSelect: () => act.openDialog({ kind: 'createTag', repoId, at: row.sha, atLabel: short }) },
    { type: 'item', label: 'Check out this commit (detached)', onSelect: () => void act.checkout(repoId, row.sha) },
    { type: 'separator' }
  )
  if (!isHead && headSha) {
    entries.push(
      { type: 'item', label: `Cherry-pick onto ${here}`, icon: <GitPullRequestArrow size={14} />, onSelect: () => void act.cherryPick(repoId, [row.sha]) },
      { type: 'item', label: `Pick several commits up to here…`, icon: <ListOrdered size={14} />, onSelect: () => act.setCenter(repoId, { kind: 'cherry', tip: row.sha, tipLabel: short }) },
      { type: 'item', label: `Rewrite ${here} after this commit…`, icon: <ListOrdered size={14} />, onSelect: () => act.setCenter(repoId, { kind: 'rebase', onto: row.sha, ontoLabel: short }) },
      { type: 'item', label: `Reset ${here} to this commit…`, icon: <RotateCcw size={14} />, onSelect: () => act.openDialog({ kind: 'reset', repoId, target: row.sha, targetLabel: short }) }
    )
  }
  const at = line.indexOf(row.sha)
  if (at >= 0) {
    const isMerge = (sha: string | undefined): boolean => !sha || (bySha.get(sha)?.parents.length ?? 0) !== 1
    const newer = line[at - 1]
    const older = line[at + 1]
    // A merge between this commit and the tip would be flattened by the rebase underneath, so none of these apply.
    const mergeAfter = line.slice(0, at).some((s) => isMerge(s))
    entries.push(
      { type: 'item', label: 'Edit message…', icon: <Pencil size={14} />, disabled: row.parents.length > 1 || mergeAfter, onSelect: () => act.editMessage(repoId, row.sha) },
      { type: 'item', label: 'Move commit up', icon: <ArrowUp size={14} />, disabled: !newer || mergeAfter || isMerge(row.sha), onSelect: () => act.moveCommit(repoId, row.sha, 'up') },
      // Moving below the first commit isn't possible: the older neighbour needs a parent too.
      { type: 'item', label: 'Move commit down', icon: <ArrowDown size={14} />, disabled: !older || mergeAfter || isMerge(row.sha) || isMerge(older), onSelect: () => act.moveCommit(repoId, row.sha, 'down') },
      { type: 'separator' }
    )
  }
  entries.push(
    { type: 'item', label: 'Revert this commit', icon: <Undo size={14} />, onSelect: () => act.revert(repoId, row.sha, row.parents.length > 1) },
    { type: 'separator' },
    { type: 'item', label: 'Copy commit SHA', icon: <Copy size={14} />, onSelect: () => void navigator.clipboard.writeText(row.sha) }
  )
  return entries
}

export function useGraphFocus(): void {
  const active = useApp((s) => s.active)
  useEffect(() => {
    if (active !== 'home') (document.querySelector('[role=grid]') as HTMLElement | null)?.focus()
  }, [active])
}

import { useEffect, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Copy, FileWarning, GitBranch, GitPullRequestArrow, History, Plus, RotateCcw, X } from 'lucide-react'
import type { ReflogEntry } from '../../../shared/types'
import { Badge, Button, ContextMenu, EmptyState, IconButton, Tooltip, type MenuEntry } from '@/ui'
import { cn } from '@/ui/cn'
import { call } from '@/lib/api'
import { fullDate, relativeTime, shortSha } from '@/lib/format'
import { useRepo } from '@/store'
import * as act from '@/actions'

const LIMIT = 1000
const ROW = 44

/** git's words for a move, split into the kind ("checkout", "commit (amend)") and the rest. */
function splitMessage(m: string): { kind: string; rest: string } {
  const i = m.indexOf(': ')
  return i < 0 ? { kind: m, rest: '' } : { kind: m.slice(0, i), rest: m.slice(i + 2) }
}

/**
 * Where HEAD has been: every checkout, commit, reset, rebase and pull, newest first, from git's reflog. Commits that
 * no branch leads to any more are marked, and any of them can be brought back with a branch, a checkout or a reset.
 */
export function ReflogView({ repoId }: { repoId: string }): React.JSX.Element {
  const [rows, setRows] = useState<ReflogEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pick, setPick] = useState(0)
  // A new branch or tag can bring a lost commit back, so the list is read again whenever the refs change.
  const refs = useRepo(repoId, (r) => r.refs)
  const headSha = refs?.head.sha
  const headBranch = useRepo(repoId, (r) => r.refs?.head.branch ?? null)
  const scroller = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let live = true
    setError(null)
    call('reflog.list', { repoId, limit: LIMIT })
      .then((r) => {
        if (!live) return
        setRows(r)
        setPick((p) => (r[p] ? p : 0))
      })
      .catch((e: Error) => live && setError(e.message))
    return () => {
      live = false
    }
  }, [repoId, refs])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !document.querySelector('[role=dialog],[role=menu]')) act.setCenter(repoId, { kind: 'graph' })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [repoId])

  const list = rows ?? []
  const v = useVirtualizer({ count: list.length, getScrollElement: () => scroller.current, estimateSize: () => ROW, overscan: 10 })
  const cur = list[pick]
  useEffect(() => {
    if (!list.length) return
    v.scrollToIndex(pick, { align: 'auto' })
    // The details panel shows the commit this move went to.
    act.select(repoId, list[pick].sha)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pick, list])

  const onKey = (e: React.KeyboardEvent): void => {
    const d = e.key === 'ArrowDown' || e.key === 'j' ? 1 : e.key === 'ArrowUp' || e.key === 'k' ? -1 : 0
    if (!d) return
    e.preventDefault()
    setPick((p) => Math.max(0, Math.min(list.length - 1, p + d)))
  }

  const here = headBranch ?? 'HEAD'
  const actions = (r: ReflogEntry): MenuEntry[] => {
    const short = shortSha(r.sha)
    const isHead = r.sha === headSha
    return [
      { type: 'item', label: 'Create branch here…', icon: <Plus size={14} />, onSelect: () => act.openDialog({ kind: 'createBranch', repoId, at: r.sha, atLabel: short }) },
      { type: 'item', label: 'Check out this commit (detached)', icon: <GitBranch size={14} />, disabled: isHead, onSelect: () => void act.checkout(repoId, r.sha) },
      { type: 'item', label: `Reset ${here} to this commit…`, icon: <RotateCcw size={14} />, disabled: isHead, onSelect: () => act.openDialog({ kind: 'reset', repoId, target: r.sha, targetLabel: short }) },
      { type: 'item', label: `Cherry-pick onto ${here}`, icon: <GitPullRequestArrow size={14} />, disabled: isHead || !headSha, onSelect: () => void act.cherryPick(repoId, [r.sha]) },
      { type: 'separator' },
      { type: 'item', label: 'Copy commit SHA', icon: <Copy size={14} />, onSelect: () => void navigator.clipboard.writeText(r.sha) }
    ]
  }

  return (
    <section aria-label="Reflog" className="flex min-h-0 min-w-0 flex-1 flex-col bg-bg">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-surface px-3">
        <History size={16} aria-hidden className="shrink-0 text-muted" />
        <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
          <span className="truncate text-base font-medium text-text">Where HEAD has been</span>
          <span className="shrink-0 text-xs text-muted">· {rows ? `${rows.length}${rows.length === LIMIT ? '+' : ''} moves` : 'Reflog'}</span>
        </div>
        {cur ? (
          <>
            <Button size="sm" variant="secondary" onClick={() => act.openDialog({ kind: 'createBranch', repoId, at: cur.sha, atLabel: shortSha(cur.sha) })}>
              <Plus size={14} aria-hidden />
              Create branch here…
            </Button>
            <Button size="sm" disabled={cur.sha === headSha} onClick={() => act.openDialog({ kind: 'reset', repoId, target: cur.sha, targetLabel: shortSha(cur.sha) })}>
              <RotateCcw size={14} aria-hidden />
              Reset {here} here…
            </Button>
          </>
        ) : null}
        <Tooltip content="Close" shortcut="Esc">
          <IconButton label="Close the reflog" onClick={() => act.setCenter(repoId, { kind: 'graph' })}>
            <X size={16} />
          </IconButton>
        </Tooltip>
      </header>
      <p className="shrink-0 border-b border-border bg-surface-sunken px-3 py-1 text-sm text-muted">
        Every checkout, commit, reset, rebase and pull in this repository, newest first, as git recorded it. Commits marked “not on a branch” can only be found here: create a branch to keep one.
      </p>
      {error ? (
        <EmptyState icon={FileWarning} title="Couldn’t read the reflog" body={error} actions={<Button onClick={() => act.setCenter(repoId, { kind: 'graph' })}>Back to the graph</Button>} />
      ) : rows && rows.length === 0 ? (
        <EmptyState icon={History} title="Nothing recorded yet" body="Git records where HEAD goes from the first commit or checkout on." />
      ) : (
        <div
          ref={scroller}
          role="listbox"
          aria-label="Moves of HEAD, newest first"
          aria-activedescendant={cur ? `rl-${cur.index}` : undefined}
          tabIndex={0}
          onKeyDown={onKey}
          className="min-h-0 flex-1 overflow-y-auto outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring"
        >
          {!rows ? (
            <div role="status" aria-label="Loading the reflog" className="flex flex-col gap-3 p-3">
              {Array.from({ length: 8 }, (_, i) => (
                <div key={i} className="h-3 w-3/4 rounded-sm bg-surface-raised" />
              ))}
            </div>
          ) : (
            <div style={{ height: v.getTotalSize(), position: 'relative' }}>
              {v.getVirtualItems().map((it) => {
                const r = list[it.index]
                const { kind, rest } = splitMessage(r.message)
                return (
                  <ContextMenu key={r.index} items={actions(r)}>
                    <div
                      id={`rl-${r.index}`}
                      role="option"
                      aria-selected={it.index === pick}
                      aria-label={`${r.message}, ${shortSha(r.sha)}${r.lost ? ', not on a branch' : ''}`}
                      onClick={() => setPick(it.index)}
                      onContextMenu={() => setPick(it.index)}
                      className={cn('absolute left-0 flex w-full cursor-default items-center gap-3 border-b border-border px-3', it.index === pick ? 'bg-row-selected' : 'hover:bg-row-hover')}
                      style={{ top: it.start, height: ROW }}
                    >
                      <span className="w-14 shrink-0 font-mono text-xs text-muted">{shortSha(r.sha)}</span>
                      <div className="min-w-0 flex-1 leading-tight">
                        <p className="truncate text-base text-text">
                          <span className="font-medium">{kind}</span>
                          {rest ? <span className="text-muted">: {rest}</span> : null}
                        </p>
                        <p className="truncate text-xs text-muted" title={fullDate(r.time)}>
                          {relativeTime(r.time)} · {r.summary} · {r.authorName}
                        </p>
                      </div>
                      {r.sha === headSha && r.index === 0 ? <Badge tone="accent">HEAD</Badge> : null}
                      {r.lost ? <Badge tone="warning">not on a branch</Badge> : null}
                    </div>
                  </ContextMenu>
                )
              })}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

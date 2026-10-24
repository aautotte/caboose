import { useEffect, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { FileWarning, History, UserSearch, X } from 'lucide-react'
import type { FileHistoryEntry } from '../../../shared/types'
import { Avatar, Button, EmptyState, IconButton, StatusIcon, Tooltip } from '@/ui'
import { cn } from '@/ui/cn'
import { call } from '@/lib/api'
import { fullDate, relativeTime, shortSha, splitPath } from '@/lib/format'
import { setPrefs, useApp, useRepo } from '@/store'
import { Splitter } from '@/ui'
import { DiffView } from '@/diff/DiffView'
import { toStatus } from '@/detail/FileList'
import * as act from '@/actions'

const LIMIT = 1000
const ROW = 44

/** S09: every commit that touched one file, following renames, with that commit's change on the right. */
export function FileHistoryView({ repoId, path }: { repoId: string; path: string }): React.JSX.Element {
  const [rows, setRows] = useState<FileHistoryEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pick, setPick] = useState(0)
  const headSha = useRepo(repoId, (r) => r.refs?.head.sha)
  const listW = useApp((s) => s.prefs.historyListWidth)
  const scroller = useRef<HTMLDivElement>(null)
  const { dir, name } = splitPath(path)

  useEffect(() => {
    let live = true
    setRows(null)
    setError(null)
    setPick(0)
    call('file.history', { repoId, path, limit: LIMIT })
      .then((r) => live && setRows(r))
      .catch((e: Error) => live && setError(e.message))
    return () => {
      live = false
    }
  }, [repoId, path, headSha])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !document.querySelector('[role=dialog],[role=menu]')) act.setCenter(repoId, { kind: 'graph' })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [repoId])

  const list = rows ?? []
  const v = useVirtualizer({ count: list.length, getScrollElement: () => scroller.current, estimateSize: () => ROW, overscan: 10 })
  useEffect(() => {
    if (list.length) v.scrollToIndex(pick, { align: 'auto' })
  }, [pick, list.length, v])
  const cur = list[pick]

  const onKey = (e: React.KeyboardEvent): void => {
    const d = e.key === 'ArrowDown' || e.key === 'j' ? 1 : e.key === 'ArrowUp' || e.key === 'k' ? -1 : 0
    if (!d) return
    e.preventDefault()
    setPick((p) => Math.max(0, Math.min(list.length - 1, p + d)))
  }

  return (
    <section aria-label={`History of ${path}`} className="flex min-h-0 min-w-0 flex-1 flex-col bg-bg">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-surface px-3">
        <History size={16} aria-hidden className="shrink-0 text-muted" />
        <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
          <span className="truncate text-sm text-muted">{dir}</span>
          <span className="truncate text-base font-medium text-text">{name}</span>
          <span className="shrink-0 text-xs text-muted">
            · {rows ? `${rows.length}${rows.length === LIMIT ? '+' : ''} commit${rows.length === 1 ? '' : 's'}` : 'History'}
          </span>
        </div>
        <Tooltip content="Blame the current version: who changed each line">
          <IconButton label="Blame the current version" onClick={() => act.setCenter(repoId, { kind: 'blame', path, rev: null })}>
            <UserSearch size={16} />
          </IconButton>
        </Tooltip>
        <Tooltip content="Close" shortcut="Esc">
          <IconButton label="Close file history" onClick={() => act.setCenter(repoId, { kind: 'graph' })}>
            <X size={16} />
          </IconButton>
        </Tooltip>
      </header>
      {error ? (
        <EmptyState
          icon={FileWarning}
          title="Couldn’t read this file’s history"
          body={error}
          actions={<Button onClick={() => act.setCenter(repoId, { kind: 'graph' })}>Back to the graph</Button>}
        />
      ) : rows && rows.length === 0 ? (
        <EmptyState icon={History} title="No commits yet" body="This file hasn’t been committed. Its history starts with its first commit." />
      ) : (
        <div className="flex min-h-0 flex-1">
          <div
            ref={scroller}
            role="listbox"
            aria-label="Commits that changed this file"
            aria-activedescendant={cur ? `fh-${cur.sha}` : undefined}
            tabIndex={0}
            onKeyDown={onKey}
            className="min-h-0 shrink-0 overflow-y-auto bg-surface outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring"
            style={{ width: listW }}
          >
            {!rows ? (
              <div role="status" aria-label="Loading history" className="flex flex-col gap-3 p-3">
                {Array.from({ length: 8 }, (_, i) => (
                  <div key={i} className="flex flex-col gap-1.5">
                    <div className="h-3 w-3/4 rounded-sm bg-surface-raised" />
                    <div className="h-2.5 w-1/3 rounded-sm bg-surface-raised" />
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ height: v.getTotalSize(), position: 'relative' }}>
                {v.getVirtualItems().map((it) => {
                  const r = list[it.index]
                  const renamed = r.oldPath && r.oldPath !== r.path
                  return (
                    <div
                      key={r.sha}
                      id={`fh-${r.sha}`}
                      role="option"
                      aria-selected={it.index === pick}
                      onClick={() => setPick(it.index)}
                      className={cn(
                        'absolute left-0 flex w-full cursor-default items-center gap-2 border-b border-border px-3',
                        it.index === pick ? 'bg-row-selected' : 'hover:bg-row-hover'
                      )}
                      style={{ top: it.start, height: ROW }}
                    >
                      <Avatar name={r.authorName} email={r.authorEmail} decorative />
                      <div className="min-w-0 flex-1 leading-tight">
                        <p className="truncate text-base text-text">{r.summary}</p>
                        <p className="truncate text-xs text-muted" title={fullDate(r.authorTime)}>
                          {r.authorName} · {relativeTime(r.authorTime)} · <span className="font-mono">{shortSha(r.sha)}</span>
                          {renamed ? ` · renamed from ${splitPath(r.oldPath!).name}` : ''}
                        </p>
                      </div>
                      <StatusIcon kind={toStatus(r.status)} />
                    </div>
                  )
                })}
              </div>
            )}
          </div>
          <Splitter label="Resize the commit list" value={listW} min={220} max={560} defaultValue={320} onChange={(w) => setPrefs({ historyListWidth: w })} />
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {cur ? (
              <>
                <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border bg-surface-sunken px-3 text-sm text-muted">
                  <span className="min-w-0 flex-1 truncate">
                    {cur.parents.length > 1 ? 'Merge commit, compared with its first parent' : cur.parents.length === 0 ? 'First commit' : 'Change in this commit'}
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => act.select(repoId, cur.sha)}>
                    Commit details
                  </Button>
                </div>
                <DiffView
                  key={cur.sha}
                  embedded
                  repoId={repoId}
                  path={cur.path}
                  oldPath={cur.oldPath}
                  source={{ kind: 'commit', sha: cur.sha, parent: cur.parents[0] }}
                />
              </>
            ) : null}
          </div>
        </div>
      )}
    </section>
  )
}

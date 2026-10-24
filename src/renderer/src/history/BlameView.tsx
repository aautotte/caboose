import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { FileDiff as FileDiffIcon, FileWarning, History, X } from 'lucide-react'
import type { Blame } from '../../../shared/types'
import { Button, EmptyState, IconButton, Tooltip } from '@/ui'
import { cn } from '@/ui/cn'
import { call } from '@/lib/api'
import { fullDate, relativeTime, shortSha, splitPath } from '@/lib/format'
import { useRepo } from '@/store'
import * as act from '@/actions'
import { highlightLine, languageFor } from '@/diff/highlight'

const ROW = 20

/** Same person, same colour: a lane colour picked from their email. */
function personColor(email: string): string {
  let h = 0
  for (const c of email) h = (h * 31 + c.charCodeAt(0)) | 0
  return `var(--gc-color-lane-${Math.abs(h) % 8})`
}

/** S08: the whole file, each line with the commit that last changed it. */
export function BlameView({ repoId, path, rev }: { repoId: string; path: string; rev: string | null }): React.JSX.Element {
  const [blame, setBlame] = useState<Blame | null>(null)
  const [error, setError] = useState<string | null>(null)
  const headSha = useRepo(repoId, (r) => r.refs?.head.sha)
  const selected = useRepo(repoId, (r) => r.selected)
  const scroller = useRef<HTMLDivElement>(null)
  const lang = useMemo(() => languageFor(path), [path])
  const { dir, name } = splitPath(path)

  useEffect(() => {
    let live = true
    setBlame(null)
    setError(null)
    call('file.blame', { repoId, path, rev })
      .then((b) => live && setBlame(b))
      .catch((e: Error) => live && setError(e.message))
    return () => {
      live = false
    }
  }, [repoId, path, rev, headSha])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !document.querySelector('[role=dialog],[role=menu]')) act.setCenter(repoId, { kind: 'graph' })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [repoId])

  const lines = blame?.lines ?? []
  const v = useVirtualizer({ count: lines.length, getScrollElement: () => scroller.current, estimateSize: () => ROW, overscan: 30 })
  const oldest = useMemo(() => Math.min(...Object.values(blame?.commits ?? {}).filter((c) => !c.uncommitted).map((c) => c.time)), [blame])
  const newest = useMemo(() => Math.max(...Object.values(blame?.commits ?? {}).map((c) => c.time || Date.now() / 1000)), [blame])

  return (
    <section aria-label={`Blame for ${path}`} className="flex min-h-0 min-w-0 flex-1 flex-col bg-bg">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-surface px-3">
        <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
          <span className="truncate text-sm text-muted">{dir}</span>
          <span className="truncate text-base font-medium text-text">{name}</span>
          <span className="shrink-0 text-xs text-muted">· Blame {rev ? `at ${shortSha(rev)}` : 'of your working copy'}</span>
        </div>
        <Tooltip content="Show this file’s changes">
          <IconButton
            label="Show changes"
            onClick={() => act.openDiff(repoId, path, rev ? { kind: 'commit', sha: rev } : { kind: 'worktree' })}
          >
            <FileDiffIcon size={16} />
          </IconButton>
        </Tooltip>
        <Tooltip content="File history">
          <IconButton label="File history" onClick={() => act.setCenter(repoId, { kind: 'history', path })}>
            <History size={16} />
          </IconButton>
        </Tooltip>
        <Tooltip content="Close" shortcut="Esc">
          <IconButton label="Close blame" onClick={() => act.setCenter(repoId, { kind: 'graph' })}>
            <X size={16} />
          </IconButton>
        </Tooltip>
      </header>
      {error ? (
        <EmptyState
          icon={FileWarning}
          title="Couldn’t blame this file"
          body={error}
          actions={<Button onClick={() => act.setCenter(repoId, { kind: 'graph' })}>Back to the graph</Button>}
        />
      ) : !blame ? (
        <div role="status" aria-label="Loading blame" className="flex flex-col gap-1.5 p-4">
          {Array.from({ length: 14 }, (_, i) => (
            <div key={i} className="flex gap-3">
              <div className="h-3 w-48 rounded-sm bg-surface-raised" />
              <div className="h-3 rounded-sm bg-surface-raised" style={{ width: `${20 + ((i * 37) % 55)}%` }} />
            </div>
          ))}
        </div>
      ) : lines.length === 0 ? (
        <EmptyState icon={FileWarning} title="This file is empty" body="Not a single line in it." />
      ) : (
        <div ref={scroller} role="table" aria-label={`${path}, ${lines.length} lines`} aria-rowcount={lines.length} className="min-h-0 flex-1 overflow-auto font-mono text-code">
          <div style={{ height: v.getTotalSize(), position: 'relative' }} className="w-max min-w-full">
            {v.getVirtualItems().map((it) => {
              const l = lines[it.index]
              const c = blame.commits[l.sha]
              const first = it.index === 0 || lines[it.index - 1].sha !== l.sha
              const age = newest > oldest && !c.uncommitted ? (c.time - oldest) / (newest - oldest) : 1
              return (
                <div
                  key={it.index}
                  role="row"
                  aria-rowindex={it.index + 1}
                  className={cn('absolute left-0 flex w-full', first && it.index > 0 && 'border-t border-border', selected === l.sha && 'bg-row-selected')}
                  style={{ top: it.start, height: ROW }}
                >
                  <span aria-hidden className="w-1 shrink-0" style={{ background: c.uncommitted ? 'var(--gc-color-warning)' : personColor(c.email), opacity: 0.35 + 0.65 * age }} />
                  <span role="cell" className="flex shrink-0">
                  <button
                    type="button"
                    tabIndex={first ? 0 : -1}
                    disabled={c.uncommitted}
                    onClick={() => act.select(repoId, l.sha)}
                    title={c.uncommitted ? 'Not committed yet' : `${c.summary}\n${c.author} · ${fullDate(c.time)} · ${shortSha(c.sha)}`}
                    className="flex w-80 shrink-0 items-center gap-2 overflow-hidden border-r border-border px-2 text-left font-sans text-sm enabled:hover:bg-row-hover"
                  >
                    {first ? (
                      c.uncommitted ? (
                        <span className="truncate text-warning">Not committed yet</span>
                      ) : (
                        <>
                          <span className="w-24 shrink-0 truncate text-muted">{c.author}</span>
                          <span className="min-w-0 flex-1 truncate text-text">{c.summary}</span>
                          <span className="shrink-0 text-xs text-muted">{relativeTime(c.time)}</span>
                        </>
                      )
                    ) : null}
                  </button>
                  </span>
                  <span role="cell" className="w-12 shrink-0 pr-2 text-right text-disabled select-none">
                    {l.line}
                  </span>
                  <span role="cell" className="hljs-line px-2 whitespace-pre" dangerouslySetInnerHTML={{ __html: highlightLine(l.text, lang) || ' ' }} />
                </div>
              )
            })}
          </div>
        </div>
      )}
    </section>
  )
}

import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, GitCommitHorizontal, GripVertical, ListRestart, X } from 'lucide-react'
import type { RebaseAction, RebaseRow } from '../../../shared/types'
import { Avatar, Button, Dialog, EmptyState, Field, IconButton, TextArea, TextInput, Tooltip } from '@/ui'
import { cn } from '@/ui/cn'
import { call } from '@/lib/api'
import { plural, relativeTime, shortSha } from '@/lib/format'
import { useRepo } from '@/store'
import * as act from '@/actions'

interface Step {
  row: RebaseRow
  action: RebaseAction
  message?: string
}

const actions: Array<{ value: RebaseAction; key: string; label: string; help: string }> = [
  { value: 'pick', key: 'p', label: 'Keep', help: 'Keep this commit as it is' },
  { value: 'reword', key: 'r', label: 'Reword', help: 'Keep it, with a new message' },
  { value: 'squash', key: 's', label: 'Squash', help: 'Fold into the commit above, keeping both messages' },
  { value: 'fixup', key: 'f', label: 'Fixup', help: 'Fold into the commit above, dropping this message' },
  { value: 'drop', key: 'd', label: 'Drop', help: 'Leave this commit out' }
]

/**
 * S11, two modes.
 *   rebase: rewrite the commits after `onto` on the current branch (keep, reword, squash, fixup, drop, reorder).
 *   cherry: copy commits from `tip` onto the current branch (keep or skip, reorder).
 * The list runs oldest first, top to bottom, which is the order git replays them.
 */
export function RebaseView({ repoId, mode, base, baseLabel, range }: { repoId: string; mode: 'rebase' | 'cherry'; base: string; baseLabel: string; range?: string[] }): React.JSX.Element {
  const [allRows, setRows] = useState<RebaseRow[] | null>(null)
  // With a range (commits picked in the graph), only those are offered; the newer ones are replayed as they are.
  const rangeKey = range?.join(',')
  const rows = useMemo(() => (allRows && range ? allRows.filter((r) => range.includes(r.sha)) : allRows), [allRows, rangeKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const tail = useMemo(() => (allRows && range ? allRows.filter((r) => !range.includes(r.sha)) : []), [allRows, rangeKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const [merges, setMerges] = useState(0)
  const [branch, setBranch] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [steps, setSteps] = useState<Step[]>([])
  const [focus, setFocus] = useState(0)
  const [reword, setReword] = useState<number | null>(null)
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [running, setRunning] = useState(false)
  const head = useRepo(repoId, (r) => r.refs?.head)
  const status = useRepo(repoId, (r) => r.status)
  const listRef = useRef<HTMLOListElement>(null)
  const choices = mode === 'cherry' ? actions.filter((a) => a.value === 'pick' || a.value === 'drop') : actions

  useEffect(() => {
    let live = true
    setRows(null)
    setError(null)
    const load = mode === 'rebase' ? call('rebase.preview', { repoId, onto: base }) : call('cherry.preview', { repoId, tip: base }).then((r) => ({ rows: r, merges: 0, branch: null as string | null }))
    load
      .then((p) => {
        if (!live) return
        setRows(p.rows)
        setMerges(p.merges)
        setBranch(p.branch)
        setSteps(p.rows.filter((row) => !range || range.includes(row.sha)).map((row) => ({ row, action: 'pick' })))
      })
      .catch((e: Error) => live && setError(e.message))
    return () => {
      live = false
    }
  }, [repoId, mode, base])

  const close = (): void => act.setCenter(repoId, { kind: 'graph' })
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !document.querySelector('[role=dialog],[role=menu]')) close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoId])

  const kept = steps.filter((s) => s.action !== 'drop')
  const problem = useMemo(() => {
    if (mode === 'cherry') return kept.length ? null : 'Keep at least one commit to copy.'
    const first = kept[0]
    if (first && (first.action === 'squash' || first.action === 'fixup')) return 'The first kept commit can’t be squashed: there’s nothing above it to fold into.'
    if (steps.some((s) => s.action === 'reword' && !s.message?.trim())) return 'A reworded commit needs a message.'
    return null
  }, [steps, kept, mode])
  const dirty = (status?.changes ?? []).some((c) => c.worktree !== '?' || c.index !== '.')
  const busyOp = status?.op && status.op.kind !== 'none'
  const unchanged = steps.every((s, i) => s.action === 'pick' && s.row.sha === rows?.[i]?.sha)

  const setAction = (i: number, a: RebaseAction): void => {
    setSteps((list) => list.map((s, k) => (k === i ? { ...s, action: a, message: a === 'reword' ? (s.message ?? fullMessage(s.row)) : s.message } : s)))
    if (a === 'reword') setReword(i)
  }
  const move = (from: number, to: number): void => {
    if (to < 0 || to >= steps.length || from === to) return
    setSteps((list) => {
      const next = [...list]
      const [it] = next.splice(from, 1)
      next.splice(to, 0, it)
      return next
    })
    setFocus(to)
    requestAnimationFrame(() => (listRef.current?.children[to] as HTMLElement | undefined)?.focus())
  }

  const start = async (): Promise<void> => {
    if (problem || running) return
    setRunning(true)
    if (mode === 'cherry') await act.cherryPick(repoId, kept.map((s) => s.row.sha))
    else
      await act.rebaseInteractive(repoId, base, [
        ...steps.map((s) => ({ sha: s.row.sha, action: s.action, message: s.action === 'reword' ? s.message : undefined })),
        ...tail.map((r) => ({ sha: r.sha, action: 'pick' as const }))
      ])
    setRunning(false)
    close()
  }

  const onRowKey = (e: React.KeyboardEvent, i: number): void => {
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault()
      return move(i, i + (e.key === 'ArrowUp' ? -1 : 1))
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const n = Math.max(0, Math.min(steps.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))
      setFocus(n)
      ;(listRef.current?.children[n] as HTMLElement | undefined)?.focus()
      return
    }
    const hit = choices.find((c) => c.key === e.key.toLowerCase())
    if (hit && !e.ctrlKey && !e.metaKey) {
      e.preventDefault()
      setAction(i, hit.value)
    }
    if (e.key === 'Enter' && steps[i].action === 'reword') setReword(i)
  }

  const title = mode === 'rebase' ? (range ? `Rebase ${plural(steps.length || range.length, 'selected commit')} on ${branch ?? 'HEAD'}` : `Rewrite ${branch ?? 'HEAD'} after ${baseLabel}`) : `Copy commits from ${baseLabel} onto ${head?.branch ?? 'HEAD'}`

  return (
    <section aria-label={title} className="flex min-h-0 min-w-0 flex-1 flex-col bg-bg">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-surface px-3">
        <h2 className="min-w-0 flex-1 truncate text-md text-text">{title}</h2>
        <Tooltip content="Close" shortcut="Esc">
          <IconButton label="Close" onClick={close}>
            <X size={16} />
          </IconButton>
        </Tooltip>
      </header>
      {error ? (
        <EmptyState icon={AlertTriangle} title="Couldn’t list the commits" body={error} actions={<Button onClick={close}>Back to the graph</Button>} />
      ) : !rows ? (
        <div role="status" aria-label="Loading commits" className="flex flex-col gap-2 p-4">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="h-9 rounded-md bg-surface-raised" />
          ))}
        </div>
      ) : merges ? (
        <EmptyState
          icon={AlertTriangle}
          title="There are merge commits in this range"
          body={`${plural(merges, 'merge commit')} would be flattened by an interactive rebase, so it isn’t offered here. Pick a newer starting commit, or merge instead.`}
          actions={<Button onClick={close}>Back to the graph</Button>}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={GitCommitHorizontal}
          title={mode === 'rebase' ? 'Nothing to rewrite' : 'Nothing to copy'}
          body={mode === 'rebase' ? `${branch ?? 'This branch'} has no commits after ${baseLabel}.` : `Every commit on ${baseLabel} is already on ${head?.branch ?? 'this branch'}.`}
          actions={<Button onClick={close}>Back to the graph</Button>}
        />
      ) : (
        <>
          <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-border px-4 py-2 text-sm text-muted">
            <span>Oldest at the top. Drag rows, or Alt+↑/↓, to reorder.</span>
            <span>
              Keys: {choices.map((c) => `${c.key.toUpperCase()} ${c.label.toLowerCase()}`).join(' · ')}
            </span>
          </div>
          <ol ref={listRef} aria-label="Commits, oldest first" className="min-h-0 flex-1 overflow-y-auto p-2">
            {steps.map((s, i) => (
              <li
                key={s.row.sha}
                tabIndex={i === focus ? 0 : -1}
                onFocus={() => setFocus(i)}
                onKeyDown={(e) => onRowKey(e, i)}
                draggable
                onDragStart={(e) => {
                  setDragFrom(i)
                  e.dataTransfer.effectAllowed = 'move'
                }}
                onDragOver={(e) => {
                  if (dragFrom === null) return
                  e.preventDefault()
                  if (dragFrom !== i) {
                    move(dragFrom, i)
                    setDragFrom(i)
                  }
                }}
                onDragEnd={() => setDragFrom(null)}
                aria-label={`${s.row.summary}, ${actions.find((a) => a.value === s.action)!.label}`}
                className={cn(
                  'mb-1 flex min-h-10 items-center gap-2 rounded-md border border-border bg-surface px-2 outline-none focus-visible:outline-2 focus-visible:outline-focus-ring',
                  s.action === 'drop' && 'opacity-50',
                  (s.action === 'squash' || s.action === 'fixup') && 'ml-6',
                  dragFrom === i && 'border-accent'
                )}
              >
                <GripVertical size={14} aria-hidden className="shrink-0 cursor-grab text-muted" />
                <div role="radiogroup" aria-label="What to do with this commit" className="flex shrink-0 rounded-md border border-border bg-surface-sunken p-0.5">
                  {choices.map((c) => (
                    <Tooltip key={c.value} content={`${c.help} (${c.key.toUpperCase()})`}>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={s.action === c.value}
                        tabIndex={-1}
                        onClick={() => setAction(i, c.value)}
                        className={cn(
                          'h-6 rounded-sm px-2 text-sm',
                          s.action === c.value ? (c.value === 'drop' ? 'bg-danger-solid text-on-danger' : 'bg-accent text-on-accent') : 'text-muted hover:text-text'
                        )}
                      >
                        {c.label}
                      </button>
                    </Tooltip>
                  ))}
                </div>
                <span className="w-16 shrink-0 font-mono text-xs text-muted">{shortSha(s.row.sha)}</span>
                <span className={cn('min-w-0 flex-1 truncate text-base', s.action === 'drop' ? 'text-muted line-through' : 'text-text')}>
                  {s.action === 'reword' && s.message ? s.message.split('\n')[0] : s.row.summary}
                </span>
                {s.action === 'reword' ? (
                  <Button size="sm" variant="ghost" tabIndex={-1} onClick={() => setReword(i)}>
                    Edit message
                  </Button>
                ) : null}
                <Avatar name={s.row.authorName} email={s.row.authorEmail} decorative />
                <span className="hidden w-24 shrink-0 truncate text-sm text-muted md:inline">{relativeTime(s.row.authorTime)}</span>
              </li>
            ))}
          </ol>
          {tail.length ? (
            <p className="shrink-0 border-t border-border px-4 py-2 text-sm text-muted">
              Then {plural(tail.length, 'newer commit')} on {branch ?? 'the branch'} {tail.length === 1 ? 'is' : 'are'} replayed on top, unchanged.
            </p>
          ) : null}
          <footer className="flex shrink-0 items-center gap-2 border-t border-border bg-surface px-4 py-3">
            <p role={problem || dirty || busyOp ? 'alert' : undefined} className={cn('min-w-0 flex-1 text-sm', problem || dirty || busyOp ? 'text-danger' : 'text-muted')}>
              {busyOp
                ? 'Finish or abort the operation in progress first.'
                : dirty
                  ? 'Commit or stash your changes first.'
                  : problem ??
                    (mode === 'rebase'
                      ? `${plural(kept.length + tail.length, 'commit')} after rewriting. Undo puts the branch back.`
                      : `${plural(kept.length, 'commit')} will be copied onto ${head?.branch ?? 'HEAD'}. Undo removes them again.`)}
            </p>
            <Tooltip content="Back to the original list">
              <IconButton label="Reset the list" disabled={unchanged} onClick={() => setSteps(rows.map((row) => ({ row, action: 'pick' })))}>
                <ListRestart size={16} />
              </IconButton>
            </Tooltip>
            <Button onClick={close}>Cancel</Button>
            <Button variant="primary" disabled={!!problem || dirty || !!busyOp || (mode === 'rebase' && unchanged)} loading={running} onClick={() => void start()}>
              {mode === 'rebase' ? 'Start rebase' : `Copy ${plural(kept.length, 'commit')}`}
            </Button>
          </footer>
        </>
      )}
      {reword !== null && steps[reword] ? (
        <RewordDialog
          step={steps[reword]}
          onSave={(message) => {
            setSteps((list) => list.map((s, k) => (k === reword ? { ...s, action: 'reword', message } : s)))
            setReword(null)
          }}
          onClose={() => setReword(null)}
        />
      ) : null}
    </section>
  )
}

function fullMessage(r: RebaseRow): string {
  return r.body ? `${r.summary}\n\n${r.body}` : r.summary
}

function RewordDialog({ step, onSave, onClose }: { step: Step; onSave: (m: string) => void; onClose: () => void }): React.JSX.Element {
  const initial = step.message ?? fullMessage(step.row)
  const [summary, setSummary] = useState(initial.split('\n')[0])
  const [body, setBody] = useState(initial.split('\n').slice(1).join('\n').trim())
  const save = (): void => {
    if (summary.trim()) onSave(body.trim() ? `${summary.trim()}\n\n${body.trim()}` : summary.trim())
  }
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`New message for ${shortSha(step.row.sha)}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!summary.trim()} onClick={save}>
            Save message
          </Button>
        </>
      }
    >
      <Field label="Summary">{(p) => <TextInput {...p} autoFocus value={summary} onChange={(e) => setSummary(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />}</Field>
      <Field label="Description">{(p) => <TextArea {...p} value={body} onChange={(e) => setBody(e.target.value)} />}</Field>
    </Dialog>
  )
}

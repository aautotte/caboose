import { useEffect, useState } from 'react'
import { ArrowLeftRight, FileWarning, GitCompare, X } from 'lucide-react'
import type { Comparison, RebaseRow } from '../../../shared/types'
import { Avatar, Button, Checkbox, EmptyState, IconButton, SegmentedControl, Splitter, Tooltip } from '@/ui'
import { call } from '@/lib/api'
import { plural, relativeTime, shortSha } from '@/lib/format'
import { setPrefs, useApp, useRepo } from '@/store'
import { DiffView } from '@/diff/DiffView'
import { FileList, toStatus } from '@/detail/FileList'
import * as act from '@/actions'

/**
 * Two branches or commits side by side: the files that differ, each one's diff, and the commits only one side has.
 * "Only what <target> changed since they split" compares from their merge base, as a pull request does.
 */
export function CompareView({ repoId, base, target, baseLabel, targetLabel }: { repoId: string; base: string; target: string; baseLabel: string; targetLabel: string }): React.JSX.Element {
  const [cmp, setCmp] = useState<Comparison | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sinceSplit, setSinceSplit] = useState(false)
  const [tab, setTab] = useState<'files' | 'commits'>('files')
  const [open, setOpen] = useState<{ path: string; oldPath?: string } | null>(null)
  const refs = useRepo(repoId, (r) => r.refs)
  const listW = useApp((s) => s.prefs.historyListWidth)

  useEffect(() => {
    let live = true
    setError(null)
    call('compare.get', { repoId, base, target, sinceSplit })
      .then((c) => {
        if (!live) return
        setCmp(c)
        setOpen((o) => (o && c.files.some((f) => f.path === o.path) ? o : c.files[0] ? { path: c.files[0].path, oldPath: c.files[0].origPath } : null))
      })
      .catch((e: Error) => live && setError(e.message))
    return () => {
      live = false
    }
    // Branches move: compare again when the refs change.
  }, [repoId, base, target, sinceSplit, refs])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !document.querySelector('[role=dialog],[role=menu]')) act.setCenter(repoId, { kind: 'graph' })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [repoId])

  const swap = (): void => act.setCenter(repoId, { kind: 'compare', base: target, target: base, baseLabel: targetLabel, targetLabel: baseLabel })
  const commitList = (title: string, rows: RebaseRow[], count: number): React.JSX.Element => (
    <div className="flex flex-col">
      <h3 className="sticky top-0 bg-surface-raised px-3 py-1 text-sm font-medium text-text">
        {title} ({count})
      </h3>
      {rows.length ? (
        <ul aria-label={title}>
          {rows.map((r) => (
            <li key={r.sha}>
              <button
                type="button"
                onClick={() => act.select(repoId, r.sha)}
                className="flex h-(--gc-list-row-h) w-full items-center gap-2 px-3 text-left hover:bg-row-hover"
                title="Show this commit in the details panel"
              >
                <Avatar name={r.authorName} email={r.authorEmail} decorative />
                <span className="min-w-0 flex-1 truncate text-base text-text">{r.summary}</span>
                <span className="shrink-0 text-xs text-muted">{relativeTime(r.authorTime)}</span>
                <span className="shrink-0 font-mono text-xs text-muted">{shortSha(r.sha)}</span>
              </button>
            </li>
          ))}
          {count > rows.length ? <li className="px-3 py-1 text-sm text-muted">…and {count - rows.length} more</li> : null}
        </ul>
      ) : (
        <p className="px-3 py-1 text-sm text-muted">None</p>
      )}
    </div>
  )

  return (
    <section aria-label={`Compare ${baseLabel} with ${targetLabel}`} className="flex min-h-0 min-w-0 flex-1 flex-col bg-bg">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-surface px-3">
        <GitCompare size={16} aria-hidden className="shrink-0 text-muted" />
        <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
          <span className="truncate text-base font-medium text-text">{baseLabel}</span>
          <span className="shrink-0 text-muted">→</span>
          <span className="truncate text-base font-medium text-text">{targetLabel}</span>
        </div>
        <Tooltip content="Swap the two sides">
          <IconButton label="Swap the two sides" onClick={swap}>
            <ArrowLeftRight size={16} />
          </IconButton>
        </Tooltip>
        <Tooltip content="Close" shortcut="Esc">
          <IconButton label="Close the comparison" onClick={() => act.setCenter(repoId, { kind: 'graph' })}>
            <X size={16} />
          </IconButton>
        </Tooltip>
      </header>
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-border bg-surface-sunken px-3 py-1">
        <p role="status" aria-label="Comparison summary" className="min-w-0 flex-1 text-sm text-muted">
          {cmp
            ? cmp.targetCount === 0 && cmp.baseCount === 0
              ? 'Both point at the same commit.'
              : `${targetLabel} has ${plural(cmp.targetCount, 'commit')} ${baseLabel} doesn’t; ${baseLabel} has ${plural(cmp.baseCount, 'commit')} ${targetLabel} doesn’t.`
            : ' '}
        </p>
        <Checkbox label={`Only what ${targetLabel} changed since they split`} checked={sinceSplit} onCheckedChange={setSinceSplit} />
      </div>
      {error ? (
        <EmptyState icon={FileWarning} title="Couldn’t compare these" body={error} actions={<Button onClick={() => act.setCenter(repoId, { kind: 'graph' })}>Back to the graph</Button>} />
      ) : !cmp ? (
        <div role="status" aria-label="Comparing" className="flex flex-col gap-3 p-3">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="h-3 w-2/3 rounded-sm bg-surface-raised" />
          ))}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="flex min-h-0 shrink-0 flex-col bg-surface" style={{ width: listW }}>
            <div className="shrink-0 border-b border-border p-2">
              <SegmentedControl
                label="Show"
                value={tab}
                onValueChange={(v: 'files' | 'commits') => setTab(v)}
                options={[
                  { value: 'files', label: `Files (${cmp.files.length})` },
                  { value: 'commits', label: `Commits (${cmp.targetCount + cmp.baseCount})` }
                ]}
              />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {tab === 'files' ? (
                <FileList
                  title={sinceSplit ? `Changed on ${targetLabel}` : 'Different'}
                  files={cmp.files.map((f) => ({ path: f.path, origPath: f.origPath, status: toStatus(f.status), lfs: f.lfs }))}
                  selected={open?.path ?? null}
                  onOpen={(f) => setOpen({ path: f.path, oldPath: f.origPath })}
                  menu={(f) => [
                    { type: 'item', label: 'File history', onSelect: () => act.setCenter(repoId, { kind: 'history', path: f.path }) },
                    { type: 'item', label: 'Copy path', onSelect: () => void navigator.clipboard.writeText(f.path) }
                  ]}
                  emptyText={sinceSplit ? `${targetLabel} changed nothing since they split.` : 'No file differs.'}
                />
              ) : (
                <>
                  {commitList(`Only on ${targetLabel}`, cmp.targetOnly, cmp.targetCount)}
                  {commitList(`Only on ${baseLabel}`, cmp.baseOnly, cmp.baseCount)}
                </>
              )}
            </div>
          </div>
          <Splitter label="Resize the file list" value={listW} min={220} max={560} defaultValue={320} onChange={(w) => setPrefs({ historyListWidth: w })} />
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {open ? (
              <>
                <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border bg-surface-sunken px-3 text-sm text-muted">
                  <span className="min-w-0 flex-1 truncate" title={open.path}>
                    {open.oldPath && open.oldPath !== open.path ? `${open.oldPath} → ` : ''}
                    {open.path}
                  </span>
                </div>
                <DiffView key={`${open.path}|${cmp.from}|${cmp.target}`} embedded repoId={repoId} path={open.path} oldPath={open.oldPath} source={{ kind: 'commit', sha: cmp.target, parent: cmp.from }} />
              </>
            ) : (
              <EmptyState icon={GitCompare} title={cmp.files.length ? 'Pick a file' : 'No file differs'} body={cmp.files.length ? 'Its changes show here.' : 'The two have the same files.'} />
            )}
          </div>
        </div>
      )}
    </section>
  )
}

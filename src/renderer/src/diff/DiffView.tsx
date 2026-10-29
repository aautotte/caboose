import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, FileWarning, HardDrive, History, Maximize2, Minimize2, ScanSearch, Search, Space, UserSearch, WrapText, X } from 'lucide-react'
import type { DiffLine, DiffSource, FileDiff, Hunk } from '../../../shared/types'
import { Button, EmptyState, IconButton, SegmentedControl, Tooltip } from '@/ui'
import { cn } from '@/ui/cn'
import { call } from '@/lib/api'
import { fileSize, plural, shortSha, splitPath } from '@/lib/format'

/** What an LFS pointer diff means: the content is in LFS, so say how the file changed instead of showing the pointer's lines. */
function lfsChange({ old, new: now }: NonNullable<FileDiff['lfs']>): string {
  if (!old && now) return `A new file of ${fileSize(now.size)}. Its content is in Git LFS, so there are no lines to compare.`
  if (old && !now) return `A file of ${fileSize(old.size)} was deleted. Its content was in Git LFS.`
  if (old && now && old.oid === now.oid) return `${fileSize(now.size)}, unchanged.`
  return `${fileSize(old!.size)} → ${fileSize(now!.size)} (content ${old!.oid.slice(0, 8)} → ${now!.oid.slice(0, 8)}). The content is in Git LFS, so there are no lines to compare.`
}
import { setPrefs, useApp, useRepo, type DiffMode } from '@/store'
import * as act from '@/actions'
import { highlightLine, languageFor } from './highlight'
import { SubmoduleDiff } from './SubmoduleDiff'
import { FindBar, useFindInView } from './FindBar'

function sourceLabel(s: DiffSource): string {
  if (s.kind === 'worktree') return 'Not staged'
  if (s.kind === 'index') return 'Staged'
  return `Commit ${shortSha(s.sha)}`
}

/** Lines picked for a partial stage / unstage / discard. One block at a time. */
interface Selection {
  hunk: number
  lines: Set<number>
  anchor: number
}

/** S07: one file's changes, as changed blocks, the whole file, or side by side. Unstaged and staged diffs can be staged by block or by line. */
export function DiffView({
  repoId,
  path,
  oldPath,
  source,
  embedded = false
}: {
  repoId: string
  path: string
  oldPath?: string
  source: DiffSource
  /** Inside another view (file history): no close, history or Esc handling of its own. */
  embedded?: boolean
}): React.JSX.Element {
  const mode = useApp((s) => s.prefs.diffMode)
  const wrap = useApp((s) => s.prefs.diffWrap)
  const ignoreWs = useApp((s) => s.prefs.diffIgnoreWs)
  const wide = useApp((s) => s.diffWide)
  const status = useRepo(repoId, (r) => r.status)
  // A file can become conflicted while its diff is open (or be opened just before the status says so).
  const conflicted = source.kind !== 'commit' && (status?.changes.some((c) => c.path === path && c.conflicted) ?? false)
  const [force, setForce] = useState(false)
  const [diff, setDiff] = useState<FileDiff | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sel, setSel] = useState<Selection | null>(null)
  const [busy, setBusy] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)
  const srcKey = JSON.stringify(source)
  const editable = source.kind !== 'commit'
  // With whitespace left out, the blocks on screen aren't the file's real ones, so they can't be staged.
  const canStage = editable && !ignoreWs

  // A new file, source or layout starts from a blank view; a status refresh (after staging, or a change on
  // disk) quietly reloads the same view.
  const viewKey = `${path}|${oldPath}|${srcKey}|${force}|${mode}|${ignoreWs}`
  const lastView = useRef('')
  useEffect(() => {
    let live = true
    if (lastView.current !== viewKey) {
      setDiff(null)
      setSel(null)
      lastView.current = viewKey
    }
    setError(null)
    call('diff.get', { repoId, path, oldPath, source, force, full: mode === 'inline', ignoreWs })
      .then((d) => {
        if (!live) return
        setDiff(d)
        setSel((s) => (s && d.hunks[s.hunk] ? s : null))
      })
      .catch((e: Error) => live && setError(e.message))
    return () => {
      live = false
    }
    // srcKey stands in for source; status changes mean the file may have changed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoId, viewKey, editable ? status : null])

  const lang = useMemo(() => languageFor(path), [path])
  const { dir, name } = splitPath(path)

  // Find in file (Ctrl+F while a diff is open). The search stays when another file opens.
  const [findOpen, setFindOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [findFocus, setFindFocus] = useState(0)
  const find = useFindInView(scroller, findOpen ? query : '', diff)
  const openFind = (): void => {
    setFindOpen(true)
    setFindFocus((n) => n + 1)
  }
  useEffect(() => {
    const onFind = (e: Event): void => {
      e.preventDefault()
      setFindOpen(true)
      setFindFocus((n) => n + 1)
    }
    window.addEventListener('gc:find-in-file', onFind)
    return () => window.removeEventListener('gc:find-in-file', onFind)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !document.querySelector('[role=dialog],[role=menu]')) {
        if (sel) setSel(null)
        else if (findOpen) setFindOpen(false)
        else if (!embedded) act.setCenter(repoId, { kind: 'graph' })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [repoId, sel, embedded, findOpen])

  const run = async (hunk: number, lines: number[] | null, action: 'stage' | 'unstage' | 'discard'): Promise<void> => {
    if (!diff || source.kind === 'commit') return
    const go = async (): Promise<void> => {
      setBusy(true)
      const ok = await act.applyPatch(repoId, { path, source: source.kind, hunk, header: diff.hunks[hunk].header, lines, action, full: mode === 'inline' })
      setBusy(false)
      if (ok) setSel(null)
    }
    if (action !== 'discard') return go()
    act.confirm({
      title: lines ? `Discard ${plural(lines.length, 'line')}?` : 'Discard this block?',
      body: `The ${lines ? 'selected lines go' : 'block goes'} back to how they were in the last commit, in ${name} on disk.`,
      confirmLabel: 'Discard',
      danger: true,
      undoable: true,
      onConfirm: () => void go()
    })
  }

  const jump = (dirn: 1 | -1): void => {
    const el = scroller.current
    if (!el) return
    const heads = [...el.querySelectorAll<HTMLElement>('[data-hunk]')]
    const top = el.scrollTop + 4
    const target = dirn === 1 ? heads.find((h) => h.offsetTop > top) : [...heads].reverse().find((h) => h.offsetTop < top - 8)
    if (target) el.scrollTo({ top: target.offsetTop, behavior: 'smooth' })
  }

  const blameRev = source.kind === 'commit' ? source.sha : null
  const empty =
    source.kind === 'worktree'
      ? { title: 'No unstaged changes left', body: 'Everything in this file is staged.' }
      : source.kind === 'index'
        ? { title: 'Nothing staged in this file', body: 'Its changes are all unstaged.' }
        : { title: 'No text changes', body: 'Whitespace or line endings only, or an empty file.' }

  return (
    <section aria-label={`Changes in ${path}`} className="flex min-h-0 min-w-0 flex-1 flex-col bg-bg">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-surface px-3">
        {embedded ? (
          <span className="flex-1" />
        ) : (
          <div className="flex min-w-0 flex-1 items-baseline gap-1.5" title={path}>
            <span className="min-w-0 shrink-[10] truncate text-sm text-muted">{oldPath && oldPath !== path ? `${oldPath} → ` : dir}</span>
            <span className="min-w-0 truncate text-base font-medium text-text">{name}</span>
            <span className="shrink-0 text-xs text-muted">· {sourceLabel(source)}</span>
          </div>
        )}
        {embedded ? null : (
          <>
            <Tooltip content="Previous change">
              <IconButton label="Previous change" onClick={() => jump(-1)}>
                <ChevronUp size={16} />
              </IconButton>
            </Tooltip>
            <Tooltip content="Next change">
              <IconButton label="Next change" onClick={() => jump(1)}>
                <ChevronDown size={16} />
              </IconButton>
            </Tooltip>
          </>
        )}
        <Tooltip content="Find in file" shortcut="Ctrl+F">
          <IconButton label="Find in file" pressed={findOpen} onClick={() => (findOpen ? setFindOpen(false) : openFind())}>
            <Search size={16} />
          </IconButton>
        </Tooltip>
        <SegmentedControl
          label="Diff layout"
          value={mode}
          onValueChange={(m: DiffMode) => setPrefs({ diffMode: m })}
          options={[
            { value: 'hunk', label: 'Changes' },
            { value: 'inline', label: 'File' },
            { value: 'split', label: 'Split' }
          ]}
        />
        <Tooltip content={ignoreWs ? 'Show whitespace changes' : 'Hide whitespace changes'}>
          <IconButton label="Hide whitespace changes" pressed={ignoreWs} onClick={() => setPrefs({ diffIgnoreWs: !ignoreWs })}>
            <Space size={16} />
          </IconButton>
        </Tooltip>
        <Tooltip content={wrap ? 'Don’t wrap long lines' : 'Wrap long lines'}>
          <IconButton label="Wrap long lines" pressed={wrap} onClick={() => setPrefs({ diffWrap: !wrap })}>
            <WrapText size={16} />
          </IconButton>
        </Tooltip>
        {embedded ? null : (
          <Tooltip content="File history">
            <IconButton label="File history" onClick={() => act.setCenter(repoId, { kind: 'history', path })}>
              <History size={16} />
            </IconButton>
          </Tooltip>
        )}
        <Tooltip content={blameRev ? 'Blame this file as of this commit' : 'Blame: who changed each line'}>
          <IconButton label={blameRev ? 'Blame at this commit' : 'Blame'} disabled={diff?.isDeleted} onClick={() => act.setCenter(repoId, { kind: 'blame', path, rev: blameRev })}>
            <UserSearch size={16} />
          </IconButton>
        </Tooltip>
        {embedded ? null : (
          <Tooltip content={wide ? 'Show the side panels' : 'Use the full width'}>
            <IconButton label="Use the full width" pressed={wide} onClick={() => useApp.setState({ diffWide: !wide })}>
              {wide ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </IconButton>
          </Tooltip>
        )}
        {embedded ? null : (
          <Tooltip content="Close" shortcut="Esc">
            <IconButton label="Close diff" onClick={() => act.setCenter(repoId, { kind: 'graph' })}>
              <X size={16} />
            </IconButton>
          </Tooltip>
        )}
      </header>
      {findOpen ? (
        <FindBar
          query={query}
          onQuery={setQuery}
          count={find.count}
          current={find.current}
          onGo={find.go}
          onClose={() => {
            setFindOpen(false)
            scroller.current?.focus()
          }}
          focusKey={findFocus}
        />
      ) : null}
      {/* Focusable so keyboard users can scroll a long diff. */}
      <div ref={scroller} tabIndex={0} className="relative min-h-0 flex-1 overflow-auto outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring" aria-busy={busy || undefined}>
        {conflicted ? (
          <EmptyState
            icon={FileWarning}
            title={`${name} has conflicts`}
            body="Pick what to keep in the merge tool."
            actions={
              <Button variant="primary" onClick={() => act.setCenter(repoId, { kind: 'merge', path })}>
                Open the merge tool
              </Button>
            }
          />
        ) : error ? (
          <EmptyState icon={FileWarning} title="Couldn’t show this file" body={error} />
        ) : !diff ? (
          <div role="status" aria-label="Loading diff" className="flex flex-col gap-1.5 p-4">
            {Array.from({ length: 10 }, (_, i) => (
              <div key={i} className="h-3 rounded-sm bg-surface-raised" style={{ width: `${25 + ((i * 41) % 60)}%` }} />
            ))}
          </div>
        ) : diff.submodule ? (
          <SubmoduleDiff repoId={repoId} path={path} change={diff.submodule} source={source} />
        ) : diff.lfs ? (
          <EmptyState icon={HardDrive} title="Stored in Git LFS" body={lfsChange(diff.lfs)} />
        ) : diff.binary ? (
          <EmptyState icon={FileWarning} title="Binary file" body="This file isn’t text, so there are no lines to compare. All Caboose can say is that it changed." />
        ) : diff.tooLarge ? (
          <EmptyState
            icon={ScanSearch}
            title={`Large change (${diff.lineCount.toLocaleString()} lines)`}
            body="Showing it may be slow."
            actions={<Button onClick={() => setForce(true)}>Show anyway</Button>}
          />
        ) : diff.hunks.length === 0 && ignoreWs ? (
          <EmptyState
            icon={Space}
            title="Only whitespace changed"
            body="Spaces, tabs or line endings, and they’re hidden right now."
            actions={<Button onClick={() => setPrefs({ diffIgnoreWs: false })}>Show whitespace</Button>}
          />
        ) : diff.hunks.length === 0 ? (
          <EmptyState
            icon={FileWarning}
            title={diff.modeChange ? 'Only the file mode changed' : empty.title}
            body={diff.modeChange ?? (diff.oldPath ? `Renamed from ${diff.oldPath} without edits.` : empty.body)}
          />
        ) : (
          <div className={cn('font-mono text-code', wrap ? 'min-w-0' : 'w-max min-w-full')}>
            {editable && ignoreWs ? (
              <Note>
                Whitespace changes are hidden, so lines can’t be staged or discarded here.{' '}
                <Button size="sm" variant="ghost" className="text-accent-text" onClick={() => setPrefs({ diffIgnoreWs: false })}>
                  Show whitespace
                </Button>
              </Note>
            ) : null}
            {diff.isNew ? <Note>New file</Note> : diff.isDeleted ? <Note>Deleted file</Note> : null}
            {diff.modeChange ? <Note>File mode {diff.modeChange}</Note> : null}
            {diff.hunks.map((h, i) => (
              <section key={`${i}-${h.header}`} data-hunk={i} aria-label={`Change ${i + 1} of ${diff.hunks.length}`}>
                <HunkBar
                  h={h}
                  index={i}
                  showHeader={mode !== 'inline' || diff.hunks.length > 1}
                  source={source}
                  partialOk={!diff.oldPath && canStage}
                  newFile={diff.isNew && source.kind === 'worktree'}
                  sel={sel?.hunk === i ? sel : null}
                  busy={busy}
                  onRun={run}
                  onClear={() => setSel(null)}
                />
                {mode === 'split' ? (
                  <SplitHunk h={h} lang={lang} wrap={wrap} />
                ) : (
                  <UnifiedHunk h={h} index={i} lang={lang} wrap={wrap} selectable={canStage && !diff.oldPath} sel={sel?.hunk === i ? sel : null} onSelect={setSel} onRun={run} source={source} />
                )}
              </section>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function Note({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="border-b border-border bg-surface px-3 py-1 font-sans text-sm text-muted">{children}</div>
}

/** The block's header row: its @@ line and the stage / unstage / discard buttons. */
function HunkBar({
  h,
  index,
  showHeader,
  source,
  partialOk,
  newFile,
  sel,
  busy,
  onRun,
  onClear
}: {
  h: Hunk
  index: number
  showHeader: boolean
  source: DiffSource
  partialOk: boolean
  newFile: boolean
  sel: Selection | null
  busy: boolean
  onRun: (hunk: number, lines: number[] | null, action: 'stage' | 'unstage' | 'discard') => void
  onClear: () => void
}): React.JSX.Element | null {
  if (!showHeader && source.kind === 'commit') return null
  const lines = sel ? [...sel.lines].sort((a, b) => a - b) : null
  const n = lines?.length ?? 0
  const what = n ? plural(n, 'line') : 'block'
  return (
    <div className="sticky top-0 z-[1] flex min-h-7 items-center gap-2 bg-surface-raised px-3 py-0.5 font-sans">
      <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted">{showHeader ? h.header : ''}</span>
      {source.kind === 'commit' || !partialOk ? null : (
        <div className="flex shrink-0 items-center gap-1">
          {n ? (
            <Button size="sm" variant="ghost" onClick={onClear}>
              Clear
            </Button>
          ) : null}
          {source.kind === 'worktree' ? (
            <>
              <Button size="sm" variant="ghost" className="text-danger" disabled={busy || newFile} onClick={() => onRun(index, lines, 'discard')}>
                Discard {what}
              </Button>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => onRun(index, lines, 'stage')}>
                Stage {what}
              </Button>
            </>
          ) : (
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => onRun(index, lines, 'unstage')}>
              Unstage {what}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

const lineBg = { add: 'bg-diff-add-bg', del: 'bg-diff-del-bg', ctx: '' }
const sign = { add: '+', del: '−', ctx: ' ' }
const signLabel = { add: 'added', del: 'removed', ctx: '' }

const Code = memo(function Code({ text, lang, wrap }: { text: string; lang: string | null; wrap: boolean }) {
  return (
    <span
      className={cn('hljs-line flex-1 px-2', wrap ? 'break-all whitespace-pre-wrap' : 'whitespace-pre')}
      dangerouslySetInnerHTML={{ __html: highlightLine(text, lang) || ' ' }}
    />
  )
})

/**
 * One block, one column. Click a changed line's number to pick it, shift-click for a range.
 * Keyboard: focus the block, ↑/↓ move between changed lines, Space picks, Enter stages (or unstages) the pick or the block.
 */
function UnifiedHunk({
  h,
  index,
  lang,
  wrap,
  selectable,
  sel,
  onSelect,
  onRun,
  source
}: {
  h: Hunk
  index: number
  lang: string | null
  wrap: boolean
  selectable: boolean
  sel: Selection | null
  onSelect: (s: Selection | null) => void
  onRun: (hunk: number, lines: number[] | null, action: 'stage' | 'unstage' | 'discard') => void
  source: DiffSource
}): React.JSX.Element {
  const [cursor, setCursor] = useState<number | null>(null)
  const changed = useMemo(() => h.lines.map((l, i) => (l.type === 'ctx' ? -1 : i)).filter((i) => i >= 0), [h])

  const toggle = (i: number, range: boolean): void => {
    if (!selectable || h.lines[i].type === 'ctx') return
    const lines = new Set(sel?.lines ?? [])
    if (range && sel) {
      const [a, b] = [Math.min(sel.anchor, i), Math.max(sel.anchor, i)]
      for (const k of changed) if (k >= a && k <= b) lines.add(k)
      onSelect({ hunk: index, lines, anchor: sel.anchor })
    } else {
      if (lines.has(i)) lines.delete(i)
      else lines.add(i)
      onSelect(lines.size ? { hunk: index, lines, anchor: i } : null)
    }
  }

  const onKey = (e: React.KeyboardEvent): void => {
    if (!selectable || !changed.length) return
    const pos = cursor === null ? -1 : changed.indexOf(cursor)
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const next = changed[Math.max(0, Math.min(changed.length - 1, pos + (e.key === 'ArrowDown' ? 1 : -1)))]
      setCursor(next)
      if (e.shiftKey) toggle(next, true)
      document.getElementById(`dl-${index}-${next}`)?.scrollIntoView({ block: 'nearest' })
    } else if (e.key === ' ' && cursor !== null) {
      e.preventDefault()
      toggle(cursor, false)
    } else if (e.key === 'Enter' && source.kind !== 'commit') {
      e.preventDefault()
      onRun(index, sel ? [...sel.lines].sort((a, b) => a - b) : null, source.kind === 'index' ? 'unstage' : 'stage')
    }
  }

  return (
    <div
      role="table"
      aria-label={selectable ? `${h.header}. Arrow keys move, Space picks a line, Enter ${source.kind === 'index' ? 'unstages' : 'stages'}.` : h.header}
      tabIndex={selectable ? 0 : undefined}
      onKeyDown={onKey}
      onBlur={() => setCursor(null)}
      className="outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring"
    >
      {h.lines.map((l, i) => {
        const picked = sel?.lines.has(i) ?? false
        const canPick = selectable && l.type !== 'ctx'
        return (
          <div
            role="row"
            id={`dl-${index}-${i}`}
            key={i}
            aria-label={signLabel[l.type] || undefined}
            aria-selected={canPick ? picked : undefined}
            className={cn('flex', lineBg[l.type], picked && 'bg-diff-picked', cursor === i && 'outline-1 -outline-offset-1 outline-focus-ring')}
          >
            <span
              role="cell"
              onMouseDown={(e) => {
                if (!canPick) return
                e.preventDefault()
                toggle(i, e.shiftKey)
              }}
              title={canPick ? 'Pick this line (Shift: a range)' : undefined}
              className={cn('flex shrink-0 select-none', canPick && 'cursor-pointer hover:bg-row-hover')}
            >
              <span aria-hidden className={cn('w-1 shrink-0', picked ? 'bg-accent' : '')} />
              <span className="w-11 shrink-0 pr-2 text-right text-disabled">{l.oldNo ?? ''}</span>
              <span className="w-12 shrink-0 pr-2 text-right text-disabled">{l.newNo ?? ''}</span>
            </span>
            <span aria-hidden className={cn('w-4 shrink-0 text-center select-none', l.type === 'add' ? 'text-success' : l.type === 'del' ? 'text-danger' : '')}>
              {sign[l.type]}
            </span>
            <span role="cell" className="flex min-w-0 flex-1">
              <Code text={l.text} lang={lang} wrap={wrap} />
              {l.noNewline ? <span className="pr-2 font-sans text-xs text-muted">no newline at end</span> : null}
            </span>
          </div>
        )
      })}
    </div>
  )
}

/** Pairs removed and added lines inside each change block so they sit side by side. */
function pairLines(lines: DiffLine[]): Array<[DiffLine | null, DiffLine | null]> {
  const out: Array<[DiffLine | null, DiffLine | null]> = []
  let i = 0
  while (i < lines.length) {
    if (lines[i].type === 'ctx') {
      out.push([lines[i], lines[i]])
      i++
      continue
    }
    const dels: DiffLine[] = []
    const adds: DiffLine[] = []
    while (i < lines.length && lines[i].type === 'del') dels.push(lines[i++])
    while (i < lines.length && lines[i].type === 'add') adds.push(lines[i++])
    for (let k = 0; k < Math.max(dels.length, adds.length); k++) out.push([dels[k] ?? null, adds[k] ?? null])
  }
  return out
}

function SplitHunk({ h, lang, wrap }: { h: Hunk; lang: string | null; wrap: boolean }): React.JSX.Element {
  const pairs = pairLines(h.lines)
  const cell = (l: DiffLine | null, side: 'old' | 'new'): React.JSX.Element => (
    <div role="cell" className={cn('flex min-w-0 flex-1', l ? lineBg[l.type] : 'bg-surface-sunken')}>
      <span className="w-12 shrink-0 pr-2 text-right text-disabled select-none">{l ? (side === 'old' ? l.oldNo : l.newNo) : ''}</span>
      {l ? <Code text={l.text} lang={lang} wrap={wrap} /> : <span className="flex-1" />}
    </div>
  )
  return (
    <div role="table" aria-label={h.header}>
      {pairs.map(([a, b], i) => (
        <div role="row" key={i} className="flex divide-x divide-border">
          {cell(a, 'old')}
          {cell(b, 'new')}
        </div>
      ))}
    </div>
  )
}

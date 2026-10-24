import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Columns3, FileWarning, RotateCcw, X } from 'lucide-react'
import type { ConflictFile } from '../../../shared/types'
import { Badge, Button, Checkbox, EmptyState, IconButton, Tooltip } from '@/ui'
import { cn } from '@/ui/cn'
import { call } from '@/lib/api'
import { splitPath } from '@/lib/format'
import { toast } from '@/ui/toastBus'
import { setPrefs, useApp } from '@/store'
import * as act from '@/actions'
import { baseLines, compose, eolOf, hasMarkers, parseConflicts, type Pick, type Segment } from './conflicts'

/** S10: pick lines from each side of every conflict, or edit the result directly, then save. */
export function MergeTool({ repoId, path }: { repoId: string; path: string }): React.JSX.Element {
  const [file, setFile] = useState<ConflictFile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [picks, setPicks] = useState<Pick[]>([])
  const [output, setOutput] = useState('')
  const [edited, setEdited] = useState(false)
  const [current, setCurrent] = useState(0)
  const [saving, setSaving] = useState(false)
  const paneRefs = useRef<Array<HTMLDivElement | null>>([])
  const showBase = useApp((s) => s.prefs.mergeShowBase)

  useEffect(() => {
    let live = true
    setFile(null)
    setError(null)
    call('conflict.get', { repoId, path })
      .then((f) => {
        if (!live) return
        setFile(f)
        setPicks([])
        setEdited(false)
        setCurrent(0)
      })
      .catch((e: Error) => live && setError(e.message))
    return () => {
      live = false
    }
  }, [repoId, path])

  const segs: Segment[] = useMemo(() => (file ? parseConflicts(file.merged) : []), [file])
  const conflicts = segs.filter((s) => s.kind === 'conflict').length
  // No ancestor version at all (both sides added the file): every conflict started from nothing.
  const bases = useMemo(
    () => (!file ? [] : file.base === null ? segs.filter((s) => s.kind === 'conflict').map(() => []) : baseLines(segs, file.diff3)),
    [file, segs]
  )
  const eol = file ? eolOf(file.merged) : '\n'
  const labels = { ours: file?.oursLabel ?? 'yours', theirs: file?.theirsLabel ?? 'theirs' }

  useEffect(() => {
    if (file && !edited) setOutput(compose(segs, picks, labels, eol))
    // labels derive from file
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, segs, picks, edited, eol])

  const resolved = picks.filter((p) => p && p.length).length
  const clean = !hasMarkers(output)

  const toggle = (idx: number, side: 'ours' | 'theirs', on: boolean): void => {
    setEdited(false)
    setPicks((prev) => {
      const next = [...prev]
      const cur = next[idx] ?? []
      next[idx] = on ? [...cur.filter((s) => s !== side), side] : cur.filter((s) => s !== side)
      return next
    })
  }

  const go = (d: number): void => {
    if (!conflicts) return
    const n = (current + d + conflicts) % conflicts
    setCurrent(n)
    paneRefs.current[n]?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }

  // Back to the graph once this file is done, unless the user already opened something else meanwhile.
  const leave = (): void => {
    const c = useApp.getState().repos[repoId]?.center
    if (c?.kind !== 'merge' || c.path !== path) return
    act.setCenter(repoId, { kind: 'graph' })
    act.select(repoId, 'wip')
  }

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      await call('conflict.resolve', { repoId, path, content: output })
      toast({ tone: 'success', title: `Resolved ${splitPath(path).name}` })
      leave()
      await act.loadStatus(repoId)
    } catch (err) {
      act.fail(err, 'Couldn’t save the result')
    } finally {
      setSaving(false)
    }
  }

  const takeAll = async (side: 'ours' | 'theirs'): Promise<void> => {
    try {
      await call('conflict.take', { repoId, path, side })
      toast({ tone: 'success', title: `Kept ${side === 'ours' ? labels.ours : labels.theirs} for ${splitPath(path).name}` })
      leave()
      await act.loadStatus(repoId)
    } catch (err) {
      act.fail(err, 'Couldn’t resolve the file')
    }
  }

  const close = (): void => act.setCenter(repoId, { kind: 'graph' })

  if (error) return <EmptyState icon={FileWarning} title="Couldn’t open the conflict" body={error} actions={<Button onClick={close}>Back</Button>} />
  if (!file) return <div role="status" className="p-4 text-muted">Loading conflict…</div>

  // One side deleted the file, the other changed it: there is nothing to merge line by line.
  if (!file.binary && file.base !== null && (file.ours === null) !== (file.theirs === null)) {
    const deletedOn: 'ours' | 'theirs' = file.ours === null ? 'ours' : 'theirs'
    const keptOn = deletedOn === 'ours' ? 'theirs' : 'ours'
    return (
      <EmptyState
        icon={FileWarning}
        title={`${splitPath(path).name} was deleted on ${labels[deletedOn]} and changed on ${labels[keptOn]}`}
        body="Keep the edited version, or delete the file."
        actions={
          <>
            <Button onClick={() => void takeAll(keptOn)}>Keep the edited file</Button>
            <Button variant="danger" onClick={() => void takeAll(deletedOn)}>
              Delete it
            </Button>
          </>
        }
      />
    )
  }

  if (file.binary) {
    return (
      <EmptyState
        icon={FileWarning}
        title={`${splitPath(path).name} is a binary file`}
        body="Binary files can’t be merged line by line. Keep one whole version."
        actions={
          <>
            <Button onClick={() => void takeAll('ours')}>Keep {labels.ours}</Button>
            <Button onClick={() => void takeAll('theirs')}>Keep {labels.theirs}</Button>
          </>
        }
      />
    )
  }

  let ci = -1
  // The middle column: what both sides started from. Read only; pick from yours or theirs.
  const basePane = (): React.JSX.Element => {
    ci = -1
    return (
      <div className="min-h-0 flex-1 overflow-auto font-mono text-code">
        {segs.map((s, i) => {
          if (s.kind === 'common') {
            return (
              <pre key={i} className="px-3 whitespace-pre text-muted">
                {s.lines.join('\n') || ' '}
              </pre>
            )
          }
          const idx = ++ci
          const lines = bases[idx]
          return (
            <div key={i} className={cn('my-1 border-y border-border bg-surface-raised', idx === current && 'outline-2 -outline-offset-2 outline-focus-ring')}>
              <div className="flex h-8 items-center px-3 font-sans text-xs text-muted">
                <span>{lines === null ? 'Not available' : file.base === null ? 'Nothing here before: both sides added this file' : lines.length === 0 ? 'Nothing here before (both sides added lines)' : `Before: ${lines.length === 1 ? '1 line' : `${lines.length} lines`}`}</span>
                <span className="ml-auto">Conflict {idx + 1}</span>
              </div>
              <pre className="px-3 pb-1 whitespace-pre text-text">{lines === null ? ' ' : lines.join('\n') || '(nothing)'}</pre>
            </div>
          )
        })}
      </div>
    )
  }

  const side = (which: 'ours' | 'theirs'): React.JSX.Element => {
    ci = -1
    return (
      <div className="min-h-0 flex-1 overflow-auto font-mono text-code">
        {segs.map((s, i) => {
          if (s.kind === 'common') {
            return (
              <pre key={i} className="px-3 whitespace-pre text-muted">
                {s.lines.join('\n') || ' '}
              </pre>
            )
          }
          const idx = ++ci
          const lines = which === 'ours' ? s.ours : s.theirs
          const checked = (picks[idx] ?? []).includes(which)
          const order = (picks[idx] ?? []).indexOf(which)
          return (
            <div
              key={i}
              ref={(el) => {
                if (which === 'ours') paneRefs.current[idx] = el
              }}
              className={cn(
                'my-1 border-y border-border',
                which === 'ours' ? 'bg-conflict-ours-bg' : 'bg-conflict-theirs-bg',
                idx === current && 'outline-2 -outline-offset-2 outline-focus-ring'
              )}
            >
              <div className="flex items-center gap-2 px-3 py-1 font-sans">
                <Checkbox
                  label={`Use ${lines.length === 1 ? 'this line' : `these ${lines.length} lines`}${checked && (picks[idx]?.length ?? 0) > 1 ? ` (${order === 0 ? 'first' : 'second'})` : ''}`}
                  checked={checked}
                  onCheckedChange={(v) => toggle(idx, which, v)}
                />
                <span className="ml-auto text-xs text-muted">Conflict {idx + 1}</span>
              </div>
              <pre className="px-3 pb-1 whitespace-pre text-text">{lines.join('\n') || '(nothing)'}</pre>
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <section aria-label={`Resolve conflicts in ${path}`} className="flex min-h-0 min-w-0 flex-1 flex-col bg-bg">
      {/* Wraps onto a second line instead of clipping its buttons when the window is narrow. */}
      <header className="flex min-h-10 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-border bg-surface px-3 py-1">
        <h2 className="min-w-30 flex-1 truncate text-base font-medium text-text" title={path}>
          {path}
        </h2>
        <Badge tone={clean ? 'success' : 'warning'}>{clean ? 'All conflicts resolved' : `${Math.min(current + 1, conflicts)} of ${conflicts} · ${resolved} picked`}</Badge>
        <Tooltip content="Previous conflict">
          <IconButton label="Previous conflict" onClick={() => go(-1)} disabled={!conflicts}>
            <ChevronUp size={16} />
          </IconButton>
        </Tooltip>
        <Tooltip content="Next conflict">
          <IconButton label="Next conflict" onClick={() => go(1)} disabled={!conflicts}>
            <ChevronDown size={16} />
          </IconButton>
        </Tooltip>
        <Tooltip content={showBase ? 'Hide the common ancestor column' : 'Show what both sides started from, between them'}>
          <IconButton label="Show the base (common ancestor)" pressed={showBase} onClick={() => setPrefs({ mergeShowBase: !showBase })}>
            <Columns3 size={16} />
          </IconButton>
        </Tooltip>
        <Tooltip content="Resolve this file in your own merge tool (Settings › External tools)">
          <Button size="sm" variant="ghost" onClick={() => act.externalTool(repoId, 'merge', path)}>
            Merge tool
          </Button>
        </Tooltip>
        <Tooltip content={`Use the whole file from ${labels.ours}`}>
          <Button size="sm" onClick={() => void takeAll('ours')}>
            Keep yours
          </Button>
        </Tooltip>
        <Tooltip content={`Use the whole file from ${labels.theirs}`}>
          <Button size="sm" onClick={() => void takeAll('theirs')}>
            Keep theirs
          </Button>
        </Tooltip>
        <Button size="sm" variant="primary" disabled={!clean} loading={saving} onClick={() => void save()}>
          Save result
        </Button>
        <Tooltip content="Close" shortcut="Esc">
          <IconButton label="Close" onClick={close}>
            <X size={16} />
          </IconButton>
        </Tooltip>
      </header>
      <div className="flex min-h-0 flex-1 divide-x divide-border">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <h3 className="shrink-0 border-b border-border bg-surface px-3 py-1 text-sm text-muted">
            Yours · <span className="text-text">{labels.ours}</span>
          </h3>
          {side('ours')}
        </div>
        {showBase ? (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <h3 className="shrink-0 border-b border-border bg-surface px-3 py-1 text-sm text-muted">
              Base · <span className="text-text">common ancestor</span>
            </h3>
            {basePane()}
          </div>
        ) : null}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <h3 className="shrink-0 border-b border-border bg-surface px-3 py-1 text-sm text-muted">
            Theirs · <span className="text-text">{labels.theirs}</span>
          </h3>
          {side('theirs')}
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col border-t border-border">
        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-surface px-3 py-1">
          <h3 className="flex-1 text-sm text-muted">Result {edited ? '(edited by hand)' : ''}</h3>
          {edited ? (
            <Button size="sm" variant="ghost" icon={<RotateCcw size={14} />} onClick={() => setEdited(false)}>
              Rebuild from picks
            </Button>
          ) : null}
        </div>
        <textarea
          aria-label="Merged result"
          spellCheck={false}
          value={output}
          onChange={(e) => {
            setEdited(true)
            setOutput(e.target.value)
          }}
          className="min-h-0 flex-1 resize-none bg-surface-sunken p-3 font-mono text-code whitespace-pre text-text outline-none focus-visible:outline-2 focus-visible:-outline-offset-2"
        />
      </div>
    </section>
  )
}

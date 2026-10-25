import { useEffect, useState } from 'react'
import { Copy, ScrollText, X } from 'lucide-react'
import type { ActivityEntry } from '../../../shared/types'
import { Badge, EmptyState, IconButton, SegmentedControl, Tooltip } from '@/ui'
import { cn } from '@/ui/cn'
import { call } from '@/lib/api'
import * as act from '@/actions'

const tone = { ok: 'success', error: 'danger', running: 'accent', cancelled: 'neutral' } as const
const label = { ok: 'OK', error: 'Failed', running: 'Running', cancelled: 'Stopped' }

/** S16: every git command the app ran for this repository, newest first. */
export function ActivityLog({ repoId }: { repoId: string }): React.JSX.Element {
  const [rows, setRows] = useState<ActivityEntry[] | null>(null)
  const [filter, setFilter] = useState<'all' | 'error'>('all')
  const [sel, setSel] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    const load = (): void => {
      call('activity.list', { repoId, limit: 300 })
        .then((r) => {
          if (!live) return
          setRows(r)
          setSel((s) => s ?? r.find((x) => x.status === 'error')?.id ?? r[0]?.id ?? null)
        })
        .catch((e) => act.fail(e))
    }
    load()
    const t = setInterval(load, 3000)
    return () => {
      live = false
      clearInterval(t)
    }
  }, [repoId])

  const shown = (rows ?? []).filter((r) => filter === 'all' || r.status === 'error')
  const current = shown.find((r) => r.id === sel) ?? null

  return (
    <section aria-label="Git activity" className="flex min-h-0 flex-1 flex-col bg-bg">
      <header className="flex h-10 shrink-0 items-center gap-3 border-b border-border bg-surface px-3">
        <h2 className="flex-1 text-md text-text">Git activity</h2>
        <SegmentedControl label="Show" value={filter} onValueChange={setFilter} options={[{ value: 'all', label: 'All' }, { value: 'error', label: 'Failed only' }]} />
        <Tooltip content="Close" shortcut="Esc">
          <IconButton label="Close" onClick={() => act.setCenter(repoId, { kind: 'graph' })}>
            <X size={16} />
          </IconButton>
        </Tooltip>
      </header>
      {rows && shown.length === 0 ? (
        <EmptyState icon={ScrollText} title={filter === 'error' ? 'No failed commands' : 'No Git commands yet'} body="Every git command Caboose runs here lands in this list. Nothing happens behind your back." />
      ) : (
        <div className="flex min-h-0 flex-1 divide-x divide-border">
          <div role="listbox" aria-label="Commands" className="min-h-0 w-1/2 overflow-y-auto">
            {shown.map((r) => (
              <div
                key={r.id}
                role="option"
                aria-selected={r.id === sel}
                tabIndex={0}
                onClick={() => setSel(r.id)}
                onKeyDown={(e) => e.key === 'Enter' && setSel(r.id)}
                className={cn('flex h-7 cursor-default items-center gap-3 px-3 text-sm outline-none hover:bg-row-hover focus-visible:bg-row-hover', r.id === sel && 'bg-row-selected')}
              >
                <span className="w-16 shrink-0 text-muted tabular-nums">{new Date(r.startedAt).toLocaleTimeString()}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-text">{r.argv.join(' ')}</span>
                <span className="w-14 shrink-0 text-right text-muted tabular-nums">{r.finishedAt ? `${r.finishedAt - r.startedAt} ms` : ''}</span>
                <Badge tone={tone[r.status]}>{label[r.status]}</Badge>
              </div>
            ))}
          </div>
          <div className="min-h-0 w-1/2 overflow-y-auto p-3">
            {current ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <Badge tone={tone[current.status]}>{label[current.status]}</Badge>
                  {current.exitCode !== null ? <span className="text-sm text-muted">exit code {current.exitCode}</span> : null}
                  <span className="flex-1" />
                  <Tooltip content="Copy command and output">
                    <IconButton label="Copy command and output" size="sm" onClick={() => void navigator.clipboard.writeText(`${current.argv.join(' ')}\n\n${current.stderrTail ?? ''}`)}>
                      <Copy size={14} />
                    </IconButton>
                  </Tooltip>
                </div>
                <pre className="rounded-md bg-surface-sunken p-2 font-mono text-xs break-all whitespace-pre-wrap text-text">{current.argv.join(' ')}</pre>
                <h3 className="text-sm text-muted">Output</h3>
                <pre className="rounded-md bg-surface-sunken p-2 font-mono text-xs break-all whitespace-pre-wrap text-text">{current.stderrTail || '(no messages)'}</pre>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </section>
  )
}

import { useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import { Button, Spinner } from '@/ui'
import { useApp, useRepo } from '@/store'
import * as act from '@/actions'

/**
 * Under the toolbar while git bisect is going on (started here or in a terminal): which commit is being tested, how
 * far there is to go, and Good / Bad / Skip (also G, B, S) and Stop; then the first bad commit, once it's found.
 */
export function BisectBar({ repoId }: { repoId: string }): React.JSX.Element | null {
  const bisect = useRepo(repoId, (r) => r.status?.bisect ?? null)
  const headSha = useRepo(repoId, (r) => r.refs?.head.sha ?? null)
  const commits = useRepo(repoId, (r) => r.commits)
  const busy = useRepo(repoId, (r) => r.busy.op)
  const run = useRepo(repoId, (r) => r.bisectRun)
  const [showOutput, setShowOutput] = useState(false)
  const summaryOf = (sha: string | null): string => (sha ? (commits.find((c) => c.sha === sha)?.summary ?? '') : '')
  const ready = !!bisect && !bisect.firstBad && !!bisect.bad && bisect.good.length > 0

  // G, B and S mark the commit being tested, unless you're typing or a dialog is open.
  useEffect(() => {
    if (!ready || run) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.metaKey || e.altKey || useApp.getState().dialog || useApp.getState().active !== repoId) return
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
      const verdict = e.key === 'g' ? 'good' : e.key === 'b' ? 'bad' : e.key === 's' ? 'skip' : null
      if (!verdict) return
      e.preventDefault()
      void act.bisectMark(repoId, verdict)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ready, run, repoId])

  if (!bisect && !run) return null
  if (run) {
    const last = run.lines[run.lines.length - 1]
    return (
      <div role="region" aria-label="Bisect" className="flex shrink-0 flex-col border-b border-l-(length:--gc-stripe-w) border-border border-l-accent bg-surface-raised text-sm">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5">
          <Spinner size={14} />
          <span role="status" className="min-w-0 flex-1 truncate">
            Bisecting with <span className="font-mono">{run.command}</span>
            {last ? <span className="text-muted"> · {last}</span> : null}
          </span>
          <Button size="sm" variant="ghost" aria-expanded={showOutput} onClick={() => setShowOutput(!showOutput)}>
            {showOutput ? 'Hide output' : 'Show output'}
          </Button>
          <Button size="sm" onClick={() => act.cancelBisectRun(repoId)}>
            Cancel
          </Button>
        </div>
        {showOutput ? (
          <pre aria-label="Bisect output" className="max-h-48 overflow-auto border-t border-border px-3 py-2 font-mono text-xs whitespace-pre-wrap text-muted">
            {run.lines.join('\n')}
          </pre>
        ) : null}
      </div>
    )
  }
  if (!bisect) return null
  const { terms } = bisect
  const cap = (w: string): string => w.charAt(0).toUpperCase() + w.slice(1)
  return (
    <div role="region" aria-label="Bisect" className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-l-(length:--gc-stripe-w) border-border border-l-accent bg-surface-raised px-3 py-1.5 text-sm">
      <Search size={14} aria-hidden className="shrink-0 text-accent-text" />
      {bisect.firstBad ? (
        <>
          <span role="status" className="min-w-0 flex-1">
            The first {terms.bad} commit is <span className="font-mono">{bisect.firstBad.slice(0, 7)}</span> “{summaryOf(bisect.firstBad)}”.
          </span>
          <Button size="sm" onClick={() => act.select(repoId, bisect.firstBad!)}>
            Show it
          </Button>
          <Button size="sm" onClick={() => void navigator.clipboard.writeText(bisect.firstBad!)}>
            Copy SHA
          </Button>
          <Button size="sm" variant="primary" disabled={!!busy} onClick={() => void act.bisectStop(repoId)}>
            Back to {bisect.start}
          </Button>
        </>
      ) : (
        <>
          <span role="status" className="min-w-0 flex-1">
            {ready ? (
              <>
                Bisecting: testing <span className="font-mono">{headSha?.slice(0, 7)}</span> “{summaryOf(headSha)}”
                {bisect.steps !== null && bisect.left !== null ? ` · about ${bisect.steps === 1 ? '1 step' : `${bisect.steps} steps`} left (${bisect.left} commits)` : ''}. Try it, then say how it was.
              </>
            ) : (
              `Bisecting: mark a ${terms.bad} commit and a ${terms.good} one to begin.`
            )}
          </span>
          <Button size="sm" disabled={!!busy} title={ready ? `${cap(terms.good)} (G)` : undefined} onClick={() => void act.bisectMark(repoId, 'good')}>
            {cap(terms.good)}
          </Button>
          <Button size="sm" disabled={!!busy} title={ready ? `${cap(terms.bad)} (B)` : undefined} onClick={() => void act.bisectMark(repoId, 'bad')}>
            {cap(terms.bad)}
          </Button>
          <Button size="sm" disabled={!!busy || !ready} title="Can’t test this one (S)" onClick={() => void act.bisectMark(repoId, 'skip')}>
            Skip
          </Button>
          <Button size="sm" disabled={!!busy || !ready} title="git bisect run: a command tests each step" onClick={() => act.openDialog({ kind: 'bisectRun', repoId })}>
            Run a command…
          </Button>
          <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void act.bisectStop(repoId)}>
            Stop
          </Button>
        </>
      )}
    </div>
  )
}

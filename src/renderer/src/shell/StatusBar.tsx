import { useEffect, useState } from 'react'
import { AlertTriangle, GitBranch } from 'lucide-react'
import { useRepo } from '@/store'
import * as act from '@/actions'

function ago(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000)
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`
}

const opNames = { merge: 'Merging', rebase: 'Rebasing', cherry_pick: 'Cherry-picking', revert: 'Reverting', none: '' }

export function StatusBar({ repoId }: { repoId: string }): React.JSX.Element {
  const status = useRepo(repoId, (r) => r.status)
  const lastFetch = useRepo(repoId, (r) => r.lastFetch)
  const fetchFailed = useRepo(repoId, (r) => r.fetchFailed)
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000)
    return () => clearInterval(t)
  }, [])
  const op = status?.op
  return (
    <footer className="flex h-(--gc-statusbar-h) shrink-0 items-center gap-4 border-t border-border bg-surface-sunken px-3 text-xs text-muted">
      <span className="flex items-center gap-1">
        <GitBranch size={12} aria-hidden />
        {status?.branch ?? 'detached HEAD'}
      </span>
      {status?.upstream ? (
        <span>
          {status.upstream} · ↑{status.ahead} ↓{status.behind}
        </span>
      ) : status?.branch ? (
        <span>Not on any remote yet</span>
      ) : null}
      <button onClick={() => void act.fetchAll(repoId)} className={fetchFailed ? 'flex items-center gap-1 text-warning hover:underline' : 'hover:text-text hover:underline'}>
        {fetchFailed ? <AlertTriangle size={12} aria-hidden /> : null}
        {fetchFailed ? 'Fetch failed. Retry' : lastFetch ? `Fetched ${ago(lastFetch)}` : 'Fetch now'}
      </button>
      <span className="flex-1" />
      {op && op.kind !== 'none' ? (
        <span className="text-warning">
          {opNames[op.kind]}
          {op.total ? ` ${op.step}/${op.total}` : ''}
        </span>
      ) : null}
      <button onClick={() => act.openLog()} className="hover:text-text hover:underline">
        Git log
      </button>
    </footer>
  )
}

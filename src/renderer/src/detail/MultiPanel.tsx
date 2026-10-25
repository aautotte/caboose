import { Combine, Copy, GitPullRequestArrow, ListOrdered, X } from 'lucide-react'
import { Avatar, Button, IconButton, Tooltip } from '@/ui'
import { relativeTime, shortSha } from '@/lib/format'
import { useRepo } from '@/store'
import * as act from '@/actions'
import { CollapseDetailsButton } from '@/shell/PanelRails'
import { squashProblem } from '@/graph/GraphView'

/** Several commits picked in the graph (Ctrl / Shift-click): what they are and what can be done with them together. */
export function MultiPanel({ repoId, shas }: { repoId: string; shas: string[] }): React.JSX.Element {
  const commits = useRepo(repoId, (r) => r.commits)
  const headBranch = useRepo(repoId, (r) => r.refs?.head.branch ?? 'HEAD')
  useRepo(repoId, (r) => r.refs?.head.sha) // re-render when the branch moves
  const rows = shas.map((s) => commits.find((c) => c.sha === s)).filter((c): c is NonNullable<typeof c> => !!c)
  const line = act.headLine(repoId)
  const parentsOf = (sha: string): string[] | undefined => commits.find((c) => c.sha === sha)?.parents
  const squashWhy = squashProblem(shas, line, parentsOf)
  const onLine = shas.every((s) => line.includes(s))
  const offLine = shas.every((s) => !line.includes(s))
  const authors = new Set(rows.map((r) => r.authorEmail)).size

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
        <CollapseDetailsButton />
        <h2 className="flex-1 text-md text-text">{shas.length} commits selected</h2>
        <Tooltip content="Clear the selection" shortcut="Esc">
          <IconButton label="Clear the selection" size="sm" onClick={() => act.select(repoId, shas[0])}>
            <X size={14} />
          </IconButton>
        </Tooltip>
      </header>
      <div className="flex shrink-0 flex-col gap-2 border-b border-border p-3">
        <p className="text-sm text-muted">
          {authors === 1 ? 'One author' : `${authors} authors`}
          {rows.length ? ` · ${relativeTime(rows[rows.length - 1].authorTime)} to ${relativeTime(rows[0].authorTime)}` : ''}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="primary" disabled={!!squashWhy} onClick={() => act.askSquash(repoId, shas)}>
            <Combine size={14} aria-hidden />
            Squash into one…
          </Button>
          <Button size="sm" disabled={!onLine} onClick={() => act.rebaseRange(repoId, shas)}>
            <ListOrdered size={14} aria-hidden />
            Rebase these…
          </Button>
          {offLine ? (
            <Button size="sm" onClick={() => void act.cherryPick(repoId, [...shas].reverse())}>
              <GitPullRequestArrow size={14} aria-hidden />
              Cherry-pick onto {headBranch}
            </Button>
          ) : null}
          <Tooltip content="Copy the SHAs, one per line">
            <IconButton label="Copy commit SHAs" size="sm" onClick={() => void navigator.clipboard.writeText(shas.join('\n'))}>
              <Copy size={14} />
            </IconButton>
          </Tooltip>
        </div>
        {squashWhy ? <p className="text-sm text-muted">Squash: {squashWhy}</p> : null}
      </div>
      <ul aria-label="Selected commits, newest first" className="min-h-0 flex-1 overflow-y-auto py-1">
        {rows.map((r) => (
          <li key={r.sha}>
            <button
              type="button"
              onClick={() => act.select(repoId, r.sha)}
              className="flex h-(--gc-list-row-h) w-full items-center gap-2 px-3 text-left hover:bg-row-hover"
              title="Show only this commit"
            >
              <Avatar name={r.authorName} email={r.authorEmail} decorative />
              <span className="min-w-0 flex-1 truncate text-base text-text">{r.summary}</span>
              <span className="shrink-0 font-mono text-xs text-muted">{shortSha(r.sha)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

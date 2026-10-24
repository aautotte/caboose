import { Cloud, GitBranch, Tag } from 'lucide-react'
import { cn } from './cn'

export type FileStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'conflicted' | 'untracked'

const status: Record<FileStatus, { letter: string; label: string; cls: string }> = {
  added: { letter: 'A', label: 'Added', cls: 'bg-success text-on-lane' },
  modified: { letter: 'M', label: 'Modified', cls: 'bg-warning text-on-lane' },
  deleted: { letter: 'D', label: 'Deleted', cls: 'bg-danger text-on-lane' },
  renamed: { letter: 'R', label: 'Renamed', cls: 'bg-info text-on-lane' },
  copied: { letter: 'C', label: 'Copied', cls: 'bg-info text-on-lane' },
  conflicted: { letter: 'U', label: 'Conflicted', cls: 'bg-danger text-on-lane' },
  untracked: { letter: '?', label: 'Untracked', cls: 'border border-success text-success' }
}

/** Letter + colour, so status never depends on colour alone. */
export function StatusIcon({ kind }: { kind: FileStatus }): React.JSX.Element {
  const s = status[kind]
  return (
    <span
      role="img"
      aria-label={s.label}
      title={s.label}
      className={cn('inline-grid size-4 shrink-0 place-items-center rounded-sm font-mono text-2xs font-bold', s.cls)}
    >
      {s.letter}
    </span>
  )
}

export type RefKind = 'local' | 'remote' | 'both' | 'tag'

export function RefPill({
  name,
  kind,
  lane,
  remote,
  current = false,
  detached = false
}: {
  name: string
  kind: RefKind
  lane: number
  remote?: string
  current?: boolean
  detached?: boolean
}): React.JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex h-5 max-w-full items-center gap-1 overflow-hidden rounded-sm border-l-(length:--gc-stripe-w) bg-surface-raised pr-1.5 pl-1 text-sm font-medium text-text',
        current && 'font-semibold outline outline-1 outline-accent-text',
        detached && 'outline outline-1 outline-warning'
      )}
      style={{ borderLeftColor: `var(--gc-color-lane-${lane % 8})` }}
    >
      {current ? <span role="img" aria-label="Checked out" className="size-1.5 shrink-0 rounded-pill bg-accent-text" /> : null}
      {kind === 'tag' ? (
        <Tag size={12} aria-hidden className="shrink-0 text-muted" />
      ) : kind === 'remote' ? (
        <Cloud size={12} aria-hidden className="shrink-0 text-muted" />
      ) : (
        <GitBranch size={12} aria-hidden className="shrink-0 text-muted" />
      )}
      <span className="truncate">
        {kind === 'remote' && remote ? <span className="text-muted">{remote}/</span> : null}
        {detached ? 'HEAD (detached)' : name}
      </span>
      {kind === 'both' ? <Cloud size={12} aria-label="Also on remote" className="shrink-0 text-muted" /> : null}
    </span>
  )
}

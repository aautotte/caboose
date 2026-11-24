import { useEffect, useRef } from 'react'
import { ListFilter, X } from 'lucide-react'
import { IconButton, Spinner, TextInput, Tooltip, type MenuEntry } from '@/ui'
import { plural } from '@/lib/format'
import { useRepo } from '@/store'
import * as act from '@/actions'

/** A file's or folder's menu: the graph with only the commits that change it. */
export function filterPathEntry(repoId: string, path: string, folder = false, disabled = false): MenuEntry {
  return { type: 'item', label: folder ? `Show only commits that change ${path}/` : 'Show only commits that change it', icon: <ListFilter size={14} />, disabled, onSelect: () => act.setFilter(repoId, { path: folder ? `${path}/` : path }) }
}

/** Above the graph while it's open: only the commits that change a path, by an author. Esc or × shows every commit again. */
export function FilterBar({ repoId }: { repoId: string }): React.JSX.Element | null {
  const filter = useRepo(repoId, (r) => r.filter)
  const commits = useRepo(repoId, (r) => r.commits)
  const hasMore = useRepo(repoId, (r) => r.hasMore)
  const loading = useRepo(repoId, (r) => r.loading)
  const on = useRepo(repoId, (r) => !!act.graphFilter(r))
  const pathRef = useRef<HTMLInputElement>(null)
  // Everyone seen in the graph since the bar opened, so filtering by one person still suggests the others.
  const people = useRef(new Set<string>())
  for (const c of commits) if (c.kind === 'commit' && people.current.size < 200) people.current.add(c.authorName)

  useEffect(() => {
    const focus = (): void => pathRef.current?.focus()
    window.addEventListener('gc:focus-filter', focus)
    return () => window.removeEventListener('gc:focus-filter', focus)
  }, [])

  if (!filter) return null
  const shown = commits.filter((c) => c.kind === 'commit').length
  const close = (): void => {
    act.setFilter(repoId, null)
    ;(document.querySelector('[role=grid]') as HTMLElement | null)?.focus()
  }
  const keys = (e: React.KeyboardEvent): void => {
    if (e.key !== 'Escape') return
    e.preventDefault()
    close()
  }
  return (
    <div role="search" aria-label="Filter the graph" className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-surface-raised px-3 py-1.5 text-sm">
      <ListFilter size={14} aria-hidden className="shrink-0 text-muted" />
      <label className="flex min-w-48 flex-1 items-center gap-1.5">
        <span className="shrink-0 text-muted">Path</span>
        <TextInput
          ref={pathRef}
          size="sm"
          value={filter.path}
          placeholder="File, folder or pattern, like src/ or *.md"
          onChange={(e) => act.setFilter(repoId, { path: e.target.value }, 300)}
          onKeyDown={keys}
        />
      </label>
      <label className="flex min-w-40 flex-1 items-center gap-1.5">
        <span className="shrink-0 text-muted">Author</span>
        <TextInput size="sm" list={`filter-people-${repoId}`} value={filter.author} placeholder="Name or email" onChange={(e) => act.setFilter(repoId, { author: e.target.value }, 300)} onKeyDown={keys} />
      </label>
      <datalist id={`filter-people-${repoId}`}>
        {[...people.current].map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>
      <span role="status" className="flex shrink-0 items-center gap-1.5 text-muted">
        {loading ? <Spinner size={12} /> : null}
        {on && !loading ? (hasMore ? `${plural(shown, 'commit')} so far` : plural(shown, 'commit')) : null}
      </span>
      <Tooltip content="Show every commit again" shortcut="Esc">
        <IconButton label="Clear the filter" size="sm" onClick={close}>
          <X size={14} />
        </IconButton>
      </Tooltip>
    </div>
  )
}

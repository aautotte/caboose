import { useEffect, useState } from 'react'
import { AlertTriangle, DownloadCloud, Folder, FolderGit2, FolderOpen, FolderPlus, MoreHorizontal, Star, X } from 'lucide-react'
import type { RepoGroup, RepoList, RepoSummary } from '../../../shared/types'
import { Button, ContextMenu, DropdownMenu, EmptyState, IconButton, Tooltip, type MenuEntry } from '@/ui'
import { cn } from '@/ui/cn'
import { call } from '@/lib/api'
import { relativeTime } from '@/lib/format'
import { useApp } from '@/store'
import * as act from '@/actions'

/** S01: open, clone or start a repository; recent and favourite repositories. */
export function HomeView(): React.JSX.Element {
  const [list, setList] = useState<RepoList | null>(null)
  const tabs = useApp((s) => s.tabs)

  const refresh = (): void => {
    call('repo.list', {})
      .then(setList)
      .catch((e) => act.fail(e))
  }
  useEffect(refresh, [tabs.length])

  const recent = list?.recent ?? []
  const favorites = list?.favorites ?? []
  const groups = list?.groups ?? []
  // Edits from a dialog refresh the list when the dialog closes.
  const dialogOpen = useApp((s) => s.dialog !== null)
  useEffect(() => {
    if (!dialogOpen) refresh()
  }, [dialogOpen])
  const empty = list && recent.length === 0 && favorites.length === 0

  return (
    <main className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-(--gc-content-w) flex-col gap-8 px-8 py-10">
        <header className="flex flex-col gap-1">
          <h1 className="text-xl text-text">Repositories</h1>
          <p className="text-base text-muted">Open a project that already uses Git, clone one, or start from nothing.</p>
        </header>

        <div className="grid grid-cols-3 gap-3">
          <ActionCard icon={<FolderOpen size={20} />} title="Open" body="A folder on this computer" shortcut="Alt+O" onClick={() => void act.pickAndOpen()} />
          <ActionCard icon={<DownloadCloud size={20} />} title="Clone" body="Copy from a URL" onClick={() => act.openDialog({ kind: 'clone' })} />
          <ActionCard icon={<FolderPlus size={20} />} title="New" body="Start an empty repository" onClick={() => act.openDialog({ kind: 'init' })} />
        </div>

        {!list ? (
          <div role="status" className="flex flex-col gap-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-12 rounded-md bg-surface" />
            ))}
          </div>
        ) : empty ? (
          <EmptyState
            icon={FolderGit2}
            title="Nobody here but us robots"
            body="Open a repository and it’ll be waiting here next time, one click away."
          />
        ) : (
          <>
            {favorites.length ? <RepoSection title="Favourites" repos={favorites} groups={groups} onChange={refresh} /> : null}
            {groups.map((g) => (
              <RepoSection key={g.id} title={g.name} group={g} repos={g.repos} groups={groups} onChange={refresh} />
            ))}
            <RepoSection title="Recent" repos={recent} groups={groups} onChange={refresh} />
            <div>
              <Button size="sm" variant="ghost" icon={<FolderPlus size={14} />} onClick={() => act.openDialog({ kind: 'groupName', mode: 'create', name: '' })}>
                New group
              </Button>
            </div>
          </>
        )}
      </div>
    </main>
  )
}

function ActionCard({ icon, title, body, onClick, shortcut }: { icon: React.ReactNode; title: string; body: string; onClick: () => void; shortcut?: string }): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      aria-keyshortcuts={shortcut}
      className="flex items-center gap-3 rounded-lg border border-border bg-surface p-4 text-left hover:border-border-input hover:bg-row-hover"
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-md bg-surface-raised text-accent-text">{icon}</span>
      <span className="flex flex-col">
        <span className="text-md text-text">{title}</span>
        <span className="text-sm text-muted">{body}</span>
      </span>
    </button>
  )
}

function RepoSection({
  title,
  group,
  repos,
  groups,
  onChange
}: {
  title: string
  group?: RepoGroup
  repos: RepoSummary[]
  groups: RepoGroup[]
  onChange: () => void
}): React.JSX.Element {
  const del = async (): Promise<void> => {
    try {
      await call('group.delete', { groupId: group!.id })
      onChange()
    } catch (e) {
      act.fail(e)
    }
  }
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        {group ? <Folder size={14} aria-hidden className="text-muted" /> : null}
        <h2 className="flex-1 truncate text-sm font-medium text-muted">{title}</h2>
        {group ? (
          <DropdownMenu
            trigger={
              <IconButton label={`Group options for ${title}`} size="sm">
                <MoreHorizontal size={14} />
              </IconButton>
            }
            items={[
              { type: 'item', label: 'Rename group…', onSelect: () => act.openDialog({ kind: 'groupName', mode: 'rename', groupId: group.id, name: group.name }) },
              { type: 'item', label: 'Delete group (keeps the repositories)', danger: true, onSelect: () => void del() }
            ]}
          />
        ) : null}
      </div>
      {repos.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted">Empty. Right-click a repository and choose “Move to group”.</p>
      ) : (
        <ul className="flex flex-col overflow-hidden rounded-lg border border-border">
          {repos.map((r) => (
            <RepoRow key={r.id} r={r} groups={groups} onChange={onChange} />
          ))}
        </ul>
      )}
    </section>
  )
}

function RepoRow({ r, groups, onChange }: { r: RepoSummary; groups: RepoGroup[]; onChange: () => void }): React.JSX.Element {
  const setGroup = async (groupId: string | null): Promise<void> => {
    try {
      await call('repo.update', { repoId: r.id, groupId })
      onChange()
    } catch (e) {
      act.fail(e)
    }
  }
  const groupMenu: MenuEntry = {
    type: 'sub',
    label: 'Move to group',
    icon: <Folder size={14} />,
    items: [
      ...groups.map((g): MenuEntry => ({ type: 'item', label: g.name, disabled: g.id === r.groupId, onSelect: () => void setGroup(g.id) })),
      ...(groups.length ? [{ type: 'separator' } as MenuEntry] : []),
      { type: 'item', label: 'New group…', onSelect: () => act.openDialog({ kind: 'groupName', mode: 'create', name: '', repoId: r.id }) },
      ...(r.groupId ? [{ type: 'item', label: 'Take out of its group', onSelect: () => void setGroup(null) } as MenuEntry] : [])
    ]
  }
  const toggleFav = async (): Promise<void> => {
    try {
      await call('repo.update', { repoId: r.id, isFavorite: !r.isFavorite })
      onChange()
    } catch (e) {
      act.fail(e)
    }
  }
  const forget = async (): Promise<void> => {
    try {
      await call('repo.forget', { repoId: r.id })
      useApp.setState((s) => ({ tabs: s.tabs.filter((t) => t.id !== r.id) }))
      onChange()
    } catch (e) {
      act.fail(e)
    }
  }
  return (
    <ContextMenu
      items={[
        { type: 'item', label: 'Open', disabled: r.missing, onSelect: () => void act.openRepo(r.path) },
        { type: 'item', label: r.isFavorite ? 'Remove from favourites' : 'Add to favourites', onSelect: () => void toggleFav() },
        groupMenu,
        { type: 'item', label: 'Copy path', onSelect: () => void navigator.clipboard.writeText(r.path) },
        { type: 'separator' },
        { type: 'item', label: 'Remove from this list', onSelect: () => void forget() }
      ]}
    >
      <li className="group flex items-center gap-3 border-b border-border bg-surface px-3 py-2 last:border-b-0 hover:bg-row-hover">
        <FolderGit2 size={18} aria-hidden className={cn('shrink-0', r.missing ? 'text-disabled' : 'text-muted')} />
        <button disabled={r.missing} onClick={() => void act.openRepo(r.path)} className="flex min-w-0 flex-1 flex-col text-left disabled:cursor-not-allowed">
          <span className={cn('truncate text-base', r.missing ? 'text-muted line-through' : 'text-text')}>{r.alias ?? r.name}</span>
          <span className="truncate text-sm text-muted">{r.path}</span>
        </button>
        {r.missing ? (
          <span className="flex items-center gap-1 text-sm text-warning">
            <AlertTriangle size={14} aria-hidden /> Folder not found
          </span>
        ) : r.lastOpenedAt ? (
          <span className="shrink-0 text-sm text-muted">{relativeTime(r.lastOpenedAt / 1000)}</span>
        ) : null}
        <Tooltip content={r.isFavorite ? 'Remove from favourites' : 'Add to favourites'}>
          <IconButton label={r.isFavorite ? 'Remove from favourites' : 'Add to favourites'} size="sm" pressed={r.isFavorite} onClick={() => void toggleFav()}>
            <Star size={14} className={r.isFavorite ? 'fill-current text-warning' : ''} />
          </IconButton>
        </Tooltip>
        <Tooltip content="Remove from this list">
          <IconButton label="Remove from this list" size="sm" className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" onClick={() => void forget()}>
            <X size={14} />
          </IconButton>
        </Tooltip>
      </li>
    </ContextMenu>
  )
}

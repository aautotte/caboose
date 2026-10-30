import { Archive, ArchiveRestore, ArrowDownToLine, ArrowUpFromLine, ChevronDown, Command, ExternalLink, FolderOpen, GitBranchPlus, Globe, Redo2, Settings, SquareTerminal, Undo2 } from 'lucide-react'
import { DropdownMenu as RMenu } from 'radix-ui'
import { Check } from 'lucide-react'
import type { PullMode } from '../../../shared/types'
import { DropdownMenu, IconButton, Spinner, TextInput, Tooltip, Shortcut } from '@/ui'
import { cn } from '@/ui/cn'
import { setPrefs, useApp, useRepo } from '@/store'
import * as act from '@/actions'
import { progressAmount } from '@/lib/format'

const pullModes: Array<{ mode: PullMode; label: string }> = [
  { mode: 'ff', label: 'Pull (fast-forward when possible)' },
  { mode: 'ff-only', label: 'Pull (fast-forward only)' },
  { mode: 'rebase', label: 'Pull (rebase)' }
]

function ToolButton({ label, shortcut, icon, onClick, disabled, busy, text }: { label: string; shortcut?: string; icon: React.ReactNode; onClick: () => void; disabled?: boolean; busy?: boolean; text: string }): React.JSX.Element {
  return (
    <Tooltip content={label} shortcut={shortcut}>
      <span>
        <button
          type="button"
          aria-label={label}
          disabled={disabled || busy}
          aria-busy={busy || undefined}
          onClick={onClick}
          className="flex h-9 min-w-12 flex-col items-center justify-center gap-0.5 rounded-md px-2 text-xs text-muted enabled:hover:bg-row-hover enabled:hover:text-text disabled:text-disabled"
        >
          {busy ? <Spinner size={16} /> : icon}
          <span>{text}</span>
        </button>
      </span>
    </Tooltip>
  )
}

export function Toolbar({ repoId }: { repoId: string }): React.JSX.Element {
  const undo = useRepo(repoId, (r) => r.undo)
  const busy = useRepo(repoId, (r) => r.busy)
  const refs = useRepo(repoId, (r) => r.refs)
  const search = useRepo(repoId, (r) => r.search)
  const hits = useRepo(repoId, (r) => r.searchHits)
  const progress = useRepo(repoId, (r) => r.progress)
  const dirty = useRepo(repoId, (r) => (r.status?.changes.length ?? 0) > 0)
  const pullMode = useApp((s) => s.prefs.pullMode)
  const tab = useApp((s) => s.tabs.find((t) => t.id === repoId))
  const head = refs?.head
  const remotes = refs?.remotes ?? []
  // The remote the current branch tracks, from its upstream (refs/remotes/<remote>/<branch>).
  const upstream = refs?.refs.find((r) => r.kind === 'local' && r.isHead)?.upstream
  const tracked = upstream ? remotes.find((r) => upstream.startsWith(`refs/remotes/${r}/`)) : undefined
  const branchLabel = head?.branch ?? (head?.sha ? `Detached at ${head.sha.slice(0, 7)}` : '…')

  return (
    <div role="toolbar" aria-label="Repository actions" className="flex h-(--gc-toolbar-h) shrink-0 items-center gap-3 border-b border-border bg-surface px-3">
      <div className="flex min-w-0 flex-col leading-tight">
        <h1 className="truncate text-md text-text">{tab?.alias ?? tab?.name}</h1>
        <span className={cn('truncate text-sm', head?.detached ? 'text-warning' : 'text-muted')}>{branchLabel}</span>
      </div>
      <div className="mx-auto flex items-center gap-1">
        <ToolButton
          label={undo.undo ? `Undo: ${undo.undo.label}` : 'Nothing to undo'}
          shortcut="Ctrl+Z"
          text="Undo"
          icon={<Undo2 size={16} />}
          disabled={!undo.undo}
          onClick={() => void act.undo(repoId)}
        />
        <ToolButton
          label={undo.redo ? `Redo: ${undo.redo.label}` : 'Nothing to redo'}
          shortcut="Ctrl+Y"
          text="Redo"
          icon={<Redo2 size={16} />}
          disabled={!undo.redo}
          onClick={() => void act.redo(repoId)}
        />
        <span className="mx-1 h-6 w-px bg-border" />
        <div className="flex items-center">
          <ToolButton
            label={pullModes.find((p) => p.mode === pullMode)!.label}
            text="Pull"
            icon={<ArrowDownToLine size={16} />}
            busy={!!busy.pull || !!busy.fetch}
            onClick={() => void act.pull(repoId)}
          />
          <RMenu.Root>
            <RMenu.Trigger asChild>
              <button aria-label="Pull options" className="grid h-9 w-4 place-items-center rounded-md text-muted hover:bg-row-hover hover:text-text">
                <ChevronDown size={12} />
              </button>
            </RMenu.Trigger>
            <RMenu.Portal>
              <RMenu.Content align="start" sideOffset={4} className="z-(--gc-z-dropdown) min-w-64 rounded-md border border-border bg-surface-raised p-1 shadow-pop">
                <RMenu.Item onSelect={() => void act.fetchAll(repoId)} className="flex h-7 items-center justify-between gap-4 rounded-sm px-2 text-base text-text outline-none data-highlighted:bg-row-selected">
                  Fetch all remotes <Shortcut keys="Ctrl+L" />
                </RMenu.Item>
                <RMenu.Separator className="my-1 h-px bg-border" />
                {pullModes.map((p) => (
                  <RMenu.Item key={p.mode} onSelect={() => void act.pull(repoId, p.mode)} className="flex h-7 items-center rounded-sm px-2 text-base text-text outline-none data-highlighted:bg-row-selected">
                    {p.label}
                  </RMenu.Item>
                ))}
                <RMenu.Separator className="my-1 h-px bg-border" />
                <RMenu.Label className="px-2 py-1 text-xs text-muted">The Pull button uses</RMenu.Label>
                <RMenu.RadioGroup value={pullMode} onValueChange={(v) => setPrefs({ pullMode: v as PullMode })}>
                  {pullModes.map((p) => (
                    <RMenu.RadioItem key={p.mode} value={p.mode} className="flex h-7 items-center gap-2 rounded-sm px-2 text-base text-text outline-none data-highlighted:bg-row-selected">
                      <span className="w-4">
                        <RMenu.ItemIndicator>
                          <Check size={14} className="text-accent-text" />
                        </RMenu.ItemIndicator>
                      </span>
                      {p.label.replace('Pull ', '').replace(/[()]/g, '')}
                    </RMenu.RadioItem>
                  ))}
                </RMenu.RadioGroup>
              </RMenu.Content>
            </RMenu.Portal>
          </RMenu.Root>
        </div>
        <div className="flex items-center">
          <ToolButton
            label="Push"
            text="Push"
            icon={<ArrowUpFromLine size={16} />}
            busy={!!busy.push}
            disabled={!head?.branch}
            onClick={() => void act.push(repoId)}
          />
          {remotes.length > 1 ? (
            <RMenu.Root>
              <RMenu.Trigger asChild>
                <button
                  aria-label="Push to another remote"
                  disabled={!head?.branch || !!busy.push}
                  className="grid h-9 w-4 place-items-center rounded-md text-muted enabled:hover:bg-row-hover enabled:hover:text-text disabled:text-disabled"
                >
                  <ChevronDown size={12} />
                </button>
              </RMenu.Trigger>
              <RMenu.Portal>
                <RMenu.Content align="start" sideOffset={4} className="z-(--gc-z-dropdown) min-w-56 rounded-md border border-border bg-surface-raised p-1 shadow-pop">
                  <RMenu.Label className="truncate px-2 py-1 text-xs text-muted">Push {head?.branch} to</RMenu.Label>
                  {remotes.map((r) => (
                    <RMenu.Item
                      key={r}
                      // Pushing elsewhere leaves the branch's tracking alone; a branch that tracks nothing yet starts tracking this remote.
                      onSelect={() => void act.push(repoId, { remote: r, setUpstream: !upstream })}
                      className="flex h-7 items-center justify-between gap-4 rounded-sm px-2 text-base text-text outline-none data-highlighted:bg-row-selected"
                    >
                      <span className="truncate">{r}</span>
                      {r === tracked ? <span className="text-xs text-muted">tracked</span> : null}
                    </RMenu.Item>
                  ))}
                </RMenu.Content>
              </RMenu.Portal>
            </RMenu.Root>
          ) : null}
        </div>
        <span className="mx-1 h-6 w-px bg-border" />
        <ToolButton
          label="New branch from here"
          shortcut="Ctrl+B"
          text="Branch"
          icon={<GitBranchPlus size={16} />}
          disabled={!head?.sha}
          onClick={() => act.openDialog({ kind: 'createBranch', repoId, at: head!.sha!, atLabel: head?.branch ?? head!.sha!.slice(0, 7) })}
        />
        <ToolButton
          label={dirty ? 'Stash your changes' : 'No changes to stash'}
          text="Stash"
          icon={<Archive size={16} />}
          disabled={!dirty || !head?.sha}
          onClick={() => act.openDialog({ kind: 'stash', repoId })}
        />
        <ToolButton
          label={refs?.stashes[0] ? `Pop the newest stash: ${refs.stashes[0].message}` : 'Pop: no stashes'}
          text="Pop"
          icon={<ArchiveRestore size={16} />}
          disabled={!refs?.stashes.length}
          onClick={() => act.popLatest(repoId)}
        />
      </div>
      {busy.checkout ? (
        <span role="status" aria-live="polite" className="flex w-56 items-center gap-1.5 text-sm text-muted">
          <Spinner size={14} />
          {/* What it's doing, and under it git's progress: "Updating files 45% (58234/129384)". */}
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="truncate">{busy.checkout}</span>
            {progress ? <span className="truncate text-xs">{`${progress.phase} ${progressAmount(progress)}`.trimEnd()}</span> : null}
          </span>
        </span>
      ) : progress ? (
        <span role="status" aria-live="polite" className="flex w-44 flex-col text-sm leading-tight text-muted">
          <span className="truncate">{progress.phase}</span>
          {progress.percent !== undefined ? <span className="truncate text-xs">{progressAmount(progress)}</span> : null}
        </span>
      ) : null}
      <div className="flex w-72 items-center gap-1">
        <TextInput
          variant="search"
          size="sm"
          aria-label="Search commits"
          id="commit-search"
          placeholder="Search message, SHA or author"
          value={search}
          onChange={(e) => act.setSearch(repoId, e.target.value)}
          onClear={() => act.setSearch(repoId, '')}
          onKeyDown={(e) => e.key === 'Escape' && act.setSearch(repoId, '')}
        />
        {hits ? <span className="shrink-0 text-xs text-muted" aria-live="polite">{hits.length} found</span> : null}
      </div>
      <DropdownMenu
        trigger={
          <IconButton label="Open the repository in…">
            <ExternalLink size={16} />
          </IconButton>
        }
        items={[
          { type: 'item', label: 'File manager', icon: <FolderOpen size={14} />, onSelect: () => void act.openIn(repoId, 'folder') },
          { type: 'item', label: 'Terminal', icon: <SquareTerminal size={14} />, onSelect: () => void act.openIn(repoId, 'terminal') },
          { type: 'item', label: 'Editor', icon: <ExternalLink size={14} />, onSelect: () => void act.openIn(repoId, 'editor') },
          { type: 'item', label: 'Browser', icon: <Globe size={14} />, disabled: !refs?.remotes.length, onSelect: () => void act.openOnWeb(repoId, { kind: 'repo' }) }
        ]}
      />
      <Tooltip content="Command palette" shortcut="Ctrl+P">
        <IconButton label="Command palette" onClick={() => useApp.setState({ paletteOpen: true })}>
          <Command size={16} />
        </IconButton>
      </Tooltip>
      <Tooltip content="Settings">
        <IconButton label="Settings" onClick={() => act.setCenter(repoId, { kind: 'prefs' })}>
          <Settings size={16} />
        </IconButton>
      </Tooltip>
    </div>
  )
}

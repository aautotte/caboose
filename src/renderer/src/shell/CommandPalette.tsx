import { useMemo, useState } from 'react'
import { Command } from 'cmdk'
import { Dialog as RDialog } from 'radix-ui'
import { setPrefs, useApp } from '@/store'
import * as act from '@/actions'
import { Shortcut } from '@/ui'

interface Cmd {
  id: string
  group: string
  label: string
  shortcut?: string
  run: () => void
}

/** S12: every action, by keyboard. Branch names are commands too ("Check out …"). */
export function CommandPalette(): React.JSX.Element | null {
  const open = useApp((s) => s.paletteOpen)
  const active = useApp((s) => s.active)
  const refs = useApp((s) => (s.active !== 'home' ? s.repos[s.active]?.refs : undefined))
  const center = useApp((s) => (s.active !== 'home' ? s.repos[s.active]?.center : undefined))
  const focused = useApp((s) => (s.active !== 'home' ? (s.repos[s.active]?.refView.hidden.length ?? 0) + (s.repos[s.active]?.refView.soloed.length ?? 0) : 0))
  const [query, setQuery] = useState('')
  const close = (): void => {
    useApp.setState({ paletteOpen: false })
    setQuery('')
  }

  const cmds: Cmd[] = useMemo(() => {
    const list: Cmd[] = [
      { id: 'open', group: 'Repository', label: 'Open a repository…', shortcut: 'Alt+O', run: () => void act.pickAndOpen() },
      { id: 'clone', group: 'Repository', label: 'Clone a repository…', run: () => act.openDialog({ kind: 'clone' }) },
      { id: 'init', group: 'Repository', label: 'New repository…', run: () => act.openDialog({ kind: 'init' }) },
      { id: 'home', group: 'View', label: 'Go to the repositories tab', shortcut: 'Ctrl+T', run: () => act.setActive('home') },
      { id: 'shortcuts', group: 'View', label: 'Keyboard shortcuts', shortcut: 'Ctrl+/', run: () => act.openDialog({ kind: 'shortcuts' }) },
      {
        id: 'theme',
        group: 'View',
        label: 'Switch light / dark theme',
        run: () => setPrefs({ theme: useApp.getState().prefs.theme === 'light' ? 'dark' : 'light' })
      }
    ]
    if (active !== 'home') {
      const id = active
      list.push(
        { id: 'fetch', group: 'Remote', label: 'Fetch all remotes', shortcut: 'Ctrl+L', run: () => void act.fetchAll(id) },
        { id: 'pull', group: 'Remote', label: 'Pull', run: () => void act.pull(id) },
        { id: 'pull-rebase', group: 'Remote', label: 'Pull (rebase)', run: () => void act.pull(id, 'rebase') },
        { id: 'push', group: 'Remote', label: 'Push', run: () => void act.push(id) },
        { id: 'stage-all', group: 'Changes', label: 'Stage all changes', shortcut: 'Ctrl+Shift+S', run: () => void act.stage(id, 'all') },
        { id: 'unstage-all', group: 'Changes', label: 'Unstage all changes', shortcut: 'Ctrl+Shift+U', run: () => void act.unstage(id, 'all') },
        { id: 'discard-all', group: 'Changes', label: 'Discard all changes…', run: () => act.discard(id, 'all') },
        { id: 'stash', group: 'Changes', label: 'Stash changes…', run: () => act.openDialog({ kind: 'stash', repoId: id }) },
        { id: 'pop', group: 'Changes', label: 'Pop the newest stash', run: () => act.popLatest(id) },
        { id: 'add-remote', group: 'Remote', label: 'Add a remote…', run: () => act.openDialog({ kind: 'addRemote', repoId: id }) },
        {
          id: 'tag-head',
          group: 'Branch',
          label: 'Tag the current commit…',
          run: () => refs?.head.sha && act.openDialog({ kind: 'createTag', repoId: id, at: refs.head.sha, atLabel: refs.head.branch ?? refs.head.sha.slice(0, 7) })
        },
        { id: 'undo', group: 'Changes', label: 'Undo', shortcut: 'Ctrl+Z', run: () => void act.undo(id) },
        { id: 'redo', group: 'Changes', label: 'Redo', shortcut: 'Ctrl+Y', run: () => void act.redo(id) },
        {
          id: 'new-branch',
          group: 'Branch',
          label: 'New branch…',
          shortcut: 'Ctrl+B',
          run: () => refs?.head.sha && act.openDialog({ kind: 'createBranch', repoId: id, at: refs.head.sha, atLabel: refs.head.branch ?? refs.head.sha.slice(0, 7) })
        },
        { id: 'new-worktree', group: 'Branch', label: 'New worktree…', run: () => act.openDialog({ kind: 'addWorktree', repoId: id }) },
        { id: 'add-submodule', group: 'Repository', label: 'Add a submodule…', run: () => act.openDialog({ kind: 'addSubmodule', repoId: id }) },
        { id: 'log', group: 'View', label: 'Git activity log', run: () => act.openLog() },
        {
          id: 'bisect',
          group: 'Repository',
          label: 'Find the commit that broke something (bisect)…',
          run: () => act.openDialog({ kind: 'bisect', repoId: id })
        },
        {
          id: 'focus',
          group: 'View',
          label: 'Focus on this branch (or show all)',
          run: () => void act.setFocusHead(id, !useApp.getState().repos[id]?.focusHead)
        },
        { id: 'open-folder', group: 'Repository', label: 'Open in file manager', run: () => void act.openIn(id, 'folder') },
        { id: 'open-terminal', group: 'Repository', label: 'Open in terminal', run: () => void act.openIn(id, 'terminal') },
        { id: 'open-editor', group: 'Repository', label: 'Open in editor', run: () => void act.openIn(id, 'editor') },
        ...(focused ? [{ id: 'show-all', group: 'View', label: 'Show all branches in the graph', run: () => void act.clearRefView(id) }] : []),
        ...(center?.kind === 'diff' || center?.kind === 'blame'
          ? [{ id: 'file-history', group: 'File', label: `File history of ${center.path.split('/').pop()}`, shortcut: 'Ctrl+Shift+H', run: () => act.setCenter(id, { kind: 'history', path: center.path }) }]
          : []),
        ...(center?.kind === 'diff' || center?.kind === 'history'
          ? [{ id: 'blame', group: 'File', label: `Blame ${center.path.split('/').pop()}`, run: () => act.setCenter(id, { kind: 'blame', path: center.path, rev: null }) }]
          : []),
        { id: 'settings', group: 'View', label: 'Settings', run: () => act.setCenter(id, { kind: 'prefs' }) },
        { id: 'close', group: 'Repository', label: 'Close this repository tab', shortcut: 'Ctrl+W', run: () => void act.closeTab(id) }
      )
      for (const r of refs?.refs ?? []) {
        if (r.kind === 'tag' || r.isHead) continue
        list.push({ id: `co-${r.name}`, group: 'Check out', label: `Check out ${r.short}`, run: () => void act.checkout(id, r.short) })
        if (refs?.head.branch && r.kind === 'local')
          list.push({ id: `merge-${r.name}`, group: 'Merge', label: `Merge ${r.short} into ${refs.head.branch}`, run: () => void act.mergeInto(id, r.short, refs.head.branch!) })
      }
    }
    return list
  }, [active, refs, center, focused])

  if (!open) return null
  const groups = [...new Set(cmds.map((c) => c.group))]
  return (
    <RDialog.Root open onOpenChange={(o) => !o && close()}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-(--gc-z-palette) bg-scrim/45" />
        <RDialog.Content aria-describedby={undefined} className="fixed top-[15%] left-1/2 z-(--gc-z-palette) w-(--gc-palette-w) max-w-[calc(100vw-(--spacing(8)))] -translate-x-1/2 overflow-hidden rounded-lg bg-surface-raised shadow-modal">
          <RDialog.Title className="sr-only">Command palette</RDialog.Title>
          <Command label="Command palette" loop>
            <Command.Input
              value={query}
              onValueChange={setQuery}
              autoFocus
              placeholder="Type a command or a branch name"
              className="h-11 w-full border-b border-border bg-transparent px-4 text-md text-text outline-none placeholder:text-muted"
            />
            <Command.List className="max-h-(--gc-palette-list-h) overflow-y-auto p-1">
              <Command.Empty className="px-3 py-6 text-center text-base text-muted">No matching commands</Command.Empty>
              {groups.map((g) => (
                <Command.Group key={g} heading={g} className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-muted">
                  {cmds
                    .filter((c) => c.group === g)
                    .map((c) => (
                      <Command.Item
                        key={c.id}
                        value={`${c.group} ${c.label}`}
                        onSelect={() => {
                          close()
                          c.run()
                        }}
                        className="flex h-8 cursor-default items-center justify-between gap-3 rounded-sm px-2 text-base text-text data-[selected=true]:bg-row-selected"
                      >
                        <span className="truncate">{c.label}</span>
                        {c.shortcut ? <Shortcut keys={c.shortcut} /> : null}
                      </Command.Item>
                    ))}
                </Command.Group>
              ))}
            </Command.List>
          </Command>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  )
}

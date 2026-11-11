// Every command the palette lists and a shortcut can run, for the state the app is in now.
import type { FlowConfig } from '../../../shared/types'
import { setPrefs, useApp, type AppState } from '@/store'
import * as act from '@/actions'
import { refLabel } from '@/lib/format'
import { customKeyId, keysOf } from '@/lib/keys'
import { parseCommand, type CommandContext } from '@/lib/custom'

export interface Cmd {
  id: string
  group: string
  label: string
  shortcut?: string
  run: () => void
  /** Keys only: left out of the palette. */
  hidden?: boolean
}

const focusById = (id: string): void => (document.getElementById(id) as HTMLInputElement | null)?.focus()

/** What your commands run on from the palette or a shortcut: the picked commit, the open file, the checked-out branch. */
export function paletteContext(s: AppState, repoId: string): CommandContext {
  const r = s.repos[repoId]
  const picked = r?.selected && r.selected !== 'wip' ? r.commits.find((c) => c.sha === r.selected && c.kind === 'commit') : undefined
  const c = r?.center
  return {
    commit: picked?.sha,
    file: c && (c.kind === 'diff' || c.kind === 'blame' || c.kind === 'history') ? c.path : undefined,
    branch: r?.refs?.head.branch ?? undefined
  }
}

/** `branches`: the Check out and Merge commands for every branch, which only the palette needs. */
export function buildCommands(s: AppState, { branches }: { branches: boolean }): Cmd[] {
  const active = s.active
  const list: Cmd[] = [
    { id: 'open', group: 'Repository', label: 'Open a repository…', run: () => void act.pickAndOpen() },
    { id: 'clone', group: 'Repository', label: 'Clone a repository…', run: () => act.openDialog({ kind: 'clone' }) },
    { id: 'init', group: 'Repository', label: 'New repository…', run: () => act.openDialog({ kind: 'init' }) },
    { id: 'home', group: 'View', label: 'Go to the repositories tab', run: () => act.setActive('home') },
    { id: 'shortcuts', group: 'View', label: 'Keyboard shortcuts', run: () => act.openDialog({ kind: 'shortcuts' }) },
    { id: 'theme', group: 'View', label: 'Switch light / dark theme', run: () => setPrefs({ theme: useApp.getState().prefs.theme === 'light' ? 'dark' : 'light' }) },
    { id: 'palette', group: 'View', label: 'Command palette', hidden: true, run: () => useApp.setState({ paletteOpen: true }) }
  ]
  if (active !== 'home') {
    const id = active
    const r = s.repos[id]
    const refs = r?.refs
    const center = r?.center
    const head = refs?.head
    const focused = (r?.refView.hidden.length ?? 0) + (r?.refView.soloed.length ?? 0)
    const newBranch = (): void => {
      if (head?.sha) act.openDialog({ kind: 'createBranch', repoId: id, at: head.sha, atLabel: head.branch ?? head.sha.slice(0, 7) })
    }
    list.push(
      { id: 'fetch', group: 'Remote', label: 'Fetch all remotes', run: () => void act.fetchAll(id) },
      { id: 'pull', group: 'Remote', label: 'Pull', run: () => void act.pull(id) },
      { id: 'pull-rebase', group: 'Remote', label: 'Pull (rebase)', run: () => void act.pull(id, 'rebase') },
      { id: 'push', group: 'Remote', label: 'Push', run: () => void act.push(id) },
      { id: 'stage-all', group: 'Changes', label: 'Stage all changes', run: () => void act.stage(id, 'all') },
      { id: 'unstage-all', group: 'Changes', label: 'Unstage all changes', run: () => void act.unstage(id, 'all') },
      { id: 'discard-all', group: 'Changes', label: 'Discard all changes…', run: () => act.discard(id, 'all') },
      { id: 'clean-untracked', group: 'Changes', label: 'Remove untracked files…', run: () => act.openDialog({ kind: 'clean', repoId: id, untrackedOnly: true }) },
      { id: 'clean', group: 'Changes', label: 'Clean up the working tree…', run: () => act.openDialog({ kind: 'clean', repoId: id }) },
      { id: 'stash', group: 'Changes', label: 'Stash changes…', run: () => act.openDialog({ kind: 'stash', repoId: id }) },
      { id: 'pop', group: 'Changes', label: 'Pop the newest stash', run: () => act.popLatest(id) },
      { id: 'add-remote', group: 'Remote', label: 'Add a remote…', run: () => act.openDialog({ kind: 'addRemote', repoId: id }) },
      { id: 'web-repo', group: 'Remote', label: 'Open the repository in the browser', run: () => void act.openOnWeb(id, { kind: 'repo' }) },
      ...(head?.branch
        ? [{ id: 'web-pr', group: 'Remote', label: `Create a pull request for ${head.branch}${act.canOpenPull(id, head.branch) ? '…' : ''}`, run: () => act.createPullRequest(id, head.branch!) }]
        : []),
      {
        id: 'tag-head',
        group: 'Branch',
        label: 'Tag the current commit…',
        run: () => head?.sha && act.openDialog({ kind: 'createTag', repoId: id, at: head.sha, atLabel: head.branch ?? head.sha.slice(0, 7) })
      },
      { id: 'undo', group: 'Changes', label: 'Undo', run: () => void act.undo(id) },
      { id: 'redo', group: 'Changes', label: 'Redo', run: () => void act.redo(id) },
      ...(head?.sha ? [{ id: 'new-branch', group: 'Branch', label: 'New branch…', run: newBranch }] : []),
      { id: 'new-worktree', group: 'Branch', label: 'New worktree…', run: () => act.openDialog({ kind: 'addWorktree', repoId: id }) },
      ...gitFlowCommands(id, r?.flow ?? null, head?.branch ?? null),
      { id: 'add-submodule', group: 'Repository', label: 'Add a submodule…', run: () => act.openDialog({ kind: 'addSubmodule', repoId: id }) },
      { id: 'log', group: 'View', label: 'Git activity log', run: () => act.openLog() },
      { id: 'apply-patch', group: 'Changes', label: 'Apply a patch…', run: () => act.openDialog({ kind: 'applyPatch', repoId: id }) },
      { id: 'copy-patch', group: 'Changes', label: 'Copy all changes as patch', run: () => void act.copyChangesPatch(id, 'all') },
      { id: 'find-fixup', group: 'Changes', label: 'Find the commit these changes belong to', run: () => void act.findFixupTarget(id) },
      { id: 'autosquash', group: 'Branch', label: 'Squash fixup commits into their commits', run: () => act.autosquash(id) },
      { id: 'compare', group: 'View', label: 'Compare two branches or commits…', run: () => act.openDialog({ kind: 'compare', repoId: id }) },
      { id: 'reflog', group: 'View', label: 'Reflog: where HEAD has been', run: () => act.setCenter(id, { kind: 'reflog' }) },
      { id: 'bisect', group: 'Repository', label: 'Find the commit that broke something (bisect)…', run: () => act.openDialog({ kind: 'bisect', repoId: id }) },
      { id: 'focus', group: 'View', label: 'Focus on this branch (or show all)', run: () => void act.setFocusHead(id, !useApp.getState().repos[id]?.focusHead) },
      { id: 'filter', group: 'View', label: 'Filter the graph by path or author…', run: () => act.openFilter(id) },
      ...(r?.filter ? [{ id: 'filter-clear', group: 'View', label: 'Clear the graph filter', run: () => act.setFilter(id, null) }] : []),
      { id: 'open-folder', group: 'Repository', label: 'Open in file manager', run: () => void act.openIn(id, 'folder') },
      { id: 'open-terminal', group: 'Repository', label: 'Open in terminal', run: () => void act.openIn(id, 'terminal') },
      { id: 'open-editor', group: 'Repository', label: 'Open in editor', run: () => void act.openIn(id, 'editor') },
      ...(focused ? [{ id: 'show-all', group: 'View', label: 'Show all branches in the graph', run: () => void act.clearRefView(id) }] : []),
      ...(center?.kind === 'diff' || center?.kind === 'blame'
        ? [{ id: 'file-history', group: 'File', label: `File history of ${center.path.split('/').pop()}`, run: () => act.setCenter(id, { kind: 'history', path: center.path }) }]
        : []),
      ...(center?.kind === 'diff' || center?.kind === 'history'
        ? [{ id: 'blame', group: 'File', label: `Blame ${center.path.split('/').pop()}`, run: () => act.setCenter(id, { kind: 'blame', path: center.path, rev: null }) }]
        : []),
      { id: 'settings', group: 'View', label: 'Settings', run: () => act.setCenter(id, { kind: 'prefs' }) },
      { id: 'close', group: 'Repository', label: 'Close this repository tab', run: () => void act.closeTab(id) },
      // Keys only, from here: things the palette would take the focus away from, or that it already is.
      {
        id: 'find',
        group: 'View',
        label: 'Find',
        hidden: true,
        // An open diff finds in its file; anywhere else, this searches the commits.
        run: () => void (window.dispatchEvent(new Event('gc:find-in-file', { cancelable: true })) && focusById('commit-search'))
      },
      { id: 'filter-branches', group: 'View', label: 'Filter branches', hidden: true, run: () => focusById('left-filter') },
      { id: 'toggle-left', group: 'View', label: 'Collapse or expand the branches panel', hidden: true, run: () => setPrefs({ leftCollapsed: !useApp.getState().prefs.leftCollapsed }) },
      { id: 'toggle-detail', group: 'View', label: 'Collapse or expand the details panel', hidden: true, run: () => setPrefs({ detailCollapsed: !useApp.getState().prefs.detailCollapsed }) },
      {
        id: 'focus-summary',
        group: 'Changes',
        label: 'Focus the commit summary',
        hidden: true,
        run: () => {
          act.select(id, 'wip')
          setTimeout(() => window.dispatchEvent(new Event('gc:focus-summary')), 0)
        }
      },
      {
        id: 'stage-commit',
        group: 'Changes',
        label: 'Stage all and commit',
        hidden: true,
        run: () => {
          act.select(id, 'wip')
          void act.stage(id, 'all').then(() => setTimeout(() => (document.querySelector('form[aria-label=Commit] button[type=submit]') as HTMLButtonElement | null)?.click(), 50))
        }
      },
      {
        id: 'co-previous',
        group: 'Check out',
        label: refs?.previous ? `Switch to the previous branch (${refLabel(refs.previous)})` : 'Switch to the previous branch',
        hidden: !refs?.previous,
        run: () => void act.checkoutPrevious(id)
      }
    )
    // Your commands: in the palette when what they run on is there; a shortcut says what's missing.
    const ctx = paletteContext(s, id)
    for (const c of s.prefs.customCommands) {
      const ready = parseCommand(c.command).needs.every((n) => n === 'head' || ctx[n])
      list.push({
        id: customKeyId(c.id),
        group: 'Your commands',
        label: c.name,
        hidden: !ready,
        run: () => act.runCustomCommand(id, c.id, ctx)
      })
    }
    if (branches) {
      // The branches checked out lately come first, most recent at the top.
      const recent = refs?.recent ?? []
      const rank = (x: { kind: string; short: string }): number => (x.kind === 'local' && recent.includes(x.short) ? recent.indexOf(x.short) : recent.length)
      for (const b of [...(refs?.refs ?? [])].sort((a, c) => rank(a) - rank(c))) {
        if (b.kind === 'tag' || b.isHead) continue
        list.push({ id: `co-${b.name}`, group: 'Check out', label: `Check out ${b.short}`, run: () => void act.checkout(id, b.short) })
        if (head?.branch && b.kind === 'local') list.push({ id: `merge-${b.name}`, group: 'Merge', label: `Merge ${b.short} into ${head.branch}`, run: () => void act.mergeInto(id, b.short, head.branch!) })
      }
    }
  }
  for (const c of list) c.shortcut = keysOf(c.id, s.prefs.keymap)[0]
  return list
}

/** Git Flow: set it up, or start a feature, release or hotfix, and finish the one checked out. */
function gitFlowCommands(repoId: string, flow: FlowConfig | null, head: string | null): Cmd[] {
  if (!flow) return [{ id: 'flow-init', group: 'Branch', label: 'Set up Git Flow…', run: () => act.openDialog({ kind: 'flowInit', repoId }) }]
  const here = act.flowBranch(repoId, head)
  return [
    ...(['feature', 'release', 'hotfix'] as const).map((k) => ({ id: `flow-${k}`, group: 'Branch', label: `Git Flow: start a ${k}…`, run: () => act.openDialog({ kind: 'flowStart', repoId, flowKind: k }) })),
    ...(here ? [{ id: 'flow-finish', group: 'Branch', label: `Git Flow: finish ${here.kind} ${here.name}…`, run: () => act.openDialog({ kind: 'flowFinish', repoId, flowKind: here.kind, name: here.name }) }] : [])
  ]
}

/** A shortcut's command, if it can run here. */
export function commandById(id: string): Cmd | undefined {
  return buildCommands(useApp.getState(), { branches: false }).find((c) => c.id === id)
}

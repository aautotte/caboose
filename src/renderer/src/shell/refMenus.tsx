import { Download, Eye, EyeOff, GitBranchPlus, GitCompare, ListOrdered, RotateCcw, Tag, Trash2, Upload } from 'lucide-react'
import type { MenuEntry } from '@/ui'
import * as act from '@/actions'

/**
 * "Push" for a local branch, in the branches panel and the graph. With one remote it pushes there; with several it
 * becomes "Push to", listing each remote and marking the one the branch tracks. Pushing elsewhere leaves the
 * tracking alone; a branch that tracks nothing yet starts tracking the remote it's pushed to.
 */
export function pushEntry(repoId: string, branch: { name: string; isHead: boolean; upstream?: string }, remotes: string[]): MenuEntry {
  const tracked = branch.upstream ? remotes.find((r) => branch.upstream!.startsWith(`refs/remotes/${r}/`)) : undefined
  const to = (remote: string) => () => void act.push(repoId, { branch: branch.name, remote, setUpstream: !branch.upstream })
  if (remotes.length > 1) {
    return {
      type: 'sub',
      label: 'Push to',
      icon: <Upload size={14} />,
      items: remotes.map((remote) => ({ type: 'item' as const, label: remote === tracked ? `${remote} (tracked)` : remote, onSelect: to(remote) }))
    }
  }
  return {
    type: 'item',
    label: 'Push',
    icon: <Upload size={14} />,
    disabled: !remotes.length,
    // The current branch keeps the toolbar's behaviour (asks where to publish it the first time).
    onSelect: branch.isHead ? () => void act.push(repoId) : to(remotes[0])
  }
}

/**
 * "Pull" for a local branch: the checked-out one pulls as the toolbar does; any other is fetched and fast-forwarded
 * without switching to it.
 */
export function pullEntry(repoId: string, branch: { name: string; isHead: boolean; upstream?: string; upstreamGone?: boolean; worktree?: string }): MenuEntry {
  const why = !branch.upstream ? ' (tracks nothing)' : branch.upstreamGone ? ' (gone from the remote)' : branch.worktree ? ' (checked out in a worktree)' : ''
  return { type: 'item', label: `Pull${why}`, icon: <Download size={14} />, disabled: !!why, onSelect: () => void act.pullBranch(repoId, branch.name) }
}

/**
 * For a remote branch such as origin/x: reset the local branch for it (the one that tracks it, or x) to it. The
 * checked-out branch gets the usual reset (soft, mixed or hard); another one just moves. None when there's no local
 * branch for it.
 */
export function resetToRemoteEntry(repoId: string, remoteBranch: string): MenuEntry | null {
  const local = act.localFor(repoId, remoteBranch)
  if (!local) return null
  const label = `Reset ${local.short} to ${remoteBranch}…`
  if (local.worktree) return { type: 'item', label: `${label} (checked out in a worktree)`, icon: <RotateCcw size={14} />, disabled: true }
  return {
    type: 'item',
    label,
    icon: <RotateCcw size={14} />,
    onSelect: () => act.openDialog({ kind: 'reset', repoId, target: remoteBranch, targetLabel: remoteBranch, branch: local.isHead ? undefined : local.short })
  }
}

/** Interactive rebase of the checked-out branch onto `onto` (a branch): pick, reorder, squash or drop its commits. */
export function rebaseOntoEntry(repoId: string, head: string, onto: string): MenuEntry {
  return { type: 'item', label: `Interactive rebase ${head} onto ${onto}…`, icon: <ListOrdered size={14} />, onSelect: () => act.setCenter(repoId, { kind: 'rebase', onto, ontoLabel: onto, ontoBranch: true }) }
}

/** What changed from `base` to `target`: the files that differ and the commits only one has. */
export function compareEntry(repoId: string, base: string, target: string): MenuEntry {
  return { type: 'item', label: `Compare with ${base}`, icon: <GitCompare size={14} />, onSelect: () => act.setCenter(repoId, { kind: 'compare', base, target, baseLabel: base, targetLabel: target }) }
}

/**
 * A tag's menu, in the branches panel and on a commit row in the graph. With one remote, push and delete act on it
 * directly; with several, they become sub-menus listing each remote, plus all of them for a push.
 */
export function tagMenu(repoId: string, name: string, remotes: string[], eye?: { hidden: boolean; onToggle: () => void }): MenuEntry[] {
  const push: MenuEntry =
    remotes.length > 1
      ? {
          type: 'sub',
          label: 'Push tag to',
          icon: <Upload size={14} />,
          items: [
            ...remotes.map((remote) => ({ type: 'item' as const, label: remote, onSelect: () => void act.pushTag(repoId, name, remote) })),
            { type: 'separator' as const },
            { type: 'item' as const, label: 'All remotes', onSelect: () => void act.pushTag(repoId, name, act.ALL_REMOTES) }
          ]
        }
      : { type: 'item', label: 'Push tag', icon: <Upload size={14} />, disabled: !remotes.length, onSelect: () => void act.pushTag(repoId, name) }
  const deleteRemote: MenuEntry =
    remotes.length > 1
      ? {
          type: 'sub',
          label: 'Delete from a remote',
          icon: <Trash2 size={14} />,
          items: remotes.map((remote) => ({ type: 'item' as const, label: remote, danger: true, onSelect: () => act.deleteRemoteTag(repoId, name, remote) }))
        }
      : { type: 'item', label: 'Delete from the remote…', danger: true, disabled: !remotes.length, onSelect: () => act.deleteRemoteTag(repoId, name) }
  return [
    { type: 'item', label: 'Check out (detached)', icon: <Tag size={14} />, onSelect: () => void act.checkout(repoId, name) },
    { type: 'item', label: 'New branch from here…', icon: <GitBranchPlus size={14} />, onSelect: () => act.openDialog({ kind: 'createBranch', repoId, at: name, atLabel: name }) },
    { type: 'separator' },
    push,
    { type: 'item', label: 'Delete tag…', icon: <Trash2 size={14} />, danger: true, onSelect: () => act.deleteTag(repoId, name) },
    deleteRemote,
    { type: 'separator' },
    ...(eye
      ? [{ type: 'item' as const, label: eye.hidden ? 'Show tag in the graph' : 'Hide tag from the graph', icon: eye.hidden ? <Eye size={14} /> : <EyeOff size={14} />, shortcut: 'H', onSelect: eye.onToggle }]
      : []),
    { type: 'item', label: 'Copy name', onSelect: () => void navigator.clipboard.writeText(name) }
  ]
}

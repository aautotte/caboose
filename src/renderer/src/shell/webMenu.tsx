import { GitPullRequestCreate, Globe, Link2 } from 'lucide-react'
import type { MenuEntry } from '@/ui'
import * as act from '@/actions'

/**
 * "On the web" for a branch (local by its upstream, or remote) or a commit: its page on the remote's git host, a new
 * pull request for a branch, or a link to it.
 */
export function webEntry(repoId: string, what: { branch: string } | { sha: string }): MenuEntry {
  const target = 'branch' in what ? ({ kind: 'branch', name: what.branch } as const) : ({ kind: 'commit', sha: what.sha } as const)
  return {
    type: 'sub',
    label: 'On the web',
    icon: <Globe size={14} />,
    items: [
      { type: 'item', label: 'branch' in what ? 'Open the branch in the browser' : 'Open the commit in the browser', icon: <Globe size={14} />, onSelect: () => void act.openOnWeb(repoId, target) },
      ...('branch' in what
        ? [{ type: 'item' as const, label: 'Create a pull request', icon: <GitPullRequestCreate size={14} />, onSelect: () => void act.openOnWeb(repoId, { kind: 'pr', branch: what.branch }) }]
        : []),
      { type: 'item', label: 'Copy link', icon: <Link2 size={14} />, onSelect: () => void act.copyWebLink(repoId, target) }
    ]
  }
}

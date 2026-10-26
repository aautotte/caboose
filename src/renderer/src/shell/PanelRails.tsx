import { Archive, Boxes, Cloud, FolderGit2, GitBranch, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Tag } from 'lucide-react'
import { IconButton, Tooltip } from '@/ui'
import { setPrefs, useRepo } from '@/store'

/** The id of a left-panel section, so the rail can scroll to it after expanding. */
export const leftSectionId = (title: string): string => `left-section-${title.toLowerCase().replace(/\s+/g, '-')}`

export function collapseLeft(collapsed: boolean): void {
  setPrefs({ leftCollapsed: collapsed })
}

export function collapseDetails(collapsed: boolean): void {
  setPrefs({ detailCollapsed: collapsed })
}

/** In the left panel, next to the filter. */
export function CollapseLeftButton(): React.JSX.Element {
  return (
    <Tooltip content="Collapse the branches panel" shortcut="Ctrl+J">
      <IconButton label="Collapse the branches panel" size="sm" onClick={() => collapseLeft(true)}>
        <PanelLeftClose size={14} />
      </IconButton>
    </Tooltip>
  )
}

/** First thing in each details panel's header. */
export function CollapseDetailsButton(): React.JSX.Element {
  return (
    <Tooltip content="Collapse the details panel" shortcut="Ctrl+K">
      <IconButton label="Collapse the details panel" size="sm" onClick={() => collapseDetails(true)}>
        <PanelRightClose size={14} />
      </IconButton>
    </Tooltip>
  )
}

/** The left panel, collapsed: a way back, and a shortcut to each section with its count. */
export function LeftRail({ repoId }: { repoId: string }): React.JSX.Element {
  const refs = useRepo(repoId, (r) => r.refs)
  const subs = useRepo(repoId, (r) => r.submodules)
  const worktrees = useRepo(repoId, (r) => r.worktrees)
  const all = refs?.refs ?? []
  const sections = [
    { title: 'Local branches', icon: GitBranch, count: all.filter((r) => r.kind === 'local').length },
    { title: 'Remotes', icon: Cloud, count: refs?.remotes.length ?? 0 },
    { title: 'Tags', icon: Tag, count: all.filter((r) => r.kind === 'tag').length },
    { title: 'Stashes', icon: Archive, count: refs?.stashes.length ?? 0 },
    // Like the sections: worktrees once there's more than the main one; submodules when there are some and their handling is on.
    ...(worktrees && worktrees.length > 1 ? [{ title: 'Worktrees', icon: FolderGit2, count: worktrees.length }] : []),
    ...(subs?.settings.on && subs.list.length ? [{ title: 'Submodules', icon: Boxes, count: subs.list.length }] : [])
  ]
  const open = (title?: string): void => {
    collapseLeft(false)
    if (title) requestAnimationFrame(() => document.getElementById(leftSectionId(title))?.scrollIntoView({ block: 'start' }))
  }
  return (
    <nav aria-label="Branches and tags (collapsed)" className="flex w-(--gc-rail-w) shrink-0 flex-col items-center gap-1 border-r border-border bg-surface py-2">
      <Tooltip content="Expand the branches panel" shortcut="Ctrl+J" side="right">
        <IconButton label="Expand the branches panel" size="sm" onClick={() => open()}>
          <PanelLeftOpen size={14} />
        </IconButton>
      </Tooltip>
      <div className="my-1 h-px w-5 bg-border" aria-hidden />
      {sections.map(({ title, icon: Icon, count }) => (
        <Tooltip key={title} content={`${title}: ${count}`} side="right">
          <IconButton label={`${title} (${count})`} size="sm" onClick={() => open(title)}>
            <Icon size={14} />
          </IconButton>
        </Tooltip>
      ))}
    </nav>
  )
}

/** The details panel, collapsed. */
export function DetailRail(): React.JSX.Element {
  return (
    <section aria-label="Details (collapsed)" className="flex w-(--gc-rail-w) shrink-0 flex-col items-center border-l border-border bg-surface py-2">
      <Tooltip content="Expand the details panel" shortcut="Ctrl+K" side="left">
        <IconButton label="Expand the details panel" size="sm" onClick={() => collapseDetails(false)}>
          <PanelRightOpen size={14} />
        </IconButton>
      </Tooltip>
    </section>
  )
}

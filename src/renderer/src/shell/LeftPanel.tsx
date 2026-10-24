import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Archive, ChevronDown, ChevronRight, Cloud, Eye, EyeOff, Focus, Folder, FolderOpen, Pin, PinOff, GitBranch, Link, Plus, RefreshCw, Tag, Trash2, GitMerge, GitPullRequestArrow, Upload } from 'lucide-react'
import type { Ref, RefViewState } from '../../../shared/types'
import { Badge, Button, ContextMenu, IconButton, TextInput, Tooltip, type MenuEntry } from '@/ui'
import { stashMenu } from '@/graph/GraphView'
import { cn } from '@/ui/cn'
import { useRepo } from '@/store'
import * as act from '@/actions'

function Section({
  title,
  count,
  children,
  empty,
  action,
  eye
}: {
  title: string
  count: number
  children: ReactNode
  empty: string
  action?: { label: string; onClick: () => void }
  eye?: Eye
}): React.JSX.Element {
  const [open, setOpen] = useState(true)
  return (
    <section className="flex flex-col">
      <div className="flex items-center pr-1">
        <button
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="flex h-(--gc-list-row-h) flex-1 items-center gap-1 px-2 text-xs font-medium text-muted hover:text-text"
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <span className="flex-1 text-left">{title}</span>
          <Badge>{count}</Badge>
        </button>
        {eye ? (
          <Tooltip content={eye.hidden ? `Show all ${title.toLowerCase()} in the graph` : `Hide all ${title.toLowerCase()} from the graph`}>
            <IconButton label={`${eye.hidden ? 'Show' : 'Hide'} all ${title.toLowerCase()}`} size="sm" pressed={eye.hidden} onClick={eye.onToggle}>
              {eye.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
            </IconButton>
          </Tooltip>
        ) : null}
        {action ? (
          <Tooltip content={action.label}>
            <IconButton label={action.label} size="sm" onClick={action.onClick}>
              <Plus size={14} />
            </IconButton>
          </Tooltip>
        ) : null}
      </div>
      {open ? (
        count === 0 ? (
          <p className="px-7 py-1 pb-3 text-sm text-muted">{empty}</p>
        ) : (
          <div role="tree" aria-label={title} className="flex flex-col pb-2">
            {children}
          </div>
        )
      ) : null}
    </section>
  )
}

interface Eye {
  hidden: boolean
  onToggle: () => void
}

/** The eye at the end of a row: hides or shows that branch, or everything under a folder or remote. Shown on hover, and always while hidden. */
function EyeButton({ eye, name }: { eye: Eye; name: string }): React.JSX.Element {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={`${eye.hidden ? 'Show' : 'Hide'} ${name}`}
      title={eye.hidden ? 'Show in the graph (H)' : 'Hide from the graph (H)'}
      onClick={(e) => {
        e.stopPropagation()
        eye.onToggle()
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      className={cn(
        'grid size-5 shrink-0 place-items-center rounded-sm text-muted hover:bg-surface-raised hover:text-text',
        !eye.hidden && 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100'
      )}
    >
      {eye.hidden ? <EyeOff size={12} aria-hidden /> : <Eye size={12} aria-hidden />}
    </button>
  )
}

function Row({ icon, label, name, indent = 0, level, current, selected, badges, onActivate, onSelect, menu, title, dim, pinned, eye }: { icon: ReactNode; label: string; name?: string; indent?: number; current?: boolean; selected?: boolean; badges?: ReactNode; onActivate?: () => void; onSelect?: () => void; menu: MenuEntry[]; title?: string; dim?: boolean; pinned?: boolean; level?: number; eye?: Eye }): React.JSX.Element {
  return (
    <ContextMenu items={menu}>
      <div
        role="treeitem"
        aria-level={level}
        aria-selected={selected}
        aria-current={current || undefined}
        aria-label={name}
        tabIndex={0}
        title={title ?? label}
        onClick={onSelect}
        onDoubleClick={onActivate}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onActivate?.()
          if (e.key === ' ') onSelect?.()
          if ((e.key === 'h' || e.key === 'H') && eye && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault()
            eye.onToggle()
          }
        }}
        className={cn(
          'group flex h-(--gc-list-row-h) cursor-default items-center gap-1.5 pr-2 text-base outline-none select-none hover:bg-row-hover focus-visible:bg-row-hover',
          selected && 'bg-row-selected',
          current ? 'font-semibold text-text' : dim ? 'text-muted' : 'text-text'
        )}
        style={{ paddingLeft: 24 + indent * 12 }}
      >
        <span className="shrink-0 text-muted">{icon}</span>
        {current ? <span aria-hidden className="size-1.5 shrink-0 rounded-pill bg-accent-text" /> : null}
        {dim && !eye?.hidden ? <EyeOff size={12} aria-label="Not in the graph" className="shrink-0 text-muted" /> : null}
        {pinned ? <Pin size={12} aria-label="Pinned to the left" className="shrink-0 text-muted" /> : null}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {badges}
        {eye ? <EyeButton eye={eye} name={name ?? label} /> : null}
      </div>
    </ContextMenu>
  )
}

function viewState(v: RefViewState, name: string): 'normal' | 'hidden' | 'soloed' {
  return v.soloed.includes(name) ? 'soloed' : v.hidden.includes(name) ? 'hidden' : 'normal'
}

/** Hidden, or left out because other branches are soloed. */
function outOfGraph(v: RefViewState, r: Ref): boolean {
  return !r.isHead && (v.hidden.includes(r.name) || (v.soloed.length > 0 && !v.soloed.includes(r.name)))
}

/** HEAD always shows, so the checked-out branch can be soloed but not hidden. */
function viewMenu(repoId: string, r: Ref, v: RefViewState): MenuEntry[] {
  const st = viewState(v, r.name)
  return [
    v.pinned === r.name
      ? { type: 'item', label: 'Unpin from the left', icon: <PinOff size={14} />, onSelect: () => void act.pinLeft(repoId, null) }
      : { type: 'item', label: 'Pin to the left of the graph', icon: <Pin size={14} />, onSelect: () => void act.pinLeft(repoId, r.name) },
    ...(r.isHead ? [] : [st === 'hidden'
      ? { type: 'item', label: 'Show in the graph again', icon: <Eye size={14} />, onSelect: () => void act.setRefView(repoId, r.name, 'normal') }
      : { type: 'item', label: 'Hide from the graph', icon: <EyeOff size={14} />, onSelect: () => void act.setRefView(repoId, r.name, 'hidden') }] as MenuEntry[]),
    st === 'soloed'
      ? { type: 'item', label: 'Stop showing only this', icon: <Focus size={14} />, onSelect: () => void act.setRefView(repoId, r.name, 'normal') }
      : { type: 'item', label: 'Show only this (and HEAD)', icon: <Focus size={14} />, onSelect: () => void act.setRefView(repoId, r.name, 'soloed') }
  ]
}

function branchMenu(repoId: string, r: Ref, head: string | null, v: RefViewState): MenuEntry[] {
  const m: MenuEntry[] = []
  if (!r.isHead) m.push({ type: 'item', label: 'Check out', icon: <GitBranch size={14} />, onSelect: () => void act.checkout(repoId, r.short) })
  if (head && r.short !== head) {
    m.push({ type: 'item', label: `Merge into ${head}`, icon: <GitMerge size={14} />, onSelect: () => void act.mergeInto(repoId, r.short, head) })
    m.push({ type: 'item', label: `Rebase ${head} onto ${r.short}`, icon: <GitPullRequestArrow size={14} />, onSelect: () => void act.rebaseOnto(repoId, head, r.short) })
  }
  if (r.kind === 'local') {
    m.push({ type: 'item', label: 'Push', icon: <Upload size={14} />, disabled: !r.isHead, onSelect: () => void act.push(repoId) })
    m.push({ type: 'item', label: 'New branch from here…', onSelect: () => act.openDialog({ kind: 'createBranch', repoId, at: r.short, atLabel: r.short }) })
    m.push({ type: 'item', label: 'Rename…', onSelect: () => act.openDialog({ kind: 'renameBranch', repoId, name: r.short }) })
    m.push({ type: 'item', label: r.upstream ? 'Change upstream…' : 'Set upstream…', icon: <Link size={14} />, onSelect: () => act.openDialog({ kind: 'upstream', repoId, branch: r.short }) })
    m.push({ type: 'separator' })
    m.push({ type: 'item', label: 'Delete…', icon: <Trash2 size={14} />, danger: true, disabled: r.isHead, onSelect: () => act.deleteBranch(repoId, r.short) })
  }
  // The branch on the remote: this remote branch itself, or the one a local branch tracks.
  const onRemote = act.remoteBranchOf(repoId, r.kind === 'remote' ? r.name : r.upstream)
  if (onRemote) {
    if (r.kind === 'remote') m.push({ type: 'separator' })
    m.push({ type: 'item', label: `Delete ${onRemote.remote}/${onRemote.name}…`, icon: <Trash2 size={14} />, danger: true, onSelect: () => act.deleteRemoteBranch(repoId, onRemote.remote, onRemote.name) })
  }
  const views = viewMenu(repoId, r, v)
  if (views.length) m.push({ type: 'separator' }, ...views)
  m.push({ type: 'item', label: 'Copy name', onSelect: () => void navigator.clipboard.writeText(r.short) })
  return m
}

function tagMenu(repoId: string, r: Ref, hasRemote: boolean): MenuEntry[] {
  return [
    { type: 'item', label: 'Check out (detached)', onSelect: () => void act.checkout(repoId, r.short) },
    { type: 'item', label: 'New branch from here…', onSelect: () => act.openDialog({ kind: 'createBranch', repoId, at: r.short, atLabel: r.short }) },
    { type: 'separator' },
    { type: 'item', label: 'Push tag', icon: <Upload size={14} />, disabled: !hasRemote, onSelect: () => void act.pushTag(repoId, r.short) },
    { type: 'item', label: 'Delete tag…', icon: <Trash2 size={14} />, danger: true, onSelect: () => act.deleteTag(repoId, r.short) },
    { type: 'item', label: 'Delete from the remote…', danger: true, disabled: !hasRemote, onSelect: () => act.deleteRemoteTag(repoId, r.short) },
    { type: 'separator' },
    { type: 'item', label: 'Copy name', onSelect: () => void navigator.clipboard.writeText(r.short) }
  ]
}

interface FolderNode {
  kind: 'folder'
  key: string
  name: string
  children: TreeNode[]
  refs: Ref[]
}
type TreeNode = FolderNode | { kind: 'leaf'; ref: Ref; name: string }

/** Branch names grouped on "/" into folders: feature/a and feature/b sit under "feature". Folders first, then branches. */
function buildTree(refs: Ref[], nameOf: (r: Ref) => string, key: string): TreeNode[] {
  const root: FolderNode = { kind: 'folder', key, name: '', children: [], refs: [] }
  for (const r of refs) {
    const parts = nameOf(r).split('/')
    let node = root
    for (const part of parts.slice(0, -1)) {
      let child = node.children.find((c): c is FolderNode => c.kind === 'folder' && c.name === part)
      if (!child) {
        child = { kind: 'folder', key: `${node.key}/${part}`, name: part, children: [], refs: [] }
        node.children.push(child)
      }
      child.refs.push(r)
      node = child
    }
    node.children.push({ kind: 'leaf', ref: r, name: parts[parts.length - 1] })
  }
  const sort = (list: TreeNode[]): TreeNode[] => {
    for (const n of list) if (n.kind === 'folder') sort(n.children)
    return list.sort((a, b) => Number(b.kind === 'folder') - Number(a.kind === 'folder'))
  }
  return sort(root.children)
}

const COLLAPSED_KEY = (repoId: string): string => `mergatroid.collapsed.${repoId}`
const LEGACY_COLLAPSED_KEY = (repoId: string): string => `gitclone.collapsed.${repoId}`

/** Which folders and remotes are folded, per repository; a convenience, so it lives in this browser's storage. */
function useCollapsed(repoId: string): [Set<string>, (key: string, open?: boolean) => void] {
  const [set, setSet] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY(repoId)) ?? localStorage.getItem(LEGACY_COLLAPSED_KEY(repoId)) ?? '[]') as string[])
    } catch {
      return new Set()
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_KEY(repoId), JSON.stringify([...set]))
    } catch {
      // not essential
    }
  }, [repoId, set])
  const toggle = (key: string, open?: boolean): void =>
    setSet((cur) => {
      const next = new Set(cur)
      if (open ?? next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  return [set, toggle]
}

/** A folder or remote row: folds its branches away (click, Enter, arrows) and hides them all (eye, H). */
function FolderRow({ icon, label, name, level, indent, open, onToggle, eye, menu, count }: { icon: ReactNode; label: string; name: string; level: number; indent: number; open: boolean; onToggle: (open?: boolean) => void; eye: Eye | null; menu: MenuEntry[]; count: number }): React.JSX.Element {
  return (
    <ContextMenu items={menu}>
      <div
        role="treeitem"
        aria-level={level}
        aria-expanded={open}
        aria-selected={false}
        aria-label={name}
        tabIndex={0}
        onClick={() => onToggle()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onToggle()
          } else if (e.key === 'ArrowRight' && !open) onToggle(true)
          else if (e.key === 'ArrowLeft' && open) onToggle(false)
          else if ((e.key === 'h' || e.key === 'H') && eye && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault()
            eye.onToggle()
          }
        }}
        className="group flex h-(--gc-list-row-h) cursor-default items-center gap-1.5 pr-2 text-base text-muted outline-none select-none hover:bg-row-hover focus-visible:bg-row-hover"
        style={{ paddingLeft: 10 + indent * 12 }}
      >
        <span className="shrink-0">{open ? <ChevronDown size={12} aria-hidden /> : <ChevronRight size={12} aria-hidden />}</span>
        <span className="shrink-0">{icon}</span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {!open ? <Badge>{count}</Badge> : null}
        {eye ? <EyeButton eye={eye} name={name} /> : null}
      </div>
    </ContextMenu>
  )
}

export function LeftPanel({ repoId, width }: { repoId: string; width: number }): React.JSX.Element {
  const refs = useRepo(repoId, (r) => r.refs)
  const selected = useRepo(repoId, (r) => r.selected)
  const view = useRepo(repoId, (r) => r.refView)
  const focused = view.hidden.length + view.soloed.length
  const focusHead = useRepo(repoId, (r) => r.focusHead)
  const [filter, setFilter] = useState('')
  const f = filter.trim().toLowerCase()
  const match = (s: string): boolean => !f || s.toLowerCase().includes(f)

  const { locals, remotes, tags } = useMemo(() => {
    const all = refs?.refs ?? []
    return {
      locals: all.filter((r) => r.kind === 'local'),
      remotes: all.filter((r) => r.kind === 'remote'),
      tags: all.filter((r) => r.kind === 'tag')
    }
  }, [refs])
  const head = refs?.head.branch ?? null
  const byRemote = useMemo(() => {
    const m = new Map<string, Ref[]>()
    for (const r of refs?.remotes ?? []) m.set(r, [])
    for (const r of remotes) m.set(r.remote ?? '', [...(m.get(r.remote ?? '') ?? []), r])
    return m
  }, [remotes, refs?.remotes])

  const [collapsed, toggleFolder] = useCollapsed(repoId)
  const isOpen = (key: string): boolean => !!f || !collapsed.has(key)
  // HEAD can't be hidden, so the eye of a group looks at the others only.
  const eyeFor = (list: Ref[]): Eye | null => {
    const can = list.filter((r) => !r.isHead)
    if (!can.length) return null
    const hidden = can.every((r) => view.hidden.includes(r.name))
    return { hidden, onToggle: () => void act.setRefViewMany(repoId, can.map((r) => r.name), hidden ? 'normal' : 'hidden') }
  }
  const eyeOne = (r: Ref): Eye | undefined => {
    if (r.isHead) return undefined
    const hidden = view.hidden.includes(r.name)
    return { hidden, onToggle: () => void act.setRefView(repoId, r.name, hidden ? 'normal' : 'hidden') }
  }
  const folderMenu = (label: string, list: Ref[], key: string): MenuEntry[] => {
    const eye = eyeFor(list)
    return [
      ...(eye ? [{ type: 'item' as const, label: eye.hidden ? `Show all in ${label}` : `Hide all in ${label}`, icon: eye.hidden ? <Eye size={14} /> : <EyeOff size={14} />, onSelect: eye.onToggle }] : []),
      { type: 'item', label: collapsed.has(key) ? 'Expand' : 'Collapse', onSelect: () => toggleFolder(key) }
    ]
  }
  const renderTree = (nodes: TreeNode[], level: number, indent: number, leaf: (r: Ref, name: string, level: number, indent: number) => React.JSX.Element): ReactNode =>
    nodes.map((n) =>
      n.kind === 'leaf' ? (
        leaf(n.ref, n.name, level, indent)
      ) : (
        <Fragment key={n.key}>
          <FolderRow
            icon={isOpen(n.key) ? <FolderOpen size={14} aria-hidden /> : <Folder size={14} aria-hidden />}
            label={n.name}
            name={`${n.name} folder`}
            level={level}
            indent={indent}
            open={isOpen(n.key)}
            onToggle={(o) => toggleFolder(n.key, o)}
            eye={eyeFor(n.refs)}
            menu={folderMenu(n.name, n.refs, n.key)}
            count={n.refs.length}
          />
          {isOpen(n.key) ? renderTree(n.children, level + 1, indent + 1, leaf) : null}
        </Fragment>
      )
    )

  const shownLocals = locals.filter((r) => match(r.short))
  const shownRemotes = remotes.filter((r) => match(r.short))
  const shownTags = tags.filter((r) => match(r.short))
  const shownStashes = (refs?.stashes ?? []).filter((s) => match(s.message))

  return (
    <nav aria-label="Branches and tags" className="flex shrink-0 flex-col overflow-hidden bg-surface" style={{ width }}>
      <div className="p-2">
        <TextInput
          id="left-filter"
          variant="search"
          size="sm"
          aria-label="Filter branches, tags and stashes"
          placeholder="Filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onClear={() => setFilter('')}
        />
      </div>
      {focusHead ? (
        <div role="status" className="mx-2 mb-2 flex items-center gap-2 rounded-md border border-border bg-surface-raised px-2 py-1 text-sm text-muted">
          <Focus size={14} aria-hidden className="shrink-0" />
          <span className="min-w-0 flex-1 truncate" title="The checked-out branch, the branch it tracks, and main">
            Focused on {refs?.head.branch ?? 'HEAD'}
          </span>
          <Button size="sm" variant="ghost" onClick={() => void act.setFocusHead(repoId, false)}>
            Show all
          </Button>
        </div>
      ) : null}
      {focused ? (
        <div role="status" className="mx-2 mb-2 flex items-center gap-2 rounded-md border border-border bg-surface-raised px-2 py-1 text-sm text-muted">
          <EyeOff size={14} aria-hidden className="shrink-0" />
          <span className="min-w-0 flex-1 truncate">
            {view.soloed.length ? `Graph shows only ${view.soloed.length === 1 ? 'one branch' : `${view.soloed.length} branches`}` : `${view.hidden.length} hidden from the graph`}
          </span>
          <Button size="sm" variant="ghost" onClick={() => void act.clearRefView(repoId)}>
            Show all
          </Button>
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Section title="Local branches" count={shownLocals.length} empty={f ? 'No matches' : 'No branches yet'} eye={eyeFor(locals) ?? undefined}>
          {renderTree(buildTree(shownLocals, (r) => r.short, 'local'), 1, 0, (r, name, level, indent) => (
            <Row
              key={r.name}
              icon={<GitBranch size={14} />}
              label={name}
              // The full name (the row shows only the part after its folder), plus what the badges say.
              name={`${r.short}${r.ahead ? `, ${r.ahead} ahead` : ''}${r.behind ? `, ${r.behind} behind` : ''}${r.upstreamGone ? ', gone' : ''}`}
              level={level}
              indent={indent}
              eye={eyeOne(r)}
              current={r.isHead}
              selected={selected === r.sha}
              onSelect={() => act.select(repoId, r.sha)}
              onActivate={() => !r.isHead && void act.checkout(repoId, r.short)}
              menu={branchMenu(repoId, r, head, view)}
              dim={outOfGraph(view, r)}
              pinned={view.pinned === r.name}
              title={r.upstream ? `${r.short} → ${r.upstream.replace('refs/remotes/', '')}${r.upstreamGone ? ' (gone)' : ''}` : `${r.short} (not pushed)`}
              badges={
                <>
                  {r.ahead ? <Badge label={`${r.ahead} ahead`}>↑{r.ahead}</Badge> : null}
                  {r.behind ? <Badge label={`${r.behind} behind`}>↓{r.behind}</Badge> : null}
                  {r.upstreamGone ? <Badge tone="warning">gone</Badge> : null}
                </>
              }
            />
          ))}
        </Section>
        <Section title="Remotes" count={byRemote.size} empty="No remotes. Add one to push and pull." action={{ label: 'Add a remote', onClick: () => act.openDialog({ kind: 'addRemote', repoId }) }} eye={eyeFor(remotes) ?? undefined}>
          {[...byRemote.entries()].map(([remote, list]) => (
            // A flat tree with levels: the remote (level 1) followed by a group of its branches (level 2+).
            // Nesting the branches inside the remote's item would make all their names part of the remote's name.
            <Fragment key={remote}>
              <FolderRow
                icon={<Cloud size={14} aria-hidden />}
                label={remote}
                name={remote}
                level={1}
                indent={0}
                open={isOpen(`remote:${remote}`)}
                onToggle={(o) => toggleFolder(`remote:${remote}`, o)}
                eye={eyeFor(list)}
                count={list.length}
                menu={[
                  ...folderMenu(remote, list, `remote:${remote}`),
                  { type: 'separator' },
                  { type: 'item', label: 'Fetch all remotes', icon: <RefreshCw size={14} />, onSelect: () => void act.fetchAll(repoId) },
                  { type: 'separator' },
                  { type: 'item', label: `Remove ${remote}…`, icon: <Trash2 size={14} />, danger: true, onSelect: () => act.removeRemote(repoId, remote) }
                ]}
              />
              {isOpen(`remote:${remote}`) ? (
                <div role="group" aria-label={remote}>
                  {renderTree(buildTree(list.filter((r) => shownRemotes.includes(r)), (r) => r.short.slice(remote.length + 1), `remote:${remote}`), 2, 1, (r, name, level, indent) => (
                      <Row
                        key={r.name}
                        indent={indent}
                        level={level}
                        icon={<GitBranch size={14} />}
                        label={name}
                        name={r.short.slice(remote.length + 1)}
                        eye={eyeOne(r)}
                        selected={selected === r.sha}
                        onSelect={() => act.select(repoId, r.sha)}
                        onActivate={() => void act.checkout(repoId, r.short)}
                        menu={branchMenu(repoId, r, head, view)}
                        dim={outOfGraph(view, r)}
                        pinned={view.pinned === r.name}
                        title={r.short}
                      />
                    ))}
                </div>
              ) : null}
            </Fragment>
          ))}
        </Section>
        <Section title="Tags" count={shownTags.length} empty={f ? 'No matches' : 'No tags'}>
          {shownTags.map((r) => (
            <Row
              key={r.name}
              icon={<Tag size={14} />}
              label={r.short}
              selected={selected === r.sha}
              onSelect={() => act.select(repoId, r.sha)}
              onActivate={() => act.select(repoId, r.sha)}
              title={r.annotation ? `${r.short}: ${r.annotation}` : r.short}
              menu={tagMenu(repoId, r, (refs?.remotes.length ?? 0) > 0)}
            />
          ))}
        </Section>
        <Section title="Stashes" count={shownStashes.length} empty={f ? 'No matches' : 'No stashes'}>
          {shownStashes.map((s) => (
            <Row
              key={s.sha}
              icon={<Archive size={14} />}
              label={s.message}
              selected={selected === s.sha}
              onSelect={() => act.select(repoId, s.sha)}
              onActivate={() => void act.stashApply(repoId, s.sha, false)}
              menu={stashMenu(repoId, s.sha, s.message)}
            />
          ))}
        </Section>
      </div>
    </nav>
  )
}

import { Fragment, memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Archive, Boxes, ChevronDown, Download, FolderGit2, FolderPlus, Lock, LockOpen, Settings, ChevronRight, Cloud, Eye, EyeOff, Focus, Folder, FolderOpen, Pin, PinOff, GitBranch, Link, Plus, RefreshCw, SquareTerminal, Tag, Trash2, GitMerge, GitPullRequestArrow, Upload, X } from 'lucide-react'
import type { Ref, RefViewState, Submodule, SubmoduleMode, Worktree } from '../../../shared/types'
import { Badge, Button, ContextMenu, IconButton, SharedContextMenu, Spinner, TextInput, Tooltip, useMenuOffer, type MenuEntry } from '@/ui'
import { call } from '@/lib/api'
import { stashMenu } from '@/graph/GraphView'
import { pushEntry, tagMenu } from './refMenus'
import { cn } from '@/ui/cn'
import { useRepo } from '@/store'
import * as act from '@/actions'
import { CollapseLeftButton, leftSectionId } from './PanelRails'

function Section({
  title,
  count,
  children,
  empty,
  action,
  eye,
  menu,
  note,
  multiselectable
}: {
  title: string
  count: number
  children: ReactNode
  empty: string
  action?: { label: string; onClick: () => void; icon?: ReactNode; disabled?: boolean }
  eye?: Eye
  /** Right-click on the header. */
  menu?: MenuEntry[]
  /** A line under the header, e.g. what's running. */
  note?: ReactNode
  /** Rows can be picked several at a time (Ctrl / Shift-click). */
  multiselectable?: boolean
}): React.JSX.Element {
  const [open, setOpen] = useState(true)
  const header = (
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
            <IconButton label={action.label} size="sm" disabled={action.disabled} onClick={action.onClick}>
              {action.icon ?? <Plus size={14} />}
            </IconButton>
          </Tooltip>
        ) : null}
      </div>
  )
  return (
    <section id={leftSectionId(title)} className="flex flex-col">
      {menu ? <ContextMenu items={menu}>{header}</ContextMenu> : header}
      {note}
      {open ? (
        count === 0 ? (
          <p className="px-7 py-1 pb-3 text-sm text-muted">{empty}</p>
        ) : (
          <div role="tree" aria-label={title} aria-multiselectable={multiselectable || undefined} className="flex flex-col pb-2">
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

function Row({ icon, label, name, indent = 0, level, current, selected, badges, onActivate, onSelect, onDelete, menu, title, dim, faded, pinned, eye }: { icon: ReactNode; label: string; name?: string; indent?: number; current?: boolean; selected?: boolean; badges?: ReactNode; onActivate?: () => void; /** Gets the click or key, so Ctrl and Shift can pick several. */ onSelect?: (e: React.MouseEvent | React.KeyboardEvent) => void; /** The Delete key. */ onDelete?: () => void; /** Built when the row is right-clicked. */ menu: () => MenuEntry[]; title?: string; dim?: boolean; /** Greyed, without dim's "not in the graph" mark. */ faded?: boolean; pinned?: boolean; level?: number; eye?: Eye }): React.JSX.Element {
  const offerMenu = useMenuOffer(menu)
  return (
    <div
      role="treeitem"
      onContextMenu={offerMenu}
      aria-level={level}
      aria-selected={selected}
      aria-current={current || undefined}
      aria-label={name}
      tabIndex={0}
      title={title ?? label}
      onClick={(e) => onSelect?.(e)}
      onDoubleClick={(e) => !e.ctrlKey && !e.metaKey && !e.shiftKey && onActivate?.()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onActivate?.()
        if (e.key === ' ') {
          e.preventDefault()
          onSelect?.(e)
        }
        if (e.key === 'Delete' && onDelete) {
          e.preventDefault()
          onDelete()
        }
        if ((e.key === 'h' || e.key === 'H') && eye && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault()
          eye.onToggle()
        }
      }}
      className={cn(
        'group flex h-(--gc-list-row-h) cursor-default items-center gap-1.5 pr-2 text-base outline-none select-none hover:bg-row-hover focus-visible:bg-row-hover',
        selected && 'bg-row-selected',
        current ? 'font-semibold text-text' : dim || faded ? 'text-muted' : 'text-text'
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
  )
}

type RowProps = Parameters<typeof Row>[0]

/**
 * A branch or tag row. There can be thousands, so a row only re-renders when what it shows changed: folding a folder
 * doesn't redraw every other row. Its handlers must not depend on anything else, so they go through the panel's
 * `live` handlers; `icon` and `badges` follow from the rest (the badges are spelled out in `name`).
 */
const LeafRow = memo(Row, (a: RowProps, b: RowProps) => {
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof RowProps>) {
    if (k === 'icon' || k === 'badges' || typeof a[k] === 'function' || typeof b[k] === 'function') continue
    if (k === 'eye' ? a.eye?.hidden !== b.eye?.hidden || !a.eye !== !b.eye : !Object.is(a[k], b[k])) return false
  }
  return true
})

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

function branchMenu(repoId: string, r: Ref, head: string | null, v: RefViewState, remotes: string[]): MenuEntry[] {
  const m: MenuEntry[] = []
  if (r.worktree) m.push({ type: 'item', label: 'Open its worktree', icon: <FolderGit2 size={14} />, onSelect: () => void act.openWorktree(r.worktree!) })
  else if (!r.isHead) {
    m.push({ type: 'item', label: 'Check out', icon: <GitBranch size={14} />, onSelect: () => void act.checkout(repoId, r.short) })
    m.push({
      type: 'item',
      label: 'Check out in a new worktree…',
      icon: <FolderPlus size={14} />,
      onSelect: () => act.openDialog(r.kind === 'remote' ? { kind: 'addWorktree', repoId, remote: r.short } : { kind: 'addWorktree', repoId, branch: r.short })
    })
  }
  if (head && r.short !== head) {
    m.push({ type: 'item', label: `Merge into ${head}`, icon: <GitMerge size={14} />, onSelect: () => void act.mergeInto(repoId, r.short, head) })
    m.push({ type: 'item', label: `Rebase ${head} onto ${r.short}`, icon: <GitPullRequestArrow size={14} />, onSelect: () => void act.rebaseOnto(repoId, head, r.short) })
  }
  if (r.kind === 'local') {
    m.push(pushEntry(repoId, { name: r.short, isHead: r.isHead, upstream: r.upstream }, remotes))
    m.push({ type: 'item', label: 'New branch from here…', onSelect: () => act.openDialog({ kind: 'createBranch', repoId, at: r.short, atLabel: r.short }) })
    m.push({ type: 'item', label: 'Rename…', onSelect: () => act.openDialog({ kind: 'renameBranch', repoId, name: r.short }) })
    m.push({ type: 'item', label: r.upstream ? 'Change upstream…' : 'Set upstream…', icon: <Link size={14} />, onSelect: () => act.openDialog({ kind: 'upstream', repoId, branch: r.short }) })
    m.push({ type: 'separator' })
    m.push({ type: 'item', label: r.worktree ? 'Delete… (checked out in a worktree)' : 'Delete…', icon: <Trash2 size={14} />, danger: true, disabled: r.isHead || !!r.worktree, onSelect: () => act.deleteBranch(repoId, r.short) })
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

const COLLAPSED_KEY = (repoId: string): string => `caboose.collapsed.${repoId}`
const LEGACY_COLLAPSED_KEYS = (repoId: string): string[] => [`mergatroid.collapsed.${repoId}`, `gitclone.collapsed.${repoId}`]

/** Which folders and remotes are folded, per repository; a convenience, so it lives in this browser's storage. */
function useCollapsed(repoId: string): [Set<string>, (key: string, open?: boolean) => void] {
  const [set, setSet] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse([COLLAPSED_KEY(repoId), ...LEGACY_COLLAPSED_KEYS(repoId)].map((k) => localStorage.getItem(k)).find((v) => v !== null) ?? '[]') as string[])
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
function FolderRow({ icon, label, name, level, indent, open, onToggle, eye, menu, count }: { icon: ReactNode; label: string; name: string; level: number; indent: number; open: boolean; onToggle: (open?: boolean) => void; eye: Eye | null; menu: () => MenuEntry[]; count: number }): React.JSX.Element {
  const offerMenu = useMenuOffer(menu)
  return (
    <div
      role="treeitem"
      onContextMenu={offerMenu}
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
  )
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`

/**
 * Rows picked with Ctrl / Shift-click, to act on several at once. `order` is the rows on screen, top to bottom; only
 * those count, so changing the filter or folding a folder can't leave a hidden row in the pick.
 */
function usePick(repoId: string, order: string[]): { pick: string[]; onPick: (name: string, e: React.MouseEvent | React.KeyboardEvent, plain: () => void) => void; clear: () => void; many: (name: string) => boolean } {
  const [picked, setPicked] = useState<string[]>([])
  const [anchor, setAnchor] = useState<string | null>(null)
  useEffect(() => {
    setPicked([])
    setAnchor(null)
  }, [repoId])
  const pick = picked.filter((n) => order.includes(n))
  const onPick = (name: string, e: React.MouseEvent | React.KeyboardEvent, plain: () => void): void => {
    if (e.shiftKey && anchor) {
      const a = order.indexOf(anchor)
      const b = order.indexOf(name)
      if (a >= 0 && b >= 0) return setPicked(order.slice(Math.min(a, b), Math.max(a, b) + 1))
    }
    if (e.ctrlKey || e.metaKey) {
      const base = pick.length ? pick : anchor && order.includes(anchor) ? [anchor] : []
      setPicked(base.includes(name) ? base.filter((n) => n !== name) : [...base, name])
      setAnchor(name)
      return
    }
    setPicked([])
    setAnchor(name)
    plain()
  }
  return { pick, onPick, clear: () => setPicked([]), many: (name) => pick.length > 1 && pick.includes(name) }
}

interface Leaf {
  select: (r: Ref, e: React.MouseEvent | React.KeyboardEvent) => void
  remove: (r: Ref) => void
  menu: (r: Ref) => MenuEntry[]
}

interface PickAction {
  label: string
  icon: ReactNode
  onSelect: () => void
  danger?: boolean
  disabled?: boolean
  /** With several remotes, the menu offers each one (and all of them). */
  remotes?: string[]
  onRemote?: (remote: string) => void
}

function actionEntry(a: PickAction): MenuEntry {
  if (a.remotes && a.onRemote) {
    const on = a.onRemote
    return {
      type: 'sub',
      label: `${a.label} to`,
      icon: a.icon,
      items: [...a.remotes.map((r) => ({ type: 'item' as const, label: r, onSelect: () => on(r) })), { type: 'separator' as const }, { type: 'item' as const, label: 'All remotes', onSelect: () => on(act.ALL_REMOTES) }]
    }
  }
  return { type: 'item', label: a.label, icon: a.icon, danger: a.danger, disabled: a.disabled, onSelect: a.onSelect }
}

/** Under a section's header while several rows are picked: how many, and what to do with them. */
function PickBar({ count, actions, onClear }: { count: number; actions: PickAction[]; onClear: () => void }): React.JSX.Element {
  return (
    <div role="status" className="mx-2 mb-1 flex items-center gap-0.5 rounded-md border border-border bg-surface-raised py-0.5 pr-0.5 pl-2 text-sm text-muted">
      <span className="min-w-0 flex-1 truncate">{count} picked</span>
      {actions.map((a) => (
        <Tooltip key={a.label} content={a.label}>
          <IconButton label={a.label} size="sm" disabled={a.disabled} onClick={a.onSelect}>
            {a.icon}
          </IconButton>
        </Tooltip>
      ))}
      <Tooltip content="Clear the pick">
        <IconButton label="Clear the pick" size="sm" onClick={onClear}>
          <X size={14} />
        </IconButton>
      </Tooltip>
    </div>
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
            menu={() => folderMenu(n.name, n.refs, n.key)}
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

  // Local branches and tags picked with Ctrl / Shift-click, to push, delete or hide several at once.
  const localTree = buildTree(shownLocals, (r) => r.short, 'local')
  const visibleLeaves = (nodes: TreeNode[]): Ref[] => nodes.flatMap((n) => (n.kind === 'leaf' ? [n.ref] : isOpen(n.key) ? visibleLeaves(n.children) : []))
  const branchPick = usePick(repoId, visibleLeaves(localTree).map((r) => r.short))
  const tagPick = usePick(repoId, shownTags.map((r) => r.short))
  const pickedRefs = locals.filter((r) => branchPick.pick.includes(r.short))
  const deletable = pickedRefs.filter((r) => !r.isHead && !r.worktree).length
  const remoteNames = refs?.remotes ?? []
  const branchActions = (): PickAction[] => [
    { label: `Push ${plural(pickedRefs.length, 'branch', 'branches')}`, icon: <Upload size={14} />, disabled: !remoteNames.length, onSelect: () => void act.pushBranches(repoId, branchPick.pick) },
    { label: deletable ? `Delete ${plural(deletable, 'branch', 'branches')}…` : 'Delete… (checked out)', icon: <Trash2 size={14} />, danger: true, disabled: !deletable, onSelect: () => act.deleteBranches(repoId, branchPick.pick) }
  ]
  const tagActions = (): PickAction[] => [
    { label: `Push ${plural(tagPick.pick.length, 'tag')}`, icon: <Upload size={14} />, disabled: !remoteNames.length, onSelect: () => void act.pushTags(repoId, tagPick.pick), remotes: remoteNames.length > 1 ? remoteNames : undefined, onRemote: (r) => void act.pushTags(repoId, tagPick.pick, r) },
    { label: `Delete ${plural(tagPick.pick.length, 'tag')}…`, icon: <Trash2 size={14} />, danger: true, onSelect: () => act.deleteTags(repoId, tagPick.pick) }
  ]
  const pickMenu = (list: Ref[], names: string[], actions: PickAction[], clear: () => void): MenuEntry[] => {
    const eye = eyeFor(list)
    return [
      ...actions.slice(0, -1).map(actionEntry),
      { type: 'separator' },
      ...(eye ? [{ type: 'item' as const, label: eye.hidden ? `Show ${names.length} in the graph` : `Hide ${names.length} from the graph`, icon: eye.hidden ? <Eye size={14} /> : <EyeOff size={14} />, onSelect: eye.onToggle }] : []),
      { type: 'item', label: 'Copy names', onSelect: () => void navigator.clipboard.writeText(names.join('\n')) },
      { type: 'item', label: 'Clear the pick', onSelect: clear },
      { type: 'separator' },
      actionEntry(actions[actions.length - 1])
    ]
  }

  // What branch and tag rows do, read at the moment they do it (LeafRow can skip re-rendering a row, so a row may
  // also hold an older copy of its ref: each handler gets the latest one with that name).
  const fresh = (l: Leaf): Leaf => {
    const latest = (r: Ref): Ref => refs?.refs.find((x) => x.name === r.name) ?? r
    return { select: (r, e) => l.select(latest(r), e), remove: (r) => l.remove(latest(r)), menu: (r) => l.menu(latest(r)) }
  }
  const live = useRef<{ local: Leaf; remote: Leaf; tag: Leaf }>(null!)
  live.current = {
    local: fresh({
      select: (r, e) => branchPick.onPick(r.short, e, () => act.select(repoId, r.sha)),
      remove: (r) => (branchPick.many(r.short) ? act.deleteBranches(repoId, branchPick.pick) : !r.isHead && !r.worktree && act.deleteBranch(repoId, r.short)),
      menu: (r) => (branchPick.many(r.short) ? pickMenu(pickedRefs, branchPick.pick, branchActions(), branchPick.clear) : branchMenu(repoId, r, head, view, refs?.remotes ?? []))
    }),
    remote: fresh({
      select: (r) => act.select(repoId, r.sha),
      remove: () => {},
      menu: (r) => branchMenu(repoId, r, head, view, refs?.remotes ?? [])
    }),
    tag: fresh({
      select: (r, e) => tagPick.onPick(r.short, e, () => act.select(repoId, r.sha)),
      remove: (r) => (tagPick.many(r.short) ? act.deleteTags(repoId, tagPick.pick) : act.deleteTag(repoId, r.short)),
      menu: (r) => (tagPick.many(r.short) ? pickMenu(tags.filter((t) => tagPick.pick.includes(t.short)), tagPick.pick, tagActions(), tagPick.clear) : tagMenu(repoId, r.short, refs?.remotes ?? [], eyeOne(r)))
    })
  }

  return (
    <nav
      aria-label="Branches and tags"
      className="flex shrink-0 flex-col overflow-hidden bg-surface"
      style={{ width }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && (branchPick.pick.length || tagPick.pick.length)) {
          e.stopPropagation()
          branchPick.clear()
          tagPick.clear()
        }
      }}
    >
      <div className="flex items-center gap-1 p-2">
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
        <CollapseLeftButton />
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
      <SharedContextMenu>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Section
            title="Local branches"
            count={shownLocals.length}
            empty={f ? 'No matches' : 'No branches yet'}
            eye={eyeFor(locals) ?? undefined}
            multiselectable
            note={branchPick.pick.length > 1 ? <PickBar count={branchPick.pick.length} actions={branchActions()} onClear={branchPick.clear} /> : null}
          >
            {renderTree(localTree, 1, 0, (r, name, level, indent) => (
              <LeafRow
                key={r.name}
                icon={<GitBranch size={14} />}
                label={name}
                // The full name (the row shows only the part after its folder), plus what the badges say.
                name={`${r.short}${r.ahead ? `, ${r.ahead} ahead` : ''}${r.behind ? `, ${r.behind} behind` : ''}${r.upstreamGone ? ', gone' : ''}${r.worktree ? `, in worktree ${folderName(r.worktree)}` : ''}`}
                level={level}
                indent={indent}
                eye={eyeOne(r)}
                current={r.isHead}
                selected={branchPick.pick.length ? branchPick.pick.includes(r.short) : selected === r.sha}
                onSelect={(e) => live.current.local.select(r, e)}
                onDelete={() => live.current.local.remove(r)}
                onActivate={() => !r.isHead && void act.checkout(repoId, r.short)}
                menu={() => live.current.local.menu(r)}
                dim={outOfGraph(view, r)}
                pinned={view.pinned === r.name}
                title={`${r.upstream ? `${r.short} → ${r.upstream.replace('refs/remotes/', '')}${r.upstreamGone ? ' (gone)' : ''}` : `${r.short} (not pushed)`}${r.worktree ? `\nChecked out in the worktree ${r.worktree}` : ''}`}
                badges={
                  <>
                    {r.worktree ? <FolderGit2 size={12} aria-hidden className="shrink-0 text-muted" /> : null}
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
                  menu={() => [
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
                        <LeafRow
                          key={r.name}
                          indent={indent}
                          level={level}
                          icon={<GitBranch size={14} />}
                          label={name}
                          name={r.short.slice(remote.length + 1)}
                          eye={eyeOne(r)}
                          selected={selected === r.sha}
                          onSelect={(e) => live.current.remote.select(r, e)}
                          onActivate={() => void act.checkout(repoId, r.short)}
                          menu={() => live.current.remote.menu(r)}
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
          <Section
            title="Tags"
            count={shownTags.length}
            empty={f ? 'No matches' : 'No tags'}
            eye={eyeFor(tags) ?? undefined}
            multiselectable
            note={tagPick.pick.length > 1 ? <PickBar count={tagPick.pick.length} actions={tagActions()} onClear={tagPick.clear} /> : null}
          >
            {shownTags.map((r) => (
              <LeafRow
                key={r.name}
                icon={<Tag size={14} />}
                label={r.short}
                selected={tagPick.pick.length ? tagPick.pick.includes(r.short) : selected === r.sha}
                onSelect={(e) => live.current.tag.select(r, e)}
                onDelete={() => live.current.tag.remove(r)}
                onActivate={() => act.select(repoId, r.sha)}
                title={r.annotation ? `${r.short}: ${r.annotation}` : r.short}
                eye={eyeOne(r)}
                dim={view.hidden.includes(r.name)}
                menu={() => live.current.tag.menu(r)}
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
                menu={() => stashMenu(repoId, s.sha, s.message)}
              />
            ))}
          </Section>
          <WorktreeSection repoId={repoId} match={match} />
          <SubmoduleSection repoId={repoId} match={match} />
        </div>
      </SharedContextMenu>
    </nav>
  )
}

const folderName = (path: string): string => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? path

/** Every working tree of the repository. Hidden while there's only the main one; branch and commit menus add the first. */
function WorktreeSection({ repoId, match }: { repoId: string; match: (s: string) => boolean }): React.JSX.Element | null {
  const list = useRepo(repoId, (r) => r.worktrees)
  if (!list || list.length < 2) return null
  const shown = list.filter((w) => match(folderName(w.path)) || (w.branch !== null && match(w.branch)))
  const missing = list.filter((w) => w.missing && w.locked === null)
  const headerMenu: MenuEntry[] = [
    { type: 'item', label: 'New worktree…', icon: <FolderPlus size={14} />, onSelect: () => act.openDialog({ kind: 'addWorktree', repoId }) },
    { type: 'item', label: `Forget missing worktrees (${missing.length})`, icon: <Trash2 size={14} />, disabled: !missing.length, onSelect: () => void act.pruneWorktrees(repoId) }
  ]
  const rowMenu = (w: Worktree): MenuEntry[] => {
    const m: MenuEntry[] = [
      { type: 'item', label: w.current ? 'Open (this tab)' : 'Open', icon: <FolderGit2 size={14} />, disabled: w.current || w.missing, onSelect: () => void act.openWorktree(w.path) },
      { type: 'separator' },
      { type: 'item', label: 'Show in folder', icon: <FolderOpen size={14} />, disabled: w.missing, onSelect: () => void act.openIn(repoId, 'folder', undefined, w.path) },
      { type: 'item', label: 'Open in terminal', icon: <SquareTerminal size={14} />, disabled: w.missing, onSelect: () => void act.openIn(repoId, 'terminal', undefined, w.path) },
      { type: 'item', label: 'Copy path', onSelect: () => void navigator.clipboard.writeText(w.path) }
    ]
    if (!w.main) {
      m.push({ type: 'separator' })
      m.push(
        w.locked !== null
          ? { type: 'item', label: 'Unlock', icon: <LockOpen size={14} />, onSelect: () => void act.lockWorktree(repoId, w.path, false) }
          : { type: 'item', label: 'Lock (keep it from being removed)', icon: <Lock size={14} />, onSelect: () => void act.lockWorktree(repoId, w.path, true) }
      )
      m.push({ type: 'item', label: w.current ? 'Remove… (open it from another tab)' : 'Remove…', icon: <Trash2 size={14} />, danger: true, disabled: w.current, onSelect: () => act.removeWorktree(repoId, w.path, w.branch) })
    }
    return m
  }
  return (
    <Section title="Worktrees" count={shown.length} empty="No matches" menu={headerMenu} action={{ label: 'New worktree', icon: <FolderPlus size={14} />, onClick: () => act.openDialog({ kind: 'addWorktree', repoId }) }}>
      {shown.map((w) => {
        const at = w.branch ?? (w.head ? `${w.head.slice(0, 7)} (detached)` : 'detached')
        const states = [w.main ? 'main worktree' : '', w.current ? 'this tab' : '', w.locked !== null ? 'locked' : '', w.missing ? 'folder missing' : ''].filter(Boolean)
        return (
          <Row
            key={w.path}
            icon={<FolderGit2 size={14} />}
            label={folderName(w.path)}
            name={[folderName(w.path), at, ...states].join(', ')}
            current={w.current}
            faded={w.missing}
            title={`${w.path}${w.main ? ' (main worktree)' : ''}\n${w.branch ? `On ${w.branch}` : `At ${at}`}${w.locked ? `\nLocked: ${w.locked}` : w.locked !== null ? '\nLocked' : ''}${w.missing ? '\nIts folder is gone; “Forget missing worktrees” clears it' : ''}`}
            onActivate={() => (w.current || w.missing ? undefined : void act.openWorktree(w.path))}
            menu={() => rowMenu(w)}
            badges={
              <>
                <span className="max-w-24 truncate text-xs text-muted">{at}</span>
                {w.locked !== null ? <Lock size={12} aria-hidden className="shrink-0 text-muted" /> : null}
                {w.missing ? <Badge tone="warning">missing</Badge> : null}
              </>
            }
          />
        )
      })}
    </Section>
  )
}

const modeLabel: Record<SubmoduleMode, string> = { follow: 'Follow', manual: 'Manual', working: 'Working in it' }

type SubState = 'not set up' | 'changes' | 'out of step' | 'up to date'

/** Submodules of the checked-out commit. Hidden when the repository has none, or when submodule handling is off. */
function SubmoduleSection({ repoId, match }: { repoId: string; match: (s: string) => boolean }): React.JSX.Element | null {
  const subs = useRepo(repoId, (r) => r.submodules)
  const changes = useRepo(repoId, (r) => r.status?.changes)
  const running = useRepo(repoId, (r) => r.subOp)
  if (!subs || !subs.settings.on || !subs.list.length) return null
  const { list, settings } = subs
  const stateOf = (m: Submodule): SubState => {
    if (!m.setUp) return 'not set up'
    const c = changes?.find((x) => x.path === m.path)?.submodule
    if (c?.modified || c?.untracked) return 'changes'
    return m.current !== m.expected ? 'out of step' : 'up to date'
  }
  const notSetUp = list.filter((m) => !m.setUp)
  const outOfStep = list.filter((m) => stateOf(m) === 'out of step')
  const setUp = list.filter((m) => m.setUp)
  const shown = list.filter((m) => match(m.path))
  const busy = !!running

  const headerMenu: MenuEntry[] = [
    { type: 'item', label: `Set up all (${notSetUp.length})`, icon: <Download size={14} />, disabled: busy || !notSetUp.length, onSelect: () => void act.setUpSubmodules(repoId, 'all') },
    { type: 'item', label: settings.shallow ? 'Set up all with full history' : 'Set up all as shallow copies', disabled: busy || !notSetUp.length, onSelect: () => void act.setUpSubmodules(repoId, 'all', !settings.shallow) },
    { type: 'item', label: `Update all to the expected commits (${outOfStep.length})`, icon: <RefreshCw size={14} />, disabled: busy || !outOfStep.length, onSelect: () => void act.updateSubmodules(repoId, 'all') },
    { type: 'separator' },
    { type: 'item', label: 'Submodule settings…', icon: <Settings size={14} />, onSelect: () => act.setCenter(repoId, { kind: 'prefs' }) },
    { type: 'separator' },
    { type: 'item', label: 'Remove all local copies…', icon: <Trash2 size={14} />, danger: true, disabled: busy || !setUp.length, onSelect: () => act.removeSubmodules(repoId, setUp.map((m) => m.path)) }
  ]

  const rowMenu = (m: Submodule, state: SubState): MenuEntry[] => {
    const mode = m.mode ?? settings.mode
    if (!m.setUp)
      return [
        { type: 'item', label: 'Set up', icon: <Download size={14} />, disabled: busy, onSelect: () => void act.setUpSubmodules(repoId, [m.path]) },
        { type: 'item', label: settings.shallow ? 'Set up with full history' : 'Set up as a shallow copy', disabled: busy, onSelect: () => void act.setUpSubmodules(repoId, [m.path], !settings.shallow) },
        { type: 'separator' },
        { type: 'item', label: 'Copy path', onSelect: () => void navigator.clipboard.writeText(m.path) }
      ]
    return [
      { type: 'item', label: 'Open', icon: <FolderGit2 size={14} />, onSelect: () => void act.openSubmodule(repoId, m.path) },
      {
        type: 'item',
        label: state === 'changes' ? 'Update to the expected commit (has changes)' : 'Update to the expected commit',
        icon: <RefreshCw size={14} />,
        disabled: busy || state !== 'out of step',
        onSelect: () => void act.updateSubmodules(repoId, [m.path])
      },
      {
        type: 'sub',
        label: `Mode: ${modeLabel[mode]}`,
        items: [
          ...(['follow', 'manual', 'working'] as const).map((k) => ({
            type: 'item' as const,
            label: `${modeLabel[k]}${k === settings.mode ? ' (repository default)' : ''}${m.mode === k || (!m.mode && k === settings.mode) ? ' ✓' : ''}`,
            onSelect: () => void act.setSubmoduleMode(repoId, [m.name], k === settings.mode ? null : k)
          }))
        ]
      },
      { type: 'separator' },
      { type: 'item', label: 'Show in folder', icon: <FolderOpen size={14} />, onSelect: () => void act.openIn(repoId, 'folder', m.path) },
      { type: 'item', label: 'Copy path', onSelect: () => void navigator.clipboard.writeText(m.path) },
      { type: 'separator' },
      { type: 'item', label: 'Remove local copy…', icon: <Trash2 size={14} />, danger: true, disabled: busy || state === 'changes', onSelect: () => act.removeSubmodules(repoId, [m.path]) }
    ]
  }

  return (
    <Section
      title="Submodules"
      count={shown.length}
      empty="No matches"
      menu={headerMenu}
      action={notSetUp.length ? { label: notSetUp.length === 1 ? 'Set up the submodule' : `Set up all ${notSetUp.length} submodules`, icon: <Download size={14} />, disabled: busy, onClick: () => void act.setUpSubmodules(repoId, 'all') } : undefined}
      note={
        running ? (
          <div role="status" aria-label="Submodules" className="mx-2 mb-1 flex items-center gap-2 rounded-md border border-border bg-surface-raised px-2 py-1 text-sm text-muted">
            <Spinner size={12} />
            <span className="min-w-0 flex-1 truncate">
              {running.phase && running.phase.startsWith('Setting up') ? running.phase : running.label}
              {running.percent !== undefined ? ` · ${running.percent}%` : ''}
            </span>
            <Button size="sm" variant="ghost" onClick={() => void call('op.cancel', { opId: running.opId })}>
              Cancel
            </Button>
          </div>
        ) : null
      }
    >
      {shown.map((m) => {
        const state = stateOf(m)
        const mode = m.mode ?? settings.mode
        const at = m.setUp ? (m.branch ? `on ${m.branch}` : `at ${m.current?.slice(0, 7)} (detached)`) : 'not set up'
        return (
          <Row
            key={m.path}
            icon={<Boxes size={14} />}
            label={m.path.split('/').pop() ?? m.path}
            name={`${m.path}, ${state}`}
            faded={!m.setUp}
            title={`${m.path}\n${at}${m.expected ? ` · expects ${m.expected.slice(0, 7)}` : ''}${m.setUp ? `\nMode: ${modeLabel[mode]}${m.mode ? '' : ' (repository default)'}` : ''}`}
            onActivate={() => (m.setUp ? void act.openSubmodule(repoId, m.path) : undefined)}
            menu={() => rowMenu(m, state)}
            badges={
              <>
                {m.setUp && m.mode && m.mode !== settings.mode ? <Badge>{modeLabel[m.mode].toLowerCase()}</Badge> : null}
                {state === 'changes' ? <Badge tone="warning">changes</Badge> : null}
                {state === 'out of step' ? <Badge tone="warning">out of step</Badge> : null}
                {state === 'not set up' ? <span className="text-xs text-muted">not set up</span> : null}
              </>
            }
          />
        )
      })}
    </Section>
  )
}

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, Folder, FolderOpen, List, ListTree } from 'lucide-react'
import { Badge, Button, ContextMenu, IconButton, StatusIcon, Tooltip, type FileStatus, type MenuEntry } from '@/ui'
import { cn } from '@/ui/cn'
import { splitPath } from '@/lib/format'
import { setPrefs, useApp } from '@/store'

export interface FileItem {
  path: string
  origPath?: string
  status: FileStatus
  /** Stored in Git LFS. */
  lfs?: boolean
  /** A submodule, not a file. */
  submodule?: boolean
}

const letterToStatus: Record<string, FileStatus> = {
  A: 'added',
  M: 'modified',
  D: 'deleted',
  R: 'renamed',
  C: 'copied',
  T: 'modified',
  U: 'conflicted',
  '?': 'untracked'
}
export const toStatus = (letter: string): FileStatus => letterToStatus[letter] ?? 'modified'

type Line = { kind: 'dir'; path: string; name: string; depth: number; open: boolean; files: FileItem[] } | { kind: 'file'; f: FileItem; depth: number }
type DirLine = Extract<Line, { kind: 'dir' }>

const INDENT = 12
// Folder paths end in a slash so they can't share a key with a file.
const keyOf = (l: Line): string => (l.kind === 'dir' ? `${l.path}/` : l.f.path)

/**
 * A titled, keyboard-navigable list of changed files with one bulk action and per-row hover action, shown flat or as a
 * folder tree. With `multi`, Ctrl-click, Shift-click, Shift+arrows, Space and Ctrl+A pick several files, and the menu
 * and keys act on all of them. A folder row acts on every file under it.
 */
export function FileList({
  title,
  files,
  selected,
  onOpen,
  bulk,
  rowAction,
  dirAction,
  menu,
  dirMenu,
  emptyText,
  onKey,
  tools,
  note,
  multi = false
}: {
  title: string
  files: FileItem[]
  selected?: string | null
  onOpen: (f: FileItem) => void
  bulk?: { label: string; onClick: () => void; disabled?: boolean }
  rowAction?: { label: string; onClick: (f: FileItem) => void }
  /** The hover action on a folder row, for the files under it. */
  dirAction?: { label: string; onClick: (files: FileItem[]) => void }
  /** The menu for a row; `picked` is every picked file when the row is one of them, else just the row. */
  menu: (f: FileItem, picked: FileItem[]) => MenuEntry[]
  /** Menu items for a folder row, above Expand / Collapse. */
  dirMenu?: (files: FileItem[]) => MenuEntry[]
  emptyText: string
  /** Keys on a file row, or on a folder row with `picked` set to the files under it. */
  onKey?: (e: React.KeyboardEvent, f: FileItem, picked: FileItem[]) => void
  /** Extra header buttons, before the list / tree switch. */
  tools?: ReactNode
  /** A line under the header, e.g. what the list is leaving out. */
  note?: ReactNode
  multi?: boolean
}): React.JSX.Element {
  const tree = useApp((s) => s.prefs.fileTree)
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [marks, setMarks] = useState<string[]>([])
  const anchor = useRef<string | null>(null)
  const els = useRef(new Map<string, HTMLDivElement>())
  const sorted = [...files].sort((a, b) => Number(b.status === 'conflicted') - Number(a.status === 'conflicted') || a.path.localeCompare(b.path))
  const lines: Line[] = tree ? treeLines(sorted, collapsed) : sorted.map((f) => ({ kind: 'file', f, depth: 0 }))
  // Only files on screen count, so folding a folder can't leave a hidden file in the pick.
  const order = lines.flatMap((l) => (l.kind === 'file' ? [l.f] : []))
  const picked = order.filter((f) => marks.includes(f.path))
  // Opening a file, here or anywhere else, ends a pick and unfolds the folders it's in.
  useEffect(() => {
    setMarks([])
    if (!selected) return
    setCollapsed((prev) => {
      const keep = [...prev].filter((p) => !selected.startsWith(`${p}/`))
      return keep.length === prev.size ? prev : new Set(keep)
    })
  }, [selected])

  const isOn = (p: string): boolean => (picked.length ? marks.includes(p) : selected === p)
  const pickedFor = (f: FileItem): FileItem[] => (picked.length > 1 && marks.includes(f.path) ? picked : [f])
  const rangeTo = (to: string): string[] => {
    const at = (p: string | null | undefined): number => order.findIndex((f) => f.path === p)
    const from = at(anchor.current ?? selected)
    const end = at(to)
    return from < 0 ? [to] : order.slice(Math.min(from, end), Math.max(from, end) + 1).map((f) => f.path)
  }
  const toggle = (p: string): void => {
    const base = picked.length ? picked.map((f) => f.path) : selected && order.some((f) => f.path === selected) ? [selected] : []
    setMarks(base.includes(p) ? base.filter((x) => x !== p) : [...base, p])
    anchor.current = p
  }
  const fold = (path: string, open?: boolean): void =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (open ?? next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  const focusLine = (l: Line | undefined): void => void (l && els.current.get(keyOf(l))?.focus())
  const parentOf = (i: number): Line | undefined => lines.slice(0, i).findLast((l) => l.kind === 'dir' && l.depth === lines[i].depth - 1)

  const click = (e: React.MouseEvent, f: FileItem): void => {
    if (multi && (e.ctrlKey || e.metaKey)) return toggle(f.path)
    if (multi && e.shiftKey) return setMarks(rangeTo(f.path))
    setMarks([])
    anchor.current = f.path
    onOpen(f)
  }
  // Keys every row shares; true when the key was handled.
  const common = (e: React.KeyboardEvent, i: number): boolean => {
    const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0
    if (step) {
      const next = lines[i + step]
      if (!next) return true
      e.preventDefault()
      focusLine(next)
      const cur = lines[i]
      if (multi && e.shiftKey && next.kind === 'file') {
        if (!picked.length && cur.kind === 'file') anchor.current = cur.f.path
        setMarks(rangeTo(next.f.path))
      }
    } else if (multi && e.key === 'a' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      setMarks(order.map((x) => x.path))
    } else if (multi && e.key === 'Escape' && picked.length) {
      e.stopPropagation()
      setMarks([])
    } else return false
    return true
  }
  const fileKey = (e: React.KeyboardEvent, f: FileItem, i: number): void => {
    if (common(e, i)) return
    if (e.key === 'Enter') onOpen(f)
    else if (tree && e.key === 'ArrowLeft' && lines[i].depth > 0) {
      e.preventDefault()
      focusLine(parentOf(i))
    } else if (multi && e.key === ' ') {
      e.preventDefault()
      toggle(f.path)
    } else onKey?.(e, f, pickedFor(f))
  }
  const dirKey = (e: React.KeyboardEvent, d: DirLine, i: number): void => {
    if (common(e, i)) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      fold(d.path)
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      if (d.open) focusLine(lines[i + 1])
      else fold(d.path, true)
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      if (d.open) fold(d.path, false)
      else focusLine(parentOf(i))
    } else onKey?.(e, d.files[0], d.files)
  }
  const folderMenu = (d: DirLine): MenuEntry[] => [
    ...(dirMenu ? [...dirMenu(d.files), { type: 'separator' as const }] : []),
    { type: 'item', label: d.open ? 'Collapse' : 'Expand', onSelect: () => fold(d.path) },
    { type: 'item', label: 'Collapse all', onSelect: () => setCollapsed(new Set(treeLines(sorted, new Set()).flatMap((l) => (l.kind === 'dir' ? [l.path] : [])))) },
    { type: 'item', label: 'Expand all', onSelect: () => setCollapsed(new Set()) }
  ]
  const ref = (l: Line) => (el: HTMLDivElement | null) => void (el ? els.current.set(keyOf(l), el) : els.current.delete(keyOf(l)))

  return (
    <section className="flex min-h-0 flex-col" aria-label={title}>
      <header className="flex h-8 shrink-0 items-center gap-2 px-3">
        <h3 className="flex-1 text-sm font-medium text-text">
          {title}{' '}
          <span className="text-muted">
            · {files.length}
            {picked.length > 1 ? ` · ${picked.length} selected` : ''}
          </span>
        </h3>
        {tools}
        <Tooltip content={tree ? 'Show as a flat list' : 'Show as a tree'}>
          <IconButton label={tree ? 'Show as a flat list' : 'Show as a tree'} size="sm" pressed={tree} onClick={() => setPrefs({ fileTree: !tree })}>
            {tree ? <ListTree size={14} /> : <List size={14} />}
          </IconButton>
        </Tooltip>
        {bulk ? (
          <Button size="sm" variant="ghost" onClick={bulk.onClick} disabled={bulk.disabled || files.length === 0}>
            {bulk.label}
          </Button>
        ) : null}
      </header>
      {note}
      {files.length === 0 ? (
        <p className="px-3 pb-3 text-sm text-muted">{emptyText}</p>
      ) : (
        <div role={tree ? 'tree' : 'listbox'} aria-label={title} aria-multiselectable={multi || undefined} className="min-h-0 overflow-y-auto pb-2">
          {lines.map((l, i) =>
            l.kind === 'dir' ? (
              <DirRow
                key={keyOf(l)}
                d={l}
                rowRef={ref(l)}
                onClick={() => fold(l.path)}
                onKeyDown={(e) => dirKey(e, l, i)}
                action={dirAction}
                menu={folderMenu(l)}
              />
            ) : (
              <Row
                key={keyOf(l)}
                f={l.f}
                tree={tree}
                depth={l.depth}
                selected={isOn(l.f.path)}
                rowRef={ref(l)}
                onClick={(e) => click(e, l.f)}
                onKeyDown={(e) => fileKey(e, l.f, i)}
                rowAction={rowAction}
                menu={menu(l.f, pickedFor(l.f))}
              />
            )
          )}
        </div>
      )}
    </section>
  )
}

function Row({
  f,
  tree,
  depth,
  selected,
  rowRef,
  onClick,
  onKeyDown,
  rowAction,
  menu
}: {
  f: FileItem
  tree: boolean
  depth: number
  selected: boolean
  rowRef: (el: HTMLDivElement | null) => void
  onClick: (e: React.MouseEvent) => void
  onKeyDown: (e: React.KeyboardEvent) => void
  rowAction?: { label: string; onClick: (f: FileItem) => void }
  menu: MenuEntry[]
}): ReactNode {
  const { dir, name } = splitPath(f.path)
  return (
    <ContextMenu items={menu}>
      <div
        ref={rowRef}
        role={tree ? 'treeitem' : 'option'}
        aria-level={tree ? depth + 1 : undefined}
        aria-selected={selected}
        tabIndex={0}
        title={f.origPath ? `${f.origPath} → ${f.path}` : f.path}
        onClick={onClick}
        onKeyDown={onKeyDown}
        className={cn(
          'group flex h-(--gc-list-row-h) cursor-default items-center gap-2 px-3 text-base outline-none select-none hover:bg-row-hover focus-visible:bg-row-hover',
          selected && 'bg-row-selected'
        )}
        // Lines the file's icon up with the folder icons beside it (chevron 12px + gap 6px).
        style={tree ? { paddingLeft: 12 + depth * INDENT + 18 } : undefined}
      >
        <StatusIcon kind={f.status} />
        <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
          <span className="truncate text-text">{name}</span>
          {!tree && dir ? <span className="truncate text-sm text-muted">{dir}</span> : null}
        </span>
        {f.submodule ? (
          <span title="A submodule: its diff shows the commits it moves by" className="shrink-0 rounded-sm border border-border px-1 text-xs text-muted">
            submodule
          </span>
        ) : null}
        {f.lfs ? (
          <span title="Stored in Git LFS" className="shrink-0 rounded-sm border border-border px-1 font-mono text-xs text-muted">
            LFS
          </span>
        ) : null}
        {rowAction ? <HoverAction label={rowAction.label} onClick={() => rowAction.onClick(f)} /> : null}
      </div>
    </ContextMenu>
  )
}

/** A folder row: folds its files away (click, Enter, Space, arrows). */
function DirRow({
  d,
  rowRef,
  onClick,
  onKeyDown,
  action,
  menu
}: {
  d: DirLine
  rowRef: (el: HTMLDivElement | null) => void
  onClick: () => void
  onKeyDown: (e: React.KeyboardEvent) => void
  action?: { label: string; onClick: (files: FileItem[]) => void }
  menu: MenuEntry[]
}): ReactNode {
  return (
    <ContextMenu items={menu}>
      <div
        ref={rowRef}
        role="treeitem"
        aria-level={d.depth + 1}
        aria-expanded={d.open}
        aria-selected={false}
        aria-label={d.name}
        tabIndex={0}
        title={d.path}
        onClick={onClick}
        onKeyDown={onKeyDown}
        className="group flex h-(--gc-list-row-h) cursor-default items-center gap-1.5 pr-3 text-base text-muted outline-none select-none hover:bg-row-hover focus-visible:bg-row-hover"
        style={{ paddingLeft: 12 + d.depth * INDENT }}
      >
        <span className="shrink-0">{d.open ? <ChevronDown size={12} aria-hidden /> : <ChevronRight size={12} aria-hidden />}</span>
        <span className="shrink-0">{d.open ? <FolderOpen size={14} aria-hidden /> : <Folder size={14} aria-hidden />}</span>
        <span className="min-w-0 flex-1 truncate">{d.name}</span>
        {!d.open ? <Badge>{d.files.length}</Badge> : null}
        {action ? <HoverAction label={action.label} onClick={() => action.onClick(d.files)} /> : null}
      </div>
    </ContextMenu>
  )
}

function HoverAction({ label, onClick }: { label: string; onClick: () => void }): ReactNode {
  return (
    // A list option can't contain a button, so this is a mouse shortcut. Keyboard: S / U on the row, or its menu.
    <span
      aria-hidden
      title={label}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className="inline-flex h-6 cursor-default items-center rounded-md border border-border bg-surface-raised px-2 text-sm text-text opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 hover:bg-row-hover"
    >
      {label}
    </span>
  )
}

interface Dir {
  name: string
  path: string
  dirs: Map<string, Dir>
  files: FileItem[]
}

/** The rows of the folder tree, top to bottom: folders first, then files, skipping what's under a folded folder. */
function treeLines(files: FileItem[], collapsed: Set<string>): Line[] {
  const root: Dir = { name: '', path: '', dirs: new Map(), files: [] }
  for (const f of files) {
    let d = root
    for (const part of f.path.split('/').slice(0, -1)) {
      let next = d.dirs.get(part)
      if (!next) d.dirs.set(part, (next = { name: part, path: d.path ? `${d.path}/${part}` : part, dirs: new Map(), files: [] }))
      d = next
    }
    d.files.push(f)
  }
  const subdirs = (d: Dir): Dir[] => [...d.dirs.values()].sort((a, b) => a.name.localeCompare(b.name))
  const under = (d: Dir): FileItem[] => [...subdirs(d).flatMap(under), ...d.files]
  const out: Line[] = []
  const walk = (d: Dir, depth: number): void => {
    for (let sub of subdirs(d)) {
      let name = sub.name
      // A folder that only holds one folder shares its row: src/renderer.
      while (sub.files.length === 0 && sub.dirs.size === 1) {
        sub = [...sub.dirs.values()][0]
        name += `/${sub.name}`
      }
      const open = !collapsed.has(sub.path)
      out.push({ kind: 'dir', path: sub.path, name, depth, open, files: under(sub) })
      if (open) walk(sub, depth + 1)
    }
    for (const f of d.files) out.push({ kind: 'file', f, depth })
  }
  walk(root, 0)
  return out
}

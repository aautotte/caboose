import { useEffect, useRef, useState, type ReactNode } from 'react'
import { List, ListTree } from 'lucide-react'
import { Button, ContextMenu, IconButton, StatusIcon, Tooltip, type FileStatus, type MenuEntry } from '@/ui'
import { cn } from '@/ui/cn'
import { splitPath } from '@/lib/format'

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

/**
 * A titled, keyboard-navigable list of changed files with one bulk action and per-row hover action. With `multi`,
 * Ctrl-click, Shift-click, Shift+arrows, Space and Ctrl+A pick several files, and the menu and keys act on all of them.
 */
export function FileList({
  title,
  files,
  selected,
  onOpen,
  bulk,
  rowAction,
  menu,
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
  /** The menu for a row; `picked` is every picked file when the row is one of them, else just the row. */
  menu: (f: FileItem, picked: FileItem[]) => MenuEntry[]
  emptyText: string
  onKey?: (e: React.KeyboardEvent, f: FileItem, picked: FileItem[]) => void
  /** Extra header buttons, before the list / tree switch. */
  tools?: ReactNode
  /** A line under the header, e.g. what the list is leaving out. */
  note?: ReactNode
  multi?: boolean
}): React.JSX.Element {
  const [tree, setTree] = useState(false)
  const [marks, setMarks] = useState<string[]>([])
  const anchor = useRef<string | null>(null)
  const rows = useRef(new Map<string, HTMLDivElement>())
  const sorted = [...files].sort((a, b) => Number(b.status === 'conflicted') - Number(a.status === 'conflicted') || a.path.localeCompare(b.path))
  const groups = tree ? groupByDir(sorted) : [{ dir: '', files: sorted }]
  const order = groups.flatMap((g) => g.files)
  const picked = order.filter((f) => marks.includes(f.path))
  // Opening a file, here or anywhere else, ends a pick.
  useEffect(() => setMarks([]), [selected])

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

  const click = (e: React.MouseEvent, f: FileItem): void => {
    if (multi && (e.ctrlKey || e.metaKey)) return toggle(f.path)
    if (multi && e.shiftKey) return setMarks(rangeTo(f.path))
    setMarks([])
    anchor.current = f.path
    onOpen(f)
  }
  const key = (e: React.KeyboardEvent, f: FileItem): void => {
    const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0
    if (e.key === 'Enter') onOpen(f)
    else if (step) {
      const next = order[order.indexOf(f) + step]
      if (!next) return
      e.preventDefault()
      rows.current.get(next.path)?.focus()
      if (multi && e.shiftKey) {
        if (!picked.length) anchor.current = f.path
        setMarks(rangeTo(next.path))
      }
    } else if (multi && e.key === ' ') {
      e.preventDefault()
      toggle(f.path)
    } else if (multi && e.key === 'a' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      setMarks(order.map((x) => x.path))
    } else if (multi && e.key === 'Escape' && picked.length) {
      e.stopPropagation()
      setMarks([])
    } else onKey?.(e, f, pickedFor(f))
  }

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
        <Tooltip content={tree ? 'Show as a flat list' : 'Group by folder'}>
          <IconButton label={tree ? 'Show as a flat list' : 'Group by folder'} size="sm" pressed={tree} onClick={() => setTree(!tree)}>
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
        <div role="listbox" aria-label={title} aria-multiselectable={multi || undefined} className="min-h-0 overflow-y-auto pb-2">
          {groups.map((g) => (
            <div key={g.dir} role="group" aria-label={g.dir || 'Root'}>
              {tree && g.dir ? <div className="truncate px-3 pt-1 text-xs text-muted">{g.dir}</div> : null}
              {g.files.map((f) => (
                <Row
                  key={f.path}
                  f={f}
                  tree={tree}
                  selected={isOn(f.path)}
                  rowRef={(el) => void (el ? rows.current.set(f.path, el) : rows.current.delete(f.path))}
                  onClick={(e) => click(e, f)}
                  onKeyDown={(e) => key(e, f)}
                  rowAction={rowAction}
                  menu={menu(f, pickedFor(f))}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function Row({
  f,
  tree,
  selected,
  rowRef,
  onClick,
  onKeyDown,
  rowAction,
  menu
}: {
  f: FileItem
  tree: boolean
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
        role="option"
        aria-selected={selected}
        tabIndex={0}
        title={f.origPath ? `${f.origPath} → ${f.path}` : f.path}
        onClick={onClick}
        onKeyDown={onKeyDown}
        className={cn(
          'group flex h-(--gc-list-row-h) cursor-default items-center gap-2 px-3 text-base outline-none select-none hover:bg-row-hover focus-visible:bg-row-hover',
          selected && 'bg-row-selected',
          tree && 'pl-6'
        )}
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
        {rowAction ? (
          // A list option can't contain a button, so this is a mouse shortcut. Keyboard: S / U on the row, or its menu.
          <span
            aria-hidden
            title={rowAction.label}
            onClick={(e) => {
              e.stopPropagation()
              rowAction.onClick(f)
            }}
            className="inline-flex h-6 cursor-default items-center rounded-md border border-border bg-surface-raised px-2 text-sm text-text opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 hover:bg-row-hover"
          >
            {rowAction.label}
          </span>
        ) : null}
      </div>
    </ContextMenu>
  )
}

function groupByDir(files: FileItem[]): Array<{ dir: string; files: FileItem[] }> {
  const m = new Map<string, FileItem[]>()
  for (const f of files) {
    const { dir } = splitPath(f.path)
    m.set(dir, [...(m.get(dir) ?? []), f])
  }
  return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([dir, list]) => ({ dir, files: list }))
}

import { useState, type ReactNode } from 'react'
import { List, ListTree } from 'lucide-react'
import { Button, ContextMenu, IconButton, StatusIcon, Tooltip, type FileStatus, type MenuEntry } from '@/ui'
import { cn } from '@/ui/cn'
import { splitPath } from '@/lib/format'

export interface FileItem {
  path: string
  origPath?: string
  status: FileStatus
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

/** A titled, keyboard-navigable list of changed files with one bulk action and per-row hover action. */
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
  note
}: {
  title: string
  files: FileItem[]
  selected?: string | null
  onOpen: (f: FileItem) => void
  bulk?: { label: string; onClick: () => void; disabled?: boolean }
  rowAction?: { label: string; onClick: (f: FileItem) => void }
  menu: (f: FileItem) => MenuEntry[]
  emptyText: string
  onKey?: (e: React.KeyboardEvent, f: FileItem) => void
  /** Extra header buttons, before the list / tree switch. */
  tools?: ReactNode
  /** A line under the header, e.g. what the list is leaving out. */
  note?: ReactNode
}): React.JSX.Element {
  const [tree, setTree] = useState(false)
  const sorted = [...files].sort((a, b) => Number(b.status === 'conflicted') - Number(a.status === 'conflicted') || a.path.localeCompare(b.path))
  const groups = tree ? groupByDir(sorted) : [{ dir: '', files: sorted }]

  return (
    <section className="flex min-h-0 flex-col" aria-label={title}>
      <header className="flex h-8 shrink-0 items-center gap-2 px-3">
        <h3 className="flex-1 text-sm font-medium text-text">
          {title} <span className="text-muted">· {files.length}</span>
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
        <div role="listbox" aria-label={title} className="min-h-0 overflow-y-auto pb-2">
          {groups.map((g) => (
            <div key={g.dir} role="group" aria-label={g.dir || 'Root'}>
              {tree && g.dir ? <div className="truncate px-3 pt-1 text-xs text-muted">{g.dir}</div> : null}
              {g.files.map((f) => (
                <Row key={f.path} f={f} tree={tree} selected={selected === f.path} onOpen={onOpen} rowAction={rowAction} menu={menu(f)} onKey={onKey} />
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function Row({ f, tree, selected, onOpen, rowAction, menu, onKey }: { f: FileItem; tree: boolean; selected: boolean; onOpen: (f: FileItem) => void; rowAction?: { label: string; onClick: (f: FileItem) => void }; menu: MenuEntry[]; onKey?: (e: React.KeyboardEvent, f: FileItem) => void }): ReactNode {
  const { dir, name } = splitPath(f.path)
  return (
    <ContextMenu items={menu}>
      <div
        role="option"
        aria-selected={selected}
        tabIndex={0}
        title={f.origPath ? `${f.origPath} → ${f.path}` : f.path}
        onClick={() => onOpen(f)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onOpen(f)
          else if (e.key === 'ArrowDown') (e.currentTarget.nextElementSibling as HTMLElement | null)?.focus()
          else if (e.key === 'ArrowUp') (e.currentTarget.previousElementSibling as HTMLElement | null)?.focus()
          else onKey?.(e, f)
        }}
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

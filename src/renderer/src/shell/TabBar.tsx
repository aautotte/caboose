import { useState } from 'react'
import { Check, FolderGit2, Home, Plus, Settings2, UserRound, X } from 'lucide-react'
import { DropdownMenu, Spinner, Tooltip } from '@/ui'
import { cn } from '@/ui/cn'
import { useApp } from '@/store'
import * as act from '@/actions'

export function TabBar(): React.JSX.Element {
  const tabs = useApp((s) => s.tabs)
  const active = useApp((s) => s.active)
  const repos = useApp((s) => s.repos)
  const [dragId, setDragId] = useState<string | null>(null)

  const onKey = (e: React.KeyboardEvent, i: number): void => {
    const ids = ['home', ...tabs.map((t) => t.id)]
    const cur = i + 1
    if (e.key === 'Delete' && i >= 0) {
      e.preventDefault()
      void act.closeTab(tabs[i].id)
      return
    }
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const next = ids[(cur + (e.key === 'ArrowRight' ? 1 : -1) + ids.length) % ids.length]
      act.setActive(next)
      ;(document.getElementById(`tab-${next}`) as HTMLElement | null)?.focus()
      e.preventDefault()
    }
  }

  return (
    <header className="flex h-(--gc-tabbar-h) shrink-0 items-stretch border-b border-border bg-surface-sunken select-none">
      <div role="tablist" aria-label="Open repositories" className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
        <Tooltip content="Repositories" shortcut="Ctrl+T">
          <button
            id="tab-home"
            role="tab"
            aria-selected={active === 'home'}
            aria-label="Repositories"
            tabIndex={active === 'home' ? 0 : -1}
            onClick={() => act.setActive('home')}
            onKeyDown={(e) => onKey(e, -1)}
            className={cn(
              'grid w-10 shrink-0 place-items-center border-t-2 text-muted hover:bg-row-hover hover:text-text',
              active === 'home' ? 'border-accent bg-bg text-text' : 'border-transparent'
            )}
          >
            <Home size={16} />
          </button>
        </Tooltip>
        {tabs.map((t, i) => {
          const r = repos[t.id]
          const busy = r && Object.values(r.busy).some(Boolean)
          const paused = r?.status && r.status.op.kind !== 'none'
          const name = t.alias ?? t.name
          return (
            <Tooltip key={t.id} content={t.path}>
              <div
                draggable
                onDragStart={(e) => {
                  setDragId(t.id)
                  e.dataTransfer.setData('application/x-caboose-tab', t.id)
                }}
                onDragOver={(e) => {
                  if (dragId && e.dataTransfer.types.includes('application/x-caboose-tab')) e.preventDefault()
                }}
                onDrop={() => {
                  if (!dragId || dragId === t.id) return
                  const ids = tabs.map((x) => x.id).filter((id) => id !== dragId)
                  ids.splice(ids.indexOf(t.id) + (tabs.findIndex((x) => x.id === dragId) < i ? 1 : 0), 0, dragId)
                  void act.reorderTabs(ids)
                  setDragId(null)
                }}
                onDragEnd={() => setDragId(null)}
                className={cn(
                  'group flex max-w-(--gc-tab-max-w) min-w-(--gc-tab-min-w) shrink-0 items-center border-t-2 border-r border-r-border',
                  active === t.id ? 'border-t-accent bg-bg text-text' : 'border-t-transparent text-muted hover:bg-row-hover',
                  dragId === t.id && 'opacity-60'
                )}
              >
                <button
                  id={`tab-${t.id}`}
                  role="tab"
                  aria-selected={active === t.id}
                  aria-keyshortcuts="Delete"
                  tabIndex={active === t.id ? 0 : -1}
                  onClick={() => act.setActive(t.id)}
                  onKeyDown={(e) => onKey(e, i)}
                  onAuxClick={(e) => e.button === 1 && void act.closeTab(t.id)}
                  className="flex h-full min-w-0 flex-1 items-center gap-2 pr-1 pl-3 text-base"
                >
                  {busy ? <Spinner size={14} /> : <FolderGit2 size={14} aria-hidden className="shrink-0" />}
                  <span className="truncate">{name}</span>
                  {paused ? <span role="img" aria-label="Operation paused" className="size-1.5 shrink-0 rounded-pill bg-warning" /> : null}
                </button>
                {/* A tab list may only hold tabs, so the × is a mouse shortcut; keyboard users press Delete on the tab
                    (or Ctrl+W), which the tab announces through aria-keyshortcuts. */}
                <span
                  aria-hidden
                  title={`Close ${name}`}
                  onClick={() => void act.closeTab(t.id)}
                  className={cn(
                    'mr-1 grid size-5 shrink-0 cursor-default place-items-center rounded-sm text-muted hover:bg-row-hover hover:text-text',
                    active === t.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                  )}
                >
                  <X size={12} />
                </span>
              </div>
            </Tooltip>
          )
        })}
      </div>
      <ProfileButton />
      <Tooltip content="Open another repository" shortcut="Ctrl+T">
        <button aria-label="Open another repository" onClick={() => act.setActive('home')} className="grid w-9 shrink-0 place-items-center text-muted hover:bg-row-hover hover:text-text">
          <Plus size={16} />
        </button>
      </Tooltip>
    </header>
  )
}

/** Which profile is in use, and a quick way to switch. Each profile has its own tabs, so switching reloads. */
function ProfileButton(): React.JSX.Element | null {
  const profiles = useApp((s) => s.profiles)
  const current = profiles.find((p) => p.isActive)
  if (!current) return null
  return (
    <DropdownMenu
      trigger={
        <button
          aria-label={`Profile: ${current.name}`}
          className="flex max-w-40 shrink-0 items-center gap-1.5 border-l border-border px-3 text-sm text-muted hover:bg-row-hover hover:text-text"
        >
          <UserRound size={14} aria-hidden className="shrink-0" />
          <span className="truncate">{current.name}</span>
        </button>
      }
      items={[
        ...profiles.map((p) => ({
          type: 'item' as const,
          label: p.name,
          icon: p.isActive ? <Check size={14} /> : <span className="size-3.5" />,
          onSelect: p.isActive ? undefined : () => void act.switchProfile(p.id)
        })),
        { type: 'separator' as const },
        { type: 'item' as const, label: 'Manage profiles…', icon: <Settings2 size={14} />, onSelect: () => act.openDialog({ kind: 'profiles' }) }
      ]}
    />
  )
}

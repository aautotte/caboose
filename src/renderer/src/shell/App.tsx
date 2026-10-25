import { useEffect } from 'react'
import { ToastProvider, TooltipProvider } from '@/ui'
import { setPrefs, useApp } from '@/store'
import * as act from '@/actions'
import { HomeView } from '@/home/HomeView'
import { DialogHost } from '@/dialogs/Dialogs'
import { AuthDialog } from '@/dialogs/MoreDialogs'
import { TabBar } from './TabBar'
import { RepoView } from './RepoView'
import { CommandPalette } from './CommandPalette'
import { installShots } from './shots'

function typingIn(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
}

/** Window-wide shortcuts. Per-view keys (J/K, S/U on files) live in their components. */
function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const s = useApp.getState()
      const repo = s.active !== 'home' ? s.active : null
      const ctrl = e.ctrlKey || e.metaKey
      const k = e.key.toLowerCase()
      const run = (fn: () => void): void => {
        e.preventDefault()
        fn()
      }
      if (s.dialog || s.paletteOpen) return
      if (ctrl && !e.shiftKey && k === 'p') return run(() => useApp.setState({ paletteOpen: true }))
      if (ctrl && k === '/') return run(() => act.openDialog({ kind: 'shortcuts' }))
      if (ctrl && k === 't') return run(() => act.setActive('home'))
      if (e.altKey && k === 'o') return run(() => void act.pickAndOpen())
      if (ctrl && k === 'tab') {
        const ids = ['home', ...s.tabs.map((t) => t.id)]
        const i = ids.indexOf(s.active)
        return run(() => act.setActive(ids[(i + (e.shiftKey ? -1 : 1) + ids.length) % ids.length]))
      }
      if (ctrl && /^[1-9]$/.test(e.key)) {
        const t = s.tabs[Number(e.key) - 1]
        if (t) return run(() => act.setActive(t.id))
      }
      if (!repo) return
      if (ctrl && k === 'w') return run(() => void act.closeTab(repo))
      if (ctrl && k === 'j') return run(() => setPrefs({ leftCollapsed: !s.prefs.leftCollapsed }))
      if (ctrl && k === 'k') return run(() => setPrefs({ detailCollapsed: !s.prefs.detailCollapsed }))
      if (ctrl && k === 'l') return run(() => void act.fetchAll(repo))
      if (ctrl && !e.shiftKey && k === 'b') {
        const head = s.repos[repo]?.refs?.head
        if (head?.sha) return run(() => act.openDialog({ kind: 'createBranch', repoId: repo, at: head.sha!, atLabel: head.branch ?? head.sha!.slice(0, 7) }))
      }
      if (ctrl && e.shiftKey && k === 'h') {
        const c = s.repos[repo]?.center
        if (c && (c.kind === 'diff' || c.kind === 'blame')) return run(() => act.setCenter(repo, { kind: 'history', path: c.path }))
      }
      if (ctrl && !e.shiftKey && k === 'f') return run(() => (document.getElementById('commit-search') as HTMLInputElement | null)?.focus())
      if (ctrl && e.altKey && k === 'f') return run(() => (document.getElementById('left-filter') as HTMLInputElement | null)?.focus())
      if (ctrl && e.shiftKey && k === 's') return run(() => void act.stage(repo, 'all'))
      if (ctrl && e.shiftKey && k === 'u') return run(() => void act.unstage(repo, 'all'))
      if (ctrl && e.shiftKey && k === 'm') {
        return run(() => {
          act.select(repo, 'wip')
          setTimeout(() => window.dispatchEvent(new Event('gc:focus-summary')), 0)
        })
      }
      if (ctrl && e.shiftKey && k === 'enter') {
        return run(() => {
          act.select(repo, 'wip')
          void act.stage(repo, 'all').then(() =>
            setTimeout(() => (document.querySelector('form[aria-label=Commit] button[type=submit]') as HTMLButtonElement | null)?.click(), 50)
          )
        })
      }
      if (typingIn(e.target)) return
      if (ctrl && !e.shiftKey && k === 'z') return run(() => void act.undo(repo))
      if (ctrl && (k === 'y' || (e.shiftKey && k === 'z'))) return run(() => void act.redo(repo))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

export function App(): React.JSX.Element {
  const ready = useApp((s) => s.ready)
  const active = useApp((s) => s.active)
  const theme = useApp((s) => s.prefs.theme)
  const codeSize = useApp((s) => s.prefs.codeFontSize)
  const tabSize = useApp((s) => s.prefs.tabSize)
  useShortcuts()
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])
  // The code size setting overrides the code type token; line height keeps the token's ratio (18 / 12).
  useEffect(() => {
    const root = document.documentElement.style
    root.setProperty('--gc-text-code', `${codeSize}px`)
    root.setProperty('--gc-text-code--line-height', `${Math.round(codeSize * 1.5)}px`)
    root.setProperty('--gc-tab-size', String(tabSize))
  }, [codeSize, tabSize])
  useEffect(() => {
    void act.boot()
    installShots()
  }, [])

  return (
    <TooltipProvider delayDuration={500} skipDelayDuration={0}>
      <ToastProvider>
        <div className="flex h-screen flex-col overflow-hidden">
          <TabBar />
          {!ready ? <div className="flex-1" /> : active === 'home' ? <HomeView /> : <RepoView key={active} repoId={active} />}
        </div>
        <DialogHost />
        <AuthDialog />
        <CommandPalette />
      </ToastProvider>
    </TooltipProvider>
  )
}

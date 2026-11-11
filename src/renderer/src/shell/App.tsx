import { useEffect } from 'react'
import { ToastProvider, TooltipProvider } from '@/ui'
import { useApp } from '@/store'
import * as act from '@/actions'
import { HomeView } from '@/home/HomeView'
import { DialogHost } from '@/dialogs/Dialogs'
import { AuthDialog } from '@/dialogs/MoreDialogs'
import { TabBar } from './TabBar'
import { RepoView } from './RepoView'
import { CommandPalette } from './CommandPalette'
import { installShots } from './shots'
import { commandById } from './commands'
import { comboOf, commandFor, customKeyId, notWhileTyping } from '@/lib/keys'

function typingIn(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
}

/**
 * Window-wide shortcuts, as Settings › Keyboard shortcuts has them (lib/keys.ts). Tabs by number and Ctrl+Tab are
 * fixed; per-view keys (J/K, S/U on files) live in their components.
 */
function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const s = useApp.getState()
      const ctrl = e.ctrlKey || e.metaKey
      const run = (fn: () => void): void => {
        e.preventDefault()
        fn()
      }
      if (s.dialog || s.paletteOpen) return
      if (ctrl && e.key === 'Tab') {
        const ids = ['home', ...s.tabs.map((t) => t.id)]
        const i = ids.indexOf(s.active)
        return run(() => act.setActive(ids[(i + (e.shiftKey ? -1 : 1) + ids.length) % ids.length]))
      }
      if (ctrl && /^[1-9]$/.test(e.key)) {
        const t = s.tabs[Number(e.key) - 1]
        if (t) return run(() => act.setActive(t.id))
      }
      const combo = comboOf(e)
      const id = combo && commandFor(combo, s.prefs.keymap, s.prefs.customCommands.map((c) => customKeyId(c.id)))
      if (!id || (notWhileTyping(id) && typingIn(e.target))) return
      // Not one that applies here (New branch with nothing checked out): the key does what it would anyway.
      const cmd = commandById(id)
      if (cmd) run(cmd.run)
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

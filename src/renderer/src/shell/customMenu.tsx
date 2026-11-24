import { SquareTerminal } from 'lucide-react'
import type { MenuEntry } from '@/ui'
import { useApp } from '@/store'
import * as act from '@/actions'
import { fitsMenu, parseCommand, type CommandContext, type MenuKind } from '@/lib/custom'

/** Your commands that run on this commit, branch or file, as a submenu at the end of its menu (none: nothing). */
export function customMenu(repoId: string, kind: MenuKind, ctx: CommandContext): MenuEntry[] {
  const also = (['commit', 'branch', 'file'] as const).filter((k) => k !== kind && ctx[k])
  const list = useApp.getState().prefs.customCommands.filter((c) => fitsMenu(parseCommand(c.command).needs, kind, also))
  if (!list.length) return []
  return [
    { type: 'separator' },
    {
      type: 'sub',
      label: 'Your commands',
      icon: <SquareTerminal size={14} />,
      items: list.map((c) => ({ type: 'item', label: c.name, onSelect: () => act.runCustomCommand(repoId, c.id, ctx) }))
    }
  ]
}

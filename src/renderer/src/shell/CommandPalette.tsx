import { useMemo, useState } from 'react'
import { Command } from 'cmdk'
import { Dialog as RDialog } from 'radix-ui'
import { useApp } from '@/store'
import { Shortcut } from '@/ui'
import { buildCommands, type Cmd } from './commands'

/** S12: every action, by keyboard. Branch names are commands too ("Check out …"). */
export function CommandPalette(): React.JSX.Element | null {
  const open = useApp((s) => s.paletteOpen)
  const active = useApp((s) => s.active)
  const refs = useApp((s) => (s.active !== 'home' ? s.repos[s.active]?.refs : undefined))
  const center = useApp((s) => (s.active !== 'home' ? s.repos[s.active]?.center : undefined))
  const focused = useApp((s) => (s.active !== 'home' ? (s.repos[s.active]?.refView.hidden.length ?? 0) + (s.repos[s.active]?.refView.soloed.length ?? 0) : 0))
  const filtered = useApp((s) => (s.active !== 'home' ? !!s.repos[s.active]?.filter : false))
  const selected = useApp((s) => (s.active !== 'home' ? s.repos[s.active]?.selected : null))
  const keymap = useApp((s) => s.prefs.keymap)
  const customCommands = useApp((s) => s.prefs.customCommands)
  const [query, setQuery] = useState('')
  const close = (): void => {
    useApp.setState({ paletteOpen: false })
    setQuery('')
  }

  const cmds: Cmd[] = useMemo(
    () => (open ? buildCommands(useApp.getState(), { branches: true }).filter((c) => !c.hidden) : []),
    // The list reads the whole store; these are the parts that change it.
    [open, active, refs, center, focused, filtered, selected, keymap, customCommands]
  )

  if (!open) return null
  const groups = [...new Set(cmds.map((c) => c.group))]
  return (
    <RDialog.Root open onOpenChange={(o) => !o && close()}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-(--gc-z-palette) bg-scrim/45" />
        <RDialog.Content aria-describedby={undefined} className="fixed top-[15%] left-1/2 z-(--gc-z-palette) w-(--gc-palette-w) max-w-[calc(100vw-(--spacing(8)))] -translate-x-1/2 overflow-hidden rounded-lg bg-surface-raised shadow-modal">
          <RDialog.Title className="sr-only">Command palette</RDialog.Title>
          <Command label="Command palette" loop>
            <Command.Input
              value={query}
              onValueChange={setQuery}
              autoFocus
              placeholder="Type a command or a branch name"
              className="h-11 w-full border-b border-border bg-transparent px-4 text-md text-text outline-none placeholder:text-muted"
            />
            <Command.List className="max-h-(--gc-palette-list-h) overflow-y-auto p-1">
              <Command.Empty className="px-3 py-6 text-center text-base text-muted">No matching commands</Command.Empty>
              {groups.map((g) => (
                <Command.Group key={g} heading={g} className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-muted">
                  {cmds
                    .filter((c) => c.group === g)
                    .map((c) => (
                      <Command.Item
                        key={c.id}
                        value={`${c.group} ${c.label}`}
                        onSelect={() => {
                          close()
                          c.run()
                        }}
                        className="flex h-8 cursor-default items-center justify-between gap-3 rounded-sm px-2 text-base text-text data-[selected=true]:bg-row-selected"
                      >
                        <span className="truncate">{c.label}</span>
                        {c.shortcut ? <Shortcut keys={c.shortcut} /> : null}
                      </Command.Item>
                    ))}
                </Command.Group>
              ))}
            </Command.List>
          </Command>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  )
}

// Keyboard shortcuts: the commands that can have one, their default keys, and the keys you've changed (Prefs.keymap).
import { useApp } from '@/store'

export type KeyGroup = 'Repository' | 'Moving around' | 'Tabs' | 'Other commands' | 'Your commands'

export interface KeyCommand {
  id: string
  group: KeyGroup
  label: string
  /** Out of the box. Redo has two. */
  keys: string[]
  /** Off while you type in a field, where the key means something already (Ctrl+Z undoes the typing). */
  notWhileTyping?: boolean
}

/** Ids match the commands in shell/commands.ts. Your own commands are `custom.<id>`, with no keys to start with. */
export const KEY_COMMANDS: KeyCommand[] = [
  { id: 'stage-commit', group: 'Repository', label: 'Stage all and commit', keys: ['Ctrl+Shift+Enter'] },
  { id: 'stage-all', group: 'Repository', label: 'Stage all', keys: ['Ctrl+Shift+S'] },
  { id: 'unstage-all', group: 'Repository', label: 'Unstage all', keys: ['Ctrl+Shift+U'] },
  { id: 'focus-summary', group: 'Repository', label: 'Focus the commit summary', keys: ['Ctrl+Shift+M'] },
  { id: 'new-branch', group: 'Repository', label: 'New branch', keys: ['Ctrl+B'] },
  { id: 'co-previous', group: 'Repository', label: 'Switch to the previous branch', keys: ['Ctrl+Shift+B'] },
  { id: 'fetch', group: 'Repository', label: 'Fetch all', keys: ['Ctrl+L'] },
  { id: 'undo', group: 'Repository', label: 'Undo', keys: ['Ctrl+Z'], notWhileTyping: true },
  { id: 'redo', group: 'Repository', label: 'Redo', keys: ['Ctrl+Y', 'Ctrl+Shift+Z'], notWhileTyping: true },
  { id: 'find', group: 'Moving around', label: 'Search commits, or find in the open file', keys: ['Ctrl+F'] },
  { id: 'filter-branches', group: 'Moving around', label: 'Filter branches', keys: ['Ctrl+Alt+F'] },
  { id: 'filter', group: 'Moving around', label: 'Filter the graph by path or author', keys: ['Ctrl+Shift+F'] },
  { id: 'palette', group: 'Moving around', label: 'Command palette', keys: ['Ctrl+P'] },
  { id: 'toggle-left', group: 'Moving around', label: 'Collapse or expand the branches panel', keys: ['Ctrl+J'] },
  { id: 'toggle-detail', group: 'Moving around', label: 'Collapse or expand the details panel', keys: ['Ctrl+K'] },
  { id: 'file-history', group: 'Moving around', label: 'File history (from a diff or blame)', keys: ['Ctrl+Shift+H'] },
  { id: 'home', group: 'Tabs', label: 'Repositories tab', keys: ['Ctrl+T'] },
  { id: 'close', group: 'Tabs', label: 'Close tab', keys: ['Ctrl+W'] },
  { id: 'open', group: 'Tabs', label: 'Open a folder', keys: ['Alt+O'] },
  { id: 'shortcuts', group: 'Tabs', label: 'Keyboard shortcuts', keys: ['Ctrl+/'] },
  { id: 'pull', group: 'Other commands', label: 'Pull', keys: [] },
  { id: 'pull-rebase', group: 'Other commands', label: 'Pull (rebase)', keys: [] },
  { id: 'push', group: 'Other commands', label: 'Push', keys: [] },
  { id: 'stash', group: 'Other commands', label: 'Stash changes…', keys: [] },
  { id: 'pop', group: 'Other commands', label: 'Pop the newest stash', keys: [] },
  { id: 'apply-patch', group: 'Other commands', label: 'Apply a patch…', keys: [] },
  { id: 'compare', group: 'Other commands', label: 'Compare two branches or commits…', keys: [] },
  { id: 'focus', group: 'Other commands', label: 'Focus on this branch (or show all)', keys: [] },
  { id: 'reflog', group: 'Other commands', label: 'Reflog', keys: [] },
  { id: 'log', group: 'Other commands', label: 'Git activity log', keys: [] },
  { id: 'settings', group: 'Other commands', label: 'Settings', keys: [] },
  { id: 'theme', group: 'Other commands', label: 'Switch light / dark theme', keys: [] },
  { id: 'open-terminal', group: 'Other commands', label: 'Open in terminal', keys: [] },
  { id: 'open-editor', group: 'Other commands', label: 'Open in editor', keys: [] },
  { id: 'open-folder', group: 'Other commands', label: 'Open in file manager', keys: [] }
]

export const customKeyId = (id: string): string => `custom.${id}`

/** Keys that keep their meaning: what they do isn't one of the commands above. */
const RESERVED: Record<string, string> = {
  'Ctrl+C': 'copying',
  'Ctrl+V': 'pasting',
  'Ctrl+X': 'cutting',
  'Ctrl+A': 'picking everything in a list or field',
  'Ctrl+Enter': 'committing',
  'Ctrl+Tab': 'the next tab',
  'Ctrl+Shift+Tab': 'the previous tab',
  'Ctrl+Shift+←': 'moving a tab left',
  'Ctrl+Shift+→': 'moving a tab right',
  'Ctrl+Home': 'the first commit',
  'Ctrl+End': 'the last commit',
  'Alt+F4': 'closing the window',
  ...Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`Ctrl+${i + 1}`, `tab ${i + 1}`]))
}

const MODIFIERS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'NumLock', 'Dead', 'Unidentified', 'Process'])
const NAMED: Record<string, string> = { ' ': 'Space', '+': 'Plus', Escape: 'Esc', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' }

/** "Ctrl+Shift+S": Ctrl (Cmd on a Mac), Alt, Shift, then the key. Null for a modifier on its own. */
export function comboOf(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): string | null {
  if (MODIFIERS.has(e.key)) return null
  const key = NAMED[e.key] ?? (e.key.length === 1 ? e.key.toUpperCase() : e.key)
  return [e.ctrlKey || e.metaKey ? 'Ctrl' : '', e.altKey ? 'Alt' : '', e.shiftKey ? 'Shift' : '', key].filter(Boolean).join('+')
}

const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

/** Why a key can't be a shortcut, or null when it can. */
export function comboProblem(combo: string): string | null {
  const reserved = Object.entries(RESERVED).find(([k]) => same(k, combo))
  if (reserved) return `${combo} is kept for ${reserved[1]}.`
  const parts = combo.split('+')
  const key = parts[parts.length - 1]
  if (/^F([1-9]|1[0-2])$/.test(key)) return null
  if (!parts.includes('Ctrl') && !parts.includes('Alt')) return 'Use Ctrl or Alt with it (or a key from F1 to F12): keys on their own are for typing and moving through lists.'
  return null
}

/** The keys a command answers to now: yours if you changed them ('' for none), else its defaults. */
export function keysOf(id: string, keymap: Record<string, string>): string[] {
  const mine = keymap[id]
  if (mine !== undefined) return mine ? [mine] : []
  return KEY_COMMANDS.find((c) => c.id === id)?.keys ?? []
}

/** The command a key runs, among the built-in ones and `customIds` (custom.<id>). */
export function commandFor(combo: string, keymap: Record<string, string>, customIds: string[]): string | null {
  for (const id of [...KEY_COMMANDS.map((c) => c.id), ...customIds]) if (keysOf(id, keymap).some((k) => same(k, combo))) return id
  return null
}

export const notWhileTyping = (id: string): boolean => !!KEY_COMMANDS.find((c) => c.id === id)?.notWhileTyping

/** The first key of a command, for menus and tooltips built outside React. */
export function keyFor(id: string): string | undefined {
  return keysOf(id, useApp.getState().prefs.keymap)[0]
}

export function useKey(id: string): string | undefined {
  return useApp((s) => keysOf(id, s.prefs.keymap)[0])
}

/** For a component showing several commands' keys: re-renders when any shortcut changes. */
export function useKeyOf(): (id: string) => string | undefined {
  const keymap = useApp((s) => s.prefs.keymap)
  return (id) => keysOf(id, keymap)[0]
}

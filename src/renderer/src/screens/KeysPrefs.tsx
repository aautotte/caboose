import { useEffect, useState } from 'react'
import { Pencil, Plus, RotateCcw, Trash2, X } from 'lucide-react'
import { Button, IconButton, Shortcut } from '@/ui'
import { setPrefs, useApp } from '@/store'
import * as act from '@/actions'
import { parseCommand, whereShown } from '@/lib/custom'
import { KEY_COMMANDS, comboOf, comboProblem, commandFor, customKeyId, keysOf, type KeyGroup } from '@/lib/keys'
import { Group } from './PrefsView'

/** Settings › Your commands: git commands of your own, for the menus, the palette and shortcuts. */
export function CommandsGroup(): React.JSX.Element {
  const list = useApp((s) => s.prefs.customCommands)
  return (
    <Group id="commands" title="Your commands" note="Git commands of your own. They run in the repository’s folder without a shell, and Undo can’t take back what they do.">
      {list.length ? (
        <ul aria-label="Your commands" className="flex flex-col">
          {list.map((c) => (
            <li key={c.id} className="flex items-start justify-between gap-3 border-b border-border py-3">
              <div className="min-w-0 flex-1">
                <p className="text-base font-medium text-text">{c.name}</p>
                <p className="font-mono text-code break-all text-muted">git {c.command}</p>
                <p className="text-sm text-muted">{whereShown(parseCommand(c.command).needs)}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <IconButton size="sm" label={`Change ${c.name}`} onClick={() => act.openDialog({ kind: 'editCommand', commandId: c.id })}>
                  <Pencil size={14} />
                </IconButton>
                <IconButton size="sm" label={`Delete ${c.name}`} onClick={() => act.deleteCustomCommand(c.id)}>
                  <Trash2 size={14} />
                </IconButton>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-3 text-base text-muted">None yet. A command can ask for a value, and run on the commit, branch or file you right-click.</p>
      )}
      <div className="pt-3">
        <Button size="sm" icon={<Plus size={14} />} onClick={() => act.openDialog({ kind: 'editCommand' })}>
          New command…
        </Button>
      </div>
    </Group>
  )
}

const GROUPS: KeyGroup[] = ['Repository', 'Moving around', 'Tabs', 'Other commands', 'Your commands']

/** Settings › Keyboard shortcuts: change, remove or put back the key of any command here. */
export function ShortcutsGroup(): React.JSX.Element {
  const keymap = useApp((s) => s.prefs.keymap)
  const customs = useApp((s) => s.prefs.customCommands)
  const rows = [...KEY_COMMANDS.map((c) => ({ id: c.id, group: c.group, label: c.label })), ...customs.map((c) => ({ id: customKeyId(c.id), group: 'Your commands' as const, label: c.name }))]
  return (
    <Group id="shortcuts" title="Keyboard shortcuts" note="Click Change, then press the keys you want, with Ctrl or Alt (or a key from F1 to F12). Esc leaves it as it was. On a Mac, Cmd counts as Ctrl.">
      {GROUPS.map((g) => {
        const here = rows.filter((r) => r.group === g)
        if (!here.length) return null
        return (
          <div key={g} role="group" aria-labelledby={`keys-${g.replace(/\s+/g, '-')}`} className="pt-3">
            <h4 id={`keys-${g.replace(/\s+/g, '-')}`} className="text-sm font-medium text-muted">
              {g}
            </h4>
            <ul>
              {here.map((r) => (
                <KeyRow key={r.id} id={r.id} label={r.label} />
              ))}
            </ul>
          </div>
        )
      })}
      {Object.keys(keymap).length ? (
        <div className="pt-3">
          <Button size="sm" icon={<RotateCcw size={14} />} onClick={() => setPrefs({ keymap: {} })}>
            Put every shortcut back
          </Button>
        </div>
      ) : null}
    </Group>
  )
}

const sameKeys = (a: string[], b: string[]): boolean => a.length === b.length && a.every((k, i) => k.toLowerCase() === b[i].toLowerCase())

/** The keymap with `id` answering to `keys`; a command back on its defaults has no entry. */
function withKeys(keymap: Record<string, string>, id: string, keys: string[]): Record<string, string> {
  const { [id]: _, ...rest } = keymap
  return sameKeys(keys, keysOf(id, {})) ? rest : { ...rest, [id]: keys[0] ?? '' }
}

function labelOf(id: string): string {
  return KEY_COMMANDS.find((c) => c.id === id)?.label ?? useApp.getState().prefs.customCommands.find((c) => customKeyId(c.id) === id)?.name ?? id
}

function KeyRow({ id, label }: { id: string; label: string }): React.JSX.Element {
  const keymap = useApp((s) => s.prefs.keymap)
  const keys = keysOf(id, keymap)
  const defaults = keysOf(id, {})
  const [recording, setRecording] = useState(false)
  const [note, setNote] = useState<{ text: string; take?: { combo: string; from: string } } | null>(null)

  const assign = (combo: string, from?: string): void => {
    let next = withKeys(useApp.getState().prefs.keymap, id, [combo])
    if (from) next = withKeys(next, from, keysOf(from, next).filter((k) => k.toLowerCase() !== combo.toLowerCase()))
    setPrefs({ keymap: next })
    setNote(null)
  }

  useEffect(() => {
    if (!recording) return
    // Ahead of everything else (capture): while it listens, a key is an answer, not a command.
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Tab' && !e.ctrlKey && !e.altKey) return setRecording(false)
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
        setNote(null)
        return setRecording(false)
      }
      const combo = comboOf(e)
      if (!combo) return
      const problem = comboProblem(combo)
      if (problem) return setNote({ text: problem })
      const s = useApp.getState().prefs
      const other = commandFor(combo, s.keymap, s.customCommands.map((c) => customKeyId(c.id)))
      setRecording(false)
      if (other && other !== id) return setNote({ text: `${combo} is the shortcut for ${labelOf(other)}.`, take: { combo, from: other } })
      assign(combo)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [recording])

  return (
    <li aria-label={label} className="border-b border-border py-1.5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <span className="min-w-0 flex-1 basis-40 text-base text-text">{label}</span>
        <div className="flex items-center gap-1">
          <span data-keys className="inline-flex items-center gap-1 px-1">
            {keys.length ? (
              keys.map((k, i) => (
                <span key={k} className="inline-flex items-center gap-1">
                  {i ? <span className="text-sm text-muted">or</span> : null}
                  <Shortcut keys={k} />
                </span>
              ))
            ) : (
              <span className="text-sm text-muted">None</span>
            )}
          </span>
          <Button
            size="sm"
            aria-label={recording ? `Press the keys for ${label}` : `Change the shortcut for ${label}`}
            aria-pressed={recording}
            onClick={() => {
              setNote(null)
              setRecording((r) => !r)
            }}
            onBlur={() => setRecording(false)}
          >
            {recording ? 'Press the keys' : 'Change'}
          </Button>
          {keys.length && !recording ? (
            <IconButton size="sm" label={`Remove the shortcut for ${label}`} onClick={() => setPrefs({ keymap: withKeys(keymap, id, []) })}>
              <X size={14} />
            </IconButton>
          ) : null}
          {!sameKeys(keys, defaults) && !recording ? (
            <IconButton size="sm" label={`Put back ${defaults.length ? defaults.join(' or ') : 'no shortcut'} for ${label}`} onClick={() => setPrefs({ keymap: withKeys(keymap, id, defaults) })}>
              <RotateCcw size={14} />
            </IconButton>
          ) : null}
        </div>
      </div>
      {note ? (
        <div role="alert" className="flex flex-wrap items-center justify-end gap-2 pt-1 text-sm text-warning">
          <span>{note.text}</span>
          {note.take ? (
            <>
              <Button size="sm" onClick={() => assign(note.take!.combo, note.take!.from)}>
                Use it here instead
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setNote(null)}>
                Keep it there
              </Button>
            </>
          ) : null}
        </div>
      ) : null}
    </li>
  )
}

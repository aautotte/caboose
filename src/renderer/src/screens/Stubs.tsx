import { Construction } from 'lucide-react'
import { Button, Dialog, EmptyState, Shortcut } from '@/ui'
import * as act from '@/actions'
import { useApp } from '@/store'
import { KEY_COMMANDS, customKeyId, keysOf } from '@/lib/keys'

/** Placeholder for a screen that's routed but not built yet. Says so plainly. */
export function NotYet({ screen, title, body, onClose }: { screen: string; title: string; body: string; onClose?: () => void }): React.JSX.Element {
  return (
    <div className="grid flex-1 place-items-center">
      <EmptyState
        icon={Construction}
        title={`${title} (${screen}) isn’t built yet`}
        body={body}
        actions={onClose ? <Button onClick={onClose}>Back to the graph</Button> : undefined}
      />
    </div>
  )
}

/** A row's keys: fixed ones as written, or a command whose keys can be changed (Settings › Keyboard shortcuts). */
type SheetKeys = string | { id: string }

export const shortcutGroups: Array<{ title: string; items: Array<[string, SheetKeys]> }> = [
  {
    title: 'Repository',
    items: [
      ['Stage all and commit', { id: 'stage-commit' }],
      ['Commit staged files', 'Ctrl+Enter'],
      ['Stage all', { id: 'stage-all' }],
      ['Unstage all', { id: 'unstage-all' }],
      ['Focus the commit summary', { id: 'focus-summary' }],
      ['New branch', { id: 'new-branch' }],
      ['Switch to the previous branch', { id: 'co-previous' }],
      ['Fetch all', { id: 'fetch' }],
      ['Undo', { id: 'undo' }],
      ['Redo', { id: 'redo' }]
    ]
  },
  {
    title: 'Moving around',
    items: [
      ['Next / previous commit', 'J / K'],
      ['First / last commit', 'Ctrl+Home / Ctrl+End'],
      ['Search commits', { id: 'find' }],
      ['Find in the open file', { id: 'find' }],
      ['Filter branches', { id: 'filter-branches' }],
      ['Filter the graph by path or author', { id: 'filter' }],
      ['Command palette', { id: 'palette' }],
      ['Collapse or expand the branches panel', { id: 'toggle-left' }],
      ['Collapse or expand the details panel', { id: 'toggle-detail' }],
      ['File history (from a diff or blame)', { id: 'file-history' }],
      ['Close the current view', 'Esc']
    ]
  },
  {
    title: 'Tabs',
    items: [
      ['Repositories tab', { id: 'home' }],
      ['Close tab', { id: 'close' }],
      ['Go to tab 1–9', 'Ctrl+1…9'],
      ['Next / previous tab', 'Ctrl+Tab / Ctrl+Shift+Tab'],
      ['Open a folder', { id: 'open' }],
      ['This list', { id: 'shortcuts' }]
    ]
  }
]

/** S14 */
export function ShortcutSheet(): React.JSX.Element {
  const keymap = useApp((s) => s.prefs.keymap)
  const customs = useApp((s) => s.prefs.customCommands)
  const repoId = useApp((s) => (s.active !== 'home' ? s.active : null))
  const keysText = (k: SheetKeys): string => (typeof k === 'string' ? k : keysOf(k.id, keymap).join(' / '))
  // Commands you gave a shortcut that have none out of the box, and your own.
  const extra: Array<[string, SheetKeys]> = [
    ...KEY_COMMANDS.filter((c) => c.group === 'Other commands').map((c): [string, SheetKeys] => [c.label, { id: c.id }]),
    ...customs.map((c): [string, SheetKeys] => [c.name, { id: customKeyId(c.id) }])
  ]
  const groups = [...shortcutGroups, { title: 'Others you set', items: extra }]
    .map((g) => ({ ...g, items: g.items.map(([label, k]) => [label, keysText(k)] as const).filter(([, k]) => k) }))
    .filter((g) => g.items.length)
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && act.closeDialog()}
      title="Keyboard shortcuts"
      footer={
        <>
          {repoId ? (
            <Button
              onClick={() => {
                act.closeDialog()
                act.setCenter(repoId, { kind: 'prefs' })
                setTimeout(() => document.getElementById('prefs-shortcuts')?.scrollIntoView({ block: 'start' }), 50)
              }}
            >
              Change shortcuts…
            </Button>
          ) : null}
          <Button onClick={() => act.closeDialog()}>Close</Button>
        </>
      }
    >
      <div tabIndex={0} aria-label="Shortcuts" role="group" className="grid max-h-[60vh] grid-cols-1 gap-4 overflow-y-auto outline-none focus-visible:outline-2 focus-visible:outline-focus-ring">
        {groups.map((g) => (
          <section key={g.title} aria-label={g.title}>
            <h3 className="mb-1 text-sm font-medium text-muted">{g.title}</h3>
            <table className="w-full text-base">
              <tbody>
                {g.items.map(([label, keys]) => (
                  <tr key={label} className="border-b border-border last:border-0">
                    <td className="py-1 text-text">{label}</td>
                    <td className="py-1 text-right">
                      {keys.split(' / ').map((k, i) => (
                        <span key={k}>
                          {i ? <span className="px-1 text-muted">/</span> : null}
                          <Shortcut keys={k} />
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>
    </Dialog>
  )
}

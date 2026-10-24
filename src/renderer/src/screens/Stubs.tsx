import { Construction } from 'lucide-react'
import { Button, Dialog, EmptyState, Shortcut } from '@/ui'
import * as act from '@/actions'

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

export const shortcutGroups: Array<{ title: string; items: Array<[string, string]> }> = [
  {
    title: 'Repository',
    items: [
      ['Stage all and commit', 'Ctrl+Shift+Enter'],
      ['Commit staged files', 'Ctrl+Enter'],
      ['Stage all', 'Ctrl+Shift+S'],
      ['Unstage all', 'Ctrl+Shift+U'],
      ['Focus the commit summary', 'Ctrl+Shift+M'],
      ['New branch', 'Ctrl+B'],
      ['Fetch all', 'Ctrl+L'],
      ['Undo', 'Ctrl+Z'],
      ['Redo', 'Ctrl+Y']
    ]
  },
  {
    title: 'Moving around',
    items: [
      ['Next / previous commit', 'J / K'],
      ['First / last commit', 'Ctrl+Home / Ctrl+End'],
      ['Search commits', 'Ctrl+F'],
      ['Filter branches', 'Ctrl+Alt+F'],
      ['Command palette', 'Ctrl+P'],
      ['Toggle the left panel', 'Ctrl+J'],
      ['Toggle the details panel', 'Ctrl+K'],
      ['File history (from a diff or blame)', 'Ctrl+Shift+H'],
      ['Close the current view', 'Esc']
    ]
  },
  {
    title: 'Tabs',
    items: [
      ['Repositories tab', 'Ctrl+T'],
      ['Close tab', 'Ctrl+W'],
      ['Go to tab 1–9', 'Ctrl+1…9'],
      ['Next / previous tab', 'Ctrl+Tab / Ctrl+Shift+Tab'],
      ['Open a folder', 'Alt+O'],
      ['This list', 'Ctrl+/']
    ]
  }
]

/** S14 */
export function ShortcutSheet(): React.JSX.Element {
  return (
    <Dialog open onOpenChange={(o) => !o && act.closeDialog()} title="Keyboard shortcuts" footer={<Button onClick={() => act.closeDialog()}>Close</Button>}>
      <div tabIndex={0} aria-label="Shortcuts" role="group" className="grid max-h-[60vh] grid-cols-1 gap-4 overflow-y-auto outline-none focus-visible:outline-2 focus-visible:outline-focus-ring">
        {shortcutGroups.map((g) => (
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

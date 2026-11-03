import { useEffect, useState } from 'react'
import type { CleanPreview } from '../../../shared/types'
import { Button, Checkbox, Dialog } from '@/ui'
import { call } from '@/lib/api'
import { plural } from '@/lib/format'
import { type Dialog as D } from '@/store'
import * as act from '@/actions'

const close = (): void => act.closeDialog()
const SHOWN = 8

/**
 * Clean up the working tree: throw away changes to tracked files (reset --hard), untracked files (git clean), and
 * ignored ones too if asked. Everything is put aside first, so undo brings it back. `untrackedOnly` starts with
 * just the untracked files ticked.
 */
export function CleanDialog({ d }: { d: Extract<D, { kind: 'clean' }> }): React.JSX.Element {
  const [preview, setPreview] = useState<CleanPreview | null>(null)
  const [tracked, setTracked] = useState(!d.untrackedOnly)
  const [untracked, setUntracked] = useState(true)
  const [ignored, setIgnored] = useState(false)
  useEffect(() => {
    let live = true
    call('worktree.cleanPreview', { repoId: d.repoId })
      .then((p) => live && setPreview(p))
      .catch(act.fail)
    return () => {
      live = false
    }
  }, [d.repoId])
  const picked = preview ? [...(tracked ? preview.tracked : []), ...(untracked ? preview.untracked : []), ...(ignored ? preview.ignored : [])] : []
  const ready = !!picked.length && !preview?.conflicted
  const submit = (): void => {
    if (!ready) return
    close()
    void act.clean(d.repoId, { tracked, untracked, ignored })
  }
  const count = (list: string[] | undefined): string => (list ? ` (${list.length})` : '')
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && close()}
      title="Clean up the working tree"
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="danger" disabled={!ready} onClick={submit}>
            {picked.length ? `Remove ${plural(picked.length, 'item')}` : 'Remove'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm text-muted">What goes</legend>
          <Checkbox label={`Changes to tracked files${count(preview?.tracked)}`} checked={tracked} disabled={!preview?.tracked.length} onCheckedChange={setTracked} />
          <Checkbox label={`Untracked files${count(preview?.untracked)}`} checked={untracked} disabled={!preview?.untracked.length} onCheckedChange={setUntracked} />
          <Checkbox label={`Ignored files${count(preview?.ignored)}`} checked={ignored} disabled={!preview?.ignored.length} onCheckedChange={setIgnored} />
        </fieldset>
        {ignored ? <p className="text-sm text-muted">Ignored files are build output, dependencies and local settings, as .gitignore says. They’re copied for undo too, which takes a while for a big folder like node_modules.</p> : null}
        {picked.length ? (
          <ul aria-label="To remove" className="max-h-40 overflow-y-auto rounded-md border border-border bg-surface-sunken px-3 py-2 font-mono text-sm text-text">
            {picked.slice(0, SHOWN).map((p) => (
              <li key={p} className="truncate">
                {p}
              </li>
            ))}
            {picked.length > SHOWN ? <li className="font-sans text-muted">and {plural(picked.length - SHOWN, 'more')}</li> : null}
          </ul>
        ) : preview ? (
          <p className="text-base text-muted">Nothing to remove.</p>
        ) : null}
        {preview?.conflicted ? (
          <p role="alert" className="text-sm text-danger">
            Resolve the conflicts, or abort, first.
          </p>
        ) : (
          <p className="text-sm text-muted">Caboose keeps a copy first, so Undo brings it all back.</p>
        )}
      </div>
    </Dialog>
  )
}

import { useEffect, useMemo, useState } from 'react'
import type { RebasePreview } from '../../../shared/types'
import { Button, Checkbox, Dialog, Field, TextInput } from '@/ui'
import { call } from '@/lib/api'
import { plural } from '@/lib/format'
import { useApp, type Dialog as D } from '@/store'
import { stackedLabel } from '@/history/RebaseView'
import * as act from '@/actions'

const close = (): void => act.closeDialog()

/**
 * Moves the commits after one (on the checked-out branch) onto another branch: git rebase --onto. For a branch
 * started from another feature branch that has since been merged or rewritten: only its own commits go.
 */
export function RebaseFromDialog({ d }: { d: Extract<D, { kind: 'rebaseFrom' }> }): React.JSX.Element {
  const refs = useApp((s) => s.repos[d.repoId]?.refs)
  const status = useApp((s) => s.repos[d.repoId]?.status)
  const names = useMemo(() => refs?.refs.filter((r) => r.kind !== 'tag' && !r.isHead).map((r) => r.short) ?? [], [refs])
  const [onto, setOnto] = useState('')
  const [preview, setPreview] = useState<RebasePreview | null>(null)
  const [moveStacked, setMoveStacked] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let live = true
    call('rebase.preview', { repoId: d.repoId, onto: d.from })
      .then((p) => {
        if (!live) return
        setPreview(p)
        setMoveStacked(p.updateRefs)
      })
      .catch(act.fail)
    return () => {
      live = false
    }
  }, [d.repoId, d.from])
  const branch = refs?.head.branch ?? 'HEAD'
  const target = onto.trim()
  const dirty = (status?.changes ?? []).some((c) => c.worktree !== '?' || c.index !== '.')
  const problem = target && (/\s/.test(target) || target.startsWith('-')) ? 'A branch, tag or commit SHA.' : undefined
  const ready = !!target && !problem && !dirty && !!preview?.rows.length && !busy
  const submit = async (): Promise<void> => {
    if (!ready) return
    setBusy(true)
    const ok = await act.rebaseFrom(d.repoId, d.from, target, moveStacked && !!preview?.stacked.length)
    setBusy(false)
    if (ok) close()
  }
  const n = preview?.rows.length ?? 0
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && close()}
      title={`Move ${branch}’s commits after ${d.fromLabel}`}
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" disabled={!ready} loading={busy} onClick={() => void submit()}>
            Rebase
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <p className="text-base text-muted">
          {preview
            ? n
              ? `The ${plural(n, 'commit')} after ${d.fromLabel} on ${branch} are replayed onto the branch you pick. ${d.fromLabel} and what came before it stay behind. Undo puts ${branch} back.`
              : `${branch} has no commits after ${d.fromLabel}.`
            : 'Counting the commits…'}
        </p>
        <Field label="Onto" error={problem} help="A branch, tag or commit SHA.">
          {(f) => <TextInput {...f} autoFocus list="rebase-from-refs" value={onto} onChange={(e) => setOnto(e.target.value)} />}
        </Field>
        <datalist id="rebase-from-refs">
          {names.slice(0, 1000).map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
        {preview?.stacked.length ? (
          <Checkbox label={`Move ${stackedLabel(preview.stacked.map((b) => b.name))} along`} checked={moveStacked} onCheckedChange={setMoveStacked} />
        ) : null}
        {dirty ? (
          <p role="alert" className="text-sm text-danger">
            Commit or stash your changes first.
          </p>
        ) : null}
        <button type="submit" hidden />
      </form>
    </Dialog>
  )
}

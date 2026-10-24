import { useMemo, useState } from 'react'
import { Button, ConfirmDialog, Dialog, Field, Select, Switch, TextInput } from '@/ui'
import { useApp, type Dialog as D } from '@/store'
import * as act from '@/actions'
import { CloneDialog, InitDialog } from '@/home/RepoDialogs'
import { ShortcutSheet } from '@/screens/Stubs'
import { ProfilesDialog } from './ProfilesDialog'
import { AddRemoteDialog, CreateTagDialog, GroupNameDialog, IgnoreDialog, RenameStashDialog, ResetDialog, SquashDialog, StashDialog, UpstreamDialog } from './MoreDialogs'

/** Renders whichever dialog is open (S02, S03, S14, S15). */
export function DialogHost(): React.JSX.Element | null {
  const d = useApp((s) => s.dialog)
  if (!d) return null
  switch (d.kind) {
    case 'clone':
      return <CloneDialog />
    case 'init':
      return <InitDialog />
    case 'createBranch':
      return <CreateBranchDialog d={d} />
    case 'renameBranch':
      return <RenameBranchDialog d={d} />
    case 'publish':
      return <PublishDialog d={d} />
    case 'shortcuts':
      return <ShortcutSheet />
    case 'stash':
      return <StashDialog d={d} />
    case 'createTag':
      return <CreateTagDialog d={d} />
    case 'addRemote':
      return <AddRemoteDialog d={d} />
    case 'reset':
      return <ResetDialog d={d} />
    case 'ignore':
      return <IgnoreDialog d={d} />
    case 'upstream':
      return <UpstreamDialog d={d} />
    case 'renameStash':
      return <RenameStashDialog d={d} />
    case 'groupName':
      return <GroupNameDialog d={d} />
    case 'squash':
      return <SquashDialog d={d} />
    case 'profiles':
      return <ProfilesDialog d={d} />
    case 'confirm':
      return (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && act.closeDialog()}
          title={d.title}
          body={d.body}
          confirmLabel={d.confirmLabel}
          danger={d.danger}
          undoable={d.undoable}
          onConfirm={d.onConfirm}
        />
      )
  }
}

function branchNameProblem(name: string, existing: string[]): string | undefined {
  if (!name) return undefined
  if (/\s/.test(name)) return 'Use dashes or slashes instead of spaces.'
  if (/\.\.|[~^:?*[\\]|@\{|^-|\/$|\.lock$|^\/|\/\//.test(name)) return 'That name has characters Git doesn’t allow in branch names.'
  if (existing.includes(name)) return 'A branch with that name already exists.'
  return undefined
}

function CreateBranchDialog({ d }: { d: Extract<D, { kind: 'createBranch' }> }): React.JSX.Element {
  const [name, setName] = useState('')
  const [checkout, setCheckout] = useState(true)
  const [busy, setBusy] = useState(false)
  const refs = useApp((s) => s.repos[d.repoId]?.refs)
  const existing = useMemo(() => refs?.refs.filter((r) => r.kind === 'local').map((r) => r.short) ?? [], [refs])
  const problem = branchNameProblem(name.trim(), existing)
  const submit = async (): Promise<void> => {
    if (!name.trim() || problem) return
    setBusy(true)
    const ok = await act.createBranch(d.repoId, name.trim(), d.at, checkout)
    setBusy(false)
    if (ok) act.closeDialog()
  }
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && act.closeDialog()}
      title="New branch"
      footer={
        <>
          <Button onClick={() => act.closeDialog()}>Cancel</Button>
          <Button variant="primary" disabled={!name.trim() || !!problem} loading={busy} onClick={() => void submit()}>
            Create branch
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
        <Field label="Branch name" error={problem} help={`Starts from ${d.atLabel}`}>
          {(p) => <TextInput {...p} autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="feature/short-description" />}
        </Field>
        <Switch label="Switch to it now" checked={checkout} onCheckedChange={setCheckout} />
        <button type="submit" hidden />
      </form>
    </Dialog>
  )
}

function RenameBranchDialog({ d }: { d: Extract<D, { kind: 'renameBranch' }> }): React.JSX.Element {
  const [name, setName] = useState(d.name)
  const refs = useApp((s) => s.repos[d.repoId]?.refs)
  const existing = useMemo(() => refs?.refs.filter((r) => r.kind === 'local' && r.short !== d.name).map((r) => r.short) ?? [], [refs, d.name])
  const problem = branchNameProblem(name.trim(), existing)
  const submit = async (): Promise<void> => {
    if (!name.trim() || problem || name.trim() === d.name) return
    if (await act.renameBranch(d.repoId, d.name, name.trim())) act.closeDialog()
  }
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && act.closeDialog()}
      title={`Rename ${d.name}`}
      footer={
        <>
          <Button onClick={() => act.closeDialog()}>Cancel</Button>
          <Button variant="primary" disabled={!name.trim() || !!problem || name.trim() === d.name} onClick={() => void submit()}>
            Rename
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <Field label="New name" error={problem}>
          {(p) => <TextInput {...p} autoFocus value={name} onFocus={(e) => e.target.select()} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <button type="submit" hidden />
      </form>
    </Dialog>
  )
}

/** S15: pushing a branch that has no remote branch yet. */
function PublishDialog({ d }: { d: Extract<D, { kind: 'publish' }> }): React.JSX.Element {
  const remotes = useApp((s) => s.repos[d.repoId]?.refs?.remotes) ?? []
  const [remote, setRemote] = useState(remotes.includes('origin') ? 'origin' : (remotes[0] ?? ''))
  const submit = (): void => {
    act.closeDialog()
    void act.push(d.repoId, { setUpstream: true, remote, branch: d.branch })
  }
  if (!remotes.length) {
    return (
      <Dialog
        open
        onOpenChange={(o) => !o && act.closeDialog()}
        title="No remote to push to"
        footer={
          <>
            <Button onClick={() => act.closeDialog()}>Cancel</Button>
            <Button variant="primary" onClick={() => act.openDialog({ kind: 'addRemote', repoId: d.repoId })}>
              Add a remote…
            </Button>
          </>
        }
      >
        <p className="text-base text-text">This repository doesn’t have a remote yet. Add one, then push again.</p>
      </Dialog>
    )
  }
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && act.closeDialog()}
      title={`Publish ${d.branch}`}
      footer={
        <>
          <Button onClick={() => act.closeDialog()}>Cancel</Button>
          <Button variant="primary" onClick={submit}>
            Publish branch
          </Button>
        </>
      }
    >
      <p className="text-base text-text">
        {d.branch} isn’t on a remote yet. Publishing creates <span className="font-mono text-sm">{remote}/{d.branch}</span> and links your branch to it, so
        later pushes and pulls just work.
      </p>
      {remotes.length > 1 ? (
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted">Remote</span>
          <Select label="Remote" value={remote} onValueChange={setRemote} options={remotes.map((r) => ({ value: r, label: r }))} />
        </div>
      ) : null}
    </Dialog>
  )
}

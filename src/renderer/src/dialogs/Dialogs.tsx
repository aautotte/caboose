import { useEffect, useMemo, useState } from 'react'
import { Button, ConfirmDialog, Dialog, Field, Select, Switch, TextInput } from '@/ui'
import { useApp, type Dialog as D } from '@/store'
import * as act from '@/actions'
import { call } from '@/lib/api'
import { CloneDialog, FolderField, InitDialog } from '@/home/RepoDialogs'
import { ShortcutSheet } from '@/screens/Stubs'
import { ProfilesDialog } from './ProfilesDialog'
import { AddRemoteDialog, AddSubmoduleDialog, SubmoduleUrlDialog, CompareDialog, BisectDialog, BisectRunDialog, CreateTagDialog, GroupNameDialog, RenameStashDialog, ResetDialog, SquashDialog, StashDialog, UpstreamDialog, PatchCommitDialog } from './MoreDialogs'

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
    case 'upstream':
      return <UpstreamDialog d={d} />
    case 'renameStash':
      return <RenameStashDialog d={d} />
    case 'groupName':
      return <GroupNameDialog d={d} />
    case 'squash':
      return <SquashDialog d={d} />
    case 'bisect':
      return <BisectDialog d={d} />
    case 'bisectRun':
      return <BisectRunDialog d={d} />
    case 'profiles':
      return <ProfilesDialog d={d} />
    case 'addWorktree':
      return <AddWorktreeDialog d={d} />
    case 'addSubmodule':
      return <AddSubmoduleDialog d={d} />
    case 'submoduleUrl':
      return <SubmoduleUrlDialog d={d} />
    case 'compare':
      return <CompareDialog d={d} />
    case 'patchCommit':
      return <PatchCommitDialog d={d} />
    case 'confirm':
      return (
        <ConfirmDialog
          // A new question starts with its checkbox off.
          key={d.title}
          open
          onOpenChange={(o) => !o && act.closeDialog()}
          title={d.title}
          body={d.body}
          confirmLabel={d.confirmLabel}
          danger={d.danger}
          undoable={d.undoable}
          onConfirm={d.onConfirm}
          alt={d.alt}
          check={d.check}
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

type WtMode = 'existing' | 'new' | 'detached'

/**
 * A new worktree: a folder of its own with a branch checked out, so two branches can be worked on side by side.
 * From a branch's menu it checks out that branch; from a remote branch, a new local one tracking it; from a commit
 * or the section header, a new branch (or no branch) starting there.
 */
function AddWorktreeDialog({ d }: { d: Extract<D, { kind: 'addWorktree' }> }): React.JSX.Element {
  const refs = useApp((s) => s.repos[d.repoId]?.refs)
  const locals = useMemo(() => refs?.refs.filter((r) => r.kind === 'local') ?? [], [refs])
  // A branch can be checked out in one worktree at a time: this one's and other worktrees' branches are taken.
  const free = useMemo(() => locals.filter((r) => !r.isHead && !r.worktree).map((r) => r.short), [locals])
  const remoteName = d.remote ? d.remote.slice((refs?.refs.find((r) => r.kind === 'remote' && r.short === d.remote)?.remote?.length ?? 0) + 1) : ''
  const headLabel = refs?.head.branch ?? refs?.head.sha?.slice(0, 7) ?? 'HEAD'
  const startLabel = d.remote ?? d.atLabel ?? headLabel
  const [mode, setMode] = useState<WtMode>(d.branch ? 'existing' : 'new')
  const [branch, setBranch] = useState(d.branch ?? '')
  const [name, setName] = useState(remoteName)
  const [path, setPath] = useState('')
  const [pathEdited, setPathEdited] = useState(false)
  const [openAfter, setOpenAfter] = useState(true)
  const [busy, setBusy] = useState(false)

  const nameProblem = mode === 'new' ? branchNameProblem(name.trim(), locals.map((r) => r.short)) : undefined
  const branchProblem =
    mode === 'existing' && branch.trim() && !free.includes(branch.trim())
      ? locals.some((r) => r.short === branch.trim())
        ? `${branch.trim()} is already checked out${locals.find((r) => r.short === branch.trim())?.isHead ? ' here' : ' in another worktree'}.`
        : 'There’s no local branch with that name.'
      : undefined
  // The folder follows the branch name until the user types or picks one.
  const forName = mode === 'existing' ? branch.trim() : mode === 'new' ? name.trim() : startLabel
  useEffect(() => {
    if (pathEdited) return
    let live = true
    const t = setTimeout(() => {
      void call('worktrees.suggestPath', { repoId: d.repoId, branch: forName || 'worktree' })
        .then((p) => live && setPath(p))
        .catch(() => {})
    }, 150)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [d.repoId, forName, pathEdited])

  const ready = !!path.trim() && (mode === 'existing' ? !!branch.trim() && !branchProblem : mode === 'new' ? !!name.trim() && !nameProblem : true)
  const submit = async (): Promise<void> => {
    if (!ready || busy) return
    setBusy(true)
    const at = d.remote ?? d.at
    const input =
      mode === 'existing' ? { path: path.trim(), branch: branch.trim() } : mode === 'new' ? { path: path.trim(), newBranch: name.trim(), at, track: !!d.remote } : { path: path.trim(), at }
    const ok = await act.addWorktree(d.repoId, input, openAfter)
    setBusy(false)
    if (ok) act.closeDialog()
  }
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !busy && act.closeDialog()}
      title="New worktree"
      footer={
        <>
          <Button disabled={busy} onClick={() => act.closeDialog()}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!ready} loading={busy} onClick={() => void submit()}>
            Create worktree
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
        <p className="text-sm text-muted">A second folder for this repository, with its own branch checked out. Both share the same history, so commits made in one show in the other.</p>
        {d.branch || d.remote ? null : (
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-text">Check out</span>
            <Select
              label="Check out"
              value={mode}
              onValueChange={(v) => setMode(v as WtMode)}
              options={[
                { value: 'new', label: 'A new branch' },
                { value: 'existing', label: 'An existing branch' },
                { value: 'detached', label: 'No branch (detached)' }
              ]}
            />
          </div>
        )}
        {mode === 'existing' ? (
          <Field label="Branch" error={branchProblem} help={free.length ? undefined : 'Every branch is already checked out somewhere.'}>
            {(p) => (
              <>
                <TextInput {...p} autoFocus={!d.branch} list="wt-free-branches" value={branch} onChange={(e) => setBranch(e.target.value)} placeholder={free[0] ?? 'branch name'} />
                <datalist id="wt-free-branches">
                  {free.slice(0, 500).map((b) => (
                    <option key={b} value={b} />
                  ))}
                </datalist>
              </>
            )}
          </Field>
        ) : mode === 'new' ? (
          <Field label="Branch name" error={nameProblem} help={d.remote ? `Tracks ${d.remote}` : `Starts from ${startLabel}`}>
            {(p) => <TextInput {...p} autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="feature/short-description" />}
          </Field>
        ) : (
          <p className="text-sm text-muted">Checks out {startLabel} without a branch. Make a branch there before committing, or the commits are easy to lose.</p>
        )}
        <FolderField
          label="Folder"
          value={path}
          onChange={(v) => {
            setPath(v)
            setPathEdited(true)
          }}
          help="A new, empty folder. It’s created for you."
        />
        <Switch label="Open it in a new tab" checked={openAfter} onCheckedChange={setOpenAfter} />
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

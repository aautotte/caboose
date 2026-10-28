import { useEffect, useMemo, useState } from 'react'
import { KeyRound } from 'lucide-react'
import type { ResetMode } from '../../../shared/types'
import { Button, Checkbox, Dialog, Field, Select, TextArea, TextInput } from '@/ui'
import { cn } from '@/ui/cn'
import { call } from '@/lib/api'
import { useApp, type Dialog as D } from '@/store'
import * as act from '@/actions'

const close = (): void => act.closeDialog()

/** A form inside a dialog: Enter submits, the footer buttons sit outside the form. */
function DialogForm({ onSubmit, children }: { onSubmit: () => void; children: React.ReactNode }): React.JSX.Element {
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit()
      }}
    >
      {children}
      <button type="submit" hidden />
    </form>
  )
}

/** F13: stash the uncommitted work, optionally named, optionally only what's staged. */
export function StashDialog({ d }: { d: Extract<D, { kind: 'stash' }> }): React.JSX.Element {
  const [message, setMessage] = useState('')
  const [stagedOnly, setStagedOnly] = useState(false)
  const [busy, setBusy] = useState(false)
  const status = useApp((s) => s.repos[d.repoId]?.status)
  const untracked = useApp((s) => s.prefs.stashUntracked)
  const stagedCount = status?.changes.filter((c) => c.index !== '.' && c.index !== '?' && !c.conflicted).length ?? 0
  const submit = async (): Promise<void> => {
    setBusy(true)
    const ok = await act.stashSave(d.repoId, message, stagedOnly)
    setBusy(false)
    if (ok) close()
  }
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && close()}
      title="Stash changes"
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>
            Stash
          </Button>
        </>
      }
    >
      <DialogForm onSubmit={() => void submit()}>
        <p className="text-base text-text">Puts your uncommitted changes aside and leaves the working folder clean. Pop the stash to bring them back.</p>
        <Field label="Name (optional)" help="Helps you find it later in the Stashes list.">
          {(p) => <TextInput {...p} autoFocus value={message} onChange={(e) => setMessage(e.target.value)} placeholder="half-done settings page" />}
        </Field>
        <Checkbox label={`Only staged changes (${stagedCount})`} checked={stagedOnly} disabled={stagedCount === 0} onCheckedChange={setStagedOnly} />
        {!stagedOnly ? <p className="text-sm text-muted">{untracked ? 'New files are included.' : 'New files stay where they are (change this in Settings).'}</p> : null}
      </DialogForm>
    </Dialog>
  )
}

function tagNameProblem(name: string, existing: string[]): string | undefined {
  if (!name) return undefined
  if (/\s/.test(name)) return 'Tag names can’t contain spaces.'
  if (/\.\.|[~^:?*[\\]|@\{|^-|\/$|\.lock$|^\/|\/\//.test(name)) return 'That name has characters Git doesn’t allow in tags.'
  if (existing.includes(name)) return 'A tag with that name already exists.'
  return undefined
}

/** F20: a lightweight tag, or an annotated one when there's a message. */
export function CreateTagDialog({ d }: { d: Extract<D, { kind: 'createTag' }> }): React.JSX.Element {
  const [name, setName] = useState('')
  const [message, setMessage] = useState('')
  const [push, setPush] = useState(false)
  const [busy, setBusy] = useState(false)
  const refs = useApp((s) => s.repos[d.repoId]?.refs)
  const remotes = refs?.remotes ?? []
  const [pushTo, setPushTo] = useState(remotes.includes('origin') ? 'origin' : (remotes[0] ?? ''))
  const existing = useMemo(() => refs?.refs.filter((r) => r.kind === 'tag').map((r) => r.short) ?? [], [refs])
  const problem = tagNameProblem(name.trim(), existing)
  const submit = async (): Promise<void> => {
    if (!name.trim() || problem) return
    setBusy(true)
    const ok = await act.createTag(d.repoId, name.trim(), d.at, message.trim() || null)
    if (ok && push) await act.pushTag(d.repoId, name.trim(), remotes.length > 1 ? pushTo : undefined)
    setBusy(false)
    if (ok) close()
  }
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && close()}
      title="New tag"
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" disabled={!name.trim() || !!problem} loading={busy} onClick={() => void submit()}>
            Create tag
          </Button>
        </>
      }
    >
      <DialogForm onSubmit={() => void submit()}>
        <Field label="Tag name" error={problem} help={`On ${d.atLabel}`}>
          {(p) => <TextInput {...p} autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="v1.2.0" />}
        </Field>
        <Field label="Message (optional)" help="With a message, the tag also records who made it and when (an annotated tag).">
          {(p) => <TextArea {...p} value={message} onChange={(e) => setMessage(e.target.value)} />}
        </Field>
        {remotes.length > 1 ? (
          <div className="flex items-center gap-3">
            <Checkbox label="Push it to" checked={push} onCheckedChange={setPush} />
            <Select
              label="Remote to push the tag to"
              value={pushTo}
              disabled={!push}
              onValueChange={setPushTo}
              options={[...remotes.map((r) => ({ value: r, label: r })), { value: act.ALL_REMOTES, label: 'All remotes' }]}
            />
          </div>
        ) : (
          <Checkbox label="Push it to the remote too" checked={push} disabled={!remotes.length} onCheckedChange={setPush} />
        )}
      </DialogForm>
    </Dialog>
  )
}

/** F21: add a remote by name and URL, then fetch it. */
export function AddRemoteDialog({ d }: { d: Extract<D, { kind: 'addRemote' }> }): React.JSX.Element {
  const remotes = useApp((s) => s.repos[d.repoId]?.refs?.remotes) ?? []
  const [name, setName] = useState(remotes.includes('origin') ? '' : 'origin')
  const [url, setUrl] = useState('')
  const [fetchAfter, setFetchAfter] = useState(true)
  const [busy, setBusy] = useState(false)
  const nameProblem = !name.trim()
    ? undefined
    : remotes.includes(name.trim())
      ? 'A remote with that name already exists.'
      : /[\s~^:?*[\\]|\.\.|^-|\/$/.test(name.trim())
        ? 'Use letters, numbers, dashes and dots.'
        : undefined
  const urlProblem = url.trim() && (/\s/.test(url.trim()) || url.trim().startsWith('-')) ? 'That doesn’t look like a repository URL or path.' : undefined
  const ready = name.trim() && url.trim() && !nameProblem && !urlProblem
  const submit = async (): Promise<void> => {
    if (!ready) return
    setBusy(true)
    const ok = await act.addRemote(d.repoId, name.trim(), url.trim(), fetchAfter)
    setBusy(false)
    if (ok) close()
  }
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && close()}
      title="Add a remote"
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" disabled={!ready} loading={busy} onClick={() => void submit()}>
            Add remote
          </Button>
        </>
      }
    >
      <DialogForm onSubmit={() => void submit()}>
        <Field label="Name" error={nameProblem} help="What the app calls it, like origin or upstream.">
          {(p) => <TextInput {...p} autoFocus value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <Field label="URL" error={urlProblem} help="HTTPS, SSH (git@host:owner/repo.git) or a folder path.">
          {(p) => <TextInput {...p} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/owner/repo.git" />}
        </Field>
        <Checkbox label="Fetch its branches now" checked={fetchAfter} onCheckedChange={setFetchAfter} />
      </DialogForm>
    </Dialog>
  )
}

const resetModes: Array<{ mode: ResetMode; title: string; body: string }> = [
  { mode: 'soft', title: 'Keep changes staged', body: 'Moves the branch back. Everything from the commits after it ends up staged, ready to commit again.' },
  { mode: 'mixed', title: 'Keep changes, unstaged', body: 'Moves the branch back. Your files stay as they are; the changes show as not staged.' },
  { mode: 'hard', title: 'Discard changes', body: 'Moves the branch back and makes your files match that commit. Uncommitted work is thrown away too (Undo can bring it back).' }
]

/** F18: reset the current branch to a commit, with the three modes in plain words. */
export function ResetDialog({ d }: { d: Extract<D, { kind: 'reset' }> }): React.JSX.Element {
  const [mode, setMode] = useState<ResetMode>('mixed')
  const [busy, setBusy] = useState(false)
  const head = useApp((s) => s.repos[d.repoId]?.refs?.head.branch)
  // Another branch than the checked-out one only moves: no files are involved, so there's no mode to pick.
  const other = d.branch && d.branch !== head ? d.branch : null
  const branch = other ?? head
  const submit = async (): Promise<void> => {
    setBusy(true)
    const ok = other ? await act.moveBranch(d.repoId, other, d.target) : await act.reset(d.repoId, d.target, mode, head ?? undefined)
    setBusy(false)
    if (ok) close()
  }
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && close()}
      title={`Reset ${branch ?? 'HEAD'} to ${d.targetLabel}`}
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant={mode === 'hard' && !other ? 'danger' : 'primary'} loading={busy} onClick={() => void submit()}>
            Reset
          </Button>
        </>
      }
    >
      {other ? (
        <>
          <p className="text-base text-text">
            {other} isn’t checked out, so only the branch moves to {d.targetLabel}: your files don’t change. Commits on {other} that {d.targetLabel} doesn’t have are left out of it (another branch may still have them).
          </p>
          <p className="text-sm text-muted">You can undo this with Ctrl+Z.</p>
        </>
      ) : (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm text-muted">What happens to the changes after {d.targetLabel}?</legend>
          {resetModes.map((m) => (
            <label
              key={m.mode}
              className={cn(
                'flex cursor-pointer gap-3 rounded-md border p-3 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus-ring',
                mode === m.mode ? 'border-accent bg-row-selected' : 'border-border hover:bg-row-hover'
              )}
            >
              <input type="radio" name="reset-mode" value={m.mode} checked={mode === m.mode} onChange={() => setMode(m.mode)} className="mt-1 accent-(--gc-color-accent)" />
              <span className="flex flex-col gap-0.5">
                <span className={cn('text-base font-medium', m.mode === 'hard' ? 'text-danger' : 'text-text')}>{m.title}</span>
                <span className="text-sm text-muted">{m.body}</span>
              </span>
            </label>
          ))}
        </fieldset>
      )}
    </Dialog>
  )
}

/** F21: link a local branch to a remote branch for pull / push and ahead / behind counts. */
export function UpstreamDialog({ d }: { d: Extract<D, { kind: 'upstream' }> }): React.JSX.Element {
  const refs = useApp((s) => s.repos[d.repoId]?.refs)
  const remoteBranches = refs?.refs.filter((r) => r.kind === 'remote' && !r.short.endsWith('/HEAD')).map((r) => r.short) ?? []
  const current = refs?.refs.find((r) => r.kind === 'local' && r.short === d.branch)?.upstream?.replace('refs/remotes/', '')
  const guess = current ?? remoteBranches.find((r) => r.endsWith(`/${d.branch}`)) ?? remoteBranches[0] ?? ''
  const [upstream, setUpstream] = useState(guess)
  const submit = async (): Promise<void> => {
    if (upstream && (await act.setUpstream(d.repoId, d.branch, upstream))) close()
  }
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && close()}
      title={`Upstream for ${d.branch}`}
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" disabled={!upstream} onClick={() => void submit()}>
            Set upstream
          </Button>
        </>
      }
    >
      {remoteBranches.length ? (
        <>
          <p className="text-base text-text">Pull and push on {d.branch} will use this remote branch, and the counts next to it compare against it.</p>
          <Select label="Remote branch" value={upstream} onValueChange={setUpstream} options={remoteBranches.map((r) => ({ value: r, label: r }))} />
        </>
      ) : (
        <p className="text-base text-text">There are no remote branches yet. Fetch, or publish {d.branch} with Push.</p>
      )}
    </Dialog>
  )
}

/** Stashes can't be renamed in place; the stash moves to the top of the list with its new name. */
export function RenameStashDialog({ d }: { d: Extract<D, { kind: 'renameStash' }> }): React.JSX.Element {
  const [name, setName] = useState(d.message)
  const [busy, setBusy] = useState(false)
  const submit = async (): Promise<void> => {
    if (!name.trim() || name.trim() === d.message) return
    setBusy(true)
    const ok = await act.renameStash(d.repoId, d.sha, name.trim())
    setBusy(false)
    if (ok) close()
  }
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && close()}
      title="Rename stash"
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" disabled={!name.trim() || name.trim() === d.message} loading={busy} onClick={() => void submit()}>
            Rename
          </Button>
        </>
      }
    >
      <DialogForm onSubmit={() => void submit()}>
        <Field label="Name" help="The stash moves to the top of the list.">
          {(p) => <TextInput {...p} autoFocus value={name} onFocus={(e) => e.target.select()} onChange={(e) => setName(e.target.value)} />}
        </Field>
      </DialogForm>
    </Dialog>
  )
}

/** Name a new repository group (optionally moving a repository into it), or rename one. */
export function GroupNameDialog({ d }: { d: Extract<D, { kind: 'groupName' }> }): React.JSX.Element {
  const [name, setName] = useState(d.name)
  const [error, setError] = useState<string | undefined>()
  const submit = async (): Promise<void> => {
    if (!name.trim()) return
    try {
      if (d.mode === 'rename') await call('group.rename', { groupId: d.groupId!, name })
      else {
        const { id } = await call('group.create', { name })
        if (d.repoId) await call('repo.update', { repoId: d.repoId, groupId: id })
      }
      close()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && close()}
      title={d.mode === 'rename' ? 'Rename group' : 'New group'}
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" disabled={!name.trim()} onClick={() => void submit()}>
            {d.mode === 'rename' ? 'Rename' : 'Create group'}
          </Button>
        </>
      }
    >
      <DialogForm onSubmit={() => void submit()}>
        <Field label="Group name" error={error}>
          {(p) => <TextInput {...p} autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Work" />}
        </Field>
      </DialogForm>
    </Dialog>
  )
}

/** Git (through our askpass helper) needs a username, password, token or passphrase. Never stored. */
export function AuthDialog(): React.JSX.Element | null {
  const p = useApp((s) => s.authPrompt)
  const [answer, setAnswer] = useState('')
  useEffect(() => setAnswer(''), [p?.promptId])
  if (!p) return null
  const host = /'(https?:\/\/[^']+|[^']+@[^']+)'/.exec(p.prompt)?.[1]
  const what = /passphrase/i.test(p.prompt) ? 'Key passphrase' : /username/i.test(p.prompt) ? 'Username' : /password/i.test(p.prompt) ? 'Password or access token' : 'Answer'
  const submit = (): void => void act.answerAuth(p.promptId, answer)
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && void act.answerAuth(p.promptId, null)}
      title="Sign in to the remote"
      footer={
        <>
          <Button onClick={() => void act.answerAuth(p.promptId, null)}>Cancel</Button>
          <Button variant="primary" onClick={submit}>
            Continue
          </Button>
        </>
      }
    >
      <DialogForm onSubmit={submit}>
        <p className="flex items-start gap-2 text-base text-text">
          <KeyRound size={16} aria-hidden className="mt-0.5 shrink-0 text-muted" />
          <span>{host ? <>Git is asking for your {what.toLowerCase()} for <span className="font-mono text-sm break-all">{host}</span>.</> : p.prompt}</span>
        </p>
        <Field label={what} help="Sent straight to Git for this request. The app doesn’t save it; a credential manager can remember it for you.">
          {(f) => <TextInput {...f} autoFocus type={p.secret ? 'password' : 'text'} autoComplete="off" spellCheck={false} value={answer} onChange={(e) => setAnswer(e.target.value)} />}
        </Field>
      </DialogForm>
    </Dialog>
  )
}

/** One message for the commits being squashed; the oldest commit's author and date are kept. */
const RUN_HELP = 'Run in the repository’s folder for each commit git checks out: exit 0 means good, 125 skip it, anything else bad. Leave it empty to answer yourself.'

/** Test each step of the bisect going on with a command (git bisect run). */
export function BisectRunDialog({ d }: { d: Extract<D, { kind: 'bisectRun' }> }): React.JSX.Element {
  const [command, setCommand] = useState(act.lastBisectCommand(d.repoId))
  const submit = (): void => {
    if (!command.trim()) return
    close()
    void act.bisectRun(d.repoId, command.trim())
  }
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && close()}
      title="Test each step with a command"
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" disabled={!command.trim()} onClick={submit}>
            Run
          </Button>
        </>
      }
    >
      <DialogForm onSubmit={submit}>
        <p className="text-base text-muted">Git tests each commit with it, one after the other, until it finds the first bad one. You can cancel it; the answers so far are kept.</p>
        <Field label="Command" help={RUN_HELP}>
          {(p) => <TextInput {...p} autoFocus value={command} onChange={(e) => setCommand(e.target.value)} placeholder="npm test" />}
        </Field>
      </DialogForm>
    </Dialog>
  )
}

/** Start a bisect: a commit that has the problem, and an older one that doesn't (a tag, a branch, a SHA). */
export function BisectDialog({ d }: { d: Extract<D, { kind: 'bisect' }> }): React.JSX.Element {
  const refs = useApp((s) => s.repos[d.repoId]?.refs)
  const [bad, setBad] = useState(d.bad ?? refs?.head.branch ?? 'HEAD')
  const [good, setGood] = useState(d.good ?? '')
  const [command, setCommand] = useState('')
  const [busy, setBusy] = useState(false)
  const names = (refs?.refs ?? []).filter((r) => r.kind === 'tag' || r.kind === 'local').map((r) => r.short)
  const submit = async (): Promise<void> => {
    if (!bad.trim() || !good.trim() || busy) return
    setBusy(true)
    const ok = await act.bisectStart(d.repoId, bad.trim(), good.trim(), command)
    setBusy(false)
    if (ok) close()
  }
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && close()}
      title="Find the commit that broke something"
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" disabled={!bad.trim() || !good.trim()} loading={busy} onClick={() => void submit()}>
            Start bisect
          </Button>
        </>
      }
    >
      <DialogForm onSubmit={() => void submit()}>
        <p className="text-base text-muted">
          Git checks out a commit halfway between the two; you try it and say good or bad, and it halves the rest until one commit is left: the first bad one. Stop puts you back where you are.
        </p>
        <datalist id="bisect-refs">
          {names.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
        <Field label="Bad: has the problem" help="A branch, tag or SHA. Usually where you are now.">
          {(p) => <TextInput {...p} list="bisect-refs" value={bad} onChange={(e) => setBad(e.target.value)} />}
        </Field>
        <Field label="Good: before the problem" help="An older commit that worked, such as the last release’s tag.">
          {(p) => <TextInput {...p} autoFocus={!!d.bad || !d.good} list="bisect-refs" value={good} onChange={(e) => setGood(e.target.value)} placeholder="v1.2.0" />}
        </Field>
        <Field label="Test each step with a command (optional)" help={RUN_HELP}>
          {(p) => <TextInput {...p} value={command} onChange={(e) => setCommand(e.target.value)} placeholder={act.lastBisectCommand(d.repoId) || 'npm test'} />}
        </Field>
      </DialogForm>
    </Dialog>
  )
}

export function SquashDialog({ d }: { d: Extract<D, { kind: 'squash' }> }): React.JSX.Element {
  const [first, ...rest] = d.message.split('\n')
  const [summary, setSummary] = useState(first)
  const [body, setBody] = useState(rest.join('\n').trim())
  const [skipHooks, setSkipHooks] = useState(false)
  // Tall enough to read every commit's message, within reason.
  const rows = Math.min(18, Math.max(6, body.split('\n').length + 1))
  const [busy, setBusy] = useState(false)
  const submit = (): void => {
    if (!summary.trim() || busy) return
    setBusy(true)
    close()
    act.squash(d.repoId, d.shas, body.trim() ? `${summary.trim()}\n\n${body.trim()}` : summary.trim(), undefined, skipHooks)
  }
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && close()}
      title={`Squash ${d.shas.length} commits`}
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" disabled={!summary.trim()} loading={busy} onClick={submit}>
            Squash
          </Button>
        </>
      }
    >
      <DialogForm onSubmit={submit}>
        <p className="text-base text-muted">They become one commit with this message, which starts with all of theirs, oldest first. The oldest one’s author and date are kept. Undo puts them back.</p>
        <Field label="Summary">{(p) => <TextInput {...p} autoFocus value={summary} onChange={(e) => setSummary(e.target.value)} />}</Field>
        <Field label="Description">{(p) => <TextArea {...p} rows={rows} value={body} onChange={(e) => setBody(e.target.value)} />}</Field>
        <Checkbox label="Skip hooks" checked={skipHooks} onCheckedChange={setSkipHooks} />
      </DialogForm>
    </Dialog>
  )
}

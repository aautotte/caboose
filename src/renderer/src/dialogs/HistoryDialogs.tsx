import { useEffect, useMemo, useState } from 'react'
import type { RebasePreview, RebaseRow } from '../../../shared/types'
import { Button, Checkbox, Dialog, Field, TextArea, TextInput } from '@/ui'
import { call } from '@/lib/api'
import { plural } from '@/lib/format'
import { addCoAuthor } from '@/lib/message'
import { useApp, type Dialog as D } from '@/store'
import { stackedLabel } from '@/history/RebaseView'
import * as act from '@/actions'

const close = (): void => act.closeDialog()

/** Set the author of commits, or add a co-author: "Name <email>", typed or picked from the people in the history. */
export function AuthorDialog({ d }: { d: Extract<D, { kind: 'author' }> }): React.JSX.Element {
  const commits = useApp((s) => s.repos[d.repoId]?.commits)
  const people = useMemo(() => [...new Set((commits ?? []).filter((c) => c.kind === 'commit').map((c) => `${c.authorName} <${c.authorEmail}>`))].slice(0, 200), [commits])
  const [author, setAuthor] = useState('')
  const value = author.trim()
  const problem = value && !/^[^<>\n]+ <[^<>\s]+>$/.test(value) ? 'Write it as Name <email>.' : undefined
  const ready = !!value && !problem
  const what = d.shas.length === 1 ? d.shas[0].slice(0, 7) : plural(d.shas.length, 'commit')
  const set = d.mode === 'set'
  const draft = d.mode === 'draft'
  const submit = (): void => {
    if (!ready) return
    // Closed first: the toast shows once the dialog is gone.
    close()
    if (d.mode === 'draft') act.setDraft(d.repoId, { body: addCoAuthor(useApp.getState().repos[d.repoId]?.draft.body ?? '', value) })
    else act.setAuthorship(d.repoId, d.shas, { kind: d.mode, author: value })
  }
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && close()}
      title={set ? `Set the author of ${what}` : draft ? 'Add a co-author to your commit' : `Add a co-author to ${what}`}
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" disabled={!ready} onClick={submit}>
            {set ? 'Set author' : 'Add co-author'}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <Field
          label={set ? 'Author' : 'Co-author'}
          error={problem}
          help={set ? 'Shown as who wrote the changes. You stay the committer.' : 'Adds a Co-authored-by line to the message. GitHub and GitLab show them as an author too.'}
        >
          {(f) => <TextInput {...f} autoFocus list="author-people" value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Name <email@example.com>" />}
        </Field>
        <datalist id="author-people">
          {people.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
        {draft ? null : <p className="text-sm text-muted">The commits get new IDs, and the ones after them are replayed. Undo puts them back.</p>}
      </form>
    </Dialog>
  )
}

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

/**
 * Squash merge: everything `source` brings in becomes one new commit on `target`, with a message to write. It starts
 * with the one commit's message, or a summary and a line per commit.
 */
export function SquashMergeDialog({ d }: { d: Extract<D, { kind: 'squashMerge' }> }): React.JSX.Element {
  const [rows, setRows] = useState<RebaseRow[] | null>(null)
  const [summary, setSummary] = useState('')
  const [body, setBody] = useState('')
  const [skipHooks, setSkipHooks] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let live = true
    call('merge.preview', { repoId: d.repoId, source: d.source, target: d.target })
      .then((r) => {
        if (!live) return
        setRows(r)
        if (r.length === 1) {
          setSummary(r[0].summary)
          setBody(r[0].body)
        } else {
          setSummary(`Merge ${d.source} (squashed)`)
          setBody(r.map((c) => `* ${c.summary}`).join('\n'))
        }
      })
      .catch(act.fail)
    return () => {
      live = false
    }
  }, [d.repoId, d.source, d.target])
  const ready = !!rows?.length && !!summary.trim() && !busy
  const submit = async (): Promise<void> => {
    if (!ready) return
    setBusy(true)
    // Closed first: whatever happens is said in a notification, and there's nothing left to do here.
    close()
    await act.squashMerge(d.repoId, d.source, d.target, body.trim() ? `${summary.trim()}\n\n${body.trim()}` : summary.trim(), skipHooks)
  }
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && close()}
      title={`Squash ${d.source} into one commit on ${d.target}`}
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" disabled={!ready} loading={busy} onClick={() => void submit()}>
            Squash and commit
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
          {!rows
            ? 'Listing the commits…'
            : rows.length
              ? `The changes from ${plural(rows.length, 'commit')} on ${d.source} become one new commit on ${d.target}. ${d.source} itself doesn’t change, and isn’t marked merged. Undo takes the commit off again.`
              : `${d.target} already has every commit on ${d.source}.`}
        </p>
        <Field label="Summary">{(p) => <TextInput {...p} autoFocus value={summary} onChange={(e) => setSummary(e.target.value)} />}</Field>
        <Field label="Description">{(p) => <TextArea {...p} rows={Math.min(14, Math.max(4, body.split('\n').length + 1))} value={body} onChange={(e) => setBody(e.target.value)} />}</Field>
        <Checkbox label="Skip hooks" checked={skipHooks} onCheckedChange={setSkipHooks} />
        <button type="submit" hidden />
      </form>
    </Dialog>
  )
}

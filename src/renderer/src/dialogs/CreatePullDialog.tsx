import { useEffect, useMemo, useRef, useState } from 'react'
import type { PullDraft } from '../../../shared/types'
import { Button, Checkbox, Dialog, Field, Select, TextArea, TextInput } from '@/ui'
import { useApp, type Dialog as D } from '@/store'
import * as act from '@/actions'
import { call } from '@/lib/api'
import { plural } from '@/lib/format'

/**
 * A new pull request on GitHub for a local branch: into which branch, its title and description (from the
 * branch's commits until you change them), and whether it's a draft. A branch that isn't pushed, or has commits
 * still to push, is pushed first.
 */
export function CreatePullDialog({ d }: { d: Extract<D, { kind: 'createPull' }> }): React.JSX.Element | null {
  const pulls = useApp((s) => s.repos[d.repoId]?.pulls)
  const refs = useApp((s) => s.repos[d.repoId]?.refs)
  const gh = pulls?.state === 'ok' ? pulls : null
  const bases = useMemo(() => {
    if (!gh) return []
    const there = (refs?.refs ?? [])
      .filter((r) => r.kind === 'remote' && r.short.startsWith(`${gh.remote}/`))
      .map((r) => r.short.slice(gh.remote.length + 1))
      .filter((b) => b !== 'HEAD' && b !== d.branch)
    return [...new Set([gh.defaultBranch, ...there])].filter((b) => b !== d.branch)
  }, [gh, refs, d.branch])
  const [base, setBase] = useState(bases[0] ?? '')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [isDraft, setIsDraft] = useState(false)
  const [info, setInfo] = useState<PullDraft | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  // Once you've typed in them, another base doesn't replace the title and description.
  const edited = useRef(false)

  useEffect(() => {
    if (!base) return
    let live = true
    setInfo(null)
    call('github.pullDraft', { repoId: d.repoId, branch: d.branch, base })
      .then((p) => {
        if (!live) return
        setInfo(p)
        if (!edited.current) {
          setTitle(p.title)
          setBody(p.body)
        }
      })
      .catch((e: Error) => live && setFailed(e.message))
    return () => {
      live = false
    }
  }, [d.repoId, d.branch, base])

  if (!gh) return null
  const remote = gh.remote
  const problem = !bases.length
    ? `${remote} has no other branch to merge ${d.branch} into.`
    : info && info.commits === 0
      ? `${d.branch} has no commits that ${base} doesn’t have.`
      : !title.trim() && info
        ? 'A pull request needs a title.'
        : undefined
  const submit = async (): Promise<void> => {
    if (!info || problem || busy) return
    setBusy(true)
    setFailed(null)
    const err = await act.createPull(d.repoId, d.branch, info, { base, title: title.trim(), body, draft: isDraft })
    setBusy(false)
    if (err) setFailed(err)
  }
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !busy && act.closeDialog()}
      title={`Create a pull request for ${d.branch}`}
      error={problem ?? failed ?? undefined}
      footer={
        <>
          <Button disabled={busy} onClick={() => act.closeDialog()}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!info || !!problem} loading={busy} onClick={() => void submit()}>
            {isDraft ? 'Create draft pull request' : 'Create pull request'}
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
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted">On {gh.repo}, merge {d.branch} into</span>
          <Select label="Base branch" value={base} onValueChange={setBase} options={bases.map((b) => ({ value: b, label: b }))} />
        </div>
        <Field label="Title">
          {(p) => (
            <TextInput
              {...p}
              value={title}
              maxLength={256}
              onChange={(e) => {
                edited.current = true
                setTitle(e.target.value)
              }}
            />
          )}
        </Field>
        <Field label="Description" help="Markdown, as on GitHub.">
          {(p) => (
            <TextArea
              {...p}
              rows={Math.min(12, Math.max(5, body.split('\n').length + 1))}
              value={body}
              onChange={(e) => {
                edited.current = true
                setBody(e.target.value)
              }}
            />
          )}
        </Field>
        <Checkbox label="Create it as a draft: not ready for review yet" checked={isDraft} onCheckedChange={setIsDraft} />
        {info ? (
          <p role="status" className="text-sm text-muted">
            {plural(info.commits, 'commit')}.{' '}
            {info.push === 'none' ? `${d.branch} isn’t on ${remote} yet: it’s pushed there first.` : info.push === 'ahead' ? `The commits not on ${remote} yet are pushed first.` : `${d.branch} is up to date on ${remote}.`}
          </p>
        ) : null}
        <button type="submit" hidden />
      </form>
    </Dialog>
  )
}

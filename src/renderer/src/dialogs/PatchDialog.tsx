import { useEffect, useState } from 'react'
import type { PatchPreview, PatchSource, PatchTarget } from '../../../shared/types'
import { Button, Dialog, Field, TextArea } from '@/ui'
import { cn } from '@/ui/cn'
import { call } from '@/lib/api'
import { plural, splitPath } from '@/lib/format'
import { useApp, type Dialog as D } from '@/store'
import * as act from '@/actions'

const close = (): void => act.closeDialog()
const SHOWN = 12

/**
 * Apply a patch, pasted or from a file: to the working files, to them and the staged changes, or (a mailbox from
 * git format-patch) as commits with their authors and messages. It's checked as you go: what it changes, and
 * whether it fits.
 */
export function ApplyPatchDialog({ d }: { d: Extract<D, { kind: 'applyPatch' }> }): React.JSX.Element {
  const branch = useApp((s) => s.repos[d.repoId]?.refs?.head.branch)
  const [text, setText] = useState('')
  const [file, setFile] = useState<string | null>(null)
  // Unset: commits for a mailbox, the working files for a plain diff.
  const [picked, setPicked] = useState<PatchTarget | null>(null)
  const [preview, setPreview] = useState<PatchPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const source: PatchSource | null = file ? { kind: 'file', path: file } : text.trim() ? { kind: 'text', text } : null
  const hasCommits = !!preview?.commits.length
  const target: PatchTarget = picked === 'commits' && preview && !hasCommits ? 'worktree' : (picked ?? (hasCommits ? 'commits' : 'worktree'))
  const sourceKey = JSON.stringify(source)
  const paste = async (): Promise<boolean> => {
    const clip = await call('patch.clipboard', {}).catch(() => null)
    setNote('')
    if (clip) {
      setFile(null)
      setText(clip)
    }
    return !!clip
  }
  useEffect(() => {
    void paste()
  }, [])

  useEffect(() => {
    if (!source) {
      setPreview(null)
      return
    }
    let live = true
    const t = setTimeout(() => {
      call('patch.check', { repoId: d.repoId, source, target })
        .then((p) => live && setPreview(p))
        .catch((e: Error) => live && setPreview({ files: [], commits: [], problem: e.message }))
    }, 250)
    return () => {
      live = false
      clearTimeout(t)
    }
    // sourceKey stands in for source
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.repoId, sourceKey, target])

  const openFile = async (): Promise<void> => {
    const path = await call('patch.pickFile', {}).catch(() => null)
    if (path) {
      setFile(path)
      setPreview(null)
    }
  }
  const ready = !!source && !!preview && !preview.problem && !busy
  const submit = async (): Promise<void> => {
    if (!ready || !source) return
    setBusy(true)
    const ok = await act.applyPatchSource(d.repoId, source, target)
    setBusy(false)
    if (ok) close()
  }
  const targets: { value: PatchTarget; title: string; body: string }[] = [
    ...(hasCommits
      ? [{ value: 'commits' as const, title: `As ${plural(preview!.commits.length, 'commit')}`, body: `Each with its author, date and message, on top of ${branch ?? 'HEAD'}.` }]
      : []),
    { value: 'worktree', title: 'To your working files', body: 'The changes show up unstaged, for you to look over first.' },
    { value: 'index', title: 'To your working files, staged', body: 'The changes are in your files and staged, ready to commit.' }
  ]

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && close()}
      title="Apply a patch"
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" disabled={!ready} onClick={() => void submit()}>
            {target === 'commits' && hasCommits ? `Apply ${plural(preview!.commits.length, 'commit')}` : 'Apply'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {file ? (
          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 truncate text-base text-text" title={file}>
              From <span className="font-medium">{splitPath(file.split('\\').join('/')).name}</span>
            </p>
            <Button size="sm" variant="ghost" onClick={() => setFile(null)}>
              Paste instead
            </Button>
          </div>
        ) : (
          <Field label="Patch" help="A diff, or commits from git format-patch or Copy as patch. Paste from the clipboard keeps Windows line endings; typing Ctrl+V here doesn’t.">
            {(p) => <TextArea {...p} rows={8} spellCheck={false} className="font-mono text-sm" placeholder="Paste a patch here" value={text} onChange={(e) => setText(e.target.value)} />}
          </Field>
        )}
        <div className="flex gap-2">
          <Button size="sm" onClick={() => void paste().then((ok) => ok || setNote('The clipboard doesn’t hold a patch.'))}>
            Paste from the clipboard
          </Button>
          <Button size="sm" onClick={() => void openFile()}>
            Open a patch file…
          </Button>
          <span role="status" className="self-center text-sm text-muted">
            {note}
          </span>
        </div>

        {preview?.commits.length ? (
          <ul aria-label="Commits in the patch" className="flex flex-col gap-0.5 text-sm">
            {preview.commits.map((c, i) => (
              <li key={i} className="truncate">
                <span className="text-text">{c.subject}</span>
                <span className="text-muted"> · {c.author}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {preview?.files.length ? (
          <ul aria-label="Files it changes" className="max-h-40 overflow-y-auto rounded-md border border-border bg-surface-sunken px-3 py-2 font-mono text-sm text-text">
            {preview.files.slice(0, SHOWN).map((f) => (
              <li key={f.path} className="flex gap-2">
                {f.added === null ? (
                  <span className="shrink-0 text-muted">binary</span>
                ) : (
                  <span className="shrink-0">
                    <span className="text-success">+{f.added}</span> <span className="text-danger">−{f.removed}</span>
                  </span>
                )}
                <span className="min-w-0 truncate">{f.path}</span>
              </li>
            ))}
            {preview.files.length > SHOWN ? <li className="font-sans text-muted">and {plural(preview.files.length - SHOWN, 'more file')}</li> : null}
          </ul>
        ) : null}

        {preview && preview.files.length ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm text-muted">Apply it</legend>
            {targets.map((t) => (
              <label
                key={t.value}
                className={cn(
                  'flex cursor-pointer gap-3 rounded-md border p-3 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus-ring',
                  target === t.value ? 'border-accent bg-row-selected' : 'border-border hover:bg-row-hover'
                )}
              >
                <input type="radio" name="patch-target" value={t.value} checked={target === t.value} onChange={() => setPicked(t.value)} className="mt-1 accent-(--gc-color-accent)" />
                <span className="flex flex-col gap-0.5">
                  <span className="text-base font-medium text-text">{t.title}</span>
                  <span className="text-sm text-muted">{t.body}</span>
                </span>
              </label>
            ))}
          </fieldset>
        ) : null}
        {preview?.problem ? (
          <p role="alert" className="text-sm text-danger">
            {preview.problem}
          </p>
        ) : preview ? (
          <p className="text-sm text-muted">It applies cleanly. Undo takes it back out.</p>
        ) : null}
      </div>
    </Dialog>
  )
}

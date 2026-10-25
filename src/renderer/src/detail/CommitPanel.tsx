import { useEffect, useState } from 'react'
import { AlertTriangle, Copy, GitCommitHorizontal, History, ShieldAlert, ShieldCheck, ShieldQuestion, UserSearch } from 'lucide-react'
import type { CommitDetails, CommitSignature } from '../../../shared/types'
import { Avatar, Badge, Button, EmptyState, IconButton, TextArea, TextInput, Tooltip } from '@/ui'
import { call } from '@/lib/api'
import { fullDate, plural, shortSha } from '@/lib/format'
import { patchRepo, useRepo } from '@/store'
import * as act from '@/actions'
import { CollapseDetailsButton } from '@/shell/PanelRails'
import { FileList } from './FileList'
import { toStatus } from './FileList'

/** S06: one commit (or stash): who, when, message, and the files it changed. */
export function CommitPanel({ repoId, sha }: { repoId: string; sha: string }): React.JSX.Element {
  const [d, setD] = useState<CommitDetails | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [summary, setSummary] = useState('')
  const [body, setBody] = useState('')
  const center = useRepo(repoId, (r) => r.center)
  const headSha = useRepo(repoId, (r) => r.refs?.head.sha)
  const stash = useRepo(repoId, (r) => r.refs?.stashes.find((s) => s.sha === sha))
  const editRequest = useRepo(repoId, (r) => r.editing)
  const busy = useRepo(repoId, (r) => !!r.busy.op || !!r.busy.commit)
  const commitCount = useRepo(repoId, (r) => r.commits.length)
  const status = useRepo(repoId, (r) => r.status) // re-checks what blocks a rewrite

  useEffect(() => {
    let live = true
    setD(null)
    setErr(null)
    setEditing(false)
    call('commit.details', { repoId, sha })
      .then((v) => live && setD(v))
      .catch((e: Error) => live && setErr(e.message))
    return () => {
      live = false
    }
  }, [repoId, sha, headSha])

  // The graph's "Edit message…" asks for the editor once this commit has loaded.
  useEffect(() => {
    if (!d || editRequest !== d.sha) return
    patchRepo(repoId, { editing: null })
    setSummary(d.summary)
    setBody(d.body)
    setEditing(true)
  }, [d, editRequest, repoId])

  if (err) return <EmptyState icon={GitCommitHorizontal} title="Couldn’t load this commit" body={err} />
  if (!d) {
    return (
      <div className="flex flex-col gap-3 p-4" role="status" aria-label="Loading commit">
        <div className="h-4 w-2/3 rounded-sm bg-surface-raised" />
        <div className="h-3 w-1/2 rounded-sm bg-surface-raised" />
        <div className="h-3 w-1/3 rounded-sm bg-surface-raised" />
      </div>
    )
  }

  const openPath = center.kind === 'diff' ? center.path : null
  // Any commit on the checked-out branch's line can get a new message: the newest by amending, older ones by a reword.
  void commitCount
  void status
  const onLine = act.headLine(repoId).includes(d.sha)
  const canEdit = !stash && d.parents.length <= 1 && (d.isHead || (onLine && d.parents.length === 1))
  const pushed = canEdit && act.alreadyPushed(repoId, [d.sha])
  // Older commits are reworded by a rebase: not past a merge (it would be flattened), and not with work in the way.
  const behindMerge = canEdit && !d.isHead && act.mergeAbove(repoId, d.sha)
  const blocker = canEdit && !d.isHead ? act.rewriteBlocker(repoId) : null
  const saveMessage = async (): Promise<void> => {
    if (!summary.trim()) return
    if (d.isHead) {
      const ok = await act.commit(repoId, { summary, body, amend: true, noVerify: false, push: false, messageOnly: true })
      if (ok) setEditing(false)
      return
    }
    // Busy shows while it runs; cancelling the "already pushed" question leaves the editor as it was.
    act.reword(repoId, d.sha, body.trim() ? `${summary.trim()}\n\n${body.trim()}` : summary.trim(), (ok) => ok && setEditing(false))
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
        <CollapseDetailsButton />
        <h2 className="flex-1 text-md text-text">{stash ? 'Stash' : d.parents.length > 1 ? 'Merge commit' : 'Commit'}</h2>
        <span className="font-mono text-xs text-muted">{shortSha(d.sha)}</span>
        <Tooltip content="Copy full SHA">
          <IconButton label="Copy full SHA" size="sm" onClick={() => void navigator.clipboard.writeText(d.sha)}>
            <Copy size={14} />
          </IconButton>
        </Tooltip>
      </header>
      <div className="flex shrink-0 flex-col gap-3 border-b border-border p-3">
        <div className="flex items-center gap-2">
          <Avatar name={d.author.name} email={d.author.email} size={28} decorative />
          <div className="min-w-0 leading-tight">
            <p className="truncate text-base text-text">{d.author.name}</p>
            <p className="truncate text-sm text-muted" title={`${fullDate(d.author.time)} (UTC${d.author.offset})`}>
              {d.author.email} · {fullDate(d.author.time)}
            </p>
          </div>
        </div>
        {d.signature ? <SignatureLine sig={d.signature} /> : null}
        {d.coAuthors.length ? (
          <p className="text-sm text-muted">With {d.coAuthors.map((c) => c.name).join(', ')}</p>
        ) : null}
        {editing ? (
          <div className="flex flex-col gap-2">
            <TextInput aria-label="Commit summary" value={summary} onChange={(e) => setSummary(e.target.value)} autoFocus />
            <TextArea aria-label="Commit description" value={body} onChange={(e) => setBody(e.target.value)} />
            {!d.isHead || pushed ? (
              <p className="flex items-start gap-1.5 text-sm text-muted">
                {pushed ? <AlertTriangle size={14} aria-hidden className="mt-0.5 shrink-0 text-warning" /> : null}
                <span>
                  {d.isHead ? '' : 'This commit and the ones after it get new IDs. Undo puts them back. '}
                  {pushed ? 'It’s already on a remote, so the next push will need to be a force push.' : ''}
                </span>
              </p>
            ) : null}
            {blocker ? (
              <p role="alert" className="text-sm text-danger">
                {blocker}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button size="sm" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button size="sm" variant="primary" disabled={!summary.trim() || !!blocker} loading={busy} onClick={() => void saveMessage()}>
                Save message
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <p className="text-md break-words text-text">{stash ? stash.message : d.summary}</p>
            {d.body ? <p className="text-base break-words whitespace-pre-wrap text-muted">{d.body}</p> : null}
            {canEdit ? (
              <Button
                size="sm"
                variant="ghost"
                className="-ml-2 self-start text-accent-text"
                disabled={behindMerge}
                onClick={() => {
                  setSummary(d.summary)
                  setBody(d.body)
                  setEditing(true)
                }}
              >
                Edit message
              </Button>
            ) : null}
            {behindMerge ? <p className="text-sm text-muted">Its message can’t be changed here: there’s a merge commit after it on this branch, and rewriting would flatten that merge.</p> : null}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
          <span>{d.parents.length === 0 ? 'First commit' : d.parents.length > 1 ? 'Parents' : 'Parent'}</span>
          {d.parents.map((p) => (
            <button key={p} onClick={() => act.select(repoId, p)} className="font-mono text-xs text-accent-text hover:underline">
              {shortSha(p)}
            </button>
          ))}
          {d.isHead ? <Badge tone="accent">HEAD</Badge> : null}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <FileList
          title={d.parents.length > 1 ? `Changed vs first parent` : 'Changed files'}
          files={d.files.map((f) => ({ path: f.path, origPath: f.origPath, status: toStatus(f.status) }))}
          selected={openPath}
          onOpen={(f) => act.openDiff(repoId, f.path, { kind: 'commit', sha: d.sha, parent: d.parents[0] }, f.origPath)}
          menu={(f) => [
            { type: 'item', label: 'File history', icon: <History size={14} />, onSelect: () => act.setCenter(repoId, { kind: 'history', path: f.path }) },
            {
              type: 'item',
              label: 'Blame at this commit',
              icon: <UserSearch size={14} />,
              disabled: f.status === 'deleted',
              onSelect: () => act.setCenter(repoId, { kind: 'blame', path: f.path, rev: d.sha })
            },
            { type: 'separator' },
            { type: 'item', label: 'Copy path', onSelect: () => void navigator.clipboard.writeText(f.path) }
          ]}
          emptyText={`No file changes (${plural(d.parents.length, 'parent')}).`}
        />
      </div>
    </div>
  )
}

const sigText: Record<CommitSignature['status'], string> = {
  good: 'Signed',
  untrusted: 'Signed, by a key you haven’t marked as trusted',
  bad: 'Signature doesn’t match this commit',
  unknown: 'Signed with a key that isn’t on this computer',
  expired: 'Signed with an expired key',
  revoked: 'Signed with a revoked key'
}

function SignatureLine({ sig }: { sig: CommitSignature }): React.JSX.Element {
  const Icon = sig.status === 'good' || sig.status === 'untrusted' ? ShieldCheck : sig.status === 'unknown' ? ShieldQuestion : ShieldAlert
  const tone = sig.status === 'good' ? 'text-success' : sig.status === 'bad' || sig.status === 'revoked' ? 'text-danger' : 'text-warning'
  return (
    <p className={`flex items-center gap-1.5 text-sm ${tone}`} title={sig.key ? `Key ${sig.key}` : undefined}>
      <Icon size={14} aria-hidden className="shrink-0" />
      <span className="min-w-0 truncate">
        {sigText[sig.status]}
        {sig.signer ? <span className="text-muted"> · {sig.signer}</span> : null}
      </span>
    </p>
  )
}

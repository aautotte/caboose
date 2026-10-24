import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Archive, CheckCircle2, ExternalLink, Eye, EyeOff, FolderOpen, GitCompare, History, Trash2, UserSearch } from 'lucide-react'
import type { Change, EffectiveIdentity } from '../../../shared/types'
import { Button, Checkbox, EmptyState, IconButton, TextArea, TextInput, Tooltip } from '@/ui'
import { cn } from '@/ui/cn'
import { call } from '@/lib/api'
import { plural } from '@/lib/format'
import { setPrefs, useApp, useRepo } from '@/store'
import * as act from '@/actions'
import { FileList, toStatus, type FileItem } from './FileList'

const opText = {
  merge: (o: { head?: string }) => `Merging${o.head ? ` (${o.head})` : ''}.`,
  rebase: (o: { step?: number; total?: number; head?: string }) => `Rebasing ${o.head ?? 'your branch'}: commit ${o.step ?? '?'} of ${o.total ?? '?'}.`,
  cherry_pick: () => 'Cherry-picking a commit.',
  revert: () => 'Reverting a commit.'
}

/** S05: the uncommitted changes, staging, and the commit composer. */
export function WipPanel({ repoId }: { repoId: string }): React.JSX.Element {
  const status = useRepo(repoId, (r) => r.status)
  const refs = useRepo(repoId, (r) => r.refs)
  const center = useRepo(repoId, (r) => r.center)
  const busy = useRepo(repoId, (r) => r.busy)
  const pushAfter = useApp((s) => s.prefs.pushAfterCommit)
  const draft = useRepo(repoId, (r) => r.draft)
  const summary = draft.summary
  const body = draft.body
  type Up = string | ((cur: string) => string)
  const setSummary = (v: Up): void => act.setDraft(repoId, { summary: typeof v === 'function' ? v(useApp.getState().repos[repoId]?.draft.summary ?? '') : v })
  const setBody = (v: Up): void => act.setDraft(repoId, { body: typeof v === 'function' ? v(useApp.getState().repos[repoId]?.draft.body ?? '') : v })
  const [amend, setAmend] = useState(false)
  const [noVerify, setNoVerify] = useState(false)
  const saved = useRef<{ summary: string; body: string } | null>(null)

  const changes = status?.changes ?? []
  const conflicted = changes.filter((c) => c.conflicted)
  const staged: FileItem[] = changes.filter((c) => !c.conflicted && c.index !== '.' && c.index !== '?').map((c) => ({ path: c.path, origPath: c.origPath, status: toStatus(c.index) }))
  const showUntracked = useApp((s) => s.prefs.showUntracked)
  const allUnstaged: FileItem[] = changes
    .filter((c) => c.conflicted || (c.worktree !== '.'))
    .map((c) => ({ path: c.path, origPath: c.origPath, status: c.conflicted ? 'conflicted' : toStatus(c.worktree) }))
  const unstaged = showUntracked ? allUnstaged : allUnstaged.filter((f) => f.status !== 'untracked')
  const hiddenUntracked = allUnstaged.length - unstaged.length
  const op = status?.op
  const paused = op && op.kind !== 'none'
  const openPath = center.kind === 'diff' || center.kind === 'merge' ? center.path : null

  // Amend fills the fields with the last commit's message, and puts the draft back when unticked.
  const toggleAmend = async (v: boolean): Promise<void> => {
    setAmend(v)
    if (v && refs?.head.sha) {
      saved.current = { summary, body }
      try {
        const d = await call('commit.details', { repoId, sha: refs.head.sha })
        setSummary(d.summary)
        setBody(d.body)
      } catch (err) {
        act.fail(err)
      }
    } else if (!v && saved.current) {
      setSummary(saved.current.summary)
      setBody(saved.current.body)
    }
  }

  // A commit template (git config commit.template) fills an empty message.
  useEffect(() => {
    let live = true
    call('commit.template', { repoId })
      .then((t) => {
        if (!live || !t) return
        const [first, ...rest] = t.split('\n')
        setSummary((cur) => cur || first)
        setBody((cur) => cur || rest.join('\n').trim())
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [repoId])

  useEffect(() => {
    const onFocus = (): void => document.getElementById('commit-summary')?.focus()
    window.addEventListener('gc:focus-summary', onFocus)
    return () => window.removeEventListener('gc:focus-summary', onFocus)
  }, [])

  const canCommit = (staged.length > 0 || amend) && summary.trim().length > 0 && !busy.commit && conflicted.length === 0
  const buttonLabel = useMemo(() => {
    if (conflicted.length) return 'Resolve conflicts first'
    if (!staged.length && !amend) return 'Stage files to commit'
    if (!summary.trim()) return 'Add a summary to commit'
    if (amend) return pushAfter ? 'Amend last commit and push' : 'Amend last commit'
    return `Commit ${plural(staged.length, 'file')}${pushAfter ? ' and push' : ''}`
  }, [conflicted.length, staged.length, amend, summary, pushAfter])

  const doCommit = async (): Promise<void> => {
    if (!canCommit) return
    const ok = await act.commit(repoId, { summary, body, amend, noVerify, push: pushAfter })
    if (ok) {
      // act.commit already cleared the message.
      setAmend(false)
      saved.current = null
    }
  }

  const fileMenu = (f: FileItem, side: 'staged' | 'unstaged') => [
    side === 'unstaged'
      ? { type: 'item' as const, label: 'Stage', onSelect: () => void act.stage(repoId, [f.path]) }
      : { type: 'item' as const, label: 'Unstage', onSelect: () => void act.unstage(repoId, [f.path]) },
    { type: 'item' as const, label: 'Copy path', onSelect: () => void navigator.clipboard.writeText(f.path) },
    { type: 'separator' as const },
    f.status === 'conflicted'
      ? { type: 'item' as const, label: 'Open in merge tool', icon: <GitCompare size={14} />, onSelect: () => act.externalTool(repoId, 'merge', f.path) }
      : {
          type: 'item' as const,
          label: 'Open in diff tool',
          icon: <GitCompare size={14} />,
          disabled: f.status === 'untracked',
          onSelect: () => act.externalTool(repoId, 'diff', f.path, side === 'staged')
        },
    { type: 'item' as const, label: 'Open in editor', icon: <ExternalLink size={14} />, disabled: f.status === 'deleted', onSelect: () => void act.openIn(repoId, 'editor', f.path) },
    { type: 'item' as const, label: 'Show in folder', icon: <FolderOpen size={14} />, disabled: f.status === 'deleted', onSelect: () => void act.openIn(repoId, 'folder', f.path) },
    { type: 'separator' as const },
    { type: 'item' as const, label: 'File history', icon: <History size={14} />, disabled: f.status === 'untracked' || f.status === 'added', onSelect: () => act.setCenter(repoId, { kind: 'history', path: f.path }) },
    { type: 'item' as const, label: 'Blame', icon: <UserSearch size={14} />, disabled: f.status === 'untracked' || f.status === 'added' || f.status === 'deleted', onSelect: () => act.setCenter(repoId, { kind: 'blame', path: f.path, rev: null }) },
    {
      type: 'item' as const,
      label: 'Ignore…',
      icon: <EyeOff size={14} />,
      disabled: f.status === 'conflicted',
      onSelect: () => act.openDialog({ kind: 'ignore', repoId, path: f.path, tracked: f.status !== 'untracked' })
    },
    { type: 'separator' as const },
    { type: 'item' as const, label: 'Discard changes…', danger: true, icon: <Trash2 size={14} />, onSelect: () => act.discard(repoId, [f.path]) }
  ]

  const open = (f: FileItem, source: 'worktree' | 'index'): void => {
    if (f.status === 'conflicted') act.setCenter(repoId, { kind: 'merge', path: f.path })
    else act.openDiff(repoId, f.path, { kind: source }, f.origPath)
  }

  if (!status) return <div className="p-4 text-muted">Loading…</div>

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
        <h2 className="flex-1 text-md text-text">Uncommitted changes</h2>
        <Tooltip content="Stash changes">
          <IconButton label="Stash changes" disabled={changes.length === 0 || !!paused || !refs?.head.sha} onClick={() => act.openDialog({ kind: 'stash', repoId })}>
            <Archive size={16} />
          </IconButton>
        </Tooltip>
        <Tooltip content="Discard all changes">
          <IconButton label="Discard all changes" disabled={changes.length === 0} onClick={() => act.discard(repoId, 'all')}>
            <Trash2 size={16} />
          </IconButton>
        </Tooltip>
      </header>

      {paused ? (
        <div role="region" aria-label="Paused operation" className="flex flex-col gap-2 border-b border-l-(length:--gc-stripe-w) border-border border-l-warning bg-surface-raised p-3">
          <p className="flex items-start gap-2 text-base text-text">
            <AlertTriangle size={16} className="mt-px shrink-0 text-warning" aria-hidden />
            <span>
              {opText[op!.kind as keyof typeof opText](op!)}{' '}
              {conflicted.length ? `Resolve ${plural(conflicted.length, 'conflicted file')}, then continue.` : 'All conflicts are resolved. Continue to finish.'}
            </span>
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="primary" disabled={conflicted.length > 0} loading={!!busy.op} onClick={() => void act.continueOp(repoId)}>
              Continue
            </Button>
            {op!.kind === 'rebase' ? (
              <Button size="sm" onClick={() => void act.skipOp(repoId)}>
                Skip this commit
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" className="text-danger" onClick={() => act.abortOp(repoId)}>
              Abort
            </Button>
          </div>
        </div>
      ) : null}

      {changes.length === 0 && !paused ? (
        <div className="flex-1">
          <EmptyState icon={CheckCircle2} title="All tidy" body="Your folder matches the last commit. Nothing to stage, nothing to fix." />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col divide-y divide-border overflow-y-auto">
          <FileList
            title={conflicted.length ? 'Not staged (conflicts first)' : 'Not staged'}
            files={unstaged}
            selected={openPath}
            onOpen={(f) => open(f, 'worktree')}
            // With untracked files hidden, Stage all stages only what's listed.
            bulk={{ label: 'Stage all', onClick: () => void act.stage(repoId, hiddenUntracked ? unstaged.map((f) => f.path) : 'all') }}
            tools={
              <Tooltip content={showUntracked ? 'Hide untracked files' : 'Show untracked files'}>
                <IconButton label="Hide untracked files" size="sm" pressed={!showUntracked} onClick={() => setPrefs({ showUntracked: !showUntracked })}>
                  {showUntracked ? <Eye size={14} /> : <EyeOff size={14} />}
                </IconButton>
              </Tooltip>
            }
            note={
              hiddenUntracked ? (
                <p className="flex items-center gap-1 px-3 pb-1 text-sm text-muted">
                  {plural(hiddenUntracked, 'untracked file')} hidden.
                  <Button size="sm" variant="ghost" className="text-accent-text" onClick={() => setPrefs({ showUntracked: true })}>
                    Show
                  </Button>
                </p>
              ) : null
            }
            rowAction={{ label: 'Stage', onClick: (f) => (f.status === 'conflicted' ? open(f, 'worktree') : void act.stage(repoId, [f.path])) }}
            menu={(f) => fileMenu(f, 'unstaged')}
            emptyText="Everything is staged."
            onKey={(e, f) => {
              if (e.key === 's') void act.stage(repoId, [f.path])
              if (e.key === 'Delete') act.discard(repoId, [f.path])
            }}
          />
          <FileList
            title="Staged"
            files={staged}
            selected={openPath}
            onOpen={(f) => open(f, 'index')}
            bulk={{ label: 'Unstage all', onClick: () => void act.unstage(repoId, 'all') }}
            rowAction={{ label: 'Unstage', onClick: (f) => void act.unstage(repoId, [f.path]) }}
            menu={(f) => fileMenu(f, 'staged')}
            emptyText="Stage files to include them in the next commit."
            onKey={(e, f) => e.key === 'u' && void act.unstage(repoId, [f.path])}
          />
        </div>
      )}

      <form
        aria-label="Commit"
        className="flex shrink-0 flex-col gap-2 border-t border-border p-3"
        onSubmit={(e) => {
          e.preventDefault()
          void doCommit()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && e.ctrlKey) {
            e.preventDefault()
            void doCommit()
          }
        }}
      >
        <div className="relative">
          <TextInput
            id="commit-summary"
            aria-label="Commit summary"
            placeholder="Summary (required)"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            className="pr-10"
          />
          <span
            aria-label={`${summary.length} characters`}
            className={cn(
              'absolute top-1/2 right-2 -translate-y-1/2 text-xs tabular-nums',
              summary.length > 72 ? 'text-danger' : summary.length > 50 ? 'text-warning' : 'text-muted'
            )}
          >
            {summary.length}
          </span>
        </div>
        <TextArea aria-label="Commit description" placeholder="Description" value={body} onChange={(e) => setBody(e.target.value)} />
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          <Checkbox label="Amend last commit" checked={amend} disabled={!refs?.head.sha} onCheckedChange={(v) => void toggleAmend(v)} />
          <Checkbox label="Push after committing" checked={pushAfter} disabled={!refs?.head.branch} onCheckedChange={(v) => setPrefs({ pushAfterCommit: v })} />
          <Checkbox label="Skip hooks" checked={noVerify} onCheckedChange={setNoVerify} />
        </div>
        <Button type="submit" variant="primary" size="lg" className="w-full" disabled={!canCommit} loading={!!busy.commit}>
          {buttonLabel}
        </Button>
        <CommitAs repoId={repoId} />
      </form>
    </div>
  )
}

/** Who the commit will be by. With several profiles, this is the line that saves a commit under the wrong email. */
function CommitAs({ repoId }: { repoId: string }): React.JSX.Element | null {
  const profile = useApp((s) => s.profiles.find((p) => p.isActive))
  const several = useApp((s) => s.profiles.length > 1)
  const [who, setWho] = useState<EffectiveIdentity | null>(null)
  useEffect(() => {
    let live = true
    call('identity.effective', { repoId })
      .then((w) => live && setWho(w))
      .catch(() => live && setWho(null))
    return () => {
      live = false
    }
  }, [repoId, profile])
  if (!who) return null
  const from = who.from === 'repo' ? 'this repository’s setting' : who.from === 'profile' ? `the ${profile?.name ?? ''} profile` : several ? 'Git’s global setting' : null
  return (
    <p className="truncate text-xs text-muted" title={`${who.name} <${who.email}>`}>
      As {who.name} &lt;{who.email}&gt;{from ? ` · from ${from}` : ''}
    </p>
  )
}

export type { Change }

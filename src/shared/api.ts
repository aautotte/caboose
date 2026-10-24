// The IPC contract. Every channel: input and output types. Main validates inputs with zod (main/ipc/schemas.ts).
import type {
  ActivityEntry,
  AuthPromptEvent,
  Blame,
  EffectiveIdentity,
  FileHistoryEntry,
  GitConfigKey,
  GitIdentity,
  GpuState,
  GraphColumn,
  Profile,
  RebasePreview,
  RebaseRow,
  RebaseStep,
  RefViewState,
  SshKey,
  Remote,
  ResetMode,
  CommitDetails,
  ConflictFile,
  DiffSource,
  FileDiff,
  GraphPage,
  OpResult,
  ProgressEvent,
  PullMode,
  RepoChangedEvent,
  RepoList,
  RepoSummary,
  Refs,
  Status,
  UndoPeek
} from './types'

type R = { repoId: string }

export interface Api {
  'dialog.pickFolder': { in: { title: string }; out: string | null }

  'repo.open': { in: { path: string }; out: RepoSummary }
  'repo.list': { in: Record<string, never>; out: RepoList }
  'repo.close': { in: R; out: null }
  'repo.reorderTabs': { in: { repoIds: string[] }; out: null }
  'repo.update': { in: R & { alias?: string | null; isFavorite?: boolean; groupId?: string | null }; out: RepoSummary }
  'group.create': { in: { name: string }; out: { id: string } }
  'group.rename': { in: { groupId: string; name: string }; out: null }
  'group.delete': { in: { groupId: string }; out: null }
  'repo.forget': { in: R; out: null }
  'repo.clone': { in: { url: string; dest: string; opId: string; depth?: number; branch?: string; sparse?: string[] }; out: RepoSummary }
  'repo.init': { in: { parentDir: string; name: string; defaultBranch: string; gitignore: string | null; license: string | null }; out: RepoSummary }
  'op.cancel': { in: { opId: string }; out: null }

  'graph.load': { in: R & { skip: number; limit: number }; out: GraphPage }
  'refs.list': { in: R; out: Refs }
  'status.get': { in: R; out: Status }
  'commit.details': { in: R & { sha: string }; out: CommitDetails }
  'diff.get': { in: R & { path: string; oldPath?: string; source: DiffSource; force?: boolean; full?: boolean; ignoreWs?: boolean }; out: FileDiff }
  'search.commits': { in: R & { query: string }; out: string[] }

  'index.stage': { in: R & { paths: string[] | 'all' }; out: null }
  'index.unstage': { in: R & { paths: string[] | 'all' }; out: null }
  'commit.create': { in: R & { summary: string; body: string; amend: boolean; noVerify: boolean; messageOnly?: boolean }; out: { sha: string } }
  'worktree.discard': { in: R & { paths: string[] | 'all' }; out: null }

  'branch.create': { in: R & { name: string; at: string; checkout: boolean }; out: null }
  'branch.checkout': { in: R & { ref: string }; out: null }
  'branch.rename': { in: R & { name: string; newName: string }; out: null }
  'branch.delete': { in: R & { name: string; force: boolean }; out: null }
  /** Deletes the branch `name` on `remote`; returns the commit it pointed at, if known. */
  'branch.deleteRemote': { in: R & { remote: string; name: string; opId: string }; out: string | null }
  'branch.merge': { in: R & { source: string }; out: OpResult }
  'branch.rebase': { in: R & { onto: string; branch?: string }; out: OpResult }
  'branch.setUpstream': { in: R & { name: string; upstream: string }; out: null }

  'remote.fetch': { in: R & { opId: string; background?: boolean }; out: null }
  'remote.pull': { in: R & { mode: PullMode; opId: string }; out: OpResult }
  'remote.push': { in: R & { opId: string; remote?: string; branch?: string; setUpstream?: boolean; force?: boolean }; out: OpResult }

  'conflict.get': { in: R & { path: string }; out: ConflictFile }
  'conflict.resolve': { in: R & { path: string; content: string }; out: null }
  'conflict.take': { in: R & { path: string; side: 'ours' | 'theirs' }; out: null }
  'op.continue': { in: R; out: OpResult }
  'op.abort': { in: R; out: null }
  'op.skip': { in: R; out: OpResult }

  'undo.peek': { in: R; out: UndoPeek }
  'undo.undo': { in: R; out: null }
  'undo.redo': { in: R; out: null }

  'activity.list': { in: { repoId?: string; limit: number }; out: ActivityEntry[] }

  /** Stage, unstage or discard one hunk, or some of its lines. `header` must match what the user saw. */
  'index.applyPatch': {
    in: R & { path: string; source: 'worktree' | 'index'; hunk: number; header: string; lines: number[] | null; action: 'stage' | 'unstage' | 'discard'; full: boolean }
    out: null
  }
  'ignore.add': { in: R & { pattern: string; stopTracking: string[] }; out: null }

  'stash.save': { in: R & { message: string; stagedOnly: boolean; includeUntracked: boolean }; out: OpResult }
  'stash.apply': { in: R & { sha: string }; out: OpResult }
  'stash.pop': { in: R & { sha: string }; out: OpResult }
  'stash.drop': { in: R & { sha: string }; out: null }

  'tag.create': { in: R & { name: string; at: string; message: string | null }; out: null }
  'tag.delete': { in: R & { name: string }; out: null }
  'tag.push': { in: R & { name: string; remote: string; opId: string }; out: null }
  'tag.deleteRemote': { in: R & { name: string; remote: string; opId: string }; out: null }

  'history.reset': { in: R & { target: string; mode: ResetMode }; out: null }
  'history.revert': { in: R & { sha: string }; out: OpResult }
  'history.cherryPick': { in: R & { shas: string[] }; out: OpResult }
  'cherry.preview': { in: R & { tip: string }; out: RebaseRow[] }
  'rebase.preview': { in: R & { onto: string }; out: RebasePreview }
  'rebase.interactive': { in: R & { onto: string; plan: RebaseStep[] }; out: OpResult }

  'remote.list': { in: R; out: Remote[] }
  'remote.add': { in: R & { name: string; url: string }; out: null }
  'remote.remove': { in: R & { name: string }; out: null }

  'file.history': { in: R & { path: string; limit: number }; out: FileHistoryEntry[] }
  'file.blame': { in: R & { path: string; rev: string | null }; out: Blame }

  'refView.get': { in: R; out: RefViewState }
  'refView.set': { in: R & { ref: string; state: 'normal' | 'hidden' | 'soloed' }; out: RefViewState }
  'refView.pin': { in: R & { ref: string | null }; out: RefViewState }
  'refView.setMany': { in: R & { refs: string[]; state: 'normal' | 'hidden' }; out: RefViewState }
  'history.reword': { in: R & { sha: string; message: string }; out: OpResult }
  'history.squash': { in: R & { shas: string[]; message: string }; out: OpResult }
  'history.move': { in: R & { sha: string; direction: 'up' | 'down' }; out: OpResult }

  'prefs.getAll': { in: Record<string, never>; out: Record<string, unknown> }
  'prefs.set': { in: { key: string; value: unknown }; out: null }
  'identity.get': { in: { repoId?: string }; out: { global: GitIdentity; repo: GitIdentity | null } }
  'identity.set': { in: { repoId?: string; name: string; email: string }; out: null }
  'identity.effective': { in: R; out: EffectiveIdentity | null }
  'profile.list': { in: Record<string, never>; out: Profile[] }
  'profile.create': { in: { name: string }; out: Profile }
  'profile.update': { in: { id: string; name?: string; authorName?: string | null; authorEmail?: string | null; signingKey?: string | null; sshKey?: string | null }; out: Profile }
  'profile.delete': { in: { id: string }; out: null }
  'profile.switch': { in: { id: string }; out: null }
  'gpu.get': { in: Record<string, never>; out: GpuState }
  'gpu.set': { in: { on: boolean }; out: null }
  'app.restart': { in: Record<string, never>; out: null }

  'auth.respond': { in: { promptId: string; answer: string | null }; out: null }

  'stash.rename': { in: R & { sha: string; message: string }; out: null }
  'graph.getColumns': { in: R; out: GraphColumn[] | null }
  'graph.setColumns': { in: R & { columns: GraphColumn[] }; out: null }
  'repoPrefs.get': { in: R; out: Record<string, unknown> }
  'repoPrefs.set': { in: R & { key: string; value: unknown }; out: null }
  'gitConfig.get': { in: { repoId?: string }; out: { global: Partial<Record<GitConfigKey, string>>; repo: Partial<Record<GitConfigKey, string>> | null } }
  'gitConfig.set': { in: { repoId?: string; key: GitConfigKey; value: string | null }; out: null }
  'commit.template': { in: R; out: string | null }
  'shell.open': { in: R & { target: 'folder' | 'terminal' | 'editor'; path?: string }; out: null }
  'file.externalDiff': { in: R & { path: string; staged: boolean }; out: null }
  'file.externalMerge': { in: R & { path: string }; out: null }
  'ssh.keys': { in: Record<string, never>; out: SshKey[] }
  'ssh.generate': { in: { name: string; comment: string; passphrase: string }; out: SshKey }
}

export type Channel = keyof Api

export interface Events {
  'repo:changed': RepoChangedEvent
  'op:progress': ProgressEvent
  'auth:prompt': AuthPromptEvent
  'auth:closed': { promptId: string }
}

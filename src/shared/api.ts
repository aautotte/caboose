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
  Comparison,
  ConflictFile,
  DiffSource,
  FileDiff,
  GraphPage,
  LfsState,
  Submodule,
  SubmoduleMode,
  SubmoduleSettings,
  SubmoduleSyncResult,
  OpResult,
  ProgressEvent,
  PullMode,
  ReflogEntry,
  RepoChangedEvent,
  RepoList,
  RepoSummary,
  Refs,
  Status,
  UndoPeek,
  Worktree
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
  /** The full messages (summary and description) of these commits, in the order asked. */
  'commit.messages': { in: R & { shas: string[] }; out: { sha: string; message: string }[] }
  'diff.get': { in: R & { path: string; oldPath?: string; source: DiffSource; force?: boolean; full?: boolean; ignoreWs?: boolean }; out: FileDiff }
  'search.commits': { in: R & { query: string }; out: string[] }
  'lfs.state': { in: R; out: LfsState }
  'lfs.turnOn': { in: R & { opId: string }; out: null }
  'lfs.track': { in: R & { pattern: string; exact: boolean }; out: null }
  'lfs.untrack': { in: R & { pattern: string }; out: null }
  'submodule.list': { in: R; out: { list: Submodule[]; settings: SubmoduleSettings; present: boolean; superproject: string | null } }
  'submodule.goingBack': { in: R; out: Array<{ path: string; behind: number }> }
  'submodule.sync': { in: R & { from: string; to: string; opId: string }; out: SubmoduleSyncResult }
  'submodule.atRisk': { in: R & { to: string }; out: string[] }
  'submodule.unpushed': { in: R & { branch?: string }; out: Array<{ path: string; count: number; canPush: boolean }> }
  'submodule.push': { in: R & { path: string; opId: string }; out: null }
  'submodule.setup': { in: R & { paths: string[] | 'all'; shallow?: boolean; opId: string }; out: null }
  'submodule.update': { in: R & { paths: string[] | 'all'; opId: string }; out: null }
  'submodule.remove': { in: R & { paths: string[] }; out: null }
  'submodule.add': { in: R & { url: string; path: string; branch?: string; opId: string }; out: { path: string } }
  'submodule.setUrl': { in: R & { path: string; url: string }; out: null }
  'submodule.delete': { in: R & { path: string }; out: null }
  'submodule.setMode': { in: R & { names: string[]; mode: SubmoduleMode | null }; out: null }
  'submodule.settings': { in: R & Partial<SubmoduleSettings>; out: SubmoduleSettings }

  'worktrees.list': { in: R; out: Worktree[] }
  /** Checks out `branch` in a new folder, or a new branch `newBranch` starting at `at` (tracking it with `track`), or `at` detached. */
  'worktrees.add': { in: R & { path: string; branch?: string; newBranch?: string; at?: string; track?: boolean; opId: string }; out: { path: string } }
  /** Without `force`, a worktree with uncommitted changes is left alone and `dirty` says so. Closes its tab first; `closed` is that tab. */
  'worktrees.remove': { in: R & { path: string; force: boolean }; out: { removed: boolean; dirty: boolean; closed: string | null } }
  'worktrees.lock': { in: R & { path: string; locked: boolean }; out: null }
  'worktrees.prune': { in: R; out: null }
  /** A folder next to the repository for a new worktree of `branch` that doesn't exist yet. */
  'worktrees.suggestPath': { in: R & { branch: string }; out: string }

  'index.stage': { in: R & { paths: string[] | 'all' }; out: null }
  'index.unstage': { in: R & { paths: string[] | 'all' }; out: null }
  'commit.create': { in: R & { summary: string; body: string; amend: boolean; noVerify: boolean; messageOnly?: boolean }; out: { sha: string } }
  'worktree.discard': { in: R & { paths: string[] | 'all' }; out: null }

  'branch.create': { in: R & { name: string; at: string; checkout: boolean }; out: null }
  /** Bisect: start between a bad and a good commit; mark the one being tested (or another); stop. */
  'bisect.start': { in: R & { bad: string; good: string }; out: null }
  'bisect.mark': { in: R & { verdict: 'good' | 'bad' | 'skip'; sha?: string }; out: null }
  'bisect.reset': { in: R; out: null }
  /** git bisect run with a command; its output comes as op:output events. */
  'bisect.run': { in: R & { command: string; opId: string }; out: null }
  'branch.checkout': { in: R & { ref: string; opId?: string }; out: null }
  'branch.rename': { in: R & { name: string; newName: string }; out: null }
  'branch.delete': { in: R & { name: string; force: boolean }; out: null }
  /** Deletes what it can; the ones with unmerged commits (when not forced) come back in `unmerged`, untouched. One undo for all. */
  /**
   * Moves a local branch forward to `to` (default: its upstream) without checking it out, fetching that first when
   * `fetch`. Only a fast-forward; anything else is `rejected`. With `create`, a missing branch is made, tracking `to`.
   */
  'branch.fastForward': { in: R & { name: string; to?: string; fetch: boolean; create?: boolean; opId: string }; out: OpResult }
  /** Points a local branch that isn't checked out at `to` (a reset with no files involved). Undoable. */
  'branch.move': { in: R & { name: string; to: string }; out: null }
  'branch.deleteMany': { in: R & { names: string[]; force: boolean }; out: { deleted: string[]; unmerged: string[]; failed: { name: string; message: string }[] } }
  /** Deletes the branch `name` on `remote`; returns the commit it pointed at, if known. */
  'branch.deleteRemote': { in: R & { remote: string; name: string; opId: string }; out: string | null }
  /** One push that deletes several branches on `remote`. */
  'branch.deleteRemoteMany': { in: R & { remote: string; names: string[]; opId: string }; out: null }
  'branch.merge': { in: R & { source: string }; out: OpResult }
  'branch.rebase': { in: R & { onto: string; branch?: string }; out: OpResult }
  'branch.setUpstream': { in: R & { name: string; upstream: string }; out: null }

  'remote.fetch': { in: R & { opId: string; background?: boolean }; out: null }
  /** `autostash`: stash uncommitted changes first and put them back after. */
  'remote.pull': { in: R & { mode: PullMode; opId: string; autostash?: boolean }; out: OpResult }
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
  'ignore.add': { in: R & { patterns: string[]; label: string }; out: { untracked: number } }

  'stash.save': { in: R & { message: string; stagedOnly: boolean; includeUntracked: boolean }; out: OpResult }
  'stash.apply': { in: R & { sha: string }; out: OpResult }
  'stash.pop': { in: R & { sha: string }; out: OpResult }
  'stash.drop': { in: R & { sha: string }; out: null }
  /** Deletes several stashes, with one undo that brings them all back. */
  'stash.dropMany': { in: R & { shas: string[] }; out: { dropped: number; failed: { sha: string; message: string }[] } }

  'tag.create': { in: R & { name: string; at: string; message: string | null }; out: null }
  'tag.delete': { in: R & { name: string }; out: null }
  'tag.push': { in: R & { name: string; remote: string; opId: string }; out: null }
  'tag.deleteRemote': { in: R & { name: string; remote: string; opId: string }; out: null }
  /** Deletes several tags from your copy, with one undo. */
  'tag.deleteMany': { in: R & { names: string[] }; out: { deleted: string[]; failed: { name: string; message: string }[] } }
  /** One push of several tags to `remote`, or of their deletion there (`del`). */
  'tag.pushMany': { in: R & { names: string[]; remote: string; opId: string; del: boolean }; out: null }

  /** `branch`: the branch the user means to reset; refused if another one is checked out by then. */
  'history.reset': { in: R & { target: string; mode: ResetMode; branch?: string }; out: null }
  'history.revert': { in: R & { sha: string }; out: OpResult }
  'history.cherryPick': { in: R & { shas: string[] }; out: OpResult }
  'cherry.preview': { in: R & { tip: string }; out: RebaseRow[] }
  'rebase.preview': { in: R & { onto: string }; out: RebasePreview }
  /** `noVerify`: skip git hooks, as for a commit (they run by default). Also for reword and squash. */
  'rebase.interactive': { in: R & { onto: string; plan: RebaseStep[]; noVerify?: boolean }; out: OpResult }

  'remote.list': { in: R; out: Remote[] }
  'remote.add': { in: R & { name: string; url: string }; out: null }
  'remote.remove': { in: R & { name: string }; out: null }

  'file.history': { in: R & { path: string; limit: number }; out: FileHistoryEntry[] }
  'file.blame': { in: R & { path: string; rev: string | null }; out: Blame }
  /** What changed from `base` to `target` (or, `sinceSplit`, only on `target`'s side since they split), and the commits only one has. */
  'compare.get': { in: R & { base: string; target: string; sinceSplit: boolean }; out: Comparison }
  /** Where HEAD has been, newest first. */
  'reflog.list': { in: R & { limit: number }; out: ReflogEntry[] }

  'refView.get': { in: R; out: RefViewState }
  'refView.set': { in: R & { ref: string; state: 'normal' | 'hidden' | 'soloed' }; out: RefViewState }
  'refView.pin': { in: R & { ref: string | null }; out: RefViewState }
  'refView.setMany': { in: R & { refs: string[]; state: 'normal' | 'hidden' }; out: RefViewState }
  'history.reword': { in: R & { sha: string; message: string; noVerify?: boolean }; out: OpResult }
  'history.squash': { in: R & { shas: string[]; message: string; noVerify?: boolean }; out: OpResult }
  /** Folds the staged changes into an older commit of the current branch (unstaged ones are set aside and put back). */
  'history.amendInto': { in: R & { sha: string }; out: OpResult }
  /** git commit --fixup=<sha> with the staged changes. */
  'history.fixupCommit': { in: R & { sha: string; noVerify?: boolean }; out: null }
  /** git rebase --autosquash: every fixup!/squash!/amend! commit into the commit it names. */
  'history.autosquash': { in: R; out: OpResult }
  /** The commits the changed lines last came from (staged changes, else unstaged), and whether pure additions were left out. */
  'history.fixupTarget': { in: R; out: { shas: string[]; addOnly: boolean } }
  /**
   * Takes a file (`part` null), a block or some lines out of a commit on the current branch: dropped (`remove`), into a
   * new commit right after it (`split`, with `message`), or staged on top (`stage`; `staged` false when they couldn't
   * be placed there).
   */
  'history.patchOut': {
    in: R & { sha: string; path: string; oldPath?: string; part: { hunk: number; header: string; lines: number[] | null; full: boolean } | null; action: 'remove' | 'split' | 'stage'; message?: string }
    out: OpResult & { staged?: boolean }
  }
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
  'shell.open': { in: R & { target: 'folder' | 'terminal' | 'editor'; path?: string; worktree?: string }; out: null }
  'file.externalDiff': { in: R & { path: string; staged: boolean }; out: null }
  'file.externalMerge': { in: R & { path: string }; out: null }
  'ssh.keys': { in: Record<string, never>; out: SshKey[] }
  'ssh.generate': { in: { name: string; comment: string; passphrase: string }; out: SshKey }
}

export type Channel = keyof Api

export interface Events {
  'repo:changed': RepoChangedEvent
  'op:progress': ProgressEvent
  /** A line of output from a long command (bisect run). */
  'op:output': { opId: string; line: string }
  'auth:prompt': AuthPromptEvent
  'auth:closed': { promptId: string }
}

// Types shared by the main process and the renderer. Git data is read live, never stored.

export interface RepoSummary {
  id: string
  path: string
  name: string
  alias: string | null
  isFavorite: boolean
  isOpen: boolean
  tabOrder: number | null
  lastOpenedAt: number | null
  missing: boolean
  groupId: string | null
}

export interface RepoGroup {
  id: string
  name: string
}

export interface RepoList {
  open: RepoSummary[]
  recent: RepoSummary[]
  favorites: RepoSummary[]
  groups: Array<RepoGroup & { repos: RepoSummary[] }>
}

export type RowKind = 'commit' | 'stash' | 'wip'

export interface CommitRow {
  sha: string
  parents: string[]
  authorName: string
  authorEmail: string
  authorTime: number // unix seconds
  summary: string
  kind: RowKind
}

export interface GraphPage {
  commits: CommitRow[]
  hasMore: boolean
}

export type RefKind = 'local' | 'remote' | 'tag'

export interface Ref {
  name: string // full name, refs/heads/main
  short: string // main, origin/main, v1.0
  kind: RefKind
  sha: string // commit it points at (tags peeled)
  remote?: string
  upstream?: string // full name of the upstream ref
  ahead?: number
  behind?: number
  upstreamGone?: boolean
  isHead: boolean
  annotation?: string
  /** A local branch checked out in another worktree of this repository: that worktree's folder. */
  worktree?: string
}

export interface Stash {
  index: number
  sha: string
  base: string
  message: string
}

export interface Refs {
  head: { branch: string | null; sha: string | null; detached: boolean; unborn: boolean }
  refs: Ref[]
  stashes: Stash[]
  remotes: string[]
}

/** One letter per side, as git status reports it. '.' = unchanged. */
export type StatusCode = '.' | 'M' | 'A' | 'D' | 'R' | 'C' | 'T' | 'U' | '?'

export interface Change {
  path: string
  origPath?: string
  index: StatusCode
  worktree: StatusCode
  conflicted: boolean
  /** .gitattributes sends this path through Git LFS. */
  lfs?: boolean
  /** A submodule: whether it's on another commit than recorded, or has changes or new files inside. */
  submodule?: { commit: boolean; modified: boolean; untracked: boolean }
}

export type OperationKind = 'none' | 'merge' | 'rebase' | 'cherry_pick' | 'revert'

export interface OperationState {
  kind: OperationKind
  step?: number
  total?: number
  onto?: string
  head?: string
}

export interface Status {
  branch: string | null
  headSha: string | null
  upstream: string | null
  ahead: number
  behind: number
  changes: Change[]
  op: OperationState
  /** A git bisect in progress (started here or in a terminal), or null. */
  bisect: BisectState | null
}

/** What git bisect knows so far. The commit being tested is HEAD. */
export interface BisectState {
  /** Where Stop goes back to: the branch (or commit) checked out when it started. */
  start: string
  bad: string | null
  good: string[]
  skipped: string[]
  /** Commits still in question, newest first (up to 5000), once there's a good and a bad one. */
  candidates: string[] | null
  /** Roughly how many more steps, and how many commits are left. */
  steps: number | null
  left: number | null
  /** Found: the first bad commit. */
  firstBad: string | null
  /** The words for the two sides (good / bad, or e.g. old / new). */
  terms: { good: string; bad: string }
}

export interface Person {
  name: string
  email: string
}

export interface FileChange {
  path: string
  origPath?: string
  status: 'A' | 'M' | 'D' | 'R' | 'C' | 'T'
  /** The commit's .gitattributes sends this path through Git LFS. */
  lfs?: boolean
}

export interface CommitDetails {
  sha: string
  parents: string[]
  author: Person & { time: number; offset: string }
  committer: Person & { time: number }
  summary: string
  body: string
  coAuthors: Person[]
  files: FileChange[]
  isHead: boolean
  /** null when the commit isn't signed. */
  signature: CommitSignature | null
}

export interface CommitSignature {
  /** good: valid and trusted key; untrusted: valid, key not trusted; bad: doesn't verify; unknown: key not on this computer; expired / revoked as named. */
  status: 'good' | 'untrusted' | 'bad' | 'unknown' | 'expired' | 'revoked'
  signer: string
  key: string
}

export interface DiffLine {
  type: 'add' | 'del' | 'ctx'
  text: string
  oldNo?: number
  newNo?: number
  noNewline?: boolean
}

export interface Hunk {
  header: string
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: DiffLine[]
}

export interface FileDiff {
  path: string
  oldPath?: string
  binary: boolean
  tooLarge: boolean
  lineCount: number
  isNew: boolean
  isDeleted: boolean
  modeChange?: string
  hunks: Hunk[]
  /** Set when what changed is only an LFS pointer: the content lives in LFS, so the lines say nothing. null on the side with no file. */
  lfs?: { old: LfsPointer | null; new: LfsPointer | null }
  /** Set when the path is a submodule: which commit it pointed at and points at now, and what lies between. */
  submodule?: SubmoduleChange
}

/** A submodule's pointer moving, read in the submodule's own history when it's set up here. */
export interface SubmoduleChange {
  old: string | null
  new: string | null
  /** The submodule has changes inside that aren't committed there. */
  dirty: boolean
  /** forward: new is ahead of old; back: new is behind it (moving the pointer back); diverged: both have commits the other hasn't. */
  direction: 'forward' | 'back' | 'diverged' | 'same' | 'added' | 'removed' | 'unknown'
  /** Commits new has that old hasn't, and the other way round. */
  ahead: number
  behind: number
  /** The commits in between, newest first, at most 50: what new adds, or for "back" what it takes away. */
  commits: Array<{ sha: string; summary: string; author: string }>
  /** Why the direction is unknown. */
  reason?: 'not set up' | 'missing commits'
}

export interface LfsPointer {
  oid: string
  size: number
}

export type DiffSource =
  | { kind: 'worktree' } // unstaged: index -> worktree
  | { kind: 'index' } // staged: HEAD -> index
  | { kind: 'commit'; sha: string; parent?: string }

export interface ConflictFile {
  path: string
  binary: boolean
  base: string | null
  ours: string | null
  theirs: string | null
  merged: string // working file with markers
  /** The same conflicts with the common ancestor's lines too (diff3 style), built from the index stages; null if not available. */
  diff3: string | null
  oursLabel: string
  theirsLabel: string
}

export type PullMode = 'ff' | 'ff-only' | 'rebase'

/** How the app treats a submodule once it's set up. */
export type SubmoduleMode = 'follow' | 'manual' | 'working'

/** One submodule of the checked-out commit, as .gitmodules, the index and its own folder say. */
export interface Submodule {
  /** Its name in .gitmodules (stays the same when its path moves). */
  name: string
  path: string
  url: string | null
  /** The commit the repository expects (the index's pointer). */
  expected: string | null
  /** Its folder has a checkout. */
  setUp: boolean
  /** The commit it's on, when set up. */
  current: string | null
  /** The branch it's on; null when detached or not set up. */
  branch: string | null
  /** Set for this submodule in the repository's .git/config; null means the repository's default. */
  mode: SubmoduleMode | null
}

/** Per-repository submodule settings. */
export interface SubmoduleSettings {
  /** Off: the app treats submodules as plain git does and doesn't list them. */
  on: boolean
  mode: SubmoduleMode
  shallow: boolean
  nested: boolean
  /** How many at once (git's submodule.fetchJobs). */
  jobs: number
  /** Ask before a commit that moves a submodule's pointer back. */
  warnBack: boolean
  /** After a checkout, remove the folders git leaves behind for submodules the new commit doesn't have (when clean). */
  tidy: boolean
  /** Before pushing: off, check that the submodule commits it points at are pushed, or push those submodules first. */
  pushCheck: 'off' | 'check' | 'push'
}

/** One working tree of the repository, as `git worktree list` reports it. */
export interface Worktree {
  path: string
  /** The main working tree, the one that holds the .git folder. */
  main: boolean
  /** The worktree this tab shows. */
  current: boolean
  /** Short name of the branch checked out there; null when detached. */
  branch: string | null
  head: string | null
  /** Locked against pruning and removal; the reason, or '' when none was given. */
  locked: string | null
  /** Its folder is gone; `git worktree prune` forgets it. */
  missing: boolean
}

/** What happened to the submodules after HEAD moved. */
export interface SubmoduleSyncResult {
  updated: string[]
  restored: string[]
  removed: string[]
  /** Left alone: changes inside, or (Working in it) on a branch. */
  skipped: Array<{ path: string; why: 'changes' | 'branch' }>
}

/** Git LFS in one repository, as the system git sees it. */
export interface LfsState {
  /** A tracked .gitattributes sends some files through the LFS filter. */
  uses: boolean
  /** `git lfs` runs. */
  installed: boolean
  /** LFS's filters are in git's config (what `git lfs install` sets up); without them files commit and check out raw. */
  on: boolean
  /** The LFS rules in the root .gitattributes (where `git lfs track` writes), as written there. */
  patterns: string[]
}

export interface OpResult {
  /** dirty: uncommitted changes are in the way (a pull that would overwrite them). */
  result: 'ok' | 'conflicts' | 'rejected' | 'needsUpstream' | 'nothing' | 'stale' | 'dirty'
  message?: string
  /** A fast-forward refused: how many commits the branch has that the target doesn't. */
  ahead?: number
}

export interface UndoPeek {
  undo: { label: string } | null
  redo: { label: string } | null
}

export interface ActivityEntry {
  id: string
  repoId: string | null
  opId: string
  argv: string[]
  status: 'running' | 'ok' | 'error' | 'cancelled'
  exitCode: number | null
  stderrTail: string | null
  startedAt: number
  finishedAt: number | null
}

export interface GcError {
  code: 'git' | 'invalid' | 'not_repo' | 'busy' | 'auth' | 'changed_outside' | 'internal'
  message: string
  detail?: string
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: GcError }

export interface RepoChangedEvent {
  repoId: string
  what: Array<'refs' | 'index' | 'worktree'>
}

export interface ProgressEvent {
  opId: string
  phase: string
  percent?: number
}

export interface FileHistoryEntry extends CommitRow {
  status: 'A' | 'M' | 'D' | 'R' | 'C' | 'T'
  /** The file's name in this commit (it can differ from today's name after a rename). */
  path: string
  oldPath?: string
}

export interface BlameCommit {
  sha: string
  author: string
  email: string
  time: number
  summary: string
  uncommitted: boolean
}

export interface BlameLine {
  sha: string
  line: number
  text: string
}

export interface Blame {
  path: string
  lines: BlameLine[]
  commits: Record<string, BlameCommit>
}

export type ResetMode = 'soft' | 'mixed' | 'hard'

export type RebaseAction = 'pick' | 'reword' | 'squash' | 'fixup' | 'drop'

export interface RebaseRow {
  sha: string
  summary: string
  body: string
  authorName: string
  authorEmail: string
  authorTime: number
}

export interface RebaseStep {
  sha: string
  action: RebaseAction
  /** New message for reword. */
  message?: string
}

export interface RebasePreview {
  branch: string | null
  onto: string
  rows: RebaseRow[]
  /** Merge commits in the range: interactive rebase here would flatten them, so it's refused. */
  merges: number
}

export interface GitIdentity {
  name: string | null
  email: string | null
}

export interface RefViewState {
  hidden: string[]
  soloed: string[]
  /** Full ref name of the branch pinned to the left of the graph. */
  pinned: string | null
}

export interface Remote {
  name: string
  fetchUrl: string
  pushUrl: string
}

/** A profile: its own tabs, recent list and settings, and optionally its own author and keys. Null = Git's config. */
export interface Profile {
  id: string
  name: string
  authorName: string | null
  authorEmail: string | null
  /** GPG key ID used when signing (user.signingkey). */
  signingKey: string | null
  /** A private key file name in ~/.ssh, used for fetch and push (core.sshCommand). */
  sshKey: string | null
  isActive: boolean
}

/** Who the next commit will be by, and where that comes from. */
export interface EffectiveIdentity {
  name: string
  email: string
  from: 'repo' | 'profile' | 'git'
}

export interface GpuState {
  /** Graphics acceleration in use now. */
  enabled: boolean
  /** On at the next start. */
  nextStart: boolean
  /** It crashed last time, so this start is drawing without it (reported once). */
  fellBack: boolean
}

export interface SshKey {
  name: string
  type: string
  comment: string
  publicKey: string
}

export type GraphColumnKey = 'author' | 'date' | 'sha'

export interface GraphColumn {
  key: GraphColumnKey
  width: number
  visible: boolean
}

/** Git config keys the app reads and writes (Settings). */
export type GitConfigKey = 'user.signingkey' | 'commit.gpgsign' | 'commit.template' | 'diff.tool' | 'merge.tool'

export interface AuthPromptEvent {
  promptId: string
  prompt: string
  secret: boolean
}

import { create } from 'zustand'
import type { AuthPromptEvent, CommitRow, DiffSource, GraphColumn, Profile, PullMode, RefViewState, RepoSummary, Refs, Status, UndoPeek, LfsState, Submodule, SubmoduleSettings, Worktree } from '../../shared/types'
import { call } from './lib/api'
import type { Layout } from './graph/lanes'

export type Center =
  | { kind: 'graph' }
  | { kind: 'diff'; path: string; oldPath?: string; source: DiffSource }
  | { kind: 'merge'; path: string }
  | { kind: 'log' }
  | { kind: 'prefs' }
  | { kind: 'blame'; path: string; rev: string | null }
  | { kind: 'history'; path: string }
  /** `range`: only these commits are offered for editing; the ones after them are replayed as they are. */
  /** `ontoBranch`: onto another branch (moving the commits there), rather than rewriting after one of its own commits. */
  | { kind: 'rebase'; onto: string; ontoLabel: string; range?: string[]; ontoBranch?: boolean }
  | { kind: 'cherry'; tip: string; tipLabel: string }
  | { kind: 'reflog' }

export interface RepoState {
  refs: Refs | null
  status: Status | null
  commits: CommitRow[]
  hasMore: boolean
  layout: Layout | null
  loading: boolean
  loadError: string | null
  /** 'wip' or a sha. */
  selected: string | null
  /** Commits picked with Ctrl / Shift-click, newest first as in the graph; empty or one entry means a single selection. */
  multi: string[]
  /** A commit whose message the details panel should open for editing (set from the graph's menu). */
  editing: string | null
  center: Center
  undo: UndoPeek
  /** Running remote / long operations, by key. */
  busy: Partial<Record<'fetch' | 'pull' | 'push' | 'commit' | 'op' | 'checkout', string>>
  progress: { phase: string; percent?: number; done?: number; total?: number } | null
  lastFetch: number | null
  fetchFailed: boolean
  search: string
  searchHits: string[] | null
  refView: RefViewState
  /** Auto-fetch stops after an auth failure until the next manual fetch. */
  autoFetchPaused: boolean
  openedAt: number
  /** Optional graph columns, in order, with saved widths. */
  columns: GraphColumn[]
  /** Graph shows only the checked-out branch, its upstream and the main line. */
  focusHead: boolean
  /** The Graph column's width as the user dragged it; null fits it to the lanes. */
  graphWidth: number | null
  /** The Branch / tag column's width, if the user dragged it; null follows the window. */
  refsWidth: number | null
  /** The commit message being written. Kept here, not in the panel, so it survives looking at other commits. */
  draft: { summary: string; body: string }
  /** Read when the repository opens and after "Check again"; null until then. */
  lfs: LfsState | null
  /** "Not now" on the LFS notice, for this session. */
  lfsDismissed: boolean
  /** The checked-out commit's submodules and this repository's submodule settings; null until read. */
  submodules: { list: Submodule[]; settings: SubmoduleSettings; present: boolean; superproject: string | null } | null
  /** A submodule set-up or update running in the background. */
  subOp: { label: string; opId: string; phase?: string; percent?: number; done?: number; total?: number } | null
  /** Every worktree of the repository, this one included; null until read. */
  worktrees: Worktree[] | null
  /** git bisect run going on: the command, and the last lines it printed. */
  bisectRun: { opId: string; command: string; lines: string[] } | null
}

// Mirrors --gc-col-*-w in the tokens: the starting widths before the user drags a column.
export const DEFAULT_COLUMNS: GraphColumn[] = [
  { key: 'author', width: 150, visible: true },
  { key: 'date', width: 120, visible: true },
  { key: 'sha', width: 76, visible: true }
]

export type Dialog =
  | { kind: 'clone' }
  | { kind: 'init' }
  | { kind: 'createBranch'; repoId: string; at: string; atLabel: string }
  | { kind: 'renameBranch'; repoId: string; name: string }
  | { kind: 'publish'; repoId: string; branch: string }
  | { kind: 'shortcuts' }
  | { kind: 'stash'; repoId: string }
  | { kind: 'createTag'; repoId: string; at: string; atLabel: string }
  | { kind: 'addRemote'; repoId: string }
  /** `branch`: a local branch other than the checked-out one, which just moves (no files involved). */
  | { kind: 'reset'; repoId: string; target: string; targetLabel: string; branch?: string }
  | { kind: 'upstream'; repoId: string; branch: string }
  | { kind: 'renameStash'; repoId: string; sha: string; message: string }
  | { kind: 'groupName'; mode: 'create' | 'rename'; name: string; groupId?: string; repoId?: string }
  | { kind: 'squash'; repoId: string; shas: string[]; message: string }
  /** Start a bisect; either side can come filled in (from a commit's menu). */
  | { kind: 'bisect'; repoId: string; bad?: string; good?: string }
  /** Test each step of the bisect going on with a command. */
  | { kind: 'bisectRun'; repoId: string }
  | { kind: 'profiles'; edit?: string }
  /** A new worktree: of `branch` (local, free), as a new branch tracking `remote` (a remote branch's short name), or from the commit `at`. */
  | { kind: 'addWorktree'; repoId: string; branch?: string; remote?: string; at?: string; atLabel?: string }
  | { kind: 'addSubmodule'; repoId: string }
  | { kind: 'submoduleUrl'; repoId: string; path: string; url: string }
  | {
      kind: 'confirm'
      title: string
      body: string
      confirmLabel: string
      danger: boolean
      undoable: boolean | null
      onConfirm: (checked: boolean) => void
      alt?: { label: string; onSelect: () => void; danger?: boolean }
      check?: { label: string; note?: string }
    }

export type DiffMode = 'hunk' | 'inline' | 'split'

export interface Prefs {
  pullMode: PullMode
  leftWidth: number
  detailWidth: number
  theme: 'dark' | 'light' | 'system'
  pushAfterCommit: boolean
  /** Minutes between background fetches; 0 turns it off. */
  autoFetchMinutes: number
  diffMode: DiffMode
  diffWrap: boolean
  stashUntracked: boolean
  historyListWidth: number
  /** Code size in diffs, blame and the merge tool, in px. */
  codeFontSize: number
  tabSize: number
  /** Empty means the platform default (see main/tools.ts). */
  terminalCommand: string
  editorCommand: string
  /** Show the common ancestor's lines between yours and theirs in the merge tool. */
  mergeShowBase: boolean
  /** Diffs leave out lines that only changed whitespace (git diff -w). Line staging is off while it's on. */
  diffIgnoreWs: boolean
  /** List files Git doesn't track yet among the unstaged changes. */
  showUntracked: boolean
  /** Changed-file lists show their folders as a tree instead of one flat list. */
  fileTree: boolean
  /** The side panels shrunk to a thin rail (Ctrl+J, Ctrl+K). */
  leftCollapsed: boolean
  detailCollapsed: boolean
}

// Preferences live in the app database (main process). A copy in localStorage paints the right theme
// before that answer arrives.
const PREFS_KEY = 'caboose.prefs'
const LEGACY_PREFS_KEY = 'mergatroid.prefs'
export const defaultPrefs: Prefs = {
  pullMode: 'ff',
  leftWidth: 240,
  detailWidth: 380,
  theme: 'dark',
  pushAfterCommit: false,
  autoFetchMinutes: 1,
  diffMode: 'hunk',
  diffWrap: false,
  stashUntracked: true,
  historyListWidth: 320,
  codeFontSize: 12,
  tabSize: 4,
  terminalCommand: '',
  editorCommand: '',
  mergeShowBase: true,
  diffIgnoreWs: false,
  showUntracked: true,
  fileTree: false,
  leftCollapsed: false,
  detailCollapsed: false
}

function loadPrefs(): Prefs {
  try {
    return { ...defaultPrefs, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? localStorage.getItem(LEGACY_PREFS_KEY) ?? '{}') }
  } catch {
    return defaultPrefs
  }
}

export const emptyRepo = (): RepoState => ({
  refs: null,
  status: null,
  commits: [],
  hasMore: false,
  layout: null,
  loading: true,
  loadError: null,
  selected: null,
  multi: [],
  editing: null,
  center: { kind: 'graph' },
  undo: { undo: null, redo: null },
  busy: {},
  progress: null,
  lastFetch: null,
  fetchFailed: false,
  search: '',
  searchHits: null,
  refView: { hidden: [], soloed: [], pinned: null },
  autoFetchPaused: false,
  openedAt: Date.now(),
  columns: DEFAULT_COLUMNS,
  focusHead: false,
  graphWidth: null,
  refsWidth: null,
  draft: { summary: '', body: '' },
  lfs: null,
  lfsDismissed: false,
  submodules: null,
  subOp: null,
  worktrees: null,
  bisectRun: null
})

export interface AppState {
  ready: boolean
  tabs: RepoSummary[]
  active: string // repo id or 'home'
  repos: Record<string, RepoState>
  dialog: Dialog | null
  paletteOpen: boolean
  /** "Use the full width" in a diff: hides both side panels while a diff is open, and only then. */
  diffWide: boolean
  prefs: Prefs
  authPrompt: AuthPromptEvent | null
  /** Every profile; the active one has isActive. */
  profiles: Profile[]
  /** Goes up whenever a name or email is saved, so whatever shows "who commits" reads it again. */
  identityVersion: number
}

export const useApp = create<AppState>(() => ({
  ready: false,
  tabs: [],
  active: 'home',
  repos: {},
  dialog: null,
  paletteOpen: false,
  diffWide: false,
  prefs: loadPrefs(),
  authPrompt: null,
  profiles: [],
  identityVersion: 0
}))

function cachePrefs(prefs: Prefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // only the first-paint copy; the database has the real one
  }
}

export function setPrefs(patch: Partial<Prefs>): void {
  const prefs = { ...useApp.getState().prefs, ...patch }
  useApp.setState({ prefs })
  cachePrefs(prefs)
  if (patch.theme) document.documentElement.dataset.theme = patch.theme
  for (const [key, value] of Object.entries(patch)) void call('prefs.set', { key, value }).catch(() => {})
}

/** Loads saved preferences from the database. The first run moves any older localStorage copy across. */
export async function loadSavedPrefs(): Promise<void> {
  const saved = (await call('prefs.getAll', {}).catch(() => null)) as Partial<Prefs> | null
  if (!saved) return
  const known = Object.fromEntries(Object.entries(saved).filter(([k]) => k in defaultPrefs)) as Partial<Prefs>
  if (Object.keys(known).length === 0) {
    setPrefs(useApp.getState().prefs)
    return
  }
  const prefs = { ...defaultPrefs, ...known }
  useApp.setState({ prefs })
  cachePrefs(prefs)
}

export function patchRepo(repoId: string, patch: Partial<RepoState> | ((r: RepoState) => Partial<RepoState>)): void {
  useApp.setState((s) => {
    const cur = s.repos[repoId] ?? emptyRepo()
    const p = typeof patch === 'function' ? patch(cur) : patch
    return { repos: { ...s.repos, [repoId]: { ...cur, ...p } } }
  })
}

// One shared fallback, so selectors return stable values before a repo has loaded.
const EMPTY: RepoState = emptyRepo()

export const useRepo = <T,>(repoId: string, pick: (r: RepoState) => T): T =>
  useApp((s) => pick(s.repos[repoId] ?? EMPTY))

import { create } from 'zustand'
import type { AuthPromptEvent, CommitRow, DiffSource, GraphColumn, Profile, PullMode, RefViewState, RepoSummary, Refs, Status, UndoPeek } from '../../shared/types'
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
  | { kind: 'rebase'; onto: string; ontoLabel: string; range?: string[] }
  | { kind: 'cherry'; tip: string; tipLabel: string }

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
  busy: Partial<Record<'fetch' | 'pull' | 'push' | 'commit' | 'op', string>>
  progress: { phase: string; percent?: number } | null
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
  /** The commit message being written. Kept here, not in the panel, so it survives looking at other commits. */
  draft: { summary: string; body: string }
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
  | { kind: 'reset'; repoId: string; target: string; targetLabel: string }
  | { kind: 'ignore'; repoId: string; path: string; tracked: boolean }
  | { kind: 'upstream'; repoId: string; branch: string }
  | { kind: 'renameStash'; repoId: string; sha: string; message: string }
  | { kind: 'groupName'; mode: 'create' | 'rename'; name: string; groupId?: string; repoId?: string }
  | { kind: 'squash'; repoId: string; shas: string[]; message: string }
  | { kind: 'profiles'; edit?: string }
  | {
      kind: 'confirm'
      title: string
      body: string
      confirmLabel: string
      danger: boolean
      undoable: boolean
      onConfirm: () => void
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
  showUntracked: true
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
  draft: { summary: '', body: '' }
})

export interface AppState {
  ready: boolean
  tabs: RepoSummary[]
  active: string // repo id or 'home'
  repos: Record<string, RepoState>
  dialog: Dialog | null
  paletteOpen: boolean
  leftOpen: boolean
  detailOpen: boolean
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
  leftOpen: true,
  detailOpen: true,
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

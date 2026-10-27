// Every user action that touches git goes through here: call main, toast on failure, refresh what changed.
import type { DiffSource, GraphColumn, OpResult, PullMode, RebaseStep, Ref, ResetMode, SubmoduleMode, SubmoduleSettings, SubmoduleSyncResult, Worktree } from '../../shared/types'
import { ApiError, call, newOpId, on } from './lib/api'
import { plural } from './lib/format'
import type { IgnoreChoice } from './lib/ignore'
import { layoutInWorker } from './graph/layoutClient'
import { toast } from './ui/toastBus'
import { DEFAULT_COLUMNS, emptyRepo, loadSavedPrefs, patchRepo, useApp, type Center, type Dialog } from './store'

const PAGE = 2000

export function fail(err: unknown, title?: string): void {
  const e = err instanceof ApiError ? err : null
  toast({
    tone: 'error',
    title: title ?? e?.message ?? 'Something went wrong',
    body: title ? e?.message : undefined,
    action: e?.detail ? { label: 'Show details', onClick: () => openLog() } : undefined
  })
}

/** Runs fn; on failure shows a toast and returns undefined. */
async function attempt<T>(fn: () => Promise<T>, title?: string): Promise<T | undefined> {
  try {
    return await fn()
  } catch (err) {
    fail(err, title)
    return undefined
  }
}

// ---------- app start, tabs ----------

export async function boot(): Promise<void> {
  await loadSavedPrefs()
  on('auth:prompt', (p) => useApp.setState({ authPrompt: p }))
  on('auth:closed', ({ promptId }) => {
    if (useApp.getState().authPrompt?.promptId === promptId) useApp.setState({ authPrompt: null })
  })
  startAutoFetch()
  void loadProfiles()
  void call('gpu.get', {})
    .then((g) => {
      if (g.fellBack)
        toast({ tone: 'info', title: 'Started without graphics acceleration', body: 'It crashed last time, so Caboose is drawing in software. You can turn it back on in Settings.' })
    })
    .catch(() => {})
  const list = await attempt(() => call('repo.list', {}))
  const tabs = list?.open ?? []
  useApp.setState({ tabs, active: tabs[0]?.id ?? 'home', ready: true })
  for (const t of tabs) void loadRepo(t.id)
  on('repo:changed', (e) => {
    if (!useApp.getState().repos[e.repoId]) return
    if (e.what.includes('refs')) void loadRepo(e.repoId, { keepSelection: true })
    else void loadStatus(e.repoId)
  })
  on('op:progress', (p) => {
    const s = useApp.getState()
    for (const [id, r] of Object.entries(s.repos)) {
      if (r.subOp?.opId === p.opId) patchRepo(id, { subOp: { ...r.subOp, phase: p.phase, percent: p.percent } })
      else if (Object.keys(r.busy).length) patchRepo(id, { progress: { phase: p.phase, percent: p.percent } })
    }
  })
  window.addEventListener('focus', () => {
    const id = useApp.getState().active
    if (id !== 'home') void loadStatus(id)
  })
}

export function setActive(id: string): void {
  useApp.setState({ active: id })
}

export async function openRepo(path: string): Promise<boolean> {
  const repo = await attempt(() => call('repo.open', { path }), 'Couldn’t open that folder')
  if (!repo) return false
  useApp.setState((s) => ({
    tabs: s.tabs.some((t) => t.id === repo.id) ? s.tabs.map((t) => (t.id === repo.id ? repo : t)) : [...s.tabs, repo],
    active: repo.id
  }))
  void loadRepo(repo.id)
  return true
}

export async function pickAndOpen(): Promise<void> {
  const path = await attempt(() => call('dialog.pickFolder', { title: 'Open a repository' }))
  if (path) await openRepo(path)
}

export async function closeTab(repoId: string): Promise<void> {
  await attempt(() => call('repo.close', { repoId }))
  useApp.setState((s) => {
    const idx = s.tabs.findIndex((t) => t.id === repoId)
    const tabs = s.tabs.filter((t) => t.id !== repoId)
    const repos = { ...s.repos }
    delete repos[repoId]
    const active = s.active === repoId ? (tabs[Math.min(idx, tabs.length - 1)]?.id ?? 'home') : s.active
    return { tabs, repos, active }
  })
}

export async function reorderTabs(ids: string[]): Promise<void> {
  useApp.setState((s) => ({ tabs: ids.map((id) => s.tabs.find((t) => t.id === id)!).filter(Boolean) }))
  await attempt(() => call('repo.reorderTabs', { repoIds: ids }))
}

// ---------- profiles ----------

/** A name, email or profile identity changed: anything showing who commits should ask again. */
export function identityChanged(): void {
  useApp.setState((s) => ({ identityVersion: s.identityVersion + 1 }))
}

export async function loadProfiles(): Promise<void> {
  const profiles = await attempt(() => call('profile.list', {}))
  if (profiles) useApp.setState({ profiles })
}

/** Another profile brings its own tabs and settings, so the main process reloads the window once it has switched. */
export async function switchProfile(id: string): Promise<void> {
  const s = useApp.getState()
  if (Object.values(s.repos).some((r) => Object.values(r.busy).some(Boolean))) {
    toast({ tone: 'info', title: 'Wait for the running action to finish', body: 'Then switch profiles.' })
    return
  }
  await attempt(() => call('profile.switch', { id }), 'Couldn’t switch profiles')
}

export function openDialog(d: Dialog): void {
  useApp.setState({ dialog: d })
}
export function closeDialog(): void {
  useApp.setState({ dialog: null })
}

export function confirm(d: Omit<Extract<Dialog, { kind: 'confirm' }>, 'kind'>): void {
  openDialog({ kind: 'confirm', ...d })
}

// ---------- loading ----------

// Refreshes can overlap (a file change, then the user's own action). Each kind gets a counter per repo and a
// result is only applied if no newer request of that kind started since; otherwise an older answer arriving
// late would put stale status back on screen (a staged file showing as unstaged again).
const statusSeq = new Map<string, number>()
const repoSeq = new Map<string, number>()
const next = (m: Map<string, number>, repoId: string): number => {
  const n = (m.get(repoId) ?? 0) + 1
  m.set(repoId, n)
  return n
}
const isLatest = (m: Map<string, number>, repoId: string, n: number): boolean => m.get(repoId) === n

export async function loadStatus(repoId: string): Promise<void> {
  const seq = next(statusSeq, repoId)
  try {
    const [status, undo] = await Promise.all([call('status.get', { repoId }), call('undo.peek', { repoId })])
    if (!isLatest(statusSeq, repoId, seq)) return
    const r = useApp.getState().repos[repoId]
    const dirty = status.changes.length > 0
    // The graph's top row comes and goes with uncommitted changes; the lanes have to move with it.
    if (r && r.layout && dirty !== (r.status?.changes.length ?? 0) > 0) {
      const commits = r.commits
      const layout = await layoutInWorker(withWip(commits, dirty, r.refs?.head.sha ?? null), pinnedLine(commits, r.refs, r.refView.pinned))
      if (!isLatest(statusSeq, repoId, seq) || useApp.getState().repos[repoId]?.commits !== commits) return
      patchRepo(repoId, { status, undo, layout })
    } else patchRepo(repoId, { status, undo })
    // A submodule's own commit or changes show up in the status; its row in the list follows.
    if (r?.submodules?.list.length) void loadSubmodules(repoId)
  } catch {
    // shown by the next full load
  }
}

/** Whether this repository uses Git LFS and whether the system git can run it; read once when it opens. */
export async function checkLfs(repoId: string): Promise<void> {
  const lfs = await attempt(() => call('lfs.state', { repoId }))
  if (lfs) patchRepo(repoId, { lfs })
}

export async function turnOnLfs(repoId: string): Promise<void> {
  patchRepo(repoId, (r) => ({ busy: { ...r.busy, op: 'Turning on Git LFS' }, progress: null }))
  try {
    await call('lfs.turnOn', { repoId, opId: newOpId() })
    toast({ tone: 'success', title: 'Git LFS is on', body: 'Large files are in place of their pointers, and new ones go to LFS.' })
  } catch (err) {
    fail(err, 'Couldn’t turn on Git LFS')
  } finally {
    patchRepo(repoId, (r) => ({ busy: { ...r.busy, op: undefined }, progress: null }))
  }
  await checkLfs(repoId)
  await loadRepo(repoId, { keepSelection: true })
}

// ---------- submodules ----------

const subSeq = new Map<string, number>()

export async function loadSubmodules(repoId: string): Promise<void> {
  const seq = next(subSeq, repoId)
  try {
    const submodules = await call('submodule.list', { repoId })
    if (isLatest(subSeq, repoId, seq) && useApp.getState().repos[repoId]) patchRepo(repoId, { submodules })
  } catch {
    // the list stays as it was; the next load tries again
  }
}

/** Runs a set-up or update in the background: the rest of the app stays usable, and the section shows progress. */
async function subOp(repoId: string, label: string, fn: (opId: string) => Promise<unknown>, failTitle: string): Promise<boolean> {
  if (useApp.getState().repos[repoId]?.subOp) return false
  const opId = newOpId()
  patchRepo(repoId, { subOp: { label, opId } })
  try {
    await fn(opId)
    return true
  } catch (err) {
    fail(err, failTitle)
    return false
  } finally {
    patchRepo(repoId, { subOp: null })
    await loadSubmodules(repoId)
    await loadStatus(repoId)
  }
}

/**
 * HEAD moved: the main process brings along only the submodules whose pointer changed and that are safe to move
 * (see submoduleSync). Nothing to do, and nothing shown, in a repository where no submodule was ever set up.
 */
async function followSubmodules(repoId: string, from: string, to: string): Promise<void> {
  const subs = useApp.getState().repos[repoId]?.submodules
  if (!subs?.present || !subs.settings.on) return
  let res: SubmoduleSyncResult | undefined
  await subOp(repoId, 'Updating submodules', async (opId) => (res = await call('submodule.sync', { repoId, from, to, opId })), 'Couldn’t update the submodules')
  if (!res) return
  const moved = [...res.updated, ...res.restored]
  if (moved.length || res.removed.length) {
    toast({
      tone: 'success',
      title: moved.length ? `Updated ${subName(moved)}` : `Tidied ${subName(res.removed)}`,
      body: [moved.length ? `To the commits this branch expects: ${moved.join(', ')}.` : '', res.removed.length ? `Removed the folders of ${res.removed.join(', ')}, which aren’t on this branch.` : ''].filter(Boolean).join(' ')
    })
  }
  for (const s of res.skipped) {
    toast({
      tone: 'info',
      title: `Left ${s.path} as it was`,
      body: s.why === 'changes' ? 'It has changes inside, so it wasn’t moved. Commit or discard them in the submodule, then update it from the Submodules list.' : 'It’s on a branch you’re working in, so it wasn’t moved.'
    })
  }
}

const subName = (paths: string[] | 'all'): string => (paths === 'all' ? 'all submodules' : paths.length === 1 ? paths[0] : plural(paths.length, 'submodule'))

export async function setUpSubmodules(repoId: string, paths: string[] | 'all', shallow?: boolean): Promise<void> {
  const ok = await subOp(repoId, `Setting up ${subName(paths)}`, (opId) => call('submodule.setup', { repoId, paths, shallow, opId }), 'Couldn’t set up every submodule')
  // Asked again rather than read from the store: a refresh started meanwhile may not have landed yet.
  const list = (await call('submodule.list', { repoId }).catch(() => null))?.list ?? useApp.getState().repos[repoId]?.submodules?.list ?? []
  const missing = list.filter((m) => !m.setUp && (paths === 'all' || paths.includes(m.path)))
  if (ok && !missing.length) toast({ tone: 'success', title: paths === 'all' ? 'Submodules set up' : `Set up ${subName(paths)}` })
  else if (missing.length) toast({ tone: 'error', title: `${plural(missing.length, 'submodule')} not set up`, body: missing.map((m) => m.path).join(', ') })
}

export async function updateSubmodules(repoId: string, paths: string[] | 'all'): Promise<void> {
  const ok = await subOp(repoId, `Updating ${subName(paths)}`, (opId) => call('submodule.update', { repoId, paths, opId }), 'Couldn’t update the submodules')
  if (ok) toast({ tone: 'success', title: paths === 'all' ? 'Submodules are at the expected commits' : `Updated ${subName(paths)}` })
}

/** git submodule deinit: empties the folders; git keeps their data, so setting them up again needs no download. */
export function removeSubmodules(repoId: string, paths: string[]): void {
  confirm({
    title: `Remove the local copy of ${subName(paths)}?`,
    body: 'This empties the folder. The repository doesn’t change, and Git keeps the submodule’s history, so setting it up again is quick. Submodules with changes inside are left alone.',
    confirmLabel: 'Remove local copy',
    danger: true,
    undoable: false,
    onConfirm: async () => {
      const ok = await attempt(() => call('submodule.remove', { repoId, paths }), 'Couldn’t remove the local copy')
      if (ok !== undefined) toast({ tone: 'success', title: `Removed the local copy of ${subName(paths)}` })
      await loadSubmodules(repoId)
      await loadStatus(repoId)
    }
  })
}

export async function setSubmoduleMode(repoId: string, names: string[], mode: SubmoduleMode | null): Promise<void> {
  await attempt(() => call('submodule.setMode', { repoId, names, mode }), 'Couldn’t change the mode')
  await loadSubmodules(repoId)
}

export async function setSubmoduleSettings(repoId: string, patch: Partial<SubmoduleSettings>): Promise<void> {
  const settings = await attempt(() => call('submodule.settings', { repoId, ...patch }), 'Couldn’t save that setting')
  if (!settings) return
  // A list loading since before the save would bring the old settings back: drop it, and load again.
  next(subSeq, repoId)
  patchRepo(repoId, (r) => ({ submodules: { list: r.submodules?.list ?? [], present: r.submodules?.present ?? true, superproject: r.submodules?.superproject ?? null, settings } }))
  await loadSubmodules(repoId)
}

/** A submodule is a repository of its own: open it in a tab. */
export async function openSubmodule(repoId: string, path: string): Promise<void> {
  const root = useApp.getState().tabs.find((t) => t.id === repoId)?.path
  if (root) await openRepo(`${root.replace(/[\\/]+$/, '')}/${path}`)
}

// ---------- worktrees ----------

const wtSeq = new Map<string, number>()

export async function loadWorktrees(repoId: string): Promise<void> {
  const seq = next(wtSeq, repoId)
  try {
    const worktrees = await call('worktrees.list', { repoId })
    if (isLatest(wtSeq, repoId, seq) && useApp.getState().repos[repoId]) patchRepo(repoId, { worktrees })
  } catch {
    // the list stays as it was; the next load tries again
  }
}

const folderName = (path: string): string => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? path

/** Each worktree is a repository folder of its own: it opens in a tab (or goes to its tab, if open). */
export async function openWorktree(path: string): Promise<void> {
  await openRepo(path)
}

export async function addWorktree(repoId: string, input: { path: string; branch?: string; newBranch?: string; at?: string; track?: boolean }, openAfter: boolean): Promise<boolean> {
  const res = await attempt(() => call('worktrees.add', { repoId, ...input, opId: newOpId() }), 'Couldn’t create the worktree')
  await loadRepo(repoId, { keepSelection: true })
  if (!res) return false
  toast({ tone: 'success', title: `Created the worktree ${folderName(res.path)}`, body: input.branch ?? input.newBranch ? `${input.branch ?? input.newBranch} is checked out there.` : 'Its HEAD is detached.' })
  if (openAfter) await openWorktree(res.path)
  return true
}

/** Removes the folder and git's record of it. The branch stays. A worktree with uncommitted changes asks a second time. */
export function removeWorktree(repoId: string, path: string, branch: string | null): void {
  const name = folderName(path)
  const run = async (force: boolean): Promise<void> => {
    const res = await attempt(() => call('worktrees.remove', { repoId, path, force }), `Couldn’t remove ${name}`)
    if (res?.closed) dropTab(res.closed)
    if (res?.dirty) {
      confirm({
        title: `${name} has uncommitted changes`,
        body: 'Removing it deletes them, untracked files included. Commit or stash them there first to keep them.',
        confirmLabel: 'Remove anyway',
        danger: true,
        undoable: false,
        onConfirm: () => void run(true)
      })
      return
    }
    if (res?.removed) toast({ tone: 'success', title: `Removed the worktree ${name}`, body: branch ? `${branch} is still there, free to check out anywhere.` : undefined })
    await loadRepo(repoId, { keepSelection: true })
  }
  confirm({
    title: `Remove the worktree ${name}?`,
    body: `This deletes the folder ${path}${branch ? `. The branch ${branch} and its commits stay` : ''}. Its tab closes, if open.`,
    confirmLabel: 'Remove worktree',
    danger: true,
    undoable: false,
    onConfirm: () => void run(false)
  })
}

export async function lockWorktree(repoId: string, path: string, locked: boolean): Promise<void> {
  await attempt(() => call('worktrees.lock', { repoId, path, locked }), locked ? 'Couldn’t lock the worktree' : 'Couldn’t unlock the worktree')
  await loadWorktrees(repoId)
}

export async function pruneWorktrees(repoId: string): Promise<void> {
  const ok = await attempt(() => call('worktrees.prune', { repoId }), 'Couldn’t forget the missing worktrees')
  if (ok !== undefined) toast({ tone: 'success', title: 'Forgot the worktrees whose folders are gone' })
  await loadRepo(repoId, { keepSelection: true })
}

/** A tab closed by the main process (its worktree was removed). */
function dropTab(repoId: string): void {
  useApp.setState((s) => {
    const idx = s.tabs.findIndex((t) => t.id === repoId)
    if (idx < 0) return {}
    const tabs = s.tabs.filter((t) => t.id !== repoId)
    const repos = { ...s.repos }
    delete repos[repoId]
    return { tabs, repos, active: s.active === repoId ? (tabs[Math.min(idx, tabs.length - 1)]?.id ?? 'home') : s.active }
  })
}

export async function lfsTrack(repoId: string, pattern: string, exact: boolean, label: string): Promise<void> {
  const ok = await attempt(() => call('lfs.track', { repoId, pattern, exact }), 'Couldn’t track that with Git LFS')
  if (ok !== undefined) {
    toast({ tone: 'success', title: `Tracking ${label} with Git LFS`, body: 'New and changed ones go to LFS when you stage them. Commit .gitattributes so other clones do the same.' })
  }
  await checkLfs(repoId)
  await loadStatus(repoId)
}

export async function lfsUntrack(repoId: string, pattern: string): Promise<void> {
  const ok = await attempt(() => call('lfs.untrack', { repoId, pattern }), 'Couldn’t stop tracking that with Git LFS')
  if (ok !== undefined) {
    toast({ tone: 'success', title: `Stopped tracking ${pattern} with Git LFS`, body: 'From now on they’re committed into git itself; what’s already committed stays in LFS. Commit .gitattributes too.' })
  }
  await checkLfs(repoId)
  await loadStatus(repoId)
}

export function dismissLfs(repoId: string): void {
  patchRepo(repoId, { lfsDismissed: true })
}

export async function loadRepo(repoId: string, opts: { keepSelection?: boolean } = {}): Promise<void> {
  if (!useApp.getState().repos[repoId]) patchRepo(repoId, emptyRepo())
  patchRepo(repoId, { loading: true })
  if (!useApp.getState().repos[repoId].lfs) void checkLfs(repoId)
  void loadSubmodules(repoId)
  void loadWorktrees(repoId)
  const seq = next(repoSeq, repoId)
  const sseq = next(statusSeq, repoId)
  // Settings the user changes while this load runs (dragging a column, say) are newer than what it reads.
  const { columns: columnsBefore, focusHead: focusBefore, graphWidth: widthBefore } = useApp.getState().repos[repoId]
  try {
    const [refs, status, undo, refView, columns, repoPrefs] = await Promise.all([
      call('refs.list', { repoId }),
      call('status.get', { repoId }),
      call('undo.peek', { repoId }),
      call('refView.get', { repoId }),
      call('graph.getColumns', { repoId }),
      call('repoPrefs.get', { repoId })
    ])
    const already = useApp.getState().repos[repoId]?.commits.length ?? 0
    const page = await call('graph.load', { repoId, skip: 0, limit: Math.max(PAGE, already) })
    const layout = await layoutInWorker(withWip(page.commits, status.changes.length > 0, refs.head.sha), pinnedLine(page.commits, refs, refView.pinned))
    if (!isLatest(repoSeq, repoId, seq)) return // a newer full load is on its way
    const freshStatus = isLatest(statusSeq, repoId, sseq)
    // HEAD as the screen last showed it: if it moved (a checkout, pull, reset, or a terminal), submodules may follow.
    const headBefore = useApp.getState().repos[repoId]?.refs?.head.sha ?? null
    patchRepo(repoId, (r) => ({
      refs,
      ...(freshStatus ? { status, undo } : {}),
      refView,
      columns: r.columns !== columnsBefore ? r.columns : columns ?? DEFAULT_COLUMNS,
      focusHead: r.focusHead !== focusBefore ? r.focusHead : repoPrefs['graph.focusHead'] === true,
      graphWidth: r.graphWidth !== widthBefore ? r.graphWidth : typeof repoPrefs['graph.width'] === 'number' ? repoPrefs['graph.width'] : null,
      commits: page.commits,
      hasMore: page.hasMore,
      layout,
      loading: false,
      loadError: null,
      multi: opts.keepSelection && r.multi.every((m) => page.commits.some((c) => c.sha === m)) ? r.multi : [],
      selected: opts.keepSelection && r.selected && (r.selected === 'wip' || page.commits.some((c) => c.sha === r.selected)) ? r.selected : r.selected ?? (status.changes.length ? 'wip' : null)
    }))
    if (headBefore && refs.head.sha && headBefore !== refs.head.sha) void followSubmodules(repoId, headBefore, refs.head.sha)
  } catch (err) {
    if (!isLatest(repoSeq, repoId, seq)) return
    patchRepo(repoId, { loading: false, loadError: err instanceof Error ? err.message : String(err) })
  }
}

export async function loadMore(repoId: string): Promise<void> {
  const r = useApp.getState().repos[repoId]
  if (!r || !r.hasMore || r.loading) return
  patchRepo(repoId, { loading: true })
  const skip = r.commits.filter((c) => c.kind === 'commit').length
  const page = await attempt(() => call('graph.load', { repoId, skip, limit: PAGE }))
  if (!page) return patchRepo(repoId, { loading: false })
  const commits = [...r.commits, ...page.commits]
  const layout = await layoutInWorker(withWip(commits, (r.status?.changes.length ?? 0) > 0, r.refs?.head.sha ?? null), pinnedLine(commits, r.refs, r.refView.pinned))
  patchRepo(repoId, { commits, hasMore: page.hasMore, layout, loading: false })
}

/** The pinned branch's first-parent line among the loaded rows (what lane 0 shows). */
function pinnedLine(rows: Array<{ sha: string; parents: string[] }>, refs: { refs: Array<{ name: string; sha: string }> } | null, pinned: string | null): string[] {
  const tip = pinned ? refs?.refs.find((r) => r.name === pinned)?.sha : undefined
  if (!tip) return []
  const bySha = new Map(rows.map((r) => [r.sha, r]))
  const out: string[] = []
  for (let sha: string | undefined = tip; sha && bySha.has(sha) && out.length < rows.length; sha = bySha.get(sha)!.parents[0]) out.push(sha)
  return out
}

/** The graph rows as drawn: an extra "uncommitted changes" row on top when the tree is dirty. */
export function withWip<T extends { sha: string; parents: string[] }>(rows: T[], dirty: boolean, head: string | null): Array<{ sha: string; parents: string[] }> {
  return dirty ? [{ sha: 'wip', parents: head ? [head] : [] }, ...rows] : rows
}

// ---------- selection and views ----------

export function select(repoId: string, sel: string | null): void {
  patchRepo(repoId, { selected: sel, multi: [] })
}

/** Selects a commit and opens its message for editing in the details panel. */
export function editMessage(repoId: string, sha: string): void {
  select(repoId, sha)
  patchRepo(repoId, { editing: sha })
}

/** Ctrl-click: add or remove one commit. `order` is the graph's row order, so the list stays newest first. */
export function toggleSelect(repoId: string, sha: string, order: string[]): void {
  const r = useApp.getState().repos[repoId]
  if (!r) return
  const cur = r.multi.length ? r.multi : r.selected && r.selected !== 'wip' ? [r.selected] : []
  const next = cur.includes(sha) ? cur.filter((s) => s !== sha) : [...cur, sha]
  const sorted = order.filter((s) => next.includes(s))
  patchRepo(repoId, { multi: sorted.length > 1 ? sorted : [], selected: cur.includes(sha) ? (sorted[0] ?? null) : sha })
}

/** Shift-click or Shift+arrows: everything between the anchor (the single selection) and `sha`. */
export function extendSelect(repoId: string, sha: string, order: string[]): void {
  const r = useApp.getState().repos[repoId]
  if (!r) return
  const anchor = r.multi.length ? (r.selected ?? r.multi[0]) : r.selected
  const a = order.indexOf(anchor ?? '')
  const b = order.indexOf(sha)
  if (a < 0 || b < 0 || a === b) return select(repoId, sha)
  const span = order.slice(Math.min(a, b), Math.max(a, b) + 1).filter((s) => s !== 'wip')
  patchRepo(repoId, { multi: span.length > 1 ? span : [], selected: anchor })
}

/** The current branch's first-parent line among the loaded commits, newest first. */
export function headLine(repoId: string): string[] {
  const r = useApp.getState().repos[repoId]
  const bySha = new Map((r?.commits ?? []).map((c) => [c.sha, c]))
  const line: string[] = []
  for (let sha = r?.refs?.head.sha ?? null; sha && bySha.has(sha); sha = bySha.get(sha)!.parents[0] ?? null) line.push(sha)
  return line
}

/** True if a remote branch already has any of these commits (among the loaded history). */
export function alreadyPushed(repoId: string, shas: string[]): boolean {
  const r = useApp.getState().repos[repoId]
  if (!r?.refs) return false
  const bySha = new Map(r.commits.map((c) => [c.sha, c]))
  const want = new Set(shas)
  const seen = new Set<string>()
  const stack = r.refs.refs.filter((x) => x.kind === 'remote').map((x) => x.sha)
  while (stack.length) {
    const sha = stack.pop()!
    if (seen.has(sha)) continue
    if (want.has(sha)) return true
    seen.add(sha)
    for (const p of bySha.get(sha)?.parents ?? []) stack.push(p)
  }
  return false
}

/** Why the branch can't be rewritten right now (uncommitted changes, a paused operation), or null. */
export function rewriteBlocker(repoId: string): string | null {
  const st = useApp.getState().repos[repoId]?.status
  if (st?.op && st.op.kind !== 'none') return 'Finish or abort the operation in progress first.'
  if ((st?.changes ?? []).some((c) => c.worktree !== '?' || c.index !== '.')) return 'Commit or stash your changes first.'
  return null
}

function blocked(repoId: string, what: string): boolean {
  const why = rewriteBlocker(repoId)
  if (why) toast({ tone: 'info', title: why, body: `${what} rewrites commits, which needs a clean working folder.` })
  return !!why
}

/** True if a merge commit sits between this commit and the tip of the current branch (rewriting would flatten it). */
export function mergeAbove(repoId: string, sha: string): boolean {
  const line = headLine(repoId)
  const commits = useApp.getState().repos[repoId]?.commits ?? []
  const at = line.indexOf(sha)
  return at > 0 && line.slice(0, at).some((s) => (commits.find((c) => c.sha === s)?.parents.length ?? 1) > 1)
}

/** Rewriting pushed commits means a force push later; say so first. */
function guardPushed(repoId: string, shas: string[], what: string, run: () => void): void {
  if (!alreadyPushed(repoId, shas)) return run()
  confirm({
    title: `${what}?`,
    body: 'These commits are already on a remote. Rewriting them gives them new IDs, so the next push has to be a force push, and anyone who pulled them will need to sort that out.',
    confirmLabel: what,
    danger: false,
    undoable: true,
    onConfirm: run
  })
}

/** Resolves when no load of this repo is running (or after a few seconds). */
function settled(repoId: string): Promise<void> {
  return new Promise((resolve) => {
    const done = (): boolean => !useApp.getState().repos[repoId]?.loading
    if (done()) return resolve()
    const stop = useApp.subscribe(() => {
      if (!done()) return
      stop()
      clearTimeout(timer)
      resolve()
    })
    const timer = setTimeout(() => {
      stop()
      resolve()
    }, 5000)
  })
}

/** Runs a history rewrite, then selects the commit now at `position` on the branch's line (0 = newest), where the result lands. */
async function rewriteOp(repoId: string, fn: () => Promise<{ result: string; message?: string }>, failTitle: string, okTitle: string, position: number): Promise<boolean> {
  patchRepo(repoId, (r) => ({ busy: { ...r.busy, op: 'Rewriting history' } }))
  const res = await attempt(fn, failTitle)
  patchRepo(repoId, (r) => ({ busy: { ...r.busy, op: undefined } }))
  afterOp(repoId, res, okTitle)
  await loadRepo(repoId, { keepSelection: true })
  // A refresh from the file watcher may have overtaken this one; read the branch once the newest has landed.
  await settled(repoId)
  if (res && res.result !== 'conflicts') select(repoId, headLine(repoId)[Math.max(0, position)] ?? null)
  return !!res
}

/** New message for any commit on the current branch (the newest one is amended, older ones reworded). */
export function reword(repoId: string, sha: string, message: string, done?: (ok: boolean) => void, noVerify = false): void {
  guardPushed(repoId, [sha], 'Edit the message', () =>
    void rewriteOp(repoId, () => call('history.reword', { repoId, sha, message, noVerify }), 'Couldn’t change the message', 'Message changed', headLine(repoId).indexOf(sha)).then((ok) => done?.(ok))
  )
}

export function squash(repoId: string, shas: string[], message: string, done?: (ok: boolean) => void, noVerify = false): void {
  guardPushed(repoId, shas, `Squash ${shas.length} commits`, () =>
    void rewriteOp(repoId, () => call('history.squash', { repoId, shas, message, noVerify }), 'Couldn’t squash', `Squashed ${shas.length} commits into one`, Math.min(...shas.map((s) => headLine(repoId).indexOf(s)))).then((ok) => done?.(ok))
  )
}

/**
 * The message a squash starts from, oldest commit first: its summary, then its description, then each later commit's
 * summary and description, so nothing is lost and you can edit it all down.
 */
export function combinedMessage(messages: string[]): string {
  const parts = messages.map((m) => m.trim()).filter(Boolean)
  if (!parts.length) return ''
  const [first, ...rest] = parts
  const [summary, ...body] = first.split('\n')
  const description = [body.join('\n').trim(), ...rest].filter(Boolean).join('\n\n')
  return description ? `${summary}\n\n${description}` : summary
}

/** Opens the squash dialog, its message made from the commits' full messages (oldest first). */
export async function askSquash(repoId: string, shas: string[]): Promise<void> {
  if (blocked(repoId, 'Squashing')) return
  const r = useApp.getState().repos[repoId]
  const rows = shas.map((s) => r?.commits.find((c) => c.sha === s)).filter((c): c is NonNullable<typeof c> => !!c).reverse()
  const oldestFirst = rows.map((c) => c.sha)
  // If the full messages can't be read, the summaries are still better than nothing.
  const full = await call('commit.messages', { repoId, shas: oldestFirst }).catch(() => null)
  const message = combinedMessage(full ? full.map((m) => m.message) : rows.map((c) => c.summary))
  openDialog({ kind: 'squash', repoId, shas, message })
}

export function moveCommit(repoId: string, sha: string, direction: 'up' | 'down'): void {
  if (blocked(repoId, 'Moving a commit')) return
  const line = headLine(repoId)
  const i = line.indexOf(sha)
  const other = line[direction === 'up' ? i - 1 : i + 1]
  guardPushed(repoId, other ? [sha, other] : [sha], `Move the commit ${direction}`, () =>
    void rewriteOp(repoId, () => call('history.move', { repoId, sha, direction }), 'Couldn’t move the commit', `Moved ${sha.slice(0, 7)} ${direction}`, i + (direction === 'up' ? -1 : 1))
  )
}

/** Opens the rebase view for just these commits (newest first): it starts from the oldest one's parent. */
export function rebaseRange(repoId: string, shas: string[]): void {
  const r = useApp.getState().repos[repoId]
  const line = headLine(repoId)
  const idx = shas.map((s) => line.indexOf(s)).filter((i) => i >= 0)
  if (!r || idx.length !== shas.length) {
    toast({ tone: 'info', title: 'Pick commits on the current branch', body: 'Only commits on the checked-out branch’s own line can be rewritten.' })
    return
  }
  const oldest = line[Math.max(...idx)]
  const onto = r.commits.find((c) => c.sha === oldest)?.parents[0]
  if (!onto) {
    toast({ tone: 'info', title: 'The very first commit can’t be included', body: 'There’s nothing before it to start from.' })
    return
  }
  // Everything between the newest and oldest picked commit is offered, so the range has no holes.
  const range = line.slice(Math.min(...idx), Math.max(...idx) + 1)
  setCenter(repoId, { kind: 'rebase', onto, ontoLabel: onto.slice(0, 7), range })
}

export function setCenter(repoId: string, center: Center): void {
  patchRepo(repoId, { center })
}

export function openDiff(repoId: string, path: string, source: DiffSource, oldPath?: string): void {
  setCenter(repoId, { kind: 'diff', path, source, oldPath })
}

export function openLog(): void {
  const id = useApp.getState().active
  if (id !== 'home') setCenter(id, { kind: 'log' })
}

// ---------- staging and commits ----------

export async function stage(repoId: string, paths: string[] | 'all'): Promise<void> {
  await attempt(() => call('index.stage', { repoId, paths }), 'Couldn’t stage')
  await loadStatus(repoId)
}

export async function unstage(repoId: string, paths: string[] | 'all'): Promise<void> {
  await attempt(() => call('index.unstage', { repoId, paths }), 'Couldn’t unstage')
  await loadStatus(repoId)
}

export function discard(repoId: string, paths: string[] | 'all'): void {
  const what = paths === 'all' ? 'all your uncommitted changes' : paths.length === 1 ? paths[0] : plural(paths.length, 'file')
  confirm({
    title: 'Discard changes?',
    body: `This throws away ${what}, including new files that were never committed.`,
    confirmLabel: 'Discard',
    danger: true,
    undoable: true,
    onConfirm: async () => {
      await attempt(() => call('worktree.discard', { repoId, paths }), 'Couldn’t discard')
      await loadRepo(repoId, { keepSelection: true })
    }
  })
}

type CommitInput = { summary: string; body: string; amend: boolean; noVerify: boolean; push: boolean; messageOnly?: boolean; detachedOk?: boolean }

/**
 * Commits, but first asks when a staged submodule pointer would move back: the usual way a teammate's update gets
 * undone (the submodule wasn't updated after a pull, and staging everything picked up its old commit).
 */
export async function commit(repoId: string, input: CommitInput): Promise<boolean> {
  const r = useApp.getState().repos[repoId]
  // Inside a submodule that isn't on a branch, new commits hang off nothing: the parent's next update moves away.
  const parent = r?.submodules?.superproject
  const head = r?.refs?.head
  // The store can lag a moment behind (a branch just created): ask git before asking the user.
  const detached = parent && head?.sha && !head.branch && !input.messageOnly && !input.amend && !input.detachedOk && !(await call('status.get', { repoId }).catch(() => null))?.branch
  if (detached && head?.sha) {
    const name = parent.split(/[\\/]/).filter(Boolean).pop() ?? parent
    confirm({
      title: 'Commit without a branch?',
      body: `This is a submodule of ${name}, and it isn’t on a branch (detached at ${head.sha.slice(0, 7)}). Commits made like this are easy to lose: the next time ${name} updates this submodule, it moves away from them. Create a branch to keep them.`,
      confirmLabel: 'Commit anyway',
      danger: false,
      undoable: true,
      onConfirm: () => void commit(repoId, { ...input, detachedOk: true }),
      alt: { label: 'Create a branch…', onSelect: () => openDialog({ kind: 'createBranch', repoId, at: head.sha!, atLabel: head.sha!.slice(0, 7) }) }
    })
    return false
  }
  if (!input.messageOnly && r?.submodules?.list.length) {
    const back = await call('submodule.goingBack', { repoId }).catch(() => [])
    if (back.length) {
      const what = back.map((b) => `${b.path} back ${plural(b.behind, 'commit')}`).join(', ')
      confirm({
        title: back.length === 1 ? `Move ${back[0].path} back?` : `Move ${plural(back.length, 'submodule')} back?`,
        body: `This commit moves ${what}. That usually means the submodule wasn’t updated after a pull or a branch switch, and committing would undo someone’s update. To keep their update, cancel, unstage the submodule, and use “Update to the expected commit” from the Submodules list.`,
        confirmLabel: 'Commit anyway',
        danger: true,
        undoable: true,
        onConfirm: () => void runCommit(repoId, input)
      })
      return false
    }
  }
  return runCommit(repoId, input)
}

async function runCommit(repoId: string, input: CommitInput): Promise<boolean> {
  patchRepo(repoId, (r) => ({ busy: { ...r.busy, commit: 'Committing' } }))
  try {
    await call('commit.create', { repoId, summary: input.summary, body: input.body, amend: input.amend, noVerify: input.noVerify, messageOnly: input.messageOnly })
    // The message is used up and the changes view is done, unless the user already started the next message
    // while git was committing; then both stay as they are.
    if (!input.messageOnly) {
      patchRepo(repoId, (r) =>
        r.draft.summary === input.summary && r.draft.body === input.body
          ? { draft: { summary: '', body: '' }, selected: r.selected === 'wip' ? null : r.selected }
          : {}
      )
    }
    // The commit itself is done; the refresh below can take seconds on a big repo and shouldn't block the next one.
    patchRepo(repoId, (r) => ({ busy: { ...r.busy, commit: undefined } }))
    toast({ tone: 'success', title: input.amend ? 'Last commit amended' : 'Committed', body: input.summary })
    await loadRepo(repoId, { keepSelection: true })
    if (input.push) await push(repoId)
    return true
  } catch (err) {
    fail(err, 'Commit failed')
    return false
  } finally {
    patchRepo(repoId, (r) => ({ busy: { ...r.busy, commit: undefined } }))
  }
}

export function setDraft(repoId: string, patch: Partial<{ summary: string; body: string }>): void {
  patchRepo(repoId, (r) => ({ draft: { ...r.draft, ...patch } }))
}

// ---------- branches ----------

/**
 * Before switching: a branch checked out in another worktree can't be checked out here too, so that worktree is
 * offered instead. Then asks when a submodule with changes inside would be moved or taken away (git leaves those).
 */
export async function checkout(repoId: string, ref: string): Promise<void> {
  const r = useApp.getState().repos[repoId]
  // A remote branch is checked out through the local branch of the same name, if there is one.
  const remote = r?.refs?.refs.find((x) => x.kind === 'remote' && x.short === ref)
  const localName = remote ? ref.slice((remote.remote?.length ?? 0) + 1) : ref
  if (r?.refs?.refs.some((x) => x.kind === 'local' && x.short === localName && x.worktree)) {
    // Asked again: the list on screen may be from before that worktree was removed or switched branches.
    const fresh = await call('worktrees.list', { repoId }).catch(() => null)
    const w = fresh ? fresh.find((x) => x.branch === localName && !x.current) : r.worktrees?.find((x) => x.branch === localName && !x.current)
    if (w) return checkedOutElsewhere(repoId, localName, w)
  }
  const subs = r?.submodules
  const risky = subs?.list.some((m) => m.setUp) ? await call('submodule.atRisk', { repoId, to: ref }).catch(() => []) : []
  if (!risky.length) return runCheckout(repoId, ref)
  confirm({
    title: `Switch to ${ref}?`,
    body: `${risky.join(', ')} ${risky.length === 1 ? 'has' : 'have'} changes inside, and ${ref} expects ${risky.length === 1 ? 'it' : 'them'} on another commit (or doesn’t have ${risky.length === 1 ? 'it' : 'them'}). Your changes stay, but ${risky.length === 1 ? 'it won’t' : 'they won’t'} be moved.`,
    confirmLabel: 'Switch anyway',
    danger: false,
    undoable: true,
    onConfirm: () => void runCheckout(repoId, ref)
  })
}

function checkedOutElsewhere(repoId: string, branch: string, w: Pick<Worktree, 'path' | 'missing'>): void {
  const { path } = w
  if (w.missing) {
    // git still counts the branch as checked out there until it forgets that worktree.
    confirm({
      title: `${branch} is checked out in a worktree that’s gone`,
      body: `Git still has it checked out in ${path}, but that folder no longer exists. Forget the missing worktrees, then switch to ${branch} here.`,
      confirmLabel: 'Forget and switch',
      danger: false,
      undoable: false,
      onConfirm: async () => {
        await pruneWorktrees(repoId)
        await runCheckout(repoId, branch)
      }
    })
    return
  }
  confirm({
    title: `${branch} is checked out in another worktree`,
    body: `It’s checked out in ${path}, and Git lets a branch be checked out in only one worktree at a time. Open that worktree to work on ${branch}.`,
    confirmLabel: 'Open that worktree',
    danger: false,
    undoable: null,
    onConfirm: () => void openWorktree(path)
  })
}

async function runCheckout(repoId: string, ref: string): Promise<void> {
  try {
    await call('branch.checkout', { repoId, ref })
    toast({ tone: 'success', title: `Switched to ${ref}` })
  } catch (err) {
    // A worktree made a moment ago (in a terminal, say) that the list here doesn't show yet.
    const m = err instanceof ApiError ? /'([^']+)' is already (?:used|checked out) by worktree at '([^']+)'/.exec(`${err.message}\n${err.detail ?? ''}`) : null
    await loadRepo(repoId, { keepSelection: true })
    if (m) return checkedOutElsewhere(repoId, m[1], { path: m[2], missing: !(await call('worktrees.list', { repoId }).catch(() => [])).some((w) => w.branch === m[1] && !w.missing) })
    fail(err, `Couldn’t switch to ${ref}`)
    return
  }
  await loadRepo(repoId, { keepSelection: true })
}

export async function createBranch(repoId: string, name: string, at: string, checkoutAfter: boolean): Promise<boolean> {
  const ok = await attempt(() => call('branch.create', { repoId, name, at, checkout: checkoutAfter }), 'Couldn’t create the branch')
  await loadRepo(repoId, { keepSelection: true })
  if (ok === undefined) return false
  toast({ tone: 'success', title: checkoutAfter ? `Created and switched to ${name}` : `Created ${name}` })
  return true
}

export async function renameBranch(repoId: string, name: string, newName: string): Promise<boolean> {
  const ok = await attempt(() => call('branch.rename', { repoId, name, newName }), 'Couldn’t rename the branch')
  await loadRepo(repoId, { keepSelection: true })
  return ok !== undefined
}

const nameList = (names: string[], max = 8): string => (names.length > max ? `${names.slice(0, max).join(', ')} and ${names.length - max} more` : names.join(', '))

/** Where each local branch lives on a remote (the branch it tracks), looked up before it's deleted. */
function remoteBranchesOf(repoId: string, names: string[]): Map<string, { remote: string; name: string }> {
  const locals = useApp.getState().repos[repoId]?.refs?.refs.filter((r) => r.kind === 'local' && names.includes(r.short)) ?? []
  const m = new Map<string, { remote: string; name: string }>()
  for (const r of locals) {
    const on = remoteBranchOf(repoId, r.upstream)
    if (on) m.set(r.short, on)
  }
  return m
}

/** The "Also delete on origin" checkbox for deleting `total` branches, when any of them is on a remote. */
function remoteCheck(on: Map<string, { remote: string; name: string }>, total: number): { label: string; hint: string } | undefined {
  if (!on.size) return undefined
  const remotes = [...new Set([...on.values()].map((b) => b.remote))]
  const which = total === 1 ? 'it' : on.size === total ? 'them' : `the ${on.size} that are there`
  return { label: `Also delete ${which} on ${remotes.length === 1 ? remotes[0] : 'their remotes'}`, hint: 'Deleting on the remote can’t be undone, and affects everyone who uses it.' }
}

/** Deletes branches on their remotes, one push per remote. */
async function deleteOnRemotes(repoId: string, on: { remote: string; name: string }[]): Promise<void> {
  const byRemote = new Map<string, string[]>()
  for (const b of on) byRemote.set(b.remote, [...(byRemote.get(b.remote) ?? []), b.name])
  for (const [remote, list] of byRemote) {
    const ok = await remoteOp(repoId, 'push', 'Deleting branches', (opId) => call('branch.deleteRemoteMany', { repoId, remote, names: list, opId }), `Couldn’t delete ${nameList(list)} from ${remote}`)
    if (ok !== undefined) toast({ tone: 'success', title: list.length === 1 ? `Deleted ${list[0]} from ${remote}` : `Deleted ${list.length} branches from ${remote}` })
  }
}

export function deleteBranch(repoId: string, name: string): void {
  const on = remoteBranchesOf(repoId, [name])
  const alsoRemote = async (checked: boolean): Promise<void> => {
    if (checked && on.size) await deleteOnRemotes(repoId, [...on.values()])
  }
  confirm({
    title: `Delete ${name}?`,
    body: `This removes the local branch ${name}. Its commits stay if another branch contains them.`,
    confirmLabel: 'Delete branch',
    danger: true,
    undoable: true,
    check: remoteCheck(on, 1),
    onConfirm: async (checked) => {
      try {
        await call('branch.delete', { repoId, name, force: false })
        toast({ tone: 'success', title: `Deleted ${name}` })
        await alsoRemote(checked)
      } catch (err) {
        if (err instanceof ApiError && /aren’t merged/.test(err.message)) {
          confirm({
            title: `${name} isn’t merged`,
            body: err.message,
            confirmLabel: 'Delete anyway',
            danger: true,
            undoable: true,
            onConfirm: async () => {
              const ok = await attempt(() => call('branch.delete', { repoId, name, force: true }), 'Couldn’t delete the branch')
              if (ok !== undefined) await alsoRemote(checked)
              await loadRepo(repoId, { keepSelection: true })
            }
          })
        } else fail(err, 'Couldn’t delete the branch')
      }
      await loadRepo(repoId, { keepSelection: true })
    }
  })
}

/** Several local branches at once: one question, one undo. The checked-out branch and ones in another worktree are left alone. */
export function deleteBranches(repoId: string, names: string[]): void {
  const refs = useApp.getState().repos[repoId]?.refs?.refs ?? []
  const locals = refs.filter((r) => r.kind === 'local' && names.includes(r.short))
  const kept = locals.filter((r) => r.isHead || r.worktree).map((r) => r.short)
  const doomed = locals.filter((r) => !r.isHead && !r.worktree).map((r) => r.short)
  if (!doomed.length) return
  if (doomed.length === 1) return deleteBranch(repoId, doomed[0])
  const on = remoteBranchesOf(repoId, doomed)
  const run = async (list: string[], force: boolean, alsoRemote: boolean): Promise<void> => {
    const res = await attempt(() => call('branch.deleteMany', { repoId, names: list, force }), 'Couldn’t delete the branches')
    if (res) {
      if (res.deleted.length) toast({ tone: 'success', title: res.deleted.length === 1 ? `Deleted ${res.deleted[0]}` : `Deleted ${res.deleted.length} branches` })
      for (const f of res.failed) toast({ tone: 'error', title: `Couldn’t delete ${f.name}`, body: f.message })
      if (alsoRemote) await deleteOnRemotes(repoId, res.deleted.flatMap((n) => on.get(n) ?? []))
    }
    await loadRepo(repoId, { keepSelection: true })
    if (!res?.unmerged.length) return
    const one = res.unmerged.length === 1
    confirm({
      title: one ? `${res.unmerged[0]} isn’t merged` : `${res.unmerged.length} branches aren’t merged`,
      body: `${one ? 'It has' : `${nameList(res.unmerged)} have`} commits that aren’t merged anywhere else.${res.deleted.length ? ` The other ${res.deleted.length === 1 ? 'branch is' : `${res.deleted.length} are`} deleted.` : ''} Delete ${one ? 'it' : 'them'} anyway?`,
      confirmLabel: one ? 'Delete anyway' : `Delete ${res.unmerged.length} anyway`,
      danger: true,
      undoable: true,
      onConfirm: () => void run(res.unmerged, true, alsoRemote)
    })
  }
  confirm({
    title: `Delete ${doomed.length} branches?`,
    body: `This removes the local branches ${nameList(doomed)}. Their commits stay if another branch contains them.${kept.length ? ` ${nameList(kept)} ${kept.length === 1 ? 'stays: it’s' : 'stay: they’re'} checked out.` : ''}`,
    confirmLabel: `Delete ${doomed.length} branches`,
    danger: true,
    undoable: true,
    check: remoteCheck(on, doomed.length),
    onConfirm: (checked) => void run(doomed, false, checked)
  })
}

/**
 * Pushes several local branches, one after the other: each to the remote it tracks, or, if it tracks nothing yet, to
 * origin (or the first remote), where it starts tracking. One that points at unpushed submodule commits is left for
 * a push of its own, which asks about them.
 */
export async function pushBranches(repoId: string, names: string[]): Promise<void> {
  const st = useApp.getState().repos[repoId]
  const locals = st?.refs?.refs.filter((r) => r.kind === 'local' && names.includes(r.short)) ?? []
  const fallback = defaultRemote(repoId)
  const subs = st?.submodules
  const checkSubs = !!subs?.settings.on && subs.settings.pushCheck !== 'off' && subs.list.some((m) => m.setUp)
  const pushed: string[] = []
  const rejected: string[] = []
  const later: string[] = []
  for (const r of locals) {
    const remote = remoteBranchOf(repoId, r.upstream)?.remote ?? fallback
    if (!remote) return void toast({ tone: 'error', title: 'No remote to push to', body: 'Add a remote first.' })
    if (checkSubs && (await call('submodule.unpushed', { repoId, branch: r.short }).catch(() => [])).length) {
      later.push(r.short)
      continue
    }
    const res = await remoteOp(repoId, 'push', `Pushing ${r.short}`, (opId) => call('remote.push', { repoId, opId, branch: r.short, remote, setUpstream: !r.upstream }), `Couldn’t push ${r.short}`)
    if (res?.result === 'ok') pushed.push(r.short)
    else if (res?.result === 'rejected') rejected.push(r.short)
  }
  // The new upstreams first, so what the toast says is already on screen.
  await loadRepo(repoId, { keepSelection: true })
  if (pushed.length) toast({ tone: 'success', title: pushed.length === 1 ? `Pushed ${pushed[0]}` : `Pushed ${pushed.length} branches` })
  if (rejected.length) toast({ tone: 'error', title: `${nameList(rejected)} ${rejected.length === 1 ? 'was' : 'were'} rejected`, body: 'The remote has commits you don’t. Pull first, or push each one on its own to force it.' })
  if (later.length) toast({ tone: 'info', title: `${nameList(later)} not pushed`, body: 'They point at submodule commits that aren’t on their remote yet. Push each one on its own to sort that out first.' })
}

/** Several tags at once: one question, one undo. The checkbox also deletes them on the remote. */
export function deleteTags(repoId: string, names: string[]): void {
  if (names.length === 1) return deleteTag(repoId, names[0])
  const remote = defaultRemote(repoId)
  confirm({
    title: `Delete ${names.length} tags?`,
    body: `This removes the tags ${nameList(names)} from your copy.`,
    confirmLabel: `Delete ${names.length} tags`,
    danger: true,
    undoable: true,
    check: remote ? { label: `Also delete them on ${remote}`, hint: 'Deleting on the remote can’t be undone, and affects everyone who uses it.' } : undefined,
    onConfirm: async (checked) => {
      const res = await attempt(() => call('tag.deleteMany', { repoId, names }), 'Couldn’t delete the tags')
      if (res) {
        if (res.deleted.length) toast({ tone: 'success', title: res.deleted.length === 1 ? `Deleted tag ${res.deleted[0]}` : `Deleted ${res.deleted.length} tags` })
        for (const f of res.failed) toast({ tone: 'error', title: `Couldn’t delete ${f.name}`, body: f.message })
        if (checked && remote && res.deleted.length) await pushTagsTo(repoId, res.deleted, remote, true)
      }
      await loadRepo(repoId, { keepSelection: true })
    }
  })
}

async function pushTagsTo(repoId: string, names: string[], remote: string, del: boolean): Promise<boolean> {
  const what = names.length === 1 ? names[0] : `${names.length} tags`
  const ok = await remoteOp(repoId, 'push', del ? 'Deleting tags' : 'Pushing tags', (opId) => call('tag.pushMany', { repoId, names, remote, opId, del }), del ? `Couldn’t delete ${what} from ${remote}` : `Couldn’t push ${what} to ${remote}`)
  if (ok !== undefined) toast({ tone: 'success', title: del ? `Deleted ${what} from ${remote}` : `Pushed ${what} to ${remote}` })
  return ok !== undefined
}

/** Pushes several tags in one push per remote: origin (or the first one) by default, or every remote. */
export async function pushTags(repoId: string, names: string[], remote?: string): Promise<void> {
  const all = useApp.getState().repos[repoId]?.refs?.remotes ?? []
  const targets = remote === ALL_REMOTES ? all : [remote ?? defaultRemote(repoId)].filter((r): r is string => !!r)
  if (!targets.length) return void toast({ tone: 'error', title: 'No remote to push to', body: 'Add a remote first.' })
  for (const r of targets) await pushTagsTo(repoId, names, r, false)
}

function afterOp(repoId: string, res: { result: string; message?: string } | undefined, okTitle: string): void {
  if (!res) return
  if (res.result === 'conflicts') {
    toast({ tone: 'info', title: 'Conflicts to sort out', body: 'Both sides changed the same lines. Open each file, pick what to keep, then continue.' })
    select(repoId, 'wip')
  } else if (res.result === 'nothing') toast({ tone: 'info', title: res.message ?? 'Nothing to do' })
  else if (res.result === 'ok') toast({ tone: 'success', title: okTitle })
}

/** Merge `source` into `target`. Checks out target first if needed. */
export async function mergeInto(repoId: string, source: string, target: string): Promise<void> {
  const head = useApp.getState().repos[repoId]?.refs?.head.branch
  if (target !== head) {
    const ok = await attempt(() => call('branch.checkout', { repoId, ref: target }), `Couldn’t switch to ${target}`)
    if (ok === undefined) return void (await loadRepo(repoId))
  }
  const res = await attempt(() => call('branch.merge', { repoId, source }), `Couldn’t merge ${source}`)
  afterOp(repoId, res, `Merged ${source} into ${target}`)
  await loadRepo(repoId, { keepSelection: true })
}

/** Rebase `branch` onto `onto`. Checks out branch first if needed. */
export async function rebaseOnto(repoId: string, branch: string, onto: string): Promise<void> {
  const head = useApp.getState().repos[repoId]?.refs?.head.branch
  if (branch !== head) {
    const ok = await attempt(() => call('branch.checkout', { repoId, ref: branch }), `Couldn’t switch to ${branch}`)
    if (ok === undefined) return void (await loadRepo(repoId))
  }
  const res = await attempt(() => call('branch.rebase', { repoId, onto, branch }), `Couldn’t rebase ${branch}`)
  afterOp(repoId, res, `Rebased ${branch} onto ${onto}`)
  await loadRepo(repoId, { keepSelection: true })
}

// ---------- sync ----------

async function remoteOp<T>(repoId: string, key: 'fetch' | 'pull' | 'push', label: string, fn: (opId: string) => Promise<T>, failTitle: string): Promise<T | undefined> {
  patchRepo(repoId, (r) => ({ busy: { ...r.busy, [key]: label }, progress: null }))
  try {
    return await fn(newOpId())
  } catch (err) {
    if (key === 'fetch') patchRepo(repoId, { fetchFailed: true })
    fail(err, failTitle)
    return undefined
  } finally {
    patchRepo(repoId, (r) => ({ busy: { ...r.busy, [key]: undefined }, progress: null }))
  }
}

export async function fetchAll(repoId: string, quiet = false): Promise<void> {
  patchRepo(repoId, { autoFetchPaused: false })
  const ok = await remoteOp(repoId, 'fetch', 'Fetching', (opId) => call('remote.fetch', { repoId, opId }), 'Fetch failed')
  if (ok !== undefined) {
    patchRepo(repoId, { lastFetch: Date.now(), fetchFailed: false })
    if (!quiet) toast({ tone: 'success', title: 'Fetched all remotes' })
  }
  await loadRepo(repoId, { keepSelection: true })
}

/**
 * Pulls the checked-out branch. When uncommitted changes are in the way, asks: stash them and pull (they're put back
 * after), discard them and pull, or cancel. `autostash` is that first answer.
 */
export async function pull(repoId: string, mode?: PullMode, autostash = false): Promise<void> {
  const m = mode ?? useApp.getState().prefs.pullMode
  const res = await remoteOp(repoId, 'pull', 'Pulling', (opId) => call('remote.pull', { repoId, mode: m, opId, autostash }), 'Pull failed')
  if (res?.result === 'rejected') toast({ tone: 'error', title: 'Pull stopped', body: res.message })
  else if (res?.result === 'dirty') {
    confirm({
      title: 'Your changes are in the way',
      body: `${res.message} Stash them and pull (they’re put back after), or discard them and pull.`,
      confirmLabel: 'Stash and pull',
      danger: false,
      undoable: null,
      onConfirm: () => void pull(repoId, m, true),
      alt: {
        label: 'Discard and pull…',
        onSelect: () =>
          confirm({
            title: 'Discard your changes and pull?',
            body: 'This throws away all your uncommitted changes, including new files that were never committed, then pulls.',
            confirmLabel: 'Discard and pull',
            danger: true,
            undoable: true,
            onConfirm: async () => {
              if ((await attempt(() => call('worktree.discard', { repoId, paths: 'all' }), 'Couldn’t discard')) !== undefined) await pull(repoId, m)
            }
          })
      }
    })
  } else if (res?.result === 'ok' && res.message) toast({ tone: 'info', title: 'Pulled', body: res.message })
  else afterOp(repoId, res, 'Pulled')
  if (res) patchRepo(repoId, { lastFetch: Date.now(), fetchFailed: false })
  await loadRepo(repoId, { keepSelection: true })
}

function fastForwardResult(res: OpResult | undefined): void {
  if (!res) return
  if (res.result === 'ok') toast({ tone: 'success', title: res.message ?? 'Fast-forwarded' })
  else if (res.result === 'nothing') toast({ tone: 'info', title: res.message ?? 'Already up to date' })
  else if (res.result === 'rejected') toast({ tone: 'error', title: 'Can’t fast-forward', body: res.message })
}

/** Pulls a branch without switching to it: fetches what it tracks, then fast-forwards it (only a fast-forward). */
export async function pullBranch(repoId: string, name: string): Promise<void> {
  if (name === useApp.getState().repos[repoId]?.refs?.head.branch) return pull(repoId)
  const res = await remoteOp(repoId, 'pull', `Pulling ${name}`, (opId) => call('branch.fastForward', { repoId, name, fetch: true, opId }), `Couldn’t pull ${name}`)
  fastForwardResult(res)
  if (res) patchRepo(repoId, { lastFetch: Date.now(), fetchFailed: false })
  await loadRepo(repoId, { keepSelection: true })
}

/** Points a local branch that isn't checked out at `to`. Undo puts it back. */
export async function moveBranch(repoId: string, name: string, to: string): Promise<boolean> {
  const ok = await attempt(() => call('branch.move', { repoId, name, to }), `Couldn’t reset ${name}`)
  if (ok !== undefined) toast({ tone: 'success', title: `Reset ${name} to ${to}`, body: 'Undo puts it back.' })
  await loadRepo(repoId, { keepSelection: true })
  return ok !== undefined
}

/** The local branch for a remote one such as origin/x: the one that tracks it, or else the one named x. */
export function localFor(repoId: string, remoteBranch: string): Ref | undefined {
  const refs = useApp.getState().repos[repoId]?.refs?.refs ?? []
  const r = refs.find((x) => x.kind === 'remote' && x.short === remoteBranch)
  const name = r?.remote ? remoteBranch.slice(r.remote.length + 1) : remoteBranch.split('/').slice(1).join('/')
  return refs.find((x) => x.kind === 'local' && x.upstream === `refs/remotes/${remoteBranch}`) ?? refs.find((x) => x.kind === 'local' && x.short === name)
}

/**
 * For a remote branch such as origin/x: fast-forwards the local branch that tracks it (or the one with its name) to
 * it. With no such local branch, makes one that tracks it. With `checkout` (a double-click), it then checks that
 * branch out too, even when it couldn't be fast-forwarded (the toast says why); otherwise you stay where you are.
 */
export async function fastForwardTo(repoId: string, remoteBranch: string, opts: { checkout?: boolean } = {}): Promise<void> {
  const refs = useApp.getState().repos[repoId]?.refs?.refs ?? []
  const r = refs.find((x) => x.kind === 'remote' && x.short === remoteBranch)
  const name = r?.remote ? remoteBranch.slice(r.remote.length + 1) : remoteBranch.split('/').slice(1).join('/')
  if (!name || name === 'HEAD') return
  const local = localFor(repoId, remoteBranch)
  // No local branch yet: checking out the remote branch makes one that tracks it.
  if (!local && opts.checkout) return checkout(repoId, remoteBranch)
  const res = await attempt(() => call('branch.fastForward', { repoId, name: local?.short ?? name, to: remoteBranch, fetch: false, create: !local, opId: newOpId() }), `Couldn’t fast-forward ${local?.short ?? name}`)
  // It has commits of its own: offer to check it out as it is, or to reset it to the remote branch.
  if (opts.checkout && local && !local.worktree && res?.result === 'rejected') return offerReset(repoId, local, remoteBranch, res.ahead)
  // Up to date is the usual case for a double-click: no need to say so before switching.
  if (!(opts.checkout && res?.result === 'nothing')) fastForwardResult(res)
  if (opts.checkout && local && !local.isHead) return checkout(repoId, local.short)
  await loadRepo(repoId, { keepSelection: true })
}

/**
 * After a double-click on a remote branch whose local branch can't be fast-forwarded. Checking it out as it is comes
 * first; resetting moves a branch that isn't checked out (then checks it out), or hard-resets the checked-out one.
 * Both can be undone.
 */
function offerReset(repoId: string, local: Ref, remoteBranch: string, ahead?: number): void {
  const own = ahead ? plural(ahead, 'commit') : 'commits'
  confirm({
    title: `${local.short} can’t be fast-forwarded`,
    body:
      `${local.short} has ${own} that ${remoteBranch} doesn’t, so it can’t just move forward. ` +
      (local.isHead
        ? `Keep it as it is, or reset it to ${remoteBranch}: a hard reset, so your uncommitted changes are discarded too.`
        : `Check it out as it is, or reset it to ${remoteBranch} and check it out: its own commits are left out of it.`),
    confirmLabel: local.isHead ? 'Keep it as it is' : 'Check out as it is',
    danger: false,
    undoable: true,
    onConfirm: () => {
      if (!local.isHead) void checkout(repoId, local.short)
    },
    alt: {
      label: `Reset to ${remoteBranch}`,
      danger: true,
      onSelect: async () => {
        if (local.isHead) await reset(repoId, remoteBranch, 'hard', local.short)
        else if (await moveBranch(repoId, local.short, remoteBranch)) await checkout(repoId, local.short)
      }
    }
  })
}

type PushOpts = { setUpstream?: boolean; force?: boolean; remote?: string; branch?: string }

/**
 * Pushes, but first looks at the submodule pointers in the commits going out: if one names commits that aren't on
 * that submodule's remote, nobody else could set it up there. Depending on the setting it asks, or pushes those
 * submodules first (when each is on a branch that tracks a remote).
 */
export async function push(repoId: string, opts: PushOpts = {}, subChecked = false): Promise<void> {
  const subs = useApp.getState().repos[repoId]?.submodules
  if (!subChecked && !opts.force && subs?.settings.on && subs.settings.pushCheck !== 'off' && subs.list.some((m) => m.setUp)) {
    const missing = await call('submodule.unpushed', { repoId, branch: opts.branch }).catch(() => [])
    if (missing.length) {
      const pushable = missing.filter((m) => m.canPush)
      const stuck = missing.filter((m) => !m.canPush)
      const pushSubsFirst = async (): Promise<void> => {
        for (const m of pushable) {
          const ok = await remoteOp(repoId, 'push', `Pushing ${m.path}`, (opId) => call('submodule.push', { repoId, path: m.path, opId }), `Couldn’t push ${m.path}`)
          if (ok === undefined) return
        }
        await push(repoId, opts, true)
      }
      if (subs.settings.pushCheck === 'push' && !stuck.length) return pushSubsFirst()
      const list = missing.map((m) => `${m.path} (${plural(m.count, 'commit')})`).join(', ')
      confirm({
        title: missing.length === 1 ? `${missing[0].path} isn’t pushed` : `${plural(missing.length, 'submodule')} aren’t pushed`,
        body:
          `This push points at submodule commits that aren’t on their remote yet: ${list}. Anyone who pulls it couldn’t set ${missing.length === 1 ? 'that submodule' : 'those submodules'} up at those commits.` +
          (stuck.length ? ` ${stuck.map((m) => m.path).join(', ')} ${stuck.length === 1 ? 'isn’t' : 'aren’t'} on a branch that tracks a remote: open ${stuck.length === 1 ? 'it' : 'them'} and push from there.` : ''),
        confirmLabel: 'Push anyway',
        danger: true,
        undoable: false,
        onConfirm: () => void push(repoId, opts, true),
        alt: pushable.length ? { label: pushable.length === 1 ? `Push ${pushable[0].path} first` : `Push ${plural(pushable.length, 'submodule')} first`, onSelect: () => void pushSubsFirst() } : undefined
      })
      return
    }
  }
  const res = await remoteOp(repoId, 'push', 'Pushing', (opId) => call('remote.push', { repoId, opId, ...opts }), 'Push failed')
  const branch = opts.branch ?? useApp.getState().repos[repoId]?.refs?.head.branch ?? ''
  if (res?.result === 'needsUpstream') openDialog({ kind: 'publish', repoId, branch })
  else if (res?.result === 'stale') {
    toast({ tone: 'error', title: 'Force push stopped', body: res.message, action: { label: 'Fetch now', onClick: () => void fetchAll(repoId) } })
  } else if (res?.result === 'rejected') {
    confirm({
      title: 'Push was rejected',
      body: `${res.message} Force pushing replaces the remote branch with yours, unless someone pushed since your last fetch.`,
      confirmLabel: 'Force push',
      danger: true,
      undoable: false,
      onConfirm: () => void push(repoId, { ...opts, force: true })
    })
  } else if (res?.result === 'ok') {
    const where = opts.remote ? ` to ${opts.remote}` : ''
    toast({ tone: 'success', title: opts.force ? `Force pushed ${branch}${where}` : `Pushed ${branch}${where}` })
  }
  await loadRepo(repoId, { keepSelection: true })
}

// ---------- conflicts and paused operations ----------

export async function continueOp(repoId: string): Promise<void> {
  patchRepo(repoId, (r) => ({ busy: { ...r.busy, op: 'Continuing' } }))
  const res = await attempt(() => call('op.continue', { repoId }), 'Couldn’t continue')
  patchRepo(repoId, (r) => ({ busy: { ...r.busy, op: undefined } }))
  if (res?.result === 'conflicts') toast({ tone: 'info', title: 'More conflicts', body: 'The next commit also conflicts. Resolve these files, then continue again.' })
  else if (res?.result === 'ok') toast({ tone: 'success', title: 'Finished. Everything’s back in one piece.' })
  setCenter(repoId, { kind: 'graph' })
  await loadRepo(repoId, { keepSelection: true })
}

export async function skipOp(repoId: string): Promise<void> {
  const res = await attempt(() => call('op.skip', { repoId }), 'Couldn’t skip')
  afterOp(repoId, res, 'Rebase finished')
  setCenter(repoId, { kind: 'graph' })
  await loadRepo(repoId, { keepSelection: true })
}

export function abortOp(repoId: string): void {
  confirm({
    title: 'Abort?',
    body: 'This stops the operation and puts the branch back where it was before it started. Conflict fixes made so far are lost.',
    confirmLabel: 'Abort',
    danger: true,
    undoable: false,
    onConfirm: async () => {
      await attempt(() => call('op.abort', { repoId }), 'Couldn’t abort')
      setCenter(repoId, { kind: 'graph' })
      await loadRepo(repoId, { keepSelection: true })
    }
  })
}

// ---------- undo ----------

export async function undo(repoId: string): Promise<void> {
  const label = useApp.getState().repos[repoId]?.undo.undo?.label
  const ok = await attempt(() => call('undo.undo', { repoId }), 'Couldn’t undo')
  if (ok !== undefined && label) toast({ tone: 'info', title: `Undid: ${label}` })
  await loadRepo(repoId, { keepSelection: true })
}

export async function redo(repoId: string): Promise<void> {
  const label = useApp.getState().repos[repoId]?.undo.redo?.label
  const ok = await attempt(() => call('undo.redo', { repoId }), 'Couldn’t redo')
  if (ok !== undefined && label) toast({ tone: 'info', title: `Redid: ${label}` })
  await loadRepo(repoId, { keepSelection: true })
}

// ---------- search ----------

let searchTimer: ReturnType<typeof setTimeout> | undefined
export function setSearch(repoId: string, q: string): void {
  patchRepo(repoId, { search: q })
  clearTimeout(searchTimer)
  if (!q.trim()) return patchRepo(repoId, { searchHits: null })
  searchTimer = setTimeout(async () => {
    const hits = await attempt(() => call('search.commits', { repoId, query: q }))
    if (hits) patchRepo(repoId, { searchHits: hits })
  }, 200)
}

// ---------- line and hunk staging, ignore ----------

const patchTitles = { stage: 'Couldn’t stage those lines', unstage: 'Couldn’t unstage those lines', discard: 'Couldn’t discard those lines' }

export async function applyPatch(
  repoId: string,
  input: { path: string; source: 'worktree' | 'index'; hunk: number; header: string; lines: number[] | null; action: 'stage' | 'unstage' | 'discard'; full: boolean }
): Promise<boolean> {
  const ok = await attempt(() => call('index.applyPatch', { repoId, ...input }), patchTitles[input.action])
  await loadStatus(repoId)
  return ok !== undefined
}

/** Adds lines to the root .gitignore; tracked files they cover stop being tracked and stay on disk. Undoable. */
export async function ignore(repoId: string, choice: IgnoreChoice): Promise<boolean> {
  const res = await attempt(() => call('ignore.add', { repoId, patterns: choice.patterns, label: choice.what }), 'Couldn’t update .gitignore')
  if (res) {
    toast({
      tone: 'success',
      title: `Ignoring ${choice.what}`,
      body: res.untracked
        ? `Git stopped tracking ${plural(res.untracked, 'file')}; ${res.untracked === 1 ? 'it stays' : 'they stay'} on disk. Commit to record it.`
        : 'Commit .gitignore to share it.'
    })
  }
  await loadStatus(repoId)
  return res !== undefined
}

// ---------- stash ----------

export async function stashSave(repoId: string, message: string, stagedOnly: boolean): Promise<boolean> {
  const includeUntracked = useApp.getState().prefs.stashUntracked
  const res = await attempt(() => call('stash.save', { repoId, message, stagedOnly, includeUntracked }), 'Couldn’t stash')
  if (res?.result === 'nothing') toast({ tone: 'info', title: res.message ?? 'Nothing to stash' })
  else if (res?.result === 'ok') toast({ tone: 'success', title: stagedOnly ? 'Staged changes stashed' : 'Changes stashed', body: message || undefined })
  await loadRepo(repoId, { keepSelection: true })
  if (res?.result === 'ok' && useApp.getState().repos[repoId]?.selected === 'wip') patchRepo(repoId, { selected: null })
  return res?.result === 'ok'
}

export async function stashApply(repoId: string, sha: string, pop: boolean): Promise<void> {
  const res = await attempt(() => call(pop ? 'stash.pop' : 'stash.apply', { repoId, sha }), pop ? 'Couldn’t pop the stash' : 'Couldn’t apply the stash')
  if (res?.result === 'conflicts') {
    toast({ tone: 'info', title: 'The stash conflicts with your files', body: `${res.message ?? ''} Resolve the conflicted files, then stage them.`.trim() })
    select(repoId, 'wip')
  } else if (res?.result === 'ok') toast({ tone: 'success', title: pop ? 'Stash popped' : 'Stash applied' })
  await loadRepo(repoId, { keepSelection: true })
}

/** Toolbar Pop: the newest stash. */
export function popLatest(repoId: string): void {
  const s = useApp.getState().repos[repoId]?.refs?.stashes[0]
  if (s) void stashApply(repoId, s.sha, true)
}

export function stashDrop(repoId: string, sha: string, label: string): void {
  confirm({
    title: 'Delete this stash?',
    body: `“${label}” and the changes in it will be removed from your stash list.`,
    confirmLabel: 'Delete stash',
    danger: true,
    undoable: true,
    onConfirm: async () => {
      const ok = await attempt(() => call('stash.drop', { repoId, sha }), 'Couldn’t delete the stash')
      if (ok !== undefined && useApp.getState().repos[repoId]?.selected === sha) patchRepo(repoId, { selected: null })
      await loadRepo(repoId, { keepSelection: true })
    }
  })
}

// ---------- tags ----------

export async function createTag(repoId: string, name: string, at: string, message: string | null): Promise<boolean> {
  const ok = await attempt(() => call('tag.create', { repoId, name, at, message }), 'Couldn’t create the tag')
  if (ok !== undefined) toast({ tone: 'success', title: `Tagged ${name}` })
  await loadRepo(repoId, { keepSelection: true })
  return ok !== undefined
}

export function deleteTag(repoId: string, name: string): void {
  confirm({
    title: `Delete tag ${name}?`,
    body: 'This removes the tag from your copy only. If it was pushed, the remote keeps it until you delete it there too.',
    confirmLabel: 'Delete tag',
    danger: true,
    undoable: true,
    onConfirm: async () => {
      await attempt(() => call('tag.delete', { repoId, name }), 'Couldn’t delete the tag')
      await loadRepo(repoId, { keepSelection: true })
    }
  })
}

function defaultRemote(repoId: string): string | undefined {
  const remotes = useApp.getState().repos[repoId]?.refs?.remotes ?? []
  return remotes.includes('origin') ? 'origin' : remotes[0]
}

/** Stands for every remote in pushTag. */
export const ALL_REMOTES = '*'

/** Pushes a tag to one remote (origin, or the first one, by default) or to all of them, one after the other. */
export async function pushTag(repoId: string, name: string, remote?: string): Promise<void> {
  const all = useApp.getState().repos[repoId]?.refs?.remotes ?? []
  const targets = remote === ALL_REMOTES ? all : [remote ?? defaultRemote(repoId)].filter((r): r is string => !!r)
  if (!targets.length) return void toast({ tone: 'error', title: 'No remote to push to', body: 'Add a remote first.' })
  const done: string[] = []
  for (const r of targets) {
    const ok = await remoteOp(repoId, 'push', 'Pushing tag', (opId) => call('tag.push', { repoId, name, remote: r, opId }), `Couldn’t push ${name} to ${r}`)
    if (ok !== undefined) done.push(r)
  }
  if (done.length) toast({ tone: 'success', title: `Pushed tag ${name} to ${done.join(', ')}` })
}

/** "refs/remotes/origin/feature/x" → origin + feature/x, if we know that remote-tracking branch (and it isn't origin/HEAD). */
export function remoteBranchOf(repoId: string, full: string | undefined): { remote: string; name: string } | null {
  const r = useApp.getState().repos[repoId]?.refs?.refs.find((x) => x.kind === 'remote' && x.name === full)
  if (!r?.remote) return null
  const name = r.short.slice(r.remote.length + 1)
  return name && name !== 'HEAD' ? { remote: r.remote, name } : null
}

/** Deletes a branch on a remote, e.g. remote "origin", name "feature/x". Can't be undone from here, so the toast keeps the commit. */
export function deleteRemoteBranch(repoId: string, remote: string, name: string): void {
  // The local branch that tracks it, or one with the same name.
  const locals = useApp.getState().repos[repoId]?.refs?.refs.filter((r) => r.kind === 'local') ?? []
  const local = locals.find((r) => r.upstream === `refs/remotes/${remote}/${name}`) ?? locals.find((r) => r.short === name)
  confirm({
    title: `Delete ${name} from ${remote}?`,
    body: `This removes the branch on ${remote} for everyone who uses it.${local ? ` Your local ${local.short} stays.` : ''} Anyone who already fetched it keeps their copy, and you can push it again while you still have its commits.`,
    confirmLabel: `Delete from ${remote}`,
    danger: true,
    undoable: false,
    onConfirm: async () => {
      const sha = await remoteOp(repoId, 'push', 'Deleting branch', (opId) => call('branch.deleteRemote', { repoId, remote, name, opId }), `Couldn’t delete ${name} from ${remote}`)
      if (sha !== undefined) toast({ tone: 'success', title: `Deleted ${name} from ${remote}`, body: sha ? `It was at ${sha.slice(0, 7)}.` : undefined })
      await loadRepo(repoId, { keepSelection: true })
    }
  })
}

export function deleteRemoteTag(repoId: string, name: string, which?: string): void {
  const remote = which ?? defaultRemote(repoId)
  if (!remote) return
  confirm({
    title: `Delete ${name} from ${remote}?`,
    body: `Anyone who already fetched the tag keeps their copy. Your own copy stays too.`,
    confirmLabel: `Delete from ${remote}`,
    danger: true,
    undoable: false,
    onConfirm: async () => {
      const ok = await remoteOp(repoId, 'push', 'Deleting tag', (opId) => call('tag.deleteRemote', { repoId, name, remote, opId }), `Couldn’t delete ${name} from ${remote}`)
      if (ok !== undefined) toast({ tone: 'success', title: `Deleted ${name} from ${remote}` })
    }
  })
}

// ---------- reset, revert, cherry-pick, interactive rebase ----------

/** Resets the checked-out branch. With `branch`, only if that's still the one checked out. */
export async function reset(repoId: string, target: string, mode: ResetMode, branch?: string): Promise<boolean> {
  const ok = await attempt(() => call('history.reset', { repoId, target, mode, branch }), 'Couldn’t reset')
  if (ok !== undefined) toast({ tone: 'success', title: `Reset to ${/^[0-9a-f]{40}$/.test(target) ? target.slice(0, 7) : target}`, body: 'Undo puts everything back.' })
  await loadRepo(repoId, { keepSelection: true })
  return ok !== undefined
}

export function revert(repoId: string, sha: string, isMerge: boolean): void {
  const run = async (): Promise<void> => {
    const res = await attempt(() => call('history.revert', { repoId, sha }), 'Couldn’t revert')
    afterOp(repoId, res, `Reverted ${sha.slice(0, 7)}`)
    await loadRepo(repoId, { keepSelection: true })
  }
  if (!isMerge) return void run()
  confirm({
    title: 'Revert a merge?',
    body: 'This adds a commit that removes everything the merge brought in, keeping the branch it was merged into. Merging that branch again later won’t bring those changes back by itself.',
    confirmLabel: 'Revert merge',
    danger: false,
    undoable: true,
    onConfirm: () => void run()
  })
}

export async function cherryPick(repoId: string, shas: string[]): Promise<boolean> {
  const head = useApp.getState().repos[repoId]?.refs?.head.branch ?? 'HEAD'
  const res = await attempt(() => call('history.cherryPick', { repoId, shas }), 'Couldn’t cherry-pick')
  afterOp(repoId, res, shas.length === 1 ? `Copied ${shas[0].slice(0, 7)} onto ${head}` : `Copied ${shas.length} commits onto ${head}`)
  await loadRepo(repoId, { keepSelection: true })
  return !!res && res.result !== 'conflicts'
}

export async function rebaseInteractive(repoId: string, onto: string, plan: RebaseStep[], noVerify = false): Promise<boolean> {
  patchRepo(repoId, (r) => ({ busy: { ...r.busy, op: 'Rebasing' } }))
  const res = await attempt(() => call('rebase.interactive', { repoId, onto, plan, noVerify }), 'Interactive rebase failed')
  patchRepo(repoId, (r) => ({ busy: { ...r.busy, op: undefined } }))
  afterOp(repoId, res, 'Rebase finished')
  if (res) setCenter(repoId, { kind: 'graph' })
  await loadRepo(repoId, { keepSelection: true })
  return !!res
}

// ---------- remotes ----------

export async function addRemote(repoId: string, name: string, url: string, fetchAfter: boolean): Promise<boolean> {
  const ok = await attempt(() => call('remote.add', { repoId, name, url }), 'Couldn’t add the remote')
  if (ok === undefined) return false
  toast({ tone: 'success', title: `Added remote ${name}` })
  if (fetchAfter) await fetchAll(repoId, true)
  else await loadRepo(repoId, { keepSelection: true })
  return true
}

export function removeRemote(repoId: string, name: string): void {
  confirm({
    title: `Remove remote ${name}?`,
    body: `The app stops pushing to and pulling from ${name}, and its branches disappear from the list. Nothing on the server is deleted.`,
    confirmLabel: 'Remove remote',
    danger: true,
    undoable: true,
    onConfirm: async () => {
      await attempt(() => call('remote.remove', { repoId, name }), 'Couldn’t remove the remote')
      await loadRepo(repoId, { keepSelection: true })
    }
  })
}

export async function setUpstream(repoId: string, name: string, upstream: string): Promise<boolean> {
  const ok = await attempt(() => call('branch.setUpstream', { repoId, name, upstream }), 'Couldn’t set the upstream')
  if (ok !== undefined) toast({ tone: 'success', title: `${name} now tracks ${upstream}` })
  await loadRepo(repoId, { keepSelection: true })
  return ok !== undefined
}

// ---------- hide / solo ----------

export async function setRefView(repoId: string, ref: string, state: 'normal' | 'hidden' | 'soloed'): Promise<void> {
  const view = await attempt(() => call('refView.set', { repoId, ref, state }))
  if (view) patchRepo(repoId, { refView: view })
  await loadRepo(repoId, { keepSelection: true })
}

export async function pinLeft(repoId: string, ref: string | null): Promise<void> {
  const view = await attempt(() => call('refView.pin', { repoId, ref }), 'Couldn’t pin the branch')
  if (view) patchRepo(repoId, { refView: view })
  await loadRepo(repoId, { keepSelection: true })
}

/** Hide or show a folder, a remote or a whole section in one go. */
export async function setRefViewMany(repoId: string, refs: string[], state: 'normal' | 'hidden'): Promise<void> {
  if (!refs.length) return
  const view = await attempt(() => call('refView.setMany', { repoId, refs, state }), state === 'hidden' ? 'Couldn’t hide them' : 'Couldn’t show them')
  if (view) patchRepo(repoId, { refView: view })
  await loadRepo(repoId, { keepSelection: true })
}

export async function clearRefView(repoId: string): Promise<void> {
  const v = useApp.getState().repos[repoId]?.refView
  for (const ref of [...(v?.hidden ?? []), ...(v?.soloed ?? [])]) await attempt(() => call('refView.set', { repoId, ref, state: 'normal' }))
  patchRepo(repoId, (r) => ({ refView: { hidden: [], soloed: [], pinned: r.refView.pinned } }))
  await loadRepo(repoId, { keepSelection: true })
}

// ---------- credential prompts ----------

export async function answerAuth(promptId: string, answer: string | null): Promise<void> {
  useApp.setState({ authPrompt: null })
  await call('auth.respond', { promptId, answer }).catch(() => {})
}

// ---------- background fetch ----------

const autoFetchState = { hiddenSince: null as number | null, timer: undefined as ReturnType<typeof setInterval> | undefined }

/** Fetches each open repo every `autoFetchMinutes`. Never prompts for credentials; stops for a repo after an auth failure. */
export function startAutoFetch(): void {
  clearInterval(autoFetchState.timer)
  document.addEventListener('visibilitychange', () => {
    autoFetchState.hiddenSince = document.hidden ? Date.now() : null
  })
  autoFetchState.timer = setInterval(() => {
    const s = useApp.getState()
    const every = s.prefs.autoFetchMinutes * 60_000
    if (!every) return
    // Hidden for more than 10 minutes: nobody is looking, so don't keep hitting the remotes.
    if (autoFetchState.hiddenSince && Date.now() - autoFetchState.hiddenSince > 10 * 60_000) return
    for (const t of s.tabs) {
      const r = s.repos[t.id]
      if (!r?.refs || r.refs.remotes.length === 0 || r.autoFetchPaused || Object.values(r.busy).some(Boolean)) continue
      if (r.status?.op && r.status.op.kind !== 'none') continue
      if (Date.now() - (r.lastFetch ?? r.openedAt) < every) continue
      void backgroundFetch(t.id)
    }
  }, 15_000)
}

async function backgroundFetch(repoId: string): Promise<void> {
  patchRepo(repoId, (r) => ({ busy: { ...r.busy, fetch: 'Fetching' } }))
  try {
    await call('remote.fetch', { repoId, opId: newOpId(), background: true })
    patchRepo(repoId, { lastFetch: Date.now(), fetchFailed: false })
  } catch (err) {
    // Shown in the status bar, not as a toast. Auth failures pause it until a manual fetch.
    patchRepo(repoId, { fetchFailed: true, autoFetchPaused: err instanceof ApiError && err.code === 'auth', lastFetch: Date.now() })
  } finally {
    patchRepo(repoId, (r) => ({ busy: { ...r.busy, fetch: undefined } }))
  }
  await loadRepo(repoId, { keepSelection: true })
}

// ---------- stash names, graph layout, focus ----------

export async function renameStash(repoId: string, sha: string, message: string): Promise<boolean> {
  const ok = await attempt(() => call('stash.rename', { repoId, sha, message }), 'Couldn’t rename the stash')
  await loadRepo(repoId, { keepSelection: true })
  return ok !== undefined
}

export function setColumns(repoId: string, columns: GraphColumn[]): void {
  patchRepo(repoId, { columns })
  void call('graph.setColumns', { repoId, columns }).catch(() => {})
}

/** Remembers the Graph column's width for this repository; null goes back to fitting the lanes. */
export function setGraphWidth(repoId: string, width: number | null): void {
  patchRepo(repoId, { graphWidth: width })
  void call('repoPrefs.set', { repoId, key: 'graph.width', value: width }).catch(() => {})
}

export async function setFocusHead(repoId: string, on: boolean): Promise<void> {
  patchRepo(repoId, { focusHead: on })
  await attempt(() => call('repoPrefs.set', { repoId, key: 'graph.focusHead', value: on }))
  await loadRepo(repoId, { keepSelection: true })
}

// ---------- other programs ----------

const openTitles = { folder: 'Couldn’t open the folder', terminal: 'Couldn’t open a terminal', editor: 'Couldn’t open the editor' }

export async function openIn(repoId: string, target: 'folder' | 'terminal' | 'editor', path?: string, worktree?: string): Promise<void> {
  await attempt(() => call('shell.open', { repoId, target, path, worktree }), openTitles[target])
}

/** The diff / merge tool can stay open for a long time, so this doesn't block anything; the file watcher picks up the result. */
export function externalTool(repoId: string, kind: 'diff' | 'merge', path: string, staged = false): void {
  toast({ tone: 'info', title: kind === 'diff' ? 'Opening your diff tool' : 'Opening your merge tool', body: path })
  const p = kind === 'diff' ? call('file.externalDiff', { repoId, path, staged }) : call('file.externalMerge', { repoId, path })
  p.then(() => {
    if (kind === 'merge') void loadRepo(repoId, { keepSelection: true })
  }).catch((err) => fail(err, kind === 'diff' ? 'Couldn’t open the diff tool' : 'Couldn’t open the merge tool'))
}

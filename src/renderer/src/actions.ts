// Every user action that touches git goes through here: call main, toast on failure, refresh what changed.
import type { DiffSource, GraphColumn, PullMode, RebaseStep, ResetMode } from '../../shared/types'
import { ApiError, call, newOpId, on } from './lib/api'
import { plural } from './lib/format'
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
        toast({ tone: 'info', title: 'Started without graphics acceleration', body: 'It crashed last time, so Mergatroid is drawing in software. You can turn it back on in Settings.' })
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
      if (Object.keys(r.busy).length) patchRepo(id, { progress: { phase: p.phase, percent: p.percent } })
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
  } catch {
    // shown by the next full load
  }
}

export async function loadRepo(repoId: string, opts: { keepSelection?: boolean } = {}): Promise<void> {
  if (!useApp.getState().repos[repoId]) patchRepo(repoId, emptyRepo())
  patchRepo(repoId, { loading: true })
  const seq = next(repoSeq, repoId)
  const sseq = next(statusSeq, repoId)
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
    patchRepo(repoId, (r) => ({
      refs,
      ...(freshStatus ? { status, undo } : {}),
      refView,
      columns: columns ?? DEFAULT_COLUMNS,
      focusHead: repoPrefs['graph.focusHead'] === true,
      commits: page.commits,
      hasMore: page.hasMore,
      layout,
      loading: false,
      loadError: null,
      multi: opts.keepSelection && r.multi.every((m) => page.commits.some((c) => c.sha === m)) ? r.multi : [],
      selected: opts.keepSelection && r.selected && (r.selected === 'wip' || page.commits.some((c) => c.sha === r.selected)) ? r.selected : r.selected ?? (status.changes.length ? 'wip' : null)
    }))
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
  useApp.setState({ detailOpen: true })
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
  useApp.setState({ detailOpen: true })
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
  useApp.setState({ detailOpen: true })
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
export function reword(repoId: string, sha: string, message: string, done?: (ok: boolean) => void): void {
  guardPushed(repoId, [sha], 'Edit the message', () =>
    void rewriteOp(repoId, () => call('history.reword', { repoId, sha, message }), 'Couldn’t change the message', 'Message changed', headLine(repoId).indexOf(sha)).then((ok) => done?.(ok))
  )
}

export function squash(repoId: string, shas: string[], message: string, done?: (ok: boolean) => void): void {
  guardPushed(repoId, shas, `Squash ${shas.length} commits`, () =>
    void rewriteOp(repoId, () => call('history.squash', { repoId, shas, message }), 'Couldn’t squash', `Squashed ${shas.length} commits into one`, Math.min(...shas.map((s) => headLine(repoId).indexOf(s)))).then((ok) => done?.(ok))
  )
}

/** Opens the squash dialog, its message made from the commits' summaries (oldest first). */
export function askSquash(repoId: string, shas: string[]): void {
  if (blocked(repoId, 'Squashing')) return
  const r = useApp.getState().repos[repoId]
  const rows = shas.map((s) => r?.commits.find((c) => c.sha === s)).filter((c): c is NonNullable<typeof c> => !!c).reverse()
  const [first, ...rest] = rows
  const message = first ? [first.summary, rest.length ? '' : null, ...rest.map((c) => `- ${c.summary}`)].filter((x) => x !== null).join('\n') : ''
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

export async function commit(
  repoId: string,
  input: { summary: string; body: string; amend: boolean; noVerify: boolean; push: boolean; messageOnly?: boolean }
): Promise<boolean> {
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

export async function checkout(repoId: string, ref: string): Promise<void> {
  const ok = await attempt(() => call('branch.checkout', { repoId, ref }), `Couldn’t switch to ${ref}`)
  if (ok !== undefined) toast({ tone: 'success', title: `Switched to ${ref}` })
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

export function deleteBranch(repoId: string, name: string): void {
  confirm({
    title: `Delete ${name}?`,
    body: `This removes the local branch ${name}. Its commits stay if another branch contains them.`,
    confirmLabel: 'Delete branch',
    danger: true,
    undoable: true,
    onConfirm: async () => {
      try {
        await call('branch.delete', { repoId, name, force: false })
        toast({ tone: 'success', title: `Deleted ${name}` })
      } catch (err) {
        if (err instanceof ApiError && /aren’t merged/.test(err.message)) {
          confirm({
            title: `${name} isn’t merged`,
            body: err.message,
            confirmLabel: 'Delete anyway',
            danger: true,
            undoable: true,
            onConfirm: async () => {
              await attempt(() => call('branch.delete', { repoId, name, force: true }), 'Couldn’t delete the branch')
              await loadRepo(repoId, { keepSelection: true })
            }
          })
        } else fail(err, 'Couldn’t delete the branch')
      }
      await loadRepo(repoId, { keepSelection: true })
    }
  })
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

export async function pull(repoId: string, mode?: PullMode): Promise<void> {
  const m = mode ?? useApp.getState().prefs.pullMode
  const res = await remoteOp(repoId, 'pull', 'Pulling', (opId) => call('remote.pull', { repoId, mode: m, opId }), 'Pull failed')
  if (res?.result === 'rejected') toast({ tone: 'error', title: 'Pull stopped', body: res.message })
  else afterOp(repoId, res, 'Pulled')
  if (res) patchRepo(repoId, { lastFetch: Date.now(), fetchFailed: false })
  await loadRepo(repoId, { keepSelection: true })
}

export async function push(repoId: string, opts: { setUpstream?: boolean; force?: boolean; remote?: string; branch?: string } = {}): Promise<void> {
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

export async function ignore(repoId: string, pattern: string, stopTracking: string[]): Promise<boolean> {
  const ok = await attempt(() => call('ignore.add', { repoId, pattern, stopTracking }), 'Couldn’t update .gitignore')
  if (ok !== undefined) toast({ tone: 'success', title: `Ignoring ${pattern}`, body: stopTracking.length ? 'Git stopped tracking the matching files. Commit to record that.' : undefined })
  await loadStatus(repoId)
  return ok !== undefined
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

export async function reset(repoId: string, target: string, mode: ResetMode): Promise<boolean> {
  const ok = await attempt(() => call('history.reset', { repoId, target, mode }), 'Couldn’t reset')
  if (ok !== undefined) toast({ tone: 'success', title: `Reset to ${target.slice(0, 7)}`, body: 'Undo puts everything back.' })
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

export async function rebaseInteractive(repoId: string, onto: string, plan: RebaseStep[]): Promise<boolean> {
  patchRepo(repoId, (r) => ({ busy: { ...r.busy, op: 'Rebasing' } }))
  const res = await attempt(() => call('rebase.interactive', { repoId, onto, plan }), 'Interactive rebase failed')
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
  const view = await attempt(() => call('refView.setMany', { repoId, refs, state }), state === 'hidden' ? 'Couldn’t hide the branches' : 'Couldn’t show the branches')
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

export async function setFocusHead(repoId: string, on: boolean): Promise<void> {
  patchRepo(repoId, { focusHead: on })
  await attempt(() => call('repoPrefs.set', { repoId, key: 'graph.focusHead', value: on }))
  await loadRepo(repoId, { keepSelection: true })
}

// ---------- other programs ----------

const openTitles = { folder: 'Couldn’t open the folder', terminal: 'Couldn’t open a terminal', editor: 'Couldn’t open the editor' }

export async function openIn(repoId: string, target: 'folder' | 'terminal' | 'editor', path?: string): Promise<void> {
  await attempt(() => call('shell.open', { repoId, target, path }), openTitles[target])
}

/** The diff / merge tool can stay open for a long time, so this doesn't block anything; the file watcher picks up the result. */
export function externalTool(repoId: string, kind: 'diff' | 'merge', path: string, staged = false): void {
  toast({ tone: 'info', title: kind === 'diff' ? 'Opening your diff tool' : 'Opening your merge tool', body: path })
  const p = kind === 'diff' ? call('file.externalDiff', { repoId, path, staged }) : call('file.externalMerge', { repoId, path })
  p.then(() => {
    if (kind === 'merge') void loadRepo(repoId, { keepSelection: true })
  }).catch((err) => fail(err, kind === 'diff' ? 'Couldn’t open the diff tool' : 'Couldn’t open the merge tool'))
}

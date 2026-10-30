import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { z, type ZodType } from 'zod'
import type { Api, Channel } from '../../shared/api'
import type { ActivityEntry, ProgressEvent, Result, SubmoduleSettings } from '../../shared/types'
import type { Db } from '../db'
import { uuid } from '../db'
import { GcFail, invalid } from '../errors'
import type { GitRunner } from '../git/runner'
import { UNDO_REFS, samePath } from '../git/ops'
import type { Repos } from '../repos'
import type { UndoStack } from '../undo'
import type { GraphLayouts, Prefs, RefView, RepoPrefs } from '../settings'
import { defaultCommand, launch } from '../tools'
import { generateKey, listKeys } from '../ssh'
import { shell } from 'electron'
import type { Askpass } from '../askpass'
import type { Profiles } from '../profiles'
import { gpuState, setGpu } from '../gpu'
import { homedir } from 'node:os'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

const repoId = z.string().uuid()
const R = { repoId }
const paths = z.union([z.literal('all'), z.array(z.string().min(1)).min(1).max(5000)])
const opId = z.string().min(8).max(64)
const ref = z.string().min(1).max(400)
/** A commit's short sha for labels; a branch or tag name as it is. */
const shortRef = (r: string): string => (/^[0-9a-f]{40}$/.test(r) ? r.slice(0, 7) : r)

interface Deps {
  db: Db
  runner: GitRunner
  repos: Repos
  undo: UndoStack
  prefs: Prefs
  refView: RefView
  repoPrefs: RepoPrefs
  layouts: GraphLayouts
  askpass: Askpass
  profiles: Profiles
  /** Makes another profile the active one (watchers included). */
  switchProfile: (id: string) => void
  /** Forget which settings repositories set themselves, after Settings changes one. */
  forgetRepoConfig: () => void
  tmpDir: string
  isTrustedSender: (e: IpcMainInvokeEvent) => boolean
}

export function registerIpc({ db, runner, repos, undo, prefs, refView, repoPrefs, layouts, askpass, profiles, switchProfile, forgetRepoConfig, tmpDir, isTrustedSender }: Deps): void {
  const progress = (id: string) => (phase: string, percent?: number, done?: number, total?: number) => {
    const ev: ProgressEvent = { opId: id, phase, percent, done, total }
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send('op:progress', ev)
  }
  const output = (id: string) => (line: string) => {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send('op:output', { opId: id, line })
  }

  function handle<C extends Channel>(channel: C, schema: ZodType<Api[C]['in']>, fn: (input: Api[C]['in'], e: IpcMainInvokeEvent) => Promise<Api[C]['out']> | Api[C]['out']): void {
    ipcMain.handle(channel, async (e, raw): Promise<Result<Api[C]['out']>> => {
      if (!isTrustedSender(e)) return { ok: false, error: { code: 'internal', message: 'Untrusted sender.' } }
      const parsed = schema.safeParse(raw)
      if (!parsed.success) {
        return { ok: false, error: { code: 'invalid', message: 'The app sent an invalid request.', detail: parsed.error.message } }
      }
      try {
        return { ok: true, value: await fn(parsed.data, e) }
      } catch (err) {
        if (err instanceof GcFail) return { ok: false, error: err.toJSON() }
        console.error(channel, err)
        return { ok: false, error: { code: 'internal', message: 'Something went wrong.', detail: String((err as Error)?.stack ?? err) } }
      }
    })
  }

  const ops = (id: string) => repos.get(id)
  const pruned = new Set<string>()

  // Requests that change a repo run one at a time per repo, so an action and its undo record
  // finish together before the next action (say, an Undo click) starts.
  const locks = new Map<string, Promise<unknown>>()
  function exclusive<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = locks.get(id) ?? Promise.resolve()
    const next = prev.catch(() => {}).then(fn)
    locks.set(id, next)
    return next
  }

  /** Runs a history-changing action and records it for undo once it completes. */
  async function undoable<T>(id: string, type: Parameters<UndoStack['record']>[1], label: string, run: () => Promise<T>, finished: (r: T) => boolean = () => true): Promise<T> {
    return exclusive(id, async () => {
      const o = ops(id)
      const before = await undo.snapshot(o)
      const result = await run()
      if (finished(result)) undo.record(id, type, label, before, await undo.snapshot(o))
      else undo.setPending(id, type, label, before)
      return result
    })
  }

  handle('dialog.pickFolder', z.object({ title: z.string().max(200) }), async ({ title }, e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    // Opens where the last folder was picked: in its parent, so it's right there to pick again or step past.
    const last = prefs.getAll()['dialog.lastFolder']
    const at = typeof last === 'string' && existsSync(dirname(last)) ? dirname(last) : undefined
    const res = await dialog.showOpenDialog(win!, { title, defaultPath: at, properties: ['openDirectory', 'createDirectory'] })
    const picked = res.canceled ? null : (res.filePaths[0] ?? null)
    if (picked) prefs.set('dialog.lastFolder', picked)
    return picked
  })

  // ---------- repositories ----------
  handle('repo.open', z.object({ path: z.string().min(1).max(4096) }), ({ path }) => repos.open(path))
  handle('repo.list', z.object({}), () => repos.list())
  handle('repo.close', z.object(R), ({ repoId }) => (repos.close(repoId), null))
  handle('repo.reorderTabs', z.object({ repoIds: z.array(repoId).max(200) }), ({ repoIds }) => (repos.reorder(repoIds), null))
  handle(
    'repo.update',
    z.object({ ...R, alias: z.string().max(200).nullable().optional(), isFavorite: z.boolean().optional(), groupId: z.string().uuid().nullable().optional() }),
    ({ repoId, ...patch }) => repos.update(repoId, patch)
  )
  handle('group.create', z.object({ name: z.string().max(200) }), ({ name }) => repos.createGroup(name))
  handle('group.rename', z.object({ groupId: z.string().uuid(), name: z.string().max(200) }), ({ groupId, name }) => (repos.renameGroup(groupId, name), null))
  handle('group.delete', z.object({ groupId: z.string().uuid() }), ({ groupId }) => (repos.deleteGroup(groupId), null))
  handle('repo.forget', z.object(R), ({ repoId }) => (repos.forget(repoId), null))
  handle(
    'repo.clone',
    z.object({
      url: z.string().min(1).max(2048),
      dest: z.string().min(1).max(4096),
      opId,
      depth: z.number().int().min(1).max(100000).optional(),
      branch: z.string().max(400).optional(),
      sparse: z.array(z.string().min(1).max(1024)).max(200).optional()
    }),
    (input) => repos.clone(input, progress(input.opId))
  )
  handle(
    'repo.init',
    z.object({ parentDir: z.string().min(1).max(4096), name: z.string().min(1).max(255), defaultBranch: z.string().max(255), gitignore: z.string().max(40).nullable(), license: z.string().max(40).nullable() }),
    (input) => repos.init(input)
  )
  handle('op.cancel', z.object({ opId }), ({ opId }) => (runner.cancel(opId), null))

  // ---------- reads ----------
  handle('graph.load', z.object({ ...R, skip: z.number().int().min(0), limit: z.number().int().min(1).max(5000) }), async ({ repoId, skip, limit }) => {
    const o = ops(repoId)
    const refs = await o.refs()
    refView.prune(repoId, new Set(refs.refs.map((r) => r.name)))
    if (!pruned.has(repoId)) {
      // Once per session: drop undo safety refs no entry needs any more.
      pruned.add(repoId)
      await exclusive(repoId, () => o.pruneUndoRefs(undo.referencedShas(repoId))).catch((e) => console.error('prune', e))
    }
    const view = refView.get(repoId)
    if (repoPrefs.getAll(repoId)['graph.focusHead'] === true) view.soloed = [...new Set([...view.soloed, ...(await o.focusRefs(refs))])]
    return o.graph(skip, limit, refs.stashes, view)
  })
  handle('refs.list', z.object(R), ({ repoId }) => ops(repoId).refs())
  handle('status.get', z.object(R), ({ repoId }) => ops(repoId).status())
  handle('lfs.state', z.object(R), ({ repoId }) => ops(repoId).lfsState())
  handle('lfs.turnOn', z.object({ ...R, opId }), async ({ repoId, opId }) => (await ops(repoId).lfsTurnOn(opId, progress(opId)), null))
  handle('lfs.track', z.object({ ...R, pattern: z.string().min(1).max(4096), exact: z.boolean() }), async ({ repoId, pattern, exact }) => (await ops(repoId).lfsTrack(pattern, exact), null))
  handle('lfs.untrack', z.object({ ...R, pattern: z.string().min(1).max(4096) }), async ({ repoId, pattern }) => (await ops(repoId).lfsUntrack(pattern), null))
  // ---------- submodules ----------
  const subSettings = async (repoId: string): Promise<SubmoduleSettings> => {
    const p = repoPrefs.getAll(repoId)
    const mode = p['submodules.mode']
    return {
      on: p['submodules.on'] !== false,
      mode: mode === 'manual' || mode === 'working' ? mode : 'follow',
      shallow: p['submodules.shallow'] === true,
      nested: p['submodules.nested'] !== false,
      jobs: (await ops(repoId).submoduleJobs()) ?? 4,
      warnBack: p['submodules.warnBack'] !== false,
      tidy: p['submodules.tidy'] !== false,
      pushCheck: p['submodules.pushCheck'] === 'off' || p['submodules.pushCheck'] === 'push' ? p['submodules.pushCheck'] : 'check'
    }
  }
  const subMode = z.enum(['follow', 'manual', 'working'])
  handle('submodule.list', z.object(R), async ({ repoId }) => {
    const o = ops(repoId)
    const settings = await subSettings(repoId)
    const list = settings.on ? await o.submodules() : []
    return { list, settings, present: list.length > 0 || (!settings.on && (await o.hasSubmodules())), superproject: await o.superproject() }
  })
  handle('submodule.goingBack', z.object(R), async ({ repoId }) => {
    const s = await subSettings(repoId)
    return s.on && s.warnBack ? ops(repoId).submodulesGoingBack() : []
  })
  const empty = { updated: [], restored: [], removed: [], skipped: [] }
  handle('submodule.sync', z.object({ ...R, from: ref, to: ref, opId }), async ({ repoId, from, to, opId: id }) => {
    const s = await subSettings(repoId)
    return s.on ? ops(repoId).submoduleSync(from, to, s, id, progress(id)) : empty
  })
  handle('submodule.atRisk', z.object({ ...R, to: ref }), async ({ repoId, to }) => ((await subSettings(repoId)).on ? ops(repoId).submodulesAtRisk(to) : []))
  handle('submodule.unpushed', z.object({ ...R, branch: ref.optional() }), async ({ repoId, branch }) => {
    const s = await subSettings(repoId)
    return s.on && s.pushCheck !== 'off' ? ops(repoId).submodulesUnpushed(branch ?? null) : []
  })
  handle('submodule.push', z.object({ ...R, path: z.string().min(1).max(4096), opId }), async ({ repoId, path, opId: id }) => (await ops(repoId).submodulePush(path, id, progress(id)), null))
  handle('submodule.setup', z.object({ ...R, paths, shallow: z.boolean().optional(), opId }), async ({ repoId, paths: which, shallow, opId: id }) => {
    const s = await subSettings(repoId)
    await ops(repoId).submoduleSetup(which, { shallow: shallow ?? s.shallow, nested: s.nested, jobs: s.jobs }, id, progress(id))
    return null
  })
  handle('submodule.update', z.object({ ...R, paths, opId }), async ({ repoId, paths: which, opId: id }) => {
    const o = ops(repoId)
    const s = await subSettings(repoId)
    const list = which === 'all' ? (await o.submodules()).filter((m) => m.setUp && m.current !== m.expected).map((m) => m.path) : which
    if (list.length) await o.submoduleUpdate(list, { nested: s.nested, jobs: s.jobs }, id, progress(id))
    return null
  })
  handle('submodule.remove', z.object({ ...R, paths: z.array(z.string().min(1).max(4096)).min(1).max(5000) }), ({ repoId, paths: which }) =>
    exclusive(repoId, async () => (await ops(repoId).submoduleRemove(which), null))
  )
  handle('submodule.add', z.object({ ...R, url: z.string().min(1).max(2048), path: z.string().min(1).max(4096), branch: z.string().min(1).max(255).optional(), opId }), ({ repoId, opId: id, ...input }) =>
    exclusive(repoId, async () => ({ path: await ops(repoId).submoduleAdd(input, id, progress(id)) }))
  )
  handle('submodule.setUrl', z.object({ ...R, path: z.string().min(1).max(4096), url: z.string().min(1).max(2048) }), ({ repoId, path, url }) =>
    exclusive(repoId, async () => (await ops(repoId).submoduleSetUrl(path, url), null))
  )
  handle('submodule.delete', z.object({ ...R, path: z.string().min(1).max(4096) }), ({ repoId, path }) => exclusive(repoId, async () => (await ops(repoId).submoduleDelete(path), null)))
  handle('submodule.setMode', z.object({ ...R, names: z.array(z.string().min(1).max(4096)).min(1).max(5000), mode: subMode.nullable() }), async ({ repoId, names, mode }) => {
    await ops(repoId).submoduleSetMode(names, mode)
    return null
  })
  handle(
    'submodule.settings',
    z.object({ ...R, on: z.boolean().optional(), mode: subMode.optional(), shallow: z.boolean().optional(), nested: z.boolean().optional(), warnBack: z.boolean().optional(), tidy: z.boolean().optional(), pushCheck: z.enum(['off', 'check', 'push']).optional(), jobs: z.number().int().min(1).max(16).optional() }),
    async ({ repoId, jobs, ...rest }) => {
      for (const k of ['on', 'mode', 'shallow', 'nested', 'warnBack', 'tidy', 'pushCheck'] as const) if (rest[k] !== undefined) repoPrefs.set(repoId, `submodules.${k}`, rest[k])
      if (jobs !== undefined) await ops(repoId).setSubmoduleJobs(jobs)
      return subSettings(repoId)
    }
  )

  // ---------- worktrees ----------

  const folder = z.string().min(1).max(4096)
  handle('worktrees.list', z.object(R), ({ repoId }) => ops(repoId).worktrees())
  handle(
    'worktrees.add',
    z.object({ ...R, path: folder, branch: ref.optional(), newBranch: z.string().min(1).max(255).optional(), at: ref.optional(), track: z.boolean().optional(), opId }),
    async ({ repoId, opId: id, ...input }) => ({ path: await ops(repoId).worktreeAdd(input, id) })
  )
  handle('worktrees.remove', z.object({ ...R, path: folder, force: z.boolean() }), ({ repoId, path, force }) =>
    exclusive(repoId, async () => {
      let closed: string | null = null
      // Its tab goes first: on Windows that tab's file watcher would keep the folder from being deleted.
      const res = await ops(repoId).worktreeRemove(path, force, (p) => {
        closed = repos.openAt(p)
        if (closed) repos.close(closed)
      })
      return { ...res, closed }
    })
  )
  handle('worktrees.lock', z.object({ ...R, path: folder, locked: z.boolean() }), async ({ repoId, path, locked }) => (await ops(repoId).worktreeLock(path, locked), null))
  handle('worktrees.prune', z.object(R), async ({ repoId }) => (await ops(repoId).worktreePrune(), null))
  handle('worktrees.suggestPath', z.object({ ...R, branch: z.string().max(255) }), ({ repoId, branch }) => ops(repoId).worktreeSuggestPath(branch))

  handle('commit.details', z.object({ ...R, sha: ref }), ({ repoId, sha }) => ops(repoId).details(sha))
  handle('commit.messages', z.object({ ...R, shas: z.array(ref).min(1).max(1000) }), ({ repoId, shas }) => ops(repoId).messages(shas))
  handle(
    'diff.get',
    z.object({
      ...R,
      path: z.string().min(1).max(4096),
      oldPath: z.string().max(4096).optional(),
      force: z.boolean().optional(),
      full: z.boolean().optional(),
      ignoreWs: z.boolean().optional(),
      source: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('worktree') }),
        z.object({ kind: z.literal('index') }),
        z.object({ kind: z.literal('commit'), sha: ref, parent: ref.optional() })
      ])
    }),
    ({ repoId, path, oldPath, source, force, full, ignoreWs }) => ops(repoId).diff(path, oldPath, source, force, full, ignoreWs)
  )
  handle('search.commits', z.object({ ...R, query: z.string().max(400) }), ({ repoId, query }) => ops(repoId).searchCommits(query))

  // ---------- staging and commits ----------
  handle('index.stage', z.object({ ...R, paths }), ({ repoId, paths }) => exclusive(repoId, async () => (await ops(repoId).stage(paths), null)))
  handle('index.unstage', z.object({ ...R, paths }), ({ repoId, paths }) => exclusive(repoId, async () => (await ops(repoId).unstage(paths), null)))
  handle(
    'commit.create',
    z.object({ ...R, summary: z.string().max(2000), body: z.string().max(100_000), amend: z.boolean(), noVerify: z.boolean(), messageOnly: z.boolean().optional() }),
    async ({ repoId, summary, body, amend, noVerify, messageOnly }) => {
      const label = amend ? `Amend “${summary.trim()}”` : `Commit “${summary.trim()}”`
      const sha = await undoable(repoId, amend ? 'amend' : 'commit', label, () => ops(repoId).commit(summary, body, amend, noVerify, messageOnly))
      return { sha }
    }
  )
  handle('worktree.discard', z.object({ ...R, paths }), ({ repoId, paths }) => exclusive(repoId, async () => {
    const o = ops(repoId)
    const before = await undo.snapshot(o)
    const entryRef = `${UNDO_REFS}${uuid()}`
    const stash = await o.discard(paths, entryRef)
    if (stash) {
      const n = paths === 'all' ? 'all changes' : paths.length === 1 ? paths[0] : `${paths.length} files`
      undo.record(repoId, 'discard', `Discard ${n}`, { ...before, stash, paths }, before)
    }
    return null
  }))

  // ---------- branches ----------
  handle('branch.create', z.object({ ...R, name: z.string().min(1).max(255), at: ref, checkout: z.boolean() }), async ({ repoId, name, at, checkout }) => {
    if (checkout) await undoable(repoId, 'checkout', `Switch to ${name}`, () => ops(repoId).createBranch(name, at, true))
    else await ops(repoId).createBranch(name, at, false)
    return null
  })
  handle('bisect.start', z.object({ ...R, bad: ref, good: ref }), ({ repoId, bad, good }) => exclusive(repoId, async () => (await ops(repoId).bisectStart(bad, good), null)))
  handle('bisect.mark', z.object({ ...R, verdict: z.enum(['good', 'bad', 'skip']), sha: ref.optional() }), ({ repoId, verdict, sha }) =>
    exclusive(repoId, async () => (await ops(repoId).bisectMark(verdict, sha), null))
  )
  handle('bisect.reset', z.object(R), ({ repoId }) => exclusive(repoId, async () => (await ops(repoId).bisectReset(), null)))
  handle('bisect.run', z.object({ ...R, command: z.string().min(1).max(4000), opId }), ({ repoId, command, opId: id }) =>
    exclusive(repoId, async () => (await ops(repoId).bisectRun(command, id, output(id)), null))
  )
  handle('branch.checkout', z.object({ ...R, ref, opId: opId.optional() }), async ({ repoId, ref, opId: id }) => {
    await undoable(repoId, 'checkout', `Switch to ${ref}`, () => ops(repoId).checkout(ref, id, id ? progress(id) : undefined))
    return null
  })
  handle('branch.rename', z.object({ ...R, name: ref, newName: z.string().min(1).max(255) }), ({ repoId, name, newName }) => exclusive(repoId, async () => (await ops(repoId).renameBranch(name, newName), null)))
  handle('branch.delete', z.object({ ...R, name: ref, force: z.boolean() }), ({ repoId, name, force }) => exclusive(repoId, async () => {
    const o = ops(repoId)
    const head = await undo.snapshot(o)
    const sha = await o.deleteBranch(name, force)
    undo.record(repoId, 'branch_delete', `Delete branch ${name}`, { ...head, name, sha }, head)
    return null
  }))
  handle('branch.fastForward', z.object({ ...R, name: ref, to: ref.optional(), fetch: z.boolean(), create: z.boolean().optional(), opId }), ({ repoId, name, opId: id, ...rest }) =>
    exclusive(repoId, () => ops(repoId).fastForward(name, { ...rest, opId: id }, progress(id)))
  )
  handle('branch.move', z.object({ ...R, name: ref, to: ref }), ({ repoId, name, to }) =>
    exclusive(repoId, async () => {
      const o = ops(repoId)
      const head = await undo.snapshot(o)
      const moved = await o.moveBranch(name, to)
      if (moved.from !== moved.to) undo.record(repoId, 'branch_move', `Reset ${name} to ${to}`, { ...head, name, tip: moved.from }, { ...head, name, tip: moved.to })
      return null
    })
  )
  handle('branch.deleteMany', z.object({ ...R, names: z.array(ref).min(1).max(1000), force: z.boolean() }), ({ repoId, names, force }) => exclusive(repoId, async () => {
    const o = ops(repoId)
    const head = await undo.snapshot(o)
    const branches: { name: string; sha: string }[] = []
    const unmerged: string[] = []
    const failed: { name: string; message: string }[] = []
    for (const name of [...new Set(names)]) {
      try {
        branches.push({ name, sha: await o.deleteBranch(name, force) })
      } catch (e) {
        if (!force && e instanceof GcFail && /aren’t merged/.test(e.message)) unmerged.push(name)
        else failed.push({ name, message: e instanceof Error ? e.message : String(e) })
      }
    }
    if (branches.length === 1) undo.record(repoId, 'branch_delete', `Delete branch ${branches[0].name}`, { ...head, ...branches[0] }, head)
    else if (branches.length) undo.record(repoId, 'branch_delete', `Delete ${branches.length} branches`, { ...head, branches }, head)
    return { deleted: branches.map((b) => b.name), unmerged, failed }
  }))
  handle('branch.deleteRemote', z.object({ ...R, remote: ref, name: ref, opId }), ({ repoId, remote, name, opId }) =>
    exclusive(repoId, () => ops(repoId).deleteRemoteBranch(remote, name, opId))
  )
  handle('branch.deleteRemoteMany', z.object({ ...R, remote: ref, names: z.array(ref).min(1).max(1000), opId }), ({ repoId, remote, names, opId }) =>
    exclusive(repoId, async () => (await ops(repoId).deleteRemoteBranches(remote, names, opId), null))
  )
  handle('branch.merge', z.object({ ...R, source: ref }), ({ repoId, source }) =>
    undoable(repoId, 'merge', `Merge ${source}`, () => ops(repoId).merge(source), (r) => r.result !== 'conflicts')
  )
  handle('branch.rebase', z.object({ ...R, onto: ref, branch: ref.optional() }), ({ repoId, onto, branch }) =>
    undoable(repoId, 'rebase', `Rebase ${branch ? `${branch} ` : ''}onto ${onto}`, () => ops(repoId).rebase(onto, branch), (r) => r.result !== 'conflicts')
  )
  handle('branch.setUpstream', z.object({ ...R, name: ref, upstream: ref }), async ({ repoId, name, upstream }) => (await ops(repoId).setUpstream(name, upstream), null))

  // ---------- sync ----------
  handle('remote.fetch', z.object({ ...R, opId, background: z.boolean().optional() }), async ({ repoId, opId, background }) => (await ops(repoId).fetch(opId, progress(opId), !background), null))
  handle('remote.pull', z.object({ ...R, mode: z.enum(['ff', 'ff-only', 'rebase']), opId, autostash: z.boolean().optional() }), ({ repoId, mode, opId, autostash }) => exclusive(repoId, async () => {
    const o = ops(repoId)
    const before = await undo.snapshot(o)
    const r = await o.pull(mode, opId, progress(opId), autostash)
    if (r.result === 'conflicts') undo.setPending(repoId, mode === 'rebase' ? 'rebase' : 'merge', 'Pull', before)
    return r
  }))
  handle(
    'remote.push',
    z.object({ ...R, opId, remote: ref.optional(), branch: ref.optional(), setUpstream: z.boolean().optional(), force: z.boolean().optional() }),
    ({ repoId, ...rest }) => ops(repoId).push(rest, progress(rest.opId))
  )

  // ---------- conflicts ----------
  handle('conflict.get', z.object({ ...R, path: z.string().min(1).max(4096) }), ({ repoId, path }) => ops(repoId).conflict(path))
  handle('conflict.resolve', z.object({ ...R, path: z.string().min(1).max(4096), content: z.string().max(50_000_000) }), ({ repoId, path, content }) => exclusive(repoId, async () => (await ops(repoId).resolve(path, content), null)))
  handle('conflict.take', z.object({ ...R, path: z.string().min(1).max(4096), side: z.enum(['ours', 'theirs']) }), ({ repoId, path, side }) => exclusive(repoId, async () => (await ops(repoId).take(path, side), null)))
  handle('op.continue', z.object(R), ({ repoId }) => exclusive(repoId, async () => {
    const o = ops(repoId)
    const r = await o.continueOp()
    if (r.result === 'ok') await undo.finishPending(o)
    return r
  }))
  handle('op.skip', z.object(R), ({ repoId }) => exclusive(repoId, async () => {
    const o = ops(repoId)
    const r = await o.skipOp()
    if (r.result === 'ok') await undo.finishPending(o)
    return r
  }))
  handle('op.abort', z.object(R), ({ repoId }) => exclusive(repoId, async () => {
    await ops(repoId).abortOp()
    undo.dropPending(repoId)
    return null
  }))

  // ---------- undo ----------
  handle('undo.peek', z.object(R), ({ repoId }) => exclusive(repoId, async () => undo.peek(repoId)))
  handle('undo.undo', z.object(R), ({ repoId }) => exclusive(repoId, async () => (await undo.undo(ops(repoId)), null)))
  handle('undo.redo', z.object(R), ({ repoId }) => exclusive(repoId, async () => (await undo.redo(ops(repoId)), null)))

  // ---------- activity log ----------
  handle('activity.list', z.object({ repoId: repoId.optional(), limit: z.number().int().min(1).max(1000) }), ({ repoId, limit }) => {
    const rows = (
      repoId
        ? db.prepare('SELECT * FROM activity_log WHERE repo_id = ? ORDER BY started_at DESC LIMIT ?').all(repoId, limit)
        : db.prepare('SELECT * FROM activity_log ORDER BY started_at DESC LIMIT ?').all(limit)
    ) as Array<Record<string, unknown>>
    return rows.map(
      (r): ActivityEntry => ({
        id: r.id as string,
        repoId: r.repo_id as string | null,
        opId: r.op_id as string,
        argv: JSON.parse(r.argv as string),
        status: r.status as ActivityEntry['status'],
        exitCode: r.exit_code as number | null,
        stderrTail: r.stderr_tail as string | null,
        startedAt: r.started_at as number,
        finishedAt: r.finished_at as number | null
      })
    )
  })

  // ---------- partial staging, ignore ----------
  const filePath = z.string().min(1).max(4096)
  handle(
    'index.applyPatch',
    z.object({
      ...R,
      path: filePath,
      source: z.enum(['worktree', 'index']),
      hunk: z.number().int().min(0),
      header: z.string().max(10_000),
      lines: z.array(z.number().int().min(0)).max(1_000_000).nullable(),
      action: z.enum(['stage', 'unstage', 'discard']),
      full: z.boolean()
    }),
    (input) =>
      exclusive(input.repoId, async () => {
        const o = ops(input.repoId)
        if (input.action !== 'discard') return (await o.applyPartial(input), null)
        const before = await undo.snapshot(o)
        const patch = await o.applyPartial(input)
        const what = input.lines ? `${input.lines.length} line${input.lines.length === 1 ? '' : 's'}` : 'a block'
        undo.record(input.repoId, 'discard_lines', `Discard ${what} in ${input.path.split('/').pop()}`, { ...before, patch }, before)
        return null
      })
  )
  handle('ignore.add', z.object({ ...R, patterns: z.array(z.string().min(1).max(4096)).min(1).max(5000), label: z.string().min(1).max(300) }), ({ repoId, patterns, label }) =>
    exclusive(repoId, async () => {
      const o = ops(repoId)
      const head = await undo.snapshot(o)
      const r = await o.ignore(patterns)
      undo.record(repoId, 'ignore', `Ignore ${label}`, { ...head, gitignore: r.before, index: r.index }, { ...head, gitignore: r.after, paths: r.untracked })
      return { untracked: r.untracked.length }
    })
  )

  // ---------- stash ----------
  const sha = z.string().regex(/^[0-9a-f]{40}$/)
  handle('stash.save', z.object({ ...R, message: z.string().max(2000), stagedOnly: z.boolean(), includeUntracked: z.boolean() }), ({ repoId, message, stagedOnly, includeUntracked }) =>
    exclusive(repoId, () => ops(repoId).stashSave(message, stagedOnly, includeUntracked))
  )
  handle('stash.apply', z.object({ ...R, sha }), ({ repoId, sha }) => exclusive(repoId, () => ops(repoId).stashApply(sha, false)))
  handle('stash.pop', z.object({ ...R, sha }), ({ repoId, sha }) => exclusive(repoId, () => ops(repoId).stashApply(sha, true)))
  handle('stash.dropMany', z.object({ ...R, shas: z.array(sha).min(1).max(1000) }), ({ repoId, shas }) =>
    exclusive(repoId, async () => {
      const o = ops(repoId)
      const head = await undo.snapshot(o)
      const stashes: { stash: string; message: string; index: number }[] = []
      const failed: { sha: string; message: string }[] = []
      // Where each one is before any goes, for putting them back in order.
      const where = new Map<string, number>()
      for (const s of shas) where.set(s, await o.stashIndex(s).catch(() => -1))
      for (const s of [...new Set(shas)]) {
        try {
          await o.mut(['update-ref', `${UNDO_REFS}${uuid()}`, s])
          stashes.push({ stash: s, message: await o.stashDrop(s), index: where.get(s) ?? 0 })
        } catch (e) {
          failed.push({ sha: s, message: e instanceof Error ? e.message : String(e) })
        }
      }
      if (stashes.length === 1) undo.record(repoId, 'stash_drop', `Delete stash “${stashes[0].message.replace(/^On [^:]+: /, '')}”`, { ...head, stash: stashes[0].stash, message: stashes[0].message }, head)
      else if (stashes.length) undo.record(repoId, 'stash_drop', `Delete ${stashes.length} stashes`, { ...head, stashes }, head)
      return { dropped: stashes.length, failed }
    })
  )
  handle('stash.drop', z.object({ ...R, sha }), ({ repoId, sha }) =>
    exclusive(repoId, async () => {
      const o = ops(repoId)
      const head = await undo.snapshot(o)
      // Keep the stash's objects reachable so undo can bring it back.
      await o.mut(['update-ref', `${UNDO_REFS}${uuid()}`, sha])
      const message = await o.stashDrop(sha)
      undo.record(repoId, 'stash_drop', `Delete stash “${message.replace(/^On [^:]+: /, '')}”`, { ...head, stash: sha, message }, head)
      return null
    })
  )

  // ---------- tags ----------
  handle('tag.create', z.object({ ...R, name: z.string().min(1).max(255), at: ref, message: z.string().max(100_000).nullable() }), ({ repoId, name, at, message }) =>
    exclusive(repoId, async () => (await ops(repoId).createTag(name, at, message), null))
  )
  handle('tag.delete', z.object({ ...R, name: ref }), ({ repoId, name }) =>
    exclusive(repoId, async () => {
      const o = ops(repoId)
      const head = await undo.snapshot(o)
      const obj = (await o.git(['rev-parse', '--verify', `refs/tags/${o.safeRev(name)}`])).trim()
      await o.mut(['update-ref', `${UNDO_REFS}${uuid()}`, obj])
      await o.deleteTag(name)
      undo.record(repoId, 'tag_delete', `Delete tag ${name}`, { ...head, name, sha: obj }, head)
      return null
    })
  )
  handle('tag.push', z.object({ ...R, name: ref, remote: ref, opId }), async ({ repoId, name, remote, opId }) => (await ops(repoId).pushTag(name, remote, opId, false), null))
  handle('tag.deleteRemote', z.object({ ...R, name: ref, remote: ref, opId }), async ({ repoId, name, remote, opId }) => (await ops(repoId).pushTag(name, remote, opId, true), null))
  handle('tag.deleteMany', z.object({ ...R, names: z.array(ref).min(1).max(1000) }), ({ repoId, names }) =>
    exclusive(repoId, async () => {
      const o = ops(repoId)
      const head = await undo.snapshot(o)
      const tags: { name: string; sha: string }[] = []
      const failed: { name: string; message: string }[] = []
      for (const name of [...new Set(names)]) {
        try {
          const obj = (await o.git(['rev-parse', '--verify', `refs/tags/${o.safeRev(name)}`])).trim()
          await o.mut(['update-ref', `${UNDO_REFS}${uuid()}`, obj])
          await o.deleteTag(name)
          tags.push({ name, sha: obj })
        } catch (e) {
          failed.push({ name, message: e instanceof Error ? e.message : String(e) })
        }
      }
      if (tags.length === 1) undo.record(repoId, 'tag_delete', `Delete tag ${tags[0].name}`, { ...head, ...tags[0] }, head)
      else if (tags.length) undo.record(repoId, 'tag_delete', `Delete ${tags.length} tags`, { ...head, tags }, head)
      return { deleted: tags.map((t) => t.name), failed }
    })
  )
  handle('tag.pushMany', z.object({ ...R, names: z.array(ref).min(1).max(1000), remote: ref, opId, del: z.boolean() }), async ({ repoId, names, remote, opId, del }) => (await ops(repoId).pushTags(names, remote, opId, del), null))

  // ---------- history edits ----------
  handle('history.reset', z.object({ ...R, target: ref, mode: z.enum(['soft', 'mixed', 'hard']), branch: ref.optional() }), ({ repoId, target, mode, branch }) =>
    exclusive(repoId, async () => {
      const o = ops(repoId)
      const before = await undo.snapshot(o)
      // The window may be a moment behind a checkout made elsewhere: never reset another branch than the one asked for.
      if (branch && before.branch !== branch) throw invalid(`${branch} isn’t checked out any more (${before.branch ?? 'a detached HEAD'} is), so nothing was reset.`)
      const stash = mode === 'hard' ? await o.pinWork(`${UNDO_REFS}${uuid()}`) : null
      await o.reset(target, mode)
      const words = { soft: 'keep changes staged', mixed: 'keep changes', hard: 'discard changes' }
      undo.record(repoId, 'reset', `Reset to ${shortRef(target)} (${words[mode]})`, { ...before, mode, stash: stash ?? undefined }, await undo.snapshot(o))
      return null
    })
  )
  handle('history.revert', z.object({ ...R, sha: ref }), ({ repoId, sha }) =>
    undoable(repoId, 'revert', `Revert ${sha.slice(0, 7)}`, () => ops(repoId).revert(sha), (r) => r.result !== 'conflicts')
  )
  handle('history.cherryPick', z.object({ ...R, shas: z.array(ref).min(1).max(1000) }), ({ repoId, shas }) =>
    undoable(
      repoId,
      'cherry_pick',
      shas.length === 1 ? `Cherry-pick ${shas[0].slice(0, 7)}` : `Cherry-pick ${shas.length} commits`,
      () => ops(repoId).cherryPick(shas),
      (r) => r.result !== 'conflicts'
    )
  )
  handle('cherry.preview', z.object({ ...R, tip: ref }), ({ repoId, tip }) => ops(repoId).cherryPreview(tip))
  handle('rebase.preview', z.object({ ...R, onto: ref }), ({ repoId, onto }) => ops(repoId).rebasePreview(onto))
  handle(
    'rebase.interactive',
    z.object({
      ...R,
      onto: ref,
      plan: z
        .array(z.object({ sha, action: z.enum(['pick', 'reword', 'squash', 'fixup', 'drop']), message: z.string().max(100_000).optional() }))
        .min(1)
        .max(5000),
      noVerify: z.boolean().optional()
    }),
    ({ repoId, onto, plan, noVerify }) =>
      undoable(
        repoId,
        'rebase',
        `Interactive rebase onto ${onto.slice(0, 12)}`,
        () => ops(repoId).rebaseInteractive(onto, plan, join(tmpDir, `rebase-${repoId}`), noVerify),
        (r) => r.result !== 'conflicts'
      )
  )

  // ---------- remotes ----------
  handle('remote.list', z.object(R), ({ repoId }) => ops(repoId).remotes())
  handle('remote.add', z.object({ ...R, name: z.string().min(1).max(255), url: z.string().min(1).max(2048) }), ({ repoId, name, url }) =>
    exclusive(repoId, async () => (await ops(repoId).addRemote(name, url), null))
  )
  handle('remote.remove', z.object({ ...R, name: ref }), ({ repoId, name }) =>
    exclusive(repoId, async () => {
      const o = ops(repoId)
      const head = await undo.snapshot(o)
      const remote = await o.removeRemote(name)
      undo.record(repoId, 'remote_remove', `Remove remote ${name}`, { ...head, remote }, head)
      return null
    })
  )

  // ---------- file history, blame ----------
  handle('file.history', z.object({ ...R, path: filePath, limit: z.number().int().min(1).max(10_000) }), ({ repoId, path, limit }) => ops(repoId).fileHistory(path, limit))
  handle('compare.get', z.object({ ...R, base: ref, target: ref, sinceSplit: z.boolean() }), ({ repoId, base, target, sinceSplit }) => ops(repoId).compare(base, target, sinceSplit))
  handle('reflog.list', z.object({ ...R, limit: z.number().int().min(1).max(10_000) }), ({ repoId, limit }) => ops(repoId).reflog(limit))
  handle('file.blame', z.object({ ...R, path: filePath, rev: ref.nullable() }), ({ repoId, path, rev }) => ops(repoId).blame(path, rev))

  // ---------- graph focus ----------
  handle('refView.get', z.object(R), ({ repoId }) => refView.get(repoId))
  handle('refView.pin', z.object({ ...R, ref: z.string().regex(/^refs\/(heads|remotes)\//).max(400).nullable() }), ({ repoId, ref }) => refView.pin(repoId, ref))
  handle(
    'refView.set',
    z.object({ ...R, ref: z.string().regex(/^refs\/(heads|remotes|tags)\//).max(400), state: z.enum(['normal', 'hidden', 'soloed']) }),
    ({ repoId, ref, state }) => refView.set(repoId, ref, state)
  )

  // ---------- preferences, identity ----------
  handle('prefs.getAll', z.object({}), () => prefs.getAll())
  handle('prefs.set', z.object({ key: z.string().regex(/^[a-zA-Z][\w.]{0,63}$/), value: z.unknown() }), ({ key, value }) => {
    if (JSON.stringify(value ?? null).length > 10_000) throw new GcFail('invalid', 'That setting is too large.')
    prefs.set(key, value)
    return null
  })
  const cfg = async (cwd: string, scope: '--global' | '--local', key: string): Promise<string | null> => {
    try {
      return (await runner.run({ cwd, plain: true, args: ['config', scope, '--get', key] })).stdout.trim() || null
    } catch {
      return null
    }
  }
  handle('identity.get', z.object({ repoId: repoId.optional() }), async ({ repoId: id }) => {
    const home = homedir()
    const global = { name: await cfg(home, '--global', 'user.name'), email: await cfg(home, '--global', 'user.email') }
    if (!id) return { global, repo: null }
    const path = ops(id).repo.path
    return { global, repo: { name: await cfg(path, '--local', 'user.name'), email: await cfg(path, '--local', 'user.email') } }
  })
  // Git locks the whole config file for each write, so two writes at once make one fail. One at a time.
  let configWrites: Promise<unknown> = Promise.resolve()
  const writeConfig = (id: string | undefined, key: string, value: string): Promise<void> => {
    const run = async (): Promise<void> => {
      const cwd = id ? ops(id).repo.path : homedir()
      const scope = id ? '--local' : '--global'
      if (value) await runner.run({ cwd, repoId: id, mutating: true, args: ['config', scope, key, value] })
      else await runner.run({ cwd, repoId: id, mutating: true, args: ['config', scope, '--unset', key], okCodes: [5] })
    }
    const p = configWrites.then(run, run)
    configWrites = p.catch(() => {})
    return p
  }
  handle('identity.set', z.object({ repoId: repoId.optional(), name: z.string().max(200), email: z.string().max(320) }), async ({ repoId: id, name, email }) => {
    if (/[\r\n<>]/.test(name + email)) throw new GcFail('invalid', 'Names and emails can’t contain line breaks or angle brackets.')
    await writeConfig(id, 'user.name', name.trim())
    await writeConfig(id, 'user.email', email.trim())
    forgetRepoConfig()
    return null
  })
  // Who the next commit will be by, after the repository's config, the profile and Git's global config.
  handle('identity.effective', z.object(R), async ({ repoId }) => {
    const o = ops(repoId)
    const ident = (await o.tryGit(['var', 'GIT_AUTHOR_IDENT']))?.trim()
    const m = ident ? /^(.*) <([^>]*)>/.exec(ident) : null
    if (!m) return null
    const local = await cfg(o.repo.path, '--local', 'user.email')
    return { name: m[1], email: m[2], from: local ? 'repo' : profiles.active().authorEmail ? 'profile' : 'git' }
  })

  // ---------- profiles ----------
  const profileId = z.string().uuid()
  const optText = (max: number) => z.string().max(max).nullable().optional()
  handle('profile.list', z.object({}), () => profiles.list())
  handle('profile.create', z.object({ name: z.string().max(200) }), ({ name }) => profiles.create(name))
  handle(
    'profile.update',
    z.object({ id: profileId, name: z.string().max(200).optional(), authorName: optText(200), authorEmail: optText(320), signingKey: optText(200), sshKey: optText(64) }),
    ({ id, ...patch }) => {
      const p = profiles.update(id, patch)
      forgetRepoConfig()
      return p
    }
  )
  handle('profile.delete', z.object({ id: profileId }), ({ id }) => (profiles.remove(id), null))
  handle('profile.switch', z.object({ id: profileId }), ({ id }, e) => {
    if (repos.list().open.some((r) => runner.isBusy(r.id))) throw new GcFail('busy', 'Wait for the running Git command to finish, then switch.')
    switchProfile(id)
    // The other profile's tabs and settings load from scratch. The window blocks page-initiated navigation
    // (will-navigate), so the reload comes from here, after this answer has gone back.
    setTimeout(() => e.sender.reload(), 0)
    return null
  })

  // ---------- graphics acceleration ----------
  handle('gpu.get', z.object({}), () => gpuState())
  handle('gpu.set', z.object({ on: z.boolean() }), ({ on }) => (setGpu(on), null))
  handle('app.restart', z.object({}), () => {
    app.relaunch()
    app.exit(0)
    return null
  })

  // ---------- credential prompts ----------
  handle('auth.respond', z.object({ promptId: z.string().uuid(), answer: z.string().max(10_000).nullable() }), ({ promptId, answer }) => (askpass.respond(promptId, answer), null))

  // ---------- stash names, graph columns, per-repo settings ----------
  handle('stash.rename', z.object({ ...R, sha, message: z.string().min(1).max(2000) }), ({ repoId, sha, message }) =>
    exclusive(repoId, async () => (await ops(repoId).stashRename(sha, message), null))
  )
  const column = z.object({ key: z.enum(['author', 'date', 'sha']), width: z.number().int().min(40).max(600), visible: z.boolean() })
  handle('graph.getColumns', z.object(R), ({ repoId }) => layouts.get(repoId))
  handle('graph.setColumns', z.object({ ...R, columns: z.array(column).max(3) }), ({ repoId, columns }) => (layouts.set(repoId, columns), null))
  handle('repoPrefs.get', z.object(R), ({ repoId }) => repoPrefs.getAll(repoId))
  handle('repoPrefs.set', z.object({ ...R, key: z.string().regex(/^[a-zA-Z][\w.]{0,63}$/), value: z.unknown() }), ({ repoId, key, value }) => {
    if (JSON.stringify(value ?? null).length > 10_000) throw new GcFail('invalid', 'That setting is too large.')
    repoPrefs.set(repoId, key, value)
    return null
  })

  // ---------- git config the Settings screen edits ----------
  const configKey = z.enum(['user.signingkey', 'commit.gpgsign', 'commit.template', 'diff.tool', 'merge.tool'])
  const KEYS = configKey.options
  handle('gitConfig.get', z.object({ repoId: repoId.optional() }), async ({ repoId: id }) => {
    const read = async (cwd: string, scope: '--global' | '--local'): Promise<Record<string, string>> => {
      const out: Record<string, string> = {}
      for (const k of KEYS) {
        const v = await cfg(cwd, scope, k)
        if (v !== null) out[k] = v
      }
      return out
    }
    return { global: await read(homedir(), '--global'), repo: id ? await read(ops(id).repo.path, '--local') : null }
  })
  handle('gitConfig.set', z.object({ repoId: repoId.optional(), key: configKey, value: z.string().max(1000).nullable() }), async ({ repoId: id, key, value }) => {
    const v = value?.trim() ?? ''
    if (/[\r\n]/.test(v) || v.startsWith('-')) throw new GcFail('invalid', 'That value can’t be used.')
    if (key === 'commit.gpgsign' && v && v !== 'true' && v !== 'false') throw new GcFail('invalid', 'Signing is on or off.')
    if ((key === 'diff.tool' || key === 'merge.tool') && v && !/^[\w.-]+$/.test(v)) throw new GcFail('invalid', 'Use the tool’s name as Git knows it, like meld, kdiff3 or bc.')
    await writeConfig(id, key, v)
    forgetRepoConfig()
    return null
  })
  handle('commit.template', z.object(R), ({ repoId }) => ops(repoId).commitTemplate())

  // ---------- other programs ----------
  handle('shell.open', z.object({ ...R, target: z.enum(['folder', 'terminal', 'editor']), path: z.string().min(1).max(4096).optional(), worktree: z.string().min(1).max(4096).optional() }), async ({ repoId, target, path, worktree }) => {
    const o = ops(repoId)
    // Another worktree of this repository: only one that git lists, never any folder.
    const other = worktree ? (await o.worktrees()).find((w) => samePath(w.path, worktree))?.path : undefined
    if (worktree && !other) throw new GcFail('invalid', `${worktree} isn’t a worktree of this repository.`)
    const root = other ?? o.repo.path
    const file = path && !other ? join(root, o.safePath(path)) : root
    if (target === 'folder') {
      if (path && !other) shell.showItemInFolder(file)
      else {
        const err = await shell.openPath(root)
        if (err) throw new GcFail('invalid', err)
      }
      return null
    }
    const all = prefs.getAll()
    const template = String((target === 'terminal' ? all.terminalCommand : all.editorCommand) || defaultCommand(target))
    await launch(template, { path: root, file })
    return null
  })
  handle('file.externalDiff', z.object({ ...R, path: z.string().min(1).max(4096), staged: z.boolean() }), async ({ repoId, path, staged }) => (await ops(repoId).externalTool('diff', path, staged), null))
  handle('file.externalMerge', z.object({ ...R, path: z.string().min(1).max(4096) }), async ({ repoId, path }) => (await ops(repoId).externalTool('merge', path, false), null))

  // ---------- SSH keys (Settings) ----------
  handle('ssh.keys', z.object({}), () => listKeys())
  handle('ssh.generate', z.object({ name: z.string().min(1).max(64), comment: z.string().max(200), passphrase: z.string().max(200) }), ({ name, comment, passphrase }) =>
    generateKey(name, comment, passphrase)
  )

  // ---------- hide / show many; rewriting the current branch ----------
  handle(
    'refView.setMany',
    z.object({ ...R, refs: z.array(z.string().regex(/^refs\/(heads|remotes|tags)\//).max(400)).max(5000), state: z.enum(['normal', 'hidden']) }),
    ({ repoId, refs, state }) => refView.setMany(repoId, refs, state)
  )
  const rewriteDir = (id: string): string => join(tmpDir, `rewrite-${id}`)
  handle('history.reword', z.object({ ...R, sha, message: z.string().min(1).max(100_000), noVerify: z.boolean().optional() }), ({ repoId, sha, message, noVerify }) =>
    undoable(repoId, 'rebase', `Edit message of ${sha.slice(0, 7)}`, () => ops(repoId).reword(sha, message, rewriteDir(repoId), noVerify), (r) => r.result !== 'conflicts')
  )
  handle('history.squash', z.object({ ...R, shas: z.array(sha).min(2).max(1000), message: z.string().min(1).max(100_000), noVerify: z.boolean().optional() }), ({ repoId, shas, message, noVerify }) =>
    undoable(repoId, 'rebase', `Squash ${shas.length} commits`, () => ops(repoId).squash(shas, message, rewriteDir(repoId), noVerify), (r) => r.result !== 'conflicts')
  )
  handle('history.move', z.object({ ...R, sha, direction: z.enum(['up', 'down']) }), ({ repoId, sha, direction }) =>
    undoable(repoId, 'rebase', `Move ${sha.slice(0, 7)} ${direction}`, () => ops(repoId).move(sha, direction, rewriteDir(repoId)), (r) => r.result !== 'conflicts')
  )
  // Undo puts the changes back staged: `stash` is the commit of them that went in, kept under an undo ref.
  handle('history.amendInto', z.object({ ...R, sha }), ({ repoId, sha }) =>
    exclusive(repoId, async () => {
      const o = ops(repoId)
      const before = await undo.snapshot(o)
      const { result, temp } = await o.amendInto(sha, rewriteDir(repoId))
      await o.mut(['update-ref', `${UNDO_REFS}${uuid()}`, temp])
      const label = `Amend staged changes into ${sha.slice(0, 7)}`
      if (result.result === 'conflicts') undo.setPending(repoId, 'staged_rewrite', label, { ...before, stash: temp })
      else undo.record(repoId, 'staged_rewrite', label, { ...before, stash: temp }, await undo.snapshot(o))
      return result
    })
  )
  handle('history.fixupCommit', z.object({ ...R, sha, noVerify: z.boolean().optional() }), ({ repoId, sha, noVerify }) =>
    undoable(repoId, 'commit', `Fixup commit for ${sha.slice(0, 7)}`, async () => (await ops(repoId).fixupCommit(sha, noVerify ?? false), null))
  )
  handle('history.autosquash', z.object(R), ({ repoId }) => undoable(repoId, 'rebase', 'Squash fixup commits', () => ops(repoId).autosquash(), (r) => r.result !== 'conflicts'))
  handle('history.fixupTarget', z.object(R), ({ repoId }) => ops(repoId).fixupTarget())
}

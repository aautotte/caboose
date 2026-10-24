import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import type {
  Blame,
  CommitDetails,
  CommitSignature,
  FileHistoryEntry,
  RebasePreview,
  RebaseRow,
  RebaseStep,
  RefViewState,
  Remote,
  ResetMode,
  CommitRow,
  ConflictFile,
  DiffSource,
  FileDiff,
  GraphPage,
  OperationState,
  OpResult,
  PullMode,
  Refs,
  Status
} from '../../shared/types'
import { GcFail, invalid } from '../errors'
import type { GitRunner, RunOptions } from './runner'
import { buildPartialPatch } from './patch'
import {
  HISTORY_FORMAT,
  LOG_FORMAT,
  RS,
  REF_FORMAT,
  STASH_FORMAT,
  US,
  parseCoAuthors,
  parseBlame,
  parseDiff,
  parseFileHistory,
  parseLog,
  parseNameStatus,
  parseRefs,
  parseStashes,
  parseStatus
} from './parse'

export interface RepoCtx {
  id: string
  path: string
}

const MAX_DIFF_BYTES = 1_000_000
const MAX_DIFF_LINES = 20_000

/** Where undo safety refs live. Refs from before the rename (refs/gitclone/) are still hidden and pruned. */
export const UNDO_REFS = 'refs/mergatroid/undo/'
const OWN_REFS = ['refs/mergatroid/', 'refs/gitclone/']
const EXCLUDE_OWN = OWN_REFS.map((r) => `--exclude=${r}*`)

/** Git operations for one repository. Mutating calls go through the runner's per-repo queue. */
export class RepoOps {
  private gitDir: string | null = null

  constructor(
    private runner: GitRunner,
    public repo: RepoCtx
  ) {}

  git(args: string[], opts: Partial<RunOptions> = {}): Promise<string> {
    return this.runner.run({ cwd: this.repo.path, repoId: this.repo.id, args, ...opts }).then((r) => r.stdout)
  }

  /** Like git() but returns null instead of throwing on a non-zero exit. */
  async tryGit(args: string[]): Promise<string | null> {
    try {
      return await this.git(args)
    } catch {
      return null
    }
  }

  mut(args: string[], opts: Partial<RunOptions> = {}): Promise<string> {
    return this.git(args, { mutating: true, ...opts })
  }

  // ---------- validation ----------

  /** A path from the renderer must stay inside the repo. Returns it repo-relative with forward slashes. */
  safePath(p: string): string {
    if (!p || p.includes('\0')) throw invalid('Empty file path.')
    const abs = resolve(this.repo.path, p)
    const rel = relative(this.repo.path, abs)
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw invalid(`Path is outside the repository: ${p}`)
    return rel.split('\\').join('/')
  }

  safePaths(paths: string[]): string[] {
    if (paths.length === 0) throw invalid('No files selected.')
    return paths.map((p) => this.safePath(p))
  }

  /** Branch, tag or commit-ish. Blocks option injection like "--upload-pack=...". */
  safeRev(rev: string): string {
    if (!rev || rev.startsWith('-') || /[\s\0~^:?*[\\]|\.\.|@\{/.test(rev)) throw invalid(`Not a valid reference: ${rev}`)
    return rev
  }

  async safeBranchName(name: string): Promise<string> {
    if (!name || name.startsWith('-')) throw invalid('Branch names can’t start with “-”.')
    const ok = await this.tryGit(['check-ref-format', '--branch', name])
    if (ok === null) throw invalid(`“${name}” isn’t a valid branch name. Avoid spaces, “..”, “~”, “^”, “:” and a trailing “/” or “.lock”.`)
    return name
  }

  // ---------- reads ----------

  async absGitDir(): Promise<string> {
    if (!this.gitDir) this.gitDir = (await this.git(['rev-parse', '--absolute-git-dir'])).trim()
    return this.gitDir
  }

  async headSha(): Promise<string | null> {
    return (await this.tryGit(['rev-parse', '-q', '--verify', 'HEAD^{commit}']))?.trim() || null
  }

  async graph(skip: number, limit: number, stashes: Refs['stashes'], view: RefViewState = { hidden: [], soloed: [], pinned: null }): Promise<GraphPage> {
    // Soloed branches replace "everything"; hidden ones are left out of it. HEAD always shows.
    const which = view.soloed.length
      ? [...view.soloed, 'HEAD']
      : [...EXCLUDE_OWN, '--exclude=refs/stash', ...view.hidden.map((r) => `--exclude=${r}`), '--all']
    const out = await this.tryGit(['log', '--topo-order', `--format=${LOG_FORMAT}`, ...which, `--skip=${skip}`, `--max-count=${limit + 1}`, '--'])
    if (out === null) return { commits: [], hasMore: false } // unborn repo
    const commits = parseLog(out)
    const hasMore = commits.length > limit
    if (hasMore) commits.pop()
    // Stashes are drawn as their own rows, right above the commit they were made on.
    const byBase = new Map<string, CommitRow[]>()
    for (const s of stashes) {
      const row: CommitRow = {
        sha: s.sha,
        parents: [s.base],
        authorName: '',
        authorEmail: '',
        authorTime: 0,
        summary: s.message,
        kind: 'stash'
      }
      byBase.set(s.base, [...(byBase.get(s.base) ?? []), row])
    }
    const rows: CommitRow[] = []
    for (const c of commits) {
      const st = byBase.get(c.sha)
      if (st) rows.push(...st)
      rows.push(c)
    }
    return { commits: rows, hasMore }
  }

  async refs(): Promise<Refs> {
    const [remotesOut, symbolic, head, stashOut] = await Promise.all([
      this.git(['remote']),
      this.tryGit(['symbolic-ref', '-q', 'HEAD']),
      this.headSha(),
      this.tryGit(['stash', 'list', `--format=${STASH_FORMAT}`])
    ])
    const remotes = remotesOut.split('\n').filter(Boolean)
    const refsOut = await this.git(['for-each-ref', `--format=${REF_FORMAT}`, 'refs/heads', 'refs/remotes', 'refs/tags'])
    const branch = symbolic?.trim().replace(/^refs\/heads\//, '') || null
    return {
      head: { branch, sha: head, detached: !branch && !!head, unborn: !!branch && !head },
      refs: parseRefs(refsOut, remotes),
      stashes: stashOut ? parseStashes(stashOut) : [],
      remotes
    }
  }

  async opState(): Promise<OperationState> {
    const dir = await this.absGitDir()
    const read = (f: string): string | undefined => {
      try {
        return readFileSync(join(dir, f), 'utf8').trim()
      } catch {
        return undefined
      }
    }
    for (const d of ['rebase-merge', 'rebase-apply']) {
      if (existsSync(join(dir, d))) {
        const step = Number(read(`${d}/msgnum`) ?? read(`${d}/next`) ?? 0)
        const total = Number(read(`${d}/end`) ?? read(`${d}/last`) ?? 0)
        return { kind: 'rebase', step, total, onto: read(`${d}/onto`), head: read(`${d}/head-name`)?.replace(/^refs\/heads\//, '') }
      }
    }
    if (existsSync(join(dir, 'MERGE_HEAD'))) return { kind: 'merge', head: read('MERGE_MSG')?.split('\n')[0] }
    if (existsSync(join(dir, 'CHERRY_PICK_HEAD'))) return { kind: 'cherry_pick', head: read('CHERRY_PICK_HEAD') }
    if (existsSync(join(dir, 'REVERT_HEAD'))) return { kind: 'revert', head: read('REVERT_HEAD') }
    return { kind: 'none' }
  }

  async status(): Promise<Status> {
    const [out, op] = await Promise.all([
      this.git(['status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all']),
      this.opState()
    ])
    return { ...parseStatus(out), op }
  }

  async details(sha: string): Promise<CommitDetails> {
    this.safeRev(sha)
    const fmt = ['%H', '%P', '%an', '%ae', '%at', '%ai', '%cn', '%ce', '%ct', '%G?', '%GS', '%GK', '%B'].join('%x1f')
    const [out, head] = await Promise.all([this.git(['show', '-s', `--format=${fmt}`, sha, '--']), this.headSha()])
    const [full, parents, an, ae, at, ai, cn, ce, ct, sig, signer, sigKey, ...bodyParts] = out.split(US)
    const message = bodyParts.join(US).replace(/\n+$/, '')
    const [summary, ...rest] = message.split('\n')
    const parentList = parents ? parents.split(' ') : []
    const filesOut = parentList.length
      ? await this.git(['diff-tree', '-r', '-M', '-z', '--name-status', '--no-commit-id', parentList[0], full])
      : await this.git(['diff-tree', '-r', '-M', '-z', '--name-status', '--no-commit-id', '--root', full])
    return {
      sha: full,
      parents: parentList,
      author: { name: an, email: ae, time: Number(at), offset: ai.slice(-5) },
      committer: { name: cn, email: ce, time: Number(ct) },
      summary,
      body: rest.join('\n').trim(),
      coAuthors: parseCoAuthors(message),
      files: parseNameStatus(filesOut),
      isHead: full === head,
      signature: parseSignature(sig, signer, sigKey)
    }
  }

  async diff(rawPath: string, rawOld: string | undefined, source: DiffSource, force = false, full = false, ignoreWs = false): Promise<FileDiff> {
    const path = this.safePath(rawPath)
    const old = rawOld ? this.safePath(rawOld) : undefined
    const specs = old && old !== path ? ['--', old, path] : ['--', path]
    const base = ['--no-color', '--no-ext-diff', '-M', '--src-prefix=a/', '--dst-prefix=b/', ...(full ? ['--unified=1000000'] : []), ...(ignoreWs ? ['-w'] : [])]
    let out: string
    if (source.kind === 'worktree') {
      const tracked = (await this.git(['ls-files', '-z', '--', path])).length > 0
      out = tracked
        ? await this.git(['diff', ...base, ...specs])
        : await this.git(['diff', ...base, '--no-index', '--', '/dev/null', path], { okCodes: [1] })
    } else if (source.kind === 'index') {
      out = await this.git(['diff', '--cached', ...base, ...specs])
    } else {
      const sha = this.safeRev(source.sha)
      const parent = source.parent ? this.safeRev(source.parent) : (await this.details(sha)).parents[0]
      out = parent
        ? await this.git(['diff', ...base, parent, sha, ...specs])
        : await this.git(['show', '--format=', ...base, sha, ...specs])
    }
    const lineCount = out.split('\n').length
    if (!force && (out.length > MAX_DIFF_BYTES || lineCount > MAX_DIFF_LINES)) {
      return { path, oldPath: old, binary: false, tooLarge: true, lineCount, isNew: false, isDeleted: false, hunks: [] }
    }
    const d = parseDiff(out, path)
    if (old && !d.oldPath && old !== path) d.oldPath = old
    return d
  }

  async searchCommits(query: string): Promise<string[]> {
    const q = query.trim()
    if (!q) return []
    const common = ['log', '--format=%H', ...EXCLUDE_OWN, '--exclude=refs/stash', '--all', '-n', '500']
    const [byMsg, byAuthor] = await Promise.all([
      this.git([...common, '-i', '--fixed-strings', `--grep=${q}`]),
      this.git([...common, '-i', '--fixed-strings', `--author=${q}`])
    ])
    const shas = new Set([...byMsg.split('\n'), ...byAuthor.split('\n')].filter(Boolean))
    if (/^[0-9a-f]{4,40}$/i.test(q)) {
      const hit = await this.tryGit(['rev-parse', '-q', '--verify', `${q}^{commit}`])
      if (hit) shas.add(hit.trim())
    }
    return [...shas]
  }

  // ---------- staging and commits ----------

  async stage(paths: string[] | 'all'): Promise<void> {
    if (paths === 'all') await this.mut(['add', '-A'])
    else await this.mut(['add', '-A', '--', ...this.safePaths(paths)])
  }

  async unstage(paths: string[] | 'all'): Promise<void> {
    const spec = paths === 'all' ? ['.'] : this.safePaths(paths)
    if (await this.headSha()) await this.mut(['restore', '--staged', '--', ...spec])
    else await this.mut(['rm', '--cached', '-r', '-q', '--', ...spec]) // no commits yet: nothing to restore from
  }

  async commit(summary: string, body: string, amend: boolean, noVerify: boolean, messageOnly = false): Promise<string> {
    const s = summary.trim()
    if (!s) throw invalid('Add a summary first.')
    const msg = body.trim() ? `${s}\n\n${body.trim()}\n` : `${s}\n`
    const args = ['commit', '-F', '-', '--cleanup=strip']
    if (amend) args.push('--amend')
    if (amend && messageOnly) args.push('--only') // reword HEAD without taking staged changes
    if (noVerify) args.push('--no-verify')
    await this.mut(args, { stdin: msg })
    return (await this.headSha())!
  }

  /**
   * Discards changes by stashing them (untracked files included) and dropping the stash entry,
   * so the user's stash list stays clean but the snapshot can be restored by undo.
   * Returns the snapshot commit, or null if there was nothing to discard.
   */
  async discard(paths: string[] | 'all', snapshotRef: string): Promise<string | null> {
    const before = await this.tryGit(['rev-parse', '-q', '--verify', 'refs/stash'])
    const spec = paths === 'all' ? [] : ['--', ...this.safePaths(paths)]
    await this.mut(['stash', 'push', '--include-untracked', '-q', '-m', 'Mergatroid: discarded changes', ...spec])
    const after = await this.tryGit(['rev-parse', '-q', '--verify', 'refs/stash'])
    if (!after || after === before) return null
    const sha = after.trim()
    await this.mut(['update-ref', snapshotRef, sha])
    await this.mut(['stash', 'drop', '-q', 'stash@{0}'])
    return sha
  }

  async restoreSnapshot(sha: string): Promise<void> {
    try {
      await this.mut(['stash', 'apply', '-q', '--index', sha])
    } catch {
      await this.mut(['stash', 'apply', '-q', sha])
    }
  }

  // ---------- branches ----------

  async createBranch(name: string, at: string, checkout: boolean): Promise<void> {
    await this.safeBranchName(name)
    this.safeRev(at)
    await this.mut(['branch', name, at])
    if (checkout) await this.mut(['switch', name])
  }

  /** Accepts a local branch, a remote branch (creates a tracking branch), a tag or a sha (detached). */
  async checkout(ref: string): Promise<void> {
    this.safeRev(ref)
    const local = await this.tryGit(['rev-parse', '-q', '--verify', `refs/heads/${ref}`])
    if (local) return void (await this.mut(['switch', ref]))
    const remote = await this.tryGit(['rev-parse', '-q', '--verify', `refs/remotes/${ref}`])
    if (remote) {
      const { remotes } = await this.refs()
      const r = remotes.find((x) => ref.startsWith(x + '/'))
      const name = r ? ref.slice(r.length + 1) : ref
      const exists = await this.tryGit(['rev-parse', '-q', '--verify', `refs/heads/${name}`])
      if (exists) return void (await this.mut(['switch', name]))
      return void (await this.mut(['switch', '-c', name, '--track', ref]))
    }
    await this.mut(['switch', '--detach', ref])
  }

  async renameBranch(name: string, newName: string): Promise<void> {
    this.safeRev(name)
    await this.safeBranchName(newName)
    await this.mut(['branch', '-m', name, newName])
  }

  async deleteBranch(name: string, force: boolean): Promise<string> {
    this.safeRev(name)
    const sha = (await this.git(['rev-parse', '--verify', `refs/heads/${name}`])).trim()
    try {
      await this.mut(['branch', force ? '-D' : '-d', name])
    } catch (e) {
      if (e instanceof GcFail && /not fully merged/.test(e.detail ?? '')) {
        throw new GcFail('git', `“${name}” has commits that aren’t merged anywhere else. Delete it anyway?`, e.detail)
      }
      throw e
    }
    return sha
  }

  /** Deletes `branch` on `remote` (git push --delete). Git also drops our remote-tracking copy. Returns where it was. */
  async deleteRemoteBranch(remote: string, branch: string, opId: string): Promise<string | null> {
    this.safeRev(remote)
    this.safeRev(branch)
    const sha = (await this.tryGit(['rev-parse', '-q', '--verify', `refs/remotes/${remote}/${branch}`]))?.trim() || null
    await this.mut(['push', remote, '--delete', `refs/heads/${branch}`], { opId, timeoutMs: 300_000 })
    return sha
  }

  async merge(source: string): Promise<OpResult> {
    this.safeRev(source)
    try {
      const out = await this.mut(['merge', '--no-edit', source])
      if (/Already up to date/i.test(out)) return { result: 'nothing', message: 'Already up to date.' }
      return { result: 'ok' }
    } catch (e) {
      if ((await this.opState()).kind === 'merge') return { result: 'conflicts' }
      throw e
    }
  }

  /** Rebases `branch` (named explicitly, so a checkout from elsewhere in between can't change which branch moves). */
  async rebase(onto: string, branch?: string): Promise<OpResult> {
    this.safeRev(onto)
    if (branch) this.safeRev(branch)
    try {
      const out = await this.mut(['rebase', onto, ...(branch ? [branch] : [])])
      if (/is up to date/i.test(out)) return { result: 'nothing', message: 'Already up to date.' }
      return { result: 'ok' }
    } catch (e) {
      if ((await this.opState()).kind === 'rebase') return { result: 'conflicts' }
      throw e
    }
  }

  async setUpstream(name: string, upstream: string): Promise<void> {
    await this.mut(['branch', '-u', this.safeRev(upstream), this.safeRev(name)])
  }

  // ---------- sync ----------

  /** A background fetch never asks for credentials: no askpass, and Git Credential Manager stays non-interactive. */
  async fetch(opId: string, onProgress: RunOptions['onProgress'], interactive = true): Promise<void> {
    const quiet = interactive ? undefined : { GIT_ASKPASS: '', SSH_ASKPASS: '', GCM_INTERACTIVE: 'never' }
    await this.mut(['fetch', '--all', '--prune', '--progress'], { opId, onProgress, timeoutMs: 300_000, extraEnv: quiet })
  }

  async pull(mode: PullMode, opId: string, onProgress: RunOptions['onProgress']): Promise<OpResult> {
    const flag = mode === 'ff' ? ['--ff', '--no-rebase', '--no-edit'] : mode === 'ff-only' ? ['--ff-only'] : ['--rebase']
    try {
      const out = await this.mut(['pull', '--progress', ...flag], { opId, onProgress, timeoutMs: 300_000 })
      if (/Already up to date/i.test(out)) return { result: 'nothing', message: 'Already up to date.' }
      return { result: 'ok' }
    } catch (e) {
      const op = await this.opState()
      if (op.kind === 'merge' || op.kind === 'rebase') return { result: 'conflicts' }
      if (e instanceof GcFail && /no tracking information/i.test(e.detail ?? '')) {
        throw new GcFail('git', 'This branch doesn’t track a remote branch yet. Push it first, or set its upstream.', e.detail)
      }
      if (e instanceof GcFail && /Not possible to fast-forward/i.test(e.detail ?? '')) {
        return { result: 'rejected', message: 'Can’t fast-forward: both sides have new commits. Pull with merge or rebase instead.' }
      }
      throw e
    }
  }

  async push(opts: { opId: string; remote?: string; branch?: string; setUpstream?: boolean; force?: boolean }, onProgress: RunOptions['onProgress']): Promise<OpResult> {
    const st = await this.status()
    const branch = opts.branch ? this.safeRev(opts.branch) : st.branch
    if (!branch) throw invalid('You’re not on a branch (detached HEAD). Create a branch to push these commits.')
    // Another branch than the current one: its own upstream, e.g. origin/feature (empty when it tracks nothing).
    const upstream = opts.branch && opts.branch !== st.branch ? (await this.tryGit(['rev-parse', '--abbrev-ref', `${branch}@{upstream}`]))?.trim() || null : st.upstream
    if (!upstream && !opts.setUpstream) return { result: 'needsUpstream' }
    const { remotes } = await this.refs()
    const remote = opts.remote ? this.safeRev(opts.remote) : upstream ? remotes.find((r) => upstream.startsWith(r + '/')) : remotes[0]
    if (!remote) throw invalid('This repository has no remote to push to. Add one first.')
    const args = ['push', '--progress']
    if (opts.setUpstream) args.push('-u')
    if (opts.force) args.push('--force-with-lease')
    args.push(remote, branch)
    try {
      await this.mut(args, { opId: opts.opId, onProgress, timeoutMs: 300_000 })
      return { result: 'ok' }
    } catch (e) {
      // --force-with-lease refuses when the remote moved since our last fetch: those commits were never seen here.
      if (opts.force && e instanceof GcFail && /stale info|\[rejected\]/i.test(e.detail ?? '')) {
        return { result: 'stale', message: 'Someone pushed to this branch since your last fetch. Fetch to see their commits first; a force push only replaces commits you’ve seen.' }
      }
      if (e instanceof GcFail && /\[rejected\]|non-fast-forward|fetch first|stale info/i.test(e.detail ?? '')) {
        return { result: 'rejected', message: 'The remote has commits you don’t have. Pull first, or force push to overwrite them.' }
      }
      throw e
    }
  }

  // ---------- conflicts and paused operations ----------

  async conflict(rawPath: string): Promise<ConflictFile> {
    const path = this.safePath(rawPath)
    const stage = async (n: number): Promise<string | null> => this.tryGit(['show', `:${n}:${path}`])
    const [base, ours, theirs, op] = await Promise.all([stage(1), stage(2), stage(3), this.opState()])
    const abs = join(this.repo.path, path)
    const merged = existsSync(abs) && statSync(abs).isFile() ? readFileSync(abs, 'utf8') : ''
    const binary = [base, ours, theirs, merged].some((t) => t !== null && t.includes('\0'))
    const st = await this.status()
    const theirsLabel =
      op.kind === 'merge'
        ? (/Merge (?:remote-tracking )?branch '?([^'\s]+)'?/.exec(op.head ?? '')?.[1] ?? 'Incoming')
        : op.kind === 'rebase'
          ? 'Commit being replayed'
          : op.kind === 'cherry_pick'
            ? 'Cherry-picked commit'
            : 'Incoming'
    const oursLabel = op.kind === 'rebase' ? (op.onto?.slice(0, 7) ?? 'Base') : (st.branch ?? 'HEAD')
    const diff3 = !binary && base !== null && ours !== null && theirs !== null ? await this.diff3(base, ours, theirs) : null
    return { path, binary, base, ours, theirs, merged, diff3, oursLabel, theirsLabel }
  }

  /** Re-merges the three versions in a temp folder with the ancestor's lines kept (git merge-file --diff3). */
  private async diff3(base: string, ours: string, theirs: string): Promise<string | null> {
    const dir = mkdtempSync(join(tmpdir(), 'mergatroid-merge-'))
    try {
      const f = (name: string, text: string): string => {
        const p = join(dir, name)
        writeFileSync(p, text)
        return p
      }
      const args = ['merge-file', '-p', '--diff3', '-L', 'ours', '-L', 'base', '-L', 'theirs', f('ours', ours), f('base', base), f('theirs', theirs)]
      // Exit code = number of conflicts (capped at 127).
      const r = await this.runner.run({ cwd: dir, args, okCodes: Array.from({ length: 127 }, (_, i) => i + 1) })
      return r.stdout
    } catch {
      return null
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  async resolve(rawPath: string, content: string): Promise<void> {
    const path = this.safePath(rawPath)
    writeFileSync(join(this.repo.path, path), content)
    await this.mut(['add', '--', path])
  }

  async take(rawPath: string, side: 'ours' | 'theirs'): Promise<void> {
    const path = this.safePath(rawPath)
    // In a delete / modify conflict the deleting side has no version: taking it means deleting the file.
    const has = await this.tryGit(['cat-file', '-e', `:${side === 'ours' ? 2 : 3}:${path}`])
    if (has === null) {
      await this.mut(['rm', '-q', '--', path])
      return
    }
    await this.mut(['checkout', side === 'ours' ? '--ours' : '--theirs', '--', path])
    await this.mut(['add', '--', path])
  }

  async continueOp(): Promise<OpResult> {
    const op = await this.opState()
    const st = await this.status()
    if (st.changes.some((c) => c.conflicted)) throw invalid('Some files still have conflicts. Resolve them first.')
    const cmd: Record<string, string[]> = {
      merge: ['commit', '--no-edit'],
      rebase: ['rebase', '--continue'],
      cherry_pick: ['cherry-pick', '--continue'],
      revert: ['revert', '--continue']
    }
    if (op.kind === 'none') return { result: 'nothing' }
    try {
      await this.mut(cmd[op.kind])
    } catch (e) {
      if ((await this.opState()).kind !== 'none') return { result: 'conflicts' }
      throw e
    }
    return (await this.opState()).kind === 'none' ? { result: 'ok' } : { result: 'conflicts' }
  }

  async abortOp(): Promise<void> {
    const op = await this.opState()
    const cmd: Record<string, string[]> = {
      merge: ['merge', '--abort'],
      rebase: ['rebase', '--abort'],
      cherry_pick: ['cherry-pick', '--abort'],
      revert: ['revert', '--abort']
    }
    if (op.kind !== 'none') await this.mut(cmd[op.kind])
  }

  async skipOp(): Promise<OpResult> {
    const op = await this.opState()
    if (op.kind !== 'rebase') throw invalid('Only a rebase can skip a commit.')
    try {
      await this.mut(['rebase', '--skip'])
    } catch (e) {
      if ((await this.opState()).kind !== 'none') return { result: 'conflicts' }
      throw e
    }
    return (await this.opState()).kind === 'none' ? { result: 'ok' } : { result: 'conflicts' }
  }

  // ---------- partial staging and ignore ----------

  /** Stages, unstages or discards one hunk or some of its lines. Returns the patch applied (for undo). */
  async applyPartial(input: { path: string; source: 'worktree' | 'index'; hunk: number; header: string; lines: number[] | null; action: 'stage' | 'unstage' | 'discard'; full: boolean }): Promise<string> {
    const path = this.safePath(input.path)
    if ((input.action === 'unstage') !== (input.source === 'index')) throw invalid('Stage and discard work on unstaged changes; unstage works on staged ones.')
    const untracked = input.source === 'worktree' && (await this.git(['ls-files', '-z', '--', path])).length === 0
    if (untracked && input.action === 'discard') throw invalid('This file is new, so there’s no earlier version to go back to. Discard the whole file instead.')
    // A new file needs an (empty) index entry before part of it can be staged.
    if (untracked) await this.mut(['add', '-N', '--', path])
    const base = ['--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/', ...(input.full ? ['--unified=1000000'] : [])]
    const raw = await this.git(input.source === 'index' ? ['diff', '--cached', ...base, '--', path] : ['diff', ...base, '--', path])
    const undoIntent = async (): Promise<void> => {
      if (untracked) await this.mut(['rm', '--cached', '-q', '--', path])
    }
    if (/^(rename from|Binary files|GIT binary patch)/m.test(raw)) {
      await undoIntent()
      throw invalid('Renamed and binary files can only be staged as a whole.')
    }
    const built = buildPartialPatch(raw, input.hunk, input.lines, input.action !== 'stage')
    if (!built || built.header !== input.header) {
      await undoIntent()
      throw new GcFail('changed_outside', 'This file changed since it was shown. Look at it again, then retry.')
    }
    const args =
      input.action === 'stage'
        ? ['apply', '--cached', '--recount', '--whitespace=nowarn', '-']
        : input.action === 'unstage'
          ? ['apply', '--cached', '--reverse', '--recount', '--whitespace=nowarn', '-']
          : ['apply', '--reverse', '--recount', '--whitespace=nowarn', '-']
    await this.mut(args, { stdin: built.patch })
    return built.patch
  }

  /** Re-applies (or reverses again) a patch from a line discard, for undo / redo. */
  async applyWorktreePatch(patch: string, reverse: boolean): Promise<void> {
    await this.mut(['apply', ...(reverse ? ['--reverse'] : []), '--recount', '--whitespace=nowarn', '-'], { stdin: patch })
  }

  /** Adds a line to the root .gitignore, and optionally stops tracking files it now covers. */
  async ignore(pattern: string, stopTracking: string[]): Promise<void> {
    const p = pattern.trim()
    if (!p || /[\r\n\0]/.test(p)) throw invalid('Enter one pattern.')
    const file = join(this.repo.path, '.gitignore')
    const cur = existsSync(file) ? readFileSync(file, 'utf8') : ''
    if (cur.split(/\r?\n/).includes(p)) throw invalid(`.gitignore already has “${p}”.`)
    const eol = cur.includes('\r\n') ? '\r\n' : '\n'
    writeFileSync(file, cur + (cur && !cur.endsWith('\n') ? eol : '') + p + eol)
    if (stopTracking.length) await this.mut(['rm', '--cached', '-r', '-q', '--ignore-unmatch', '--', ...this.safePaths(stopTracking)])
  }

  // ---------- stash ----------

  private async stashIndex(sha: string): Promise<number> {
    this.safeRev(sha)
    const out = (await this.tryGit(['stash', 'list', '--format=%H'])) ?? ''
    const i = out.split('\n').indexOf(sha)
    if (i < 0) throw new GcFail('changed_outside', 'That stash is gone. It may have been applied or dropped elsewhere.')
    return i
  }

  async stashSave(message: string, stagedOnly: boolean, includeUntracked: boolean): Promise<OpResult> {
    const before = await this.tryGit(['rev-parse', '-q', '--verify', 'refs/stash'])
    const args = ['stash', 'push', '-q']
    if (message.trim()) args.push('-m', message.trim())
    if (stagedOnly) args.push('--staged')
    else if (includeUntracked) args.push('--include-untracked')
    await this.mut(args)
    const after = await this.tryGit(['rev-parse', '-q', '--verify', 'refs/stash'])
    if (!after || after === before) return { result: 'nothing', message: stagedOnly ? 'Nothing staged to stash.' : 'No changes to stash.' }
    return { result: 'ok' }
  }

  async stashApply(sha: string, pop: boolean): Promise<OpResult> {
    const index = await this.stashIndex(sha)
    try {
      await this.mut(['stash', 'apply', '-q', '--index', sha])
    } catch (e) {
      const st = await this.status()
      if (st.changes.some((c) => c.conflicted)) {
        return { result: 'conflicts', message: pop ? 'The stash was kept, because applying it hit conflicts.' : undefined }
      }
      // --index fails when the staged part no longer applies cleanly; retry without restoring the index.
      if (e instanceof GcFail && /index|could not restore/i.test(e.detail ?? '')) await this.mut(['stash', 'apply', '-q', sha])
      else throw e
    }
    if (pop) await this.mut(['stash', 'drop', '-q', `stash@{${index}}`])
    return { result: 'ok' }
  }

  async stashDrop(sha: string): Promise<string> {
    const index = await this.stashIndex(sha)
    const message = (await this.git(['log', '-1', '--format=%gs', '-g', `stash@{${index}}`])).trim()
    await this.mut(['stash', 'drop', '-q', `stash@{${index}}`])
    return message
  }

  /** git has no stash rename: drop the entry and store the same commit again with the new message (it moves to the top). */
  async stashRename(sha: string, message: string): Promise<void> {
    const m = message.trim()
    if (!m || /[\r\n]/.test(m)) throw invalid('Give the stash a one-line name.')
    const index = await this.stashIndex(sha)
    await this.mut(['stash', 'drop', '-q', `stash@{${index}}`])
    await this.stashStore(sha, m)
  }

  async stashStore(sha: string, message: string): Promise<void> {
    await this.mut(['stash', 'store', '-q', '-m', message, this.safeRev(sha)])
  }

  // ---------- tags ----------

  async safeTagName(name: string): Promise<string> {
    if (!name || name.startsWith('-')) throw invalid('Tag names can’t start with “-”.')
    if ((await this.tryGit(['check-ref-format', `refs/tags/${name}`])) === null) throw invalid(`“${name}” isn’t a valid tag name.`)
    return name
  }

  async createTag(name: string, at: string, message: string | null): Promise<void> {
    await this.safeTagName(name)
    this.safeRev(at)
    if (await this.tryGit(['rev-parse', '-q', '--verify', `refs/tags/${name}`])) throw invalid(`A tag called “${name}” already exists.`)
    if (message?.trim()) await this.mut(['tag', '-a', '-F', '-', name, at], { stdin: message.trim() + '\n' })
    else await this.mut(['tag', name, at])
  }

  /** Deletes a local tag; returns the object it pointed at so undo can put it back. */
  async deleteTag(name: string): Promise<string> {
    this.safeRev(name)
    const obj = (await this.git(['rev-parse', '--verify', `refs/tags/${name}`])).trim()
    await this.mut(['tag', '-d', name])
    return obj
  }

  async pushTag(name: string, remote: string, opId: string, del: boolean): Promise<void> {
    this.safeRev(name)
    this.safeRev(remote)
    const spec = `refs/tags/${name}`
    await this.mut(del ? ['push', remote, '--delete', spec] : ['push', remote, spec], { opId, timeoutMs: 300_000 })
  }

  // ---------- history edits ----------

  async reset(target: string, mode: ResetMode): Promise<void> {
    this.safeRev(target)
    await this.mut(['reset', '-q', `--${mode}`, target])
  }

  /** Snapshot of uncommitted work (tracked files) pinned under a ref, or null if the tree is clean. */
  async pinWork(ref: string): Promise<string | null> {
    const sha = (await this.git(['stash', 'create'])).trim()
    if (!sha) return null
    await this.mut(['update-ref', ref, sha])
    return sha
  }

  private async sequencerResult(e: unknown, kind: 'cherry_pick' | 'revert'): Promise<OpResult> {
    const op = await this.opState()
    if (op.kind === kind) {
      // An empty pick (the change is already here) stops too; skip it rather than leave the user stuck.
      if (e instanceof GcFail && /now empty|nothing to commit/i.test(e.detail ?? '')) {
        const st = await this.status()
        if (!st.changes.some((c) => c.conflicted)) {
          await this.mut([kind === 'cherry_pick' ? 'cherry-pick' : 'revert', '--skip'])
          if ((await this.opState()).kind === 'none') return { result: 'nothing', message: 'Those changes are already on this branch.' }
        }
      }
      return { result: 'conflicts' }
    }
    throw e
  }

  async revert(sha: string): Promise<OpResult> {
    this.safeRev(sha)
    const parents = (await this.git(['rev-list', '--parents', '-n', '1', sha])).trim().split(' ').length - 1
    try {
      await this.mut(['revert', '--no-edit', ...(parents > 1 ? ['-m', '1'] : []), sha])
      return { result: 'ok' }
    } catch (e) {
      return this.sequencerResult(e, 'revert')
    }
  }

  async cherryPick(shas: string[]): Promise<OpResult> {
    if (!shas.length) throw invalid('Pick at least one commit.')
    shas.forEach((s) => this.safeRev(s))
    try {
      await this.mut(['cherry-pick', ...shas])
      return { result: 'ok' }
    } catch (e) {
      return this.sequencerResult(e, 'cherry_pick')
    }
  }

  private async rangeRows(range: string[]): Promise<RebaseRow[]> {
    const out = await this.git(['log', '--reverse', '--format=%H%x1f%an%x1f%ae%x1f%at%x1f%s%x1f%b%x1e', ...range, '--'])
    return out
      .split(RS)
      .map((r) => r.replace(/^\n/, ''))
      .filter(Boolean)
      .map((r) => {
        const [sha, authorName, authorEmail, at, summary, body] = r.split(US)
        return { sha, authorName, authorEmail, authorTime: Number(at), summary, body: (body ?? '').trim() }
      })
  }

  /** Commits on `tip` that HEAD doesn't have, oldest first, merges left out. */
  async cherryPreview(tip: string): Promise<RebaseRow[]> {
    this.safeRev(tip)
    return this.rangeRows(['--no-merges', '--cherry-pick', '--right-only', `HEAD...${tip}`])
  }

  async rebasePreview(onto: string): Promise<RebasePreview> {
    this.safeRev(onto)
    const st = await this.status()
    const merges = Number((await this.git(['rev-list', '--count', '--min-parents=2', `${onto}..HEAD`])).trim())
    return { branch: st.branch, onto, rows: await this.rangeRows(['--no-merges', `${onto}..HEAD`]), merges }
  }

  /**
   * Runs `git rebase -i` with our own todo list. Rewording uses an `exec git commit --amend` step after the pick,
   * so git never opens an editor. Squash keeps both messages (comment lines stripped).
   */
  async rebaseInteractive(onto: string, plan: RebaseStep[], tmpDir: string): Promise<OpResult> {
    this.safeRev(onto)
    const preview = await this.rebasePreview(onto)
    if (preview.merges) throw invalid('This range has merge commits. Interactive rebase here would flatten them, so it isn’t offered.')
    const known = new Set(preview.rows.map((r) => r.sha))
    if (plan.length !== known.size || plan.some((s) => !known.has(s.sha))) {
      throw new GcFail('changed_outside', 'The branch changed since the list was made. Open it again.')
    }
    const firstKept = plan.find((s) => s.action !== 'drop')
    if (firstKept && (firstKept.action === 'squash' || firstKept.action === 'fixup')) {
      throw invalid('The first kept commit can’t be squashed: there’s nothing above it to squash into.')
    }
    if ((await this.opState()).kind !== 'none') throw invalid('Finish or abort the operation in progress first.')
    if (await this.hasTrackedChanges()) throw invalid('Commit or stash your changes before rebasing.')
    rmSync(tmpDir, { recursive: true, force: true })
    mkdirSync(tmpDir, { recursive: true })
    // Paths for git's shell (sh), single-quoted.
    const shq = (p: string): string => "'" + p.split('\\').join('/').split("'").join("'\\''") + "'"
    const lines: string[] = []
    plan.forEach((s, i) => {
      if (s.action === 'reword') {
        const msgFile = join(tmpDir, `msg-${i}.txt`)
        writeFileSync(msgFile, (s.message ?? '').trim() + '\n')
        lines.push(`pick ${s.sha}`, `exec git commit --amend --only -q --no-verify --cleanup=strip -F ${shq(msgFile)}`)
      } else lines.push(`${s.action} ${s.sha}`)
    })
    const todo = join(tmpDir, 'todo.txt')
    writeFileSync(todo, lines.join('\n') + '\n')
    try {
      await this.mut(['rebase', '-i', onto], { extraEnv: { GIT_SEQUENCE_EDITOR: `cp ${shq(todo)}`, GIT_EDITOR: 'true' }, timeoutMs: 300_000 })
      return { result: 'ok' }
    } catch (e) {
      if ((await this.opState()).kind === 'rebase') return { result: 'conflicts' }
      throw e
    } finally {
      // Reword messages for steps after a conflict are still needed; keep the folder until the rebase ends.
      if ((await this.opState()).kind !== 'rebase') rmSync(tmpDir, { recursive: true, force: true })
    }
  }

  // ---------- rewriting the current branch (reword, squash, move) ----------

  /** The current branch's first-parent line, oldest first. */
  private async headLine(): Promise<string[]> {
    return (await this.git(['rev-list', '--reverse', '--first-parent', 'HEAD'])).split('\n').filter(Boolean)
  }

  private async parentOf(sha: string): Promise<string | null> {
    return (await this.tryGit(['rev-parse', '-q', '--verify', `${this.safeRev(sha)}^`]))?.trim() || null
  }

  /** Replays everything after `onto` with a plan made from the commits (oldest first). */
  private async rewrite(onto: string, tmpDir: string, build: (rows: RebaseRow[]) => RebaseStep[]): Promise<OpResult> {
    const preview = await this.rebasePreview(onto)
    if (preview.merges) throw invalid('There are merge commits after this one on the branch, so this can’t be rewritten without flattening them.')
    return this.rebaseInteractive(onto, build(preview.rows), tmpDir)
  }

  async reword(sha: string, message: string, tmpDir: string): Promise<OpResult> {
    const m = message.trim()
    if (!m) throw invalid('Add a summary first.')
    const full = (await this.git(['rev-parse', '--verify', `${this.safeRev(sha)}^{commit}`])).trim()
    if (full === (await this.headSha())) {
      const [summary, ...rest] = m.split('\n')
      await this.commit(summary, rest.join('\n'), true, true, true)
      return { result: 'ok' }
    }
    if (!(await this.headLine()).includes(full)) throw invalid('That commit isn’t on the current branch’s own line of history.')
    const onto = await this.parentOf(full)
    if (!onto) throw invalid('The very first commit can’t be reworded here.')
    return this.rewrite(onto, tmpDir, (rows) => rows.map((r) => (r.sha === full ? { sha: r.sha, action: 'reword', message: m } : { sha: r.sha, action: 'pick' })))
  }

  /** Squashes commits that sit next to each other on the current branch into one, with the given message. */
  async squash(shas: string[], message: string, tmpDir: string): Promise<OpResult> {
    const m = message.trim()
    if (!m) throw invalid('Add a summary first.')
    if (shas.length < 2) throw invalid('Pick at least two commits to squash.')
    const line = await this.headLine()
    const full = await Promise.all(shas.map(async (s) => (await this.git(['rev-parse', '--verify', `${this.safeRev(s)}^{commit}`])).trim()))
    const idx = full.map((s) => line.indexOf(s)).sort((a, b) => a - b)
    if (idx[0] < 0) throw invalid('Some of these commits aren’t on the current branch’s own line of history.')
    if (idx.some((v, i) => i > 0 && v !== idx[i - 1] + 1)) throw invalid('Pick commits that sit next to each other to squash them.')
    const chosen = new Set(full)
    const first = line[idx[0]]
    const onto = await this.parentOf(first)
    if (!onto) throw invalid('Squashing into the very first commit isn’t supported here.')
    return this.rewrite(onto, tmpDir, (rows) =>
      rows.map((r) => (r.sha === first ? { sha: r.sha, action: 'reword', message: m } : chosen.has(r.sha) ? { sha: r.sha, action: 'fixup' } : { sha: r.sha, action: 'pick' }))
    )
  }

  /** Swaps a commit with its newer (up) or older (down) neighbour on the current branch. */
  async move(sha: string, direction: 'up' | 'down', tmpDir: string): Promise<OpResult> {
    const line = await this.headLine()
    const full = (await this.git(['rev-parse', '--verify', `${this.safeRev(sha)}^{commit}`])).trim()
    const i = line.indexOf(full)
    if (i < 0) throw invalid('That commit isn’t on the current branch’s own line of history.')
    const j = direction === 'up' ? i + 1 : i - 1
    if (j >= line.length) throw invalid('This is already the newest commit.')
    if (j < 0) throw invalid('This is already the oldest commit.')
    const lower = Math.min(i, j)
    if (lower === 0) throw invalid('A commit can’t be moved below the very first commit.')
    const a = line[lower]
    const b = line[lower + 1]
    return this.rewrite(line[lower - 1], tmpDir, (rows) => {
      const order = rows.map((r) => r.sha)
      const ia = order.indexOf(a)
      const ib = order.indexOf(b)
      if (ia < 0 || ib < 0) throw invalid('These commits can’t be swapped (one of them is a merge).')
      ;[order[ia], order[ib]] = [order[ib], order[ia]]
      return order.map((s) => ({ sha: s, action: 'pick' as const }))
    })
  }

  // ---------- remotes ----------

  async remotes(): Promise<Remote[]> {
    const out = await this.git(['remote', '-v'])
    const m = new Map<string, Remote>()
    for (const line of out.split('\n')) {
      const hit = /^(\S+)\t(.+) \((fetch|push)\)$/.exec(line)
      if (!hit) continue
      const r = m.get(hit[1]) ?? { name: hit[1], fetchUrl: '', pushUrl: '' }
      if (hit[3] === 'fetch') r.fetchUrl = hit[2]
      else r.pushUrl = hit[2]
      m.set(hit[1], r)
    }
    return [...m.values()]
  }

  async addRemote(name: string, url: string, pushUrl?: string): Promise<void> {
    if (!name || name.startsWith('-') || (await this.tryGit(['check-ref-format', `refs/remotes/${name}/x`])) === null) {
      throw invalid(`“${name}” isn’t a valid remote name.`)
    }
    const u = url.trim()
    if (!u || u.startsWith('-') || /[\s\0]/.test(u)) throw invalid('That doesn’t look like a repository URL or path.')
    if ((await this.remotes()).some((r) => r.name === name)) throw invalid(`There’s already a remote called “${name}”.`)
    await this.mut(['remote', 'add', '--', name, u])
    if (pushUrl && pushUrl !== u) await this.mut(['remote', 'set-url', '--push', '--', name, pushUrl])
  }

  async removeRemote(name: string): Promise<Remote> {
    const r = (await this.remotes()).find((x) => x.name === name)
    if (!r) throw invalid(`No remote called “${name}”.`)
    await this.mut(['remote', 'remove', '--', name])
    return r
  }

  /**
   * "Focus on this branch": the checked-out branch, what it tracks, and the repo's main line
   * (the remote's default branch, else a local main / master). Full ref names.
   */
  async focusRefs(refs: Refs): Promise<string[]> {
    const out = new Set<string>()
    const head = refs.refs.find((r) => r.isHead)
    if (head) {
      out.add(head.name)
      if (head.upstream) out.add(head.upstream)
    }
    const remoteHead = (await this.tryGit(['symbolic-ref', '-q', 'refs/remotes/origin/HEAD']))?.trim()
    if (remoteHead) out.add(remoteHead)
    for (const n of ['refs/heads/main', 'refs/heads/master', 'refs/remotes/origin/main', 'refs/remotes/origin/master']) {
      if (refs.refs.some((r) => r.name === n)) out.add(n)
    }
    return [...out]
  }

  // ---------- housekeeping ----------

  /** Deletes undo safety refs that no undo entry points at any more (entries are capped at 100 per repo). */
  async pruneUndoRefs(keep: Set<string>): Promise<number> {
    const out = await this.git(['for-each-ref', '--format=%(refname) %(objectname)', UNDO_REFS, 'refs/gitclone/undo/'])
    let n = 0
    for (const line of out.split('\n').filter(Boolean)) {
      const [name, sha] = line.split(' ')
      if (keep.has(sha)) continue
      await this.mut(['update-ref', '-d', name])
      n++
    }
    return n
  }

  /** The commit message template from git config (commit.template), without comment lines. */
  async commitTemplate(): Promise<string | null> {
    const file = (await this.tryGit(['config', '--type=path', '--get', 'commit.template']))?.trim()
    if (!file) return null
    const abs = isAbsolute(file) ? file : join(this.repo.path, file)
    if (!existsSync(abs) || statSync(abs).size > 64_000) return null
    const text = readFileSync(abs, 'utf8')
      .split(/\r?\n/)
      .filter((l) => !l.startsWith('#'))
      .join('\n')
      .trim()
    return text || null
  }

  /** Runs the user's configured diff or merge tool (git difftool / mergetool). Waits until it closes. */
  async externalTool(kind: 'diff' | 'merge', rawPath: string, staged: boolean): Promise<void> {
    const path = this.safePath(rawPath)
    const tool = (await this.tryGit(['config', '--get', kind === 'diff' ? 'diff.tool' : 'merge.tool']))?.trim() || (await this.tryGit(['config', '--get', 'merge.tool']))?.trim()
    if (!tool) throw invalid(`No external ${kind} tool is set. Choose one in Settings, under External tools.`)
    const args = kind === 'diff' ? ['difftool', '--no-prompt', ...(staged ? ['--cached'] : []), '--', path] : ['mergetool', '--no-prompt', '--', path]
    // Not queued as a repo change: the tool can stay open for hours while the user keeps working.
    await this.git(args, { timeoutMs: 8 * 3600_000 })
  }

  // ---------- file history and blame ----------

  async fileHistory(rawPath: string, limit: number): Promise<FileHistoryEntry[]> {
    const path = this.safePath(rawPath)
    const out = await this.git(['log', '--follow', '-M', `--format=${HISTORY_FORMAT}`, '--name-status', '-z', `-n${limit}`, 'HEAD', '--', path])
    const rows = parseFileHistory(out)
    // Merge commits list no files; they keep the name from the commit after them.
    let last = path
    for (const r of rows) {
      if (!r.path) r.path = last
      last = r.oldPath ?? r.path
    }
    return rows
  }

  async blame(rawPath: string, rev: string | null): Promise<Blame> {
    const path = this.safePath(rawPath)
    if (rev) this.safeRev(rev)
    const out = await this.git(['blame', '--porcelain', '-w', ...(rev ? [rev] : []), '--', path], { timeoutMs: 120_000 })
    return parseBlame(out, path)
  }

  async hasTrackedChanges(): Promise<boolean> {
    const st = await this.status()
    return st.changes.some((c) => c.worktree !== '?' || c.index !== '.')
  }
}

const SIG: Record<string, CommitSignature['status']> = { G: 'good', U: 'untrusted', B: 'bad', E: 'unknown', X: 'expired', Y: 'expired', R: 'revoked' }

/** `%G?` `%GS` `%GK`; N (no signature) gives null. */
export function parseSignature(code: string, signer: string, key: string): CommitSignature | null {
  const status = SIG[code]
  return status ? { status, signer, key } : null
}

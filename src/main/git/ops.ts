import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
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
  LfsState,
  Submodule,
  SubmoduleMode,
  SubmoduleChange,
  OperationState,
  OpResult,
  PullMode,
  Refs,
  Status,
  Worktree
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
  parseStatus,
  parseWorktrees,
  submodulePointers
} from './parse'

/** Same folder? Windows paths ignore case and slash direction. */
export function samePath(a: string, b: string): boolean {
  const norm = (p: string): string => resolve(p).replace(/[\\/]+$/, '')
  return process.platform === 'win32' ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b)
}

export interface RepoCtx {
  id: string
  path: string
}

const MAX_DIFF_BYTES = 1_000_000
const MAX_DIFF_LINES = 20_000

/** Where undo safety refs live. Refs from before the renames (refs/mergatroid/, refs/gitclone/) are still hidden and pruned. */
export const UNDO_REFS = 'refs/caboose/undo/'
const OWN_REFS = ['refs/caboose/', 'refs/mergatroid/', 'refs/gitclone/']
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
  async tryGit(args: string[], opts: Partial<RunOptions> = {}): Promise<string | null> {
    try {
      return await this.git(args, opts)
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

  async lfsState(): Promise<LfsState> {
    const listed = (await this.tryGit(['ls-files', '-z', '--', ':(glob)**/.gitattributes'])) ?? ''
    const uses = listed
      .split('\0')
      .filter(Boolean)
      .some((f) => {
        try {
          return /\sfilter=lfs(\s|$)/m.test(readFileSync(join(this.repo.path, f), 'utf8'))
        } catch {
          return false // listed but deleted from the working copy
        }
      })
    // Asked even where LFS isn't used yet: the file menus offer to start tracking with it.
    const installed = (await this.tryGit(['lfs', 'version'], { plain: true })) !== null
    const on = installed && (!!(await this.tryGit(['config', '--get', 'filter.lfs.process']))?.trim() || !!(await this.tryGit(['config', '--get', 'filter.lfs.clean']))?.trim())
    return { uses, installed, on, patterns: this.lfsPatterns() }
  }

  /** The first field of each root .gitattributes line that sends files through LFS. */
  private lfsPatterns(): string[] {
    let text = ''
    try {
      text = readFileSync(join(this.repo.path, '.gitattributes'), 'utf8')
    } catch {
      return []
    }
    return text
      .split(/\r?\n/)
      .filter((l) => !l.trimStart().startsWith('#') && /\sfilter=lfs(\s|$)/.test(l))
      .map((l) => l.trim().split(/\s+/)[0])
  }

  /** `git lfs track`: a glob, or with `exact` one file by its name (git-lfs escapes it). Writes the root .gitattributes. */
  async lfsTrack(pattern: string, exact: boolean): Promise<void> {
    await this.mut(['lfs', 'track', ...(exact ? ['--filename'] : []), '--', this.safeLfsPattern(pattern)])
  }

  /**
   * Takes the rule out of the root .gitattributes by hand: `git lfs untrack` can't remove the escaped rules its own
   * `--filename` writes (a space becomes [[:space:]]). Other lines and the file's line endings stay as they were.
   */
  async lfsUntrack(pattern: string): Promise<void> {
    const file = join(this.repo.path, '.gitattributes')
    const text = readFileSync(file, 'utf8')
    const eol = text.includes('\r\n') ? '\r\n' : '\n'
    const lines = text.split(/\r?\n/)
    const kept = lines.filter((l) => !(l.trim().split(/\s+/)[0] === pattern && /\sfilter=lfs(\s|$)/.test(l)))
    if (kept.length === lines.length) throw invalid(`.gitattributes has no Git LFS rule “${pattern}”.`)
    writeFileSync(file, kept.join(eol))
  }

  private safeLfsPattern(p: string): string {
    if (!p || p.startsWith('-') || /[\0\r\n]/.test(p)) throw invalid(`Not a pattern Git LFS can track: ${p}`)
    return p
  }

  /**
   * The paths .gitattributes sends through Git LFS: the working copy's attributes, or a commit's (`source`).
   * Plain git reads the attributes, so this works whether or not git-lfs is installed.
   */
  async lfsPaths(paths: string[], source?: string): Promise<Set<string>> {
    const found = new Set<string>()
    if (!paths.length) return found
    const out = await this.tryGit(['check-attr', '-z', '--stdin', ...(source ? [`--source=${this.safeRev(source)}`] : []), 'filter'], {
      stdin: paths.join('\0') + '\0'
    })
    // -z: path NUL attribute NUL value NUL, for each path.
    const parts = (out ?? '').split('\0')
    for (let i = 0; i + 2 < parts.length; i += 3) if (parts[i + 2] === 'lfs') found.add(parts[i])
    return found
  }

  /** `git lfs install` (git's global config, and this repository's hooks), then the large files' content in place of their pointers. */
  async lfsTurnOn(opId: string, onProgress: RunOptions['onProgress']): Promise<void> {
    await this.mut(['lfs', 'install'], { opId })
    await this.mut(['lfs', 'pull'], { opId, onProgress, timeoutMs: 600_000 })
  }

  // ---------- submodules ----------

  /** `git config -z --get-regexp` output as [section.subsection, variable, value]; a submodule's name can hold dots. */
  private async configEntries(args: string[], pattern: string): Promise<Array<{ sub: string; key: string; value: string }>> {
    const out = (await this.tryGit(['config', '-z', ...args, '--get-regexp', pattern])) ?? ''
    return out
      .split('\0')
      .filter(Boolean)
      .map((e) => {
        const nl = e.indexOf('\n')
        const full = nl < 0 ? e : e.slice(0, nl)
        const first = full.indexOf('.')
        const last = full.lastIndexOf('.')
        return { sub: full.slice(first + 1, last), key: full.slice(last + 1), value: nl < 0 ? '' : e.slice(nl + 1) }
      })
  }

  /** Whether the index has any submodule, without reading anything else. */
  async hasSubmodules(): Promise<boolean> {
    return (await this.git(['ls-files', '-z', '-s'])).split('\0').some((e) => e.startsWith('160000 '))
  }

  /**
   * The submodules of the checked-out commit: .gitmodules as staged (else the file), the pointers in the index, this
   * repository's own config, and for each one that's set up, the commit and branch it's on. A few git calls in all,
   * plus one per submodule that's set up.
   */
  async submodules(): Promise<Submodule[]> {
    const links = new Map<string, string>()
    for (const e of (await this.git(['ls-files', '-z', '-s'])).split('\0')) if (e.startsWith('160000 ')) links.set(e.slice(e.indexOf('\t') + 1), e.split(' ')[1])
    if (!links.size) return []
    const staged = await this.tryGit(['cat-file', '-e', ':.gitmodules'])
    const declared = await this.configEntries(staged !== null ? ['--blob', ':.gitmodules'] : ['--file', join(this.repo.path, '.gitmodules')], '^submodule\\.')
    const local = await this.configEntries(['--local'], '^caboose-submodule\\.')
    const byName = new Map<string, { path?: string; url?: string }>()
    for (const d of declared) {
      const s = byName.get(d.sub) ?? {}
      if (d.key === 'path') s.path = d.value
      if (d.key === 'url') s.url = d.value
      byName.set(d.sub, s)
    }
    const nameOf = new Map([...byName].filter(([, s]) => s.path).map(([name, s]) => [s.path!, name]))
    const modes = new Map(local.filter((e) => e.key === 'mode').map((e) => [e.sub, e.value]))
    return Promise.all(
      [...links].sort(([a], [b]) => a.localeCompare(b)).map(async ([path, expected]): Promise<Submodule> => {
        const name = nameOf.get(path) ?? path
        const setUp = existsSync(join(this.repo.path, path, '.git'))
        const head = setUp ? (await this.tryGit(['-C', path, 'rev-parse', 'HEAD', '--abbrev-ref', 'HEAD']))?.split('\n') : undefined
        const mode = modes.get(name)
        return {
          name,
          path,
          url: byName.get(name)?.url ?? null,
          expected,
          setUp: !!head?.[0],
          current: head?.[0] || null,
          branch: head?.[1] && head[1] !== 'HEAD' ? head[1] : null,
          mode: mode === 'follow' || mode === 'manual' || mode === 'working' ? mode : null
        }
      })
    )
  }

  /**
   * Sets up submodules (all of them, or these paths) at the commits the repository expects. One submodule failing
   * doesn't stop the others; git reports them at the end.
   */
  async submoduleSetup(paths: string[] | 'all', o: { shallow: boolean; nested: boolean; jobs: number }, opId: string, onProgress: RunOptions['onProgress']): Promise<void> {
    // Not queued: it can take minutes, and it only writes inside the submodules' folders, .git/modules and .git/config.
    await this.git(
      ['submodule', 'update', '--init', '--progress', `--jobs=${o.jobs}`, ...(o.nested ? ['--recursive'] : []), ...(o.shallow ? ['--depth=1'] : []), '--', ...(paths === 'all' ? [] : this.safePaths(paths))],
      { opId, onProgress, timeoutMs: 3_600_000 }
    )
  }

  /** Refuses when a submodule has changes inside, so updating or removing it can't lose work. */
  private async submodulesClean(paths: string[]): Promise<void> {
    for (const p of paths) {
      if (!existsSync(join(this.repo.path, p, '.git'))) continue
      const out = await this.git(['-C', p, 'status', '--porcelain', '--ignore-submodules=none'])
      if (out.trim()) throw invalid(`${p} has changes inside. Commit or discard them there first.`)
    }
  }

  /** Moves set-up submodules to the commits the repository expects. */
  async submoduleUpdate(paths: string[], o: { nested: boolean; jobs: number }, opId: string, onProgress: RunOptions['onProgress']): Promise<void> {
    const safe = this.safePaths(paths)
    await this.submodulesClean(safe)
    await this.git(['submodule', 'update', '--progress', `--jobs=${o.jobs}`, ...(o.nested ? ['--recursive'] : []), '--', ...safe], { opId, onProgress, timeoutMs: 3_600_000 })
  }

  /** Empties submodules' folders (git keeps their data under .git/modules, so setting them up again is quick). */
  async submoduleRemove(paths: string[]): Promise<void> {
    const safe = this.safePaths(paths)
    await this.submodulesClean(safe)
    await this.mut(['submodule', 'deinit', '--', ...safe])
  }

  /** Submodule pointers that differ between two commits: moved, only in `to` (added), or only in `from` (removed). */
  private async pointerChanges(from: string, to: string): Promise<Array<{ path: string; from: string | null; to: string | null }>> {
    const out = (await this.tryGit(['diff', '--raw', '--no-abbrev', '-z', '--no-renames', '--ignore-submodules=none', this.safeRev(from), this.safeRev(to)])) ?? ''
    const parts = out.split('\0')
    const found: Array<{ path: string; from: string | null; to: string | null }> = []
    for (let i = 0; i + 1 < parts.length; i += 2) {
      const [srcMode, dstMode, src, dst] = parts[i].slice(1).split(' ')
      if (srcMode !== '160000' && dstMode !== '160000') continue
      found.push({ path: parts[i + 1], from: srcMode === '160000' ? src : null, to: dstMode === '160000' ? dst : null })
    }
    return found
  }

  /** Names (and modes) of submodules as a commit's .gitmodules has them. */
  private async namesAt(rev: string): Promise<Map<string, string>> {
    const declared = await this.configEntries(['--blob', `${this.safeRev(rev)}:.gitmodules`], '^submodule\\..*\\.path$')
    return new Map(declared.map((d) => [d.value, d.sub]))
  }

  private async dirty(path: string): Promise<boolean> {
    return !!(await this.tryGit(['-C', path, 'status', '--porcelain', '--ignore-submodules=none']))?.trim()
  }

  /**
   * After HEAD moved from one commit to another (checkout, pull, merge, rebase, reset, undo, or a terminal), brings
   * along only the submodules whose pointer changed, and only where it's safe:
   * - set up and exactly at the old pointer (in step before): Follow updates it; Working in it only when it's not on
   *   a branch; Manual never. With changes inside it's left alone. One the user moved elsewhere is left alone too.
   * - only in the new commit: set up again from git's own copy under .git/modules, if it was set up before (Follow).
   * - only in the old commit: its leftover folder is removed when it has no changes (tidy), as git leaves it behind.
   */
  async submoduleSync(
    from: string,
    to: string,
    o: { mode: SubmoduleMode; nested: boolean; jobs: number; tidy: boolean },
    opId: string,
    onProgress: RunOptions['onProgress']
  ): Promise<{ updated: string[]; restored: string[]; removed: string[]; skipped: Array<{ path: string; why: 'changes' | 'branch' }> }> {
    const r = { updated: [] as string[], restored: [] as string[], removed: [] as string[], skipped: [] as Array<{ path: string; why: 'changes' | 'branch' }> }
    // No submodule was ever set up here (git keeps each one's history under .git/modules): nothing to bring along.
    const modules = join(resolve(this.repo.path, (await this.git(['rev-parse', '--git-common-dir'])).trim()), 'modules')
    if (!existsSync(modules)) return r
    const changes = await this.pointerChanges(from, to)
    if (!changes.length) return r
    // What the index records now. After a soft reset (undoing a commit) HEAD moved but the newer pointer is still
    // staged: then the submodule stays with the index, not the commit.
    const staged = new Map<string, string>()
    for (const e of (await this.git(['ls-files', '-z', '-s'])).split('\0')) if (e.startsWith('160000 ')) staged.set(e.slice(e.indexOf('\t') + 1), e.split(' ')[1])
    const [namesTo, local] = await Promise.all([this.namesAt(to), this.configEntries(['--local'], '^caboose-submodule\\.')])
    const modeOf = (name: string): SubmoduleMode => {
      const m = local.find((e) => e.sub === name && e.key === 'mode')?.value
      return m === 'follow' || m === 'manual' || m === 'working' ? m : o.mode
    }
    for (const c of changes) {
      const setUp = existsSync(join(this.repo.path, c.path, '.git'))
      if (c.to && staged.get(c.path) !== c.to) continue
      if (c.from && c.to) {
        if (!setUp) continue
        const head = (await this.tryGit(['-C', c.path, 'rev-parse', 'HEAD', '--abbrev-ref', 'HEAD']))?.split('\n')
        if (!head?.[0] || head[0] !== c.from) continue // already there, or moved by the user
        const mode = modeOf(namesTo.get(c.path) ?? c.path)
        if (mode === 'manual') continue
        if (await this.dirty(c.path)) r.skipped.push({ path: c.path, why: 'changes' })
        else if (mode === 'working' && head[1] && head[1] !== 'HEAD') r.skipped.push({ path: c.path, why: 'branch' })
        else r.updated.push(c.path)
      } else if (c.to) {
        const name = namesTo.get(c.path) ?? c.path
        if (!setUp && existsSync(join(modules, name)) && modeOf(name) === 'follow') r.restored.push(c.path)
      } else if (o.tidy && setUp) {
        // Gone from this commit: git left the folder. Its history stays under .git/modules, so only changes could be lost.
        const tracked = (await this.git(['ls-files', '-z', '--', c.path])).length > 0
        if (tracked) continue
        if (await this.dirty(c.path)) r.skipped.push({ path: c.path, why: 'changes' })
        else {
          rmSync(join(this.repo.path, this.safePath(c.path)), { recursive: true, force: true })
          r.removed.push(c.path)
        }
      }
    }
    const move = [...r.updated, ...r.restored]
    if (move.length) {
      await this.git(['submodule', 'update', '--init', '--progress', `--jobs=${o.jobs}`, ...(o.nested ? ['--recursive'] : []), '--', ...this.safePaths(move)], {
        opId,
        onProgress,
        timeoutMs: 3_600_000
      })
    }
    return r
  }

  /** Before switching to `to`: set-up submodules with changes inside that the switch would move or take away. */
  async submodulesAtRisk(to: string): Promise<string[]> {
    const head = await this.headSha()
    if (!head || !existsSync(join(resolve(this.repo.path, (await this.git(['rev-parse', '--git-common-dir'])).trim()), 'modules'))) return []
    const at: string[] = []
    for (const c of await this.pointerChanges(head, to)) {
      if (existsSync(join(this.repo.path, c.path, '.git')) && (await this.dirty(c.path))) at.push(c.path)
    }
    return at
  }

  /**
   * Before pushing `branch`: submodules whose pointer, in the commits about to go out, names commits that aren't on
   * any of the submodule's remotes, so nobody else could get them. Only submodules set up here can be checked.
   * `canPush`: it's on a branch with an upstream that holds the commit, so a plain push in it sends it.
   */
  async submodulesUnpushed(branch: string | null): Promise<Array<{ path: string; count: number; canPush: boolean }>> {
    const b = branch ? this.safeRev(branch) : (await this.status()).branch
    if (!b) return []
    const upstream = (await this.tryGit(['rev-parse', '--abbrev-ref', `${b}@{upstream}`]))?.trim()
    const range = upstream ? [`${upstream}..${b}`] : [b, '--not', '--remotes']
    // Newest first: the first pointer seen for a path is the one this push leaves it at.
    const out = (await this.tryGit(['log', '--format=', '--raw', '--no-abbrev', '-z', '--no-renames', ...range, '--'])) ?? ''
    const newest = new Map<string, string>()
    const parts = out.split('\0')
    for (let i = 0; i + 1 < parts.length; i++) {
      const meta = parts[i].replace(/^\n+/, '')
      if (!meta.startsWith(':')) continue
      const [, dstMode, , dst] = meta.slice(1).split(' ')
      const path = parts[++i]
      if (dstMode === '160000' && !newest.has(path)) newest.set(path, dst)
    }
    const found: Array<{ path: string; count: number; canPush: boolean }> = []
    for (const [path, sha] of newest) {
      if (!existsSync(join(this.repo.path, path, '.git')) || (await this.tryGit(['-C', path, 'cat-file', '-e', `${sha}^{commit}`])) === null) continue
      const count = Number((await this.tryGit(['-C', path, 'rev-list', '--count', sha, '--not', '--remotes']))?.trim() ?? 0)
      if (!count) continue
      const onBranch = (await this.tryGit(['-C', path, 'rev-parse', '--abbrev-ref', 'HEAD']))?.trim()
      const tracks = onBranch && onBranch !== 'HEAD' ? await this.tryGit(['-C', path, 'rev-parse', '--abbrev-ref', '@{upstream}']) : null
      const holds = tracks ? (await this.tryGit(['-C', path, 'merge-base', '--is-ancestor', sha, 'HEAD'])) !== null : false
      found.push({ path, count, canPush: holds })
    }
    return found
  }

  /** `git push` inside a submodule, to its branch's upstream. */
  async submodulePush(path: string, opId: string, onProgress: RunOptions['onProgress']): Promise<void> {
    await this.mut(['-C', this.safePath(path), 'push', '--progress'], { opId, onProgress, timeoutMs: 300_000 })
  }

  /** The repository this one is a submodule of, or null. */
  async superproject(): Promise<string | null> {
    return (await this.tryGit(['rev-parse', '--show-superproject-working-tree']))?.trim() || null
  }

  // ---------- worktrees ----------

  /** Every working tree of this repository, the main one first. Bare entries can't be opened, so they're left out. */
  async worktrees(): Promise<Worktree[]> {
    const out = (await this.tryGit(['worktree', 'list', '--porcelain', '-z'])) ?? ''
    return parseWorktrees(out)
      .filter((w) => !w.bare)
      // git writes C:/x on Windows; paths read as the system writes them.
      .map(({ bare: _bare, ...w }) => ({ ...w, path: resolve(w.path), current: samePath(w.path, this.repo.path) }))
  }

  /** A path from the renderer must be one of this repository's worktrees (never the one this tab shows, nor the main one, for removal). */
  private async knownWorktree(path: string): Promise<Worktree> {
    const w = (await this.worktrees()).find((x) => samePath(x.path, path))
    if (!w) throw invalid(`${path} isn’t a worktree of this repository.`)
    return w
  }

  /** git worktree add: an existing branch, a new branch from `at`, or `at` detached. Not queued: it can take a while, and it only writes the new folder and its own corner of .git. */
  async worktreeAdd(input: { path: string; branch?: string; newBranch?: string; at?: string; track?: boolean }, opId: string): Promise<string> {
    const path = resolve(input.path)
    if (!isAbsolute(input.path)) throw invalid('Choose a full folder path for the worktree.')
    if (existsSync(path) && readdirSync(path).length) throw invalid(`${path} already exists and isn’t empty. Choose another folder.`)
    const args = ['worktree', 'add']
    if (input.newBranch) {
      await this.safeBranchName(input.newBranch)
      args.push(...(input.track ? ['--track'] : []), '-b', input.newBranch, path, this.safeRev(input.at ?? 'HEAD'))
    } else if (input.branch) args.push(path, this.safeRev(input.branch))
    else args.push('--detach', path, this.safeRev(input.at ?? 'HEAD'))
    await this.git(args, { opId, timeoutMs: 1_800_000 })
    return path
  }

  /** Without force, a worktree with uncommitted changes (untracked files included) stays, and the answer says so. */
  async worktreeRemove(path: string, force: boolean, beforeRemove: (path: string) => void): Promise<{ removed: boolean; dirty: boolean }> {
    const w = await this.knownWorktree(path)
    if (w.main) throw invalid('The main worktree holds the repository itself, so it can’t be removed.')
    if (w.current) throw invalid('That’s the worktree this tab shows. Remove it from another tab.')
    if (!w.missing && !force && ((await this.tryGit(['-C', w.path, 'status', '--porcelain'])) ?? '').trim()) return { removed: false, dirty: true }
    beforeRemove(w.path)
    // A locked worktree needs two --force; asking to remove it is taken as meaning it.
    await this.mut(['worktree', 'remove', ...(force || w.locked !== null ? ['--force'] : []), ...(w.locked !== null ? ['--force'] : []), w.path])
    return { removed: true, dirty: false }
  }

  async worktreeLock(path: string, locked: boolean): Promise<void> {
    const w = await this.knownWorktree(path)
    if (w.main) throw invalid('The main worktree can’t be locked.')
    await this.mut(['worktree', locked ? 'lock' : 'unlock', w.path])
  }

  /** Forgets worktrees whose folders are gone (locked ones stay). */
  async worktreePrune(): Promise<void> {
    await this.mut(['worktree', 'prune'])
  }

  /** "<repo>-<branch>" next to the main worktree, with a number added if that's taken. */
  async worktreeSuggestPath(branch: string): Promise<string> {
    const main = (await this.worktrees()).find((w) => w.main)?.path ?? this.repo.path
    const base = `${resolve(main)}-${branch.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '') || 'worktree'}`
    let p = base
    for (let i = 2; existsSync(p); i++) p = `${base}-${i}`
    return p
  }

  /** A submodule's mode in this repository's .git/config; null goes back to the repository's default. */
  async submoduleSetMode(names: string[], mode: SubmoduleMode | null): Promise<void> {
    for (const n of names) {
      if (!n || /[\0\r\n"\\]/.test(n)) throw invalid(`Not a submodule name: ${n}`)
      if (mode) await this.mut(['config', '--local', `caboose-submodule.${n}.mode`, mode])
      else await this.tryGit(['config', '--local', '--unset', `caboose-submodule.${n}.mode`])
    }
  }

  /** git's submodule.fetchJobs, which `git submodule update` also uses. */
  async submoduleJobs(): Promise<number | null> {
    const v = Number((await this.tryGit(['config', '--local', '--get', 'submodule.fetchJobs']))?.trim())
    return Number.isInteger(v) && v > 0 ? v : null
  }

  async setSubmoduleJobs(n: number): Promise<void> {
    await this.mut(['config', '--local', 'submodule.fetchJobs', String(n)])
  }

  async headSha(): Promise<string | null> {
    return (await this.tryGit(['rev-parse', '-q', '--verify', 'HEAD^{commit}']))?.trim() || null
  }

  async graph(skip: number, limit: number, stashes: Refs['stashes'], view: RefViewState = { hidden: [], soloed: [], pinned: null }): Promise<GraphPage> {
    // Soloed branches replace "everything"; hidden ones are left out of it. HEAD always shows.
    // A remote's HEAD (origin/HEAD) is only an alias for one of its branches, so it never brings commits in itself:
    // otherwise hiding that branch would leave all its commits on screen. Likewise, while anything is hidden, tags
    // only label commits that shown branches bring in; a tag on a hidden branch's commit would keep it in view.
    // Those refs go to git on stdin, not the command line: hundreds of them would pass Windows' limit of about
    // 32,000 characters per command line, and git wouldn't start at all (an empty graph).
    const revs = view.soloed.length ? [...view.soloed, 'HEAD'] : view.hidden.length ? [...(await this.shownRefs(view.hidden)), 'HEAD'] : null
    const which = revs ? ['--stdin'] : [...EXCLUDE_OWN, '--exclude=refs/stash', '--exclude=refs/remotes/*/HEAD', '--all']
    const out = await this.tryGit(['log', '--topo-order', `--format=${LOG_FORMAT}`, ...which, `--skip=${skip}`, `--max-count=${limit + 1}`, '--'], {
      stdin: revs ? `${revs.join('\n')}\n` : undefined
    })
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

  /** Local and remote branches that aren't hidden, leaving out remotes' HEAD aliases. */
  private async shownRefs(hidden: string[]): Promise<string[]> {
    const skip = new Set(hidden)
    const out = await this.git(['for-each-ref', '--format=%(refname) %(symref)', 'refs/heads', 'refs/remotes'])
    return out
      .split('\n')
      .map((line) => line.split(' '))
      .filter(([name, symref]) => name && !symref && !skip.has(name))
      .map(([name]) => name)
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
      refs: parseRefs(refsOut, remotes).map((r) => (r.worktree ? { ...r, worktree: resolve(r.worktree) } : r)),
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
    const s = parseStatus(out)
    const lfs = await this.lfsPaths(s.changes.map((c) => c.path))
    return { ...s, changes: lfs.size ? s.changes.map((c) => (lfs.has(c.path) ? { ...c, lfs: true } : c)) : s.changes, op }
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
    const files = parseNameStatus(filesOut)
    const lfs = await this.lfsPaths(files.map((f) => f.path), full)
    return {
      sha: full,
      parents: parentList,
      author: { name: an, email: ae, time: Number(at), offset: ai.slice(-5) },
      committer: { name: cn, email: ce, time: Number(ct) },
      summary,
      body: rest.join('\n').trim(),
      coAuthors: parseCoAuthors(message),
      files: lfs.size ? files.map((f) => (lfs.has(f.path) ? { ...f, lfs: true } : f)) : files,
      isHead: full === head,
      signature: parseSignature(sig, signer, sigKey)
    }
  }

  async diff(rawPath: string, rawOld: string | undefined, source: DiffSource, force = false, full = false, ignoreWs = false): Promise<FileDiff> {
    const path = this.safePath(rawPath)
    const old = rawOld ? this.safePath(rawOld) : undefined
    const specs = old && old !== path ? ['--', old, path] : ['--', path]
    // --submodule=short whatever diff.submodule says: a submodule's diff is then its two commits, read below.
    const base = ['--no-color', '--no-ext-diff', '--submodule=short', '-M', '--src-prefix=a/', '--dst-prefix=b/', ...(full ? ['--unified=1000000'] : []), ...(ignoreWs ? ['-w'] : [])]
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
    const pointers = submodulePointers(d.hunks)
    if (pointers) d.submodule = await this.submoduleChange(path, pointers)
    return d
  }

  /**
   * What a submodule's pointer moving means, from the submodule's own history: forward or back, and the commits in
   * between. Only possible where it's set up and has both commits.
   */
  async submoduleChange(path: string, p: { old: string | null; new: string | null; dirty: boolean }): Promise<SubmoduleChange> {
    const none = { ...p, ahead: 0, behind: 0, commits: [] }
    if (!p.old) return { ...none, direction: 'added' }
    if (!p.new) return { ...none, direction: 'removed' }
    if (p.old === p.new) return { ...none, direction: 'same' }
    if (!/^[0-9a-f]+$/.test(p.old + p.new)) return { ...none, direction: 'unknown' }
    if (!existsSync(join(this.repo.path, path, '.git'))) return { ...none, direction: 'unknown', reason: 'not set up' }
    const counts = await this.tryGit(['-C', path, 'rev-list', '--left-right', '--count', `${p.old}...${p.new}`])
    if (!counts) return { ...none, direction: 'unknown', reason: 'missing commits' }
    // Left: only in old (what moving to new leaves behind); right: only in new.
    const [behind, ahead] = counts.trim().split(/\s+/).map(Number)
    const direction = ahead && !behind ? 'forward' : behind && !ahead ? 'back' : 'diverged'
    const range = direction === 'back' ? `${p.new}..${p.old}` : `${p.old}..${p.new}`
    const log = (await this.tryGit(['-C', path, 'log', '-n', '50', '--format=%H%x1f%s%x1f%an', range])) ?? ''
    const commits = log
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        const [sha, summary, author] = l.split('\x1f')
        return { sha, summary, author }
      })
    return { ...p, direction, ahead, behind, commits }
  }

  /** Staged submodule pointers that would move back if committed now (only where the submodule is set up here). */
  async submodulesGoingBack(): Promise<Array<{ path: string; behind: number }>> {
    const out = (await this.tryGit(['diff', '--cached', '--raw', '--no-abbrev', '-z', '--no-renames', 'HEAD'])) ?? ''
    const parts = out.split('\0')
    const found: Array<{ path: string; behind: number }> = []
    for (let i = 0; i + 1 < parts.length; i += 2) {
      const [srcMode, dstMode, from, to] = parts[i].slice(1).split(' ')
      if (srcMode !== '160000' || dstMode !== '160000') continue
      const c = await this.submoduleChange(parts[i + 1], { old: from, new: to, dirty: false })
      if (c.direction === 'back') found.push({ path: parts[i + 1], behind: c.behind })
    }
    return found
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
    await this.mut(['stash', 'push', '--include-untracked', '-q', '-m', 'Caboose: discarded changes', ...spec])
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

  /** Deletes several branches on `remote` in one push. */
  async deleteRemoteBranches(remote: string, names: string[], opId: string): Promise<void> {
    this.safeRev(remote)
    for (const n of names) this.safeRev(n)
    await this.mut(['push', remote, '--delete', ...names.map((n) => `refs/heads/${n}`)], { opId, timeoutMs: 300_000 })
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

  async pull(mode: PullMode, opId: string, onProgress: RunOptions['onProgress'], autostash = false): Promise<OpResult> {
    const flag = mode === 'ff' ? ['--ff', '--no-rebase', '--no-edit'] : mode === 'ff-only' ? ['--ff-only'] : ['--rebase']
    try {
      const out = await this.mut(['pull', '--progress', ...flag, ...(autostash ? ['--autostash'] : [])], { opId, onProgress, timeoutMs: 300_000 })
      if (/autostash resulted in conflicts/i.test(out)) {
        return { result: 'ok', message: 'Your changes came back with conflicts. Sort them out in the files; they’re also kept in a stash.' }
      }
      if (/Already up to date/i.test(out)) return { result: 'nothing', message: 'Already up to date.' }
      return { result: 'ok' }
    } catch (e) {
      if (e instanceof GcFail && /would be overwritten by (merge|checkout)|cannot pull with rebase|commit your changes or stash them|You have unstaged changes/i.test(e.detail ?? '')) {
        // git lists the files it would overwrite, one per line, indented with a tab.
        const files = [...(e.detail ?? '').matchAll(/^\t(.+)$/gm)].map((m) => m[1].trim())
        const what = files.length ? (files.length > 5 ? `${files.slice(0, 5).join(', ')} and ${files.length - 5} more` : files.join(', ')) : 'Some files'
        return { result: 'dirty', message: `${what} ${files.length === 1 ? 'has' : 'have'} uncommitted changes the pull would overwrite.` }
      }
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

  /**
   * Moves local branch `name` forward to `to` (default: its upstream), without checking it out; with `fetch`, gets
   * that remote branch first. Refuses anything but a fast-forward. The checked-out branch moves with merge --ff-only
   * (so its files follow); one checked out in another worktree is left for that worktree.
   */
  async fastForward(name: string, opts: { to?: string; fetch: boolean; create?: boolean; opId: string }, onProgress: RunOptions['onProgress']): Promise<OpResult> {
    this.safeRev(name)
    const target = opts.to ? this.safeRev(opts.to) : (await this.tryGit(['rev-parse', '--abbrev-ref', `${name}@{upstream}`]))?.trim()
    if (!target) throw invalid(`${name} doesn’t track a remote branch. Set its upstream first.`)
    if (opts.fetch) {
      const { remotes } = await this.refs()
      const remote = remotes.find((r) => target.startsWith(`${r}/`))
      if (remote) {
        const branch = target.slice(remote.length + 1)
        await this.mut(['fetch', '--progress', remote, `+refs/heads/${branch}:refs/remotes/${remote}/${branch}`], { opId: opts.opId, onProgress, timeoutMs: 300_000 })
      }
    }
    const next = (await this.git(['rev-parse', '--verify', `${target}^{commit}`])).trim()
    const cur = (await this.tryGit(['rev-parse', '-q', '--verify', `refs/heads/${name}`]))?.trim()
    if (!cur) {
      if (!opts.create) throw invalid(`There’s no local branch ${name}.`)
      await this.safeBranchName(name)
      await this.mut(['branch', '--track', name, target])
      return { result: 'ok', message: `Created ${name}, tracking ${target}` }
    }
    if (cur === next) return { result: 'nothing', message: `${name} is already up to date with ${target}.` }
    if ((await this.tryGit(['merge-base', '--is-ancestor', cur, next])) === null) {
      const ahead = Number((await this.git(['rev-list', '--count', `${next}..${cur}`])).trim())
      return { result: 'rejected', ahead, message: `Can’t fast-forward ${name}: it has commits that ${target} doesn’t. Check it out to merge or rebase.` }
    }
    const here = await this.status()
    if (here.branch === name) {
      await this.mut(['merge', '--ff-only', '-q', next])
    } else {
      const elsewhere = (await this.worktrees()).find((w) => w.branch === name)
      if (elsewhere) return { result: 'rejected', message: `${name} is checked out in the worktree ${elsewhere.path}. Pull it there.` }
      await this.mut(['update-ref', '-m', `fast-forward to ${target}`, `refs/heads/${name}`, next, cur])
    }
    return { result: 'ok', message: `Fast-forwarded ${name} to ${target}` }
  }

  /** Points local branch `name`, which isn't checked out anywhere, at `to`. Returns where it was and where it is now. */
  async moveBranch(name: string, to: string): Promise<{ from: string; to: string }> {
    this.safeRev(name)
    this.safeRev(to)
    const from = (await this.git(['rev-parse', '--verify', `refs/heads/${name}`])).trim()
    const next = (await this.git(['rev-parse', '--verify', `${to}^{commit}`])).trim()
    if ((await this.status()).branch === name) throw invalid(`${name} is checked out: reset it instead.`)
    const elsewhere = (await this.worktrees()).find((w) => w.branch === name)
    if (elsewhere) throw invalid(`${name} is checked out in the worktree ${elsewhere.path}. Reset it there.`)
    if (from !== next) await this.mut(['update-ref', '-m', `reset: moving to ${to}`, `refs/heads/${name}`, next, from])
    return { from, to: next }
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
    const dir = mkdtempSync(join(tmpdir(), 'caboose-merge-'))
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

  /** The root .gitignore, or null when there isn't one. */
  readGitignore(): string | null {
    const file = join(this.repo.path, '.gitignore')
    return existsSync(file) ? readFileSync(file, 'utf8') : null
  }

  writeGitignore(text: string | null): void {
    const file = join(this.repo.path, '.gitignore')
    if (text === null) rmSync(file, { force: true })
    else writeFileSync(file, text)
  }

  /** Tracked files that the ignore rules cover (files someone added on purpose, or that are about to stop being tracked). */
  private async trackedIgnored(): Promise<Set<string>> {
    return new Set((await this.git(['ls-files', '-z', '-c', '-i', '--exclude-standard'])).split('\0').filter(Boolean))
  }

  /** Stops tracking these files (they stay on disk), whatever is staged for them. */
  async untrack(paths: string[]): Promise<void> {
    if (!paths.length) return
    const spec = this.safePaths(paths).map((p) => `:(literal)${p}\0`).join('')
    await this.mut(['rm', '--cached', '-f', '-q', '--ignore-unmatch', '--pathspec-from-file=-', '--pathspec-file-nul'], { stdin: spec })
  }

  /** Index entries for these paths, as `git update-index --index-info` reads them back. */
  async indexEntries(paths: string[]): Promise<string> {
    const want = new Set(paths)
    return (await this.git(['ls-files', '-z', '-s']))
      .split('\0')
      .filter((e) => want.has(e.slice(e.indexOf('\t') + 1)))
      .map((e) => `${e}\0`)
      .join('')
  }

  /** Puts back index entries saved by indexEntries, skipping any path that's tracked again. */
  async restoreIndex(entries: string): Promise<void> {
    const tracked = new Set((await this.git(['ls-files', '-z'])).split('\0'))
    const back = entries.split('\0').filter((e) => e && !tracked.has(e.slice(e.indexOf('\t') + 1)))
    if (back.length) await this.mut(['update-index', '-z', '--index-info'], { stdin: back.map((e) => `${e}\0`).join('') })
  }

  /**
   * Adds lines to the root .gitignore, then stops tracking the tracked files they now cover: without that,
   * .gitignore doesn't apply to them. Returns what an undo needs to put both back.
   */
  async ignore(patterns: string[]): Promise<{ before: string | null; after: string; untracked: string[]; index: string }> {
    const lines = patterns.map((p) => p.trim())
    if (!lines.length || lines.some((p) => !p || /[\r\n\0]/.test(p))) throw invalid('Enter one pattern per line.')
    const before = this.readGitignore()
    const cur = before ?? ''
    const have = new Set(cur.split(/\r?\n/))
    const add = [...new Set(lines)].filter((p) => !have.has(p))
    if (!add.length) throw invalid(lines.length === 1 ? `.gitignore already has “${lines[0]}”.` : '.gitignore already has those lines.')
    const eol = cur.includes('\r\n') ? '\r\n' : '\n'
    const after = cur + (cur && !cur.endsWith('\n') ? eol : '') + add.map((p) => p + eol).join('')
    const already = await this.trackedIgnored()
    this.writeGitignore(after)
    const untracked = [...(await this.trackedIgnored())].filter((p) => !already.has(p))
    const index = await this.indexEntries(untracked)
    await this.untrack(untracked)
    return { before, after, untracked, index }
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

  /** Pushes several tags in one go, or deletes them on `remote` (`del`). */
  async pushTags(names: string[], remote: string, opId: string, del: boolean): Promise<void> {
    this.safeRev(remote)
    const specs = names.map((n) => `refs/tags/${this.safeRev(n)}`)
    await this.mut(del ? ['push', remote, '--delete', ...specs] : ['push', remote, ...specs], { opId, timeoutMs: 300_000 })
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
    const out = await this.git(['for-each-ref', '--format=%(refname) %(objectname)', UNDO_REFS, 'refs/mergatroid/undo/', 'refs/gitclone/undo/'])
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

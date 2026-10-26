import { existsSync, mkdirSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import type { RepoList, RepoSummary } from '../shared/types'
import type { Db } from './db'
import { activeProfileId, now, uuid } from './db'
import { GcFail, invalid } from './errors'
import { RepoOps } from './git/ops'
import type { GitRunner, RunOptions } from './git/runner'
import { gitignoreTemplates, licenseText } from './templates'

interface Row {
  id: string
  path: string
  alias: string | null
  is_favorite: number
  is_open: number
  tab_order: number | null
  last_opened_at: number | null
  group_id: string | null
}

function pathKey(p: string): string {
  let real = resolve(p)
  try {
    real = realpathSync.native(real)
  } catch {
    // missing folder: keep the resolved path
  }
  real = real.replace(/[\\/]+$/, '')
  return process.platform === 'win32' || process.platform === 'darwin' ? real.toLowerCase() : real
}

function toSummary(r: Row): RepoSummary {
  return {
    id: r.id,
    path: r.path,
    name: basename(r.path),
    alias: r.alias,
    isFavorite: r.is_favorite === 1,
    isOpen: r.is_open === 1,
    tabOrder: r.tab_order,
    lastOpenedAt: r.last_opened_at,
    missing: !existsSync(join(r.path, '.git')),
    groupId: r.group_id
  }
}

/** The list of known repositories (tabs, recents, favourites) and the RepoOps for each open one. */
export class Repos {
  private ops = new Map<string, RepoOps>()

  constructor(
    private db: Db,
    private runner: GitRunner,
    private onOpen: (repo: RepoSummary) => void,
    private onClose: (repoId: string) => void
  ) {}

  get(repoId: string): RepoOps {
    const cached = this.ops.get(repoId)
    if (cached) return cached
    const row = this.db.prepare('SELECT * FROM repositories WHERE id = ?').get(repoId) as Row | undefined
    if (!row) throw invalid('That repository isn’t open.')
    if (!existsSync(row.path)) throw new GcFail('not_repo', `The folder ${row.path} no longer exists.`)
    const ops = new RepoOps(this.runner, { id: row.id, path: row.path })
    this.ops.set(repoId, ops)
    return ops
  }

  list(): RepoList {
    const profile = activeProfileId(this.db)
    const rows = this.db.prepare('SELECT * FROM repositories WHERE profile_id = ?').all(profile) as unknown as Row[]
    const all = rows.map(toSummary)
    return {
      open: all.filter((r) => r.isOpen).sort((a, b) => (a.tabOrder ?? 0) - (b.tabOrder ?? 0)),
      recent: all
        .filter((r) => r.lastOpenedAt)
        .sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0))
        .slice(0, 20),
      favorites: all.filter((r) => r.isFavorite).sort((a, b) => a.name.localeCompare(b.name)),
      groups: (this.db.prepare('SELECT id, name FROM repo_groups WHERE profile_id = ? ORDER BY sort_order, name').all(profile) as Array<{ id: string; name: string }>).map((g) => ({
        ...g,
        repos: all.filter((r) => r.groupId === g.id).sort((a, b) => a.name.localeCompare(b.name))
      }))
    }
  }

  // ---------- groups (folders of repositories on the home screen) ----------

  private groupName(name: string, except?: string): string {
    const n = name.trim()
    if (!n || n.length > 80) throw invalid('Give the group a name (up to 80 characters).')
    const clash = this.db.prepare('SELECT id FROM repo_groups WHERE profile_id = ? AND name = ? AND id != ?').get(activeProfileId(this.db), n, except ?? '')
    if (clash) throw invalid(`There’s already a group called “${n}”.`)
    return n
  }

  createGroup(name: string): { id: string } {
    const profile = activeProfileId(this.db)
    const n = this.groupName(name)
    const id = uuid()
    const t = now()
    const { m } = this.db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS m FROM repo_groups WHERE profile_id = ?').get(profile) as { m: number }
    this.db.prepare('INSERT INTO repo_groups (id, profile_id, name, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, profile, n, m, t, t)
    return { id }
  }

  renameGroup(groupId: string, name: string): void {
    this.db.prepare('UPDATE repo_groups SET name = ?, updated_at = ? WHERE id = ?').run(this.groupName(name, groupId), now(), groupId)
  }

  /** Repositories in it go back to ungrouped (on delete set null). */
  deleteGroup(groupId: string): void {
    this.db.prepare('DELETE FROM repo_groups WHERE id = ?').run(groupId)
  }

  async open(path: string): Promise<RepoSummary> {
    const abs = resolve(path)
    if (!existsSync(abs)) throw new GcFail('not_repo', `The folder ${abs} doesn’t exist.`)
    let top: string
    try {
      top = (await this.runner.run({ cwd: abs, args: ['rev-parse', '--show-toplevel'] })).stdout.trim()
    } catch {
      throw new GcFail('not_repo', `${abs} isn’t a Git repository. Choose a folder that contains a .git folder, or start a new repository there.`)
    }
    const root = resolve(top)
    const profile = activeProfileId(this.db)
    const key = pathKey(root)
    const existing = this.db.prepare('SELECT * FROM repositories WHERE profile_id = ? AND path_key = ?').get(profile, key) as Row | undefined
    const t = now()
    const nextTab = (this.db.prepare('SELECT COALESCE(MAX(tab_order), -1) + 1 AS n FROM repositories WHERE profile_id = ? AND is_open = 1').get(profile) as { n: number }).n
    let id: string
    if (existing) {
      id = existing.id
      this.db
        .prepare('UPDATE repositories SET path = ?, is_open = 1, tab_order = COALESCE(CASE WHEN is_open = 1 THEN tab_order END, ?), last_opened_at = ?, updated_at = ? WHERE id = ?')
        .run(root, nextTab, t, t, id)
    } else {
      id = uuid()
      this.db
        .prepare('INSERT INTO repositories (id, profile_id, path, path_key, is_open, tab_order, last_opened_at, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)')
        .run(id, profile, root, key, nextTab, t, t, t)
    }
    const summary = toSummary(this.db.prepare('SELECT * FROM repositories WHERE id = ?').get(id) as unknown as Row)
    this.ops.delete(id)
    this.onOpen(summary)
    return summary
  }

  /** The open tab showing this folder, if any. */
  openAt(path: string): string | null {
    const row = this.db.prepare('SELECT id FROM repositories WHERE profile_id = ? AND path_key = ? AND is_open = 1').get(activeProfileId(this.db), pathKey(path)) as { id: string } | undefined
    return row?.id ?? null
  }

  close(repoId: string): void {
    this.db.prepare('UPDATE repositories SET is_open = 0, tab_order = NULL, updated_at = ? WHERE id = ?').run(now(), repoId)
    this.ops.delete(repoId)
    this.onClose(repoId)
  }

  reorder(repoIds: string[]): void {
    const stmt = this.db.prepare('UPDATE repositories SET tab_order = ?, updated_at = ? WHERE id = ? AND is_open = 1')
    repoIds.forEach((id, i) => stmt.run(i, now(), id))
  }

  update(repoId: string, patch: { alias?: string | null; isFavorite?: boolean; groupId?: string | null }): RepoSummary {
    if (patch.groupId !== undefined) {
      if (patch.groupId && !this.db.prepare('SELECT id FROM repo_groups WHERE id = ?').get(patch.groupId)) throw invalid('That group no longer exists.')
      this.db.prepare('UPDATE repositories SET group_id = ?, updated_at = ? WHERE id = ?').run(patch.groupId, now(), repoId)
    }
    if (patch.alias !== undefined) {
      const alias = patch.alias?.trim() || null
      this.db.prepare('UPDATE repositories SET alias = ?, updated_at = ? WHERE id = ?').run(alias, now(), repoId)
    }
    if (patch.isFavorite !== undefined) {
      this.db.prepare('UPDATE repositories SET is_favorite = ?, updated_at = ? WHERE id = ?').run(patch.isFavorite ? 1 : 0, now(), repoId)
    }
    const row = this.db.prepare('SELECT * FROM repositories WHERE id = ?').get(repoId) as Row | undefined
    if (!row) throw invalid('Unknown repository.')
    return toSummary(row)
  }

  forget(repoId: string): void {
    this.close(repoId)
    this.db.prepare('DELETE FROM repositories WHERE id = ?').run(repoId)
  }

  async clone(
    input: { url: string; dest: string; opId: string; depth?: number; branch?: string; sparse?: string[] },
    onProgress: RunOptions['onProgress']
  ): Promise<RepoSummary> {
    const url = input.url.trim()
    if (!url || url.startsWith('-')) throw invalid('Enter the repository’s URL.')
    const dest = resolve(input.dest)
    if (existsSync(dest) && readdirSync(dest).length > 0) {
      throw invalid(`${dest} already exists and isn’t empty. Pick another folder or name.`)
    }
    mkdirSync(dirname(dest), { recursive: true })
    const args = ['clone', '--progress']
    if (input.depth) args.push('--depth', String(input.depth))
    if (input.branch) args.push('--branch', input.branch)
    // Sparse: only the chosen top-level folders get checked out; file contents download on demand.
    const folders = (input.sparse ?? []).map((f) => f.trim().replace(/^\/+|\/+$/g, '')).filter(Boolean)
    for (const f of folders) if (f.startsWith('-') || f.split('/').includes('..')) throw invalid(`“${f}” isn’t a folder inside the repository.`)
    if (folders.length) args.push('--filter=blob:none', '--sparse')
    args.push('--', url, dest)
    await this.runner.run({ cwd: dirname(dest), args, opId: input.opId, onProgress, timeoutMs: 30 * 60_000 })
    if (folders.length) await this.runner.run({ cwd: dest, args: ['sparse-checkout', 'set', '--cone', '--', ...folders], opId: input.opId, onProgress, timeoutMs: 30 * 60_000 })
    return this.open(dest)
  }

  async init(input: { parentDir: string; name: string; defaultBranch: string; gitignore: string | null; license: string | null }): Promise<RepoSummary> {
    const name = input.name.trim()
    if (!name || /[<>:"|?*\\/]/.test(name) || name.startsWith('.')) throw invalid('Use a folder name without slashes or special characters.')
    const dest = join(resolve(input.parentDir), name)
    if (existsSync(join(dest, '.git'))) throw invalid(`${dest} is already a Git repository. Open it instead.`)
    if (existsSync(dest) && readdirSync(dest).length > 0) throw invalid(`${dest} already has files in it. Pick an empty or new folder.`)
    mkdirSync(dest, { recursive: true })
    const run = (args: string[]): Promise<unknown> => this.runner.run({ cwd: dest, args, mutating: false })
    const branch = input.defaultBranch.trim() || 'main'
    await run(['init', '-q', '-b', branch])
    writeFileSync(join(dest, 'README.md'), `# ${name}\n`)
    if (input.gitignore && gitignoreTemplates[input.gitignore]) writeFileSync(join(dest, '.gitignore'), gitignoreTemplates[input.gitignore])
    if (input.license) {
      const who = (await this.runner.run({ cwd: dest, args: ['config', 'user.name'], okCodes: [1] })).stdout.trim() || 'The authors'
      const text = licenseText(input.license, who, new Date().getFullYear())
      if (text) writeFileSync(join(dest, 'LICENSE'), text)
    }
    await run(['add', '-A'])
    try {
      await run(['commit', '-q', '-m', 'Initial commit'])
    } catch (e) {
      if (e instanceof GcFail && /Please tell me who you are|user\.email/i.test(e.detail ?? '')) {
        // Repo is created; the first commit waits until the user sets their name and email.
        return this.open(dest)
      }
      throw e
    }
    return this.open(dest)
  }
}

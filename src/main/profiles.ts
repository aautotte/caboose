import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Profile } from '../shared/types'
import type { Db } from './db'
import { now, uuid } from './db'
import { GcFail, invalid } from './errors'

interface Row {
  id: string
  name: string
  git_author_name: string | null
  git_author_email: string | null
  signing_key: string | null
  ssh_key: string | null
  is_active: number
}

const toProfile = (r: Row): Profile => ({
  id: r.id,
  name: r.name,
  authorName: r.git_author_name,
  authorEmail: r.git_author_email,
  signingKey: r.signing_key,
  sshKey: r.ssh_key,
  isActive: r.is_active === 1
})

export type ProfilePatch = Partial<Pick<Profile, 'name' | 'authorName' | 'authorEmail' | 'signingKey' | 'sshKey'>>

/** The git config keys a profile can set, in the order they're passed to git. */
export const PROFILE_KEYS = ['user.name', 'user.email', 'user.signingkey', 'core.sshcommand'] as const

/**
 * Profiles: each has its own tabs, recent list, groups and preferences (everything keyed by profile_id), and
 * optionally its own author, signing key and SSH key. Those reach git as `-c` settings on each command, so
 * Git's config files are never written; a repository's own setting still wins over the profile's.
 */
export class Profiles {
  constructor(private db: Db) {}

  list(): Profile[] {
    return (this.db.prepare('SELECT * FROM profiles ORDER BY created_at').all() as unknown as Row[]).map(toProfile)
  }

  active(): Profile {
    return toProfile(this.db.prepare('SELECT * FROM profiles WHERE is_active = 1').get() as unknown as Row)
  }

  create(name: string): Profile {
    const n = this.checkName(name)
    const id = uuid()
    const t = now()
    this.db.prepare('INSERT INTO profiles (id, name, is_active, created_at, updated_at) VALUES (?, ?, 0, ?, ?)').run(id, n, t, t)
    return this.get(id)
  }

  update(id: string, patch: ProfilePatch): Profile {
    const cur = this.get(id)
    const clean = (v: string | null | undefined, keep: string | null): string | null => (v === undefined ? keep : v?.trim() || null)
    const next = {
      name: patch.name === undefined ? cur.name : this.checkName(patch.name, id),
      authorName: clean(patch.authorName, cur.authorName),
      authorEmail: clean(patch.authorEmail, cur.authorEmail),
      signingKey: clean(patch.signingKey, cur.signingKey),
      sshKey: clean(patch.sshKey, cur.sshKey)
    }
    if (/[\r\n<>]/.test(`${next.authorName ?? ''}${next.authorEmail ?? ''}`)) throw invalid('Names and emails can’t contain line breaks or angle brackets.')
    if (next.authorEmail && !/^[^\s@<>]+@[^\s@<>]+$/.test(next.authorEmail)) throw invalid('That doesn’t look like an email address.')
    if (next.signingKey && !/^[\w.@:+/ -]{1,200}$/.test(next.signingKey)) throw invalid('That doesn’t look like a key ID.')
    if (next.sshKey && (!/^[\w.-]{1,64}$/.test(next.sshKey) || next.sshKey.startsWith('.'))) throw invalid('Pick a key from your .ssh folder.')
    this.db
      .prepare('UPDATE profiles SET name = ?, git_author_name = ?, git_author_email = ?, signing_key = ?, ssh_key = ?, updated_at = ? WHERE id = ?')
      .run(next.name, next.authorName, next.authorEmail, next.signingKey, next.sshKey, now(), id)
    return this.get(id)
  }

  /** Forgets the profile's tabs, recent list and settings (cascade). Repositories on disk aren't touched. */
  remove(id: string): void {
    const p = this.get(id)
    if (p.isActive) throw invalid('Switch to another profile before deleting this one.')
    this.db.prepare('DELETE FROM profiles WHERE id = ?').run(id)
  }

  activate(id: string): void {
    this.get(id)
    this.db.exec('BEGIN')
    try {
      this.db.prepare('UPDATE profiles SET is_active = 0 WHERE is_active = 1').run()
      this.db.prepare('UPDATE profiles SET is_active = 1, updated_at = ? WHERE id = ?').run(now(), id)
      this.db.exec('COMMIT')
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
  }

  /** The active profile's settings as git config pairs, leaving out the keys in `skip` (set by the repository). */
  configPairs(skip: Set<string>): Array<[string, string]> {
    const p = this.active()
    const key = p.sshKey ? join(homedir(), '.ssh', p.sshKey) : null
    const values: Record<(typeof PROFILE_KEYS)[number], string | null> = {
      'user.name': p.authorName,
      'user.email': p.authorEmail,
      'user.signingkey': p.signingKey,
      // A key that has since been deleted is left out rather than breaking every fetch.
      'core.sshcommand': key && existsSync(key) ? `ssh -i "${key.split('\\').join('/')}" -o IdentitiesOnly=yes` : null
    }
    return PROFILE_KEYS.filter((k) => values[k] && !skip.has(k)).map((k) => [k, values[k]!])
  }

  private get(id: string): Profile {
    const row = this.db.prepare('SELECT * FROM profiles WHERE id = ?').get(id) as unknown as Row | undefined
    if (!row) throw new GcFail('invalid', 'That profile no longer exists.')
    return toProfile(row)
  }

  private checkName(name: string, except = ''): string {
    const n = name.trim()
    if (!n || n.length > 60) throw invalid('Give the profile a name of up to 60 characters.')
    const clash = (this.db.prepare('SELECT id FROM profiles WHERE lower(name) = lower(?) AND id != ?').get(n, except) as { id: string } | undefined) !== undefined
    if (clash) throw invalid(`There’s already a profile called ${n}.`)
    return n
  }
}

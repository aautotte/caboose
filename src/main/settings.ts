import type { GraphColumn, RefViewState } from '../shared/types'
import type { Db } from './db'
import { activeProfileId, now, uuid } from './db'

/** Global preferences for the active profile, stored as JSON values in `preferences`. */
export class Prefs {
  constructor(private db: Db) {}

  getAll(): Record<string, unknown> {
    const rows = this.db
      .prepare('SELECT key, value FROM preferences WHERE profile_id = ? AND repo_id IS NULL')
      .all(activeProfileId(this.db)) as Array<{ key: string; value: string }>
    return Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)]))
  }

  set(key: string, value: unknown): void {
    const profile = activeProfileId(this.db)
    const json = JSON.stringify(value ?? null)
    const t = now()
    const hit = this.db.prepare('SELECT id FROM preferences WHERE profile_id = ? AND repo_id IS NULL AND key = ?').get(profile, key) as { id: string } | undefined
    if (hit) this.db.prepare('UPDATE preferences SET value = ?, updated_at = ? WHERE id = ?').run(json, t, hit.id)
    else this.db.prepare('INSERT INTO preferences (id, profile_id, repo_id, key, value, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?, ?)').run(uuid(), profile, key, json, t, t)
  }
}

/** Preferences for one repository (repo_id set), e.g. "focus on this branch" in the graph. */
export class RepoPrefs {
  constructor(private db: Db) {}

  getAll(repoId: string): Record<string, unknown> {
    const rows = this.db.prepare('SELECT key, value FROM preferences WHERE repo_id = ?').all(repoId) as Array<{ key: string; value: string }>
    return Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)]))
  }

  set(repoId: string, key: string, value: unknown): void {
    const json = JSON.stringify(value ?? null)
    const t = now()
    const hit = this.db.prepare('SELECT id FROM preferences WHERE repo_id = ? AND key = ?').get(repoId, key) as { id: string } | undefined
    if (hit) this.db.prepare('UPDATE preferences SET value = ?, updated_at = ? WHERE id = ?').run(json, t, hit.id)
    else
      this.db
        .prepare('INSERT INTO preferences (id, profile_id, repo_id, key, value, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(uuid(), activeProfileId(this.db), repoId, key, json, t, t)
  }
}

/** Graph column widths and visibility per repo (graph_layouts). */
export class GraphLayouts {
  constructor(private db: Db) {}

  get(repoId: string): GraphColumn[] | null {
    const row = this.db.prepare('SELECT columns FROM graph_layouts WHERE repo_id = ?').get(repoId) as { columns: string } | undefined
    return row ? (JSON.parse(row.columns) as GraphColumn[]) : null
  }

  set(repoId: string, columns: GraphColumn[]): void {
    const t = now()
    this.db
      .prepare(
        `INSERT INTO graph_layouts (repo_id, columns, created_at, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (repo_id) DO UPDATE SET columns = excluded.columns, updated_at = excluded.updated_at`
      )
      .run(repoId, JSON.stringify(columns), t, t)
  }
}

/** Which branches are hidden from, or soloed in, a repo's graph. */
export class RefView {
  constructor(private db: Db) {}

  get(repoId: string): RefViewState {
    const rows = this.db.prepare('SELECT ref_name, hidden, soloed, pinned_left FROM ref_view_state WHERE repo_id = ?').all(repoId) as Array<{
      ref_name: string
      hidden: number
      soloed: number
      pinned_left: number
    }>
    return {
      hidden: rows.filter((r) => r.hidden).map((r) => r.ref_name),
      soloed: rows.filter((r) => r.soloed).map((r) => r.ref_name),
      pinned: rows.find((r) => r.pinned_left)?.ref_name ?? null
    }
  }

  private upsert(repoId: string, ref: string, cols: { hidden?: number; soloed?: number; pinned_left?: number }): void {
    const t = now()
    this.db.prepare('INSERT OR IGNORE INTO ref_view_state (id, repo_id, ref_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(uuid(), repoId, ref, t, t)
    for (const [k, v] of Object.entries(cols)) {
      this.db.prepare(`UPDATE ref_view_state SET ${k} = ?, updated_at = ? WHERE repo_id = ? AND ref_name = ?`).run(v, t, repoId, ref)
    }
    // A row with nothing set is just noise.
    this.db.prepare('DELETE FROM ref_view_state WHERE repo_id = ? AND hidden = 0 AND soloed = 0 AND pinned_left = 0').run(repoId)
  }

  set(repoId: string, ref: string, state: 'normal' | 'hidden' | 'soloed'): RefViewState {
    this.upsert(repoId, ref, { hidden: state === 'hidden' ? 1 : 0, soloed: state === 'soloed' ? 1 : 0 })
    return this.get(repoId)
  }

  /** Hide or show many refs at once (a folder, a remote, a whole section). */
  setMany(repoId: string, refs: string[], state: 'normal' | 'hidden'): RefViewState {
    this.db.exec('BEGIN')
    try {
      for (const ref of refs) this.upsert(repoId, ref, state === 'hidden' ? { hidden: 1, soloed: 0 } : { hidden: 0 })
      this.db.exec('COMMIT')
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
    return this.get(repoId)
  }

  /** One pinned branch per repo; pinning also un-hides it. null unpins. */
  pin(repoId: string, ref: string | null): RefViewState {
    this.db.prepare('UPDATE ref_view_state SET pinned_left = 0 WHERE repo_id = ?').run(repoId)
    if (ref) this.upsert(repoId, ref, { pinned_left: 1, hidden: 0 })
    else this.db.prepare('DELETE FROM ref_view_state WHERE repo_id = ? AND hidden = 0 AND soloed = 0 AND pinned_left = 0').run(repoId)
    return this.get(repoId)
  }

  /** Drops entries for refs that no longer exist, so a deleted branch can't stay soloed forever. */
  prune(repoId: string, existing: Set<string>): void {
    for (const r of this.db.prepare('SELECT ref_name FROM ref_view_state WHERE repo_id = ?').all(repoId) as Array<{ ref_name: string }>) {
      if (!existing.has(r.ref_name)) this.db.prepare('DELETE FROM ref_view_state WHERE repo_id = ? AND ref_name = ?').run(repoId, r.ref_name)
    }
  }
}

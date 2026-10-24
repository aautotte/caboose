import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import init001 from './001_init.sql?raw'
import undoTypes002 from './002_undo_types.sql?raw'
import profileKeys003 from './003_profile_keys.sql?raw'

// Migrations run in order; each one ends by setting PRAGMA user_version to its number.
const migrations: string[] = [init001, undoTypes002, profileKeys003]

export type Db = DatabaseSync

export function openDb(file: string): Db {
  mkdirSync(dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 2000;')
  const { user_version: version } = db.prepare('PRAGMA user_version').get() as { user_version: number }
  for (let v = version; v < migrations.length; v++) {
    db.exec('BEGIN')
    try {
      db.exec(migrations[v])
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }
  ensureProfile(db)
  return db
}

export const uuid = (): string => randomUUID()
export const now = (): number => Date.now()

function ensureProfile(db: Db): void {
  const row = db.prepare('SELECT id FROM profiles WHERE is_active = 1').get()
  if (!row) {
    db.prepare('INSERT INTO profiles (id, name, is_active, created_at, updated_at) VALUES (?, ?, 1, ?, ?)').run(
      uuid(),
      'Default',
      now(),
      now()
    )
  }
}

export function activeProfileId(db: Db): string {
  return (db.prepare('SELECT id FROM profiles WHERE is_active = 1').get() as { id: string }).id
}

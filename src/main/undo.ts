import type { Remote, ResetMode, UndoPeek } from '../shared/types'
import type { Db } from './db'
import { now, uuid } from './db'
import { GcFail } from './errors'
import { UNDO_REFS, type RepoOps } from './git/ops'

export type UndoType =
  | 'checkout'
  | 'commit'
  | 'amend'
  | 'discard'
  | 'branch_delete'
  | 'merge'
  | 'rebase'
  | 'cherry_pick'
  | 'revert'
  | 'reset'
  | 'discard_lines'
  | 'stash_drop'
  | 'tag_delete'
  | 'remote_remove'
  | 'ignore'

/** What each undo entry needs to move the repo back (before) and forward again (after). */
export interface Snapshot {
  branch: string | null
  sha: string | null
  name?: string // branch_delete: the branch
  stash?: string // discard: snapshot commit
  paths?: string[] | 'all' // discard: what was discarded (for redo)
  patch?: string // discard_lines: the patch that was reversed out of the working files
  message?: string // stash_drop: the stash's message
  mode?: ResetMode // reset
  remote?: Remote // remote_remove
  gitignore?: string | null // ignore: the root .gitignore on this side (null: none)
  index?: string // ignore: the index entries of the files it stopped tracking
}

interface Row {
  id: string
  seq: number
  action_type: UndoType
  label: string
  before_state: string
  after_state: string
  state: 'done' | 'undone'
}

const KEEP = 100

export class UndoStack {
  /** Merges and rebases that stopped on conflicts: recorded once they finish. */
  private pending = new Map<string, { type: UndoType; label: string; before: Snapshot }>()

  constructor(private db: Db) {}

  async snapshot(ops: RepoOps): Promise<Snapshot> {
    const refs = await ops.refs()
    return { branch: refs.head.branch, sha: refs.head.sha }
  }

  /**
   * Records an action that has already happened, so it must not throw. If it can't be recorded, the older
   * entries are cleared too: otherwise the next Undo would silently undo an earlier action instead.
   */
  record(repoId: string, type: UndoType, label: string, before: Snapshot, after: Snapshot): void {
    const tx = this.db
    tx.exec('BEGIN')
    try {
      // A new action clears the redo side.
      tx.prepare("DELETE FROM undo_entries WHERE repo_id = ? AND state = 'undone'").run(repoId)
      const { m } = tx.prepare('SELECT COALESCE(MAX(seq), 0) AS m FROM undo_entries WHERE repo_id = ?').get(repoId) as { m: number }
      tx.prepare(
        "INSERT INTO undo_entries (id, repo_id, seq, action_type, label, before_state, after_state, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'done', ?, ?)"
      ).run(uuid(), repoId, m + 1, type, label, JSON.stringify(before), JSON.stringify(after), now(), now())
      tx.prepare(
        'DELETE FROM undo_entries WHERE repo_id = ? AND seq <= (SELECT MAX(seq) FROM undo_entries WHERE repo_id = ?) - ?'
      ).run(repoId, repoId, KEEP)
      tx.exec('COMMIT')
    } catch (e) {
      tx.exec('ROLLBACK')
      console.error('undo: could not record', type, e)
      try {
        this.db.prepare('DELETE FROM undo_entries WHERE repo_id = ?').run(repoId)
      } catch (e2) {
        console.error('undo: could not clear', e2)
      }
    }
  }

  /** Every commit / object an undo entry for this repo still points at (the safety refs worth keeping). */
  referencedShas(repoId: string): Set<string> {
    const keep = new Set<string>()
    const rows = this.db.prepare('SELECT before_state, after_state FROM undo_entries WHERE repo_id = ?').all(repoId) as Array<{ before_state: string; after_state: string }>
    for (const r of rows) for (const m of (r.before_state + r.after_state).matchAll(/[0-9a-f]{40}/g)) keep.add(m[0])
    for (const p of this.pending.values()) for (const m of JSON.stringify(p.before).matchAll(/[0-9a-f]{40}/g)) keep.add(m[0])
    return keep
  }

  setPending(repoId: string, type: UndoType, label: string, before: Snapshot): void {
    this.pending.set(repoId, { type, label, before })
  }

  async finishPending(ops: RepoOps): Promise<void> {
    const p = this.pending.get(ops.repo.id)
    if (!p) return
    this.pending.delete(ops.repo.id)
    this.record(ops.repo.id, p.type, p.label, p.before, await this.snapshot(ops))
  }

  dropPending(repoId: string): void {
    this.pending.delete(repoId)
  }

  peek(repoId: string): UndoPeek {
    const undo = this.db
      .prepare("SELECT label FROM undo_entries WHERE repo_id = ? AND state = 'done' ORDER BY seq DESC LIMIT 1")
      .get(repoId) as { label: string } | undefined
    const redo = this.db
      .prepare("SELECT label FROM undo_entries WHERE repo_id = ? AND state = 'undone' ORDER BY seq ASC LIMIT 1")
      .get(repoId) as { label: string } | undefined
    return { undo: undo ? { label: undo.label } : null, redo: redo ? { label: redo.label } : null }
  }

  async undo(ops: RepoOps): Promise<void> {
    const row = this.db
      .prepare("SELECT * FROM undo_entries WHERE repo_id = ? AND state = 'done' ORDER BY seq DESC LIMIT 1")
      .get(ops.repo.id) as Row | undefined
    if (!row) throw new GcFail('invalid', 'Nothing to undo.')
    await this.apply(ops, row, 'back')
    this.db.prepare("UPDATE undo_entries SET state = 'undone', updated_at = ? WHERE id = ?").run(now(), row.id)
  }

  async redo(ops: RepoOps): Promise<void> {
    const row = this.db
      .prepare("SELECT * FROM undo_entries WHERE repo_id = ? AND state = 'undone' ORDER BY seq ASC LIMIT 1")
      .get(ops.repo.id) as Row | undefined
    if (!row) throw new GcFail('invalid', 'Nothing to redo.')
    const after = await this.apply(ops, row, 'forward')
    this.db
      .prepare("UPDATE undo_entries SET state = 'done', after_state = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(after), now(), row.id)
  }

  /** Moves the repo from one side of the entry to the other. Refuses if the repo changed outside the app. */
  private async apply(ops: RepoOps, row: Row, dir: 'back' | 'forward'): Promise<Snapshot> {
    const before = JSON.parse(row.before_state) as Snapshot
    const after = JSON.parse(row.after_state) as Snapshot
    const from = dir === 'back' ? after : before
    const to = dir === 'back' ? before : after
    const cur = await this.snapshot(ops)
    const moved = (): GcFail =>
      new GcFail('changed_outside', 'The repository changed outside the app since this action, so it can’t be undone safely.')

    switch (row.action_type) {
      case 'commit':
      case 'amend': {
        if (cur.sha !== from.sha) throw moved()
        if (to.sha) await ops.mut(['reset', '-q', '--soft', to.sha])
        else await ops.mut(['update-ref', '-d', 'HEAD']) // back to "no commits yet", changes stay staged
        return after
      }
      case 'checkout': {
        if (cur.sha !== from.sha || cur.branch !== from.branch) throw moved()
        if (to.branch) await ops.mut(['switch', to.branch])
        else if (to.sha) await ops.mut(['switch', '--detach', to.sha])
        return after
      }
      case 'branch_delete': {
        const name = before.name!
        if (dir === 'back') await ops.mut(['branch', name, before.sha!])
        else {
          const sha = (await ops.tryGit(['rev-parse', '-q', '--verify', `refs/heads/${name}`]))?.trim()
          if (sha !== before.sha) throw moved()
          await ops.mut(['branch', '-D', name])
        }
        return after
      }
      case 'discard': {
        if (cur.sha !== before.sha) throw moved()
        if (dir === 'back') {
          await ops.restoreSnapshot(before.stash!)
          return after
        }
        const ref = `${UNDO_REFS}${row.id}`
        const stash = await ops.discard(before.paths ?? 'all', ref)
        this.db
          .prepare('UPDATE undo_entries SET before_state = ? WHERE id = ?')
          .run(JSON.stringify({ ...before, stash: stash ?? before.stash }), row.id)
        return after
      }
      case 'discard_lines': {
        if (cur.sha !== before.sha) throw moved()
        await ops.applyWorktreePatch(before.patch!, dir === 'forward')
        return after
      }
      case 'stash_drop': {
        if (dir === 'back') await ops.stashStore(before.stash!, before.message ?? 'restored stash')
        else await ops.stashDrop(before.stash!)
        return after
      }
      case 'tag_delete': {
        const name = before.name!
        if (dir === 'back') {
          if (await ops.tryGit(['rev-parse', '-q', '--verify', `refs/tags/${name}`])) throw moved()
          await ops.mut(['update-ref', `refs/tags/${name}`, before.sha!])
        } else await ops.deleteTag(name)
        return after
      }
      case 'remote_remove': {
        const r = before.remote!
        if (dir === 'back') await ops.addRemote(r.name, r.fetchUrl, r.pushUrl)
        else await ops.removeRemote(r.name)
        return after
      }
      case 'ignore': {
        if (ops.readGitignore() !== from.gitignore) throw moved()
        ops.writeGitignore(to.gitignore ?? null)
        if (dir === 'back') await ops.restoreIndex(before.index ?? '')
        else await ops.untrack(after.paths === 'all' ? [] : (after.paths ?? []))
        return after
      }
      case 'reset': {
        if (cur.sha !== from.sha || cur.branch !== from.branch) throw moved()
        const mode = before.mode ?? 'mixed'
        if (mode !== 'hard') {
          // Soft and mixed resets never touched the working files, so moving back the same way is safe.
          await ops.mut(['reset', '-q', `--${mode}`, to.sha!])
          return after
        }
        if (await ops.hasTrackedChanges()) {
          if (dir === 'back') throw new GcFail('invalid', 'Commit or stash your changes first. Undoing this would overwrite them.')
          // Redo after an undo that restored the old work: keep it safe again before resetting.
          const stash = await ops.pinWork(`${UNDO_REFS}${row.id}`)
          this.db.prepare('UPDATE undo_entries SET before_state = ? WHERE id = ?').run(JSON.stringify({ ...before, stash }), row.id)
        }
        await ops.mut(['reset', '-q', '--hard', to.sha!])
        if (dir === 'back' && before.stash) await ops.restoreSnapshot(before.stash)
        return after
      }
      case 'merge':
      case 'rebase':
      case 'cherry_pick':
      case 'revert': {
        if (cur.sha !== from.sha) throw moved()
        if (await ops.hasTrackedChanges()) {
          throw new GcFail('invalid', 'Commit or stash your changes first. Undoing this would overwrite them.')
        }
        if (to.branch && to.branch !== cur.branch) await ops.mut(['switch', to.branch])
        await ops.mut(['reset', '-q', '--hard', to.sha!])
        return after
      }
    }
  }
}

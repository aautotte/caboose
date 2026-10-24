import { watch, type FSWatcher } from 'node:fs'
import type { RepoChangedEvent } from '../shared/types'
import type { GitRunner } from './git/runner'

type What = RepoChangedEvent['what'][number]

const DEBOUNCE_MS = 300

function classify(file: string): What | null {
  const f = file.split('\\').join('/')
  if (f === '.git' || f.startsWith('.git/')) {
    const rest = f.slice(5)
    if (rest.startsWith('objects') || rest.startsWith('logs') || rest.endsWith('.lock') || rest.startsWith('mergatroid')) return null
    if (rest === 'index') return 'index'
    if (rest === 'HEAD' || rest.startsWith('refs') || rest === 'packed-refs' || /^(MERGE|CHERRY_PICK|REVERT|ORIG)_HEAD$/.test(rest) || rest.startsWith('rebase-')) return 'refs'
    if (rest === 'FETCH_HEAD') return 'refs'
    return null
  }
  return 'worktree'
}

/**
 * One recursive fs.watch per open repo (native on Windows and macOS, no extra dependency).
 * Changes are debounced, and held back while our own git commands run, then flushed once.
 */
export class Watcher {
  private watchers = new Map<string, FSWatcher>()
  private pending = new Map<string, Set<What>>()
  private timers = new Map<string, NodeJS.Timeout>()

  constructor(
    private runner: GitRunner,
    private emit: (e: RepoChangedEvent) => void
  ) {
    runner.on('busy', (repoId: string, busy: boolean) => {
      if (!busy) {
        // Our own command finished: always refresh everything once.
        const set = this.pending.get(repoId) ?? new Set<What>()
        set.add('refs').add('index').add('worktree')
        this.pending.set(repoId, set)
        this.schedule(repoId)
      }
    })
  }

  start(repoId: string, path: string): void {
    if (this.watchers.has(repoId)) return
    try {
      const w = watch(path, { recursive: true }, (_event, file) => {
        if (!file) return
        const what = classify(String(file))
        if (!what) return
        const set = this.pending.get(repoId) ?? new Set<What>()
        set.add(what)
        this.pending.set(repoId, set)
        if (!this.runner.isBusy(repoId)) this.schedule(repoId)
      })
      w.on('error', () => this.stop(repoId))
      this.watchers.set(repoId, w)
    } catch {
      // Watching is best effort; the UI still refreshes after every action and on focus.
    }
  }

  stop(repoId: string): void {
    this.watchers.get(repoId)?.close()
    this.watchers.delete(repoId)
    clearTimeout(this.timers.get(repoId))
    this.timers.delete(repoId)
    this.pending.delete(repoId)
  }

  stopAll(): void {
    for (const id of [...this.watchers.keys()]) this.stop(id)
  }

  private schedule(repoId: string): void {
    clearTimeout(this.timers.get(repoId))
    this.timers.set(
      repoId,
      setTimeout(() => {
        const set = this.pending.get(repoId)
        this.pending.delete(repoId)
        if (set && set.size) this.emit({ repoId, what: [...set] })
      }, DEBOUNCE_MS)
    )
  }
}

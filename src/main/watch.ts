import { readFileSync, statSync, watch, type FSWatcher } from 'node:fs'
import { join, resolve } from 'node:path'
import type { RepoChangedEvent } from '../shared/types'
import type { GitRunner } from './git/runner'

type What = RepoChangedEvent['what'][number]

const DEBOUNCE_MS = 300

/** For a .git file ("gitdir: <path>"): that git folder, and the one it shares refs with (its "commondir"), if another. */
export function linkedGitDirs(worktree: string): { gitDir: string; commonDir: string | null } | null {
  try {
    const dotGit = join(worktree, '.git')
    if (!statSync(dotGit).isFile()) return null
    const m = /^gitdir:\s*(.+?)\s*$/m.exec(readFileSync(dotGit, 'utf8'))
    if (!m) return null
    const gitDir = resolve(worktree, m[1])
    let commonDir: string | null = null
    try {
      commonDir = resolve(gitDir, readFileSync(join(gitDir, 'commondir'), 'utf8').trim())
    } catch {
      // a submodule's git folder has no commondir: it keeps its refs itself
    }
    return { gitDir, commonDir }
  } catch {
    return null
  }
}

function classify(file: string): What | null {
  const f = file.split('\\').join('/')
  if (f === '.git' || f.startsWith('.git/')) {
    const rest = f.slice(5)
    if (rest.startsWith('objects') || rest.startsWith('logs') || rest.endsWith('.lock') || rest.startsWith('caboose')) return null
    if (rest === 'index') return 'index'
    if (rest === 'HEAD' || rest.startsWith('refs') || rest === 'packed-refs' || /^(MERGE|CHERRY_PICK|REVERT|ORIG)_HEAD$/.test(rest) || rest.startsWith('rebase-')) return 'refs'
    if (rest === 'FETCH_HEAD') return 'refs'
    // Another worktree switched branches: which branches are checked out where has changed.
    if (/^worktrees\/[^/]+\/HEAD$/.test(rest)) return 'refs'
    return null
  }
  return 'worktree'
}

/**
 * One recursive fs.watch per open repo (native on Windows and macOS, no extra dependency).
 * Changes are debounced, and held back while our own git commands run, then flushed once.
 */
export class Watcher {
  private watchers = new Map<string, FSWatcher[]>()
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
    const note = (what: What | null): void => {
      if (!what) return
      const set = this.pending.get(repoId) ?? new Set<What>()
      set.add(what)
      this.pending.set(repoId, set)
      if (!this.runner.isBusy(repoId)) this.schedule(repoId)
    }
    const list: FSWatcher[] = []
    try {
      const w = watch(path, { recursive: true }, (_event, file) => file && note(classify(String(file))))
      w.on('error', () => this.stop(repoId))
      list.push(w)
      // A linked worktree (or a submodule) has a .git file pointing at its own git folder elsewhere: HEAD, index and
      // rebase state live there, and refs in the folder it shares with the main worktree.
      const dirs = linkedGitDirs(path)
      if (dirs) {
        const own = watch(dirs.gitDir, { recursive: true }, (_event, file) => file && note(classify(`.git/${String(file)}`)))
        own.on('error', () => {})
        list.push(own)
        if (dirs.commonDir) {
          const shared = watch(dirs.commonDir, { recursive: true }, (_event, file) => {
            const f = file ? String(file).split('\\').join('/') : ''
            // What every worktree shares, and the other worktrees' HEADs (which branch is checked out where); their
            // index and files are their own business.
            if (f.startsWith('refs') || f === 'packed-refs' || f === 'HEAD' || /^worktrees\/[^/]+\/HEAD$/.test(f)) note('refs')
          })
          shared.on('error', () => {})
          list.push(shared)
        }
      }
    } catch {
      // Watching is best effort; the UI still refreshes after every action and on focus.
    }
    if (list.length) this.watchers.set(repoId, list)
  }

  stop(repoId: string): void {
    for (const w of this.watchers.get(repoId) ?? []) w.close()
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

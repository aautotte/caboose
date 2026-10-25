import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import type { Db } from '../db'
import { now, uuid } from '../db'
import { GcFail } from '../errors'

export interface RunOptions {
  cwd: string
  args: string[]
  repoId?: string
  opId?: string
  stdin?: string
  /** Mutating commands are queued one at a time per repo. */
  mutating?: boolean
  timeoutMs?: number
  /** Called with git's progress lines (stderr) for clone / fetch / push. */
  onProgress?: (phase: string, percent?: number) => void
  /** Exit codes that are not failures (e.g. merge returns 1 on conflicts). */
  okCodes?: number[]
  extraEnv?: Record<string, string>
  /** Leave out the profile's settings, e.g. when reading what Git's own config says. */
  plain?: boolean
}

export interface RunResult {
  stdout: string
  stderr: string
  code: number
}

const MAX_TAIL = 8 * 1024
const PROGRESS = /^([A-Za-z ]+):\s+(\d+)%/
const CLONING = /^Cloning into '(.+)'/
const LOCKED = /index\.lock|cannot lock ref|could not write index|unable to write new index file/i

/**
 * Runs the system git. argv arrays only, never a shell. Every call is logged to activity_log.
 * Emits 'busy' (repoId, boolean) so the file watcher can stay quiet during our own commands.
 */
export class GitRunner extends EventEmitter {
  private queues = new Map<string, Promise<unknown>>()
  private busyCount = new Map<string, number>()
  private children = new Map<string, Set<ChildProcess>>()
  private configArgs: ((opts: RunOptions) => Promise<string[]>) | null = null

  constructor(
    private db: Db,
    private askpass: { env: () => Record<string, string> } | null = null
  ) {
    super()
  }

  run(opts: RunOptions): Promise<RunResult> {
    if (!opts.mutating || !opts.repoId) return this.withRetry(opts)
    const key = opts.repoId
    const prev = this.queues.get(key) ?? Promise.resolve()
    const next = prev.catch(() => {}).then(() => this.withRetry(opts))
    this.queues.set(key, next)
    return next
  }

  /** Settings put in front of every command (`-c key=value`), from the active profile. */
  setConfigArgs(fn: (opts: RunOptions) => Promise<string[]>): void {
    this.configArgs = fn
  }

  isBusy(repoId: string): boolean {
    return (this.busyCount.get(repoId) ?? 0) > 0
  }

  cancel(opId: string): void {
    for (const child of this.children.get(opId) ?? []) child.kill()
  }

  private async withRetry(opts: RunOptions): Promise<RunResult> {
    const pre = opts.plain || !this.configArgs ? [] : await this.configArgs(opts)
    if (pre.length) opts = { ...opts, args: [...pre, ...opts.args] }
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.exec(opts)
      } catch (err) {
        // Another git process (an editor, a terminal) briefly holding the index or a ref: wait and retry.
        // These all fail before the command changes anything, so running it again is safe.
        const lock = err instanceof GcFail && LOCKED.test(err.detail ?? '')
        if (!lock || attempt >= 3) throw err
        await new Promise((r) => setTimeout(r, 250 * (attempt + 1)))
      }
    }
  }

  private exec(opts: RunOptions): Promise<RunResult> {
    const opId = opts.opId ?? uuid()
    const logId = uuid()
    const started = now()
    this.db
      .prepare(
        "INSERT INTO activity_log (id, repo_id, op_id, argv, status, started_at, created_at) VALUES (?, ?, ?, ?, 'running', ?, ?)"
      )
      .run(logId, opts.repoId ?? null, opId, JSON.stringify(['git', ...opts.args]), started, started)

    // Only commands that change the repo count as busy: the watcher holds its events while they run and refreshes
    // once after. Counting reads too made every refresh trigger the next one (a refresh loop).
    const tracksBusy = !!opts.repoId && !!opts.mutating
    if (tracksBusy) this.setBusy(opts.repoId!, +1)

    return new Promise<RunResult>((resolve, reject) => {
      const child = spawn('git', opts.args, {
        cwd: opts.cwd,
        windowsHide: true,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',
          GIT_EDITOR: 'true',
          GIT_SEQUENCE_EDITOR: 'true',
          GIT_PAGER: 'cat',
          LC_ALL: 'C',
          LANG: 'C',
          ...(opts.mutating ? {} : { GIT_OPTIONAL_LOCKS: '0' }),
          ...(this.askpass?.env() ?? {}),
          ...opts.extraEnv
        }
      })
      const set = this.children.get(opId) ?? new Set()
      set.add(child)
      this.children.set(opId, set)

      const out: Buffer[] = []
      let err = ''
      let cancelled = false
      const timer = setTimeout(() => {
        cancelled = true
        child.kill()
      }, opts.timeoutMs ?? 120_000)

      child.stdout.on('data', (d: Buffer) => out.push(d))
      child.stderr.on('data', (d: Buffer) => {
        const s = d.toString('utf8')
        err += s
        if (err.length > 4 * MAX_TAIL) err = err.slice(-2 * MAX_TAIL)
        if (opts.onProgress) {
          for (const line of s.split(/[\r\n]+/)) {
            const m = PROGRESS.exec(line.trim())
            if (m) opts.onProgress(m[1].trim(), Number(m[2]))
            // `git submodule update`: which submodule it's on.
            const c = CLONING.exec(line.trim())
            if (c) opts.onProgress(`Setting up ${c[1].split(/[\\/]/).filter(Boolean).pop()}`)
          }
        }
      })
      if (opts.stdin !== undefined) child.stdin.end(opts.stdin)
      else child.stdin.end()

      const finish = (code: number | null, spawnError?: Error): void => {
        clearTimeout(timer)
        set.delete(child)
        if (set.size === 0) this.children.delete(opId)
        if (tracksBusy) this.setBusy(opts.repoId!, -1)
        const stdout = Buffer.concat(out).toString('utf8')
        const killed = code === null && !spawnError
        const ok = !spawnError && code !== null && (code === 0 || (opts.okCodes ?? []).includes(code))
        const status = killed ? 'cancelled' : ok ? 'ok' : 'error'
        this.db
          .prepare('UPDATE activity_log SET status = ?, exit_code = ?, stderr_tail = ?, finished_at = ? WHERE id = ?')
          .run(status, code, err.slice(-MAX_TAIL) || null, now(), logId)
        if (spawnError) {
          reject(new GcFail('internal', 'Couldn’t start git. Is Git installed and on your PATH?', spawnError.message))
        } else if (killed) {
          reject(new GcFail('git', cancelled ? 'Git took too long and was stopped.' : 'Cancelled.', err))
        } else if (!ok) {
          reject(gitError(opts.args, err, code ?? -1))
        } else {
          resolve({ stdout, stderr: err, code: code ?? 0 })
        }
      }
      child.on('error', (e) => finish(null, e))
      child.on('close', (code) => finish(code))
    })
  }

  private setBusy(repoId: string, delta: number): void {
    const n = Math.max(0, (this.busyCount.get(repoId) ?? 0) + delta)
    this.busyCount.set(repoId, n)
    if (n === 0 || (n === 1 && delta > 0)) this.emit('busy', repoId, n > 0)
  }
}

/** Turns git's stderr into a short sentence for the toast, keeping the raw text as detail. */
function gitError(args: string[], stderr: string, code: number): GcFail {
  const text = stderr.trim()
  const lines = text.split(/\r?\n/).filter((l) => l && !/^(hint|remote): /.test(l))
  if (/Authentication failed|could not read Username|Permission denied \(publickey/i.test(text)) {
    return new GcFail('auth', 'The remote asked for credentials and none were accepted.', text)
  }
  if (/Please tell me who you are|unable to auto-detect email|empty ident name/i.test(text)) {
    return new GcFail('git', 'Git needs your name and email before it can commit. Add them in Settings, under “Your name and email”.', text)
  }
  if (LOCKED.test(text)) {
    return new GcFail('busy', 'Another Git process is running in this repository. Try again in a moment.', text)
  }
  const cmd = args.find((a, i) => a !== '-c' && args[i - 1] !== '-c')
  const first = (lines.find((l) => /^(fatal|error):/.test(l)) ?? lines[0] ?? `git ${cmd} failed (exit ${code})`)
    .replace(/^(fatal|error):\s*/, '')
  return new GcFail('git', first.charAt(0).toUpperCase() + first.slice(1), text)
}

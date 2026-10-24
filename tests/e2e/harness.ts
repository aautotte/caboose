// Shared setup for the flow specs: launch the built app on fresh seed repos with an isolated home, git config
// and app data; collect anything that should fail a test (renderer console errors, page errors, unexpected
// internal errors in the main process); and run axe on the current screen.
import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

export const app = resolve(__dirname, '..', '..')
export const seed = join(app, '.seed')
export const demo = join(seed, 'demo')
export const conflict = join(seed, 'conflict')

export interface Harness {
  electronApp: ElectronApplication
  page: Page
  env: NodeJS.ProcessEnv
  home: string
  /** Problems seen since launch; `expectClean()` fails the test if there are any. */
  problems: string[]
  git: (cwd: string, ...args: string[]) => string
  gitOr: (cwd: string, ...args: string[]) => () => string
  expectClean: () => void
  close: () => Promise<void>
}

/** Errors the app is expected to log while a test provokes them on purpose. */
const ALLOWED = [/Failed to load resource/i]

export async function launch(
  name: string,
  opts: { open?: string[]; reseed?: boolean; extraEnv?: Record<string, string>; setup?: (env: NodeJS.ProcessEnv) => void; keepUserData?: boolean; exe?: string } = {}
): Promise<Harness> {
  const home = join(seed, `home-${name}`)
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: join(home, '.gitconfig'),
    GC_TEST: '1',
    ...opts.extraEnv
  }
  if (opts.reseed !== false) execFileSync(process.execPath, [join(app, 'scripts', 'seed.mjs')], { stdio: 'ignore', env })
  if (!opts.keepUserData) {
    rmSync(home, { recursive: true, force: true })
    mkdirSync(home, { recursive: true })
    writeFileSync(join(home, '.gitconfig'), '[user]\n\tname = E2E\n\temail = e2e@example.com\n[init]\n\tdefaultBranch = main\n')
  }
  opts.setup?.(env)
  const userData = join(seed, `userdata-${name}`)
  if (!opts.keepUserData) rmSync(userData, { recursive: true, force: true })
  const open = opts.open ?? [demo, conflict]
  // exe: a packaged Mergatroid (npm run dist) instead of the dev build.
  const openArgs = open.length ? [`--open=${open.join('|')}`] : []
  const electronApp = await electron.launch({
    cwd: app,
    ...(opts.exe ? { executablePath: opts.exe, args: openArgs } : { args: ['.', ...openArgs] }),
    env: { ...env, GC_USER_DATA: userData }
  })
  const page = await electronApp.firstWindow()
  const problems: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error' && !ALLOWED.some((r) => r.test(m.text()))) problems.push(`console error: ${m.text()}`)
  })
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`))
  // The IPC layer logs unexpected exceptions as "<channel> <stack>"; git failures are expected and not logged.
  electronApp.process().stderr?.on('data', (d: Buffer) => {
    const s = d.toString()
    if (/^\s*[a-z]+\.[a-zA-Z]+ .*Error/m.test(s) || /Uncaught|TypeError|ReferenceError/.test(s)) problems.push(`main: ${s.trim().slice(0, 500)}`)
  })
  const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const gitOr = (cwd: string, ...args: string[]) => (): string => {
    try {
      return git(cwd, ...args)
    } catch {
      return ''
    }
  }
  return {
    electronApp,
    page,
    env,
    home,
    problems,
    git,
    gitOr,
    expectClean: () => expect(problems, problems.join('\n')).toEqual([]),
    close: async () => {
      await electronApp.close()
    }
  }
}

export interface AxeIssue {
  id: string
  impact: string | null | undefined
  help: string
  targets: string[]
}

/**
 * axe-core on what is on screen now. Injected with evaluate (Electron can't open the extra page
 * @axe-core/playwright uses, and evaluate isn't subject to the page's CSP). Returns violations, compact.
 */
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8')
export async function axe(page: Page): Promise<AxeIssue[]> {
  await page.evaluate(axeSource)
  const violations = (await page.evaluate(async () => {
    const w = window as unknown as { axe: { run: (ctx: Document, opts: unknown) => Promise<{ violations: unknown[] }> } }
    const r = await w.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] } })
    return r.violations
  })) as Array<{ id: string; impact?: string | null; help: string; nodes: Array<{ target: string[] }> }>
  return violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, targets: v.nodes.slice(0, 5).map((n) => n.target.join(' ')) }))
}

export const dialog = (page: Page) => page.getByRole('dialog')
export const grid = (page: Page) => page.getByRole('grid', { name: 'Commit history' })
export const commitRow = (page: Page, summary: string) =>
  grid(page).getByRole('row', { name: new RegExp(`^${summary.replace(/[()[\]{}.*+?^$|\\]/g, '\\$&')}`) })

export async function menu(page: Page, target: ReturnType<Page['locator']>, item: string | RegExp): Promise<void> {
  await target.click({ button: 'right' })
  await page.getByRole('menuitem', { name: item }).click()
}

export async function toGraph(page: Page): Promise<void> {
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await grid(page).waitFor()
}

export async function openWip(page: Page): Promise<void> {
  await toGraph(page)
  await page.getByRole('row', { name: /Uncommitted changes/ }).click()
}

/** Runs git in a folder with the isolated env (for building test repos before launch). */
export function gitIn(env: NodeJS.ProcessEnv, cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

/** A fresh repo under .seed/<name> with one commit per entry: [message, { path: content | null to delete }]. */
export function makeRepo(env: NodeJS.ProcessEnv, name: string, commits: Array<[string, Record<string, string | null>]>): string {
  const dir = join(seed, name)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  gitIn(env, dir, 'init', '-q', '-b', 'main')
  gitIn(env, dir, 'config', 'core.autocrlf', 'false')
  for (const [msg, files] of commits) writeAndCommit(env, dir, msg, files)
  return dir
}

export function writeAndCommit(env: NodeJS.ProcessEnv, dir: string, msg: string, files: Record<string, string | null>): void {
  for (const [p, c] of Object.entries(files)) {
    const f = join(dir, p)
    if (c === null) rmSync(f, { force: true })
    else {
      mkdirSync(join(f, '..'), { recursive: true })
      writeFileSync(f, c)
    }
  }
  gitIn(env, dir, 'add', '-A')
  gitIn(env, dir, 'commit', '-q', '--allow-empty', '-m', msg)
}

type IpcResult<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }

/** Calls the app's IPC from the page, the way the renderer does. Returns the raw Result. */
export async function invoke<T = unknown>(page: Page, channel: string, input: unknown): Promise<IpcResult<T>> {
  return (await page.evaluate(
    ([c, i]) => (window as unknown as { gc: { invoke: (c: string, i: unknown) => Promise<unknown> } }).gc.invoke(c as string, i),
    [channel, input] as const
  )) as IpcResult<T>
}

/** The id the app gave a repo folder. */
export async function repoId(page: Page, path: string): Promise<string> {
  const r = await invoke<{ open: Array<{ id: string; path: string }>; recent: Array<{ id: string; path: string }> }>(page, 'repo.list', {})
  if (!r.ok) throw new Error(r.error.message)
  const norm = (p: string): string => p.split('\\').join('/').toLowerCase()
  const hit = [...r.value.open, ...r.value.recent].find((x) => norm(x.path) === norm(path))
  if (!hit) throw new Error(`repo not known: ${path}`)
  return hit.id
}

/** Opens a file's diff as a click would (GC_TEST=1 only). */
export async function openDiffNow(page: Page, repoId: string, path: string, source: { kind: 'worktree' | 'index' }): Promise<void> {
  await page.evaluate(
    ([r, p, s]) => (window as unknown as { __gcOpenDiff: (r: string, p: string, s: unknown) => void }).__gcOpenDiff(r as string, p as string, s),
    [repoId, path, source] as const
  )
}

/** A JSON snapshot of the renderer's store (only when launched with GC_TEST=1). */
export async function appState<T = Record<string, unknown>>(page: Page): Promise<T> {
  return (await page.evaluate(() => (window as unknown as { __gcState: () => unknown }).__gcState())) as T
}

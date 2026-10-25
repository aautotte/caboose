import { app, BrowserWindow, shell, type IpcMainInvokeEvent } from 'electron'
import { basename, join, resolve } from 'node:path'
import { appendFileSync, cpSync, existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { openDb } from './db'
import { GitRunner } from './git/runner'
import { registerIpc } from './ipc'
import { Repos } from './repos'
import { UndoStack } from './undo'
import { Watcher } from './watch'
import { Askpass } from './askpass'
import { GraphLayouts, Prefs, RefView, RepoPrefs } from './settings'
import { Profiles, PROFILE_KEYS } from './profiles'
import { applyGpuSetting } from './gpu'

// Flags:
//   --view=design            the primitives page
//   --screenshot=<dir>       capture and quit (design page: both themes; app: one PNG per screen)
//   --screens=S01,S04,...    which screens to capture in app view
//   --open=<path>[|<path>]   open these repos at startup (used with the seed repos)
//   --theme=light|dark       screenshot mode only: capture in this theme
//   GC_USER_DATA=<dir>       separate app data folder (screenshots and tests)
//   GC_APP_DATA=<dir>        stand-in for the system's app data folder (the data-move test)
function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}

const view = arg('view') ?? process.env.GC_VIEW ?? 'app'
const screenshotDir = arg('screenshot')
const screens = (arg('screens') ?? '').split(',').filter(Boolean)
const openAtStart = arg('open')
const DB_FILE = 'caboose.db'

/** Earlier names of the app, newest first, with their database files. Their data folders sit next to ours. */
const LEGACY = [
  { name: 'Mergatroid', db: 'mergatroid.db' },
  { name: 'gitclone', db: 'gitclone.db' }
]
// Lock files (Chromium's, LevelDB's) are held open while that version runs and mean nothing in a copy.
const LOCKS = new Set(['lockfile', 'LOCK', 'SingletonLock', 'SingletonCookie', 'SingletonSocket'])

/**
 * After a rename, the data folder follows the new name. Once, before the database opens: if ours has no database
 * and an older name's folder has one, copy it over (settings, profiles, the repository list). The old folder is only
 * read, never changed or deleted.
 */
function moveLegacyData(): void {
  const dir = app.getPath('userData')
  if (existsSync(join(dir, DB_FILE))) return
  const from = LEGACY.map((l) => ({ ...l, path: join(app.getPath('appData'), l.name) })).find((l) => existsSync(join(l.path, l.db)))
  if (!from) return
  try {
    mkdirSync(dir, { recursive: true })
    cpSync(from.path, dir, { recursive: true, filter: (src) => !LOCKS.has(basename(src)) })
    for (const ext of ['', '-wal', '-shm']) {
      if (existsSync(join(dir, `${from.db}${ext}`))) renameSync(join(dir, `${from.db}${ext}`), join(dir, `${DB_FILE}${ext}`))
    }
    logMove(dir, `Copied settings, profiles and the repository list from ${from.path} to ${dir}. The old folder was left as it was.`)
  } catch (e) {
    logMove(dir, `Couldn't copy the data from ${from.path} (${(e as Error).message}); it will be tried again next start. The old folder was left as it was.`)
  }
}

/** To the console, and to data-move.log in the data folder, where it can still be read in a packaged build. */
function logMove(dir: string, message: string): void {
  console.info(`[caboose] ${message}`)
  try {
    appendFileSync(join(dir, 'data-move.log'), `${new Date().toISOString()} ${message}\n`)
  } catch {
    // the console line is enough
  }
}

if (process.env.GC_APP_DATA) {
  // Tests: a throwaway app data folder with our own folder inside it, as on a real machine, so the move below runs.
  app.setPath('appData', resolve(process.env.GC_APP_DATA))
  app.setPath('userData', join(app.getPath('appData'), app.getName()))
}
if (process.env.GC_USER_DATA) app.setPath('userData', resolve(process.env.GC_USER_DATA))
else moveLegacyData()

applyGpuSetting()
// Groups the window under Caboose's own taskbar entry and icon on Windows, not Electron's.
if (process.platform === 'win32') app.setAppUserModelId('app.caboose')

const db = openDb(join(app.getPath('userData'), DB_FILE))
const send = (channel: string, payload: unknown): void => {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, payload)
}
const askpass = new Askpass(
  join(app.getPath('userData'), 'askpass'),
  (e) => send('auth:prompt', e),
  (promptId) => send('auth:closed', { promptId })
)
const runner = new GitRunner(db, askpass)
const profiles = new Profiles(db)

// The profile's name, email and keys go in front of every git command, except the ones a repository sets in its
// own config. Which ones it sets is remembered for a short while per folder; Settings clears it on a change.
const LOCAL_TTL_MS = 30_000
const localKeys = new Map<string, { keys: Set<string>; at: number }>()
async function repoSets(cwd: string): Promise<Set<string>> {
  const hit = localKeys.get(cwd)
  if (hit && Date.now() - hit.at < LOCAL_TTL_MS) return hit.keys
  const pattern = `^(${PROFILE_KEYS.map((k) => k.replace('.', '\\.')).join('|')})$`
  const out = await runner
    .run({ cwd, plain: true, args: ['config', '--local', '--name-only', '--get-regexp', pattern], okCodes: [1] })
    .then((r) => r.stdout)
    .catch(() => '')
  const keys = new Set(out.split('\n').map((l) => l.trim().toLowerCase()).filter(Boolean))
  localKeys.set(cwd, { keys, at: Date.now() })
  return keys
}
runner.setConfigArgs(async (opts) => {
  const pairs = profiles.configPairs(new Set())
  if (!pairs.length) return []
  const skip = opts.repoId ? await repoSets(opts.cwd) : new Set<string>()
  return profiles.configPairs(skip).flatMap(([k, v]) => ['-c', `${k}=${v}`])
})
const undo = new UndoStack(db)
const prefs = new Prefs(db)
const refView = new RefView(db)
const repoPrefs = new RepoPrefs(db)
const layouts = new GraphLayouts(db)
const watcher = new Watcher(runner, (e) => send('repo:changed', e))
const repos = new Repos(
  db,
  runner,
  (r) => watcher.start(r.id, r.path),
  (id) => watcher.stop(id)
)

/** Stops watching this profile's repositories and starts on the next one's. The window reloads after. */
function switchProfile(id: string): void {
  watcher.stopAll()
  profiles.activate(id)
  localKeys.clear()
  for (const r of repos.list().open) if (!r.missing) watcher.start(r.id, r.path)
}

function pruneLogs(): void {
  db.prepare('DELETE FROM activity_log WHERE id NOT IN (SELECT id FROM activity_log ORDER BY started_at DESC LIMIT 5000)').run()
}

function isTrustedSender(e: IpcMainInvokeEvent): boolean {
  const url = e.senderFrame?.url ?? ''
  const dev = process.env.ELECTRON_RENDERER_URL
  return (dev && url.startsWith(dev)) || url.startsWith('file://')
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: '#16181d',
    autoHideMenuBar: true,
    title: 'Caboose',
    // Made by scripts/icons.mjs from resources/icon.svg; Windows takes the .ico with all its sizes. A packaged build
    // carries them next to the app (extraResources in package.json), outside the asar archive.
    icon: join(app.isPackaged ? join(process.resourcesPath, 'icons') : join(__dirname, '../../resources'), process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: !screenshotDir
    }
  })

  win.once('ready-to-show', () => {
    if (!screenshotDir) win.show()
  })

  // Links open in the default browser, http(s) only. The app itself never navigates away.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e) => e.preventDefault())

  const query: Record<string, string> = { view }
  if (screenshotDir) query.shots = '1'
  // Tests read the renderer's state through window.__gcState (read-only snapshot).
  if (process.env.GC_TEST === '1') query.test = '1'
  // Screenshots in a given theme: --theme=light|dark
  if (screenshotDir && arg('theme')) query.theme = arg('theme')!
  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}?${new URLSearchParams(query)}`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), { query })
  }
  return win
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function capture(win: BrowserWindow, file: string, fullPage: boolean): Promise<void> {
  if (!fullPage) {
    // The visible window only; works while the window is hidden.
    const img = await win.webContents.capturePage()
    writeFileSync(file, img.toPNG())
    console.log('wrote', file)
    return
  }
  const dbg = win.webContents.debugger
  if (!dbg.isAttached()) dbg.attach('1.3')
  const { data } = (await dbg.sendCommand('Page.captureScreenshot', { format: 'png', captureBeyondViewport: fullPage })) as { data: string }
  writeFileSync(file, Buffer.from(data, 'base64'))
  console.log('wrote', file)
}

async function captureAll(win: BrowserWindow, dir: string): Promise<void> {
  const out = resolve(dir)
  mkdirSync(out, { recursive: true })
  const js = (code: string): Promise<unknown> => {
    // A frozen page never answers executeJavaScript; fail loudly instead of hanging.
    let timer: NodeJS.Timeout
    return Promise.race([
      win.webContents.executeJavaScript(code).finally(() => clearTimeout(timer)),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`renderer did not answer: ${code.slice(0, 60)}`)), 20_000)
      })
    ])
  }
  await js('document.fonts.ready.then(() => true)')
  if (view === 'design') {
    for (const theme of ['dark', 'light']) {
      await js(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`)
      await wait(400)
      await capture(win, join(out, `primitives-${theme}.png`), true)
    }
    return
  }
  // App screens: the renderer exposes window.__gcShot(id) in shots mode; it returns once the screen has settled.
  for (const id of screens) {
    const ok = await js(`window.__gcShot ? window.__gcShot(${JSON.stringify(id)}) : false`)
    if (!ok) {
      console.log('skipped', id)
      continue
    }
    await wait(500)
    await capture(win, join(out, `${id}.png`), false)
  }
}

app.whenReady().then(async () => {
  pruneLogs()
  for (const p of (openAtStart ?? '').split('|').filter(Boolean)) await repos.open(p).catch((e) => console.error('open failed', e))
  for (const r of repos.list().open) if (!r.missing) watcher.start(r.id, r.path)

  registerIpc({ db, runner, repos, undo, prefs, refView, repoPrefs, layouts, askpass, profiles, switchProfile, forgetRepoConfig: () => localKeys.clear(), tmpDir: join(app.getPath('userData'), 'tmp'), isTrustedSender })
  const win = createWindow()

  if (screenshotDir) {
    // Surface renderer problems in the terminal while capturing.
    win.webContents.on('console-message', (e) => console.log(`[renderer:${e.level}] ${e.message}`))
    win.webContents.on('render-process-gone', (_e, d) => console.error('renderer gone', d.reason))
    win.webContents.on('did-fail-load', (_e, code, desc) => console.error('load failed', code, desc))
    win.webContents.once('did-finish-load', () => {
      wait(1200)
        .then(() => captureAll(win, screenshotDir))
        .catch((err) => {
          console.error(err)
          process.exitCode = 1
        })
        .finally(() => app.quit())
    })
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  watcher.stopAll()
  askpass.close()
  if (process.platform !== 'darwin') app.quit()
})

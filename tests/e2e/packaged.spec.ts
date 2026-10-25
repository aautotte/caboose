// The packaged app (npm run dist), not the dev build: it starts, finds its icon, commits, and its credential helper
// still works (git re-runs the app's own executable as Node for that). Skipped when there's no build in dist/.
import { test, expect } from '@playwright/test'
import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { app, dialog, invoke, launch, makeRepo, openWip, seed, type Harness } from './harness'

function packagedExe(): string | null {
  const dist = join(app, 'dist')
  if (!existsSync(dist)) return null
  for (const dir of readdirSync(dist).filter((d) => d.endsWith('-unpacked') || d === 'mac' || d === 'mac-arm64')) {
    for (const name of ['Caboose.exe', 'caboose', 'Caboose.app/Contents/MacOS/Caboose']) {
      const p = join(dist, dir, name)
      if (existsSync(p)) return p
    }
  }
  return null
}

const exe = packagedExe()
let h: Harness
let repo = ''

test.describe.configure({ mode: 'serial' })
test.skip(!exe, 'no packaged build in dist/ (run npm run dist first)')

test.beforeAll(async () => {
  h = await launch('packaged', {
    exe: exe!,
    open: [join(seed, 'boxed')],
    setup: (env) => {
      repo = makeRepo(env, 'boxed', [['Start', { 'a.txt': 'a\n' }]])
    }
  })
  await h.page.getByRole('tab', { name: 'boxed' }).click()
})
test.afterAll(async () => {
  await h?.close()
})
test.afterEach(() => h.expectClean())

test('PKG-H1: the packaged app starts with its name and its own icon files', async () => {
  expect(await h.page.title()).toBe('Caboose')
  const icons = await h.electronApp.evaluate(({ app: a }) => ({ packaged: a.isPackaged, dir: process.resourcesPath }))
  expect(icons.packaged).toBe(true)
  expect(existsSync(join(icons.dir, 'icons', process.platform === 'win32' ? 'icon.ico' : 'icon.png'))).toBe(true)
})

test('PKG-H2: committing works in the packaged app', async () => {
  writeFileSync(join(repo, 'b.txt'), 'b\n')
  await openWip(h.page)
  await h.page.getByRole('button', { name: 'Stage all', exact: true }).click()
  await h.page.getByLabel('Commit summary').fill('From the packaged app')
  await h.page.getByRole('form', { name: 'Commit' }).getByRole('button', { name: /^Commit/ }).click()
  await expect.poll(() => h.git(repo, 'log', '-1', '--format=%s')).toBe('From the packaged app')
})

test('PKG-H3: the credential prompt reaches the window from the packaged app', async () => {
  const server: Server = createServer((_req, res) => {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="e2e"' })
    res.end()
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  try {
    h.git(repo, 'remote', 'add', 'locked', `http://127.0.0.1:${(server.address() as AddressInfo).port}/locked.git`)
    const id = (await invoke<{ open: Array<{ id: string }> }>(h.page, 'repo.list', {}))
    const repoId = id.ok ? id.value.open[0].id : ''
    const fetching = invoke(h.page, 'remote.fetch', { repoId, opId: crypto.randomUUID() })
    await expect(dialog(h.page).getByRole('heading', { name: 'Sign in to the remote' })).toBeVisible({ timeout: 30_000 })
    await dialog(h.page).getByRole('button', { name: 'Cancel' }).click()
    expect(await fetching).toMatchObject({ ok: false })
  } finally {
    server.close()
    h.git(repo, 'remote', 'remove', 'locked')
  }
})

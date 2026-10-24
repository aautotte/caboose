// F06 push, F07 pull / fetch: rejected pushes, diverged branches, local changes in the way, auth and offline.
import { test, expect } from '@playwright/test'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { demo, dialog, gitIn, grid, launch, openWip, seed, toGraph, writeAndCommit, type Harness } from './harness'

let h: Harness
const other = join(seed, 'teammate')
const toolbar = (name: string | RegExp) => h.page.getByRole('toolbar', { name: 'Repository actions' }).getByRole('button', { name })
const toasts = () => h.page.getByRole('region', { name: /Notifications/ })
/** A teammate pushes a commit to origin/main. */
function teammatePushes(msg: string, files: Record<string, string>): void {
  gitIn(h.env, other, 'pull', '-q', '--rebase')
  writeAndCommit(h.env, other, msg, files)
  gitIn(h.env, other, 'push', '-q', 'origin', 'main')
}

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => {
  h = await launch('sync', {
    open: [demo],
    setup: (env) => {
      rmSync(other, { recursive: true, force: true })
      gitIn(env, seed, 'clone', '-q', join(seed, 'origin.git'), other)
      gitIn(env, other, 'config', 'user.name', 'Teammate')
      gitIn(env, other, 'config', 'user.email', 'mate@example.com')
    }
  })
  await h.page.getByRole('tab', { name: 'demo' }).click()
  await grid(h.page).waitFor()
  // Start from a clean tree; the seed leaves changes behind on purpose.
  h.git(demo, 'stash', 'push', '--all', '-q', '-m', 'sync tests')
  await h.page.getByRole('row', { name: /Uncommitted changes/ }).waitFor({ state: 'detached' })
})
test.afterAll(async () => {
  await h.close()
})
test.afterEach(() => h.expectClean())

test('F06-E1 a rejected push offers a force push; unseen commits are protected until fetched', async () => {
  teammatePushes('Teammate change', { 'mate.txt': 'from a teammate\n' })
  await toolbar('Push').click()
  await expect(dialog(h.page).getByRole('heading', { name: 'Push was rejected' })).toBeVisible()
  await dialog(h.page).getByRole('button', { name: 'Force push' }).click()
  // The teammate's commit was never fetched, so the lease refuses: say so, don't offer the same dialog again.
  await expect(toasts()).toContainText(/since your last fetch/i)
  await expect(dialog(h.page)).toHaveCount(0)
  await toasts().getByRole('button', { name: 'Dismiss' }).first().click()
  // After fetching, the force push goes through.
  await h.page.keyboard.press('Control+l')
  await expect.poll(h.gitOr(demo, 'rev-parse', 'origin/main')).toBe(h.git(other, 'rev-parse', 'HEAD'))
  await toolbar('Push').click()
  await dialog(h.page).getByRole('button', { name: 'Force push' }).click()
  await expect.poll(h.gitOr(demo, 'rev-parse', 'origin/main')).toBe(h.git(demo, 'rev-parse', 'HEAD'))
  expect(h.git(join(seed, 'origin.git'), 'log', '-1', '--format=%s', 'main')).toBe('Print the real temperature in the CLI')
})

test('F06-E4 double-clicking Push pushes once, with no error', async () => {
  writeAndCommit(h.env, demo, 'Local one', { 'local1.txt': '1\n' })
  await toolbar('Push').dblclick()
  await expect.poll(h.gitOr(demo, 'rev-parse', 'origin/main')).toBe(h.git(demo, 'rev-parse', 'HEAD'))
  await expect(toasts().getByText(/failed|rejected/i)).toHaveCount(0)
})

test('F07-H1 pull brings in a teammate’s commit', async () => {
  teammatePushes('Teammate adds docs', { 'docs.md': '# Docs\n' })
  await toolbar(/^Pull \(/).click()
  await expect.poll(h.gitOr(demo, 'log', '-1', '--format=%s')).toBe('Teammate adds docs')
  await expect(grid(h.page).getByRole('row', { name: /^Teammate adds docs/ })).toBeVisible()
})

test('F07-E1 fast-forward only refuses when both sides have new commits', async () => {
  teammatePushes('Teammate again', { 'mate2.txt': '2\n' })
  writeAndCommit(h.env, demo, 'Mine meanwhile', { 'mine.txt': 'mine\n' })
  const head = h.git(demo, 'rev-parse', 'HEAD')
  await h.page.getByRole('button', { name: 'Pull options' }).click()
  await h.page.getByRole('menuitem', { name: 'Pull (fast-forward only)' }).click()
  await expect(toasts().getByText(/Can’t fast-forward/)).toBeVisible()
  expect(h.git(demo, 'rev-parse', 'HEAD')).toBe(head)
})

test('F07-E3 pull with rebase replays my commit on top', async () => {
  await h.page.getByRole('button', { name: 'Pull options' }).click()
  await h.page.getByRole('menuitem', { name: 'Pull (rebase)' }).click()
  // HEAD's summary was already "Mine meanwhile" before; what changes is what it sits on.
  await expect.poll(h.gitOr(demo, 'log', '-1', '--format=%s', 'HEAD~1')).toBe('Teammate again')
  expect(h.git(demo, 'log', '-1', '--format=%s')).toBe('Mine meanwhile')
  // Share it so later tests start in sync.
  await toolbar('Push').click()
  await expect.poll(h.gitOr(demo, 'rev-parse', 'origin/main')).toBe(h.git(demo, 'rev-parse', 'HEAD'))
})

test('F07-E2 local changes that a pull would overwrite are kept, with a clear message', async () => {
  teammatePushes('Teammate edits the README', { 'README.md': '# skycast\n\nEdited by a teammate.\n' })
  writeFileSync(join(demo, 'README.md'), '# skycast\n\nMy unsaved idea.\n')
  await toolbar(/^Pull \(/).click()
  await expect(toasts().getByText('Pull failed')).toBeVisible()
  await expect(toasts()).toContainText(/overwritten/i)
  expect(readFileSync(join(demo, 'README.md'), 'utf8')).toContain('My unsaved idea.')
  await toasts().getByRole('button', { name: 'Dismiss' }).first().click()
  h.git(demo, 'checkout', '--', 'README.md')
  await toolbar(/^Pull \(/).click()
  await expect.poll(h.gitOr(demo, 'log', '-1', '--format=%s')).toBe('Teammate edits the README')
})

test('F07-E4 fetching from a server that can’t be reached shows in the status bar, not as a modal', async () => {
  h.git(demo, 'remote', 'add', 'offline', 'http://127.0.0.1:9/nothing.git')
  await h.page.getByRole('button', { name: 'Pull options' }).click()
  await h.page.getByRole('menuitem', { name: /Fetch all remotes/ }).click()
  await expect(h.page.getByRole('contentinfo').getByRole('button', { name: /Fetch failed/ })).toBeVisible({ timeout: 30_000 })
  await expect(h.page.getByRole('dialog')).toHaveCount(0)
  h.git(demo, 'remote', 'remove', 'offline')
  await toasts().getByRole('button', { name: 'Dismiss' }).first().click().catch(() => {})
})

test('F06-N1 cancelling the password prompt fails the push cleanly; a wrong password is reported', async () => {
  let attempts = 0
  const server: Server = createServer((req, res) => {
    attempts++
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="e2e"' })
    res.end()
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as AddressInfo).port
  try {
    h.git(demo, 'remote', 'add', 'locked', `http://127.0.0.1:${port}/locked.git`)
    // Cancel at the first question.
    await h.page.keyboard.press('Control+l')
    await expect(dialog(h.page).getByRole('heading', { name: 'Sign in to the remote' })).toBeVisible()
    await dialog(h.page).getByRole('button', { name: 'Cancel' }).click()
    await expect(h.page.getByRole('contentinfo').getByRole('button', { name: /Fetch failed/ })).toBeVisible({ timeout: 30_000 })
    await expect(dialog(h.page)).toHaveCount(0)
    // Wrong password: the server keeps saying no; the app says the credentials weren't accepted and stops asking.
    await toasts().getByRole('button', { name: 'Dismiss' }).first().click().catch(() => {})
    await h.page.keyboard.press('Control+l')
    await dialog(h.page).getByLabel('Username').fill('me')
    await dialog(h.page).getByRole('button', { name: 'Continue' }).click()
    await dialog(h.page).getByLabel('Password or access token').fill('wrong')
    await dialog(h.page).getByRole('button', { name: 'Continue' }).click()
    await expect(toasts()).toContainText(/credentials/i, { timeout: 30_000 })
    await expect(dialog(h.page)).toHaveCount(0)
  } finally {
    server.close()
    h.git(demo, 'remote', 'remove', 'locked')
  }
  expect(attempts).toBeGreaterThan(0)
})

test('sync: the app is still usable afterwards', async () => {
  await toGraph(h.page)
  writeFileSync(join(demo, 'after-sync.txt'), 'ok\n')
  await openWip(h.page)
  await expect(h.page.getByRole('listbox', { name: /Not staged/ }).getByRole('option', { name: /after-sync/ })).toBeVisible()
})

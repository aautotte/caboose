// The should-have features, end to end against real git, on a fresh seed repo.
// Git runs with no system or global config (a throwaway one instead), so credential managers and personal
// settings can't change the outcome, and the credential prompt test reaches our own askpass.
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join, resolve } from 'node:path'

const app = resolve(__dirname, '..', '..')
const seed = join(app, '.seed')
const demo = join(seed, 'demo')
const gitconfig = join(app, '.e2e-gitconfig')
const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: gitconfig }
const git = (...args: string[]): string => execFileSync('git', args, { cwd: demo, encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const subject = (rev = 'HEAD'): string => git('log', '-1', '--format=%s', rev)
/** For expect.poll: a failing git command reads as an empty answer, so the poll keeps waiting. */
const gitOr = (...args: string[]) => (): string => {
  try {
    return git(...args)
  } catch {
    return ''
  }
}

// Each test builds on the repo state the previous one left, so a failure stops the run rather than
// letting Playwright restart the worker (which would reseed and confuse every later test).
test.describe.configure({ mode: 'serial' })

let electronApp: ElectronApplication
let page: Page

test.beforeAll(async () => {
  writeFileSync(gitconfig, '[user]\n\tname = E2E\n\temail = e2e@example.com\n[init]\n\tdefaultBranch = main\n')
  execFileSync(process.execPath, [join(app, 'scripts', 'seed.mjs')], { stdio: 'ignore', env })
  const userData = join(seed, 'userdata-e2e-features')
  rmSync(userData, { recursive: true, force: true })
  electronApp = await electron.launch({ cwd: app, args: ['.', `--open=${demo}`], env: { ...env, GC_USER_DATA: userData } })
  page = await electronApp.firstWindow()
  page.on('pageerror', (e) => console.error('pageerror', e))
  await page.getByRole('tab', { name: 'demo' }).click()
  await page.getByRole('row', { name: /Uncommitted changes/ }).waitFor()
})

test.afterAll(async () => {
  await electronApp?.close()
  rmSync(gitconfig, { force: true })
})

const toolbar = (label: string | RegExp) => page.getByRole('toolbar', { name: 'Repository actions' }).getByRole('button', { name: label })
const dialog = () => page.getByRole('dialog')
const commitRow = (summary: string) => page.getByRole('grid', { name: 'Commit history' }).getByRole('row', { name: new RegExp(`^${summary.replace(/[()]/g, '\\$&')}`) })
async function menu(target: ReturnType<Page['locator']>, item: string | RegExp): Promise<void> {
  await target.click({ button: 'right' })
  await page.getByRole('menuitem', { name: item }).click()
}
async function toGraph(): Promise<void> {
  // Esc clears a line pick first, then closes the open view.
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await page.getByRole('grid', { name: 'Commit history' }).waitFor()
}
async function openUnstaged(file: RegExp): Promise<void> {
  await toGraph()
  await page.getByRole('row', { name: /Uncommitted changes/ }).click()
  await page.getByRole('listbox', { name: /Not staged/ }).getByRole('option', { name: file }).click()
}
const diffRow = (path: string, text: string) => page.getByRole('region', { name: `Changes in ${path}` }).getByRole('row').filter({ hasText: text })

test('stage a single line, then unstage the block', async () => {
  await openUnstaged(/README\.md/)
  await diffRow('README.md', '## Install').getByTitle(/Pick this line/).click()
  await page.getByRole('button', { name: 'Stage 1 line' }).click()
  await expect.poll(() => git('diff', '--cached', '--', 'README.md')).toContain('+## Install')
  expect(git('diff', '--cached', '--', 'README.md')).not.toContain('npm install -g skycast')
  expect(git('diff', '--', 'README.md')).toContain('+npm install -g skycast')

  await page.getByRole('listbox', { name: 'Staged', exact: true }).getByRole('option', { name: /README\.md/ }).click()
  await page.getByRole('button', { name: 'Unstage block' }).click()
  await expect.poll(() => git('diff', '--cached', '--', 'README.md')).toBe('')
})

test('discarding lines can be undone', async () => {
  await openUnstaged(/README\.md/)
  await diffRow('README.md', 'npm install -g skycast').getByTitle(/Pick this line/).click()
  await page.getByRole('button', { name: 'Discard 1 line' }).click()
  await dialog().getByRole('button', { name: 'Discard' }).click()
  // Git rewrites the file by removing and recreating it, so for a moment it may not be there.
  const readme = (): string => {
    try {
      return readFileSync(join(demo, 'README.md'), 'utf8')
    } catch {
      return ''
    }
  }
  // The picked line goes, the rest of the file stays.
  await expect.poll(() => readme().includes('## Install') && !readme().includes('npm install -g skycast')).toBe(true)
  await toolbar(/^Undo: Discard 1 line/).click()
  await expect.poll(readme).toContain('npm install -g skycast')
})

test('stash with a name, then pop it', async () => {
  await toGraph()
  await toolbar('Stash your changes').click()
  await dialog().getByLabel('Name (optional)').fill('e2e stash')
  await dialog().getByRole('button', { name: 'Stash', exact: true }).click()
  await expect.poll(() => git('stash', 'list')).toContain('e2e stash')
  expect(git('status', '--porcelain')).toBe('')

  await toolbar(/^Pop the newest stash: .*e2e stash/).click()
  await expect.poll(() => git('stash', 'list')).not.toContain('e2e stash')
  expect(git('status', '--porcelain')).toContain('src/wind.js')
  expect(git('diff', '--cached', '--name-only')).toContain('src/format.js')
})

test('ignore a new file', async () => {
  await page.getByRole('row', { name: /Uncommitted changes/ }).click()
  await menu(page.getByRole('listbox', { name: /Not staged/ }).getByRole('option', { name: /wind\.js/ }), 'Ignore…')
  await dialog().getByRole('button', { name: 'Add to .gitignore' }).click()
  await expect.poll(() => readFileSync(join(demo, '.gitignore'), 'utf8')).toContain('/src/wind.js')
  expect(git('status', '--porcelain')).not.toContain('wind.js')
})

test('create an annotated tag, delete it, undo the delete', async () => {
  await menu(commitRow('Print the real temperature in the CLI'), 'Create tag here…')
  await dialog().getByLabel('Tag name').fill('v0.3.0')
  await dialog().getByLabel('Message (optional)').fill('Live temperatures')
  await dialog().getByRole('button', { name: 'Create tag' }).click()
  await expect.poll(() => git('tag', '-l', 'v0.3.0')).toBe('v0.3.0')
  expect(git('cat-file', '-t', 'v0.3.0')).toBe('tag')

  await menu(page.getByRole('treeitem', { name: 'v0.3.0' }), 'Delete tag…')
  await dialog().getByRole('button', { name: 'Delete tag' }).click()
  await expect.poll(() => git('tag', '-l', 'v0.3.0')).toBe('')
  await toolbar(/^Undo: Delete tag v0\.3\.0/).click()
  await expect.poll(() => git('tag', '-l', 'v0.3.0')).toBe('v0.3.0')
  expect(git('cat-file', '-t', 'v0.3.0')).toBe('tag')
})

test('reset to an older commit, then undo', async () => {
  const head = git('rev-parse', 'HEAD')
  const target = git('rev-parse', 'HEAD~1')
  await menu(commitRow('Update the changelog (6)'), /^Reset main to this commit/)
  await dialog().getByRole('button', { name: 'Reset', exact: true }).click()
  await expect.poll(() => git('rev-parse', 'HEAD')).toBe(target)
  await toolbar(/^Undo: Reset to/).click()
  await expect.poll(() => git('rev-parse', 'HEAD')).toBe(head)
})

test('revert, then cherry-pick from another branch', async () => {
  // Revert and cherry-pick need a clean index; put the uncommitted work aside first.
  git('stash', 'push', '--all', '-q', '-m', 'e2e setup')
  await page.getByRole('row', { name: /Uncommitted changes/ }).waitFor({ state: 'detached' })

  await menu(commitRow('Print the real temperature in the CLI'), 'Revert this commit')
  await expect.poll(() => subject()).toBe('Revert "Print the real temperature in the CLI"')
  await toolbar(/^Undo: Revert/).click()
  await expect.poll(() => subject()).toBe('Print the real temperature in the CLI')

  await menu(commitRow('Time out slow API calls after 5 seconds'), 'Cherry-pick onto main')
  await expect.poll(() => subject()).toBe('Time out slow API calls after 5 seconds')
  expect(subject('HEAD~1')).toBe('Print the real temperature in the CLI')
})

test('interactive rebase: reword one commit and squash the next into it', async () => {
  const base = git('rev-parse', 'HEAD~2')
  const before = git('rev-parse', 'HEAD')
  await menu(commitRow('Update the changelog (6)'), /^Rewrite main after this commit/)
  const list = page.getByRole('list', { name: 'Commits, oldest first' })
  await expect(list.getByRole('listitem')).toHaveCount(2)
  await list.getByRole('listitem').nth(0).getByRole('radio', { name: 'Reword' }).click()
  await dialog().getByLabel('Summary').fill('Show the live temperature')
  await dialog().getByRole('button', { name: 'Save message' }).click()
  await list.getByRole('listitem').nth(1).getByRole('radio', { name: 'Squash' }).click()
  await page.getByRole('button', { name: 'Start rebase' }).click()

  // Wait for the whole rebase: right after the reword step HEAD already has the new summary, before the squash.
  await expect(page.getByRole('list', { name: 'Commits, oldest first' })).toHaveCount(0)
  await expect.poll(gitOr('log', '-1', '--format=%B')).toContain('Time out slow API calls after 5 seconds')
  expect(subject()).toBe('Show the live temperature')
  expect(git('rev-parse', 'HEAD~1')).toBe(base)
  expect(git('show', 'HEAD:src/fetch.js')).toContain('AbortSignal.timeout')

  await toolbar(/^Undo: Interactive rebase/).click()
  await expect.poll(() => git('rev-parse', 'HEAD')).toBe(before)
})

test('add a remote, remove it, undo the removal', async () => {
  const url = join(seed, 'origin.git')
  await page.getByRole('button', { name: 'Add a remote' }).click()
  await dialog().getByLabel('Name').fill('backup')
  await dialog().getByLabel('URL').fill(url)
  await dialog().getByRole('button', { name: 'Add remote' }).click()
  await expect.poll(() => git('remote')).toContain('backup')
  await expect.poll(() => git('branch', '-r')).toContain('backup/main')

  await menu(page.getByRole('treeitem', { name: 'backup' }), 'Remove backup…')
  await dialog().getByRole('button', { name: 'Remove remote' }).click()
  await expect.poll(() => git('remote')).not.toContain('backup')
  await toolbar(/^Undo: Remove remote backup/).click()
  await expect.poll(gitOr('remote', 'get-url', 'backup')).toBe(url)
})

test('file history and blame', async () => {
  await commitRow('Print the real temperature in the CLI').click()
  await menu(page.getByRole('listbox', { name: 'Changed files' }).getByRole('option', { name: /cli\.js/ }), 'File history')
  const history = page.getByRole('region', { name: 'History of src/cli.js' })
  await expect(history.getByRole('option')).toHaveCount(2)
  await history.getByRole('option').nth(1).click()
  await expect(page.getByRole('region', { name: 'Changes in src/cli.js' })).toBeVisible()

  await page.getByRole('button', { name: 'Blame the current version' }).click()
  const blame = page.getByRole('table', { name: /^src\/cli\.js, \d+ lines$/ })
  await expect(blame).toBeVisible()
  await expect(blame.getByRole('button', { name: /Sam Lee/ }).first()).toBeVisible()
  await page.keyboard.press('Escape')
})

test('show only one branch, then everything again', async () => {
  // After the cherry-pick, the timeout commit exists twice: the original on fix/timeout and the copy on main.
  const rows = commitRow('Time out slow API calls after 5 seconds')
  await expect(rows).toHaveCount(2)
  await menu(page.getByRole('tree', { name: 'Local branches' }).getByRole('treeitem', { name: /^main/ }), 'Show only this (and HEAD)')
  await expect(page.getByText('Graph shows only one branch')).toBeVisible()
  await expect(rows).toHaveCount(1)
  await page.getByRole('button', { name: 'Show all' }).click()
  await expect(page.getByText('Graph shows only one branch')).toHaveCount(0)
  await expect(rows).toHaveCount(2)
})

test('a remote that asks for a password gets an in-app prompt', async () => {
  let seen: string | undefined
  const server: Server = createServer((req, res) => {
    if (!req.headers.authorization) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="e2e"' })
      return res.end()
    }
    seen = req.headers.authorization
    res.writeHead(404)
    res.end()
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as AddressInfo).port
  try {
    git('remote', 'add', 'locked', `http://127.0.0.1:${port}/locked.git`)
    await page.keyboard.press('Control+l')
    await expect(dialog().getByRole('heading', { name: 'Sign in to the remote' })).toBeVisible()
    await dialog().getByLabel('Username').fill('e2e-user')
    await dialog().getByRole('button', { name: 'Continue' }).click()
    await expect(dialog().getByLabel('Password or access token')).toBeVisible()
    await expect(dialog().getByLabel('Password or access token')).toHaveAttribute('type', 'password')
    await dialog().getByLabel('Password or access token').fill('e2e-secret')
    await dialog().getByRole('button', { name: 'Continue' }).click()
    await expect.poll(() => seen).toBe('Basic ' + Buffer.from('e2e-user:e2e-secret').toString('base64'))
  } finally {
    server.close()
    git('remote', 'remove', 'locked')
  }
})

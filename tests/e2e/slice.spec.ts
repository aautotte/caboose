// The vertical slice, end to end against real git: stage, commit, push, undo, and resolving a merge conflict.
// Runs on fresh seed repos (`npm run seed`) with a throwaway app-data folder.
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { join, resolve } from 'node:path'

const app = resolve(__dirname, '..', '..')
const seed = join(app, '.seed')
const git = (repo: string, ...args: string[]): string => execFileSync('git', args, { cwd: join(seed, repo), encoding: 'utf8' }).trim()

let electronApp: ElectronApplication
let page: Page

test.beforeAll(async () => {
  execFileSync(process.execPath, [join(app, 'scripts', 'seed.mjs')], { stdio: 'ignore' })
  const userData = join(seed, 'userdata-e2e')
  rmSync(userData, { recursive: true, force: true })
  electronApp = await electron.launch({
    cwd: app,
    args: ['.', `--open=${join(seed, 'demo')}|${join(seed, 'conflict')}`],
    env: { ...process.env, GC_USER_DATA: userData }
  })
  page = await electronApp.firstWindow()
  page.on('pageerror', (e) => console.error('pageerror', e))
  await page.getByRole('tab', { name: 'demo' }).click()
})

test.afterAll(async () => {
  await electronApp?.close()
})

test('stage everything, commit, and push', async () => {
  await page.getByRole('row', { name: /Uncommitted changes/ }).click()
  await page.getByRole('button', { name: 'Stage all', exact: true }).click()
  await expect(page.getByRole('listbox', { name: 'Staged', exact: true }).getByRole('option')).toHaveCount(3)
  await page.getByLabel('Commit summary').fill('Add wind formatting and install notes')
  await page.getByRole('button', { name: 'Commit 3 files' }).click()
  await expect.poll(() => git('demo', 'log', '-1', '--format=%s')).toBe('Add wind formatting and install notes')
  expect(git('demo', 'status', '--porcelain')).toBe('')

  await page.getByRole('button', { name: 'Push', exact: true }).click()
  await expect.poll(() => git('demo', 'rev-parse', 'origin/main')).toBe(git('demo', 'rev-parse', 'main'))
  await expect.poll(() => execFileSync('git', ['--git-dir', join(seed, 'origin.git'), 'log', '-1', '--format=%s', 'main'], { encoding: 'utf8' }).trim()).toBe(
    'Add wind formatting and install notes'
  )
})

test('undo a commit keeps the changes staged, redo puts it back', async () => {
  await page.getByRole('row', { name: /Uncommitted changes/ }).waitFor({ state: 'detached' }).catch(() => {})
  // Make a new local commit through the app, then undo it.
  execFileSync('git', ['-C', join(seed, 'demo'), 'commit', '--allow-empty', '-q', '-m', 'placeholder'], {})
  const before = git('demo', 'rev-parse', 'HEAD')
  await page.getByRole('tab', { name: 'demo' }).click()
  execFileSync(process.execPath, ['-e', `require('fs').appendFileSync(${JSON.stringify(join(seed, 'demo', 'README.md'))}, '\\nUndo test.\\n')`])
  await page.getByRole('row', { name: /Uncommitted changes/ }).click()
  await page.getByRole('button', { name: 'Stage all', exact: true }).click()
  await expect.poll(() => git('demo', 'diff', '--cached', '--name-only')).toContain('README.md')
  const staged = git('demo', 'diff', '--cached', '--name-only')
  await page.getByLabel('Commit summary').fill('Commit to undo')
  await page.getByRole('button', { name: /^Commit \d+ files?$/ }).click()
  await expect.poll(() => git('demo', 'log', '-1', '--format=%s')).toBe('Commit to undo')

  await page.getByRole('button', { name: /^Undo: Commit/ }).click()
  await expect.poll(() => git('demo', 'rev-parse', 'HEAD')).toBe(before)
  expect(git('demo', 'diff', '--cached', '--name-only')).toBe(staged)

  await page.getByRole('button', { name: /^Redo: Commit/ }).click()
  await expect.poll(() => git('demo', 'log', '-1', '--format=%s')).toBe('Commit to undo')
})

test('discard is undoable', async () => {
  execFileSync(process.execPath, ['-e', `require('fs').writeFileSync(${JSON.stringify(join(seed, 'demo', 'scratch.txt'))}, 'temp')`])
  await page.getByRole('row', { name: /Uncommitted changes/ }).click()
  await page.getByRole('button', { name: 'Discard all changes' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Discard' }).click()
  await expect.poll(() => git('demo', 'status', '--porcelain')).toBe('')
  await page.getByRole('button', { name: /^Undo: Discard/ }).click()
  await expect.poll(() => git('demo', 'status', '--porcelain')).toContain('scratch.txt')
})

test('resolve a merge conflict and finish the merge', async () => {
  await page.getByRole('tab', { name: 'conflict' }).click()
  await page.getByRole('row', { name: /Uncommitted changes/ }).click()
  await expect(page.getByText(/Resolve 2 conflicted files/)).toBeVisible()

  // notes.md: pick theirs line by line in the merge tool, save.
  await page.getByRole('listbox', { name: /Not staged/ }).getByRole('option', { name: /notes\.md/ }).click()
  await page.getByRole('region', { name: /Resolve conflicts in notes\.md/ }).waitFor()
  await page.getByRole('checkbox', { name: 'Use this line' }).nth(1).click()
  await page.getByRole('button', { name: 'Save result' }).click()

  // settings.js: keep the whole file from main.
  await page.getByRole('listbox', { name: /Not staged/ }).getByRole('option', { name: /settings\.js/ }).click()
  await page.getByRole('button', { name: 'Keep yours' }).click()

  await page.getByRole('button', { name: 'Continue' }).click()
  await expect.poll(() => git('conflict', 'log', '-1', '--format=%P').split(' ').length).toBe(2)
  expect(git('conflict', 'show', 'HEAD:notes.md')).toContain('Lower the timeout and retry more.')
  expect(git('conflict', 'show', 'HEAD:settings.js')).toContain("city: 'Porto'")
})

// F73: more ways to stash. Some files only (a new file among them), everything while keeping the staged changes in
// the folder, and a branch made from a stash on the commit it was made on.
import { test, expect } from '@playwright/test'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dialog, gitIn, launch, makeRepo, menu, openWip, seed, type Harness } from './harness'

let h: Harness
const repo = join(seed, 'stashopts')
const file = (p: string): string => join(repo, p)

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => {
  h = await launch('stashopts', {
    open: [repo],
    setup: (env) => {
      makeRepo(env, 'stashopts', [['Base', { 'a.txt': 'a\n', 'b.txt': 'b\n', 'c.txt': 'c\n' }]])
      writeFileSync(file('a.txt'), 'a, changed\n')
      writeFileSync(file('b.txt'), 'b, staged\n')
      gitIn(env, repo, 'add', 'b.txt')
      writeFileSync(file('c.txt'), 'c, changed\n')
      writeFileSync(file('n.txt'), 'new\n')
    }
  })
  await h.page.getByRole('tab', { name: 'stashopts', exact: true }).click()
})
test.afterAll(async () => {
  await h.close()
})
test.afterEach(() => h.expectClean())

const toasts = () => h.page.getByRole('region', { name: /Notifications/ })
const refocus = () => h.page.evaluate(() => window.dispatchEvent(new Event('focus')))
const status = (): string => h.git(repo, 'status', '--porcelain')
const files = () => dialog(h.page).getByRole('list', { name: 'Files to stash' })

test('F73-H1: Stash this file starts with that file picked; a new file picked goes too', async () => {
  await openWip(h.page)
  await menu(h.page, h.page.getByRole('listbox', { name: /Not staged/ }).getByRole('option', { name: /a\.txt/ }), 'Stash this file…')
  await expect(dialog(h.page).getByRole('radio', { name: 'Some files' })).toHaveAttribute('aria-checked', 'true')
  await expect(files().getByRole('checkbox', { name: 'a.txt', exact: true })).toBeChecked()
  await expect(files().getByRole('checkbox', { name: 'c.txt', exact: true })).not.toBeChecked()
  await files().getByRole('checkbox', { name: 'n.txt (new)' }).click()
  // b.txt is staged: git copies it into the stash, and it stays staged here.
  await expect(dialog(h.page).getByText(/^Staged changes to 1 other file are copied into the stash too/)).toBeVisible()
  await dialog(h.page).getByLabel('Name (optional)').fill('just a')
  await dialog(h.page).getByRole('button', { name: 'Stash 2 files' }).click()
  await expect(toasts().getByText('Stashed 2 files')).toBeVisible()
  expect(status()).toBe('M  b.txt\n M c.txt')
  expect(existsSync(file('n.txt'))).toBe(false)
  expect(h.git(repo, 'stash', 'show', '--include-untracked', '--name-only', 'stash@{0}')).toBe('a.txt\nb.txt\nn.txt')
})

test('F73-H2: Keep the staged changes in the folder too stashes them and leaves them staged', async () => {
  await h.page.getByRole('button', { name: 'Stash your changes' }).click()
  await dialog(h.page).getByRole('checkbox', { name: 'Keep the staged changes in the folder too' }).click()
  await dialog(h.page).getByRole('button', { name: 'Stash', exact: true }).click()
  await expect(toasts().getByText('Changes stashed')).toBeVisible()
  expect(status()).toBe('M  b.txt')
  expect(h.git(repo, 'stash', 'show', '--name-only', 'stash@{0}')).toBe('b.txt\nc.txt')
})

test('F73-H3: Create a branch from this stash starts at the commit it was made on, with its changes back', async () => {
  const base = h.git(repo, 'rev-parse', 'HEAD')
  h.git(repo, 'commit', '-q', '-m', 'Later')
  await refocus()
  await expect(h.page.getByRole('row', { name: /^Uncommitted changes/ })).toHaveCount(0)
  await menu(h.page, h.page.getByRole('tree', { name: 'Stashes' }).getByRole('treeitem', { name: 'just a' }), 'Create a branch from this stash…')
  await dialog(h.page).getByRole('textbox', { name: 'Branch name' }).fill('from-stash')
  await dialog(h.page).getByRole('button', { name: 'Create branch' }).click()
  await expect(toasts().getByText('Switched to from-stash, made from the stash')).toBeVisible()
  expect(h.git(repo, 'branch', '--show-current')).toBe('from-stash')
  expect(h.git(repo, 'rev-parse', 'HEAD')).toBe(base)
  // With the copy of b.txt's staged change that git put in the stash.
  expect(status()).toBe('M a.txt\nM  b.txt\n?? n.txt')
  expect(h.git(repo, 'stash', 'list', '--format=%gs')).not.toContain('just a')
})

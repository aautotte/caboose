// F70: cleaning up the working tree. Remove untracked files only, or everything (changes to tracked files,
// untracked files, and ignored ones if asked), with undo and redo.
import { test, expect } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dialog, gitIn, launch, makeRepo, openWip, seed, type Harness } from './harness'

let h: Harness
const repo = join(seed, 'clean')
const file = (p: string): string => join(repo, p)

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => {
  h = await launch('clean', {
    open: [repo],
    setup: (env) => {
      makeRepo(env, 'clean', [['Base', { 'a.txt': 'a\n', '.gitignore': 'build/\n*.log\n' }]])
      writeFileSync(file('a.txt'), 'a, changed\n')
      writeFileSync(file('s.txt'), 'staged\n')
      gitIn(env, repo, 'add', 's.txt')
      writeFileSync(file('u.txt'), 'untracked\n')
      mkdirSync(file('dir'))
      writeFileSync(file('dir/u2.txt'), 'untracked too\n')
      mkdirSync(file('build'))
      writeFileSync(file('build/out.bin'), 'built\n')
      writeFileSync(file('x.log'), 'log\n')
    }
  })
  await h.page.getByRole('tab', { name: 'clean', exact: true }).click()
})
test.afterAll(async () => {
  await h.close()
})
test.afterEach(() => h.expectClean())

const toasts = () => h.page.getByRole('region', { name: /Notifications/ })
// h.git trims, so the first line loses its leading space.
const status = (): string => h.git(repo, 'status', '--porcelain', '--ignored')
const box = (name: RegExp) => dialog(h.page).getByRole('checkbox', { name })

test('F70-H1: Remove untracked files takes only those; changes and ignored files stay', async () => {
  await h.page.keyboard.press('Control+p')
  await h.page.keyboard.type('Remove untracked files')
  await h.page.keyboard.press('Enter')
  await expect(box(/^Changes to tracked files \(2\)/)).not.toBeChecked()
  await expect(box(/^Untracked files \(2\)/)).toBeChecked()
  await expect(box(/^Ignored files \(2\)/)).not.toBeChecked()
  const list = dialog(h.page).getByRole('list', { name: 'To remove' })
  await expect(list.getByRole('listitem')).toHaveText(['dir/u2.txt', 'u.txt'])
  await dialog(h.page).getByRole('button', { name: 'Remove 2 items' }).click()
  await expect(toasts().getByText('Removed 2 items')).toBeVisible()
  expect(existsSync(file('u.txt'))).toBe(false)
  expect(existsSync(file('dir/u2.txt'))).toBe(false)
  expect(status()).toBe('M a.txt\nA  s.txt\n!! build/\n!! x.log')
})

test('F70-H2: undo brings the untracked files back', async () => {
  await h.page.keyboard.press('Control+z')
  await expect.poll(() => existsSync(file('dir/u2.txt'))).toBe(true)
  expect(readFileSync(file('u.txt'), 'utf8')).toBe('untracked\n')
  expect(status()).toBe('M a.txt\nA  s.txt\n?? dir/\n?? u.txt\n!! build/\n!! x.log')
})

test('F70-H3: cleaning up everything, ignored files included, leaves only the last commit', async () => {
  await openWip(h.page)
  await h.page.getByRole('button', { name: 'Clean up the working tree' }).click()
  await expect(box(/^Changes to tracked files/)).toBeChecked()
  await expect(box(/^Untracked files/)).toBeChecked()
  await box(/^Ignored files/).click()
  await expect(dialog(h.page).getByText(/copied for undo too/)).toBeVisible()
  await dialog(h.page).getByRole('button', { name: 'Remove 6 items' }).click()
  await expect(toasts().getByText('Removed 6 items')).toBeVisible()
  expect(status()).toBe('')
  expect(readFileSync(file('a.txt'), 'utf8')).toBe('a\n')
})

test('F70-H4: undo brings everything back, staged changes staged; redo cleans up again', async () => {
  await h.page.keyboard.press('Control+z')
  await expect.poll(() => existsSync(file('build/out.bin'))).toBe(true)
  expect(status()).toBe('M a.txt\nA  s.txt\n?? dir/\n?? u.txt\n!! build/\n!! x.log')
  await h.page.keyboard.press('Control+y')
  await expect.poll(() => existsSync(file('x.log'))).toBe(false)
  expect(status()).toBe('')
})

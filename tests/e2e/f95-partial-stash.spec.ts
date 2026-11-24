// F95: stash only part of the work. Some files, from their menu in Not staged or Staged (new files and both halves
// of a staged file included), or one block or some lines of a file, from its diff. The rest stays, and the stash
// holds only what was picked, so popping it brings exactly that back.
import { test, expect } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dialog, launch, makeRepo, openWip, seed, type Harness } from './harness'

let h: Harness
const repo = join(seed, 'partstash')
const lines = (n: number, change: (i: number) => string | null): string => Array.from({ length: n }, (_, i) => change(i) ?? `line ${i}`).join('\n') + '\n'
const original = lines(40, () => null)
// Two blocks far apart: line 2 and line 35.
const edited = lines(40, (i) => (i === 2 ? 'TWO' : i === 35 ? 'THIRTY-FIVE' : null))

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => {
  h = await launch('partstash', {
    open: [repo],
    setup: (env) => {
      makeRepo(env, 'partstash', [['Start', { 'a.txt': original, 'b.txt': 'b\n', 'c.txt': 'c\n' }]])
    }
  })
  await h.page.getByRole('tab', { name: 'partstash', exact: true }).click()
})
test.afterAll(async () => {
  await h.close()
})
test.afterEach(() => h.expectClean())
test.beforeEach(async () => {
  // Every test starts from the same work: a.txt with two blocks, b.txt changed, c.txt changed and staged, new.txt new.
  h.git(repo, 'reset', '-q', '--hard')
  h.git(repo, 'clean', '-fdq')
  h.git(repo, 'stash', 'clear')
  writeFileSync(join(repo, 'a.txt'), edited)
  writeFileSync(join(repo, 'b.txt'), 'b changed\n')
  writeFileSync(join(repo, 'c.txt'), 'c staged\n')
  h.git(repo, 'add', 'c.txt')
  writeFileSync(join(repo, 'c.txt'), 'c staged\nand more\n')
  writeFileSync(join(repo, 'new.txt'), 'new\n')
  await refocus()
  await openWip(h.page)
  await expect(row('Not staged', 'new.txt')).toBeVisible()
})

const refocus = () => h.page.evaluate(() => window.dispatchEvent(new Event('focus')))
const toasts = () => h.page.getByRole('region', { name: /Notifications/ })
const list = (name: 'Not staged' | 'Staged') => h.page.getByRole('listbox', { name: new RegExp(`^${name}`) })
const row = (side: 'Not staged' | 'Staged', path: string) => list(side).getByRole('option', { name: new RegExp(`${path.replace('.', '\\.')}$`) })
const view = (path: string) => h.page.getByRole('region', { name: `Changes in ${path}` })
const pickLine = (path: string, text: string) => view(path).getByRole('row').filter({ hasText: new RegExp(`^\\s*\\d*\\s*\\d*\\s*[+−]?\\s*${text}$`) }).getByRole('cell').first().dispatchEvent('mousedown')
const names = (...args: string[]): string => h.git(repo, ...args).split('\n').filter(Boolean).sort().join(' ')
/** Which files have staged changes, unstaged ones, and which are new. */
const status = (): { staged: string; unstaged: string; untracked: string } => ({
  staged: names('diff', '--cached', '--name-only'),
  unstaged: names('diff', '--name-only'),
  untracked: names('ls-files', '--others', '--exclude-standard')
})
const stashFiles = (): string[] => h.git(repo, 'stash', 'show', '--include-untracked', '--name-only', 'stash@{0}').split('\n').filter(Boolean).sort()
const read = (p: string): string => readFileSync(join(repo, p), 'utf8')

test('F95-H1: two picked files are stashed, a new one included; the others stay, and pop brings them back', async () => {
  await row('Not staged', 'b.txt').click()
  await row('Not staged', 'new.txt').click({ modifiers: ['Control'] })
  await row('Not staged', 'new.txt').click({ button: 'right' })
  await h.page.getByRole('menuitem', { name: 'Stash 2 files…' }).click()
  const d = dialog(h.page)
  await expect(d).toContainText('b.txt')
  await expect(d).toContainText('new.txt')
  await expect(d.getByRole('radio', { name: 'Some files' })).toHaveAttribute('aria-checked', 'true')
  await d.getByRole('textbox', { name: /Name/ }).fill('b and new')
  await d.getByRole('button', { name: 'Stash 2 files' }).click()
  await expect(toasts().getByText('Stashed 2 files')).toBeVisible()
  expect(status()).toEqual({ staged: 'c.txt', unstaged: 'a.txt c.txt', untracked: '' })
  expect(stashFiles()).toEqual(['b.txt', 'new.txt'])
  expect(h.git(repo, 'stash', 'list', '--format=%gs')).toBe('On main: b and new')
  h.git(repo, 'stash', 'pop', '-q')
  expect(status()).toEqual({ staged: 'c.txt', unstaged: 'a.txt b.txt c.txt', untracked: 'new.txt' })
})

test('F95-H2: a file from the staged list goes with both its staged and unstaged parts', async () => {
  await row('Staged', 'c.txt').click({ button: 'right' })
  await h.page.getByRole('menuitem', { name: 'Stash this file…' }).click()
  await dialog(h.page).getByRole('button', { name: 'Stash 1 file' }).click()
  await expect(toasts().getByText('Stashed 1 file')).toBeVisible()
  expect(status()).toEqual({ staged: '', unstaged: 'a.txt b.txt', untracked: 'new.txt' })
  expect(read('c.txt')).toBe('c\n')
  h.git(repo, 'stash', 'pop', '-q', '--index')
  expect(h.git(repo, 'show', ':c.txt')).toBe('c staged')
  expect(read('c.txt')).toBe('c staged\nand more\n')
})

test('F95-H3: one block is stashed and leaves the file; the stash holds only that block', async () => {
  await row('Not staged', 'a.txt').click()
  await expect(view('a.txt').getByRole('button', { name: 'Stage hunk' })).toHaveCount(2)
  await view('a.txt').getByRole('button', { name: 'Stash hunk…' }).first().click()
  const d = dialog(h.page)
  await expect(d).toContainText('a.txt')
  await d.getByRole('button', { name: 'Stash', exact: true }).click()
  await expect(toasts().getByText('Stashed a hunk of a.txt')).toBeVisible()
  expect(read('a.txt')).toBe(lines(40, (i) => (i === 35 ? 'THIRTY-FIVE' : null)))
  await expect(view('a.txt').getByRole('button', { name: 'Stage hunk' })).toHaveCount(1)
  // Only a.txt, only line 2, and the rest of the work is untouched.
  expect(h.git(repo, 'stash', 'show', '-p', 'stash@{0}')).toMatch(/^-line 2\n\+TWO$/m)
  expect(h.git(repo, 'stash', 'show', '--name-only', 'stash@{0}')).toBe('a.txt')
  expect(h.git(repo, 'stash', 'show', '-p', 'stash@{0}')).not.toContain('THIRTY-FIVE')
  expect(h.git(repo, 'stash', 'list', '--format=%gs')).toMatch(/^WIP on main: [0-9a-f]+ Start$/)
  expect(status()).toEqual({ staged: 'c.txt', unstaged: 'a.txt b.txt c.txt', untracked: 'new.txt' })
  // a.txt still has the other block: git stash pop refuses, the app's Pop puts the block back around it.
  await h.page.getByRole('button', { name: /^Pop/ }).first().click()
  await expect(toasts().getByText('Stash popped')).toBeVisible()
  await expect.poll(() => read('a.txt')).toBe(edited)
  expect(h.git(repo, 'stash', 'list')).toBe('')
})

test('F95-H4: picked lines of a block are stashed; the other lines of the block stay, and Pop merges them back', async () => {
  // One block, two changes with one unchanged line between them.
  const both = lines(40, (i) => (i === 2 ? 'TWO' : i === 4 ? 'FOUR' : null))
  writeFileSync(join(repo, 'a.txt'), both)
  await refocus()
  await row('Not staged', 'a.txt').click()
  await expect(view('a.txt')).toContainText('FOUR')
  await expect(view('a.txt').getByRole('button', { name: 'Stage hunk' })).toHaveCount(1)
  await pickLine('a.txt', 'line 4')
  await pickLine('a.txt', 'FOUR')
  await view('a.txt').getByRole('button', { name: 'Stash 2 lines…' }).click()
  await dialog(h.page).getByRole('textbox', { name: /Name/ }).fill('four')
  await dialog(h.page).getByRole('button', { name: 'Stash', exact: true }).click()
  await expect(toasts().getByText('Stashed 2 lines of a.txt')).toBeVisible()
  expect(read('a.txt')).toBe(lines(40, (i) => (i === 2 ? 'TWO' : null)))
  const shown = h.git(repo, 'stash', 'show', '-p', 'stash@{0}')
  expect(shown).toMatch(/^-line 4\n\+FOUR$/m)
  expect(shown).not.toContain('TWO')
  expect(h.git(repo, 'stash', 'list', '--format=%gs')).toBe('On main: four')
  // The pick is gone with the lines.
  await expect(view('a.txt').getByRole('button', { name: /Stash \d+ lines/ })).toHaveCount(0)
  // TWO is still there, next to the stash's lines: git stash pop refuses, the app merges the file.
  await h.page.getByRole('button', { name: /^Pop/ }).first().click()
  await expect(toasts().getByText('Stash popped')).toBeVisible()
  await expect.poll(() => read('a.txt')).toBe(both)
  expect(h.git(repo, 'stash', 'list')).toBe('')
})

test('F95-E2: a stash whose lines clash with the file as it is now is kept, and the file is left alone', async () => {
  // Nothing staged, so the stash has no staged part: only the clash can stop it.
  h.git(repo, 'reset', '-q')
  h.git(repo, 'stash', 'push', '-q', '--', 'a.txt')
  // The stash changes line 2 and line 35; now line 2 is changed another way.
  const clash = lines(40, (i) => (i === 2 ? 'deux' : null))
  writeFileSync(join(repo, 'a.txt'), clash)
  await refocus()
  await h.page.getByRole('button', { name: /^Pop/ }).first().click()
  await expect(toasts().getByText(/changes files you’ve changed since/)).toBeVisible()
  expect(read('a.txt')).toBe(clash)
  expect(h.git(repo, 'stash', 'list', '--format=%gs')).toMatch(/^WIP on main/)
})

test('F95-E1: a file with staged changes, or a new file, can only be stashed whole', async () => {
  await row('Not staged', 'c.txt').click()
  await expect(view('c.txt')).toContainText('and more')
  await expect(view('c.txt').getByRole('button', { name: 'Stash hunk' })).toBeDisabled()
  await row('Not staged', 'new.txt').click()
  await expect(view('new.txt')).toContainText('New file')
  await expect(view('new.txt').getByRole('button', { name: 'Stash hunk' })).toBeDisabled()
  // The staged side has no Stash button for lines.
  await row('Staged', 'c.txt').click()
  await expect(view('c.txt')).toContainText('Staged')
  await expect(view('c.txt').getByRole('button', { name: /^Stash/ })).toHaveCount(0)
  expect(h.git(repo, 'stash', 'list')).toBe('')
})

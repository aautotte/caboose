// F90: a conflicted file merged again another way, from the merge tool: ignoring changes in spacing, or with
// another diff algorithm. Each says how many conflicts it would leave; nothing is written until Save result, and
// git's own merge is one click away.
import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { axe, dialog, gitIn, launch, makeRepo, seed, writeAndCommit, type Harness } from './harness'

let h: Harness
const repo = join(seed, 'again')
const code = (indent: string, a: string): string => ['def f():', `${indent}a = ${a}`, `${indent}b = 2`, `${indent}return a + b`, ''].join('\n')

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => {
  h = await launch('again', {
    open: [repo],
    setup: (env) => {
      makeRepo(env, 'again', [['Base', { 'f.py': code('    ', '1') }]])
      gitIn(env, repo, 'switch', '-q', '-c', 'reindent')
      writeAndCommit(env, repo, 'Reindent', { 'f.py': code('        ', '1') })
      gitIn(env, repo, 'switch', '-q', 'main')
      writeAndCommit(env, repo, 'Set a to 10', { 'f.py': code('    ', '10') })
      try {
        gitIn(env, repo, 'merge', '-q', 'reindent')
      } catch {
        // Conflicts, as intended.
      }
    }
  })
  await h.page.getByRole('tab', { name: 'again', exact: true }).click()
  await h.page.getByRole('row', { name: /Uncommitted changes/ }).click()
  await h.page.getByRole('listbox', { name: /Not staged/ }).getByRole('option', { name: /f\.py/ }).click()
  await tool().waitFor()
})
test.afterAll(() => h.close())
test.afterEach(() => h.expectClean())

const tool = () => h.page.getByRole('region', { name: /Resolve conflicts in f\.py/ })
const result = () => tool().getByRole('textbox', { name: 'Merged result' })
const save = () => tool().getByRole('button', { name: 'Save result' })

test('F90-H1: Merge again lists the other ways, with how many conflicts each leaves', async () => {
  await expect(result()).toHaveValue(/<<<<<<< /)
  await tool().getByRole('button', { name: 'Merge again' }).click()
  await expect(h.page.getByRole('menuitem', { name: 'Ignoring changes in spacing: no conflicts left' })).toBeVisible()
  await expect(h.page.getByRole('menuitem', { name: /^With the patience algorithm: \d+ conflicts? left$/ })).toBeVisible()
  await expect(h.page.getByRole('menuitem', { name: /^With the histogram algorithm: \d+ conflicts? left$/ })).toBeVisible()
  await h.page.keyboard.press('Escape')
})

test('F90-H2: ignoring spacing, the file merges: the result says so, nothing is written until saved', async () => {
  await tool().getByRole('button', { name: 'Merge again' }).click()
  await h.page.getByRole('menuitem', { name: 'Ignoring changes in spacing: no conflicts left' }).click()
  await expect(tool().getByRole('status').filter({ hasText: 'Merged again: ignoring changes in spacing.' })).toBeVisible()
  await expect(result()).toHaveValue(code('    ', '10'))
  await expect(save()).toBeEnabled()
  expect(readFileSync(join(repo, 'f.py'), 'utf8')).toContain('<<<<<<<')
  expect(await axe(h.page)).toEqual([])
})

test('F90-H3: back to git’s own merge, then again and saved', async () => {
  await tool().getByRole('button', { name: 'Back to git’s own merge' }).click()
  await expect(result()).toHaveValue(/<<<<<<< /)
  await expect(save()).toBeDisabled()
  await tool().getByRole('button', { name: 'Merge again' }).click()
  await h.page.getByRole('menuitem', { name: 'Ignoring changes in spacing: no conflicts left' }).click()
  await save().click()
  await expect(tool()).toHaveCount(0)
  expect(readFileSync(join(repo, 'f.py'), 'utf8')).toBe(code('    ', '10'))
  // Resolved and staged: the same as yours here, so nothing else to show.
  expect(h.git(repo, 'diff', '--name-only', '--diff-filter=U')).toBe('')
  expect(h.git(repo, 'status', '--porcelain')).toBe('')
  await expect(dialog(h.page)).toHaveCount(0)
})

test('F90-H4: during a rebase too: the commit being replayed, merged again against its parent', async () => {
  h.git(repo, 'commit', '-q', '--no-edit')
  h.git(repo, 'switch', '-q', '-c', 'side', 'main~2')
  // A comment too: a commit that only changes spacing would count as applied already, and be skipped.
  writeAndCommit(h.env, repo, 'Reindent on the side', { 'f.py': `# side\n${code('  ', '1')}` })
  try {
    h.git(repo, 'rebase', '-q', 'main')
  } catch {
    // Stops at the conflict, as intended.
  }
  // Done outside Caboose: it looks again when its window comes back to the front.
  await h.page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await h.page.getByRole('row', { name: /Uncommitted changes/ }).click()
  await h.page.getByRole('listbox', { name: /Not staged/ }).getByRole('option', { name: /f\.py/ }).click()
  await tool().getByRole('button', { name: 'Merge again' }).click()
  await h.page.getByRole('menuitem', { name: 'Ignoring changes in spacing: no conflicts left' }).click()
  await expect(result()).toHaveValue(/^# side\n/)
  await expect(result()).toHaveValue(/a = 10/)
  await expect(result()).not.toHaveValue(/<<<<<<<|>>>>>>>/)
  await save().click()
  await expect(tool()).toHaveCount(0)
  expect(h.git(repo, 'diff', '--name-only', '--diff-filter=U')).toBe('')
  h.git(repo, 'rebase', '--abort')
  h.git(repo, 'switch', '-q', 'main')
})

// F88: suggestions in the merge tool, from a real merge. Lines both sides added to a sorted list, changes to lines
// next to each other, and a side that only changed spacing each get one, with why; a real clash gets none. The
// words each side changed are marked.
import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { axe, gitIn, launch, makeRepo, seed, writeAndCommit, type Harness } from './harness'

let h: Harness
const repo = join(seed, 'suggest')
const pad = (k: string): string => Array.from({ length: 6 }, (_, i) => `${k} filler ${i}`).join('\n')
const file = (imports: string, pair: string, value: string, x: string): string =>
  ['import a', imports, 'import z', pad('one'), pair, pad('two'), value, pad('three'), x, pad('four'), ''].filter((l) => l !== null).join('\n')

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => {
  h = await launch('suggest', {
    open: [repo],
    setup: (env) => {
      makeRepo(env, 'suggest', [['Base', { 'app.txt': file('import b', 'L1\nL2', '  value = 1', 'x = 0') }]])
      gitIn(env, repo, 'switch', '-q', '-c', 'other')
      writeAndCommit(env, repo, 'Theirs', { 'app.txt': file('import b\nimport m', 'L1\nL2 theirs', '  value = 2', 'x = 2') })
      gitIn(env, repo, 'switch', '-q', 'main')
      writeAndCommit(env, repo, 'Ours', { 'app.txt': file('import b\nimport c', 'L1 ours\nL2', '    value = 1', 'x = 1') })
      try {
        gitIn(env, repo, 'merge', '-q', 'other')
      } catch {
        // Conflicts, as intended.
      }
    }
  })
  await h.page.getByRole('tab', { name: 'suggest', exact: true }).click()
  await h.page.getByRole('row', { name: /Uncommitted changes/ }).click()
  await h.page.getByRole('listbox', { name: /Not staged/ }).getByRole('option', { name: /app\.txt/ }).click()
  await tool().waitFor()
})
test.afterAll(() => h.close())
test.afterEach(() => h.expectClean())

const tool = () => h.page.getByRole('region', { name: /Resolve conflicts in app\.txt/ })
const result = () => tool().getByRole('textbox', { name: 'Merged result' })
const useAll = () => tool().getByRole('button', { name: /^Use \d+ suggestions?$/ })

test('F88-H1: three of the four conflicts get a suggestion and why; the clash gets none', async () => {
  await expect(tool().getByText(/^Suggested: /)).toHaveCount(3)
  await expect(tool()).toContainText('Suggested: keep both, sorted. Both sides added lines to a sorted list: they all go in, in order.')
  await expect(tool()).toContainText('Suggested: keep both. The two sides changed different lines, next to each other: both changes go in.')
  await expect(tool()).toContainText('Suggested: keep theirs. Yours only changed spacing here; theirs changed what the lines say.')
  await expect(useAll()).toHaveText('Use 3 suggestions')
  // Nothing taken until asked.
  await expect(result()).toHaveValue(/<<<<<<< /)
  expect(await axe(h.page)).toEqual([])
})

test('F88-H2: the words each side changed are marked', async () => {
  const marks = tool().locator('mark')
  await expect(marks.filter({ hasText: /^1$/ })).toHaveCount(1)
  // value = 2 and x = 2.
  await expect(marks.filter({ hasText: /^2$/ })).toHaveCount(2)
  await expect(marks.filter({ hasText: /^ ours$/ })).toHaveCount(1)
  await expect(marks.filter({ hasText: /^import c$/ })).toHaveCount(1)
  // Lines a side left as they were aren't marked.
  await expect(marks.filter({ hasText: 'filler' })).toHaveCount(0)
})

test('F88-H3: one suggestion, then the rest; a pick by hand replaces a suggestion; the clash is picked by hand, then saved', async () => {
  await tool().getByRole('button', { name: 'Use suggestion for conflict 2' }).click()
  await expect(tool().getByText('In the result')).toHaveCount(1)
  await expect(result()).toHaveValue(/L1 ours\nL2 theirs/)
  await expect(useAll()).toHaveText('Use 2 suggestions')
  // Ticking a side by hand replaces the combined lines.
  const boxes = tool().getByRole('checkbox', { name: /^Use th/ })
  await boxes.nth(1).click()
  await expect(result()).not.toHaveValue(/L2 theirs/)
  await expect(useAll()).toHaveText('Use 3 suggestions')
  await useAll().click()
  await expect(useAll()).toHaveCount(0)
  await expect(tool().getByText('In the result')).toHaveCount(3)
  await expect(tool().getByRole('button', { name: 'Save result' })).toBeDisabled()
  // Conflict 4, from theirs (the second pane's fourth).
  await boxes.nth(7).click()
  await tool().getByRole('button', { name: 'Save result' }).click()
  await expect(tool()).toHaveCount(0)
  expect(readFileSync(join(repo, 'app.txt'), 'utf8')).toBe(file('import b\nimport c\nimport m', 'L1 ours\nL2 theirs', '  value = 2', 'x = 2'))
})

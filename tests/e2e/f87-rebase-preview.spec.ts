// F87: looking inside the commits while planning an interactive rebase. Each row says how big its commit is; the
// focused one shows in the details panel, and a file of it opens under the list without leaving the plan.
import { test, expect } from '@playwright/test'
import { join } from 'node:path'
import { axe, commitRow, launch, makeRepo, seed, type Harness } from './harness'

let h: Harness
const repo = join(seed, 'rbpreview')

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => {
  h = await launch('rebase-preview', {
    open: [repo],
    setup: (env) =>
      void makeRepo(env, 'rbpreview', [
        ['Base', { 'base.txt': 'base\n' }],
        ['Add apple', { 'apple.txt': 'one\ntwo\nthree\n' }],
        ['Rename things', { 'apple.txt': 'one\n2\nthree\n', 'banana.txt': 'banana\n' }],
        ['Tidy', { 'banana.txt': 'Banana\n' }]
      ])
  })
  await h.page.getByRole('tab', { name: 'rbpreview', exact: true }).click()
  await commitRow(h.page, 'Base').click({ button: 'right' })
  await h.page.getByRole('menuitem', { name: /^Rewrite main after this commit/ }).click()
})
test.afterAll(() => h.close())
test.afterEach(() => h.expectClean())

const view = () => h.page.getByRole('region', { name: /^Rewrite main after / })
const list = () => view().getByRole('list', { name: 'Commits, newest first' })
const step = (summary: string) => list().getByRole('listitem').filter({ hasText: summary })
const details = () => h.page.getByRole('region', { name: 'Details' })
const files = () => details().getByRole('listbox', { name: /Changed files/ })

test('F87-H1: each row says how many files and lines its commit changes', async () => {
  await expect(step('Rename things')).toHaveAccessibleName('Rename things, Keep, 2 files changed, 2 lines added, 1 removed')
  await expect(step('Add apple')).toHaveAccessibleName('Add apple, Keep, 1 file changed, 3 lines added, 0 removed')
  await expect(step('Tidy')).toContainText('1 file+1−1')
})

test('F87-H2: the focused row’s commit shows in the details panel, read only, and follows the arrow keys', async () => {
  // The newest, to begin with.
  await expect(details()).toContainText('Tidy')
  await step('Tidy').focus()
  await h.page.keyboard.press('ArrowDown')
  await expect(details()).toContainText('Rename things')
  await expect(files().getByRole('option')).toHaveCount(2)
  // Not rewritten under the plan: no message editing here.
  await expect(details().getByRole('button', { name: 'Edit message' })).toHaveCount(0)
  await step('Add apple').getByText('Add apple').click()
  await expect(details()).toContainText('Add apple')
})

test('F87-H3: a file opens under the list, the plan stays; another commit or Esc closes it, then Esc closes the view', async () => {
  await step('Rename things').getByText('Rename things').click()
  await step('Rename things').getByRole('radio', { name: 'Drop' }).click()
  await files().getByRole('option', { name: /apple\.txt/ }).click()
  const diff = view().getByRole('region', { name: 'Changes in apple.txt' })
  await expect(diff.getByRole('row').filter({ hasText: '2' }).first()).toBeVisible()
  await expect(diff).toContainText('two')
  await expect(step('Rename things').getByRole('radio', { name: 'Drop' })).toHaveAttribute('aria-checked', 'true')
  await expect(view().getByRole('separator', { name: 'Resize the file’s changes' })).toBeVisible()
  expect(await axe(h.page)).toEqual([])
  // Another commit: its own files, the diff closes.
  await step('Tidy').getByText('Tidy').click()
  await expect(diff).toHaveCount(0)
  await files().getByRole('option', { name: /banana\.txt/ }).click()
  await expect(view().getByRole('region', { name: 'Changes in banana.txt' })).toContainText('Banana')
  await h.page.keyboard.press('Escape')
  await expect(view().getByRole('region', { name: 'Changes in banana.txt' })).toHaveCount(0)
  await expect(list()).toBeVisible()
  await expect(step('Rename things').getByRole('radio', { name: 'Drop' })).toHaveAttribute('aria-checked', 'true')
  // Nothing else changed in the plan along the way.
  await expect(list().getByRole('radio', { name: 'Keep', checked: true })).toHaveCount(2)
  await h.page.keyboard.press('Escape')
  await expect(view()).toHaveCount(0)
})

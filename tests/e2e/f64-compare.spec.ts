// F64: comparing two branches or commits. The files that differ, each one's diff, the commits only one side has,
// and "since they split" to see only what one side did, as a pull request shows it.
import { test, expect } from '@playwright/test'
import { join } from 'node:path'
import { commitRow, dialog, gitIn, grid, launch, makeRepo, seed, writeAndCommit, type Harness } from './harness'

let h: Harness
const repo = join(seed, 'compare')

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => {
  h = await launch('compare', {
    open: [repo],
    setup: (env) => {
      makeRepo(env, 'compare', [['Start', { 'a.txt': 'a\n', 'b.txt': 'b\n' }]])
      gitIn(env, repo, 'checkout', '-q', '-b', 'feature')
      writeAndCommit(env, repo, 'Add f', { 'f.txt': 'f\n' })
      writeAndCommit(env, repo, 'Change a', { 'a.txt': 'a on feature\n' })
      gitIn(env, repo, 'checkout', '-q', 'main')
      writeAndCommit(env, repo, 'Change b', { 'b.txt': 'b on main\n' })
    }
  })
  await h.page.getByRole('tab', { name: 'compare', exact: true }).click()
})
test.afterAll(async () => {
  await h.close()
})
test.afterEach(() => h.expectClean())

const view = () => h.page.getByRole('region', { name: /^Compare / })
const files = (title: string) => view().getByRole('region', { name: title })
const local = (name: string) => h.page.getByRole('tree', { name: 'Local branches' }).getByRole('treeitem', { name: new RegExp(`^${name}`) })

test('F64-H1: Compare with main, from a branch’s menu: the files that differ and what each side has', async () => {
  await local('feature').click({ button: 'right' })
  await h.page.getByRole('menuitem', { name: 'Compare with main' }).click()
  await expect(view()).toHaveAccessibleName('Compare main with feature')
  await expect(view().getByRole('status', { name: 'Comparison summary' })).toHaveText('feature has 2 commits main doesn’t; main has 1 commit feature doesn’t.')
  for (const f of ['a.txt', 'b.txt', 'f.txt']) await expect(files('Different').getByText(f, { exact: true })).toBeVisible()
  await files('Different').getByText('a.txt', { exact: true }).click()
  const diff = view().getByRole('region', { name: 'Changes in a.txt' })
  await expect(diff.getByText('a on feature')).toBeVisible()
})

test('F64-H2: since they split, only what feature changed is left', async () => {
  await view().getByRole('checkbox', { name: 'Only what feature changed since they split' }).click()
  const changed = files('Changed on feature')
  await expect(changed.getByText('f.txt', { exact: true })).toBeVisible()
  await expect(changed.getByText('a.txt', { exact: true })).toBeVisible()
  await expect(changed.getByText('b.txt', { exact: true })).toHaveCount(0)
})

test('F64-H3: the commits only one side has; one opens in the details panel', async () => {
  await view().getByRole('radio', { name: /^Commits/ }).click()
  const onFeature = view().getByRole('list', { name: 'Only on feature' })
  await expect(onFeature.getByRole('button')).toHaveCount(2)
  await expect(onFeature.getByRole('button').first()).toContainText('Change a')
  await expect(view().getByRole('list', { name: 'Only on main' }).getByRole('button')).toHaveCount(1)
  await onFeature.getByRole('button', { name: /Add f/ }).click()
  await expect(h.page.getByRole('region', { name: 'Details' }).getByText('Add f', { exact: true })).toBeVisible()
})

test('F64-H4: swap puts the other side first', async () => {
  await view().getByRole('button', { name: 'Swap the two sides' }).click()
  await expect(view()).toHaveAccessibleName('Compare feature with main')
  await expect(view().getByRole('status', { name: 'Comparison summary' })).toHaveText('main has 1 commit feature doesn’t; feature has 2 commits main doesn’t.')
  await view().getByRole('button', { name: 'Close the comparison' }).click()
})

test('F64-H5: two commits picked in the graph compare from the older to the newer; the palette asks for any two', async () => {
  await commitRow(h.page, 'Change b').click()
  await commitRow(h.page, 'Start').click({ modifiers: ['Control'] })
  await h.page.getByRole('region', { name: 'Details' }).getByRole('button', { name: 'Compare these two' }).click()
  await expect(view().getByRole('status', { name: 'Comparison summary' })).toHaveText(/has 1 commit .* doesn’t; .* has 0 commits/)
  await expect(files('Different').getByText('b.txt', { exact: true })).toBeVisible()
  await view().getByRole('button', { name: 'Close the comparison' }).click()
  await expect(grid(h.page)).toBeVisible()

  await h.page.keyboard.press('Control+p')
  await h.page.keyboard.type('Compare two')
  await h.page.keyboard.press('Enter')
  const d = dialog(h.page)
  await expect(d.getByRole('combobox', { name: 'From' })).toHaveValue('main')
  await d.getByRole('combobox', { name: 'To' }).fill('feature')
  await d.getByRole('button', { name: 'Compare', exact: true }).click()
  await expect(view()).toHaveAccessibleName('Compare main with feature')
})

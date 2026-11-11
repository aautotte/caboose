// F83 (what PRs #45 and #46 were after): a branch picked elsewhere whose commit is off screen comes to the middle of
// the graph, while clicks and keys in the graph keep the list still; creating a branch and switching to it, when
// changes are in the way of the switch, makes the branch, closes the dialog and says why it didn't switch.
import { test, expect } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { commitRow, dialog, gitIn, grid, launch, makeRepo, seed, toGraph, writeAndCommit, type Harness } from './harness'

let h: Harness
const repo = join(seed, 'reviewfix')
const ROW = 28
const HEADER = 26

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => {
  h = await launch('reviewfix', {
    open: [repo],
    setup: (env) => {
      makeRepo(env, 'reviewfix', [['Base', { 'a.txt': 'one\n' }]])
      writeAndCommit(env, repo, 'Change a', { 'a.txt': 'two\n' })
      for (let i = 1; i <= 80; i++) {
        gitIn(env, repo, 'commit', '-q', '--allow-empty', '-m', `Step ${i}`)
        if (i === 25) gitIn(env, repo, 'branch', 'deep')
        if (i === 62) gitIn(env, repo, 'branch', 'near')
        if (i === 78) gitIn(env, repo, 'branch', 'top')
      }
      // A branch with a file main doesn't have, for an untracked file in the way.
      gitIn(env, repo, 'switch', '-q', '-c', 'side')
      writeAndCommit(env, repo, 'Add new.txt', { 'new.txt': 'from side\n' })
      gitIn(env, repo, 'switch', '-q', 'main')
    }
  })
  await h.page.getByRole('tab', { name: 'reviewfix', exact: true }).click()
  await toGraph(h.page)
})
test.afterAll(async () => {
  await h.close()
})
test.afterEach(() => h.expectClean())

const scrollTop = (): Promise<number> => grid(h.page).evaluate((el) => el.scrollTop)
const local = (name: string) => h.page.getByRole('tree', { name: 'Local branches' }).getByRole('treeitem', { name: new RegExp(`^${name}(,|$)`) })
const toasts = () => h.page.getByRole('region', { name: /Notifications/ })
const head = (): string => h.git(repo, 'rev-parse', '--abbrev-ref', 'HEAD')
/** How far the row's middle is from the middle of the list under its sticky header, in pixels. */
async function offCentre(summary: string): Promise<number> {
  const g = (await grid(h.page).boundingBox())!
  // clientHeight: without the sideways scrollbar under the rows.
  const visible = await grid(h.page).evaluate((el) => el.clientHeight)
  const r = (await commitRow(h.page, summary).boundingBox())!
  return Math.abs(r.y + r.height / 2 - (g.y + HEADER + (visible - HEADER) / 2))
}

test('F83-H1: a branch picked in the panel whose commit is off screen comes to the middle of the list', async () => {
  await grid(h.page).evaluate((el) => (el.scrollTop = 0))
  await local('deep').click()
  await expect(commitRow(h.page, 'Step 25')).toHaveAttribute('aria-selected', 'true')
  await expect.poll(() => offCentre('Step 25')).toBeLessThanOrEqual(ROW / 2)
  // Back up top, and one that's already in view: the list doesn't move.
  await grid(h.page).evaluate((el) => (el.scrollTop = 0))
  await expect.poll(scrollTop).toBe(0)
  await local('top').click()
  await expect(commitRow(h.page, 'Step 78')).toHaveAttribute('aria-selected', 'true')
  expect(await scrollTop()).toBe(0)
})

test('F83-H2: clicking a row, and arrow keys, leave the list where it is', async () => {
  await grid(h.page).evaluate((el) => (el.scrollTop = 0))
  // Near the bottom of the view.
  await commitRow(h.page, 'Step 63').click()
  await expect(commitRow(h.page, 'Step 63')).toHaveAttribute('aria-selected', 'true')
  expect(await scrollTop()).toBe(0)
  await h.page.keyboard.press('ArrowUp')
  await expect(commitRow(h.page, 'Step 64')).toHaveAttribute('aria-selected', 'true')
  await h.page.keyboard.press('ArrowDown')
  await h.page.keyboard.press('ArrowDown')
  await expect(commitRow(h.page, 'Step 62')).toHaveAttribute('aria-selected', 'true')
  expect(await scrollTop()).toBe(0)
})

test('F83-H3: double-clicking a row near the bottom checks out that row’s branch', async () => {
  await grid(h.page).evaluate((el) => (el.scrollTop = 0))
  const row = commitRow(h.page, 'Step 62')
  await expect(row).toBeInViewport()
  await row.dblclick()
  await expect.poll(head).toBe('near')
  expect(await scrollTop()).toBe(0)
  h.git(repo, 'switch', '-q', 'main')
  await expect(local('main')).toHaveAttribute('aria-current', 'true')
})

async function createBranchAt(summary: string, name: string): Promise<void> {
  await commitRow(h.page, summary).click({ button: 'right' })
  await h.page.getByRole('menuitem', { name: 'Create branch here…' }).click()
  await dialog(h.page).getByLabel('Branch name').fill(name)
  await expect(dialog(h.page).getByRole('switch', { name: 'Switch to it now' })).toBeChecked()
  await dialog(h.page).getByRole('button', { name: 'Create branch' }).click()
}

test('F83-H4: changes in the way of the switch: the branch is made, the dialog closes, and it says what’s in the way', async () => {
  writeFileSync(join(repo, 'a.txt'), 'mine\n')
  await h.page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await grid(h.page).evaluate((el) => (el.scrollTop = el.scrollHeight))
  await createBranchAt('Base', 'old')
  await expect(dialog(h.page)).toHaveCount(0)
  await expect(toasts()).toContainText('Created old, but didn’t switch to it')
  await expect(toasts()).toContainText('a.txt has uncommitted changes switching would overwrite.')
  expect(h.git(repo, 'rev-parse', 'old')).toBe(h.git(repo, 'rev-parse', 'main~81'))
  expect(head()).toBe('main')
  await expect(local('old')).toBeVisible()
  h.git(repo, 'checkout', '-q', '--', 'a.txt')
})

test('F83-H5: an untracked file in the way says to move it, not to commit it', async () => {
  writeFileSync(join(repo, 'new.txt'), 'mine, untracked\n')
  await h.page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await grid(h.page).evaluate((el) => (el.scrollTop = 0))
  await createBranchAt('Add new.txt', 'side-copy')
  await expect(dialog(h.page)).toHaveCount(0)
  await expect(toasts()).toContainText('new.txt isn’t tracked, and switching would overwrite it. Move or delete it first.')
  expect(head()).toBe('main')
  expect(h.git(repo, 'rev-parse', 'side-copy')).toBe(h.git(repo, 'rev-parse', 'side'))
})

test('F83-H6: with nothing in the way it switches as before, and Undo goes back', async () => {
  h.git(repo, 'clean', '-qf')
  await h.page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await createBranchAt('Step 40', 'mid')
  await expect(toasts()).toContainText('Created and switched to mid')
  await expect.poll(head).toBe('mid')
  await h.page.getByRole('toolbar', { name: 'Repository actions' }).getByRole('button', { name: /^Undo: Switch to mid/ }).click()
  await expect.poll(head).toBe('main')
  // A name that's taken is still refused in the dialog, before anything runs.
  await commitRow(h.page, 'Step 40').click({ button: 'right' })
  await h.page.getByRole('menuitem', { name: 'Create branch here…' }).click()
  await dialog(h.page).getByLabel('Branch name').fill('mid')
  await expect(dialog(h.page)).toContainText('A branch with that name already exists.')
  await dialog(h.page).getByRole('button', { name: 'Cancel' }).click()
})

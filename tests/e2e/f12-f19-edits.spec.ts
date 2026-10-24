// F12 interactive rebase, F13 stash, F14 undo, F18 reset / revert, F19 cherry-pick: edge and negative cases.
import { test, expect } from '@playwright/test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { commitRow, demo, dialog, grid, launch, menu, openWip, toGraph, writeAndCommit, type Harness } from './harness'

let h: Harness

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => {
  h = await launch('edits', { open: [demo] })
  await h.page.getByRole('tab', { name: 'demo' }).click()
  await commitRow(h.page, 'Print the real temperature in the CLI').waitFor()
})
test.afterAll(async () => {
  await h.close()
})
test.afterEach(() => h.expectClean())

const toolbar = (name: string | RegExp) => h.page.getByRole('toolbar', { name: 'Repository actions' }).getByRole('button', { name })
const toasts = () => h.page.getByRole('region', { name: /Notifications/ })
const headSha = (): string => h.git(demo, 'rev-parse', 'HEAD')
const subject = (rev = 'HEAD'): string => h.git(demo, 'log', '-1', '--format=%s', rev)
async function dismissToasts(): Promise<void> {
  for (const b of await toasts().getByRole('button', { name: 'Dismiss' }).all()) await b.click().catch(() => {})
}

// ---------- F13 (uses the seed's uncommitted changes) ----------

test('F13-E1 stash only the staged changes', async () => {
  await toolbar('Stash your changes').click()
  await dialog(h.page).getByLabel('Name (optional)').fill('staged only')
  await dialog(h.page).getByRole('checkbox', { name: /Only staged changes/ }).click()
  await dialog(h.page).getByRole('button', { name: 'Stash', exact: true }).click()
  // The seed already has a stash; wait for this one.
  await expect.poll(h.gitOr(demo, 'log', '-1', '-g', '--format=%gs', 'stash@{0}')).toContain('staged only')
  expect(h.git(demo, 'stash', 'show', '--name-only', 'stash@{0}')).toBe('src/format.js')
  // Unstaged and new files stay in the working folder.
  expect(h.git(demo, 'status', '--porcelain')).toContain('README.md')
  expect(existsSync(join(demo, 'src', 'wind.js'))).toBe(true)
})

test('F13-E3 apply keeps the stash in the list', async () => {
  const before = h.git(demo, 'stash', 'list').split('\n').length
  await menu(h.page, h.page.getByRole('tree', { name: 'Stashes' }).getByRole('treeitem', { name: 'staged only' }), 'Apply (keep the stash)')
  await expect.poll(h.gitOr(demo, 'diff', '--cached', '--name-only')).toContain('src/format.js')
  expect(h.git(demo, 'stash', 'list').split('\n').length).toBe(before)
})

test('F13-E4 with nothing to stash, Stash is unavailable', async () => {
  h.git(demo, 'stash', 'push', '--all', '-q', '-m', 'clear the tree for the next tests')
  await expect(toolbar('No changes to stash')).toBeDisabled()
})

// ---------- F12 ----------

test('F12-E1 a range with merge commits is refused, with the reason', async () => {
  await menu(h.page, commitRow(h.page, 'Ignore node_modules and .env'), /^Rewrite main after this commit/)
  await expect(h.page.getByText('There are merge commits in this range')).toBeVisible()
  await expect(h.page.getByRole('button', { name: 'Start rebase' })).toHaveCount(0)
  await toGraph(h.page)
})

test('F12-E2 the first kept commit can’t be squashed', async () => {
  await menu(h.page, commitRow(h.page, 'Update the changelog (4)'), /^Rewrite main after this commit/)
  const rows = h.page.getByRole('list', { name: 'Commits, oldest first' }).getByRole('listitem')
  await rows.nth(0).getByRole('radio', { name: 'Squash' }).click()
  await expect(h.page.getByRole('alert')).toContainText('can’t be squashed')
  await expect(h.page.getByRole('button', { name: 'Start rebase' })).toBeDisabled()
  await rows.nth(0).getByRole('radio', { name: 'Keep' }).click()
})

test('F12-E3 a reorder that conflicts pauses the rebase; Abort puts the branch back', async () => {
  const before = headSha()
  const rows = h.page.getByRole('list', { name: 'Commits, oldest first' }).getByRole('listitem')
  // (5) and (6) both append to CHANGELOG.md: swapping them conflicts. Keyboard only: focus row 2, Alt+Up.
  await rows.nth(1).focus()
  await h.page.keyboard.press('Alt+ArrowUp')
  await expect(rows.nth(0)).toContainText('Update the changelog (6)')
  await h.page.getByRole('button', { name: 'Start rebase' }).click()
  await expect(h.page.getByRole('region', { name: 'Paused operation' })).toContainText('Rebasing')
  await h.page.getByRole('region', { name: 'Paused operation' }).getByRole('button', { name: 'Abort' }).click()
  await dialog(h.page).getByRole('button', { name: 'Abort' }).click()
  await expect.poll(headSha).toBe(before)
  await expect.poll(() => existsSync(join(demo, '.git', 'rebase-merge'))).toBe(false)
})

test('F12-E4 dropping a commit with the D key removes it; Undo brings it back', async () => {
  const before = headSha()
  await toGraph(h.page)
  await menu(h.page, commitRow(h.page, 'Update the changelog (6)'), /^Rewrite main after this commit/)
  const row = h.page.getByRole('list', { name: 'Commits, oldest first' }).getByRole('listitem').first()
  await row.focus()
  await h.page.keyboard.press('d')
  await expect(row.getByRole('radio', { name: 'Drop' })).toHaveAttribute('aria-checked', 'true')
  await h.page.getByRole('button', { name: 'Start rebase' }).click()
  await expect.poll(() => subject()).toBe('Update the changelog (6)')
  await toolbar(/^Undo: Interactive rebase/).click()
  await expect.poll(headSha).toBe(before)
})

// ---------- F19 ----------

test('F19-E2 cherry-picking a change that’s already here says so and adds nothing', async () => {
  const before = headSha()
  await menu(h.page, commitRow(h.page, 'Add Fahrenheit output'), 'Cherry-pick onto main')
  await expect(toasts().getByText(/already on this branch/)).toBeVisible()
  expect(headSha()).toBe(before)
  expect(existsSync(join(demo, '.git', 'CHERRY_PICK_HEAD'))).toBe(false)
  await dismissToasts()
})

// ---------- F18 ----------

test('F18-E1 a hard reset throws uncommitted work away, and Undo brings it back', async () => {
  writeFileSync(join(demo, 'precious.txt'), 'do not lose me\n')
  h.git(demo, 'add', 'precious.txt')
  writeFileSync(join(demo, 'README.md'), '# skycast\n\nunsaved edit\n')
  const before = headSha()
  await toGraph(h.page)
  await menu(h.page, commitRow(h.page, 'Update the changelog (5)'), /^Reset main to this commit/)
  await dialog(h.page).getByRole('radio', { name: /Discard changes/ }).check()
  await dialog(h.page).getByRole('button', { name: 'Reset', exact: true }).click()
  await expect.poll(() => existsSync(join(demo, 'precious.txt'))).toBe(false)
  await toolbar(/^Undo: Reset to/).click()
  await expect.poll(headSha).toBe(before)
  // Undo moves HEAD back first, then puts the saved work back.
  await expect.poll(() => existsSync(join(demo, 'precious.txt'))).toBe(true)
  expect(readFileSync(join(demo, 'precious.txt'), 'utf8')).toBe('do not lose me\n')
  expect(readFileSync(join(demo, 'README.md'), 'utf8')).toContain('unsaved edit')
  h.git(demo, 'stash', 'push', '--all', '-q', '-m', 'park again')
})

test('F18-E2 reverting a merge asks first, then keeps the branch it was merged into', async () => {
  await toGraph(h.page)
  await menu(h.page, commitRow(h.page, 'Merge branch feature/units'), 'Revert this commit')
  await expect(dialog(h.page).getByRole('heading', { name: 'Revert a merge?' })).toBeVisible()
  await dialog(h.page).getByRole('button', { name: 'Revert merge' }).click()
  await expect.poll(() => subject()).toBe('Revert "Merge branch feature/units"')
  expect(readFileSync(join(demo, 'README.md'), 'utf8')).not.toContain('--units F')
})

// ---------- F14 ----------

test('F14-E4 Ctrl+Z while typing undoes the text, not a git action', async () => {
  const before = headSha()
  writeFileSync(join(demo, 'typing.txt'), 'x\n')
  await openWip(h.page)
  await h.page.getByLabel('Commit summary').fill('abc')
  await h.page.getByLabel('Commit summary').press('Control+z')
  await h.page.waitForTimeout(500)
  expect(headSha()).toBe(before)
  h.git(demo, 'clean', '-fq', '--', 'typing.txt')
})

test('F14-E1 undo is refused after the repository changed outside the app', async () => {
  // The last app action is the revert; now someone commits from a terminal.
  writeAndCommit(h.env, demo, 'Committed from a terminal', { 'terminal.txt': 'cli\n' })
  await expect(commitRow(h.page, 'Committed from a terminal')).toBeVisible()
  const before = headSha()
  await toolbar(/^Undo: Revert/).click()
  await expect(toasts()).toContainText('changed outside the app')
  expect(headSha()).toBe(before)
  await dismissToasts()
})

test('F14-E2 undo history survives restarting the app', async () => {
  writeFileSync(join(demo, 'restart.txt'), 'r\n')
  await openWip(h.page)
  await h.page.getByRole('button', { name: 'Stage all', exact: true }).click()
  await h.page.getByLabel('Commit summary').fill('Before the restart')
  await h.page.getByRole('form', { name: 'Commit' }).getByRole('button', { name: /^Commit/ }).click()
  await expect.poll(() => subject()).toBe('Before the restart')
  // The undo entry is written just after git commits; quit only once the app shows it.
  await expect(toolbar(/^Undo: Commit “Before the restart”/)).toBeVisible()
  const committed = headSha()
  h.expectClean()
  await h.close()
  h = await launch('edits', { open: [demo], reseed: false, keepUserData: true })
  await h.page.getByRole('tab', { name: 'demo' }).click()
  await grid(h.page).getByRole('row', { name: /^Before the restart/ }).waitFor()
  await toolbar(/^Undo: Commit “Before the restart”/).click()
  await expect.poll(headSha).toBe(h.git(demo, 'rev-parse', `${committed}~1`))
})

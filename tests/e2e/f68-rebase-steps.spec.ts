// F68: more rebase steps. Stop at a commit to edit it, then continue; move branches stacked on the rewritten commits
// along (--update-refs), undone with the rest; and move only a branch's own commits onto another branch (--onto).
import { test, expect } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { commitRow, dialog, gitIn, launch, makeRepo, seed, writeAndCommit, type Harness } from './harness'

let h: Harness
const repo = join(seed, 'steps')

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => {
  h = await launch('steps', {
    open: [repo],
    setup: (env) => {
      makeRepo(env, 'steps', [
        ['Base', { 'base.txt': 'base\n' }],
        ['Add apple', { 'apple.txt': 'apple\n' }],
        ['Add banana', { 'banana.txt': 'banana\n' }],
        ['Add cherry', { 'cherry.txt': 'cherry\n' }]
      ])
      // A branch stacked on main's commits, and a topic branch started from another feature branch.
      gitIn(env, repo, 'branch', '-q', 'stack', 'HEAD~1')
      gitIn(env, repo, 'branch', '-q', 'feature', 'HEAD~3')
      gitIn(env, repo, 'switch', '-q', 'feature')
      writeAndCommit(env, repo, 'Feature work', { 'feature.txt': 'f\n' })
      gitIn(env, repo, 'switch', '-q', '-c', 'topic')
      writeAndCommit(env, repo, 'Topic one', { 'one.txt': '1\n' })
      writeAndCommit(env, repo, 'Topic two', { 'two.txt': '2\n' })
      gitIn(env, repo, 'switch', '-q', 'main')
    }
  })
  await h.page.getByRole('tab', { name: 'steps', exact: true }).click()
})
test.afterAll(async () => {
  await h.close()
})
test.afterEach(() => h.expectClean())

const toasts = () => h.page.getByRole('region', { name: /Notifications/ })
const refocus = () => h.page.evaluate(() => window.dispatchEvent(new Event('focus')))
const sha = (rev: string): string => h.git(repo, 'rev-parse', rev)
const summaries = (range: string): string[] => h.git(repo, 'log', '--format=%s', range).split('\n')
const list = () => h.page.getByRole('list', { name: 'Commits, newest first' })
const step = (summary: string) => list().getByRole('listitem').filter({ hasText: summary })
async function rewriteAfter(summary: string): Promise<void> {
  await commitRow(h.page, summary).click({ button: 'right' })
  await h.page.getByRole('menuitem', { name: /^Rewrite main after this commit/ }).click()
}

let main0 = ''
let stack0 = ''
test('F68-H1: a branch stacked on the rewritten commits moves along when asked', async () => {
  main0 = sha('main')
  stack0 = sha('stack')
  await rewriteAfter('Base')
  const along = h.page.getByRole('checkbox', { name: 'Move stack along' })
  await expect(along).not.toBeChecked()
  await along.click()
  await step('Add apple').getByRole('radio', { name: 'Reword' }).click()
  await dialog(h.page).getByLabel('Summary').fill('Add an apple')
  await dialog(h.page).getByRole('button', { name: 'Save message' }).click()
  await h.page.getByRole('button', { name: 'Start rebase' }).click()
  await expect(toasts().getByText('Rebase finished')).toBeVisible()
  expect(summaries('main')).toEqual(['Add cherry', 'Add banana', 'Add an apple', 'Base'])
  expect(sha('stack')).toBe(sha('main~1'))
})

test('F68-H2: undo puts the stacked branch back too; redo moves it again', async () => {
  const moved = sha('stack')
  await h.page.keyboard.press('Control+z')
  await expect.poll(() => sha('stack')).toBe(stack0)
  expect(sha('main')).toBe(main0)
  await h.page.keyboard.press('Control+y')
  await expect.poll(() => sha('stack')).toBe(moved)
  expect(sha('stack')).toBe(sha('main~1'))
})

test('F68-H3: an Edit step stops at its commit; staged changes go into it on Continue', async () => {
  await rewriteAfter('Base')
  // Nothing set rebase.updateRefs, so stacked branches stay put unless ticked.
  await expect(h.page.getByRole('checkbox', { name: 'Move stack along' })).not.toBeChecked()
  await step('Add an apple').getByRole('radio', { name: 'Edit' }).click()
  await expect(h.page.getByText(/It stops after each commit marked Edit/)).toBeVisible()
  await h.page.getByRole('button', { name: 'Start rebase' }).click()
  await expect(toasts().getByText('Stopped to edit a commit')).toBeVisible()
  const banner = h.page.getByRole('region', { name: 'Paused operation' })
  await expect(banner.getByText(/stopped at [0-9a-f]{7} “Add an apple” to edit it/)).toBeVisible()
  await expect(banner.getByRole('button', { name: 'Skip this commit' })).toHaveCount(0)

  // Unstaged changes are in the way.
  writeFileSync(join(repo, 'apple.txt'), 'green apple\n')
  await refocus()
  await banner.getByRole('button', { name: 'Continue' }).click()
  await expect(toasts().getByText(/Stage or discard your changes first/)).toBeVisible()

  h.git(repo, 'add', 'apple.txt')
  await refocus()
  await banner.getByRole('button', { name: 'Continue' }).click()
  await expect(toasts().getByText('Finished. Everything’s back in one piece.')).toBeVisible()
  expect(summaries('main')).toEqual(['Add cherry', 'Add banana', 'Add an apple', 'Base'])
  expect(h.git(repo, 'show', 'main~2:apple.txt')).toBe('green apple')
  expect(h.git(repo, 'status', '--porcelain')).toBe('')
})

test('F68-H4: the commits after one move onto another branch; what came before stays behind', async () => {
  const topic0 = sha('topic')
  h.git(repo, 'switch', '-q', 'topic')
  await refocus()
  await expect(h.page.getByRole('button', { name: /topic/ }).first()).toBeVisible()
  await commitRow(h.page, 'Feature work').click({ button: 'right' })
  await h.page.getByRole('menuitem', { name: 'Move topic’s commits after this onto…' }).click()
  await expect(dialog(h.page).getByText(/The 2 commits after [0-9a-f]{7} on topic are replayed/)).toBeVisible()
  await dialog(h.page).getByLabel('Onto').fill('main')
  await dialog(h.page).getByRole('button', { name: 'Rebase' }).click()
  await expect(toasts().getByText('Moved topic’s commits onto main')).toBeVisible()
  expect(summaries('main..topic')).toEqual(['Topic two', 'Topic one'])
  expect(sha('topic~2')).toBe(sha('main'))

  await h.page.keyboard.press('Control+z')
  await expect.poll(() => sha('topic')).toBe(topic0)
})

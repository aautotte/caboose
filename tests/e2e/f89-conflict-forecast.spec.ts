// F89: before a merge, rebase or pull that would conflict, Caboose says so and asks, from git merge-tree: nothing
// is touched until you go ahead. One that goes through cleanly doesn't ask.
import { test, expect } from '@playwright/test'
import { join } from 'node:path'
import { dialog, gitIn, launch, makeRepo, seed, writeAndCommit, type Harness } from './harness'

let h: Harness
const repo = join(seed, 'forecast')
const origin = join(seed, 'forecast-origin.git')
const mate = join(seed, 'forecast-mate')

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => {
  h = await launch('forecast', {
    open: [repo],
    setup: (env) => {
      makeRepo(env, 'forecast', [['Base', { 'a.txt': 'one\ntwo\nthree\n' }]])
      gitIn(env, repo, 'branch', '-q', 'clean')
      gitIn(env, repo, 'switch', '-q', '-c', 'feature')
      writeAndCommit(env, repo, 'Feature edits two', { 'a.txt': 'one\ntwo feature\nthree\n' })
      gitIn(env, repo, 'switch', '-q', 'clean')
      writeAndCommit(env, repo, 'Add c', { 'c.txt': 'c\n' })
      gitIn(env, repo, 'switch', '-q', 'main')
      writeAndCommit(env, repo, 'Add notes', { 'notes.txt': 'notes\n' })
      writeAndCommit(env, repo, 'Main edits two', { 'a.txt': 'one\ntwo main\nthree\n' })
    }
  })
  await h.page.getByRole('tab', { name: 'forecast', exact: true }).click()
})
test.afterAll(() => h.close())
test.afterEach(() => h.expectClean())

const panel = () => h.page.getByRole('navigation', { name: 'Branches and tags' })
const branch = (name: string) => panel().getByRole('tree', { name: 'Local branches' }).getByRole('treeitem', { name, exact: true })
async function fromMenu(name: string, item: string): Promise<void> {
  await branch(name).click({ button: 'right' })
  await h.page.getByRole('menuitem', { name: item, exact: true }).click()
}
const toasts = () => h.page.getByRole('region', { name: /Notifications/ })
const head = (): string => h.git(repo, 'rev-parse', 'HEAD')

test('F89-H1: a merge that would conflict says where and asks; Cancel leaves everything as it was', async () => {
  const before = head()
  await fromMenu('feature', 'Merge into main')
  await expect(dialog(h.page)).toHaveAccessibleName('Merging feature into main will conflict')
  await expect(dialog(h.page)).toContainText('Both sides changed the same lines in a.txt.')
  await dialog(h.page).getByRole('button', { name: 'Cancel' }).click()
  expect(head()).toBe(before)
  expect(h.git(repo, 'status', '--porcelain')).toBe('')
})

test('F89-H2: Merge anyway merges, and stops at the conflicts', async () => {
  await fromMenu('feature', 'Merge into main')
  await dialog(h.page).getByRole('button', { name: 'Merge anyway' }).click()
  await expect(toasts()).toContainText('Conflicts to sort out')
  expect(h.git(repo, 'status', '--porcelain')).toContain('UU a.txt')
  h.git(repo, 'merge', '--abort')
})

test('F89-H3: a merge that goes through cleanly doesn’t ask', async () => {
  await fromMenu('clean', 'Merge into main')
  await expect(toasts()).toContainText('Merged clean into main')
  await expect(dialog(h.page)).toHaveCount(0)
  expect(h.git(repo, 'log', '-1', '--format=%s')).toContain('Merge branch')
  h.git(repo, 'reset', '-q', '--hard', 'HEAD~1')
})

test('F89-H4: a rebase says which commit it would stop at, with which files', async () => {
  const before = head()
  await fromMenu('feature', 'Rebase main onto feature')
  await expect(dialog(h.page)).toHaveAccessibleName('Rebasing main onto feature will conflict')
  await expect(dialog(h.page)).toContainText('It would stop at “Main edits two” (commit 2 of 2), with conflicts in a.txt.')
  await dialog(h.page).getByRole('button', { name: 'Cancel' }).click()
  expect(head()).toBe(before)
})

test('F89-H5: pulling when both sides have new commits that clash asks first, as of the last fetch', async () => {
  // An origin with a teammate's commit on the same line.
  gitIn(h.env, seed, 'clone', '-q', '--bare', repo, origin)
  h.git(repo, 'remote', 'add', 'origin', origin)
  h.git(repo, 'fetch', '-q', 'origin')
  h.git(repo, 'branch', '-q', '-u', 'origin/main', 'main')
  gitIn(h.env, seed, 'clone', '-q', origin, mate)
  writeAndCommit(h.env, mate, 'Teammate edits three', { 'a.txt': 'one\ntwo main\nthree theirs\n' })
  gitIn(h.env, mate, 'push', '-q', 'origin', 'main')
  writeAndCommit(h.env, repo, 'Mine edits three', { 'a.txt': 'one\ntwo main\nthree mine\n' })
  await h.page.getByRole('button', { name: 'Fetch now' }).click()
  const toolbar = h.page.getByRole('toolbar', { name: 'Repository actions' })
  await expect(branch('main, 1 ahead, 1 behind')).toBeVisible()
  const before = head()
  await toolbar.getByRole('button', { name: 'Pull (fast-forward when possible)' }).click()
  await expect(dialog(h.page)).toHaveAccessibleName('Pulling will conflict')
  await expect(dialog(h.page)).toContainText('Both sides changed the same lines in a.txt.')
  await expect(dialog(h.page)).toContainText('This is from the last fetch')
  await dialog(h.page).getByRole('button', { name: 'Cancel' }).click()
  expect(head()).toBe(before)
})

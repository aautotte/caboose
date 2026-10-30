// F63: the reflog. Every move of HEAD, newest first; commits no branch leads to any more are marked, and can be
// brought back with a branch, or the branch reset to them.
import { test, expect } from '@playwright/test'
import { join } from 'node:path'
import { dialog, gitIn, launch, makeRepo, seed, writeAndCommit, type Harness } from './harness'

let h: Harness
const repo = join(seed, 'reflog')

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => {
  h = await launch('reflog', {
    open: [repo],
    setup: (env) => {
      makeRepo(env, 'reflog', [
        ['First', { 'a.txt': '1\n' }],
        ['Second', { 'a.txt': '2\n' }]
      ])
      // A commit on a branch that's then deleted: only the reflog still knows it.
      gitIn(env, repo, 'checkout', '-q', '-b', 'spike')
      writeAndCommit(env, repo, 'Spike work', { 'b.txt': 'spike\n' })
      gitIn(env, repo, 'checkout', '-q', 'main')
      gitIn(env, repo, 'branch', '-q', '-D', 'spike')
      writeAndCommit(env, repo, 'Third', { 'a.txt': '3\n' })
    }
  })
  await h.page.getByRole('tab', { name: 'reflog', exact: true }).click()
})
test.afterAll(async () => {
  await h.close()
})
test.afterEach(() => h.expectClean())

const list = () => h.page.getByRole('listbox', { name: 'Moves of HEAD, newest first' })
const entry = (name: RegExp) => list().getByRole('option', { name })
const details = () => h.page.getByRole('region', { name: 'Details' })

test('F63-H1: the reflog lists every move of HEAD, newest first, and marks the commit no branch has', async () => {
  await h.page.keyboard.press('Control+p')
  await h.page.keyboard.type('Reflog')
  await h.page.keyboard.press('Enter')
  await expect(list().getByRole('option').first()).toHaveAccessibleName(/^commit: Third/)
  await expect(entry(/^commit: Spike work/)).toHaveAccessibleName(/not on a branch$/)
  await expect(entry(/^checkout: moving from main to spike/)).toBeVisible()
  // The newest is picked, and the details panel shows its commit.
  await expect(details().getByText('Third', { exact: true })).toBeVisible()
})

test('F63-H2: Create branch here brings a lost commit back', async () => {
  await entry(/^commit: Spike work/).click()
  await expect(details().getByText('Spike work', { exact: true })).toBeVisible()
  await h.page.getByRole('button', { name: 'Create branch here…' }).click()
  const d = dialog(h.page)
  await d.getByRole('textbox', { name: 'Branch name' }).fill('rescued')
  await d.getByRole('switch', { name: 'Switch to it now' }).click()
  await d.getByRole('button', { name: 'Create branch' }).click()
  await expect.poll(h.gitOr(repo, 'log', '-1', '--format=%s', 'rescued')).toBe('Spike work')
  await expect(entry(/^commit: Spike work/)).not.toHaveAccessibleName(/not on a branch$/)
})

test('F63-H3: Reset from the reflog moves the branch back to an earlier commit; undo puts it back', async () => {
  const third = h.git(repo, 'rev-parse', 'HEAD')
  await entry(/^commit: Second/).click({ button: 'right' })
  await h.page.getByRole('menuitem', { name: 'Reset main to this commit…' }).click()
  await dialog(h.page).getByRole('button', { name: 'Reset', exact: true }).click()
  await expect.poll(() => h.git(repo, 'log', '-1', '--format=%s', 'main')).toBe('Second')
  // The reset itself is a new move, at the top.
  await expect(list().getByRole('option').first()).toHaveAccessibleName(/^reset: moving to/)
  await h.page.keyboard.press('Control+z')
  await expect.poll(() => h.git(repo, 'rev-parse', 'HEAD')).toBe(third)
})

test('F63-H4: Esc goes back to the graph', async () => {
  await list().focus()
  await h.page.keyboard.press('Escape')
  await expect(list()).toHaveCount(0)
  await expect(h.page.getByRole('grid', { name: 'Commit history' })).toBeVisible()
})

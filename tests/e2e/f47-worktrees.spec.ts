// F47: worktrees. Make one from a branch, a remote branch or the section; open it in a tab; switching to a branch
// that's checked out in another worktree offers that worktree (BUG-028); remove one (asking again if it has
// changes, closing its tab first); forget one whose folder is gone; lock and unlock.
import { test, expect } from '@playwright/test'
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dialog, gitIn, launch, makeRepo, seed, type Harness } from './harness'

let h: Harness
const origin = join(seed, 'wt-origin.git')
const repo = join(seed, 'wt')
const wt = (name: string): string => `${repo}-${name}`

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => {
  h = await launch('wt', {
    open: [repo],
    setup: (env) => {
      for (const d of [origin, repo, wt('feat'), wt('topic'), wt('side'), wt('gone'), wt('remote-only')]) rmSync(d, { recursive: true, force: true })
      const src = makeRepo(env, 'wt-src', [
        ['Start', { 'README.md': 'hi\n' }],
        ['Second', { 'a.txt': 'a\n' }]
      ])
      gitIn(env, src, 'branch', 'feat')
      gitIn(env, src, 'branch', 'side')
      gitIn(env, src, 'branch', 'gone')
      gitIn(env, src, 'branch', 'remote-only')
      gitIn(env, seed, 'clone', '-q', '--bare', src, origin)
      gitIn(env, seed, 'clone', '-q', origin, repo)
      for (const b of ['feat', 'side', 'gone']) gitIn(env, repo, 'branch', '-q', b, `origin/${b}`)
    }
  })
  await h.page.getByRole('tab', { name: 'wt', exact: true }).click()
})
test.afterAll(async () => {
  await h.close()
})
test.afterEach(() => h.expectClean())

const section = () => h.page.getByRole('tree', { name: 'Worktrees' })
const wtRow = (name: string) => section().getByRole('treeitem', { name: new RegExp(`^${name},`) })
const branch = (name: string) => h.page.getByRole('tree', { name: 'Local branches' }).getByRole('treeitem', { name: new RegExp(`^${name}(,|$)`) })
const tab = (name: string) => h.page.getByRole('tab', { name, exact: true })
const toasts = () => h.page.getByRole('region', { name: /Notifications/ })
const listed = (): string => h.git(repo, 'worktree', 'list', '--porcelain')
async function pick(target: ReturnType<typeof branch>, item: string): Promise<void> {
  await target.click({ button: 'right' })
  await h.page.getByRole('menuitem', { name: item, exact: true }).click()
}

test('F47-H1: Check out in a new worktree makes a sibling folder on that branch and opens it in a tab', async () => {
  // Only the main worktree so far: no section.
  await expect(branch('feat')).toBeVisible()
  await expect(section()).toHaveCount(0)
  await pick(branch('feat'), 'Check out in a new worktree…')
  await expect(dialog(h.page).getByLabel('Folder', { exact: true })).toHaveValue(wt('feat'))
  await dialog(h.page).getByRole('button', { name: 'Create worktree' }).click()
  await expect(tab('wt-feat')).toHaveAttribute('aria-selected', 'true')
  expect(h.git(wt('feat'), 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('feat')

  await tab('wt').click()
  await expect(section().getByRole('treeitem')).toHaveCount(2)
  await expect(wtRow('wt')).toHaveAccessibleName('wt, main, main worktree, this tab')
  await expect(wtRow('wt-feat')).toHaveAccessibleName('wt-feat, feat')
  await expect(branch('feat')).toHaveAccessibleName('feat, in worktree wt-feat')
})

test('F47-H2 (BUG-028): switching to a branch checked out in another worktree offers that worktree instead', async () => {
  await branch('feat').dblclick()
  await expect(dialog(h.page)).toContainText('feat is checked out in another worktree')
  await dialog(h.page).getByRole('button', { name: 'Open that worktree' }).click()
  await expect(tab('wt-feat')).toHaveAttribute('aria-selected', 'true')
  expect(h.git(repo, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main')
})

test('F47-H3: a commit made from a terminal in a linked worktree shows up in its tab', async () => {
  // Its HEAD and refs live in the main worktree's .git, not in its own folder.
  writeFileSync(join(wt('feat'), 'f.txt'), 'f\n')
  h.git(wt('feat'), 'add', 'f.txt')
  h.git(wt('feat'), '-c', 'user.name=T', '-c', 'user.email=t@e.st', 'commit', '-q', '-m', 'Made in a terminal')
  await expect(h.page.getByRole('grid', { name: 'Commit history' }).getByText('Made in a terminal')).toBeVisible()
})

test('F47-H4: New worktree from the section makes a new branch; from a remote branch, one that tracks it', async () => {
  await tab('wt').click()
  // The + in the section's header.
  await h.page.locator('#left-section-worktrees').getByRole('button', { name: 'New worktree' }).click()
  await dialog(h.page).getByLabel('Branch name').fill('topic')
  await expect(dialog(h.page).getByLabel('Folder', { exact: true })).toHaveValue(wt('topic'))
  await dialog(h.page).getByRole('switch', { name: 'Open it in a new tab' }).click()
  await dialog(h.page).getByRole('button', { name: 'Create worktree' }).click()
  await expect(wtRow('wt-topic')).toBeVisible()
  await expect(tab('wt-topic')).toHaveCount(0)
  expect(h.git(wt('topic'), 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('topic')

  const remote = h.page.getByRole('group', { name: 'origin' }).getByRole('treeitem', { name: 'remote-only', exact: true })
  await remote.click({ button: 'right' })
  await h.page.getByRole('menuitem', { name: 'Check out in a new worktree…', exact: true }).click()
  await expect(dialog(h.page).getByLabel('Branch name')).toHaveValue('remote-only')
  await dialog(h.page).getByRole('switch', { name: 'Open it in a new tab' }).click()
  await dialog(h.page).getByRole('button', { name: 'Create worktree' }).click()
  await expect(wtRow('wt-remote-only')).toBeVisible()
  expect(h.git(repo, 'rev-parse', '--abbrev-ref', 'remote-only@{upstream}')).toBe('origin/remote-only')
})

test('F47-H5: removing a worktree with uncommitted changes asks again; the branch stays', async () => {
  writeFileSync(join(wt('topic'), 'draft.txt'), 'unsaved\n')
  await pick(wtRow('wt-topic'), 'Remove…')
  await dialog(h.page).getByRole('button', { name: 'Remove worktree' }).click()
  await expect(dialog(h.page)).toContainText('wt-topic has uncommitted changes')
  await dialog(h.page).getByRole('button', { name: 'Remove anyway' }).click()
  await expect(toasts().getByText('Removed the worktree wt-topic')).toBeVisible()
  expect(existsSync(wt('topic'))).toBe(false)
  expect(h.git(repo, 'branch', '--list', 'topic')).toContain('topic')
})

test('F47-H6: removing a worktree that’s open in a tab closes the tab first, then deletes the folder', async () => {
  await expect(tab('wt-feat')).toBeVisible()
  await pick(wtRow('wt-feat'), 'Remove…')
  await dialog(h.page).getByRole('button', { name: 'Remove worktree' }).click()
  await expect(tab('wt-feat')).toHaveCount(0)
  await expect.poll(() => existsSync(wt('feat'))).toBe(false)
  expect(listed()).not.toContain('wt-feat')
  // feat is free again: switching to it works here now.
  await branch('feat').dblclick()
  await expect.poll(h.gitOr(repo, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('feat')
  // The screen catches up before the next double-click (on the branch shown as current, it does nothing).
  await expect(branch('feat')).toHaveAttribute('aria-current', 'true')
  await branch('main').dblclick()
  await expect.poll(h.gitOr(repo, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main')
})

test('F47-H7: a worktree whose folder was deleted shows as missing; switching to its branch forgets it, then switches', async () => {
  h.git(repo, 'worktree', 'add', '-q', wt('gone'), 'gone')
  rmSync(wt('gone'), { recursive: true, force: true })
  // Nothing tells the app a folder outside the repository went away; any ref change makes it look again.
  h.git(repo, 'tag', 'nudge')
  await expect(wtRow('wt-gone')).toHaveAccessibleName('wt-gone, gone, folder missing')
  await branch('gone').dblclick()
  await expect(dialog(h.page)).toContainText('gone is checked out in a worktree that’s gone')
  await dialog(h.page).getByRole('button', { name: 'Forget and switch' }).click()
  await expect.poll(h.gitOr(repo, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('gone')
  // The screen catches up before the next double-click (on the branch shown as current, it does nothing).
  await expect(branch('gone')).toHaveAttribute('aria-current', 'true')
  await expect(wtRow('wt-gone')).toHaveCount(0)
  await branch('main').dblclick()
  await expect.poll(h.gitOr(repo, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main')
})

test('F47-H8: lock and unlock; a locked worktree can still be removed from its menu', async () => {
  await pick(wtRow('wt-remote-only'), 'Lock (keep it from being removed)')
  await expect(wtRow('wt-remote-only')).toHaveAccessibleName('wt-remote-only, remote-only, locked')
  expect(listed()).toMatch(/wt-remote-only\nHEAD \w+\nbranch refs\/heads\/remote-only\nlocked/)
  await pick(wtRow('wt-remote-only'), 'Unlock')
  await expect(wtRow('wt-remote-only')).toHaveAccessibleName('wt-remote-only, remote-only')
  await pick(wtRow('wt-remote-only'), 'Lock (keep it from being removed)')
  await pick(wtRow('wt-remote-only'), 'Remove…')
  await dialog(h.page).getByRole('button', { name: 'Remove worktree' }).click()
  await expect.poll(() => existsSync(wt('remote-only'))).toBe(false)
  // Back to the main worktree alone: the section goes away.
  await expect(section()).toHaveCount(0)
})

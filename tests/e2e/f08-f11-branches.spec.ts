// F08 branches, F09 merge, F10 conflicts (all kinds), F11 rebase: edge and negative cases on a purpose-built repo.
import { test, expect } from '@playwright/test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dialog, gitIn, grid, launch, openDiffNow, repoId, makeRepo, menu, openWip, seed, toGraph, writeAndCommit, type Harness } from './harness'

let h: Harness
let repo = ''
const lines = (n: number, change = ''): string => Array.from({ length: n }, (_, i) => `line ${i + 1}${i === 2 ? change : ''}`).join('\n') + '\n'
const bin = (b: number): string => String.fromCharCode(0, 1, 2, b, 0, 255)

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => {
  h = await launch('branches', {
    open: [join(seed, 'branchy')],
    setup: (env) => {
      repo = makeRepo(env, 'branchy', [['Start', { 'a.txt': lines(6), 'del.txt': 'keep or delete?\n', 'bin.dat': bin(1) }]])
      const g = (...a: string[]): string => gitIn(env, repo, ...a)
      // topic: adds a file. behind: one commit on the old base. clash / clash2: edit a.txt line 3.
      g('branch', 'topic')
      g('branch', 'behind')
      g('branch', 'clash')
      g('branch', 'clash2')
      g('branch', 'deleter')
      g('branch', 'binbranch')
      for (const [b, msg, files] of [
        ['topic', 'Topic work', { 'topic.txt': 'topic\n' }],
        ['behind', 'Behind work', { 'behind.txt': 'behind\n' }],
        ['clash', 'Clash edits line 3', { 'a.txt': lines(6, ' (clash)') }],
        ['clash2', 'Clash2 edits line 3', { 'a.txt': lines(6, ' (clash2)') }],
        ['deleter', 'Delete del.txt', { 'del.txt': null }],
        ['binbranch', 'Binary edit on a branch', { 'bin.dat': bin(7) }]
      ] as const) {
        g('switch', '-q', b)
        writeAndCommit(env, repo, msg, files as Record<string, string | null>)
      }
      g('switch', '-q', 'main')
      writeAndCommit(env, repo, 'Main edits line 3, del.txt and bin.dat', { 'a.txt': lines(6, ' (main)'), 'del.txt': 'edited on main\n', 'bin.dat': bin(9) })
      // A remote with a branch that only exists there.
      g('clone', '-q', '--bare', '.', join(seed, 'branchy-origin.git'))
      g('remote', 'add', 'origin', join(seed, 'branchy-origin.git'))
      gitIn(env, join(seed, 'branchy-origin.git'), 'branch', 'remote-only', 'topic')
      g('fetch', '-q', 'origin')
    }
  })
  await h.page.getByRole('tab', { name: 'branchy' }).click()
  await grid(h.page).getByRole('row', { name: /^Main edits line 3/ }).waitFor()
})
test.afterAll(async () => {
  await h.close()
})
test.afterEach(() => h.expectClean())

const head = (): string => h.git(repo, 'rev-parse', '--abbrev-ref', 'HEAD')
const toasts = () => h.page.getByRole('region', { name: /Notifications/ })
const local = (name: string | RegExp) => h.page.getByRole('tree', { name: 'Local branches' }).getByRole('treeitem', { name })
async function dismissToasts(): Promise<void> {
  for (const b of await toasts().getByRole('button', { name: 'Dismiss' }).all()) await b.click().catch(() => {})
}

// ---------- F08 ----------

test('F08-H1 new branch from the keyboard, switched to straight away', async () => {
  await grid(h.page).focus()
  await h.page.keyboard.press('Control+b')
  await dialog(h.page).getByLabel('Branch name').fill('feature/new-thing')
  await h.page.keyboard.press('Enter')
  await expect.poll(head).toBe('feature/new-thing')
  h.git(repo, 'switch', '-q', 'main')
  await expect(local(/^main/)).toHaveAttribute('aria-current', 'true')
})

test('F08-E1 a name with a space is rejected inline', async () => {
  await h.page.keyboard.press('Control+b')
  await dialog(h.page).getByLabel('Branch name').fill('has space')
  await expect(dialog(h.page).getByText(/Use dashes or slashes instead of spaces/)).toBeVisible()
  await expect(dialog(h.page).getByRole('button', { name: 'Create branch' })).toBeDisabled()
})

test('F08-E2 an existing name is rejected inline', async () => {
  await dialog(h.page).getByLabel('Branch name').fill('topic')
  await expect(dialog(h.page).getByText(/already exists/)).toBeVisible()
  await expect(dialog(h.page).getByRole('button', { name: 'Create branch' })).toBeDisabled()
})

test('F08-E4 accented branch names work', async () => {
  await dialog(h.page).getByLabel('Branch name').fill('feature/café')
  await dialog(h.page).getByRole('button', { name: 'Create branch' }).click()
  await expect.poll(head).toBe('feature/café')
  h.git(repo, 'switch', '-q', 'main')
})

test('F08-E3 switching branches with local changes in the way keeps them and explains', async () => {
  writeFileSync(join(repo, 'a.txt'), lines(6, ' (unsaved)'))
  await local(/^clash/).first().dblclick()
  await expect(toasts().getByText(/Couldn’t switch to clash/)).toBeVisible()
  await expect(toasts()).toContainText(/overwritten/i)
  expect(head()).toBe('main')
  expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toContain('(unsaved)')
  h.git(repo, 'checkout', '--', 'a.txt')
  await dismissToasts()
})

test('F08-E5 double-clicking a branch that only exists on the remote creates a local branch that tracks it, without switching', async () => {
  await h.page.getByRole('group', { name: 'origin' }).getByRole('treeitem', { name: 'remote-only' }).dblclick()
  await expect.poll(h.gitOr(repo, 'rev-parse', '--abbrev-ref', 'remote-only@{upstream}')).toBe('origin/remote-only')
  expect(head()).toBe('main')
})

// ---------- F09 ----------

test('F09-H1 merge by dragging one branch onto another', async () => {
  // A branch alone on its commit, so its pill is the one shown (others fold into "+N").
  h.git(repo, 'switch', '-q', '-c', 'drag-me')
  writeAndCommit(h.env, repo, 'Work to drag in', { 'dragged.txt': 'dragged\n' })
  h.git(repo, 'switch', '-q', 'main')
  await toGraph(h.page)
  const pill = (name: string) => grid(h.page).locator('[draggable]').filter({ hasText: new RegExp(`^${name}$`) })
  await expect(pill('drag-me')).toBeVisible()
  // Let the app catch up with the terminal commands first; a refresh mid-drag shifts the rows under the pointer.
  await expect(grid(h.page).getByRole('row', { name: /^Work to drag in/ })).toBeVisible()
  await expect(local(/^main/)).toHaveAttribute('aria-current', 'true')
  await h.page.waitForTimeout(600)
  await pill('drag-me').dragTo(pill('main'))
  await h.page.getByRole('menuitem', { name: 'Merge drag-me into main' }).click()
  await expect.poll(() => existsSync(join(repo, 'dragged.txt'))).toBe(true)
  expect(head()).toBe('main')
})

test('F09-E1 merging again says there is nothing to do', async () => {
  await menu(h.page, local(/^drag-me/), 'Merge into main')
  await expect(toasts().getByText('Already up to date.')).toBeVisible()
  await dismissToasts()
})

test('F09-E4 a branch folded into “+N” on a shared commit can still be merged from the chip', async () => {
  // remote-only (created in F08-E5) and topic point at the same commit; remote-only gets the pill.
  await toGraph(h.page)
  const row = grid(h.page).getByRole('row', { name: /^Topic work/ })
  await row.getByRole('button', { name: /more on this commit: .*topic/ }).click()
  await h.page.getByRole('menuitem', { name: 'topic', exact: true }).click()
  await h.page.getByRole('menuitem', { name: 'Merge topic into main' }).click()
  await expect.poll(() => existsSync(join(repo, 'topic.txt'))).toBe(true)
})

test('F09-E3 a merge that would overwrite local changes changes nothing', async () => {
  writeFileSync(join(repo, 'a.txt'), lines(6, ' (unsaved)'))
  const before = h.git(repo, 'rev-parse', 'HEAD')
  await menu(h.page, local(/^clash/).first(), 'Merge into main')
  await expect(toasts().getByText(/Couldn’t merge clash/)).toBeVisible()
  expect(h.git(repo, 'rev-parse', 'HEAD')).toBe(before)
  expect(existsSync(join(repo, '.git', 'MERGE_HEAD'))).toBe(false)
  expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toContain('(unsaved)')
  h.git(repo, 'checkout', '--', 'a.txt')
  await dismissToasts()
})

test('F09-E2 / F10-E1 a conflicting merge pauses; Abort puts everything back', async () => {
  const before = h.git(repo, 'rev-parse', 'HEAD')
  await menu(h.page, local(/^clash/).first(), 'Merge into main')
  await expect(h.page.getByRole('region', { name: 'Paused operation' })).toContainText('Merging')
  await h.page.getByRole('region', { name: 'Paused operation' }).getByRole('button', { name: 'Abort' }).click()
  await dialog(h.page).getByRole('button', { name: 'Abort' }).click()
  await expect.poll(() => existsSync(join(repo, '.git', 'MERGE_HEAD'))).toBe(false)
  expect(h.git(repo, 'rev-parse', 'HEAD')).toBe(before)
  expect(h.git(repo, 'status', '--porcelain')).toBe('')
})

// ---------- F10 ----------

test('F10-E2 one side deleted a file the other edited: keeping the deletion works', async () => {
  await menu(h.page, local(/^deleter/), 'Merge into main')
  await openWip(h.page)
  await h.page.getByRole('listbox', { name: /Not staged/ }).getByRole('option', { name: /del\.txt/ }).click()
  // The tool explains what happened instead of showing a three-way merge with a side missing.
  await expect(h.page.getByText(/del\.txt was deleted on deleter and changed on main/)).toBeVisible()
  await h.page.getByRole('button', { name: 'Delete it' }).click()
  await expect.poll(() => existsSync(join(repo, 'del.txt'))).toBe(false)
  await expect(toasts().getByText(/Couldn’t resolve/)).toHaveCount(0)
  await h.page.getByRole('region', { name: 'Paused operation' }).getByRole('button', { name: 'Continue' }).click()
  await expect.poll(() => h.gitOr(repo, 'log', '-1', '--format=%P')().split(' ').length).toBe(2)
  expect(h.git(repo, 'ls-files', 'del.txt')).toBe('')
})

test('F10-E3 a binary conflict offers whole-file choices', async () => {
  await menu(h.page, local(/^binbranch/), 'Merge into main')
  await openWip(h.page)
  await h.page.getByRole('listbox', { name: /Not staged/ }).getByRole('option', { name: /bin\.dat/ }).click()
  await expect(h.page.getByText('bin.dat is a binary file')).toBeVisible()
  await h.page.getByRole('button', { name: 'Keep main' }).click()
  await h.page.getByRole('region', { name: 'Paused operation' }).getByRole('button', { name: 'Continue' }).click()
  await expect.poll(() => existsSync(join(repo, '.git', 'MERGE_HEAD'))).toBe(false)
  // makeRepo writes strings as UTF-8; compare bytes the same way.
  expect(readFileSync(join(repo, 'bin.dat')).equals(Buffer.from(bin(9), 'utf8'))).toBe(true)
})

test('F10-E4 a cherry-pick that conflicts can be resolved and continued', async () => {
  await toGraph(h.page)
  await menu(h.page, grid(h.page).getByRole('row', { name: /^Clash2 edits line 3/ }), 'Cherry-pick onto main')
  await expect(h.page.getByRole('region', { name: 'Paused operation' })).toContainText('Cherry-picking')
  await h.page.getByRole('listbox', { name: /Not staged/ }).getByRole('option', { name: /a\.txt/ }).click()
  await h.page.getByRole('button', { name: /^Keep / }).last().click()
  await h.page.getByRole('region', { name: 'Paused operation' }).getByRole('button', { name: 'Continue' }).click()
  await expect.poll(h.gitOr(repo, 'log', '-1', '--format=%s')).toBe('Clash2 edits line 3')
})

test('F10-E5 a stash that conflicts when popped is kept, and its conflict can be resolved', async () => {
  writeFileSync(join(repo, 'a.txt'), lines(6, ' (stashed)'))
  h.git(repo, 'stash', 'push', '-q', '-m', 'my experiment')
  writeAndCommit(h.env, repo, 'Main moves on', { 'a.txt': lines(6, ' (main again)') })
  await toGraph(h.page)
  await h.page.getByRole('toolbar', { name: 'Repository actions' }).getByRole('button', { name: /^Pop the newest stash/ }).click()
  await expect(toasts().getByText(/conflicts with your files/)).toBeVisible()
  expect(h.git(repo, 'stash', 'list')).toContain('my experiment')
  await openWip(h.page)
  await h.page.getByRole('listbox', { name: /Not staged/ }).getByRole('option', { name: 'Conflicted a.txt' }).click()
  await h.page.getByRole('button', { name: /^Keep / }).first().click()
  await expect.poll(() => h.gitOr(repo, 'diff', '--name-only', '--diff-filter=U')()).toBe('')
  await dismissToasts()
})

test('F10-E6 the diff of a conflicted file says so and offers the merge tool', async () => {
  writeFileSync(join(repo, 'a.txt'), lines(6, ' (stashed again)'))
  h.git(repo, 'stash', 'push', '-q', '-m', 'second experiment')
  writeAndCommit(h.env, repo, 'Main moves once more', { 'a.txt': lines(6, ' (main once more)') })
  await toGraph(h.page)
  await h.page.getByRole('toolbar', { name: 'Repository actions' }).getByRole('button', { name: /^Pop the newest stash/ }).click()
  await expect(h.page.getByRole('listbox', { name: /Not staged/ }).getByRole('option', { name: 'Conflicted a.txt' })).toBeVisible()
  // As if the file had been clicked a moment before the app knew it was conflicted.
  await openDiffNow(h.page, await repoId(h.page, repo), 'a.txt', { kind: 'worktree' })
  await expect(h.page.getByText('a.txt has conflicts')).toBeVisible()
  await expect(h.page.getByText('No unstaged changes left')).toHaveCount(0)
  await h.page.getByRole('button', { name: 'Open the merge tool' }).click()
  await h.page.getByRole('button', { name: /^Keep / }).first().click()
  await expect.poll(() => h.gitOr(repo, 'diff', '--name-only', '--diff-filter=U')()).toBe('')
  await dismissToasts()
})

// ---------- F11 ----------

test('F11-H1 rebase a branch onto main from the menu', async () => {
  h.git(repo, 'reset', '-q', '--hard')
  h.git(repo, 'switch', '-q', 'behind')
  await toGraph(h.page)
  await expect(local(/^behind/)).toHaveAttribute('aria-current', 'true')
  await menu(h.page, local(/^main/), /^Rebase behind onto main$/)
  // merge-base --is-ancestor answers through its exit code, so ask git for a yes / no explicitly.
  const isAncestor = (): boolean => {
    try {
      h.git(repo, 'merge-base', '--is-ancestor', 'main', 'behind')
      return true
    } catch {
      return false
    }
  }
  await expect.poll(isAncestor).toBe(true)
  await expect.poll(() => existsSync(join(repo, '.git', 'rebase-merge'))).toBe(false)
  expect(h.git(repo, 'log', '-1', '--format=%s')).toBe('Behind work')
})

test('F11-E1 a rebase that conflicts can skip the commit and finish', async () => {
  // The app may still be refreshing after the last rebase (holding the index lock for a moment).
  await expect.poll(() => (h.gitOr(repo, 'switch', '-q', 'clash')(), head())).toBe('clash')
  await toGraph(h.page)
  // Wait until the app has noticed the switch, so its menu offers to rebase clash.
  await expect(local(/^clash/).first()).toHaveAttribute('aria-current', 'true')
  await menu(h.page, local(/^main/), /^Rebase clash onto main$/)
  await expect(h.page.getByRole('region', { name: 'Paused operation' })).toContainText('Rebasing')
  await h.page.getByRole('region', { name: 'Paused operation' }).getByRole('button', { name: 'Skip this commit' }).click()
  await expect.poll(() => existsSync(join(repo, '.git', 'rebase-merge'))).toBe(false)
  expect(h.git(repo, 'rev-parse', 'clash')).toBe(h.git(repo, 'rev-parse', 'main'))
})

// History editing and the branch panel: multi-select, squash, editing any message, moving a commit,
// range rebase, branch folders, eye icons, the rebase menu label and the merge tool's base column.
import { test, expect } from '@playwright/test'
import { join } from 'node:path'
import { appState, axe, dialog, gitIn, grid, launch, makeRepo, menu, openWip, repoId, seed, toGraph, writeAndCommit, type Harness } from './harness'

let h: Harness
let repo = ''
let id = ''

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => {
  h = await launch('review', {
    open: [join(seed, 'rewrite')],
    setup: (env) => {
      repo = makeRepo(env, 'rewrite', [
        ['Start', { 'a.txt': 'a\n', 'conf.txt': 'one\ntwo base\nthree\n' }],
        ['Add b', { 'b.txt': 'b\n' }]
      ])
      const g = (...a: string[]): string => gitIn(env, repo, ...a)
      g('branch', 'fix/bug')
      g('branch', 'left', 'HEAD~1')
      g('branch', 'right', 'HEAD~1')
      for (const [b, msg, text] of [
        ['left', 'Left edits line 2', 'one\ntwo left\nthree\n'],
        ['right', 'Right edits line 2', 'one\ntwo right\nthree\n']
      ] as const) {
        g('switch', '-q', b)
        writeAndCommit(env, repo, msg, { 'conf.txt': text })
      }
      g('switch', '-q', 'main')
      // The remote has Start and Add b; what comes next is local only.
      g('clone', '-q', '--bare', '.', join(seed, 'rewrite-origin.git'))
      g('remote', 'add', 'origin', join(seed, 'rewrite-origin.git'))
      g('fetch', '-q', 'origin')
      writeAndCommit(env, repo, 'Add c', { 'c.txt': 'c\n' })
      g('branch', 'feature/one')
      writeAndCommit(env, repo, 'Add d', { 'd.txt': 'd\n' })
      g('branch', 'feature/two')
      writeAndCommit(env, repo, 'Add e', { 'e.txt': 'e\n' })
    }
  })
  await h.page.getByRole('tab', { name: 'rewrite' }).click()
  await row('Add e').waitFor()
  id = await repoId(h.page, repo)
})
test.afterAll(async () => {
  await h.close()
})
test.afterEach(() => h.expectClean())

// The rewritten copy of a commit is newer than the original (still shown through the feature branches), so it comes first.
const row = (summary: string) => grid(h.page).getByRole('row', { name: new RegExp(`^${summary.replace(/[()]/g, '\\$&')},`) }).first()
const details = () => h.page.getByRole('region', { name: 'Details' })
const toolbar = (name: string | RegExp) => h.page.getByRole('toolbar', { name: 'Repository actions' }).getByRole('button', { name })
const subjects = (): string => h.git(repo, 'log', '--format=%s', 'main')
const tree = (): string => h.git(repo, 'rev-parse', 'HEAD^{tree}')
const local = (name: string | RegExp) => h.page.getByRole('tree', { name: 'Local branches' }).getByRole('treeitem', { name })
const hidden = async (): Promise<string[]> => ((await appState<{ repos: Record<string, { refView: { hidden: string[] } }> }>(h.page)).repos[id]?.refView.hidden ?? []).sort()

// ---------- multi-select ----------

test('F24-H1 Ctrl and Shift-click select several commits; Esc goes back to one', async () => {
  await row('Add e').click()
  await row('Add c').click({ modifiers: ['Shift'] })
  await expect(details().getByRole('heading', { name: '3 commits selected' })).toBeVisible()
  await expect(grid(h.page).locator('[role=row][aria-selected=true]')).toHaveCount(3)
  await row('Add d').click({ modifiers: ['Control'] })
  await expect(details().getByRole('heading', { name: '2 commits selected' })).toBeVisible()
  await expect(row('Add d')).toHaveAttribute('aria-selected', 'false')
  await grid(h.page).press('Escape')
  await expect(details().getByRole('heading', { name: /commits selected/ })).toHaveCount(0)
})

test('F24-E1 Shift+arrows grow the selection from the keyboard', async () => {
  await row('Add e').click()
  await grid(h.page).press('Shift+ArrowDown')
  await grid(h.page).press('Shift+J')
  await expect(details().getByRole('heading', { name: '3 commits selected' })).toBeVisible()
  await expect(details().getByRole('list', { name: /Selected commits/ }).getByRole('listitem')).toHaveCount(3)
  expect(await axe(h.page)).toEqual([])
  await grid(h.page).press('Escape')
})

// ---------- squash ----------

test('F25-E1 commits that are not side by side cannot be squashed, and the panel says why', async () => {
  await row('Add e').click()
  await row('Add c').click({ modifiers: ['Control'] })
  await expect(details().getByRole('button', { name: 'Squash into one…' })).toBeDisabled()
  await expect(details()).toContainText('Pick commits that sit next to each other.')
  await grid(h.page).press('Escape')
})

test('F25-H1 squash two commits with a new message; Undo brings them back', async () => {
  const before = tree()
  await row('Add d').click()
  await row('Add c').click({ modifiers: ['Shift'] })
  await details().getByRole('button', { name: 'Squash into one…' }).click()
  await expect(dialog(h.page).getByLabel('Summary')).toHaveValue('Add c')
  await expect(dialog(h.page).getByLabel('Description')).toHaveValue('Add d')
  await dialog(h.page).getByLabel('Summary').fill('Add c and d')
  await dialog(h.page).getByRole('button', { name: 'Squash', exact: true }).click()
  await expect.poll(subjects).toBe('Add e\nAdd c and d\nAdd b\nStart')
  expect(tree()).toBe(before)
  // The squashed commit is selected afterwards.
  await expect(row('Add c and d')).toHaveAttribute('aria-selected', 'true')
  await toolbar(/^Undo: Squash 2 commits/).click()
  await expect.poll(subjects).toBe('Add e\nAdd d\nAdd c\nAdd b\nStart')
})

// ---------- edit any message ----------

test('F26-H1 edit the message of an older commit from its details', async () => {
  const before = tree()
  await row('Add c').click()
  await details().getByRole('button', { name: 'Edit message' }).click()
  await expect(details()).toContainText('get new IDs')
  await details().getByLabel('Commit summary').fill('Add c (reworded)')
  await details().getByRole('button', { name: 'Save message' }).click()
  await expect.poll(subjects).toBe('Add e\nAdd d\nAdd c (reworded)\nAdd b\nStart')
  expect(tree()).toBe(before)
  await expect(row('Add c (reworded)')).toHaveAttribute('aria-selected', 'true')
})

test('F26-E1 Edit message from the right-click menu opens the editor', async () => {
  await menu(h.page, row('Add d'), 'Edit message…')
  await expect(details().getByLabel('Commit summary')).toHaveValue('Add d')
  await details().getByRole('button', { name: 'Cancel' }).click()
})

test('F26-N1 a commit already on the remote warns before its message changes', async () => {
  await row('Add b').click()
  await details().getByRole('button', { name: 'Edit message' }).click()
  await expect(details()).toContainText('force push')
  await details().getByLabel('Commit summary').fill('Add b again')
  await details().getByRole('button', { name: 'Save message' }).click()
  await expect(dialog(h.page)).toContainText('already on a remote')
  await dialog(h.page).getByRole('button', { name: 'Cancel' }).click()
  expect(subjects()).toContain('Add b\nStart')
  await details().getByRole('button', { name: 'Cancel' }).click()
})

// ---------- move up / down ----------

test('F27-H1 move a commit up, then down again', async () => {
  const before = tree()
  await menu(h.page, row('Add d'), 'Move commit up')
  await expect.poll(subjects).toBe('Add d\nAdd e\nAdd c (reworded)\nAdd b\nStart')
  expect(tree()).toBe(before)
  await expect(row('Add d')).toHaveAttribute('aria-selected', 'true')
  await menu(h.page, row('Add d'), 'Move commit down')
  await expect.poll(subjects).toBe('Add e\nAdd d\nAdd c (reworded)\nAdd b\nStart')
  // Wait for the app to finish (its undo entry and its refreshed graph).
  await expect(toolbar(/^Undo: Move \w+ down/)).toBeVisible()
  await expect(grid(h.page).getByRole('row').nth(1)).toHaveAccessibleName(/^Add e,/)
})

test('F27-E1 the newest commit cannot move up; moving past a pushed commit asks first', async () => {
  await row('Add e').click({ button: 'right' })
  await expect(h.page.getByRole('menuitem', { name: 'Move commit up' })).toBeDisabled()
  await h.page.keyboard.press('Escape')
  await menu(h.page, row('Add c (reworded)'), 'Move commit down')
  await expect(dialog(h.page)).toContainText('already on a remote')
  await dialog(h.page).getByRole('button', { name: 'Cancel' }).click()
  expect(subjects()).toBe('Add e\nAdd d\nAdd c (reworded)\nAdd b\nStart')
})

// ---------- range rebase ----------

test('F28-H1 rebase just the selected commits; the newer ones are replayed as they are', async () => {
  await row('Add d').click()
  await row('Add c (reworded)').click({ modifiers: ['Shift'] })
  await details().getByRole('button', { name: 'Rebase these…' }).click()
  const view = h.page.getByRole('region', { name: 'Rebase 2 selected commits on main' })
  await expect(view).toBeVisible()
  const list = view.getByRole('list', { name: 'Commits, oldest first' })
  await expect(list.getByRole('listitem')).toHaveCount(2)
  await expect(view).toContainText('Then 1 newer commit on main is replayed on top, unchanged.')
  await list.getByRole('listitem').first().press('d')
  await view.getByRole('button', { name: 'Start rebase' }).click()
  await expect.poll(subjects).toBe('Add e\nAdd d\nAdd b\nStart')
  await toolbar(/^Undo: Interactive rebase/).click()
  await expect.poll(subjects).toBe('Add e\nAdd d\nAdd c (reworded)\nAdd b\nStart')
})

// ---------- left panel ----------

test('F29-H1 branch names are grouped into folders on "/", local and remote', async () => {
  await toGraph(h.page)
  const folder = local('feature folder')
  await expect(folder).toHaveAttribute('aria-expanded', 'true')
  await expect(local('feature/one')).toHaveAttribute('aria-level', '2')
  await folder.click()
  await expect(folder).toHaveAttribute('aria-expanded', 'false')
  await expect(local('feature/one')).toHaveCount(0)
  await folder.press('ArrowRight')
  await expect(local('feature/two')).toBeVisible()
  const origin = h.page.getByRole('group', { name: 'origin' })
  await expect(origin.getByRole('treeitem', { name: 'fix folder' })).toBeVisible()
  // The only remote has no row of its own, so its folders start at the top level.
  await expect(origin.getByRole('treeitem', { name: 'fix/bug' })).toHaveAttribute('aria-level', '2')
  expect(await axe(h.page)).toEqual([])
})

test('F30-H1 eye icons hide a branch, a folder, a remote or a whole section', async () => {
  await local('feature/one').hover()
  await local('feature/one').getByRole('button', { name: 'Hide feature/one' }).click()
  await expect.poll(hidden).toEqual(['refs/heads/feature/one'])
  await local('feature folder').getByRole('button', { name: 'Hide feature folder' }).click()
  await expect.poll(hidden).toEqual(['refs/heads/feature/one', 'refs/heads/feature/two'])
  await local('feature folder').getByRole('button', { name: 'Show feature folder' }).click()
  await expect.poll(hidden).toEqual([])
  // The checked-out branch always stays.
  await expect(local(/^main/).getByRole('button', { name: /^Hide/ })).toHaveCount(0)
  await h.page.getByRole('button', { name: 'Hide all local branches' }).click()
  await expect.poll(hidden).toEqual(['refs/heads/feature/one', 'refs/heads/feature/two', 'refs/heads/fix/bug', 'refs/heads/left', 'refs/heads/right'])
  await h.page.getByRole('button', { name: 'Show all local branches' }).click()
  await expect.poll(hidden).toEqual([])
  await h.page.getByRole('button', { name: 'Hide all remotes' }).click()
  await expect.poll(async () => (await hidden()).length).toBe(4)
  expect((await hidden()).every((r) => r.startsWith('refs/remotes/origin/'))).toBe(true)
  await h.page.getByRole('button', { name: 'Show all remotes' }).click()
  await expect.poll(hidden).toEqual([])
  // H on a focused row does the same.
  await local('fix/bug').focus()
  await h.page.keyboard.press('h')
  await expect.poll(hidden).toEqual(['refs/heads/fix/bug'])
  await h.page.keyboard.press('h')
  await expect.poll(hidden).toEqual([])
})

test('F31-H1 the rebase menu names both branches', async () => {
  await local('feature/one').click({ button: 'right' })
  await expect(h.page.getByRole('menuitem', { name: 'Rebase main onto feature/one', exact: true })).toBeVisible()
  await h.page.keyboard.press('Escape')
})

test('F33-H1 delete a branch on the remote; the local branch stays', async () => {
  const origin = join(seed, 'rewrite-origin.git')
  // Offered on a local branch that tracks one too.
  await menu(h.page, local(/^right/), 'Set upstream…')
  await dialog(h.page).getByRole('combobox', { name: 'Remote branch' }).click()
  await h.page.getByRole('option', { name: 'origin/right' }).click()
  await dialog(h.page).getByRole('button', { name: 'Set upstream' }).click()
  await expect.poll(h.gitOr(repo, 'rev-parse', '--abbrev-ref', 'right@{upstream}')).toBe('origin/right')
  await local(/^right/).click({ button: 'right' })
  await expect(h.page.getByRole('menuitem', { name: 'Delete origin/right…' })).toBeVisible()
  await h.page.keyboard.press('Escape')
  await menu(h.page, h.page.getByRole('group', { name: 'origin' }).getByRole('treeitem', { name: 'left', exact: true }), 'Delete origin/left…')
  await expect(dialog(h.page)).toContainText('Your local left stays')
  await dialog(h.page).getByRole('button', { name: 'Delete from origin' }).click()
  await expect.poll(() => h.git(origin, 'branch', '--list', 'left')).toBe('')
  await expect(h.page.getByRole('group', { name: 'origin' }).getByRole('treeitem', { name: 'left', exact: true })).toHaveCount(0)
  expect(h.git(repo, 'branch', '--list', 'left')).toContain('left')
  expect(h.gitOr(repo, 'rev-parse', '-q', '--verify', 'refs/remotes/origin/left')()).toBe('')
})

// ---------- merge tool: base column ----------

test('F32-H1 the merge tool shows what both sides started from, and can hide it', async () => {
  // The app may still hold the index lock for a moment after the last refresh.
  await expect.poll(() => (h.gitOr(repo, 'switch', '-q', 'left')(), h.git(repo, 'rev-parse', '--abbrev-ref', 'HEAD'))).toBe('left')
  try {
    h.git(repo, 'merge', '-q', 'right')
  } catch {
    // conflicts: expected
  }
  await openWip(h.page)
  await h.page.getByRole('listbox', { name: /Not staged/ }).getByRole('option', { name: 'Conflicted conf.txt' }).click()
  const tool = h.page.getByRole('region', { name: 'Resolve conflicts in conf.txt' })
  await expect(tool.getByRole('heading', { name: /Base · common ancestor/ })).toBeVisible()
  await expect(tool).toContainText('two base')
  await expect(tool).toContainText('Before: 1 line')
  expect(await axe(h.page)).toEqual([])
  await tool.getByRole('button', { name: 'Show the base (common ancestor)' }).click()
  await expect(tool.getByRole('heading', { name: /Base · common ancestor/ })).toHaveCount(0)
  await tool.getByRole('button', { name: 'Show the base (common ancestor)' }).click()
  await expect(tool.getByRole('heading', { name: /Base · common ancestor/ })).toBeVisible()
  await tool.getByRole('button', { name: 'Close' }).click()
  await grid(h.page).waitFor()
  await expect.poll(() => (h.gitOr(repo, 'merge', '--abort')(), h.gitOr(repo, 'status', '--porcelain')())).toBe('')
})

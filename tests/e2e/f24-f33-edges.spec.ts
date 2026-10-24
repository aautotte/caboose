// Edge and negative cases for the review additions (F24-F33): merges in the way, reorders that conflict,
// uncommitted work, unusual messages and names, other conflict shapes, unreachable remotes.
import { test, expect } from '@playwright/test'
import { existsSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { axe, dialog, gitIn, grid, launch, makeRepo, menu, openWip, seed, toGraph, writeAndCommit, type Harness } from './harness'

let h: Harness
let repo = ''

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => {
  h = await launch('edges', {
    open: [join(seed, 'edges')],
    setup: (env) => {
      repo = makeRepo(env, 'edges', [
        ['Start', { 'a.txt': '1\n2\n3\n', 'c.txt': 'one\ntwo base\nthree\n' }],
        ['Add f', { 'f.txt': 'f\n' }]
      ])
      const g = (...a: string[]): string => gitIn(env, repo, ...a)
      g('switch', '-q', '-c', 'side')
      writeAndCommit(env, repo, 'Side work', { 's.txt': 's\n' })
      g('switch', '-q', 'main')
      g('merge', '-q', '--no-ff', '-m', 'Merge side', 'side')
      writeAndCommit(env, repo, 'Edit line 1', { 'a.txt': '1x\n2\n3\n' })
      writeAndCommit(env, repo, 'Edit line 1 again', { 'a.txt': '1y\n2\n3\n' })
      writeAndCommit(env, repo, 'Top', { 'h.txt': 'h\n' })
      // Deep, accented and very long folder names.
      g('branch', 'team/ana/feat-é')
      g('branch', 'team/bob/x')
      g('branch', `team/ana/${'a-very-long-branch-name-'.repeat(3)}end`)
      // Conflict shapes for the base column: both sides add the same new file; diff3 markers already in the file.
      for (const [b, text] of [['addA', 'A\n'], ['addB', 'B\n']] as const) {
        g('switch', '-q', '-c', b, 'main~4')
        writeAndCommit(env, repo, `Add new.txt on ${b}`, { 'new.txt': text })
      }
      for (const [b, text] of [['d3a', 'one\ntwo A\nthree\n'], ['d3b', 'one\ntwo B\nthree\n']] as const) {
        g('switch', '-q', '-c', b, 'main~5')
        writeAndCommit(env, repo, `Edit c on ${b}`, { 'c.txt': text })
      }
      g('switch', '-q', 'main')
      // A remote with only `side` (so main's own commits count as not pushed), tracked by the local side;
      // and a second remote that becomes unreachable.
      for (const remote of ['origin', 'dead']) {
        const dir = join(seed, `edges-${remote}.git`)
        rmSync(dir, { recursive: true, force: true })
        gitIn(env, seed, 'init', '-q', '--bare', dir)
        g('remote', 'add', remote, dir)
        g('push', '-q', remote, 'side')
        g('fetch', '-q', remote)
      }
      g('branch', '-q', '--set-upstream-to=origin/side', 'side')
      rmSync(join(seed, 'edges-dead.git'), { recursive: true, force: true })
    }
  })
  await h.page.getByRole('tab', { name: 'edges' }).click()
  await row('Top').waitFor()
})
test.afterAll(async () => {
  await h.close()
})
test.afterEach(() => h.expectClean())

const row = (summary: string) => grid(h.page).getByRole('row', { name: new RegExp(`^${summary.replace(/[()]/g, '\\$&')},`) }).first()
const details = () => h.page.getByRole('region', { name: 'Details' })
const toasts = () => h.page.getByRole('region', { name: /Notifications/ })
const subjects = (): string => h.git(repo, 'log', '--first-parent', '--format=%s', 'main')
const local = (name: string | RegExp) => h.page.getByRole('tree', { name: 'Local branches' }).getByRole('treeitem', { name })
const before = 'Top\nEdit line 1 again\nEdit line 1\nMerge side\nAdd f\nStart'
async function dismissToasts(): Promise<void> {
  for (const b of await toasts().getByRole('button', { name: 'Dismiss' }).all()) await b.click().catch(() => {})
}

// ---------- F24 ----------

test('F24-E2 Ctrl-click on the uncommitted-changes row selects only that row', async () => {
  writeFileSync(join(repo, 'h.txt'), 'h changed\n')
  await grid(h.page).getByRole('row', { name: /^Uncommitted changes/ }).waitFor()
  await row('Top').click()
  await row('Edit line 1').click({ modifiers: ['Shift'] })
  await expect(details().getByRole('heading', { name: '3 commits selected' })).toBeVisible()
  await grid(h.page).getByRole('row', { name: /^Uncommitted changes/ }).click({ modifiers: ['Control'] })
  await expect(details().getByRole('heading', { name: /commits selected/ })).toHaveCount(0)
  await expect(grid(h.page).locator('[role=row][aria-selected=true]')).toHaveCount(1)
})

test('F25-N2 with uncommitted changes, squash and move say so before asking for anything', async () => {
  await row('Top').click()
  await row('Edit line 1 again').click({ modifiers: ['Shift'] })
  await details().getByRole('button', { name: 'Squash into one…' }).click()
  await expect(toasts()).toContainText('Commit or stash your changes')
  await expect(dialog(h.page)).toHaveCount(0)
  await dismissToasts()
  await menu(h.page, row('Edit line 1'), 'Move commit up')
  await expect(toasts()).toContainText('Commit or stash your changes')
  // Editing an older message: the editor says so and Save waits.
  await row('Edit line 1').click()
  await details().getByRole('button', { name: 'Edit message' }).click()
  await expect(details()).toContainText('Commit or stash your changes first')
  await expect(details().getByRole('button', { name: 'Save message' })).toBeDisabled()
  await details().getByRole('button', { name: 'Cancel' }).click()
  expect(subjects()).toBe(before)
  expect(readFileSync(join(repo, 'h.txt'), 'utf8')).toBe('h changed\n')
  h.git(repo, 'checkout', '--', 'h.txt')
  await dismissToasts()
  await expect(grid(h.page).getByRole('row', { name: /^Uncommitted changes/ })).toHaveCount(0)
})

test('F24-E3 the selection survives a refresh caused by another tool', async () => {
  await row('Top').click()
  await row('Edit line 1 again').click({ modifiers: ['Shift'] })
  writeFileSync(join(repo, 'untracked.txt'), 'x\n')
  await grid(h.page).getByRole('row', { name: /^Uncommitted changes/ }).waitFor()
  await expect(details().getByRole('heading', { name: '2 commits selected' })).toBeVisible()
  rmSync(join(repo, 'untracked.txt'))
  await expect(grid(h.page).getByRole('row', { name: /^Uncommitted changes/ })).toHaveCount(0)
  await grid(h.page).press('Escape')
})

test('F04-E9 the graph stays aligned when uncommitted changes appear or go', async () => {
  // Every commit row draws its own dot; a layout one row out of step leaves the last row without one.
  const dots = async (): Promise<number> => grid(h.page).getByRole('row').locator('svg circle, svg rect').count()
  const rows = (): Promise<number> => grid(h.page).getByRole('row').count()
  await expect.poll(async () => (await rows()) - 1 - (await dots())).toBeLessThanOrEqual(0)
  writeFileSync(join(repo, 'h.txt'), 'changed outside the app\n')
  await grid(h.page).getByRole('row', { name: /^Uncommitted changes/ }).waitFor()
  await expect(row('Start').locator('svg circle')).toHaveCount(1)
  h.git(repo, 'checkout', '--', 'h.txt')
  await expect(grid(h.page).getByRole('row', { name: /^Uncommitted changes/ })).toHaveCount(0)
  await expect(row('Start').locator('svg circle')).toHaveCount(1)
})

test('S13-E1 several Git settings saved at once all stick', async () => {
  // Like turning on signing and saving the key straight after: each is its own `git config --global` write.
  for (let round = 0; round < 5; round++) {
    const results = await h.page.evaluate(async (n) => {
      const gc = (window as unknown as { gc: { invoke: (c: string, i: unknown) => Promise<{ ok: boolean }> } }).gc
      return Promise.all([
        gc.invoke('gitConfig.set', { key: 'user.signingkey', value: `KEY${n}` }),
        gc.invoke('gitConfig.set', { key: 'commit.gpgsign', value: n % 2 ? 'true' : 'false' }),
        gc.invoke('gitConfig.set', { key: 'diff.tool', value: `tool${n}` }),
        gc.invoke('gitConfig.set', { key: 'merge.tool', value: `tool${n}` })
      ])
    }, round)
    expect(results.map((r) => r.ok)).toEqual([true, true, true, true])
    expect(h.git(repo, 'config', '--global', 'user.signingkey')).toBe(`KEY${round}`)
    expect(h.git(repo, 'config', '--global', 'merge.tool')).toBe(`tool${round}`)
  }
  for (const k of ['user.signingkey', 'commit.gpgsign', 'diff.tool', 'merge.tool']) h.git(repo, 'config', '--global', '--unset', k)
})

// ---------- F25 / F26: merges in the way, messages ----------

test('F25-E2 a merge commit in the selection disables squash, with the reason', async () => {
  await row('Merge side').click()
  // Ctrl, not Shift: a Shift span would also take in the side branch's commit drawn between them.
  await row('Add f').click({ modifiers: ['Control'] })
  await expect(details().getByRole('button', { name: 'Squash into one…' })).toBeDisabled()
  await expect(details()).toContainText('Merge commits can’t be squashed here.')
  await grid(h.page).press('Escape')
})

test('F26-N2 a commit below a merge offers no rewrite, and says why up front', async () => {
  await row('Add f').click()
  await expect(details().getByRole('button', { name: 'Edit message' })).toBeDisabled()
  await expect(details()).toContainText('a merge commit after it')
  await row('Add f').click({ button: 'right' })
  for (const item of ['Edit message…', 'Move commit up', 'Move commit down']) await expect(h.page.getByRole('menuitem', { name: item })).toBeDisabled()
  await h.page.keyboard.press('Escape')
  expect(subjects()).toBe(before)
})

test('F25-E3 squash keeps an emoji, accented and very long message exactly', async () => {
  const summary = `Ajoute la météo ☀️🌧️ ${'très long résumé '.repeat(8)}fin`
  const body = 'Ligne 1 — détails\n\nLigne 3 avec « guillemets » et `code`'
  await row('Top').click()
  await row('Edit line 1 again').click({ modifiers: ['Shift'] })
  await details().getByRole('button', { name: 'Squash into one…' }).click()
  await dialog(h.page).getByLabel('Summary').fill(summary)
  await dialog(h.page).getByLabel('Description').fill(body)
  await dialog(h.page).getByRole('button', { name: 'Squash', exact: true }).dblclick()
  await expect.poll(() => h.git(repo, 'log', '-1', '--format=%B', 'main')).toBe(`${summary}\n\n${body}`)
  expect(subjects()).toBe(`${summary}\nEdit line 1\nMerge side\nAdd f\nStart`)
  // A double click squashed once, not twice.
  await expect(h.page.getByRole('toolbar', { name: 'Repository actions' }).getByRole('button', { name: /^Undo: Squash 2 commits/ })).toBeVisible()
  await h.page.getByRole('toolbar', { name: 'Repository actions' }).getByRole('button', { name: /^Undo: Squash 2 commits/ }).click()
  await expect.poll(subjects).toBe(before)
})

// ---------- F27: a reorder that conflicts ----------

test('F27-E2 moving a commit past one that edits the same line pauses; Abort puts it back', async () => {
  const head = h.git(repo, 'rev-parse', 'HEAD')
  await menu(h.page, row('Edit line 1 again'), 'Move commit down')
  await expect(h.page.getByRole('region', { name: 'Paused operation' })).toContainText('Rebasing')
  await h.page.getByRole('region', { name: 'Paused operation' }).getByRole('button', { name: 'Abort' }).click()
  await dialog(h.page).getByRole('button', { name: 'Abort' }).click()
  await expect.poll(() => existsSync(join(repo, '.git', 'rebase-merge'))).toBe(false)
  expect(h.git(repo, 'rev-parse', 'HEAD')).toBe(head)
  expect(h.git(repo, 'status', '--porcelain')).toBe('')
  await dismissToasts()
})

// ---------- F29 / F30: names ----------

test('F29-E2 deep, accented and long names sit in nested folders; the filter reaches inside folded ones', async () => {
  await toGraph(h.page)
  await expect(local('team folder')).toBeVisible()
  await expect(local('ana folder')).toHaveAttribute('aria-level', '2')
  await expect(local('team/ana/feat-é')).toHaveAttribute('aria-level', '3')
  await local('team folder').click()
  await expect(local('team/ana/feat-é')).toHaveCount(0)
  await h.page.getByLabel('Filter branches, tags and stashes').fill('feat-é')
  await expect(local('team/ana/feat-é')).toBeVisible()
  await h.page.getByLabel('Filter branches, tags and stashes').fill('')
  await expect(local('team/ana/feat-é')).toHaveCount(0)
  await local('team folder').click()
  // A long name is cut with an ellipsis but keeps its full name for screen readers and the tooltip.
  const long = local(/^team\/ana\/a-very-long/)
  await expect(long).toHaveAttribute('title', /^team\/ana\/(a-very-long-branch-name-){3}end /)
  expect(await axe(h.page)).toEqual([])
})

test('F30-E1 hiding a folder takes its commits out of the graph; Show all brings them back', async () => {
  await expect(grid(h.page).getByRole('row', { name: /^Add new\.txt on addA/ })).toHaveCount(1)
  // addA / addB are not in a folder; hide the "team" folder, then the whole local section.
  await local('team folder').getByRole('button', { name: 'Hide team folder' }).click()
  await expect(h.page.getByRole('status').filter({ hasText: 'hidden from the graph' })).toContainText('3 hidden')
  await h.page.getByRole('button', { name: 'Hide all local branches' }).click()
  await expect(grid(h.page).getByRole('row', { name: /^Add new\.txt on addA/ })).toHaveCount(0)
  await h.page.getByRole('status').filter({ hasText: 'hidden from the graph' }).getByRole('button', { name: 'Show all' }).click()
  await expect(grid(h.page).getByRole('row', { name: /^Add new\.txt on addA/ })).toHaveCount(1)
  await expect(local('team folder').getByRole('button', { name: 'Hide team folder' })).toHaveCount(1)
})

// ---------- F33: remote deletes that fail or orphan a branch ----------

test('F33-N1 deleting on an unreachable remote fails with git’s reason; nothing is removed', async () => {
  const dead = h.page.getByRole('group', { name: 'dead' })
  await menu(h.page, dead.getByRole('treeitem', { name: 'side', exact: true }), 'Delete dead/side…')
  await dialog(h.page).getByRole('button', { name: 'Delete from dead' }).click()
  await expect(toasts()).toContainText('Couldn’t delete side from dead')
  expect(h.git(repo, 'rev-parse', '--verify', 'refs/remotes/dead/side')).not.toBe('')
  await expect(dead.getByRole('treeitem', { name: 'side', exact: true })).toBeVisible()
  await dismissToasts()
})

test('F33-E1 deleting the branch a local one tracks marks the local one as gone', async () => {
  await menu(h.page, local(/^side/), 'Delete origin/side…')
  await expect(dialog(h.page)).toContainText('Your local side stays')
  await dialog(h.page).getByRole('button', { name: 'Delete from origin' }).click()
  await expect.poll(() => h.git(join(seed, 'edges-origin.git'), 'branch', '--list', 'side')).toBe('')
  await expect(local(/^side, gone/)).toBeVisible()
  await dismissToasts()
})

// ---------- F32: other conflict shapes ----------

test('F32-E1 both sides added the file: the base column says there was nothing before', async () => {
  await expect.poll(() => (h.gitOr(repo, 'switch', '-q', 'addA')(), h.git(repo, 'rev-parse', '--abbrev-ref', 'HEAD'))).toBe('addA')
  try {
    h.git(repo, 'merge', '-q', 'addB')
  } catch {
    // conflicts: expected
  }
  await openWip(h.page)
  await h.page.getByRole('listbox', { name: /Not staged/ }).getByRole('option', { name: 'Conflicted new.txt' }).click()
  const tool = h.page.getByRole('region', { name: 'Resolve conflicts in new.txt' })
  await expect(tool.getByRole('heading', { name: /Base · common ancestor/ })).toBeVisible()
  await expect(tool).toContainText('Nothing here before')
  await tool.getByRole('button', { name: 'Close' }).click()
  await expect.poll(() => (h.gitOr(repo, 'merge', '--abort')(), h.gitOr(repo, 'status', '--porcelain')())).toBe('')
})

test('F32-E2 with diff3 markers already in the file, the base comes from the file', async () => {
  h.git(repo, 'config', 'merge.conflictStyle', 'diff3')
  await expect.poll(() => (h.gitOr(repo, 'switch', '-q', 'd3a')(), h.git(repo, 'rev-parse', '--abbrev-ref', 'HEAD'))).toBe('d3a')
  try {
    h.git(repo, 'merge', '-q', 'd3b')
  } catch {
    // conflicts: expected
  }
  await openWip(h.page)
  await h.page.getByRole('listbox', { name: /Not staged/ }).getByRole('option', { name: 'Conflicted c.txt' }).click()
  const tool = h.page.getByRole('region', { name: 'Resolve conflicts in c.txt' })
  await expect(tool).toContainText('two base')
  await expect(tool).toContainText('Before: 1 line')
  // Picking a side writes a result without any of the ancestor's lines or markers.
  await tool.getByRole('checkbox', { name: /Use this line/ }).first().click()
  await expect(tool.getByLabel('Merged result')).toHaveValue('one\ntwo A\nthree\n')
  await tool.getByRole('button', { name: 'Close' }).click()
  await expect.poll(() => (h.gitOr(repo, 'merge', '--abort')(), h.gitOr(repo, 'status', '--porcelain')())).toBe('')
  h.git(repo, 'config', '--unset', 'merge.conflictStyle')
  await expect.poll(() => (h.gitOr(repo, 'switch', '-q', 'main')(), h.git(repo, 'rev-parse', '--abbrev-ref', 'HEAD'))).toBe('main')
})

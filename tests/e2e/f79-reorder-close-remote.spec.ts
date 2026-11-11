// F79: dragging tabs and rebase rows with the pointer (they move past a neighbour at its middle, Esc puts them back),
// Ctrl+Shift+arrows on a tab; closing a tab goes back to the one used before it; the rebase list runs newest first;
// clicking a remote branch's label in the graph checks it out, offering to reset the local branch when it has
// commits of its own.
import { test, expect, type Locator } from '@playwright/test'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { commitRow, dialog, gitIn, grid, invoke, launch, makeRepo, seed, toGraph, writeAndCommit, type Harness } from './harness'

let h: Harness
const ta = join(seed, 'ta')
const tb = join(seed, 'tb')
const tc = join(seed, 'tc')
const origin = join(seed, 'tr-origin.git')
const tr = join(seed, 'tr')

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => {
  h = await launch('reorder', {
    open: [ta, tb, tc, tr],
    setup: (env) => {
      makeRepo(env, 'ta', [
        ['Start', { 'README.md': 'hi\n' }],
        ['One', { 'one.txt': '1\n' }],
        ['Two', { 'two.txt': '2\n' }],
        ['Three', { 'three.txt': '3\n' }]
      ])
      makeRepo(env, 'tb', [['Start', { 'README.md': 'b\n' }]])
      makeRepo(env, 'tc', [['Start', { 'README.md': 'c\n' }]])
      for (const d of [origin, tr]) rmSync(d, { recursive: true, force: true })
      const src = makeRepo(env, 'tr-src', [['Start', { 'README.md': 'r\n' }]])
      gitIn(env, src, 'switch', '-q', '-c', 'feat')
      writeAndCommit(env, src, 'Feat upstream', { 'feat.txt': 'up\n' })
      gitIn(env, src, 'switch', '-q', '-c', 'other', 'main')
      writeAndCommit(env, src, 'Other work', { 'other.txt': 'o\n' })
      gitIn(env, src, 'switch', '-q', 'main')
      gitIn(env, seed, 'clone', '-q', '--bare', src, origin)
      gitIn(env, seed, 'clone', '-q', origin, tr)
      // feat has a commit of its own that origin/feat doesn't, so it can't just move forward.
      gitIn(env, tr, 'branch', '-q', '--track', 'feat', 'origin/feat')
      gitIn(env, tr, 'update-ref', 'refs/heads/feat', gitIn(env, tr, 'commit-tree', '-p', 'origin/feat~1', '-m', 'Mine on feat', 'origin/feat~1^{tree}'))
    }
  })
})
test.afterAll(async () => {
  await h.close()
})
test.afterEach(() => h.expectClean())

const tablist = () => h.page.getByRole('tablist', { name: 'Open repositories' })
const tab = (name: string) => tablist().getByRole('tab', { name, exact: true })
const tabNames = async (): Promise<string[]> => (await tablist().getByRole('tab').allTextContents()).filter(Boolean)

/** Presses on `from`, moves the pointer in small steps to `x`/`y` (absolute), and lets go, or presses Esc first. */
async function drag(from: Locator, to: { x?: number; y?: number }, opts: { escape?: boolean } = {}): Promise<void> {
  const b = (await from.boundingBox())!
  const sx = b.x + b.width / 2
  const sy = b.y + b.height / 2
  await h.page.mouse.move(sx, sy)
  await h.page.mouse.down()
  await h.page.mouse.move(to.x ?? sx, to.y ?? sy, { steps: 12 })
  if (opts.escape) await h.page.keyboard.press('Escape')
  await h.page.mouse.up()
}

test('F79-H1: dragging a tab past the middle of another moves it there; a short wobble is still a click; Esc puts it back', async () => {
  await expect.poll(tabNames).toEqual(['ta', 'tb', 'tc', 'tr'])
  // A press that moves a couple of pixels is a click: it opens the tab and moves nothing.
  const b = (await tab('tc').boundingBox())!
  await h.page.mouse.move(b.x + 20, b.y + b.height / 2)
  await h.page.mouse.down()
  await h.page.mouse.move(b.x + 23, b.y + b.height / 2)
  await h.page.mouse.up()
  await expect(tab('tc')).toHaveAttribute('aria-selected', 'true')
  expect(await tabNames()).toEqual(['ta', 'tb', 'tc', 'tr'])

  // Not quite to tc's middle: ta only gets past tb.
  const c = (await tab('tc').boundingBox())!
  await drag(tab('ta'), { x: c.x + c.width * 0.3 })
  await expect.poll(tabNames).toEqual(['tb', 'ta', 'tc', 'tr'])
  // Past tc's middle: it lands after tc.
  const c2 = (await tab('tc').boundingBox())!
  await drag(tab('ta'), { x: c2.x + c2.width * 0.9 })
  await expect.poll(tabNames).toEqual(['tb', 'tc', 'ta', 'tr'])
  // The order is kept: the main process has it too.
  const saved = async (): Promise<string[]> => {
    const r = await invoke<{ open: { path: string }[] }>(h.page, 'repo.list', {})
    return r.ok ? r.value.open.map((x) => x.path.split(/[\\/]/).pop()!) : []
  }
  await expect.poll(saved).toEqual(['tb', 'tc', 'ta', 'tr'])

  // Esc in the middle of a drag: nothing moves.
  const first = (await tab('tb').boundingBox())!
  await drag(tab('tr'), { x: first.x + 4 }, { escape: true })
  expect(await tabNames()).toEqual(['tb', 'tc', 'ta', 'tr'])
  await expect(tab('tc')).toHaveAttribute('aria-selected', 'true')
})

test('F79-H2: Ctrl+Shift+arrows move the focused tab', async () => {
  await tab('ta').click()
  await tab('ta').press('Control+Shift+ArrowLeft')
  await expect.poll(tabNames).toEqual(['tb', 'ta', 'tc', 'tr'])
  await expect(tab('ta')).toBeFocused()
  await tab('ta').press('Control+Shift+ArrowLeft')
  await tab('ta').press('Control+Shift+ArrowLeft')
  await expect.poll(tabNames).toEqual(['ta', 'tb', 'tc', 'tr'])
})

test('F79-H3: closing a tab goes back to the repository used before it, not its neighbour', async () => {
  await tab('tr').click()
  await tab('tb').click()
  await expect(tab('tb')).toHaveAttribute('aria-selected', 'true')
  // tb's neighbours are ta and tc; tr was the one used before it.
  await tab('tb').press('Delete')
  await expect.poll(tabNames).toEqual(['ta', 'tc', 'tr'])
  await expect(tab('tr')).toHaveAttribute('aria-selected', 'true')
  // tc's neighbour is tr, but ta was used before it.
  await tab('ta').click()
  await tab('tc').click()
  await tab('tc').press('Delete')
  await expect.poll(tabNames).toEqual(['ta', 'tr'])
  await expect(tab('ta')).toHaveAttribute('aria-selected', 'true')
})

const list = () => h.page.getByRole('list', { name: 'Commits, newest first' })
const rowsText = async (): Promise<string[]> => (await list().getByRole('listitem').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')!.split(',')[0])))

test('F79-H4: the rebase list runs newest first, like the graph; dragging a row moves it, Esc puts it back', async () => {
  await tab('ta').click()
  await commitRow(h.page, 'Start').click({ button: 'right' })
  await h.page.getByRole('menuitem', { name: /^Rewrite main after this commit/ }).click()
  await expect.poll(rowsText).toEqual(['Three', 'Two', 'One'])

  // Esc during a drag: the rows go back, and the view stays open.
  const top = (await list().getByRole('listitem').first().boundingBox())!
  await drag(list().getByRole('listitem').last(), { y: top.y + 2 }, { escape: true })
  await expect(list()).toBeVisible()
  expect(await rowsText()).toEqual(['Three', 'Two', 'One'])

  // One, the oldest, to the top: it becomes the newest.
  await drag(list().getByRole('listitem').last(), { y: top.y + 2 })
  await expect.poll(rowsText).toEqual(['One', 'Three', 'Two'])
  // Pressing a row's buttons is still a click, not a drag.
  await list().getByRole('listitem').nth(1).getByRole('radio', { name: 'Drop' }).click()
  await expect(list().getByRole('listitem').nth(1).getByRole('radio', { name: 'Drop' })).toHaveAttribute('aria-checked', 'true')
  await list().getByRole('listitem').nth(1).getByRole('radio', { name: 'Keep' }).click()
  await h.page.getByRole('button', { name: 'Start rebase' }).click()
  await expect.poll(() => h.git(ta, 'log', '--format=%s')).toBe('One\nThree\nTwo\nStart')
})

test('F79-H5: the oldest kept commit is the bottom row, and it can’t be squashed', async () => {
  // H4's rebase, finished and back on the graph with the new history (otherwise the menu is for the old rows).
  await expect(list()).toHaveCount(0)
  await expect.poll(() => existsSync(join(ta, '.git', 'rebase-merge'))).toBe(false)
  await expect(grid(h.page).getByRole('row').nth(1)).toHaveAccessibleName(/^One,/)
  await commitRow(h.page, 'Start').click({ button: 'right' })
  await h.page.getByRole('menuitem', { name: /^Rewrite main after this commit/ }).click()
  await expect.poll(rowsText).toEqual(['One', 'Three', 'Two'])
  await list().getByRole('listitem').last().getByRole('radio', { name: 'Squash' }).click()
  await expect(h.page.getByRole('alert')).toContainText('The oldest kept commit can’t be squashed')
  // Squashing the top one folds it into the one below it.
  await list().getByRole('listitem').last().getByRole('radio', { name: 'Keep' }).click()
  await list().getByRole('listitem').first().getByRole('radio', { name: 'Fixup' }).click()
  await h.page.getByRole('button', { name: 'Start rebase' }).click()
  // The whole rebase: right after the picks the log already reads this, before the fixup is folded in.
  await expect(list()).toHaveCount(0)
  await expect.poll(() => existsSync(join(ta, '.git', 'rebase-merge'))).toBe(false)
  await expect.poll(() => h.git(ta, 'log', '--format=%s')).toBe('Three\nTwo\nStart')
  expect(h.git(ta, 'show', '--format=', '--name-only', 'HEAD').split('\n').sort()).toEqual(['one.txt', 'three.txt'])
})

const head = (): string => h.git(tr, 'rev-parse', '--abbrev-ref', 'HEAD')
const label = (name: string) => h.page.getByTitle(`Click to check out ${name}`)

test('F79-H6: clicking a remote branch’s label checks it out; with no local branch yet, it makes one that tracks it', async () => {
  await tab('tr').click()
  await toGraph(h.page)
  expect(head()).toBe('main')
  await label('origin/other').click()
  await expect.poll(head).toBe('other')
  expect(h.git(tr, 'rev-parse', '--abbrev-ref', 'other@{upstream}')).toBe('origin/other')
})

test('F79-H7: when the local branch has commits of its own, the click asks first, with resetting as the main choice', async () => {
  const mine = h.git(tr, 'rev-parse', 'feat')
  await label('origin/feat').click()
  await expect(dialog(h.page)).toContainText('Reset feat to origin/feat?')
  await expect(dialog(h.page)).toContainText('feat has 1 commit that origin/feat doesn’t')
  // Cancel: nothing changes.
  await dialog(h.page).getByRole('button', { name: 'Cancel' }).click()
  expect(h.git(tr, 'rev-parse', 'feat')).toBe(mine)
  expect(head()).toBe('other')

  await label('origin/feat').click()
  await dialog(h.page).getByRole('button', { name: 'Reset to origin/feat' }).click()
  await expect.poll(head).toBe('feat')
  expect(h.git(tr, 'rev-parse', 'feat')).toBe(h.git(tr, 'rev-parse', 'origin/feat'))
})

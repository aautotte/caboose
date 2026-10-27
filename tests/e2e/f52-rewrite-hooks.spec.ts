// F52: rewriting history runs git hooks, as a commit does, unless Skip hooks is ticked: the interactive rebase,
// Edit message on an older commit, and squash. A hook that refuses stops it, and the branch is left as it was.
import { test, expect } from '@playwright/test'
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dialog, grid, launch, makeRepo, seed, type Harness } from './harness'

let h: Harness
const repo = join(seed, 'hooks')
const ranPreRebase = join(seed, 'hooks-pre-rebase-ran')

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => {
  h = await launch('hooks', {
    open: [repo],
    setup: (env) => {
      makeRepo(env, 'hooks', [
        ['Start', { 'README.md': 'hi\n' }],
        ['Add a', { 'a.txt': 'a\n' }],
        ['Add b', { 'b.txt': 'b\n' }],
        ['Add c', { 'c.txt': 'c\n' }]
      ])
      // commit-msg refuses any message with WIP in it; pre-rebase leaves a mark that it ran.
      writeFileSync(join(repo, '.git', 'hooks', 'commit-msg'), '#!/bin/sh\nif grep -q WIP "$1"; then echo "commit-msg: no WIP commits here" >&2; exit 1; fi\n', { mode: 0o755 })
      writeFileSync(join(repo, '.git', 'hooks', 'pre-rebase'), `#!/bin/sh\ntouch '${ranPreRebase.split('\\').join('/')}'\n`, { mode: 0o755 })
    }
  })
  await h.page.getByRole('tab', { name: 'hooks', exact: true }).click()
})
test.afterAll(async () => {
  await h.close()
})
test.afterEach(() => h.expectClean())

const row = (summary: string) => grid(h.page).getByRole('row', { name: new RegExp(`^${summary},`) }).first()
const details = () => h.page.getByRole('region', { name: 'Details' })
const toasts = () => h.page.getByRole('region', { name: /Notifications/ })
const subjects = (): string => h.git(repo, 'log', '--format=%s')
const rebasing = (): boolean => existsSync(join(repo, '.git', 'rebase-merge'))

async function rewordInRebase(newSummary: string, skip: boolean): Promise<void> {
  await row('Add a').click({ button: 'right' })
  await h.page.getByRole('menuitem', { name: /^Rewrite main after this commit/ }).click()
  const list = h.page.getByRole('list', { name: 'Commits, oldest first' })
  await list.getByRole('listitem').nth(0).getByRole('radio', { name: 'Reword' }).click()
  await dialog(h.page).getByLabel('Summary').fill(newSummary)
  await dialog(h.page).getByRole('button', { name: 'Save message' }).click()
  const box = h.page.getByRole('checkbox', { name: 'Skip hooks' })
  await expect(box).not.toBeChecked()
  if (skip) await box.click()
  await h.page.getByRole('button', { name: 'Start rebase' }).click()
}

test('F52-H1: interactive rebase runs the hooks: commit-msg refuses a reword, nothing changes, and the output is shown', async () => {
  rmSync(ranPreRebase, { force: true })
  const before = h.git(repo, 'rev-parse', 'HEAD')
  await rewordInRebase('Add b, WIP', false)
  await expect(toasts().getByText(/A hook refused the new message/)).toBeVisible()
  await expect(toasts()).toContainText('It said: “commit-msg: no WIP commits here”')
  expect(h.git(repo, 'rev-parse', 'HEAD')).toBe(before)
  expect(rebasing()).toBe(false)
  expect(existsSync(ranPreRebase)).toBe(true)
  await toasts().getByRole('button', { name: 'Dismiss' }).first().click()
})

test('F52-H2: with Skip hooks ticked, the same reword goes through, and pre-rebase doesn’t run', async () => {
  rmSync(ranPreRebase, { force: true })
  await rewordInRebase('Add b, WIP', true)
  await expect.poll(subjects).toBe('Add c\nAdd b, WIP\nAdd a\nStart')
  expect(existsSync(ranPreRebase)).toBe(false)
})

test('F52-H3: Edit message on an older commit runs commit-msg too, unless Skip hooks is ticked', async () => {
  await row('Add b, WIP').click()
  await details().getByRole('button', { name: 'Edit message' }).click()
  await details().getByLabel('Commit summary').fill('Add b, still WIP')
  await details().getByRole('button', { name: 'Save message' }).click()
  await expect(toasts().getByText(/A hook refused the new message/)).toBeVisible()
  expect(subjects()).toBe('Add c\nAdd b, WIP\nAdd a\nStart')
  await details().getByRole('checkbox', { name: 'Skip hooks' }).click()
  await details().getByRole('button', { name: 'Save message' }).click()
  await expect.poll(subjects).toBe('Add c\nAdd b, still WIP\nAdd a\nStart')
})

test('F52-H4: squash offers Skip hooks too', async () => {
  // The app selects a commit itself after each rewrite (and after a refused one, on its refresh): pick the two again
  // until the pick holds.
  const pickBoth = (): Promise<void> =>
    expect(async () => {
      await row('Add c').click()
      await row('Add b, still WIP').click({ modifiers: ['Shift'] })
      await expect(details().getByRole('button', { name: 'Squash into one…' })).toBeVisible({ timeout: 1000 })
    }).toPass()
  await pickBoth()
  await details().getByRole('button', { name: 'Squash into one…' }).click()
  await dialog(h.page).getByLabel('Summary').fill('Add b and c, WIP')
  await dialog(h.page).getByRole('button', { name: 'Squash', exact: true }).click()
  await expect(toasts().getByText(/A hook refused the new message/)).toBeVisible()
  expect(subjects()).toBe('Add c\nAdd b, still WIP\nAdd a\nStart')
  await pickBoth()
  await details().getByRole('button', { name: 'Squash into one…' }).click()
  await dialog(h.page).getByLabel('Summary').fill('Add b and c, WIP')
  await dialog(h.page).getByRole('checkbox', { name: 'Skip hooks' }).click()
  await dialog(h.page).getByRole('button', { name: 'Squash', exact: true }).click()
  await expect.poll(subjects).toBe('Add b and c, WIP\nAdd a\nStart')
})

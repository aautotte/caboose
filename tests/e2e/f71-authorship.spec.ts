// F71: who commits are by. Reset the author to you (the newest commit is amended, other work stays), set someone
// else as the author of an older commit, add a co-author to several commits (not twice), with undo and redo.
import { test, expect } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { commitRow, dialog, launch, makeRepo, seed, subMenu, writeAndCommit, type Harness } from './harness'

let h: Harness
const repo = join(seed, 'authorship')

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => {
  h = await launch('authorship', {
    open: [repo],
    setup: (env) => {
      makeRepo(env, 'authorship', [['Base', { 'a.txt': 'a\n' }]])
      const pat = { ...env, GIT_AUTHOR_NAME: 'Pat', GIT_AUTHOR_EMAIL: 'pat@example.com' }
      writeAndCommit(pat, repo, 'Add b', { 'b.txt': 'b\n' })
      writeAndCommit(pat, repo, 'Add c', { 'c.txt': 'c\n' })
      writeAndCommit(pat, repo, 'Top', { 'd.txt': 'd\n' })
    }
  })
  await h.page.getByRole('tab', { name: 'authorship', exact: true }).click()
})
test.afterAll(async () => {
  await h.close()
})
test.afterEach(() => h.expectClean())

const toasts = () => h.page.getByRole('region', { name: /Notifications/ })
const refocus = () => h.page.evaluate(() => window.dispatchEvent(new Event('focus')))
// Each commit, newest first: summary, author, committer.
const people = (): string => h.git(repo, 'log', '--format=%s|%an <%ae>|%cn')
const bodyOf = (summary: string): string => h.git(repo, 'log', '--format=%B', `--grep=^${summary}$`, '-n1')
// The toast comes before the graph reloads: wait until it shows the rewritten commits.
const reloaded = () => expect(commitRow(h.page, 'Top')).toContainText(h.git(repo, 'rev-parse', 'HEAD').slice(0, 7))

test('F71-H1: Reset author to you amends the newest commit; changes in the folder stay', async () => {
  writeFileSync(join(repo, 'a.txt'), 'a, not ready\n')
  await refocus()
  await subMenu(h.page, commitRow(h.page, 'Top'), 'Author', 'Reset author to you')
  await expect(toasts().getByText(/^You’re now the author of [0-9a-f]{7}$/)).toBeVisible()
  await reloaded()
  expect(people()).toBe('Top|E2E <e2e@example.com>|E2E\nAdd c|Pat <pat@example.com>|E2E\nAdd b|Pat <pat@example.com>|E2E\nBase|E2E <e2e@example.com>|E2E')
  expect(h.git(repo, 'status', '--porcelain')).toBe('M a.txt')
  h.git(repo, 'checkout', '--', 'a.txt')
  await refocus()
  await expect(h.page.getByRole('row', { name: /^Uncommitted changes/ })).toHaveCount(0)
})

test('F71-H2: Set author on an older commit replays the ones after it; you stay the committer', async () => {
  await subMenu(h.page, commitRow(h.page, 'Add b'), 'Author', 'Set author…')
  const field = dialog(h.page).getByRole('combobox', { name: 'Author' })
  await field.fill('Sam')
  await expect(dialog(h.page).getByText('Write it as Name <email>.')).toBeVisible()
  await field.fill('Sam <sam@example.com>')
  await dialog(h.page).getByRole('button', { name: 'Set author' }).click()
  await expect(toasts().getByText(/^Sam is now the author of [0-9a-f]{7}$/)).toBeVisible()
  await reloaded()
  expect(people()).toBe('Top|E2E <e2e@example.com>|E2E\nAdd c|Pat <pat@example.com>|E2E\nAdd b|Sam <sam@example.com>|E2E\nBase|E2E <e2e@example.com>|E2E')
  expect(h.git(repo, 'show', 'HEAD~2:b.txt')).toBe('b')
})

test('F71-H3: Add co-author adds the trailer; on two commits, one that has it already doesn’t get it twice', async () => {
  await subMenu(h.page, commitRow(h.page, 'Add c'), 'Author', 'Add co-author…')
  await dialog(h.page).getByRole('combobox', { name: 'Co-author' }).fill('Kim <kim@example.com>')
  await dialog(h.page).getByRole('button', { name: 'Add co-author' }).click()
  await expect(toasts().getByText(/^Added Kim as a co-author of [0-9a-f]{7}$/)).toBeVisible()
  await reloaded()
  expect(bodyOf('Add c')).toBe('Add c\n\nCo-authored-by: Kim <kim@example.com>')
  // The rewritten commit is selected right after: pick the two once it is.
  await expect(commitRow(h.page, 'Add c')).toHaveAttribute('aria-selected', 'true')
  await commitRow(h.page, 'Add c').click()
  await commitRow(h.page, 'Add b').click({ modifiers: ['Control'] })
  await subMenu(h.page, commitRow(h.page, 'Add b'), 'Author', 'Add co-author…')
  await dialog(h.page).getByRole('combobox', { name: 'Co-author' }).fill('Kim <kim@example.com>')
  await dialog(h.page).getByRole('button', { name: 'Add co-author' }).click()
  await expect(toasts().getByText('Added Kim as a co-author of 2 commits')).toBeVisible()
  await reloaded()
  expect(bodyOf('Add b')).toBe('Add b\n\nCo-authored-by: Kim <kim@example.com>')
  expect(bodyOf('Add c')).toBe('Add c\n\nCo-authored-by: Kim <kim@example.com>')
})

test('F71-H4: undo takes the co-author back off the commit that didn’t have it; redo adds it again', async () => {
  await h.page.keyboard.press('Control+z')
  await expect.poll(() => bodyOf('Add b')).toBe('Add b')
  expect(bodyOf('Add c')).toBe('Add c\n\nCo-authored-by: Kim <kim@example.com>')
  expect(people()).toContain('Add b|Sam <sam@example.com>|E2E')
  await h.page.keyboard.press('Control+y')
  await expect.poll(() => bodyOf('Add b')).toBe('Add b\n\nCo-authored-by: Kim <kim@example.com>')
})

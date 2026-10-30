// F66: taking changes out of a commit (lazygit's custom patches). A whole file from the commit's file list, or a
// block or some lines from its diff: removed from the commit, moved to a new commit right after it, or moved to the
// staged changes. The commits after it are replayed, and undo puts it all back.
import { test, expect } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { commitRow, dialog, launch, makeRepo, seed, type Harness } from './harness'

let h: Harness
const repo = join(seed, 'patch')
const original = '1\n2\n3\n4\n5\n6\n'

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => {
  h = await launch('patch', {
    open: [repo],
    setup: (env) => {
      makeRepo(env, 'patch', [
        ['Base', { 'a.txt': original }],
        ['Mixed work', { 'a.txt': '1\ntwo\n3\n4\nfive\n6\n', 'c.txt': 'c\n' }],
        ['Top', { 'd.txt': 'd\n' }]
      ])
    }
  })
  await h.page.getByRole('tab', { name: 'patch', exact: true }).click()
})
test.afterAll(async () => {
  await h.close()
})
test.afterEach(() => h.expectClean())

const toasts = () => h.page.getByRole('region', { name: /Notifications/ })
const refocus = () => h.page.evaluate(() => window.dispatchEvent(new Event('focus')))
const summaries = (): string[] => h.git(repo, 'log', '--format=%s').split('\n')
const shaOf = (summary: string): string => h.git(repo, 'log', '--format=%H', `--grep=^${summary}$`, '-n1')
const fileAt = (rev: string, path: string): string => h.git(repo, 'show', `${rev}:${path}`)
const filesOf = (summary: string): string => h.git(repo, 'show', '--format=', '--name-only', shaOf(summary))
const changed = () => h.page.getByRole('region', { name: 'Details' }).getByRole('region', { name: 'Changed files' })
const diff = (path: string) => h.page.getByRole('region', { name: `Changes in ${path}` })
/** Picks a changed line by clicking its line numbers. */
const pickLine = (path: string, text: string) => diff(path).getByRole('row').filter({ hasText: new RegExp(`^\\s*\\d*\\s*\\d*\\s*[+−]?\\s*${text}$`) }).getByRole('cell').first().dispatchEvent('mousedown')

/** Right after an undo the graph may still show the commit as it was: click until the details panel has this one. */
async function openCommit(summary: string): Promise<void> {
  const short = shaOf(summary).slice(0, 7)
  await expect(async () => {
    await commitRow(h.page, summary).click()
    await expect(h.page.getByRole('region', { name: 'Details' }).getByText(short, { exact: true })).toBeVisible({ timeout: 1000 })
  }).toPass()
}

async function openCommitFile(summary: string, path: string): Promise<void> {
  await openCommit(summary)
  await changed().getByText(path, { exact: true }).click()
  await expect(diff(path)).toBeVisible()
}

test('F66-H1: a whole file moves to a new commit right after its commit; the files end up the same', async () => {
  const tree = h.git(repo, 'rev-parse', 'HEAD^{tree}')
  await commitRow(h.page, 'Mixed work').click()
  await changed().getByText('c.txt', { exact: true }).click({ button: 'right' })
  await h.page.getByRole('menuitem', { name: 'Move to a new commit…' }).click()
  const d = dialog(h.page)
  await d.getByRole('textbox', { name: 'Summary' }).fill('Add c')
  await d.getByRole('button', { name: 'Move to a new commit' }).click()
  await expect(toasts().getByText(/^Moved the changes to a new commit after/)).toBeVisible()
  expect(summaries()).toEqual(['Top', 'Add c', 'Mixed work', 'Base'])
  expect(filesOf('Mixed work')).toBe('a.txt')
  expect(filesOf('Add c')).toBe('c.txt')
  expect(h.git(repo, 'rev-parse', 'HEAD^{tree}')).toBe(tree)
})

test('F66-H2: picked lines are removed from the commit and from the commits after it; undo puts them back', async () => {
  const before = h.git(repo, 'rev-parse', 'HEAD')
  await openCommitFile('Mixed work', 'a.txt')
  await pickLine('a.txt', '2')
  await pickLine('a.txt', 'two')
  await diff('a.txt').getByRole('button', { name: 'Take 2 lines out' }).click()
  await h.page.getByRole('menuitem', { name: 'Remove from this commit' }).click()
  await expect(toasts().getByText(/^Removed the changes from/)).toBeVisible()
  expect(fileAt(shaOf('Mixed work'), 'a.txt')).toBe('1\n2\n3\n4\nfive\n6')
  expect(fileAt('HEAD', 'a.txt')).toBe('1\n2\n3\n4\nfive\n6')
  expect(h.git(repo, 'status', '--porcelain')).toBe('')
  await h.page.keyboard.press('Control+z')
  await expect.poll(() => h.git(repo, 'rev-parse', 'HEAD')).toBe(before)
})

test('F66-H3: a block moves out of the commit to the staged changes; undo puts it back in the commit', async () => {
  const before = h.git(repo, 'rev-parse', 'HEAD')
  await openCommitFile('Mixed work', 'a.txt')
  await diff('a.txt').getByRole('button', { name: 'Take block out' }).first().click()
  await h.page.getByRole('menuitem', { name: 'Move to staged changes' }).click()
  await expect(toasts().getByText(/^Moved the changes out of .*; they’re staged$/)).toBeVisible()
  expect(fileAt(shaOf('Mixed work'), 'a.txt')).toBe(original.trim())
  expect(h.git(repo, 'status', '--porcelain')).toBe('M  a.txt')
  expect(fileAt(':0', 'a.txt')).toBe('1\ntwo\n3\n4\nfive\n6')
  await h.page.keyboard.press('Control+z')
  await expect.poll(() => h.git(repo, 'rev-parse', 'HEAD')).toBe(before)
  expect(h.git(repo, 'status', '--porcelain')).toBe('')
})

test('F66-H4: with uncommitted changes, it asks for a clean working copy first', async () => {
  writeFileSync(join(repo, 'd.txt'), 'not yet\n')
  await refocus()
  const before = h.git(repo, 'rev-parse', 'HEAD')
  await openCommit('Mixed work')
  await changed().getByText('a.txt', { exact: true }).click({ button: 'right' })
  await h.page.getByRole('menuitem', { name: 'Remove from this commit' }).click()
  // Said before asking git, or by git's side if the window hadn't seen the change yet.
  await expect(toasts().getByText(/Commit or stash your changes first/)).toBeVisible()
  expect(h.git(repo, 'rev-parse', 'HEAD')).toBe(before)
  h.git(repo, 'checkout', '--', 'd.txt')
})

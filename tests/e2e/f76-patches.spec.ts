// F76: patches. Copy or save commits as a patch (git format-patch), copy uncommitted changes as a diff, and apply
// a patch, pasted or from a file: to the working files, staged, or as commits with their authors. It's checked
// first, CRLF files survive the clipboard, and undo takes it back.
import { test, expect } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { commitRow, dialog, gitIn, launch, makeRepo, menu, seed, subMenu, writeAndCommit, type Harness } from './harness'

let h: Harness
const repo = join(seed, 'patches')
const saved = join(seed, 'patches-out', 'two.patch')

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => {
  h = await launch('patches', {
    open: [repo],
    setup: (env) => {
      const as = (name: string) => ({ ...env, GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: `${name.toLowerCase()}@example.com` })
      makeRepo(env, 'patches', [['Base', { 'a.txt': '1\n2\n3\n', 'win.txt': 'x\r\ny\r\n' }]])
      gitIn(env, repo, 'checkout', '-q', '-b', 'feature')
      writeAndCommit(as('Kim'), repo, 'Feature one', { 'a.txt': '1\nTWO\n3\n' })
      writeAndCommit(as('Kim'), repo, 'Feature twó', { 'b.txt': 'b\n', 'win.txt': 'x\r\nY\r\n' })
      gitIn(env, repo, 'checkout', '-q', 'main')
      writeAndCommit(env, repo, 'Main only', { 'c.txt': 'c\n' })
      gitIn(env, repo, 'checkout', '-q', '-b', 'merged')
      gitIn(env, repo, 'merge', '-q', '--no-ff', '-m', 'Merge feature', 'feature')
      gitIn(env, repo, 'checkout', '-q', 'main')
      rmSync(join(seed, 'patches-out'), { recursive: true, force: true })
      mkdirSync(join(seed, 'patches-out'))
    }
  })
  await h.page.getByRole('tab', { name: 'patches', exact: true }).click()
  await expect(commitRow(h.page, 'Main only')).toBeVisible()
})
test.afterAll(async () => {
  await h.close()
})
test.afterEach(() => h.expectClean())

const toasts = () => h.page.getByRole('region', { name: /Notifications/ })
const toolbar = (name: string | RegExp) => h.page.getByRole('toolbar', { name: 'Repository actions' }).getByRole('button', { name })
const clip = (): Promise<string> => h.electronApp.evaluate(async ({ clipboard }) => clipboard.readText())
const setClip = (text: string): Promise<void> => h.electronApp.evaluate(({ clipboard }, t) => clipboard.writeText(t), text)
const sha = (summary: string): string => h.git(repo, 'log', '--all', '--format=%H', `--grep=^${summary}$`)
const subjects = (): string => h.git(repo, 'log', '--format=%s|%an', 'main')
const wip = () => commitRow(h.page, 'Uncommitted changes')
const patchField = () => dialog(h.page).getByRole('textbox', { name: 'Patch' })
async function openApply(): Promise<void> {
  await h.page.keyboard.press('Control+p')
  await h.page.keyboard.type('Apply a patch')
  await h.page.keyboard.press('Enter')
  await expect(dialog(h.page).getByRole('heading', { name: 'Apply a patch' })).toBeVisible()
}

test('F76-H1: Patch › Copy as patch copies the commit as git format-patch does', async () => {
  await subMenu(h.page, commitRow(h.page, 'Feature one'), 'Patch', 'Copy as patch')
  await expect(toasts().getByText('Copied the commit as a patch')).toBeVisible()
  // h.git trims what git prints.
  expect((await clip()).trimEnd()).toBe(h.git(repo, 'format-patch', '--stdout', '--binary', '-1', sha('Feature one')))
})

test('F76-H2: two commits picked are one patch, oldest first, CRLF lines kept; Save as patch file writes it', async () => {
  await commitRow(h.page, 'Feature twó').click()
  await commitRow(h.page, 'Feature one').click({ modifiers: ['Control'] })
  await subMenu(h.page, commitRow(h.page, 'Feature one'), 'Patch', 'Copy 2 commits as patch')
  await expect(toasts().getByText('Copied 2 commits as a patch')).toBeVisible()
  const text = await clip()
  // The accented subject comes encoded, as mail headers are.
  expect(text).toMatch(/\[PATCH 1\/2\] Feature one[\s\S]*\[PATCH 2\/2\] =\?UTF-8\?q\?Feature=20tw=C3=B3\?=/)
  expect(text).toContain('+Y\r\n')
  expect(text).not.toContain('+1\r\n')
  await h.electronApp.evaluate(({ dialog: d }, to) => {
    d.showSaveDialog = (async () => ({ canceled: false, filePath: to })) as typeof d.showSaveDialog
  }, saved)
  await subMenu(h.page, commitRow(h.page, 'Feature one'), 'Patch', 'Save as patch file…')
  await expect(toasts().getByText('Saved the patch')).toBeVisible()
  expect(readFileSync(saved, 'utf8')).toBe(text)
  await h.page.keyboard.press('Escape')
})

test('F76-H3: Apply a patch starts from the clipboard and applies its commits with their authors; undo takes them off', async () => {
  const before = h.git(repo, 'rev-parse', 'main')
  await openApply()
  await expect(patchField()).toHaveValue(/Feature one/)
  await expect(dialog(h.page).getByRole('list', { name: 'Commits in the patch' }).getByRole('listitem')).toHaveText(['Feature one · Kim', 'Feature twó · Kim'])
  await expect(dialog(h.page).getByRole('list', { name: 'Files it changes' })).toContainText('win.txt')
  await expect(dialog(h.page).getByRole('radio', { name: /^As 2 commits/ })).toBeChecked()
  await dialog(h.page).getByRole('button', { name: 'Apply 2 commits' }).click()
  await expect(toasts().getByText('Applied 2 commits')).toBeVisible()
  expect(subjects()).toBe('Feature twó|Kim\nFeature one|Kim\nMain only|E2E\nBase|E2E')
  expect(readFileSync(join(repo, 'win.txt'), 'utf8')).toBe('x\r\nY\r\n')
  await toolbar('Undo: Apply 2 commits from a patch').click()
  await expect.poll(() => h.git(repo, 'rev-parse', 'main')).toBe(before)
  expect(existsSync(join(repo, 'b.txt'))).toBe(false)
})

test('F76-H4: uncommitted changes, new file too, copied as a patch apply back to the working files; undo, redo', async () => {
  writeFileSync(join(repo, 'a.txt'), '1\n2\nthree\n')
  writeFileSync(join(repo, 'n.txt'), 'new\n')
  await menu(h.page, wip(), 'Copy all changes as patch')
  await expect(toasts().getByText('Copied the changes as a patch')).toBeVisible()
  h.git(repo, 'checkout', '--', 'a.txt')
  rmSync(join(repo, 'n.txt'))
  await menu(h.page, wip(), 'Apply a patch…')
  await expect(patchField()).toHaveValue(/n\.txt/)
  await expect(dialog(h.page).getByRole('radio', { name: /^To your working files/ }).first()).toBeChecked()
  await expect(dialog(h.page).getByText('It applies cleanly. Undo takes it back out.')).toBeVisible()
  await dialog(h.page).getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(toasts().getByText('Applied the patch')).toBeVisible()
  expect(h.git(repo, 'status', '--porcelain')).toBe('M a.txt\n?? n.txt')
  await toolbar('Undo: Apply a patch').click()
  await expect.poll(() => h.git(repo, 'status', '--porcelain')).toBe('')
  await toolbar('Redo: Apply a patch').click()
  await expect.poll(() => h.git(repo, 'status', '--porcelain')).toBe('M a.txt\n?? n.txt')
})

test('F76-H5: staged: the changes land in the files and the staged changes; one file’s menu copies only it', async () => {
  await commitRow(h.page, 'Uncommitted changes').click()
  await menu(h.page, h.page.getByRole('listbox', { name: /Not staged/ }).getByRole('option', { name: /a\.txt/ }), 'Copy as patch')
  await expect(toasts().getByText('Copied the changes to the file as a patch')).toBeVisible()
  expect(await clip()).not.toContain('n.txt')
  h.git(repo, 'checkout', '--', 'a.txt')
  rmSync(join(repo, 'n.txt'))
  await openApply()
  await dialog(h.page).getByRole('radio', { name: /^To your working files, staged/ }).check()
  await dialog(h.page).getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(toasts().getByText('Applied the patch')).toBeVisible()
  expect(h.git(repo, 'status', '--porcelain')).toBe('M  a.txt')
  await toolbar('Undo: Apply a patch to the staged changes').click()
  await expect.poll(() => h.git(repo, 'status', '--porcelain')).toBe('')
})

test('F76-H6: a patch that doesn’t fit says where, and one that isn’t a patch says so; neither can be applied', async () => {
  await setClip('')
  await openApply()
  await patchField().fill('diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1,3 +1,3 @@\n 1\n-nothing like this\n+2\n 3\n')
  await expect(dialog(h.page).getByRole('alert')).toHaveText(/^It doesn’t apply: patch failed: a\.txt:1/)
  await expect(dialog(h.page).getByRole('button', { name: 'Apply', exact: true })).toBeDisabled()
  await patchField().fill('just some words')
  await expect(dialog(h.page).getByRole('alert')).toHaveText('This isn’t a patch git can read.')
  await dialog(h.page).getByRole('button', { name: 'Paste from the clipboard' }).click()
  await expect(dialog(h.page).getByRole('status')).toHaveText('The clipboard doesn’t hold a patch.')
  await dialog(h.page).getByRole('button', { name: 'Cancel' }).click()
})

test('F76-H6b: as commits, a file with changes of its own is named, and nothing is applied', async () => {
  const before = h.git(repo, 'rev-parse', 'main')
  await setClip(h.git(repo, 'format-patch', '--stdout', '-1', sha('Feature one')) + '\n')
  writeFileSync(join(repo, 'a.txt'), '1\n2\n3\nmine\n')
  await openApply()
  await expect(dialog(h.page).getByRole('radio', { name: /^As 1 commit/ })).toBeChecked()
  await expect(dialog(h.page).getByRole('alert')).toHaveText('a.txt has changes of its own. Commit or stash them first.')
  await expect(dialog(h.page).getByRole('button', { name: 'Apply 1 commit' })).toBeDisabled()
  await dialog(h.page).getByRole('button', { name: 'Cancel' }).click()
  h.git(repo, 'checkout', '--', 'a.txt')
  expect(h.git(repo, 'rev-parse', 'main')).toBe(before)
})

test('F76-H7: a patch file an editor turned to CRLF throughout opens as git wrote it, and applies as a commit', async () => {
  const file = join(seed, 'patches-out', 'one.patch')
  writeFileSync(file, h.git(repo, 'format-patch', '--stdout', '-1', sha('Feature one')).replace(/\n/g, '\r\n') + '\r\n')
  await h.electronApp.evaluate(({ dialog: d }, from) => {
    d.showOpenDialog = (async () => ({ canceled: false, filePaths: [from] })) as typeof d.showOpenDialog
  }, file)
  await openApply()
  await dialog(h.page).getByRole('button', { name: 'Open a patch file…' }).click()
  await expect(dialog(h.page).getByText('one.patch')).toBeVisible()
  await expect(dialog(h.page).getByRole('list', { name: 'Commits in the patch' }).getByRole('listitem')).toHaveText(['Feature one · Kim'])
  await expect(dialog(h.page).getByRole('alert')).toHaveCount(0)
  await dialog(h.page).getByRole('button', { name: 'Apply 1 commit' }).click()
  await expect(toasts().getByText('Applied 1 commit')).toBeVisible()
  expect(subjects().split('\n')[0]).toBe('Feature one|Kim')
  expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('1\nTWO\n3\n')
})

test('F76-H8: merge commits can’t be made into patches', async () => {
  await commitRow(h.page, 'Merge feature').click({ button: 'right' })
  await h.page.getByRole('menuitem', { name: 'Patch' }).click()
  await expect(h.page.getByRole('menu').last().getByRole('menuitem', { name: 'Merge commits can’t be made into patches' })).toBeDisabled()
  await h.page.keyboard.press('Escape')
  await h.page.keyboard.press('Escape')
})

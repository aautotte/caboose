// F45: Git LFS through the system git. Large files commit as pointers, push their content, and arrive whole in a
// clone or a pull, all from the app; a repository that uses LFS where LFS isn't set up says so.
import { test, expect } from '@playwright/test'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dialog, gitIn, grid, launch, makeRepo, openWip, seed, toGraph, writeAndCommit, type Harness } from './harness'

let h: Harness
let repo = ''
const origin = join(seed, 'lfs-origin.git')
const other = join(seed, 'lfs-other')
const cloned = join(seed, 'lfs-cloned')
const big = (n: number): string => `binary-ish ${n}\n`.repeat(2000)
const POINTER = /^version https:\/\/git-lfs\.github\.com\/spec\/v1\noid sha256:[0-9a-f]{64}\nsize \d+\n$/

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => {
  h = await launch('lfs', {
    open: [join(seed, 'lfs')],
    setup: (env) => {
      for (const d of [origin, other, cloned]) rmSync(d, { recursive: true, force: true })
      // The tests' git leaves out the system config, where Git for Windows sets up LFS; set it up for the test user.
      gitIn(env, seed, 'lfs', 'install', '--skip-repo')
      repo = makeRepo(env, 'lfs', [['Start', { 'a.txt': 'a\n' }]])
      gitIn(env, repo, 'lfs', 'track', '*.bin')
      writeAndCommit(env, repo, 'Track .bin files with LFS', { 'first.bin': big(1) })
      gitIn(env, repo, 'init', '-q', '--bare', '-b', 'main', origin)
      gitIn(env, repo, 'remote', 'add', 'origin', origin)
      gitIn(env, repo, 'push', '-q', '-u', 'origin', 'main')
    }
  })
  await h.page.getByRole('tab', { name: 'lfs' }).click()
  await grid(h.page).getByRole('row', { name: /^Track \.bin files with LFS/ }).waitFor()
})
test.afterAll(async () => {
  await h.close()
})
test.afterEach(() => h.expectClean())

const toolbar = () => h.page.getByRole('toolbar', { name: 'Repository actions' })
const toasts = () => h.page.getByRole('region', { name: /Notifications/ })
/** Where git-lfs keeps an object, under a repository's (or a bare repository's) lfs folder. */
const lfsObject = (gitDir: string, oid: string): string => join(gitDir, 'lfs', 'objects', oid.slice(0, 2), oid.slice(2, 4), oid)
const oidOf = (cwd: string, rev: string): string => /oid sha256:([0-9a-f]{64})/.exec(h.git(cwd, 'cat-file', '-p', rev))![1]

test('F45-H1: a tracked file committed from the app is stored as an LFS pointer, and the working copy keeps the content', async () => {
  writeFileSync(join(repo, 'second.bin'), big(2))
  await openWip(h.page)
  await h.page.getByRole('button', { name: 'Stage all', exact: true }).click()
  await h.page.getByLabel('Commit summary').fill('Add a second large file')
  await h.page.getByRole('button', { name: /^Commit 1 file$/ }).click()
  await expect.poll(h.gitOr(repo, 'log', '-1', '--format=%s')).toBe('Add a second large file')
  expect(h.git(repo, 'cat-file', '-p', 'HEAD:second.bin') + '\n').toMatch(POINTER)
  expect(readFileSync(join(repo, 'second.bin'), 'utf8')).toBe(big(2))
  expect(h.git(repo, 'lfs', 'ls-files', '--name-only')).toContain('second.bin')
})

test('F45-H2: Push sends the large file’s content to the remote, not just the pointer', async () => {
  await toolbar().getByRole('button', { name: 'Push', exact: true }).click()
  await expect(toasts().getByText(/^Pushed main/)).toBeVisible()
  const oid = oidOf(repo, 'HEAD:second.bin')
  expect(existsSync(lfsObject(origin, oid))).toBe(true)
})

test('F45-H3: cloning from the app brings the large files whole', async () => {
  await h.page.getByRole('tab', { name: 'Repositories' }).click()
  await h.page.getByRole('button', { name: /^Clone/ }).first().click()
  await dialog(h.page).getByLabel('Repository URL').fill(origin)
  await dialog(h.page).getByLabel('Put it in').fill(seed)
  await dialog(h.page).getByLabel('Folder name').fill('lfs-cloned')
  await dialog(h.page).getByRole('button', { name: 'Clone', exact: true }).click()
  await expect(h.page.getByRole('tab', { name: 'lfs-cloned' })).toHaveAttribute('aria-selected', 'true')
  await expect(grid(h.page).getByRole('row', { name: /^Add a second large file/ })).toBeVisible()
  expect(readFileSync(join(cloned, 'first.bin'), 'utf8')).toBe(big(1))
  expect(readFileSync(join(cloned, 'second.bin'), 'utf8')).toBe(big(2))
})

test('F45-H4: Pull brings a large file someone else pushed, whole', async () => {
  gitIn(h.env, seed, 'clone', '-q', origin, other)
  writeAndCommit(h.env, other, 'Someone else adds a large file', { 'third.bin': big(3) })
  gitIn(h.env, other, 'push', '-q')
  await h.page.getByRole('tab', { name: 'lfs', exact: true }).click()
  await toolbar().getByRole('button', { name: /^Pull/ }).first().click()
  await expect(grid(h.page).getByRole('row', { name: /^Someone else adds a large file/ })).toBeVisible()
  await expect.poll(() => existsSync(join(repo, 'third.bin')) && readFileSync(join(repo, 'third.bin'), 'utf8')).toBe(big(3))
})

// big(n) is 26,000 bytes: "25 KB"; twice that is "51 KB".
test('F45-H6: changed LFS files carry an LFS badge, and their diff says how the file changed instead of showing the pointer', async () => {
  writeFileSync(join(repo, 'first.bin'), big(1) + big(1))
  writeFileSync(join(repo, 'a.txt'), 'a changed\n')
  await openWip(h.page)
  const unstaged = h.page.getByRole('listbox', { name: /Not staged/ })
  await expect(unstaged.getByRole('option', { name: /first\.bin/ })).toContainText('LFS')
  await expect(unstaged.getByRole('option', { name: /a\.txt/ })).not.toContainText('LFS')
  await unstaged.getByRole('option', { name: /first\.bin/ }).click()
  await expect(h.page.getByText('Stored in Git LFS')).toBeVisible()
  await expect(h.page.getByText(/^25 KB → 51 KB \(content [0-9a-f]{8} → [0-9a-f]{8}\)/)).toBeVisible()
  await expect(h.page.getByText('oid sha256:')).toHaveCount(0)
})

test('F45-H7: in a commit, an added LFS file has the badge, and its diff gives its size', async () => {
  h.git(repo, 'checkout', '--', 'first.bin', 'a.txt')
  await toGraph(h.page)
  await grid(h.page).getByRole('row', { name: /^Add a second large file/ }).click()
  const files = h.page.getByRole('listbox', { name: 'Changed files' })
  await expect(files.getByRole('option', { name: /second\.bin/ })).toContainText('LFS')
  await files.getByRole('option', { name: /second\.bin/ }).click()
  await expect(h.page.getByText('A new file of 25 KB. Its content is in Git LFS, so there are no lines to compare.')).toBeVisible()
})

const attributes = (): string => readFileSync(join(repo, '.gitattributes'), 'utf8')
const notStaged = () => h.page.getByRole('listbox', { name: /Not staged/ })
async function lfsItem(file: RegExp, ...path: string[]): Promise<void> {
  await notStaged().getByRole('option', { name: file }).click({ button: 'right' })
  const last = path.pop()!
  for (const sub of path) await h.page.getByRole('menuitem', { name: sub }).click()
  // In a small window a submenu can open over its parent, so pick the last item from the keyboard.
  await h.page.getByRole('menu').last().getByRole('menuitem', { name: last, exact: true }).press('Enter')
}

test('F45-H8: Track with Git LFS › All *.psd files: the rule goes in .gitattributes, and the file commits as a pointer', async () => {
  writeFileSync(join(repo, 'cover.psd'), big(5))
  await openWip(h.page)
  await expect(notStaged().getByRole('option', { name: /cover\.psd/ })).not.toContainText('LFS')
  await lfsItem(/cover\.psd/, 'Track with Git LFS', 'All *.psd files')
  await expect(toasts().getByText('Tracking *.psd files with Git LFS')).toBeVisible()
  expect(attributes()).toMatch(/^\*\.psd filter=lfs diff=lfs merge=lfs -text$/m)
  await expect(notStaged().getByRole('option', { name: /cover\.psd/ })).toContainText('LFS')
  await h.page.getByRole('button', { name: 'Stage all', exact: true }).click()
  await h.page.getByLabel('Commit summary').fill('Add the cover, in LFS')
  await h.page.getByRole('button', { name: /^Commit 2 files$/ }).click()
  await expect.poll(h.gitOr(repo, 'log', '-1', '--format=%s')).toBe('Add the cover, in LFS')
  expect(h.git(repo, 'cat-file', '-p', 'HEAD:cover.psd') + '\n').toMatch(POINTER)
})

test('F45-H9: Track one file whose name has a space and brackets, then Stop tracking it; the other rules stay', async () => {
  writeFileSync(join(repo, 'big [v2].dat'), big(6))
  await lfsItem(/big \[v2\]\.dat/, 'Track with Git LFS', 'Only big [v2].dat')
  await expect(toasts().getByText('Tracking big [v2].dat with Git LFS')).toBeVisible()
  // How git-lfs writes one file's rule: the space as [[:space:]], the brackets escaped.
  const rule = String.raw`big[[:space:]]\[v2\].dat`
  expect(attributes()).toContain(`${rule} filter=lfs`)
  expect(h.git(repo, 'check-attr', 'filter', '--', 'big [v2].dat')).toMatch(/filter: lfs$/)
  await expect(notStaged().getByRole('option', { name: /big \[v2\]\.dat/ })).toContainText('LFS')
  await lfsItem(/big \[v2\]\.dat/, `Stop tracking ${rule} with Git LFS`)
  await expect(toasts().getByText(`Stopped tracking ${rule} with Git LFS`)).toBeVisible()
  expect(attributes()).not.toContain('big[[:space:]]')
  expect(attributes()).toContain('*.bin filter=lfs')
  expect(attributes()).toContain('*.psd filter=lfs')
  await expect(notStaged().getByRole('option', { name: /big \[v2\]\.dat/ })).not.toContainText('LFS')
})

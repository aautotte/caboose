// F45 (setup): a repository that keeps large files in Git LFS, opened where LFS was never turned on in git's config.
// Git checks those files out as pointers and says nothing; the app says so, and turns LFS on when asked.
import { test, expect } from '@playwright/test'
import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { axe, gitIn, grid, launch, makeRepo, seed, writeAndCommit, type Harness } from './harness'

let h: Harness
const source = join(seed, 'lfs-source')
const origin = join(seed, 'lfs-setup-origin.git')
const plain = join(seed, 'lfs-plain')
const content = 'large file content\n'.repeat(1000)
const POINTER = /^version https:\/\/git-lfs\.github\.com\/spec\/v1\n/

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => {
  h = await launch('lfs-setup', {
    open: [plain, join(seed, 'lfs-none')],
    setup: (env) => {
      for (const d of [origin, plain]) rmSync(d, { recursive: true, force: true })
      // LFS set up in the source repository only (its own config and hooks); the test user's git has none of it.
      makeRepo(env, 'lfs-source', [])
      gitIn(env, source, 'lfs', 'install', '--local')
      gitIn(env, source, 'lfs', 'track', '*.bin')
      writeAndCommit(env, source, 'Add a large file', { 'big.bin': content, 'a.txt': 'a\n' })
      gitIn(env, source, 'init', '-q', '--bare', '-b', 'main', origin)
      gitIn(env, source, 'remote', 'add', 'origin', origin)
      gitIn(env, source, 'push', '-q', 'origin', 'main')
      gitIn(env, seed, 'clone', '-q', origin, plain)
      makeRepo(env, 'lfs-none', [['Plain files only', { 'a.txt': 'a\n' }]])
    }
  })
  await h.page.getByRole('tab', { name: 'lfs-plain' }).click()
  await grid(h.page).getByRole('row', { name: /^Add a large file/ }).waitFor()
})
test.afterAll(async () => {
  await h.close()
})
test.afterEach(() => h.expectClean())

const notice = () => h.page.getByRole('status', { name: 'Git LFS' })

test('F45-E1: LFS isn’t turned on: the clone has a pointer file, and the notice says why', async () => {
  expect(readFileSync(join(plain, 'big.bin'), 'utf8')).toMatch(POINTER)
  await expect(notice()).toContainText('isn’t turned on in your Git')
  await expect(notice().getByRole('button', { name: 'Turn on Git LFS' })).toBeVisible()
  expect(await axe(h.page)).toEqual([])
})

test('F45-E2: a repository without LFS shows no notice', async () => {
  await h.page.getByRole('tab', { name: 'lfs-none' }).click()
  await grid(h.page).getByRole('row', { name: /^Plain files only/ }).waitFor()
  await expect(notice()).toHaveCount(0)
  await h.page.getByRole('tab', { name: 'lfs-plain' }).click()
})

test('F45-E3: Not now hides the notice for this session', async () => {
  await notice().getByRole('button', { name: 'Not now' }).click()
  await expect(notice()).toHaveCount(0)
  await h.page.reload()
  await h.page.getByRole('tab', { name: 'lfs-plain' }).click()
  await expect(notice()).toBeVisible()
})

test('F45-H5: Turn on Git LFS sets it up and puts the large file in place of its pointer', async () => {
  await notice().getByRole('button', { name: 'Turn on Git LFS' }).click()
  await expect(h.page.getByRole('region', { name: /Notifications/ }).getByText('Git LFS is on')).toBeVisible()
  await expect(notice()).toHaveCount(0)
  expect(readFileSync(join(plain, 'big.bin'), 'utf8')).toBe(content)
  expect(h.git(plain, 'config', '--global', '--get', 'filter.lfs.process')).toContain('git-lfs')
  // The pointer becoming the file isn't a change to commit.
  expect(h.git(plain, 'status', '--porcelain')).toBe('')
})

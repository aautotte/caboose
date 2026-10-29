// F57: branches made or checked out outside the app show even when the file watcher missed them (it's off here):
// coming back to the window looks, and so does a fetch.
import { test, expect } from '@playwright/test'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { gitIn, launch, makeRepo, seed, type Harness } from './harness'

let h: Harness
const origin = join(seed, 'outside-origin.git')
const repo = join(seed, 'outside')

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => {
  h = await launch('outside', {
    open: [repo],
    extraEnv: { GC_WATCH: 'off' },
    setup: (env) => {
      for (const d of [origin, repo]) rmSync(d, { recursive: true, force: true })
      const src = makeRepo(env, 'outside-src', [['Start', { 'README.md': 'hi\n' }]])
      gitIn(env, seed, 'clone', '-q', '--bare', src, origin)
      gitIn(env, seed, 'clone', '-q', origin, repo)
    }
  })
  await h.page.getByRole('tab', { name: 'outside', exact: true }).click()
})
test.afterAll(async () => {
  await h.close()
})
test.afterEach(() => h.expectClean())

const local = (name: string) => h.page.getByRole('tree', { name: 'Local branches' }).getByRole('treeitem', { name: new RegExp(`^${name}(,|$)`) })

test('F57-H1: a branch made and checked out in a terminal shows when you come back to the window', async () => {
  await expect(local('main')).toHaveAttribute('aria-current', 'true')
  h.git(repo, 'switch', '-q', '-c', 'made-outside')
  // With no watcher, nothing tells the window yet.
  await h.page.waitForTimeout(1000)
  await expect(local('made-outside')).toHaveCount(0)
  await h.page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(local('made-outside')).toHaveAttribute('aria-current', 'true')
})

test('F57-H2: and when you fetch', async () => {
  h.git(repo, 'switch', '-q', '-c', 'second-outside')
  await h.page.waitForTimeout(1000)
  await expect(local('second-outside')).toHaveCount(0)
  await h.page.getByRole('button', { name: 'Pull options' }).click()
  await h.page.getByRole('menuitem', { name: /Fetch all remotes/ }).click()
  await expect(local('second-outside')).toHaveAttribute('aria-current', 'true')
})

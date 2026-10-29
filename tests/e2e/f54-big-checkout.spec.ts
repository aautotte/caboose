// F54: switching between far-apart branches of a big repository. A switch says it’s working while it runs (with git’s
// progress: "45% (58234/129384)"), and with the watch that only covers git's own folders (what Linux uses,
// GC_WATCH=git here), changes made in a terminal still show at once.
import { test, expect } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gitIn, grid, launch, makeRepo, seed, type Harness } from './harness'

let h: Harness
const repo = join(seed, 'bigco')

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => {
  h = await launch('bigco', {
    open: [repo],
    extraEnv: { GC_WATCH: 'git' },
    setup: (env) => {
      makeRepo(env, 'bigco', [['Start', { 'README.md': 'hi\n' }]])
      gitIn(env, repo, 'switch', '-q', '-c', 'release')
      writeFileSync(join(repo, 'release.txt'), 'release\n')
      gitIn(env, repo, 'add', '.')
      gitIn(env, repo, 'commit', '-q', '-m', 'Release work')
      gitIn(env, repo, 'switch', '-q', 'main')
      // A switch that takes a while, like a far jump on a big repository, with git's progress line (a hook's output
      // comes out as git's own).
      writeFileSync(join(repo, '.git', 'hooks', 'post-checkout'), '#!/bin/sh\nprintf "Updating files:  45%% (58234/129384)\\n" >&2\nsleep 3\n', { mode: 0o755 })
    }
  })
  await h.page.getByRole('tab', { name: 'bigco', exact: true }).click()
})
test.afterAll(async () => {
  await h.close()
})
test.afterEach(() => h.expectClean())

const local = (name: string) => h.page.getByRole('tree', { name: 'Local branches' }).getByRole('treeitem', { name: new RegExp(`^${name}(,|$)`) })
const head = (): string => h.git(repo, 'rev-parse', '--abbrev-ref', 'HEAD')

test('F54-H1: a long switch shows "Switching to release…" and git’s progress until it’s done', async () => {
  await local('release').dblclick()
  const status = h.page.getByRole('toolbar', { name: 'Repository actions' }).getByRole('status')
  await expect(status).toContainText('Switching to release…')
  // The percentage, and the count as git prints it.
  await expect(status).toContainText('Updating files 45% (58234/129384)')
  await expect.poll(head).toBe('release')
  await expect(status).toHaveCount(0, { timeout: 15_000 })
  await expect(local('release')).toHaveAttribute('aria-current', 'true')
})

test('F54-H2: watching only git’s folders, a commit, a checkout and new branches made in a terminal show at once', async () => {
  writeFileSync(join(repo, 'more.txt'), 'more\n')
  h.git(repo, 'add', '.')
  h.git(repo, 'commit', '-q', '-m', 'From a terminal')
  await expect(grid(h.page).getByRole('row', { name: /^From a terminal/ })).toBeVisible()
  // A branch in a folder that doesn't exist yet, then another in it: the new folder is watched as it appears.
  h.git(repo, 'branch', 'feature/one')
  await expect(local('feature/one')).toBeVisible()
  h.git(repo, 'branch', 'feature/two')
  await expect(local('feature/two')).toBeVisible()
  h.git(repo, '-c', 'core.hooksPath=/dev/null', 'switch', '-q', 'main')
  await expect(local('main')).toHaveAttribute('aria-current', 'true')
})

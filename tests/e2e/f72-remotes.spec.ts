// F72: managing remotes. Rename one (its branches and what tracks them follow), change its URL and push URL, undo
// and redo both, and fetch just one remote.
import { test, expect } from '@playwright/test'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { dialog, gitIn, launch, makeRepo, menu, seed, type Harness } from './harness'

let h: Harness
const repo = join(seed, 'remotes')
const up1 = join(seed, 'remotes-up1.git')
const up2 = join(seed, 'remotes-up2.git')
const slash = (p: string): string => p.split('\\').join('/')

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => {
  h = await launch('remotes', {
    open: [repo],
    setup: (env) => {
      makeRepo(env, 'remotes', [['Base', { 'a.txt': 'a\n' }]])
      for (const up of [up1, up2]) {
        rmSync(up, { recursive: true, force: true })
        gitIn(env, seed, 'clone', '-q', '--bare', repo, up)
      }
      gitIn(env, repo, 'remote', 'add', 'origin', slash(up1))
      gitIn(env, repo, 'fetch', '-q', 'origin')
      gitIn(env, repo, 'branch', '-q', '-u', 'origin/main', 'main')
    }
  })
  await h.page.getByRole('tab', { name: 'remotes', exact: true }).click()
})
test.afterAll(async () => {
  await h.close()
})
test.afterEach(() => h.expectClean())

const toasts = () => h.page.getByRole('region', { name: /Notifications/ })
const header = () => h.page.getByRole('button', { name: /^Remotes \d/ })
const urls = (name: string): string => `${h.git(repo, 'remote', 'get-url', name)} ${h.git(repo, 'remote', 'get-url', '--push', name)}`
const field = (name: string) => dialog(h.page).getByRole('textbox', { name, exact: true })

test('F72-H1: renaming a remote moves its branches; main tracks the new name', async () => {
  await menu(h.page, header(), 'Edit origin…')
  await expect(field('URL')).toHaveValue(slash(up1))
  await expect(dialog(h.page).getByRole('button', { name: 'Save' })).toBeDisabled()
  await field('Name').fill('github')
  await dialog(h.page).getByRole('button', { name: 'Save' }).click()
  await expect(toasts().getByText('Renamed origin to github')).toBeVisible()
  expect(h.git(repo, 'remote')).toBe('github')
  expect(h.git(repo, 'rev-parse', '--abbrev-ref', 'main@{upstream}')).toBe('github/main')
  await expect(h.page.getByRole('treeitem', { name: 'main' }).last()).toBeVisible()
})

test('F72-H2: a new URL and a separate push URL', async () => {
  await menu(h.page, header(), 'Edit github…')
  await field('URL').fill(slash(up2))
  await field('Push URL (optional)').fill(slash(up1))
  await dialog(h.page).getByRole('button', { name: 'Save' }).click()
  await expect(toasts().getByText('Updated github')).toBeVisible()
  expect(urls('github')).toBe(`${slash(up2)} ${slash(up1)}`)
})

test('F72-H3: undo puts the URL back and drops the push URL, then the old name; redo does both again', async () => {
  await h.page.keyboard.press('Control+z')
  // No push URL of its own left: pushes go to the URL again.
  await expect.poll(h.gitOr(repo, 'config', '--get-all', 'remote.github.pushurl')).toBe('')
  expect(urls('github')).toBe(`${slash(up1)} ${slash(up1)}`)
  await h.page.keyboard.press('Control+z')
  await expect.poll(() => h.git(repo, 'remote')).toBe('origin')
  expect(h.git(repo, 'rev-parse', '--abbrev-ref', 'main@{upstream}')).toBe('origin/main')
  await h.page.keyboard.press('Control+y')
  await expect.poll(() => h.git(repo, 'remote')).toBe('github')
  await h.page.keyboard.press('Control+y')
  await expect.poll(() => urls('github')).toBe(`${slash(up2)} ${slash(up1)}`)
})

test('F72-H4: Fetch github gets the branches of that remote only', async () => {
  h.git(repo, 'push', '-q', slash(up2), 'main:feature')
  await menu(h.page, header(), 'Fetch github')
  await expect(toasts().getByText('Fetched github')).toBeVisible()
  // Git 2.48+ also makes github/HEAD on fetch: only the branches count.
  expect(h.git(repo, 'for-each-ref', '--format=%(refname:short)', '--exclude=refs/remotes/*/HEAD', 'refs/remotes')).toBe('github/feature\ngithub/main')
  await expect(h.page.getByRole('treeitem', { name: 'feature' })).toBeVisible()
})

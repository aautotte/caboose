// F85: creating a pull request on GitHub, against a fake GitHub. From a branch's menu, one that isn't pushed yet
// (pushed first, and set to track); from the toast after a push and the offer in the panel, one with a single
// commit (its message as the title and description), as a draft; GitHub turning one down; a branch with nothing
// to merge; and the list read again on its own when Caboose comes back to the front.
import { test, expect } from '@playwright/test'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { appState, axe, dialog, gitIn, launch, makeRepo, seed, writeAndCommit, type Harness } from './harness'
import { fakeGitHub, type FakeGitHub } from './fakeGitHub'

let h: Harness
let gh: FakeGitHub
const origin = join(seed, 'cpr-origin.git')
const repo = join(seed, 'cprrepo')
// The test's own git config and identity, from the setup.
let env: NodeJS.ProcessEnv = {}

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => {
  gh = await fakeGitHub('acme/widgets', [])
  h = await launch('create-pull', {
    open: [repo],
    extraEnv: { GC_GITHUB_WEB: gh.url, GC_GITHUB_API: gh.url, GH_TOKEN: 'gho_cli_token', GH_CONFIG_DIR: join(seed, 'gh-config-empty') },
    setup: (e) => {
      env = e
      for (const d of [origin, repo]) rmSync(d, { recursive: true, force: true })
      const src = makeRepo(env, 'cpr-src', [['Start', { 'README.md': 'widgets\n' }]])
      gitIn(env, src, 'switch', '-q', '-c', 'feature/login')
      writeAndCommit(env, src, 'Add login', { 'login.txt': 'login\n' })
      gitIn(env, src, 'switch', '-q', 'main')
      gitIn(env, seed, 'clone', '-q', '--bare', src, origin)
      gitIn(env, seed, 'clone', '-q', origin, repo)
      // origin says GitHub, but git goes to the folder instead, fetching and pushing.
      gitIn(env, repo, 'config', `url.${origin.replace(/\\/g, '/')}.insteadOf`, 'https://github.com/acme/widgets.git')
      gitIn(env, repo, 'remote', 'set-url', 'origin', 'https://github.com/acme/widgets.git')
      // Two commits, not pushed.
      gitIn(env, repo, 'switch', '-q', '-c', 'feature/search-box')
      writeAndCommit(env, repo, 'Add a search box', { 'search.txt': 'search\n' })
      writeAndCommit(env, repo, 'Search by author', { 'search.txt': 'search\nauthor\n' })
      gitIn(env, repo, 'branch', '-q', 'empty', 'main')
      gitIn(env, repo, 'switch', '-q', 'main')
    }
  })
  // Never github.com itself.
  expect(h.git(repo, 'ls-remote', '--get-url', 'origin')).toBe(origin.replace(/\\/g, '/'))
  gh.pulls.push({ number: 12, title: 'Add login', author: 'alice', head: 'feature/login', headSha: h.git(origin, 'rev-parse', 'feature/login') })
  gh.shaOf = (b) => h.git(origin, 'rev-parse', `refs/heads/${b}`)
  await h.page.getByRole('tab', { name: 'cprrepo', exact: true }).click()
  // Signed in with the device flow, approved at once.
  await panel().getByRole('button', { name: 'Sign in to GitHub' }).click()
  await expect(dialog(h.page).getByLabel('Your code')).toHaveText('WDJB-MJHT')
  gh.approve()
  await expect(dialog(h.page)).toHaveCount(0, { timeout: 15_000 })
  await expect(pull(12)).toBeVisible()
})
test.afterAll(async () => {
  await h.close()
  await gh.close()
})
test.afterEach(() => h.expectClean())

const panel = () => h.page.getByRole('navigation', { name: 'Branches and tags' })
const pulls = () => panel().getByRole('tree', { name: 'Pull requests' })
const pull = (n: number) => pulls().getByRole('treeitem', { name: new RegExp(`^#${n} `) })
const local = (name: string) => panel().getByRole('tree', { name: 'Local branches' }).getByRole('treeitem', { name: new RegExp(`^${name}\\b`) })
const toasts = () => h.page.getByRole('region', { name: /Notifications/ })
const created = () => gh.requests.filter((r) => r.method === 'POST' && r.path === '/repos/acme/widgets/pulls').map((r) => JSON.parse(r.body) as Record<string, unknown>)

test('F85-H1: from a branch’s menu, one not pushed yet: titled from its name, its commits listed; pushed, tracked, then created', async () => {
  await local('feature/search-box').click({ button: 'right' })
  await h.page.getByRole('menuitem', { name: 'Create a pull request…' }).click()
  const d = dialog(h.page)
  await expect(d).toHaveAccessibleName('Create a pull request for feature/search-box')
  await expect(d.getByLabel('Title')).toHaveValue('Search box')
  await expect(d.getByLabel('Description')).toHaveValue('- Add a search box\n- Search by author')
  await expect(d.getByRole('combobox', { name: 'Base branch' })).toHaveText('main')
  await expect(d.getByRole('status')).toHaveText('2 commits. feature/search-box isn’t on origin yet: it’s pushed there first.')
  expect(await axe(h.page)).toEqual([])
  await d.getByLabel('Title').fill('A search box')
  await d.getByRole('button', { name: 'Create pull request' }).click()
  await expect(d).toHaveCount(0, { timeout: 15_000 })
  await expect(toasts()).toContainText('Created pull request #13')
  expect(h.git(origin, 'rev-parse', 'feature/search-box')).toBe(h.git(repo, 'rev-parse', 'feature/search-box'))
  expect(h.git(repo, 'rev-parse', '--abbrev-ref', 'feature/search-box@{upstream}')).toBe('origin/feature/search-box')
  expect(created().at(-1)).toEqual({ head: 'feature/search-box', base: 'main', title: 'A search box', body: '- Add a search box\n- Search by author', draft: false })
  await expect(pull(13)).toHaveAccessibleName('#13 A search box, by octo')
  // It has one now: the menu doesn't offer another.
  await local('feature/search-box').click({ button: 'right' })
  await expect(h.page.getByRole('menuitem', { name: 'Create a pull request…' })).toHaveCount(0)
  await h.page.keyboard.press('Escape')
})

test('F85-H2: after a push, the toast and the panel offer it; one commit gives the title and description; as a draft', async () => {
  h.git(repo, 'switch', '-q', '-c', 'fix/typo')
  writeAndCommit(env, repo, 'Fix the typo in the README\n\nIt said widgest.', { 'README.md': 'widgets.\n' })
  const toolbar = h.page.getByRole('toolbar', { name: 'Repository actions' })
  await expect(toolbar.getByRole('button', { name: 'Switch branch: fix/typo' })).toBeVisible()
  await toolbar.getByRole('button', { name: 'Push', exact: true }).click()
  await dialog(h.page).getByRole('button', { name: 'Publish branch' }).click()
  await expect(toasts()).toContainText('Pushed fix/typo', { timeout: 15_000 })
  await expect(panel().getByRole('button', { name: 'Create a pull request for fix/typo…' })).toBeVisible()
  await toasts().getByRole('button', { name: 'Create pull request' }).click()
  const d = dialog(h.page)
  await expect(d.getByLabel('Title')).toHaveValue('Fix the typo in the README')
  await expect(d.getByLabel('Description')).toHaveValue('It said widgest.')
  await expect(d.getByRole('status')).toHaveText('1 commit. fix/typo is up to date on origin.')
  await d.getByRole('checkbox', { name: /as a draft/ }).click()
  const pushes = gh.requests.length
  await d.getByRole('button', { name: 'Create draft pull request' }).click()
  await expect(d).toHaveCount(0)
  expect(created().at(-1)).toMatchObject({ head: 'fix/typo', draft: true, title: 'Fix the typo in the README' })
  expect(gh.requests.length).toBeGreaterThan(pushes)
  await expect(pull(14)).toHaveAccessibleName('#14 Fix the typo in the README draft, by octo')
  await expect(panel().getByRole('button', { name: /^Create a pull request for/ })).toHaveCount(0)
  h.git(repo, 'switch', '-q', 'main')
})

test('F85-H3: GitHub turning it down shows why and keeps the dialog; a branch with nothing to merge can’t be sent', async () => {
  await local('empty').click({ button: 'right' })
  await h.page.getByRole('menuitem', { name: 'Create a pull request…' }).click()
  const d = dialog(h.page)
  await expect(d).toContainText('empty has no commits that main doesn’t have.')
  await expect(d.getByRole('button', { name: 'Create pull request' })).toBeDisabled()
  await d.getByRole('button', { name: 'Cancel' }).click()

  h.git(repo, 'switch', '-q', '-c', 'feature/export')
  writeAndCommit(env, repo, 'Export to CSV', { 'export.txt': 'csv\n' })
  h.git(repo, 'push', '-q', '-u', 'origin', 'feature/export')
  h.git(repo, 'switch', '-q', 'main')
  await local('feature/export').click({ button: 'right' })
  await h.page.getByRole('menuitem', { name: 'Create a pull request…' }).click()
  await expect(d.getByLabel('Title')).toHaveValue('Export to CSV')
  gh.refuse = 'A pull request already exists for acme:feature/export.'
  await d.getByRole('button', { name: 'Create pull request' }).click()
  await expect(d).toContainText('GitHub turned it down: A pull request already exists for acme:feature/export.')
  await expect(d.getByLabel('Title')).toHaveValue('Export to CSV')
  await d.getByRole('button', { name: 'Create pull request' }).click()
  await expect(d).toHaveCount(0)
  await expect(toasts()).toContainText('Created pull request #15')
})

test('F85-H4: the list is read again as Caboose comes back to the front, once it’s a minute old', async () => {
  const reads = (): number => gh.requests.filter((r) => r.path === '/graphql').length
  const id = (await appState<{ active: string }>(h.page)).active
  // The read after the last one was created has finished.
  await expect(pull(15)).toBeVisible()
  await expect.poll(async () => (await appState<{ repos: Record<string, { pullsLoading: boolean }> }>(h.page)).repos[id].pullsLoading).toBe(false)
  const before = reads()
  // Fresh: coming back doesn't read it again.
  await h.page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await h.page.waitForTimeout(500)
  expect(reads()).toBe(before)
  gh.pulls.unshift({ number: 20, title: 'From someone else', author: 'carol', head: 'carol/idea', headSha: '', fork: true })
  await h.page.evaluate((r) => (window as unknown as { __gcAgePulls: (r: string) => void }).__gcAgePulls(r), id)
  await h.page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(pull(20)).toBeVisible()
  expect(reads()).toBe(before + 1)
})

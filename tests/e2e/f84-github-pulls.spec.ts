// F84: GitHub, against a fake GitHub. Signing in with the device flow (the code, GitHub's page opened, waiting for
// the approval), the sign-in kept encrypted; the repository's pull requests in the branches panel, with checks,
// reviews and a #number on their branch in the graph; checking one out from this repository and from a fork; a
// refused sign-in; the gh CLI's sign-in; a token GitHub stops accepting.
import { test, expect } from '@playwright/test'
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { axe, dialog, gitIn, grid, launch, makeRepo, seed, toGraph, writeAndCommit, type Harness } from './harness'
import { fakeGitHub, type FakeGitHub } from './fakeGitHub'

let h: Harness
let gh: FakeGitHub
const origin = join(seed, 'gh-origin.git')
const repo = join(seed, 'ghrepo')
const userData = join(seed, 'userdata-github')
let loginSha = ''
let forkSha = ''

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => {
  gh = await fakeGitHub('acme/widgets', [])
  h = await launch('github', {
    open: [repo],
    // The gh CLI answers with this, never with a sign-in of the computer running the tests.
    extraEnv: { GC_GITHUB_WEB: gh.url, GC_GITHUB_API: gh.url, GH_TOKEN: 'gho_cli_token', GH_CONFIG_DIR: join(seed, 'gh-config-empty') },
    setup: (env) => {
      for (const d of [origin, repo]) rmSync(d, { recursive: true, force: true })
      const src = makeRepo(env, 'gh-src', [['Start', { 'README.md': 'widgets\n' }]])
      gitIn(env, src, 'switch', '-q', '-c', 'feature/login')
      writeAndCommit(env, src, 'Add login', { 'login.txt': 'login\n' })
      loginSha = gitIn(env, src, 'rev-parse', 'HEAD')
      // A fork's commit: on no branch here, only at refs/pull/7/head, as GitHub keeps it.
      gitIn(env, src, 'switch', '-q', '--detach', 'main')
      writeAndCommit(env, src, 'Fix a typo', { 'README.md': 'widgets!\n' })
      forkSha = gitIn(env, src, 'rev-parse', 'HEAD')
      gitIn(env, src, 'switch', '-q', 'main')
      gitIn(env, seed, 'clone', '-q', '--bare', src, origin)
      gitIn(env, origin, 'update-ref', 'refs/pull/7/head', forkSha)
      gitIn(env, seed, 'clone', '-q', origin, repo)
      // Fetched from the folder; the push URL says which GitHub repository it is.
      gitIn(env, repo, 'remote', 'set-url', '--push', 'origin', 'https://github.com/acme/widgets.git')
    }
  })
  gh.pulls.push(
    { number: 12, title: 'Add login', author: 'alice', head: 'feature/login', headSha: loginSha, checks: 'SUCCESS', review: 'APPROVED' },
    { number: 7, title: 'Fix a typo', author: 'bob', head: 'patch-1', headSha: forkSha, fork: true, draft: true, checks: 'FAILURE' }
  )
  await h.page.getByRole('tab', { name: 'ghrepo', exact: true }).click()
  await h.electronApp.evaluate(({ shell }) => {
    const g = globalThis as unknown as { opened: string[] }
    g.opened = []
    shell.openExternal = (async (url: string) => void g.opened.push(url)) as typeof shell.openExternal
  })
})
test.afterAll(async () => {
  await h.close()
  await gh.close()
})
test.afterEach(() => h.expectClean())

const panel = () => h.page.getByRole('navigation', { name: 'Branches and tags' })
const pulls = () => panel().getByRole('tree', { name: 'Pull requests' })
const pull = (n: number) => pulls().getByRole('treeitem', { name: new RegExp(`^#${n} `) })
const toasts = () => h.page.getByRole('region', { name: /Notifications/ })
const opened = () => h.electronApp.evaluate(() => (globalThis as unknown as { opened: string[] }).opened.at(-1))
const clipboard = () => h.electronApp.evaluate(({ clipboard }) => clipboard.readText())
const head = (): string => h.git(repo, 'rev-parse', '--abbrev-ref', 'HEAD')
const account = () => h.page.getByRole('region', { name: 'Settings' }).getByRole('status', { name: 'GitHub account' })

test('F84-H1: signed out, the panel offers to sign in; the device flow shows a code, opens GitHub, and waits for the approval', async () => {
  await expect(panel().getByText('Sign in to see acme/widgets’s.')).toBeVisible()
  await panel().getByRole('button', { name: 'Sign in to GitHub' }).click()
  await expect(dialog(h.page).getByLabel('Your code')).toHaveText('WDJB-MJHT')
  await dialog(h.page).getByRole('button', { name: 'Copy the code and open GitHub' }).click()
  await expect.poll(opened).toBe(`${gh.url}/login/device`)
  await expect.poll(clipboard).toBe('WDJB-MJHT')
  await expect(dialog(h.page).getByRole('status')).toContainText('Waiting for you to authorize Caboose on GitHub…')
  expect(await axe(h.page)).toEqual([])
  // Caboose asked with its own client ID, for the repo scope, and no secret.
  const ask = gh.requests.find((r) => r.path === '/login/device/code')!
  expect(JSON.parse(ask.body)).toEqual({ client_id: 'Ov23liR8tIc71IGL9jko', scope: 'repo' })

  gh.approve()
  await expect(dialog(h.page)).toHaveCount(0, { timeout: 15_000 })
  await expect(toasts()).toContainText('Signed in to GitHub as octo')
  // Kept encrypted: the token isn't in the file as text.
  const dir = join(userData, 'accounts')
  const files = readdirSync(dir)
  expect(files).toHaveLength(1)
  expect(readFileSync(join(dir, files[0])).toString('latin1')).not.toContain('gho_device_1')
})

test('F84-H2: the pull requests, with their checks, reviews and drafts; the branch in the graph says #12', async () => {
  await expect(pull(12)).toHaveAccessibleName('#12 Add login approved, by alice, checks passed')
  await expect(pull(7)).toHaveAccessibleName('#7 Fix a typo draft, by bob, checks failed')
  const query = gh.requests.filter((r) => r.path === '/graphql').at(-1)!
  expect(query.auth).toBe('Bearer gho_device_1')
  expect(JSON.parse(query.body).variables).toEqual({ owner: 'acme', name: 'widgets' })
  await toGraph(h.page)
  await expect(grid(h.page).getByTitle('Pull request #12: Add login')).toBeVisible()
  expect(await axe(h.page)).toEqual([])
  // Clicking one picks its commit in the graph.
  await pull(12).click()
  await expect(grid(h.page).getByRole('row', { name: /^Add login,/ })).toHaveAttribute('aria-selected', 'true')
})

test('F84-H3: double-clicking one checks it out: its branch from this repository, pr/<number> for a fork’s', async () => {
  await pull(12).dblclick()
  await expect.poll(head).toBe('feature/login')
  expect(h.git(repo, 'rev-parse', '--abbrev-ref', 'feature/login@{upstream}')).toBe('origin/feature/login')
  await expect(panel().getByRole('tree', { name: 'Local branches' }).getByRole('treeitem', { name: /^feature folder/ })).toBeVisible()

  await pull(7).click({ button: 'right' })
  await h.page.getByRole('menuitem', { name: 'Check out as pr/7' }).click()
  await expect.poll(head).toBe('pr/7')
  expect(h.git(repo, 'rev-parse', 'HEAD')).toBe(forkSha)
  // Open on GitHub goes to the pull request's page.
  await pull(7).click({ button: 'right' })
  await h.page.getByRole('menuitem', { name: 'Open on GitHub' }).click()
  await expect.poll(opened).toBe('https://github.com/acme/widgets/pull/7')
  h.git(repo, 'switch', '-q', 'main')
})

test('F84-H4: signing out puts the panel back to "sign in"; a refused authorization says so and can start again', async () => {
  await h.page.getByRole('button', { name: 'Settings' }).click()
  await expect(account()).toContainText('Signed in as octo (Octo Cat)')
  await h.page.getByRole('region', { name: 'GitHub' }).getByRole('button', { name: 'Sign out' }).click()
  await expect(account()).toContainText('Not signed in')
  expect(readdirSync(join(userData, 'accounts'))).toHaveLength(0)
  await expect(panel().getByText('Sign in to see acme/widgets’s.')).toBeVisible()

  await h.page.getByRole('button', { name: 'Sign in to GitHub…' }).click()
  await expect(dialog(h.page).getByLabel('Your code')).toHaveText('WDJB-MJHT')
  gh.deny()
  await expect(dialog(h.page)).toContainText('Caboose wasn’t authorized on GitHub.', { timeout: 15_000 })
  await dialog(h.page).getByRole('button', { name: 'Try again' }).click()
  await expect(dialog(h.page).getByLabel('Your code')).toHaveText('WDJB-MJHT')
  await dialog(h.page).getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog(h.page)).toHaveCount(0)
})

test('F84-H5: the gh CLI’s sign-in is used when asked; a token GitHub stops accepting signs out', async () => {
  test.skip(!['gh', join(process.env.ProgramFiles ?? 'C:\\Program Files', 'GitHub CLI', 'gh.exe')].some((c) => c === 'gh' ? process.env.PATH?.split(';').some((p) => existsSync(join(p, 'gh.exe')) || existsSync(join(p, 'gh'))) : existsSync(c)), 'the gh CLI isn’t installed here')
  await h.page.getByRole('button', { name: 'Use the gh CLI’s sign-in' }).click()
  await expect(account()).toContainText('Signed in as octo')
  await expect(pull(12)).toBeVisible()
  expect(gh.requests.filter((r) => r.path === '/graphql').at(-1)!.auth).toBe('Bearer gho_cli_token')

  gh.revoke()
  await panel().getByRole('button', { name: 'Refresh pull requests' }).click()
  await expect(panel()).toContainText('GitHub no longer accepts this sign-in')
  await h.page.reload()
  await h.page.getByRole('tab', { name: 'ghrepo', exact: true }).click()
  await expect(panel().getByText('Sign in to see acme/widgets’s.')).toBeVisible()
})

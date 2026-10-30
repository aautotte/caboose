// F67: pages on the git host. A branch, a commit or the repository opens in the browser; a branch gets a new pull
// request; links can be copied. URLs come from the remote's URL alone (GitHub, GitLab, Bitbucket, Azure DevOps),
// and git config caboose.hosting says which for a server whose name doesn't.
import { test, expect } from '@playwright/test'
import { join } from 'node:path'
import { commitRow, gitIn, launch, makeRepo, seed, subMenu, writeAndCommit, type Harness } from './harness'

let h: Harness
const repo = join(seed, 'web')

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => {
  h = await launch('web', {
    open: [repo],
    setup: (env) => {
      makeRepo(env, 'web', [['Pushed work', { 'a.txt': 'a\n' }]])
      // A remote that's never fetched: its URL and remote-tracking branches are all the app looks at.
      gitIn(env, repo, 'remote', 'add', 'origin', 'https://github.com/acme/widgets.git')
      gitIn(env, repo, 'update-ref', 'refs/remotes/origin/main', 'HEAD')
      gitIn(env, repo, 'branch', '-q', '-u', 'origin/main', 'main')
      gitIn(env, repo, 'branch', '-q', 'feature/login')
      gitIn(env, repo, 'update-ref', 'refs/remotes/origin/feature/login', 'HEAD')
      gitIn(env, repo, 'branch', '-q', '-u', 'origin/feature/login', 'feature/login')
      gitIn(env, repo, 'branch', '-q', 'only-here')
      writeAndCommit(env, repo, 'Not pushed yet', { 'b.txt': 'b\n' })
    }
  })
  await h.page.getByRole('tab', { name: 'web', exact: true }).click()
  // A stand-in for the browser: notes each page instead of opening it.
  await h.electronApp.evaluate(({ shell }) => {
    const g = globalThis as unknown as { opened: string[] }
    g.opened = []
    shell.openExternal = (async (url: string) => void g.opened.push(url)) as typeof shell.openExternal
  })
})
test.afterAll(async () => {
  await h.close()
})
test.afterEach(() => h.expectClean())

const opened = () => h.electronApp.evaluate(() => (globalThis as unknown as { opened: string[] }).opened.at(-1))
const clipboard = () => h.electronApp.evaluate(({ clipboard }) => clipboard.readText())
const toasts = () => h.page.getByRole('region', { name: /Notifications/ })
const local = (name: string) => h.page.getByRole('tree', { name: 'Local branches' }).getByRole('treeitem', { name: new RegExp(`^${name}`) })
const openRepoIn = async (what: string): Promise<void> => {
  await h.page.getByRole('button', { name: 'Open the repository in…' }).click()
  await h.page.getByRole('menuitem', { name: what }).click()
}

test('F67-H1: a branch opens on GitHub by its upstream, and gets a new pull request', async () => {
  await subMenu(h.page, local('feature/login'), 'On the web', 'Open the branch in the browser')
  await expect.poll(opened).toBe('https://github.com/acme/widgets/tree/feature/login')
  await subMenu(h.page, local('feature/login'), 'On the web', 'Create a pull request')
  await expect.poll(opened).toBe('https://github.com/acme/widgets/compare/feature/login?expand=1')
  await subMenu(h.page, local('feature/login'), 'On the web', 'Copy link')
  await expect(toasts().getByText('Link copied')).toBeVisible()
  expect(await clipboard()).toBe('https://github.com/acme/widgets/tree/feature/login')
})

test('F67-H2: a branch that isn’t on a remote has no web entry', async () => {
  await local('only-here').click({ button: 'right' })
  await expect(h.page.getByRole('menuitem', { name: 'On the web' })).toHaveCount(0)
  await h.page.keyboard.press('Escape')
})

test('F67-H3: a pushed commit opens on the host; one that isn’t pushed says so', async () => {
  const sha = h.git(repo, 'rev-parse', 'HEAD~1')
  await subMenu(h.page, commitRow(h.page, 'Pushed work'), 'On the web', 'Open the commit in the browser')
  await expect.poll(opened).toBe(`https://github.com/acme/widgets/commit/${sha}`)
  await subMenu(h.page, commitRow(h.page, 'Not pushed yet'), 'On the web', 'Open the commit in the browser')
  await expect(toasts().getByText(/isn’t on origin yet, so it has no page there/)).toBeVisible()
})

test('F67-H4: the repository opens from the toolbar; the palette starts a pull request for the current branch', async () => {
  await openRepoIn('Browser')
  await expect.poll(opened).toBe('https://github.com/acme/widgets')
  await h.page.keyboard.press('Control+p')
  await h.page.keyboard.type('Create a pull request for main')
  await h.page.keyboard.press('Enter')
  await expect.poll(opened).toBe('https://github.com/acme/widgets/compare/main?expand=1')
})

test('F67-H5: a server whose name doesn’t say is refused, until caboose.hosting names it', async () => {
  h.git(repo, 'remote', 'set-url', 'origin', 'git@code.example.com:team/app.git')
  await openRepoIn('Browser')
  await expect(toasts().getByText(/set the git config caboose\.hosting/)).toBeVisible()
  h.git(repo, 'config', 'caboose.hosting', 'gitlab')
  await subMenu(h.page, local('feature/login'), 'On the web', 'Create a pull request')
  await expect.poll(opened).toBe('https://code.example.com/team/app/-/merge_requests/new?merge_request%5Bsource_branch%5D=feature%2Flogin')
})

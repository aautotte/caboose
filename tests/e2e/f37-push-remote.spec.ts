// F37: with several remotes, the Push button's arrow pushes the current branch to the one you pick.
import { test, expect } from '@playwright/test'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { axe, dialog, gitIn, launch, makeRepo, seed, writeAndCommit, type Harness } from './harness'

let h: Harness
let repo = ''
let single = ''
const origin = join(seed, 'twoway-origin.git')
const fork = join(seed, 'twoway-fork.git')
const forkClone = join(seed, 'twoway-fork-clone')

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => {
  h = await launch('push-remote', {
    open: [join(seed, 'twoway'), join(seed, 'oneway')],
    setup: (env) => {
      for (const d of [origin, fork, forkClone]) rmSync(d, { recursive: true, force: true })
      repo = makeRepo(env, 'twoway', [['Start', { 'a.txt': 'a\n' }]])
      const g = (...a: string[]): string => gitIn(env, repo, ...a)
      g('init', '-q', '--bare', '-b', 'main', origin)
      g('init', '-q', '--bare', '-b', 'main', fork)
      g('remote', 'add', 'origin', origin)
      g('remote', 'add', 'fork', fork)
      g('push', '-q', '-u', 'origin', 'main')
      g('push', '-q', 'fork', 'main')
      g('fetch', '-q', '--all')
      g('branch', 'solo')
      single = makeRepo(env, 'oneway', [['Only', { 'o.txt': 'o\n' }]])
      gitIn(env, single, 'remote', 'add', 'origin', origin)
    }
  })
  await h.page.getByRole('tab', { name: 'twoway' }).click()
})
test.afterAll(async () => {
  await h.close()
})
test.afterEach(() => h.expectClean())

const toolbar = () => h.page.getByRole('toolbar', { name: 'Repository actions' })
const arrow = () => toolbar().getByRole('button', { name: 'Push to another remote' })
const toasts = () => h.page.getByRole('region', { name: /Notifications/ })
const remoteHead = (bare: string, branch = 'main'): string => h.git(bare, 'rev-parse', '--verify', '-q', branch)
const head = (): string => h.git(repo, 'rev-parse', 'HEAD')
async function pushTo(remote: string): Promise<void> {
  await arrow().click()
  await h.page.getByRole('menuitem', { name: new RegExp(`^${remote}`) }).click()
}

test('F37-H1: the arrow is there with two remotes, and says which one the branch tracks', async () => {
  await expect(arrow()).toBeVisible()
  await arrow().click()
  const menu = h.page.getByRole('menu')
  await expect(menu.getByText('Push main to')).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'origin tracked' })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'fork', exact: true })).toBeVisible()
  await h.page.keyboard.press('Escape')
  // Scanned with the menu closed: an open menu hides the rest of the page from screen readers, on purpose.
  expect(await axe(h.page)).toEqual([])
})

test('F37-H2: pushing to the other remote updates it, and leaves origin and the tracking alone', async () => {
  writeAndCommit(h.env, repo, 'Only for the fork', { 'b.txt': 'b\n' })
  const before = remoteHead(origin)
  await pushTo('fork')
  await expect(toasts().getByText('Pushed main to fork', { exact: true })).toBeVisible()
  expect(remoteHead(fork)).toBe(head())
  expect(remoteHead(origin)).toBe(before)
  expect(h.git(repo, 'rev-parse', '--abbrev-ref', 'main@{upstream}')).toBe('origin/main')
})

test('F37-H3: a branch that tracks nothing starts tracking the remote you push it to', async () => {
  h.git(repo, 'switch', '-q', 'solo')
  await expect(toolbar().getByRole('heading', { level: 1 }).locator('..')).toContainText('solo')
  await pushTo('fork')
  await expect(toasts().getByText('Pushed solo to fork', { exact: true })).toBeVisible()
  await expect(dialog(h.page)).toHaveCount(0)
  expect(remoteHead(fork, 'solo')).toBe(head())
  expect(h.git(repo, 'rev-parse', '--abbrev-ref', 'solo@{upstream}')).toBe('fork/solo')
  h.git(repo, 'switch', '-q', 'main')
  await expect(toolbar().getByRole('heading', { level: 1 }).locator('..')).toContainText('main')
})

test('F37-N1: a rejected push to the other remote offers a force push to that same remote', async () => {
  // Someone else pushes to the fork.
  gitIn(h.env, seed, 'clone', '-q', fork, forkClone)
  writeAndCommit(h.env, forkClone, 'Fork-only work', { 'f.txt': 'f\n' })
  gitIn(h.env, forkClone, 'push', '-q', 'origin', 'main')
  writeAndCommit(h.env, repo, 'Mine', { 'm.txt': 'm\n' })
  const originBefore = remoteHead(origin)

  await pushTo('fork')
  await expect(dialog(h.page).getByRole('heading', { name: 'Push was rejected' })).toBeVisible()
  await dialog(h.page).getByRole('button', { name: 'Cancel' }).click()
  expect(remoteHead(fork)).not.toBe(head())

  // Seen after a fetch, so the lease lets the force push through, to the fork and nowhere else.
  await h.page.keyboard.press('Control+l')
  await expect(toasts().getByText('Fetched all remotes', { exact: true })).toBeVisible()
  await pushTo('fork')
  await dialog(h.page).getByRole('button', { name: 'Force push' }).click()
  await expect(toasts().getByText('Force pushed main to fork', { exact: true })).toBeVisible()
  expect(remoteHead(fork)).toBe(head())
  expect(remoteHead(origin)).toBe(originBefore)
})

test('F37-E1: with a single remote there is no arrow, just Push', async () => {
  await h.page.getByRole('tab', { name: 'oneway' }).click()
  await expect(toolbar().getByRole('button', { name: 'Push', exact: true })).toBeVisible()
  await expect(arrow()).toHaveCount(0)
})

// F38: tags, from their right-click menu (branches panel and graph) and from the New tag dialog.
const tagRow = (name: string) => h.page.getByRole('tree', { name: 'Tags' }).getByRole('treeitem', { name })
const tagOn = (bare: string, name: string): string => h.git(bare, 'tag', '-l', name)
async function tagMenuPick(name: string, sub: string, item: string): Promise<void> {
  await tagRow(name).click({ button: 'right' })
  await h.page.getByRole('menuitem', { name: sub }).click()
  await h.page.getByRole('menu').last().getByRole('menuitem', { name: item, exact: true }).click()
}

test('F38-H1: push a tag to the remote you pick', async () => {
  await h.page.getByRole('tab', { name: 'twoway' }).click()
  h.git(repo, 'tag', 'v1.0')
  await expect(tagRow('v1.0')).toBeVisible()
  await tagMenuPick('v1.0', 'Push tag to', 'fork')
  await expect(toasts().getByText('Pushed tag v1.0 to fork', { exact: true })).toBeVisible()
  expect(tagOn(fork, 'v1.0')).toBe('v1.0')
  expect(tagOn(origin, 'v1.0')).toBe('')
})

test('F38-H2: or to all of them', async () => {
  h.git(repo, 'tag', 'v2.0')
  await expect(tagRow('v2.0')).toBeVisible()
  await tagMenuPick('v2.0', 'Push tag to', 'All remotes')
  // Listed in the same order as the menu.
  await expect(toasts().getByText(/^Pushed tag v2\.0 to (origin, fork|fork, origin)$/)).toBeVisible()
  expect(tagOn(fork, 'v2.0')).toBe('v2.0')
  expect(tagOn(origin, 'v2.0')).toBe('v2.0')
})

test('F38-H3: delete a tag from one remote only', async () => {
  await tagMenuPick('v2.0', 'Delete from a remote', 'fork')
  await dialog(h.page).getByRole('button', { name: 'Delete from fork' }).click()
  await expect.poll(() => tagOn(fork, 'v2.0')).toBe('')
  expect(tagOn(origin, 'v2.0')).toBe('v2.0')
  expect(h.git(repo, 'tag', '-l', 'v2.0')).toBe('v2.0')
})

test('F38-H4: a tag on a commit has the same menu in the graph', async () => {
  const row = h.page.getByRole('grid', { name: 'Commit history' }).getByRole('row', { name: /v1\.0/ }).first()
  await row.click({ button: 'right' })
  await h.page.getByRole('menuitem', { name: 'v1.0' }).click()
  await h.page.getByRole('menuitem', { name: 'Push tag to' }).click()
  // Two submenus deep: in a small window the last one can open over its parent, so pick from the keyboard.
  await h.page.getByRole('menu').last().getByRole('menuitem', { name: 'origin', exact: true }).press('Enter')
  await expect(toasts().getByText('Pushed tag v1.0 to origin', { exact: true })).toBeVisible()
  expect(tagOn(origin, 'v1.0')).toBe('v1.0')
})

test('F38-H5: the New tag dialog pushes to the remote chosen there', async () => {
  const row = h.page.getByRole('grid', { name: 'Commit history' }).getByRole('row', { name: /^Mine/ }).first()
  await row.click({ button: 'right' })
  await h.page.getByRole('menuitem', { name: 'Create tag here…' }).click()
  await dialog(h.page).getByLabel('Tag name').fill('v3.0')
  await dialog(h.page).getByRole('checkbox', { name: 'Push it to' }).click()
  await dialog(h.page).getByRole('combobox', { name: 'Remote to push the tag to' }).click()
  await h.page.getByRole('option', { name: 'fork' }).click()
  await dialog(h.page).getByRole('button', { name: 'Create tag' }).click()
  await expect.poll(() => tagOn(fork, 'v3.0')).toBe('v3.0')
  expect(tagOn(origin, 'v3.0')).toBe('')
})

test('F38-E1: with a single remote, Push tag pushes straight to it', async () => {
  await h.page.getByRole('tab', { name: 'oneway' }).click()
  h.git(single, 'tag', 'only-1')
  await expect(tagRow('only-1')).toBeVisible()
  await tagRow('only-1').click({ button: 'right' })
  await expect(h.page.getByRole('menuitem', { name: 'Push tag to' })).toHaveCount(0)
  await h.page.getByRole('menuitem', { name: 'Push tag', exact: true }).click()
  await expect(toasts().getByText('Pushed tag only-1 to origin', { exact: true })).toBeVisible()
  expect(tagOn(origin, 'only-1')).toBe('only-1')
})

// F39: a local branch's right-click menu, in the branches panel and in the graph.
const localRow = (name: string) => h.page.getByRole('tree', { name: 'Local branches' }).getByRole('treeitem', { name: new RegExp(`^${name}(,|$)`) })
async function pushFromPanel(branch: string, remote: string): Promise<void> {
  await localRow(branch).click({ button: 'right' })
  await h.page.getByRole('menuitem', { name: 'Push to' }).click()
  await h.page.getByRole('menu').last().getByRole('menuitem', { name: new RegExp(`^${remote}( [(]tracked[)])?$`) }).click()
}

test('F39-H1: the current branch’s menu lists the remotes, marks the tracked one, and pushes to the one picked', async () => {
  await h.page.getByRole('tab', { name: 'twoway' }).click()
  writeAndCommit(h.env, repo, 'From the branch menu', { 'p.txt': 'p\n' })
  await localRow('main').click({ button: 'right' })
  await h.page.getByRole('menuitem', { name: 'Push to' }).click()
  const sub = h.page.getByRole('menu').last()
  await expect(sub.getByRole('menuitem', { name: 'origin (tracked)' })).toBeVisible()
  await expect(sub.getByRole('menuitem', { name: 'fork', exact: true })).toBeVisible()
  await sub.getByRole('menuitem', { name: 'fork', exact: true }).click()
  await expect(toasts().getByText('Pushed main to fork', { exact: true })).toBeVisible()
  expect(remoteHead(fork)).toBe(head())
  expect(h.git(repo, 'rev-parse', '--abbrev-ref', 'main@{upstream}')).toBe('origin/main')
})

test('F39-H2: a branch that isn’t checked out can be pushed too, keeping its own tracking', async () => {
  h.git(repo, 'branch', '-f', 'solo', 'main')
  await expect(localRow('solo')).toBeVisible()
  await pushFromPanel('solo', 'origin')
  await expect(toasts().getByText('Pushed solo to origin', { exact: true })).toBeVisible()
  expect(remoteHead(origin, 'solo')).toBe(head())
  expect(h.git(repo, 'rev-parse', '--abbrev-ref', 'solo@{upstream}')).toBe('fork/solo')
  expect(h.git(repo, 'branch', '--show-current')).toBe('main')
})

test('F39-H3: the same from a branch on a commit in the graph', async () => {
  writeAndCommit(h.env, repo, 'Graph push', { 'g.txt': 'g\n' })
  h.git(repo, 'branch', '-f', 'solo', 'main')
  const row = h.page.getByRole('grid', { name: 'Commit history' }).getByRole('row', { name: /^Graph push/ }).first()
  await row.click({ button: 'right' })
  await h.page.getByRole('menuitem', { name: 'solo', exact: true }).click()
  await h.page.getByRole('menuitem', { name: 'Push to' }).click()
  // Two submenus deep, as in F38-H4.
  await h.page.getByRole('menu').last().getByRole('menuitem', { name: /^fork/ }).press('Enter')
  await expect(toasts().getByText('Pushed solo to fork', { exact: true })).toBeVisible()
  expect(remoteHead(fork, 'solo')).toBe(head())
})

test('F39-E1: with one remote, the branch menu has a plain Push; a branch that tracks nothing asks where to publish', async () => {
  await h.page.getByRole('tab', { name: 'oneway' }).click()
  await localRow('main').click({ button: 'right' })
  await expect(h.page.getByRole('menuitem', { name: 'Push to' })).toHaveCount(0)
  await h.page.getByRole('menuitem', { name: 'Push', exact: true }).click()
  await expect(dialog(h.page).getByRole('heading', { name: 'Publish main' })).toBeVisible()
  await dialog(h.page).getByRole('button', { name: 'Cancel' }).click()
})

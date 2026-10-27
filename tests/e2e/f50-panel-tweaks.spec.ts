// F50: small fixes from users. The graph stays where you scrolled when rows move under the selection (a rebase);
// New branch starts in its name field from any menu; with one remote, the panel shows only its branches.
import { test, expect } from '@playwright/test'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { dialog, gitIn, launch, makeRepo, seed, type Harness } from './harness'

let h: Harness
const origin = join(seed, 'tweaks-origin.git')
const repo = join(seed, 'tweaks')

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => {
  h = await launch('tweaks', {
    open: [repo],
    setup: (env) => {
      for (const d of [origin, repo]) rmSync(d, { recursive: true, force: true })
      const src = makeRepo(env, 'tweaks-src', [['Start', { 'README.md': 'hi\n' }]])
      // A long history, with a branch far down it.
      for (let i = 1; i <= 150; i++) {
        gitIn(env, src, 'commit', '-q', '--allow-empty', '-m', `Step ${i}`)
        if (i === 5) gitIn(env, src, 'branch', 'old')
      }
      gitIn(env, seed, 'clone', '-q', '--bare', src, origin)
      gitIn(env, seed, 'clone', '-q', origin, repo)
      gitIn(env, repo, 'branch', '-q', '--track', 'old', 'origin/old')
      gitIn(env, repo, 'switch', '-q', '-c', 'feature')
      gitIn(env, repo, 'commit', '-q', '--allow-empty', '-m', 'Feature work')
      gitIn(env, repo, 'switch', '-q', 'main')
      gitIn(env, repo, 'commit', '-q', '--allow-empty', '-m', 'Main moves on')
      gitIn(env, repo, 'switch', '-q', 'feature')
    }
  })
  await h.page.getByRole('tab', { name: 'tweaks', exact: true }).click()
})
test.afterAll(async () => {
  await h.close()
})
test.afterEach(() => h.expectClean())

const local = (name: string) => h.page.getByRole('tree', { name: 'Local branches' }).getByRole('treeitem', { name: new RegExp(`^${name}(,|$)`) })
/** How far the commit list is scrolled. */
const scrolled = (): Promise<number> =>
  h.page.evaluate(() => {
    let e: HTMLElement | null = document.querySelector('[role=grid]')
    while (e && e.scrollHeight <= e.clientHeight) e = e.parentElement
    return e?.scrollTop ?? -1
  })

test('F50-H1: after selecting a branch far down, scrolling up and rebasing, the graph stays where it was', async () => {
  await local('old').click()
  await expect.poll(scrolled).toBeGreaterThan(1000)
  await h.page.evaluate(() => {
    let e: HTMLElement | null = document.querySelector('[role=grid]')
    while (e && e.scrollHeight <= e.clientHeight) e = e.parentElement
    if (e) e.scrollTop = 0
  })
  await expect.poll(scrolled).toBe(0)
  await local('main').click({ button: 'right' })
  await h.page.getByRole('menuitem', { name: 'Rebase feature onto main', exact: true }).click()
  await expect.poll(h.gitOr(repo, 'rev-parse', 'feature~1')).toBe(h.git(repo, 'rev-parse', 'main'))
  await expect(h.page.getByRole('row', { name: /^Feature work/ })).toBeVisible()
  await h.page.waitForTimeout(500)
  expect(await scrolled()).toBeLessThan(200)
  // What pulled the view back: rows appearing above the selection, which moves its position in the list (a rebase
  // does that on its way, as the app refreshes on each step). A commit from a terminal does it for sure.
  h.git(repo, 'commit', '-q', '--allow-empty', '-m', 'From a terminal')
  await expect(h.page.getByRole('row', { name: /^From a terminal/ })).toBeVisible()
  await h.page.waitForTimeout(500)
  expect(await scrolled()).toBeLessThan(200)
})

test('F50-H2: New branch from a menu starts in the name field', async () => {
  await local('main').click({ button: 'right' })
  await h.page.getByRole('menuitem', { name: 'New branch from here…' }).click()
  await expect(dialog(h.page).getByLabel('Branch name')).toBeFocused()
  await h.page.keyboard.type('typed-right-away')
  await expect(dialog(h.page).getByLabel('Branch name')).toHaveValue('typed-right-away')
  await dialog(h.page).getByRole('button', { name: 'Cancel' }).click()
})

test('F50-H3: with one remote, the panel lists its branches without a row for it; a second remote brings the rows back', async () => {
  const remotes = h.page.getByRole('tree', { name: 'Remotes' })
  await expect(remotes.getByRole('treeitem', { name: 'origin', exact: true })).toHaveCount(0)
  await expect(remotes.getByRole('treeitem', { name: 'old', exact: true })).toHaveAttribute('aria-level', '1')
  await expect(h.page.getByRole('button', { name: /^Remotes/ })).toContainText('2') // main, old (origin/HEAD isn’t listed)
  await h.page.getByRole('button', { name: /^Remotes/ }).click({ button: 'right' })
  await expect(h.page.getByRole('menuitem', { name: 'Fetch all remotes' })).toBeVisible()
  await expect(h.page.getByRole('menuitem', { name: 'Remove origin…' })).toBeVisible()
  await h.page.keyboard.press('Escape')

  h.git(repo, 'remote', 'add', 'mirror', origin)
  h.git(repo, 'fetch', '-q', 'mirror')
  await expect(remotes.getByRole('treeitem', { name: 'origin', exact: true })).toBeVisible()
  await expect(remotes.getByRole('treeitem', { name: 'mirror', exact: true })).toBeVisible()
  await expect(h.page.getByRole('group', { name: 'origin' }).getByRole('treeitem', { name: 'old', exact: true })).toHaveAttribute('aria-level', '2')
  h.git(repo, 'remote', 'remove', 'mirror')
})

// F53: fold everything in the branches panel at once: every folder (local and remote, nested too, and each remote's
// row), or every section. From the button next to the filter, or a section header's menu. Coming back to a tab finds
// the panel folded and scrolled as it was left.
import { test, expect } from '@playwright/test'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { gitIn, launch, makeRepo, seed, type Harness } from './harness'

let h: Harness
const origin = join(seed, 'fold-origin.git')
const mirror = join(seed, 'fold-mirror.git')
const repo = join(seed, 'fold')
const other = join(seed, 'fold-other')

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => {
  h = await launch('fold', {
    open: [repo, other],
    setup: (env) => {
      for (const d of [origin, mirror, repo]) rmSync(d, { recursive: true, force: true })
      const src = makeRepo(env, 'fold-src', [['Start', { 'README.md': 'hi\n' }]])
      for (const b of ['feature/a', 'feature/b', 'fix/x', 'deep/a/b']) gitIn(env, src, 'branch', b)
      // Enough branches that the panel scrolls.
      for (let i = 0; i < 60; i++) gitIn(env, src, 'branch', `zz/b${i}`)
      gitIn(env, seed, 'clone', '-q', '--bare', src, origin)
      gitIn(env, seed, 'clone', '-q', '--bare', src, mirror)
      gitIn(env, seed, 'clone', '-q', origin, repo)
      for (const b of ['feature/a', 'feature/b', 'fix/x', 'deep/a/b']) gitIn(env, repo, 'branch', '-q', '--track', b, `origin/${b}`)
      gitIn(env, repo, 'remote', 'add', 'mirror', mirror)
      gitIn(env, repo, 'fetch', '-q', 'mirror')
      makeRepo(env, 'fold-other', [['Other', { 'o.txt': 'o\n' }]])
    }
  })
  await h.page.getByRole('tab', { name: 'fold', exact: true }).click()
})
test.afterAll(async () => {
  await h.close()
})
test.afterEach(() => h.expectClean())

const tree = (name: string) => h.page.getByRole('tree', { name })
const folder = (section: string, name: string) => tree(section).getByRole('treeitem', { name: `${name} folder` }).first()
const fold = async (item: string): Promise<void> => {
  await h.page.getByRole('button', { name: 'Collapse or expand' }).click()
  await h.page.getByRole('menuitem', { name: item }).click()
}

test('F53-H1: Collapse all folders folds every local and remote folder, nested ones and the remotes too; Expand all brings them back', async () => {
  await expect(folder('Local branches', 'deep')).toHaveAttribute('aria-expanded', 'true')
  await fold('Collapse all folders')
  for (const f of ['feature', 'fix', 'deep']) await expect(folder('Local branches', f)).toHaveAttribute('aria-expanded', 'false')
  for (const r of ['origin', 'mirror']) await expect(tree('Remotes').getByRole('treeitem', { name: r, exact: true })).toHaveAttribute('aria-expanded', 'false')
  await expect(tree('Local branches').getByRole('treeitem', { name: /^feature\/a/ })).toHaveCount(0)
  await expect(tree('Local branches').getByRole('treeitem', { name: /^main/ })).toBeVisible()

  // Opening the outer folder by hand shows its inner one folded too.
  await folder('Local branches', 'deep').click()
  await expect(folder('Local branches', 'a')).toHaveAttribute('aria-expanded', 'false')

  await fold('Expand all folders')
  await expect(tree('Local branches').getByRole('treeitem', { name: /^deep\/a\/b/ })).toBeVisible()
  await expect(h.page.getByRole('group', { name: 'mirror' }).getByRole('treeitem', { name: 'feature/a', exact: true })).toBeVisible()
})

test('F53-H2: Collapse all sections folds every section; a section header’s menu expands them again', async () => {
  await fold('Collapse all sections')
  for (const s of ['Local branches', 'Remotes', 'Tags', 'Stashes']) {
    await expect(h.page.getByRole('button', { name: new RegExp(`^${s}`) })).toHaveAttribute('aria-expanded', 'false')
    await expect(tree(s)).toHaveCount(0)
  }
  await h.page.getByRole('button', { name: /^Remotes/ }).click({ button: 'right' })
  await h.page.getByRole('menuitem', { name: 'Expand all sections' }).click()
  await expect(tree('Local branches')).toBeVisible()
  await expect(tree('Remotes')).toBeVisible()
})

const tab = (name: string) => h.page.getByRole('tab', { name, exact: true })
const scroller = (): Promise<number> =>
  h.page.evaluate(() => {
    let e: HTMLElement | null = document.querySelector('[role=tree][aria-label="Local branches"]')
    while (e && e.scrollHeight <= e.clientHeight) e = e.parentElement
    return e?.scrollTop ?? -1
  })

test('F53-H3: switching to another tab and back keeps the folded sections and folders', async () => {
  await fold('Collapse all folders')
  await h.page.getByRole('button', { name: /^Tags/ }).click()
  await h.page.getByRole('button', { name: /^Stashes/ }).click()
  await expect(h.page.getByRole('button', { name: /^Tags/ })).toHaveAttribute('aria-expanded', 'false')
  await tab('fold-other').click()
  await expect(tree('Local branches').getByRole('treeitem', { name: /^main/ })).toBeVisible()
  await tab('fold').click()
  await expect(h.page.getByRole('button', { name: /^Tags/ })).toHaveAttribute('aria-expanded', 'false')
  await expect(h.page.getByRole('button', { name: /^Stashes/ })).toHaveAttribute('aria-expanded', 'false')
  await expect(h.page.getByRole('button', { name: /^Local branches/ })).toHaveAttribute('aria-expanded', 'true')
  for (const f of ['feature', 'fix', 'deep']) await expect(folder('Local branches', f)).toHaveAttribute('aria-expanded', 'false')
})

test('F53-H4: and where the panel was scrolled to', async () => {
  await fold('Expand all folders')
  await expect(h.page.getByRole('group', { name: 'origin' }).getByRole('treeitem', { name: 'zz/b59', exact: true })).toBeAttached()
  await h.page.evaluate(() => {
    let e: HTMLElement | null = document.querySelector('[role=tree][aria-label="Local branches"]')
    while (e && e.scrollHeight <= e.clientHeight) e = e.parentElement
    if (e) e.scrollTop = 600
  })
  await expect.poll(scroller).toBe(600)
  await tab('fold-other').click()
  await expect(tree('Local branches').getByRole('treeitem', { name: /^main/ })).toBeVisible()
  await tab('fold').click()
  await expect(h.page.getByRole('group', { name: 'origin' }).getByRole('treeitem', { name: 'zz/b59', exact: true })).toBeAttached()
  await expect.poll(scroller).toBe(600)
})

// F30: hidden branches leave the graph completely, even when a remote's HEAD alias or a tag points into them, and
// their labels go with them.
import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { gitIn, grid, launch, makeRepo, seed, writeAndCommit, type Harness } from './harness'

let h: Harness
let repo = ''
const bare = join(seed, 'hiding-origin.git')

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => {
  h = await launch('hidden-graph', {
    open: [join(seed, 'hiding')],
    setup: (env) => {
      rmSync(bare, { recursive: true, force: true })
      repo = makeRepo(env, 'hiding', [['Start', { 'a.txt': 'a\n' }]])
      const g = (...a: string[]): string => gitIn(env, repo, ...a)
      g('switch', '-q', '-c', 'feat')
      writeAndCommit(env, repo, 'Only on feat', { 'f.txt': 'f\n' })
      g('tag', 'v-feat')
      g('switch', '-q', 'main')
      g('switch', '-q', '-c', 'other')
      writeAndCommit(env, repo, 'Only on other', { 'o.txt': 'o\n' })
      g('switch', '-q', 'main')
      // origin/HEAD is an alias for origin/feat, as a clone of a repo whose default branch is feat would have.
      g('init', '-q', '--bare', '-b', 'main', bare)
      g('remote', 'add', 'origin', bare)
      g('push', '-q', 'origin', 'main', 'feat')
      g('fetch', '-q', 'origin')
      g('remote', 'set-head', 'origin', 'feat')
    }
  })
  await h.page.getByRole('tab', { name: 'hiding' }).click()
  await grid(h.page).getByRole('row', { name: /^Only on feat/ }).waitFor()
})
test.afterAll(async () => {
  await h.close()
})
test.afterEach(() => h.expectClean())

const row = (summary: string) => grid(h.page).getByRole('row', { name: new RegExp(`^${summary}`) })
const tree = (name: string) => h.page.getByRole('tree', { name })

test('F30-E2: a hidden branch’s commits leave the graph, even with origin/HEAD and a tag pointing at them', async () => {
  await tree('Local branches').getByRole('treeitem', { name: 'feat' }).getByRole('button', { name: 'Hide feat' }).click()
  await tree('Remotes').getByRole('treeitem', { name: 'origin', exact: true }).getByRole('button', { name: 'Hide origin' }).click()
  await expect(row('Only on feat')).toHaveCount(0)
  await expect(row('Only on other')).toHaveCount(1)
  await expect(row('Start')).toHaveCount(1)
})

test('F30-E3: hidden refs lose their labels on commits that are still shown', async () => {
  // main is still shown; origin/main sits on the same commit and is hidden, so the label is just main.
  await expect(row('Start')).toHaveAccessibleName(/on main$/)
  await expect(row('Start')).not.toHaveAccessibleName(/origin/)
})

test('F30-E4: Show all brings everything back, labels included', async () => {
  await h.page.getByRole('button', { name: 'Show all', exact: true }).click()
  await expect(row('Only on feat')).toHaveCount(1)
  await expect(row('Only on feat')).toHaveAccessibleName(/feat/)
  await expect(row('Only on feat')).toHaveAccessibleName(/v-feat/)
})

test('F30-H6: hide one tag: its label leaves the graph, the commit stays (its branch is shown)', async () => {
  const tag = tree('Tags').getByRole('treeitem', { name: 'v-feat' })
  await tag.getByRole('button', { name: 'Hide v-feat' }).click()
  await expect(row('Only on feat')).toHaveCount(1)
  await expect(row('Only on feat')).not.toHaveAccessibleName(/v-feat/)
  await expect(h.page.getByRole('status').filter({ hasText: '1 hidden from the graph' })).toBeVisible()
  // From the tag's menu as well, and back.
  await tag.click({ button: 'right' })
  await h.page.getByRole('menuitem', { name: 'Show tag in the graph' }).click()
  await expect(row('Only on feat')).toHaveAccessibleName(/v-feat/)
})

test('F30-H7: hide all tags from the Tags section, then show them again', async () => {
  h.git(repo, 'tag', 'v-start', 'main')
  await expect(tree('Tags').getByRole('treeitem', { name: 'v-start' })).toBeVisible()
  await h.page.getByRole('button', { name: 'Hide all tags' }).click()
  await expect(row('Start')).not.toHaveAccessibleName(/v-start/)
  await expect(row('Only on feat')).not.toHaveAccessibleName(/v-feat/)
  await h.page.getByRole('button', { name: 'Show all tags' }).click()
  await expect(row('Start')).toHaveAccessibleName(/v-start/)
})

test('F30-E5: with hundreds of long branch names hidden, the shown branches still draw', async () => {
  // A big team repository: 800 remote branches whose names alone pass Windows' command-line limit.
  const feat = h.git(repo, 'rev-parse', 'feat')
  const many = Array.from({ length: 800 }, (_, i) => `refs/remotes/origin/PLATFORM_HYD-${1000 + i}/review-the-driver-and-address-comments`)
  execFileSync('git', ['update-ref', '--stdin'], { cwd: repo, env: h.env, input: many.map((r) => `create ${r} ${feat}`).join('\n') + '\n' })
  await expect(tree('Remotes').getByRole('treeitem', { name: 'PLATFORM_HYD-1799 folder' })).toHaveCount(1)
  // The remote's eye hides all of its branches at once, as on the real repository; then feat, which must leave.
  await tree('Remotes').getByRole('treeitem', { name: 'origin', exact: true }).getByRole('button', { name: 'Hide origin' }).click()
  await tree('Local branches').getByRole('treeitem', { name: 'feat' }).getByRole('button', { name: 'Hide feat' }).click()
  await expect(row('Only on feat')).toHaveCount(0)
  await expect(row('Only on other')).toHaveCount(1)
  await expect(row('Start')).toHaveCount(1)
  // A fresh load (a restart, or reopening the tab) has no earlier graph to fall back on.
  await h.page.reload()
  await h.page.getByRole('tab', { name: 'hiding' }).click()
  await expect(row('Only on other')).toHaveCount(1)
  await expect(row('Only on feat')).toHaveCount(0)
  await h.page.getByRole('button', { name: 'Show all', exact: true }).click()
  await expect(row('Only on feat')).toHaveCount(1)
})

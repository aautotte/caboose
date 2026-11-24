// F92: what refreshing costs. A change is read once however many things notice it (the action that made it, the file
// watcher, the window's focus), and moving through the graph reads only the commit it stops on.
import { test, expect } from '@playwright/test'
import { join } from 'node:path'
import { appState, commitRow, dialog, grid, invoke, launch, makeRepo, repoId, seed, type Harness } from './harness'

let h: Harness
let id = ''
const repo = join(seed, 'refresh-cost')

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => {
  h = await launch('refresh-cost', {
    open: [repo],
    setup: (env) => {
      makeRepo(env, 'refresh-cost', Array.from({ length: 30 }, (_, i): [string, Record<string, string>] => [`Commit ${i}`, { 'a.txt': `${i}\n` }]))
    }
  })
  await h.page.getByRole('tab', { name: 'refresh-cost', exact: true }).click()
  await expect(commitRow(h.page, 'Commit 29')).toBeVisible()
  id = await repoId(h.page, repo)
})
test.afterAll(async () => {
  await h.close()
})
test.afterEach(() => h.expectClean())

const local = (name: RegExp) => h.page.getByRole('tree', { name: 'Local branches' }).getByRole('treeitem', { name })

type Entry = { argv: string[]; startedAt: number }

/** The git commands started since `t`, oldest first, once none has started for a second and a half. */
async function ranSince(t: number): Promise<string[][]> {
  const read = async (): Promise<string[][]> => {
    const r = await invoke<Entry[]>(h.page, 'activity.list', { limit: 1000 })
    if (!r.ok) throw new Error(r.error.message)
    return r.value
      .filter((e) => e.startedAt >= t)
      .reverse()
      .map((e) => e.argv.slice(1))
  }
  let last = -1
  for (;;) {
    await h.page.waitForTimeout(1500)
    const ran = await read()
    if (ran.length === last) return ran
    last = ran.length
  }
}
// Only a full load lists the worktrees; a commit's details start with `show -s`.
const fullLoads = (ran: string[][]): number => ran.filter((a) => a.includes('worktree') && a.includes('list')).length
const detailReads = (ran: string[][]): string[][] => ran.filter((a) => a[0] === 'show' && a[1] === '-s')

test('F92-H1 a branch made in a terminal, then the window focused: one full load', async () => {
  const t = Date.now()
  h.git(repo, 'branch', 'from-terminal')
  await h.page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(local(/^from-terminal/)).toBeVisible()
  expect(fullLoads(await ranSince(t))).toBe(1)
})

test('F92-H2 a branch made here: the watcher doesn’t load again what the action just loaded', async () => {
  const t = Date.now()
  await grid(h.page).focus()
  await h.page.keyboard.press('Control+b')
  await dialog(h.page).getByLabel('Branch name').fill('made-here')
  await dialog(h.page).getByRole('button', { name: 'Create branch' }).click()
  await expect(local(/^made-here/)).toHaveAttribute('aria-current', 'true')
  expect(fullLoads(await ranSince(t))).toBe(1)
})

test('F92-H3 going down the graph with the keyboard reads only the commit it stops on', async () => {
  await commitRow(h.page, 'Commit 29').click()
  await ranSince(Date.now())
  const t = Date.now()
  // Quickly, as a held key sends them: pressed through Playwright one by one, a busy machine can space them out past
  // the wait. Each waits only for the window to take the one before.
  await h.page.evaluate(async () => {
    for (let i = 0; i < 10; i++) {
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
      await new Promise((r) => setTimeout(r, 0))
    }
  })
  await expect(commitRow(h.page, 'Commit 19')).toHaveAttribute('aria-selected', 'true')
  const reads = detailReads(await ranSince(t))
  expect(reads.length, reads.map((a) => a.at(-2)).join(' ')).toBeLessThanOrEqual(2)
  const s = await appState<{ repos: Record<string, { selected: string }> }>(h.page)
  expect(reads.at(-1)).toContain(s.repos[id].selected)
  await expect(h.page.getByRole('status', { name: 'Loading commit' })).toHaveCount(0)
})

test('F92-H4 a commit looked at before shows again without asking git', async () => {
  await commitRow(h.page, 'Commit 5').click()
  await commitRow(h.page, 'Commit 6').click()
  await ranSince(Date.now())
  const t = Date.now()
  await commitRow(h.page, 'Commit 5').click()
  await expect(h.page.getByRole('status', { name: 'Loading commit' })).toHaveCount(0)
  expect(detailReads(await ranSince(t))).toEqual([])
})

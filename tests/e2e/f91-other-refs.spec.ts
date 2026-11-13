// F91: the graph and the search show branches, remote branches, tags and HEAD, as the sidebar does. Other refs, such
// as an AI tool's checkpoints under refs/cline/ or git notes, don't bring their commits in.
import { test, expect } from '@playwright/test'
import { join } from 'node:path'
import { commitRow, gitIn, grid, invoke, launch, makeRepo, repoId, seed, type Harness } from './harness'

let h: Harness
const repo = join(seed, 'other-refs')
let checkpoint = ''

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => {
  h = await launch('other-refs', {
    open: [repo],
    setup: (env) => {
      makeRepo(env, 'other-refs', [
        ['Start', { 'a.txt': 'a\n' }],
        ['Second', { 'a.txt': 'b\n' }]
      ])
      // What Cline does: commits of its own, kept by a ref outside refs/heads.
      const cp = gitIn(env, repo, 'commit-tree', 'HEAD^{tree}', '-p', 'HEAD', '-m', 'Checkpoint one')
      gitIn(env, repo, 'update-ref', 'refs/cline/checkpoints/one', cp)
      checkpoint = gitIn(env, repo, 'commit-tree', 'HEAD^{tree}', '-p', cp, '-m', 'Checkpoint two')
      gitIn(env, repo, 'update-ref', 'refs/cline/checkpoints/two', checkpoint)
      gitIn(env, repo, 'notes', 'add', '-m', 'a note', 'HEAD')
      // A tag on a commit no branch has still shows.
      const tagged = gitIn(env, repo, 'commit-tree', 'HEAD^{tree}', '-p', 'HEAD', '-m', 'Only tagged')
      gitIn(env, repo, 'tag', 'v-side', tagged)
    }
  })
  await h.page.getByRole('tab', { name: 'other-refs', exact: true }).click()
  await expect(commitRow(h.page, 'Second')).toBeVisible()
})
test.afterAll(async () => {
  await h.close()
})
test.afterEach(() => h.expectClean())

const shown = async (): Promise<string[]> =>
  (await grid(h.page).getByRole('row').evaluateAll((rows) => rows.map((r) => r.getAttribute('aria-label') ?? '')))
    .filter((l) => !l.startsWith('Columns'))
    .map((l) => l.split(', by ')[0])

test('F91-H1: commits only another tool’s refs or git notes keep are left out of the graph and the search', async () => {
  await expect(commitRow(h.page, 'Only tagged')).toBeVisible()
  expect(await shown()).toEqual(['Only tagged', 'Second', 'Start'])
  const id = await repoId(h.page, repo)
  const found = await invoke<string[]>(h.page, 'search.commits', { repoId: id, query: 'Checkpoint' })
  expect(found).toEqual({ ok: true, value: [] })
  const tagged = await invoke<string[]>(h.page, 'search.commits', { repoId: id, query: 'Only tagged' })
  expect(tagged.ok && tagged.value.length).toBe(1)
})

test('F91-H2: checking out one of those commits shows it, as HEAD', async () => {
  h.git(repo, 'checkout', '-q', '--detach', checkpoint)
  await h.page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(commitRow(h.page, 'Checkpoint two')).toBeVisible()
  expect(await shown()).toEqual(['Only tagged', 'Checkpoint two', 'Checkpoint one', 'Second', 'Start'])
  h.git(repo, 'checkout', '-q', 'main')
  await h.page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(commitRow(h.page, 'Checkpoint two')).toHaveCount(0)
})

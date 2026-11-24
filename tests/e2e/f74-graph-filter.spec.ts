// F74: filtering the graph. Only the commits that change a path, by an author, or both, in git's order, with lines
// drawn to the nearest commits still shown; filled in from a file's or a commit's menu; no history rewriting while on.
import { test, expect } from '@playwright/test'
import { join } from 'node:path'
import { commitRow, gitIn, grid, invoke, launch, makeRepo, menu, repoId, seed, writeAndCommit, type Harness } from './harness'
import type { GraphPage } from '../../src/shared/types'

let h: Harness
const repo = join(seed, 'graph-filter')

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => {
  h = await launch('graph-filter', {
    open: [repo],
    setup: (env) => {
      const as = (name: string) => ({ ...env, GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: `${name.toLowerCase()}@example.com` })
      makeRepo(as('Pat'), 'graph-filter', [['Base', { 'a.txt': 'a\n', 'docs/guide.md': 'guide\n' }]])
      writeAndCommit(as('Kim'), repo, 'Code one', { 'src/one.ts': '1\n' })
      writeAndCommit(as('Pat'), repo, 'Docs one', { 'docs/guide.md': 'guide, again\n' })
      gitIn(env, repo, 'checkout', '-q', '-b', 'side')
      writeAndCommit(as('Kim'), repo, 'Side docs', { 'docs/side.md': 'side\n' })
      writeAndCommit(as('Pat'), repo, 'Side code', { 'src/two.ts': '2\n' })
      gitIn(env, repo, 'checkout', '-q', 'main')
      writeAndCommit(env, repo, 'Main code', { 'src/three.ts': '3\n' })
      gitIn(env, repo, 'merge', '-q', '--no-ff', '-m', 'Merge side', 'side')
    }
  })
  await h.page.getByRole('tab', { name: 'graph-filter', exact: true }).click()
  await expect(commitRow(h.page, 'Merge side')).toBeVisible()
})
test.afterAll(async () => {
  await h.close()
})
test.afterEach(() => h.expectClean())

const bar = () => h.page.getByRole('search', { name: 'Filter the graph' })
const pathField = () => bar().getByRole('textbox', { name: 'Path' })
const authorField = () => bar().getByRole('combobox', { name: 'Author' })
// The summaries the graph shows, top to bottom.
const shown = async (): Promise<string> =>
  (await grid(h.page).getByRole('row').evaluateAll((rows) => rows.map((r) => r.getAttribute('aria-label') ?? '')))
    .filter((l) => !l.startsWith('Columns'))
    .map((l) => l.split(', by ')[0])
    .join('\n')
// What git log shows for the same filter.
const gitLog = (...args: string[]): string => h.git(repo, 'log', '--format=%s', '--topo-order', '--all', ...args)
const sha = (summary: string): string => h.git(repo, 'log', '--all', '--format=%H', `--grep=^${summary}$`)

test('F74-H1: a path shows only the commits that change it, as git log does; lines skip the others', async () => {
  await grid(h.page).focus()
  await h.page.keyboard.press('Control+Shift+F')
  await expect(pathField()).toBeFocused()
  await h.page.keyboard.type('docs/')
  await expect.poll(shown).toBe(gitLog('--', 'docs/'))
  expect(await shown()).toBe('Side docs\nDocs one\nBase')
  await expect(bar().getByRole('status')).toHaveText('3 commits')
  // Docs one is drawn straight down to Base; its real parent (Code one) is what menus and the details use.
  const page = await invoke<GraphPage>(h.page, 'graph.load', { repoId: await repoId(h.page, repo), skip: 0, limit: 50, filter: { path: 'docs/' } })
  if (!page.ok) throw new Error(page.error.message)
  const docsOne = page.value.commits.find((c) => c.summary === 'Docs one')!
  expect(docsOne.drawn).toEqual([sha('Base')])
  expect(docsOne.parents).toEqual([sha('Code one')])
})

test('F74-H2: an author, in any case, joins each of their commits to their next one down', async () => {
  await pathField().fill('')
  await authorField().fill('pat')
  await expect.poll(shown).toBe(gitLog('-i', '--author=pat'))
  expect(await shown()).toBe('Side code\nDocs one\nBase')
  const page = await invoke<GraphPage>(h.page, 'graph.load', { repoId: await repoId(h.page, repo), skip: 0, limit: 50, filter: { author: 'pat' } })
  if (!page.ok) throw new Error(page.error.message)
  const drawn = Object.fromEntries(page.value.commits.map((c) => [c.summary, c.drawn]))
  expect(drawn).toEqual({ 'Side code': [sha('Docs one')], 'Docs one': [sha('Base')], Base: [] })
})

test('F74-H3: a path and an author together; nothing matching says so', async () => {
  await pathField().fill('src/')
  await expect.poll(shown).toBe('Side code')
  await expect(bar().getByRole('status')).toHaveText('1 commit')
  await authorField().fill('nobody')
  await expect(h.page.getByText('No commits match')).toBeVisible()
  // Outside the repository nothing changes; "." is all of it.
  await authorField().fill('')
  await pathField().fill('../elsewhere')
  await expect(h.page.getByText('No commits match')).toBeVisible()
  await pathField().fill('.')
  await expect.poll(shown).toBe(gitLog())
  await bar().getByRole('button', { name: 'Clear the filter' }).click()
  await expect(bar()).toHaveCount(0)
  await expect.poll(shown).toBe(gitLog())
})

test('F74-H4: Show only commits by … from a commit; rewriting waits until the filter is cleared', async () => {
  await menu(h.page, commitRow(h.page, 'Code one'), 'Show only commits by Kim')
  await expect(authorField()).toHaveValue('Kim')
  await expect.poll(shown).toBe('Side docs\nCode one')
  await commitRow(h.page, 'Code one').click({ button: 'right' })
  await expect(h.page.getByRole('menuitem', { name: 'Edit message…' })).toHaveCount(0)
  await h.page.getByRole('menuitem', { name: 'Clear the filter to edit commits on main' }).click()
  await expect(bar()).toHaveCount(0)
  await expect.poll(shown).toBe(gitLog())
  await commitRow(h.page, 'Code one').click({ button: 'right' })
  await expect(h.page.getByRole('menuitem', { name: 'Edit message…' })).toBeVisible()
  await h.page.keyboard.press('Escape')
})

test('F74-H5: a changed file’s menu filters by that file; Esc in the bar shows everything again', async () => {
  await commitRow(h.page, 'Docs one').click()
  await menu(h.page, h.page.getByRole('listbox', { name: 'Changed files' }).getByRole('option', { name: /guide\.md/ }), 'Show only commits that change it')
  await expect(pathField()).toHaveValue('docs/guide.md')
  await expect.poll(shown).toBe('Docs one\nBase')
  // The selected commit is still shown and selected; the keys move along the filtered rows.
  await expect(commitRow(h.page, 'Docs one')).toHaveAttribute('aria-selected', 'true')
  await grid(h.page).focus()
  await h.page.keyboard.press('j')
  await expect(commitRow(h.page, 'Base')).toHaveAttribute('aria-selected', 'true')
  await pathField().focus()
  await h.page.keyboard.press('Escape')
  await expect(bar()).toHaveCount(0)
  await expect.poll(shown).toBe(gitLog())
})

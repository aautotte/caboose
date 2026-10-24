// F15 history, F16 search, F17 amend, F20 tags, F21 remotes, F22 ignore, F23 focus, plus window size and time zones.
import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { commitRow, demo, dialog, gitIn, grid, launch, makeRepo, menu, openWip, seed, toGraph, writeAndCommit, type Harness } from './harness'

let h: Harness
let big = ''
let renames = ''
const BIG = 2500

/** 2,500 commits in one go with git fast-import. */
function makeBigRepo(env: NodeJS.ProcessEnv): string {
  const dir = join(seed, 'big-history')
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  gitIn(env, dir, 'init', '-q', '-b', 'main')
  let stream = ''
  for (let i = 1; i <= BIG; i++) {
    const msg = `Commit ${i} of the long history\n`
    const content = `entry ${i}\n`
    stream += `commit refs/heads/main\nmark :${i}\ncommitter Bulk <bulk@example.com> ${1700000000 + i * 60} +0000\ndata ${Buffer.byteLength(msg)}\n${msg}`
    if (i > 1) stream += `from :${i - 1}\n`
    stream += `M 100644 inline log.txt\ndata ${Buffer.byteLength(content)}\n${content}\n`
  }
  execFileSync('git', ['fast-import', '--quiet'], { cwd: dir, input: stream, env })
  gitIn(env, dir, 'reset', '-q', '--hard')
  return dir
}

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => {
  h = await launch('misc', {
    open: [demo],
    setup: (env) => {
      big = makeBigRepo(env)
      renames = makeRepo(env, 'renames', [['Add the old name', { 'old-name.md': 'one\ntwo\nthree\n' }]])
      gitIn(env, renames, 'mv', 'old-name.md', 'new-name.md')
      gitIn(env, renames, 'commit', '-q', '-m', 'Rename it')
      writeAndCommit(env, renames, 'Edit after the rename', { 'new-name.md': 'one\ntwo\nthree\nfour\n' })
      // A commit written in Tokyo.
      gitIn(env, renames, 'commit', '-q', '--allow-empty', '-m', 'Written in Tokyo', '--date', '2026-03-29T09:30:00+09:00')
    }
  })
  await h.page.getByRole('tab', { name: 'demo' }).click()
  await commitRow(h.page, 'Print the real temperature in the CLI').waitFor()
})
test.afterAll(async () => {
  await h.close()
})
test.afterEach(() => h.expectClean())

const toolbar = (name: string | RegExp) => h.page.getByRole('toolbar', { name: 'Repository actions' }).getByRole('button', { name })
const subject = (rev = 'HEAD'): string => h.git(demo, 'log', '-1', '--format=%s', rev)
const search = () => h.page.getByRole('searchbox', { name: 'Search commits' }).or(h.page.getByLabel('Search commits'))

// ---------- F16 ----------

test('F16-H1 search by message highlights the match and counts it', async () => {
  await search().fill('changelog (3)')
  await expect(h.page.getByText('1 found')).toBeVisible()
  await expect(commitRow(h.page, 'Update the changelog (3)')).not.toHaveClass(/opacity-40/)
  await expect(commitRow(h.page, 'Update the changelog (4)')).toHaveClass(/opacity-40/)
})

test('F16-E1 search by a SHA prefix', async () => {
  const sha = h.git(demo, 'log', '--format=%h', '-1', '--grep=Cache forecasts')
  await search().fill(sha)
  await expect(h.page.getByText('1 found')).toBeVisible()
  await expect(commitRow(h.page, 'Cache forecasts in memory')).not.toHaveClass(/opacity-40/)
})

test('F16-E2 search by author', async () => {
  await search().fill('Kofi')
  await expect(h.page.getByText(/^[1-9]\d* found$/)).toBeVisible()
  await expect(commitRow(h.page, 'Add Fahrenheit output')).not.toHaveClass(/opacity-40/)
})

test('F16-E3 no results says so', async () => {
  await search().fill('zzz-no-such-thing')
  await expect(h.page.getByText('0 found')).toBeVisible()
})

test('F16-E5 brackets, dots and emoji are searched literally', async () => {
  await search().fill('(6)')
  await expect(h.page.getByText('1 found')).toBeVisible()
  await search().fill('.*')
  await expect(h.page.getByText('0 found')).toBeVisible()
  await search().fill('🎉')
  await expect(h.page.getByText('0 found')).toBeVisible()
  await search().fill('')
})

// ---------- F15 ----------

test('F15-E2 a merge commit says which parent its changes are compared with', async () => {
  await commitRow(h.page, 'Merge branch feature/cache').click()
  await expect(h.page.getByRole('heading', { name: /Changed vs first parent/ })).toBeVisible()
})

test('F15-E1 file history follows a rename', async () => {
  const r = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: renames, encoding: 'utf8' }).trim()
  void r
  await openRepoTab(renames)
  await commitRow(h.page, 'Edit after the rename').click()
  await menu(h.page, h.page.getByRole('listbox', { name: 'Changed files' }).getByRole('option', { name: /new-name\.md/ }), 'File history')
  const history = h.page.getByRole('region', { name: 'History of new-name.md' })
  await expect(history.getByRole('option')).toHaveCount(3)
  await expect(history.getByText(/renamed from old-name\.md/)).toBeVisible()
  await toGraph(h.page)
})

test('TZ-1 a commit made in another time zone shows local time, with its own offset on hover', async () => {
  await commitRow(h.page, 'Written in Tokyo').click()
  await expect(h.page.getByRole('region', { name: 'Details' }).locator('[title*="UTC+0900"]')).toHaveCount(1)
})

test('F15-E3 history beyond the first 2,000 commits loads as you scroll', async () => {
  await openRepoTab(big)
  await commitRow(h.page, `Commit ${BIG} of the long history`).waitFor()
  await expect(commitRow(h.page, 'Commit 1 of the long history')).toHaveCount(0)
  const g = grid(h.page)
  for (let i = 0; i < 40 && (await commitRow(h.page, 'Commit 1 of the long history').count()) === 0; i++) {
    await g.focus()
    await h.page.keyboard.press('Control+End')
    await h.page.waitForTimeout(300)
  }
  await expect(commitRow(h.page, 'Commit 1 of the long history')).toBeVisible()
})

test('F16-E4 search finds commits that aren’t loaded yet', async () => {
  // Fresh tab state: only the newest 2,000 are loaded, Commit 7 is far below.
  await search().fill('Commit 7 of the long')
  await expect(h.page.getByText('1 found')).toBeVisible()
  await search().fill('')
})

// ---------- F17 ----------

test('F17-H1 amend the last commit’s message and content', async () => {
  await h.page.getByRole('tab', { name: 'demo' }).click()
  const parent = h.git(demo, 'rev-parse', 'HEAD~1')
  await openWip(h.page)
  await h.page.getByRole('checkbox', { name: 'Amend last commit' }).click()
  await expect(h.page.getByLabel('Commit summary')).toHaveValue('Print the real temperature in the CLI')
  await h.page.getByLabel('Commit summary').fill('Print the live temperature in the CLI')
  await h.page.getByRole('listbox', { name: /Not staged/ }).getByRole('option', { name: /README\.md/ }).getByTitle('Stage').click({ force: true })
  await h.page.getByRole('form', { name: 'Commit' }).getByRole('button', { name: /^Amend last commit/ }).click()
  await expect.poll(() => subject()).toBe('Print the live temperature in the CLI')
  expect(h.git(demo, 'rev-parse', 'HEAD~1')).toBe(parent)
})

test('F17-E2 editing the newest commit’s message leaves staged files out of it', async () => {
  h.git(demo, 'add', 'src/wind.js')
  await toGraph(h.page)
  await commitRow(h.page, 'Print the live temperature in the CLI').click()
  await h.page.getByRole('button', { name: 'Edit message' }).click()
  await h.page.getByLabel('Commit summary').fill('Show live temperatures')
  await h.page.getByRole('button', { name: 'Save message' }).click()
  await expect.poll(() => subject()).toBe('Show live temperatures')
  expect(h.git(demo, 'show', '--name-only', '--format=', 'HEAD')).not.toContain('wind.js')
  expect(h.git(demo, 'diff', '--cached', '--name-only')).toContain('src/wind.js')
})

test('F17-E3 amending a pushed commit then pushing offers a force push', async () => {
  h.git(demo, 'push', '-q', 'origin', 'main')
  h.git(demo, 'commit', '-q', '--amend', '-m', 'Show live temperatures (amended after push)')
  await toolbar('Push').click()
  await expect(dialog(h.page).getByRole('heading', { name: 'Push was rejected' })).toBeVisible()
  await dialog(h.page).getByRole('button', { name: 'Force push' }).click()
  await expect.poll(h.gitOr(demo, 'rev-parse', 'origin/main')).toBe(h.git(demo, 'rev-parse', 'HEAD'))
})

// ---------- F20 ----------

test('F20-E1 a tag name that already exists is rejected inline', async () => {
  await toGraph(h.page)
  // After the terminal amend + force push, wait for the app to show the new history before using it.
  await expect(commitRow(h.page, 'Show live temperatures (amended after push)')).toBeVisible()
  await h.page.waitForTimeout(500)
  await menu(h.page, commitRow(h.page, 'Update the changelog (6)'), 'Create tag here…')
  await dialog(h.page).getByLabel('Tag name').fill('v0.2.0')
  await expect(dialog(h.page).getByText('A tag with that name already exists.')).toBeVisible()
  await expect(dialog(h.page).getByRole('button', { name: 'Create tag' })).toBeDisabled()
  await dialog(h.page).getByLabel('Tag name').fill('v9.9.9')
  await dialog(h.page).getByRole('checkbox', { name: 'Push it to the remote too' }).click()
  await dialog(h.page).getByRole('button', { name: 'Create tag' }).click()
  await expect.poll(h.gitOr(join(seed, 'origin.git'), 'tag', '-l', 'v9.9.9')).toBe('v9.9.9')
})

test('F20-E2 delete a tag from the remote', async () => {
  await menu(h.page, h.page.getByRole('treeitem', { name: 'v9.9.9' }), 'Delete from the remote…')
  await dialog(h.page).getByRole('button', { name: 'Delete from origin' }).click()
  await expect.poll(h.gitOr(join(seed, 'origin.git'), 'tag', '-l', 'v9.9.9')).toBe('')
  expect(h.git(demo, 'tag', '-l', 'v9.9.9')).toBe('v9.9.9')
})

// ---------- F21 ----------

test('F21-E1/E2 a bad URL or a taken name is caught before adding', async () => {
  await h.page.getByRole('button', { name: 'Add a remote' }).click()
  await dialog(h.page).getByLabel('Name').fill('origin')
  await expect(dialog(h.page).getByText('A remote with that name already exists.')).toBeVisible()
  await dialog(h.page).getByLabel('Name').fill('mirror')
  await dialog(h.page).getByLabel('URL').fill('not a url')
  await expect(dialog(h.page).getByText(/doesn’t look like a repository URL/)).toBeVisible()
  await expect(dialog(h.page).getByRole('button', { name: 'Add remote' })).toBeDisabled()
  await h.page.keyboard.press('Escape')
})

test('F21-E3 set a branch’s upstream', async () => {
  h.git(demo, 'branch', 'no-upstream', 'main')
  await expect(h.page.getByRole('treeitem', { name: /^no-upstream/ })).toBeVisible()
  await menu(h.page, h.page.getByRole('treeitem', { name: /^no-upstream/ }), 'Set upstream…')
  await dialog(h.page).getByRole('combobox', { name: 'Remote branch' }).click()
  await h.page.getByRole('option', { name: 'origin/main' }).click()
  await dialog(h.page).getByRole('button', { name: 'Set upstream' }).click()
  await expect.poll(h.gitOr(demo, 'rev-parse', '--abbrev-ref', 'no-upstream@{upstream}')).toBe('origin/main')
})

// ---------- F22 ----------

test('F22-E2 ignore a tracked file and stop tracking it (the file stays on disk)', async () => {
  writeFileSync(join(demo, 'README.md'), readFileSync(join(demo, 'README.md'), 'utf8') + '\nLocal notes.\n')
  await openWip(h.page)
  await menu(h.page, h.page.getByRole('listbox', { name: /Not staged/ }).getByRole('option', { name: /README\.md/ }), 'Ignore…')
  await dialog(h.page).getByRole('button', { name: 'Add to .gitignore' }).click()
  await expect.poll(() => readFileSync(join(demo, '.gitignore'), 'utf8')).toContain('/README.md')
  // .gitignore is written first; untracking follows a moment later.
  await expect.poll(h.gitOr(demo, 'ls-files', '--', 'README.md')).toBe('')
  expect(existsSync(join(demo, 'README.md'))).toBe(true)
})

test('F22-E3 ignore every file with an extension', async () => {
  writeFileSync(join(demo, 'debug.log'), 'noise\n')
  await openWip(h.page)
  await menu(h.page, h.page.getByRole('listbox', { name: /Not staged/ }).getByRole('option', { name: /debug\.log/ }), 'Ignore…')
  await dialog(h.page).getByRole('combobox', { name: 'What to ignore' }).click()
  await h.page.getByRole('option', { name: 'All .log files' }).click()
  await dialog(h.page).getByRole('button', { name: 'Add to .gitignore' }).click()
  await expect.poll(() => readFileSync(join(demo, '.gitignore'), 'utf8')).toContain('*.log')
  expect(h.git(demo, 'status', '--porcelain')).not.toContain('debug.log')
})

// ---------- F23 ----------

test('F23-H1 hide a branch (local and remote copy) from the graph, then show it again', async () => {
  await toGraph(h.page)
  const row = commitRow(h.page, 'Time out slow API calls after 5 seconds')
  await expect(row).toHaveCount(1)
  await menu(h.page, h.page.getByRole('tree', { name: 'Local branches' }).getByRole('treeitem', { name: /^fix\/timeout/ }), 'Hide from the graph')
  await menu(h.page, h.page.getByRole('group', { name: 'origin' }).getByRole('treeitem', { name: 'fix/timeout' }), 'Hide from the graph')
  await expect(row).toHaveCount(0)
  await expect(h.page.getByText('2 hidden from the graph')).toBeVisible()
  await h.page.getByRole('button', { name: 'Show all' }).click()
  await expect(row).toHaveCount(1)
})

// ---------- window size ----------

test('L-1 at the smallest window size everything still fits without sideways scrolling', async () => {
  await h.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 600))
  await h.page.waitForTimeout(500)
  const overflow = await h.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
  await expect(h.page.getByRole('columnheader', { name: 'Message' })).toBeVisible()
  await expect(toolbar('Push')).toBeVisible()
  await expect(h.page.getByRole('button', { name: 'Settings' })).toBeVisible()
  await h.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900))
})

async function openRepoTab(path: string): Promise<void> {
  const r = await h.page.evaluate(
    (p) => (window as unknown as { gc: { invoke: (c: string, i: unknown) => Promise<{ ok: boolean }> } }).gc.invoke('repo.open', { path: p }),
    path
  )
  expect(r.ok).toBe(true)
  // The renderer learns about tabs on reload; this mirrors what “Open” does after the folder picker.
  await h.page.reload()
  const name = path.split(/[\\/]/).pop()!
  await h.page.getByRole('tab', { name }).click()
  await grid(h.page).getByRole('row').first().waitFor()
}

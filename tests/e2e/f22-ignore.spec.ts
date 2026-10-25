// F22: ignore unstaged files from their menu: one file or several picked together, all files of their kind, or any
// folder that holds them. Tracked files it covers stop being tracked and stay on disk, and Undo puts it all back.
import { test, expect } from '@playwright/test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, makeRepo, openWip, seed, subMenu, type Harness } from './harness'

let h: Harness
let repo = ''

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => {
  h = await launch('ignore', {
    open: [join(seed, 'ignore')],
    setup: (env) => {
      repo = makeRepo(env, 'ignore', [
        ['Start', { 'README.md': 'hi\n', 'src/keep.js': 'keep\n', 'src/gen/b.js': 'b\n', 'src/gen/out/a.js': 'a\n' }]
      ])
    }
  })
  await h.page.getByRole('tab', { name: 'ignore' }).click()
})
test.afterAll(async () => {
  await h.close()
})
test.afterEach(() => h.expectClean())

const notStaged = () => h.page.getByRole('listbox', { name: /Not staged/ })
const file = (name: RegExp) => notStaged().getByRole('option', { name })
const toolbar = (name: string | RegExp) => h.page.getByRole('toolbar', { name: 'Repository actions' }).getByRole('button', { name })
const toasts = () => h.page.getByRole('region', { name: /Notifications/ })
const gitignore = (): string => (existsSync(join(repo, '.gitignore')) ? readFileSync(join(repo, '.gitignore'), 'utf8') : '')

test('F22-H1: Ctrl-click two new files, then Ignore › These 2 files adds a line for each', async () => {
  writeFileSync(join(repo, 'a.log'), 'a\n')
  writeFileSync(join(repo, 'notes.txt'), 'n\n')
  writeFileSync(join(repo, 'keep.txt'), 'k\n')
  await openWip(h.page)
  await file(/a\.log/).click()
  await file(/notes\.txt/).click({ modifiers: ['Control'] })
  await expect(h.page.getByRole('heading', { name: /Not staged/ })).toContainText('2 selected')
  await expect(file(/a\.log/)).toHaveAttribute('aria-selected', 'true')
  await expect(file(/keep\.txt/)).toHaveAttribute('aria-selected', 'false')
  await subMenu(h.page, file(/notes\.txt/), 'Ignore', 'These 2 files')
  await expect(toasts().getByText('Ignoring 2 files')).toBeVisible()
  expect(gitignore()).toBe('/a.log\n/notes.txt\n')
  await expect(file(/a\.log/)).toHaveCount(0)
  await expect(file(/notes\.txt/)).toHaveCount(0)
  await expect(file(/keep\.txt/)).toBeVisible()
})

test('F22-H2: Shift picks a range; files of one kind offer All *.ext files', async () => {
  writeFileSync(join(repo, 'x1.tmp'), '1\n')
  writeFileSync(join(repo, 'x2.tmp'), '2\n')
  await file(/x1\.tmp/).click()
  await file(/x2\.tmp/).click({ modifiers: ['Shift'] })
  await expect(h.page.getByRole('heading', { name: /Not staged/ })).toContainText('2 selected')
  await subMenu(h.page, file(/x2\.tmp/), 'Ignore', 'All *.tmp files')
  await expect(toasts().getByText('Ignoring *.tmp files')).toBeVisible()
  expect(gitignore()).toContain('\n*.tmp\n')
  await expect(file(/\.tmp/)).toHaveCount(0)
})

test('F22-H3: a file deep in folders offers each parent folder; names with brackets and spaces are escaped', async () => {
  writeFileSync(join(repo, 'src/gen/out/a.js'), 'a changed\n')
  writeFileSync(join(repo, 'my [draft].md'), 'd\n')
  await file(/ a\.js/).click({ button: 'right' })
  await h.page.getByRole('menuitem', { name: 'Ignore' }).click()
  const sub = h.page.getByRole('menu').last()
  for (const item of ['This file (a.js)', 'All *.js files', 'Folder src/gen/out/', 'Folder src/gen/', 'Folder src/'])
    await expect(sub.getByRole('menuitem', { name: item, exact: true })).toBeVisible()
  await h.page.keyboard.press('Escape')
  await h.page.keyboard.press('Escape')
  await subMenu(h.page, file(/my \[draft\]\.md/), 'Ignore', 'This file (my [draft].md)')
  await expect.poll(gitignore).toContain(String.raw`/my \[draft\].md`)
  expect(h.git(repo, 'check-ignore', '--', 'my [draft].md')).toBe('my [draft].md')
})

test('F22-H4: ignoring a folder from a changed tracked file stops tracking everything in it; Undo and Redo', async () => {
  const before = gitignore()
  await subMenu(h.page, file(/ a\.js/), 'Ignore', 'Folder src/gen/')
  await expect(toasts().getByText('Ignoring src/gen/')).toBeVisible()
  await expect(toasts().getByText('Git stopped tracking 2 files; they stay on disk. Commit to record it.')).toBeVisible()
  expect(gitignore()).toBe(before + '/src/gen/\n')
  expect(h.git(repo, 'ls-files', '--', 'src/gen')).toBe('')
  expect(h.git(repo, 'ls-files', '--', 'src/keep.js')).toBe('src/keep.js')
  expect(readFileSync(join(repo, 'src/gen/out/a.js'), 'utf8')).toBe('a changed\n')
  // The deletions from the index are staged, ready to commit.
  await expect(h.page.getByRole('listbox', { name: 'Staged', exact: true }).getByRole('option', { name: /b\.js/ })).toBeVisible()

  await toolbar('Undo: Ignore src/gen/').click()
  // .gitignore goes back first, the index a moment later.
  await expect.poll(gitignore).toBe(before)
  await expect.poll(h.gitOr(repo, 'ls-files', '--', 'src/gen')).toBe('src/gen/b.js\nsrc/gen/out/a.js')
  // The change to a.js is still there and still unstaged.
  expect(h.git(repo, 'diff', '--name-only', '--', 'src/gen')).toBe('src/gen/out/a.js')
  expect(h.git(repo, 'diff', '--cached', '--name-only', '--', 'src/gen')).toBe('')

  await toolbar('Redo: Ignore src/gen/').click()
  await expect.poll(gitignore).toBe(before + '/src/gen/\n')
  await expect.poll(h.gitOr(repo, 'ls-files', '--', 'src/gen')).toBe('')
})

test('F22-H5: Shift+Down picks from the keyboard, and S stages every picked file', async () => {
  writeFileSync(join(repo, 'k1.md'), '1\n')
  writeFileSync(join(repo, 'k2.md'), '2\n')
  await file(/k1\.md/).click()
  await file(/k1\.md/).press('Shift+ArrowDown')
  await expect(h.page.getByRole('heading', { name: /Not staged/ })).toContainText('2 selected')
  await file(/k2\.md/).press('s')
  await expect.poll(h.gitOr(repo, 'diff', '--cached', '--name-only', '--', 'k1.md', 'k2.md')).toBe('k1.md\nk2.md')
})

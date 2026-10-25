// F46, step 3: when HEAD moves, only the submodules whose pointer changed come along, and only where it's safe.
// The parent's feature branch moves a and b on a commit, adds c and drops d. Here a follows, b is Manual, c is only
// set up once asked, d's leftover folder is tidied and comes back on the way home; changes inside are never moved,
// and undoing a commit leaves the submodule with what's staged.
import { test, expect } from '@playwright/test'
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dialog, gitIn, launch, makeRepo, seed, type Harness } from './harness'

let h: Harness
const parent = join(seed, 'fol-parent')
const repo = join(seed, 'fol')

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => {
  h = await launch('fol', {
    open: [repo],
    setup: (env) => {
      gitIn(env, seed, 'config', '--global', 'protocol.file.allow', 'always')
      for (const n of ['a', 'b', 'c', 'd']) makeRepo(env, `fol-${n}`, [1, 2, 3].map((i) => [`${n} ${i}`, { [`${n}.txt`]: `${n} ${i}\n` }]))
      makeRepo(env, 'fol-parent', [['Start', { 'README.md': 'hi\n' }]])
      const at = (n: string, rev: string): void => void gitIn(env, join(parent, 'libs', n), 'checkout', '-q', rev)
      for (const n of ['a', 'b', 'd']) gitIn(env, parent, 'submodule', 'add', '-q', join(seed, `fol-${n}`), `libs/${n}`)
      at('a', 'main~1')
      at('b', 'main~1')
      at('d', 'main~2')
      gitIn(env, parent, 'add', '-A')
      gitIn(env, parent, 'commit', '-q', '-m', 'Add a, b and d')
      gitIn(env, parent, 'checkout', '-q', '-b', 'feature')
      at('a', 'main')
      at('b', 'main')
      gitIn(env, parent, 'submodule', 'add', '-q', join(seed, 'fol-c'), 'libs/c')
      at('c', 'main~2')
      gitIn(env, parent, 'rm', '-q', 'libs/d')
      gitIn(env, parent, 'add', '-A')
      gitIn(env, parent, 'commit', '-q', '-m', 'Feature moves a and b, adds c, drops d')
      gitIn(env, parent, 'checkout', '-q', '-f', 'main')
      rmSync(repo, { recursive: true, force: true })
      gitIn(env, seed, 'clone', '-q', parent, repo)
      gitIn(env, repo, 'branch', '-q', 'feature', 'origin/feature')
    }
  })
  await h.page.getByRole('tab', { name: 'fol', exact: true }).click()
})
test.afterAll(async () => {
  await h.close()
})
test.afterEach(() => h.expectClean())

const tree = () => h.page.getByRole('tree', { name: 'Submodules' })
const row = (n: string) => tree().getByRole('treeitem', { name: new RegExp(`^libs/${n},`) })
const toasts = () => h.page.getByRole('region', { name: /Notifications/ })
const lib = (n: string): string => join(repo, 'libs', n)
const commitOf = (n: string, rev: string): string => h.git(join(seed, `fol-${n}`), 'rev-parse', rev)
const at = (n: string) => (): string => {
  try {
    return h.git(lib(n), 'rev-parse', 'HEAD')
  } catch {
    return ''
  }
}
const branch = (name: string) => h.page.getByRole('tree', { name: 'Local branches' }).getByRole('treeitem', { name: new RegExp(`^${name}`) })
async function pick(target: ReturnType<typeof row>, ...path: string[]): Promise<void> {
  await target.click({ button: 'right' })
  const last = path.pop()!
  for (const sub of path) await h.page.getByRole('menuitem', { name: sub }).click()
  await h.page.getByRole('menu').last().getByRole('menuitem', { name: last, exact: true }).press('Enter')
}

test('F46-H13: checking out a branch updates only Follow submodules whose pointer moved, and tidies the one it drops', async () => {
  await h.page.getByRole('button', { name: 'Set up all 3 submodules' }).click()
  await expect(toasts().getByText('Submodules set up')).toBeVisible()
  await pick(row('b'), 'Mode: Follow', 'Manual')
  await expect(row('b')).toContainText('manual')

  await branch('feature').dblclick()
  await expect(toasts().getByText('Updated libs/a')).toBeVisible()
  expect(at('a')()).toBe(commitOf('a', 'main'))
  // Manual: left where it was, and shown as out of step.
  expect(at('b')()).toBe(commitOf('b', 'main~1'))
  await expect(row('b')).toHaveAccessibleName('libs/b, out of step')
  // New on this branch and never set up here: it stays that way until asked.
  await expect(row('c')).toHaveAccessibleName('libs/c, not set up')
  // Not on this branch: git leaves the folder; Caboose removes it, as nothing in it was uncommitted.
  await expect.poll(() => existsSync(lib('d'))).toBe(false)
  await expect(tree().getByRole('treeitem')).toHaveCount(3)
})

test('F46-H14: a checkout from a terminal is followed too; a submodule set up before comes back from git’s own copy', async () => {
  await pick(row('c'), 'Set up')
  await expect(row('c')).toHaveAccessibleName('libs/c, up to date')
  h.git(repo, 'checkout', '-q', 'main')
  await expect.poll(at('a')).toBe(commitOf('a', 'main~1'))
  await expect.poll(at('d')).toBe(commitOf('d', 'main~2'))
  await expect(row('d')).toHaveAccessibleName('libs/d, up to date')
  await expect.poll(() => existsSync(lib('c'))).toBe(false)
  expect(h.git(repo, 'status', '--porcelain')).toBe('')
})

test('F46-H15: a submodule with changes inside: the checkout asks first, and the submodule isn’t moved', async () => {
  writeFileSync(join(lib('a'), 'mine.txt'), 'mine\n')
  await branch('feature').dblclick()
  await expect(dialog(h.page)).toContainText('libs/a has changes inside')
  await dialog(h.page).getByRole('button', { name: 'Switch anyway' }).click()
  await expect(toasts().getByText('Left libs/a as it was')).toBeVisible()
  await expect.poll(h.gitOr(repo, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('feature')
  expect(at('a')()).toBe(commitOf('a', 'main~1'))
  expect(existsSync(join(lib('a'), 'mine.txt'))).toBe(true)
  // c was set up before, so it comes back with the branch.
  await expect.poll(at('c')).toBe(commitOf('c', 'main~2'))
  rmSync(join(lib('a'), 'mine.txt'))
  await pick(row('a'), 'Update to the expected commit')
  await expect.poll(at('a')).toBe(commitOf('a', 'main'))
})

test('F46-H16: undoing a commit that moved a pointer leaves the submodule with what’s still staged', async () => {
  h.git(lib('a'), 'checkout', '-q', 'main~2')
  h.git(repo, 'add', 'libs/a')
  await h.page.getByRole('row', { name: /Uncommitted changes/ }).click()
  await h.page.getByLabel('Commit summary').fill('Pin a to its first commit')
  await h.page.getByRole('button', { name: /^Commit 1 file$/ }).click()
  await dialog(h.page).getByRole('button', { name: 'Commit anyway' }).click()
  await expect.poll(h.gitOr(repo, 'log', '-1', '--format=%s')).toBe('Pin a to its first commit')
  await h.page.getByRole('toolbar', { name: 'Repository actions' }).getByRole('button', { name: /^Undo: Commit/ }).click()
  await expect.poll(h.gitOr(repo, 'log', '-1', '--format=%s')).toBe('Feature moves a and b, adds c, drops d')
  expect(h.git(repo, 'diff', '--cached', '--name-only')).toBe('libs/a')
  expect(at('a')()).toBe(commitOf('a', 'main~2'))
})

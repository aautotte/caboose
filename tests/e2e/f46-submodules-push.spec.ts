// F46, step 4: committing inside a submodule that isn't on a branch asks first (and offers a branch); pushing a
// repository whose submodule commits aren't on the submodule's remote asks first, or pushes the submodule first.
import { test, expect } from '@playwright/test'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dialog, gitIn, launch, makeRepo, seed, type Harness } from './harness'

let h: Harness
const libOrigin = join(seed, 'push-lib.git')
const parentOrigin = join(seed, 'push-parent.git')
const repo = join(seed, 'push-sub')
const lib = join(repo, 'libs', 'pa')

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => {
  h = await launch('pushsub', {
    open: [repo],
    setup: (env) => {
      gitIn(env, seed, 'config', '--global', 'protocol.file.allow', 'always')
      for (const d of [libOrigin, parentOrigin, repo]) rmSync(d, { recursive: true, force: true })
      const src = makeRepo(env, 'push-lib-src', [['pa 1', { 'pa.txt': 'pa 1\n' }]])
      gitIn(env, seed, 'clone', '-q', '--bare', src, libOrigin)
      const p = makeRepo(env, 'push-parent-src', [['Start', { 'README.md': 'hi\n' }]])
      gitIn(env, p, 'submodule', 'add', '-q', libOrigin, 'libs/pa')
      gitIn(env, p, 'commit', '-q', '-m', 'Add pa')
      gitIn(env, seed, 'clone', '-q', '--bare', p, parentOrigin)
      gitIn(env, seed, 'clone', '-q', parentOrigin, repo)
    }
  })
  await h.page.getByRole('tab', { name: 'push-sub', exact: true }).click()
  await h.page.getByRole('button', { name: 'Set up the submodule' }).click()
  await expect(h.page.getByRole('tree', { name: 'Submodules' }).getByRole('treeitem', { name: 'libs/pa, up to date' })).toBeVisible()
})
test.afterAll(async () => {
  await h.close()
})
test.afterEach(() => h.expectClean())

const toolbar = (name: string | RegExp) => h.page.getByRole('toolbar', { name: 'Repository actions' }).getByRole('button', { name })
const toasts = () => h.page.getByRole('region', { name: /Notifications/ })
async function commitAll(summary: string): Promise<void> {
  await h.page.keyboard.press('Escape')
  await h.page.getByRole('row', { name: /Uncommitted changes/ }).click()
  await h.page.getByRole('button', { name: 'Stage all', exact: true }).click()
  await h.page.getByLabel('Commit summary').fill(summary)
  await h.page.getByRole('button', { name: /^Commit 1 file$/ }).click()
}
const remoteHead = (bare: string): string => h.git(bare, 'rev-parse', 'refs/heads/main')

test('F46-H17: committing inside a detached submodule asks first; Create a branch makes one, then the commit goes on it', async () => {
  await h.page.getByRole('tree', { name: 'Submodules' }).getByRole('treeitem', { name: /^libs\/pa/ }).dblclick()
  await expect(h.page.getByRole('tab', { name: 'pa', exact: true })).toHaveAttribute('aria-selected', 'true')
  writeFileSync(join(lib, 'pa.txt'), 'pa 2\n')
  await commitAll('pa 2')
  await expect(dialog(h.page)).toContainText('This is a submodule of push-sub, and it isn’t on a branch')
  await dialog(h.page).getByRole('button', { name: 'Create a branch…' }).click()
  await dialog(h.page).getByLabel('Branch name').fill('work')
  await dialog(h.page).getByRole('button', { name: 'Create branch' }).click()
  await expect.poll(h.gitOr(lib, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('work')
  await h.page.getByRole('button', { name: /^Commit 1 file$/ }).click()
  await expect.poll(h.gitOr(lib, 'log', '-1', '--format=%s')).toBe('pa 2')
  await expect(dialog(h.page)).toHaveCount(0)
})

test('F46-H18: pushing a pointer to a submodule commit that isn’t on its remote asks first; Cancel pushes nothing', async () => {
  await h.page.getByRole('tab', { name: 'push-sub', exact: true }).click()
  await commitAll('Use pa 2')
  await expect.poll(h.gitOr(repo, 'log', '-1', '--format=%s')).toBe('Use pa 2')
  const before = remoteHead(parentOrigin)
  await toolbar('Push').click()
  await expect(dialog(h.page)).toContainText('libs/pa (1 commit)')
  // On a branch with no upstream: Caboose can't push it from here, and says where to.
  await expect(dialog(h.page)).toContainText('isn’t on a branch that tracks a remote')
  await expect(dialog(h.page).getByRole('button', { name: /first$/ })).toHaveCount(0)
  await dialog(h.page).getByRole('button', { name: 'Cancel' }).click()
  expect(remoteHead(parentOrigin)).toBe(before)
})

test('F46-H19: Push libs/pa first pushes the submodule, then the repository', async () => {
  // Now on main, which tracks the submodule's remote.
  h.git(lib, 'checkout', '-q', '-B', 'main', 'work')
  await toolbar('Push').click()
  await dialog(h.page).getByRole('button', { name: 'Push libs/pa first' }).click()
  await expect.poll(() => remoteHead(libOrigin)).toBe(h.git(lib, 'rev-parse', 'HEAD'))
  await expect.poll(() => remoteHead(parentOrigin)).toBe(h.git(repo, 'rev-parse', 'HEAD'))
  await expect(toasts().getByText(/^Pushed main/)).toBeVisible()
})

test('F46-H20: with “Push submodules first” in Settings, it happens without asking', async () => {
  await h.page.getByRole('button', { name: 'Settings' }).click()
  const settings = h.page.getByRole('region', { name: 'Settings' })
  await settings.getByRole('combobox', { name: 'Before pushing' }).click()
  await h.page.getByRole('option', { name: 'Push submodules first' }).click()
  await h.page.getByRole('button', { name: 'Close settings' }).click()
  writeFileSync(join(lib, 'pa.txt'), 'pa 3\n')
  h.git(lib, 'commit', '-q', '-am', 'pa 3')
  await commitAll('Use pa 3')
  await expect.poll(h.gitOr(repo, 'log', '-1', '--format=%s')).toBe('Use pa 3')
  await toolbar('Push').click()
  await expect.poll(() => remoteHead(parentOrigin)).toBe(h.git(repo, 'rev-parse', 'HEAD'))
  expect(remoteHead(libOrigin)).toBe(h.git(lib, 'rev-parse', 'HEAD'))
  await expect(dialog(h.page)).toHaveCount(0)
})

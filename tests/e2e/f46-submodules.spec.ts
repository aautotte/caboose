// F46: submodules, step 1. A clone lists its submodules as not set up; they're set up one at a time or all at once,
// updated to the commit the repository expects, given a mode, emptied again, and opened in a tab of their own.
// Settings per repository turn the handling off (the section goes away) and set how many run at once.
import { test, expect } from '@playwright/test'
import { existsSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dialog, gitIn, launch, makeRepo, seed, type Harness } from './harness'

let h: Harness
const parent = join(seed, 'subs-parent')
const repo = join(seed, 'subs')

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => {
  h = await launch('subs', {
    open: [repo],
    setup: (env) => {
      // Git refuses local paths as submodule URLs unless told otherwise; real ones are https or ssh.
      gitIn(env, seed, 'config', '--global', 'protocol.file.allow', 'always')
      makeRepo(env, 'subs-parent', [['Start', { 'README.md': 'hi\n' }]])
      for (const n of ['one', 'two', 'three']) {
        const lib = makeRepo(env, `sub-${n}`, [
          [`Start ${n}`, { [`${n}.txt`]: `${n}\n` }],
          [`More ${n}`, { [`${n}.txt`]: `${n} 2\n` }]
        ])
        gitIn(env, parent, 'submodule', 'add', '-q', lib, `libs/${n}`)
      }
      gitIn(env, parent, 'commit', '-q', '-m', 'Add three submodules')
      // A plain clone, as without --recurse-submodules: the submodules' folders are empty.
      rmSync(repo, { recursive: true, force: true })
      gitIn(env, seed, 'clone', '-q', parent, repo)
    }
  })
  await h.page.getByRole('tab', { name: 'subs', exact: true }).click()
})
test.afterAll(async () => {
  await h.close()
})
test.afterEach(() => h.expectClean())

const tree = () => h.page.getByRole('tree', { name: 'Submodules' })
const row = (n: string) => tree().getByRole('treeitem', { name: new RegExp(`^libs/${n},`) })
const toasts = () => h.page.getByRole('region', { name: /Notifications/ })
/** The app reads status again when its window gets focus, as after working in a terminal. */
const refocus = () => h.page.evaluate(() => window.dispatchEvent(new Event('focus')))
const expected = (n: string): string => h.git(repo, 'rev-parse', `HEAD:libs/${n}`)
const current = (n: string): string => h.git(join(repo, 'libs', n), 'rev-parse', 'HEAD')
async function pick(target: ReturnType<typeof row>, ...path: string[]): Promise<void> {
  await target.click({ button: 'right' })
  const last = path.pop()!
  for (const sub of path) await h.page.getByRole('menuitem', { name: sub }).click()
  // In a small window a submenu can open over its parent, so pick the last item from the keyboard.
  await h.page.getByRole('menu').last().getByRole('menuitem', { name: last, exact: true }).press('Enter')
}

test('F46-H1: a fresh clone lists its submodules as not set up, with Set up all', async () => {
  await expect(tree().getByRole('treeitem')).toHaveCount(3)
  for (const n of ['one', 'two', 'three']) await expect(row(n)).toHaveAccessibleName(`libs/${n}, not set up`)
  await expect(h.page.getByRole('button', { name: 'Set up all 3 submodules' })).toBeVisible()
  expect(readdirSync(join(repo, 'libs', 'one'))).toEqual([])
})

test('F46-H2: Set up from a submodule’s menu sets up that one only', async () => {
  await pick(row('one'), 'Set up')
  await expect(row('one')).toHaveAccessibleName('libs/one, up to date')
  expect(existsSync(join(repo, 'libs', 'one', 'one.txt'))).toBe(true)
  expect(current('one')).toBe(expected('one'))
  await expect(row('two')).toHaveAccessibleName('libs/two, not set up')
  await expect(h.page.getByRole('button', { name: 'Set up all 2 submodules' })).toBeVisible()
})

test('F46-H3: Set up all sets up the rest', async () => {
  await h.page.getByRole('button', { name: 'Set up all 2 submodules' }).click()
  await expect(toasts().getByText('Submodules set up')).toBeVisible()
  for (const n of ['two', 'three']) await expect(row(n)).toHaveAccessibleName(`libs/${n}, up to date`)
  await expect(h.page.getByRole('button', { name: /^Set up all/ })).toHaveCount(0)
})

test('F46-H4: a submodule on another commit shows as out of step; Update puts it at the expected commit', async () => {
  h.git(join(repo, 'libs', 'one'), 'checkout', '-q', 'HEAD~1')
  await refocus()
  await expect(row('one')).toHaveAccessibleName('libs/one, out of step')
  await pick(row('one'), 'Update to the expected commit')
  await expect(row('one')).toHaveAccessibleName('libs/one, up to date')
  expect(current('one')).toBe(expected('one'))
})

test('F46-H5: changes inside a submodule show, keep its local copy safe, and a mode can be set for it', async () => {
  writeFileSync(join(repo, 'libs', 'two', 'scratch.txt'), 'mine\n')
  await refocus()
  await expect(row('two')).toHaveAccessibleName('libs/two, changes')
  await row('two').click({ button: 'right' })
  await expect(h.page.getByRole('menuitem', { name: 'Remove local copy…' })).toBeDisabled()
  await h.page.keyboard.press('Escape')
  await pick(row('two'), 'Mode: Follow', 'Manual')
  await expect.poll(h.gitOr(repo, 'config', '--get', 'caboose-submodule.libs/two.mode')).toBe('manual')
  await expect(row('two')).toContainText('manual')
  // Back to the default: the setting goes away rather than repeating it.
  await pick(row('two'), 'Mode: Manual', 'Follow (repository default)')
  await expect.poll(h.gitOr(repo, 'config', '--get', 'caboose-submodule.libs/two.mode')).toBe('')
  rmSync(join(repo, 'libs', 'two', 'scratch.txt'))
  await refocus()
  await expect(row('two')).toHaveAccessibleName('libs/two, up to date')
})

test('F46-H6: Remove local copy empties the folder; setting it up again works', async () => {
  await pick(row('three'), 'Remove local copy…')
  await dialog(h.page).getByRole('button', { name: 'Remove local copy' }).click()
  await expect(row('three')).toHaveAccessibleName('libs/three, not set up')
  expect(readdirSync(join(repo, 'libs', 'three'))).toEqual([])
  expect(h.git(repo, 'status', '--porcelain')).toBe('')
  await pick(row('three'), 'Set up')
  await expect(row('three')).toHaveAccessibleName('libs/three, up to date')
})

test('F46-H7: Settings: handling off hides the section; on brings it back; At once is git’s submodule.fetchJobs', async () => {
  await h.page.getByRole('button', { name: 'Settings' }).click()
  const settings = h.page.getByRole('region', { name: 'Settings' })
  await settings.getByRole('switch', { name: 'Handle submodules' }).click()
  await expect(tree()).toHaveCount(0)
  await expect(settings.getByRole('combobox', { name: 'Default mode' })).toHaveCount(0)
  await settings.getByRole('switch', { name: 'Handle submodules' }).click()
  await expect(tree().getByRole('treeitem')).toHaveCount(3)
  await settings.getByRole('combobox', { name: 'At once' }).click()
  await h.page.getByRole('option', { name: '8', exact: true }).click()
  await expect.poll(h.gitOr(repo, 'config', '--get', 'submodule.fetchJobs')).toBe('8')
  await h.page.getByRole('button', { name: 'Close settings' }).click()
})

test('F46-H8: double-click opens a submodule in its own tab', async () => {
  await row('one').dblclick()
  await expect(h.page.getByRole('tab', { name: 'one', exact: true })).toHaveAttribute('aria-selected', 'true')
})

// F62: adding a submodule, changing its URL, and taking it out of the repository. Each leaves its change staged
// (.gitmodules and the pointer), for the next commit. A removed submodule's history stays in .git/modules, so adding
// one in the same folder again gets a name of its own.
import { test, expect } from '@playwright/test'
import { existsSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { dialog, gitIn, launch, makeRepo, seed, type Harness } from './harness'

let h: Harness
const repo = join(seed, 'submgr')
const libA = join(seed, 'smlib-a')
const libB = join(seed, 'smlib-b')

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => {
  h = await launch('submgr', {
    open: [repo],
    setup: (env) => {
      // Git refuses local paths as submodule URLs unless told otherwise; real ones are https or ssh.
      gitIn(env, seed, 'config', '--global', 'protocol.file.allow', 'always')
      makeRepo(env, 'submgr', [['Start', { 'README.md': 'hi\n' }]])
      makeRepo(env, 'smlib-a', [['Start a', { 'a.txt': 'a\n' }]])
      makeRepo(env, 'smlib-b', [['Start b', { 'b.txt': 'b\n' }]])
    }
  })
  await h.page.getByRole('tab', { name: 'submgr', exact: true }).click()
})
test.afterAll(async () => {
  await h.close()
})
test.afterEach(() => h.expectClean())

const tree = () => h.page.getByRole('tree', { name: 'Submodules' })
const row = (p: string) => tree().getByRole('treeitem', { name: new RegExp(`^${p},`) })
const toasts = () => h.page.getByRole('region', { name: /Notifications/ })
const refocus = () => h.page.evaluate(() => window.dispatchEvent(new Event('focus')))
const status = (): string => h.git(repo, 'status', '--porcelain')
/** A key of the .gitmodules that's staged. */
const stagedModules = (key: string): string => h.git(repo, 'config', '--blob', ':.gitmodules', '--get', key)
async function pick(target: ReturnType<typeof row>, item: string): Promise<void> {
  // Menus are greyed out while submodules are being updated (as after a commit made in a terminal).
  await expect(h.page.getByRole('status', { name: 'Submodules' })).toHaveCount(0)
  await target.click({ button: 'right' })
  await h.page.getByRole('menu').last().getByRole('menuitem', { name: item, exact: true }).press('Enter')
}

test('F62-H1: Add a submodule from the command palette: the folder follows the URL, and the result is staged', async () => {
  await expect(tree()).toHaveCount(0)
  await h.page.keyboard.press('Control+p')
  await h.page.keyboard.type('Add a submodule')
  await h.page.keyboard.press('Enter')
  const d = dialog(h.page)
  await d.getByRole('textbox', { name: 'Repository URL' }).fill(libA)
  await expect(d.getByRole('textbox', { name: 'Folder' })).toHaveValue('smlib-a')
  await d.getByRole('textbox', { name: 'Folder' }).fill('libs/a')
  await d.getByRole('button', { name: 'Add submodule' }).click()
  await expect(d).toHaveCount(0)
  await expect(toasts().getByText('Added the submodule libs/a')).toBeVisible()
  await expect(row('libs/a')).toHaveAccessibleName('libs/a, up to date')
  expect(existsSync(join(repo, 'libs', 'a', 'a.txt'))).toBe(true)
  expect(status()).toBe('A  .gitmodules\nA  libs/a')
  expect(stagedModules('submodule.libs/a.url')).toBe(libA)
  h.git(repo, 'commit', '-q', '-m', 'Add libs/a')
})

test('F62-H2: the Add dialog refuses a folder that has a submodule, or one outside the repository', async () => {
  // With every submodule set up, the section's button adds one.
  await h.page.getByRole('button', { name: 'Add a submodule', exact: true }).click()
  const d = dialog(h.page)
  await d.getByRole('textbox', { name: 'Repository URL' }).fill(libB)
  await d.getByRole('textbox', { name: 'Folder' }).fill('libs/a')
  await expect(d.getByText('There’s already a submodule in that folder.')).toBeVisible()
  await d.getByRole('textbox', { name: 'Folder' }).fill('../outside')
  await expect(d.getByText('A folder inside the repository, like libs/name.')).toBeVisible()
  await expect(d.getByRole('button', { name: 'Add submodule' })).toBeDisabled()
  await d.getByRole('button', { name: 'Cancel' }).click()
})

test('F62-H3: Change URL updates .gitmodules (staged) and the submodule’s own remote', async () => {
  await pick(row('libs/a'), 'Change URL…')
  const d = dialog(h.page)
  const url = d.getByRole('textbox', { name: 'URL' })
  await expect(url).toHaveValue(libA)
  await url.fill(libB)
  await d.getByRole('button', { name: 'Change URL' }).click()
  await expect(d).toHaveCount(0)
  await expect(toasts().getByText('Changed the URL of libs/a')).toBeVisible()
  expect(stagedModules('submodule.libs/a.url')).toBe(libB)
  expect(status()).toBe('M  .gitmodules')
  expect(h.git(join(repo, 'libs', 'a'), 'remote', 'get-url', 'origin')).toBe(libB)
  h.git(repo, 'commit', '-q', '-m', 'Move libs/a')
})

test('F62-H4: a submodule with changes inside can’t be removed', async () => {
  writeFileSync(join(repo, 'libs', 'a', 'scratch.txt'), 'mine\n')
  await refocus()
  await expect(row('libs/a')).toHaveAccessibleName('libs/a, changes')
  await row('libs/a').click({ button: 'right' })
  await expect(h.page.getByRole('menuitem', { name: 'Remove from the repository… (has changes)' })).toBeDisabled()
  await h.page.keyboard.press('Escape')
  rmSync(join(repo, 'libs', 'a', 'scratch.txt'))
  await refocus()
  await expect(row('libs/a')).toHaveAccessibleName('libs/a, up to date')
})

test('F62-H5: Remove from the repository stages the removal and clears the folder, .gitmodules and its settings', async () => {
  await pick(row('libs/a'), 'Remove from the repository…')
  await dialog(h.page).getByRole('button', { name: 'Remove submodule' }).click()
  await expect(toasts().getByText('Removed the submodule libs/a')).toBeVisible()
  // The last one: the section goes, and so does the empty .gitmodules.
  await expect(tree()).toHaveCount(0)
  expect(existsSync(join(repo, 'libs', 'a'))).toBe(false)
  expect(status()).toBe('D  .gitmodules\nD  libs/a')
  expect(h.gitOr(repo, 'config', '--local', '--get-regexp', '^submodule\\.')()).toBe('')
  h.git(repo, 'commit', '-q', '-m', 'Remove libs/a')
})

test('F62-H6: adding one in the same folder again gets a new name; a submodule that isn’t set up can be removed', async () => {
  await h.page.keyboard.press('Control+p')
  await h.page.keyboard.type('Add a submodule')
  await h.page.keyboard.press('Enter')
  const d = dialog(h.page)
  await d.getByRole('textbox', { name: 'Repository URL' }).fill(libA)
  await d.getByRole('textbox', { name: 'Folder' }).fill('libs/a')
  await d.getByRole('textbox', { name: 'Branch (optional)' }).fill('main')
  await d.getByRole('button', { name: 'Add submodule' }).click()
  await expect(row('libs/a')).toHaveAccessibleName('libs/a, up to date')
  expect(stagedModules('submodule.libs/a-2.path')).toBe('libs/a')
  expect(stagedModules('submodule.libs/a-2.branch')).toBe('main')
  expect(existsSync(join(repo, 'libs', 'a', 'a.txt'))).toBe(true)
  h.git(repo, 'commit', '-q', '-m', 'Add libs/a again')

  await pick(row('libs/a'), 'Remove local copy…')
  await dialog(h.page).getByRole('button', { name: 'Remove local copy' }).click()
  await expect(row('libs/a')).toHaveAccessibleName('libs/a, not set up')
  await pick(row('libs/a'), 'Remove from the repository…')
  await dialog(h.page).getByRole('button', { name: 'Remove submodule' }).click()
  await expect(tree()).toHaveCount(0)
  expect(status()).toBe('D  .gitmodules\nD  libs/a')
})

// F01 open, F02 clone, F03 new repository: happy paths, edge and negative cases.
import { test, expect } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { demo, dialog, grid, invoke, launch, makeRepo, seed, type Harness } from './harness'

let h: Harness
let unicodeRepo = ''
let goneRepo = ''
const plain = join(tmpdir(), 'caboose-e2e-plain-folder')

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => {
  h = await launch('repos', {
    setup: (env) => {
      unicodeRepo = makeRepo(env, 'café ☕ repo', [['Première version — déjà là 🎉', { 'résumé.md': '# Résumé\n' }]])
      goneRepo = makeRepo(env, 'gone-soon', [['only commit', { 'a.txt': 'a\n' }]])
      // Outside any repository (.seed itself sits inside the project's repo).
      rmSync(plain, { recursive: true, force: true })
      mkdirSync(plain, { recursive: true })
    },
    open: [demo, join(seed, 'café ☕ repo'), join(seed, 'gone-soon')]
  })
  await h.page.getByRole('tab', { name: 'demo' }).click()
  await grid(h.page).waitFor()
})
test.afterAll(async () => {
  await h.close()
})
test.afterEach(() => h.expectClean())

const home = async (): Promise<void> => {
  await h.page.getByRole('tab', { name: 'Repositories' }).click()
  await h.page.getByRole('region', { name: 'Recent' }).waitFor()
}

// ---------- F01 ----------

test('F01-H1 reopen a closed repository from the recent list', async () => {
  // Keyboard: Delete on a focused tab closes it.
  await h.page.getByRole('tab', { name: 'demo' }).focus()
  await h.page.keyboard.press('Delete')
  await expect(h.page.getByRole('tab', { name: 'demo' })).toHaveCount(0)
  await home()
  await h.page.getByRole('region', { name: 'Recent' }).getByRole('button', { name: /^demo/ }).click()
  await expect(h.page.getByRole('tab', { name: 'demo' })).toHaveAttribute('aria-selected', 'true')
  await expect(grid(h.page).getByRole('row').first()).toBeVisible()
})

test('F01-E1 a folder that is not a repository is refused with a clear message', async () => {
  const r = await invoke(h.page, 'repo.open', { path: plain })
  expect(r.ok).toBe(false)
  if (!r.ok) {
    expect(r.error.code).toBe('not_repo')
    expect(r.error.message).toMatch(/isn’t a Git repository/)
  }
})

test('F01-E2 a repository deleted since last time shows as missing and can’t be opened', async () => {
  // Mouse: the × on the tab.
  await h.page.getByTitle('Close gone-soon').click()
  // Once its tab is closed the app must not keep the folder busy (Windows locks watched folders).
  await expect
    .poll(() => {
      try {
        renameSync(goneRepo, `${goneRepo}-moved`)
        return 'moved'
      } catch (e) {
        return String((e as Error).message).slice(0, 40)
      }
    }, { timeout: 5000 })
    .toBe('moved')
  await home()
  const row = h.page.getByRole('region', { name: 'Recent' }).getByRole('listitem').filter({ hasText: 'gone-soon' })
  await expect(row.getByText('Folder not found')).toBeVisible()
  await expect(row.getByRole('button', { name: /^gone-soon/ })).toBeDisabled()
  renameSync(`${goneRepo}-moved`, goneRepo)
})

test('F01-E3 opening a repository that is already open focuses its tab instead of adding one', async () => {
  const r = await invoke(h.page, 'repo.open', { path: demo })
  expect(r.ok).toBe(true)
  await home()
  await h.page.getByRole('region', { name: 'Recent' }).getByRole('button', { name: /^demo/ }).click()
  await expect(h.page.getByRole('tab', { name: 'demo' })).toHaveCount(1)
  await expect(h.page.getByRole('tab', { name: 'demo' })).toHaveAttribute('aria-selected', 'true')
})

test('F01-E4 accents, spaces and emoji in the folder, file names and messages', async () => {
  await h.page.getByRole('tab', { name: 'café ☕ repo' }).click()
  await expect(grid(h.page).getByRole('row', { name: /^Première version — déjà là 🎉/ })).toBeVisible()
  writeFileSync(join(unicodeRepo, 'notes – ünïcode ✓.md'), 'ça marche\n')
  await h.page.getByRole('row', { name: /Uncommitted changes/ }).click()
  await h.page.getByRole('button', { name: 'Stage all', exact: true }).click()
  await h.page.getByLabel('Commit summary').fill('Ajouté — ✓ 日本語')
  await h.page.getByRole('button', { name: /^Commit 1 file$/ }).click()
  await expect.poll(h.gitOr(unicodeRepo, 'log', '-1', '--format=%s')).toBe('Ajouté — ✓ 日本語')
  expect(h.git(unicodeRepo, '-c', 'core.quotepath=off', 'ls-files')).toContain('ünïcode')
})

test('F01-E5 reloading the window restores the open tabs', async () => {
  await h.page.reload()
  await expect(h.page.getByRole('tab', { name: 'demo' })).toBeVisible()
  await expect(h.page.getByRole('tab', { name: 'café ☕ repo' })).toBeVisible()
  await h.page.getByRole('tab', { name: 'demo' }).click()
  await expect(grid(h.page).getByRole('row').first()).toBeVisible()
})

// ---------- F02 ----------

async function cloneDialog(url: string, folder: string): Promise<void> {
  await home()
  await h.page.getByRole('button', { name: /^Clone/ }).first().click()
  await dialog(h.page).getByLabel('Repository URL').fill(url)
  await dialog(h.page).getByLabel('Put it in').fill(seed)
  await dialog(h.page).getByLabel('Folder name').fill(folder)
}

test('F02-H1 clone a repository and open it', async () => {
  rmSync(join(seed, 'clone-h1'), { recursive: true, force: true })
  await cloneDialog(join(seed, 'origin.git'), 'clone-h1')
  await dialog(h.page).getByRole('button', { name: 'Clone', exact: true }).click()
  await expect(h.page.getByRole('tab', { name: 'clone-h1' })).toHaveAttribute('aria-selected', 'true')
  await expect(grid(h.page).getByRole('row', { name: /^Update the changelog \(6\)/ })).toBeVisible()
})

test('F02-E1 a destination folder that already has files is refused before cloning', async () => {
  await cloneDialog(join(seed, 'origin.git'), 'demo')
  await dialog(h.page).getByRole('button', { name: 'Clone', exact: true }).click()
  await expect(dialog(h.page).getByRole('alert')).toContainText('isn’t empty')
  await h.page.keyboard.press('Escape')
})

test('F02-N1 a URL that isn’t a repository shows git’s reason and opens nothing', async () => {
  rmSync(join(seed, 'clone-bad'), { recursive: true, force: true })
  await cloneDialog(join(seed, 'no-such-repo.git'), 'clone-bad')
  await dialog(h.page).getByRole('button', { name: 'Clone', exact: true }).click()
  await expect(dialog(h.page).getByRole('alert')).toBeVisible()
  await expect(h.page.getByRole('tab', { name: 'clone-bad' })).toHaveCount(0)
  await h.page.keyboard.press('Escape')
})

test('F02-E3 an unreachable server fails cleanly (offline)', async () => {
  rmSync(join(seed, 'clone-offline'), { recursive: true, force: true })
  await cloneDialog('http://127.0.0.1:9/nothing.git', 'clone-offline')
  await dialog(h.page).getByRole('button', { name: 'Clone', exact: true }).click()
  await expect(dialog(h.page).getByRole('alert')).toBeVisible({ timeout: 30_000 })
  await expect(h.page.getByRole('tab', { name: 'clone-offline' })).toHaveCount(0)
  await h.page.keyboard.press('Escape')
})

test('F02-E5 a shallow clone fetches only the requested history', async () => {
  rmSync(join(seed, 'clone-shallow'), { recursive: true, force: true })
  await cloneDialog(`file://${join(seed, 'origin.git').split('\\').join('/')}`, 'clone-shallow')
  await dialog(h.page).getByRole('switch', { name: 'Shallow clone (recent history only)' }).click()
  await dialog(h.page).getByLabel('Commits to fetch').fill('2')
  await dialog(h.page).getByRole('button', { name: 'Clone', exact: true }).click()
  await expect(h.page.getByRole('tab', { name: 'clone-shallow' })).toBeVisible()
  expect(h.git(join(seed, 'clone-shallow'), 'rev-list', '--count', 'HEAD')).toBe('2')
})

test('F02-E8 double-clicking Clone clones once', async () => {
  rmSync(join(seed, 'clone-twice'), { recursive: true, force: true })
  await cloneDialog(join(seed, 'origin.git'), 'clone-twice')
  await dialog(h.page).getByRole('button', { name: 'Clone', exact: true }).dblclick()
  await expect(h.page.getByRole('tab', { name: 'clone-twice' })).toHaveCount(1)
  await expect(h.page.getByRole('region', { name: /Notifications/ }).getByText(/Couldn’t|failed/i)).toHaveCount(0)
})

// ---------- F03 ----------

async function initDialog(name: string): Promise<void> {
  await home()
  await h.page.getByRole('button', { name: /^New/ }).first().click()
  await dialog(h.page).getByLabel('Name').fill(name)
  await dialog(h.page).getByLabel('Create it in').fill(seed)
}

test('F03-H1 a new repository with README, ignore file and licence, committed once', async () => {
  rmSync(join(seed, 'fresh-start'), { recursive: true, force: true })
  await initDialog('fresh-start')
  await dialog(h.page).getByRole('combobox', { name: 'Ignore file' }).click()
  await h.page.getByRole('option', { name: 'Node.js' }).click()
  await dialog(h.page).getByRole('combobox', { name: 'Licence' }).click()
  await h.page.getByRole('option', { name: 'MIT' }).click()
  await dialog(h.page).getByRole('button', { name: 'Create repository' }).click()
  await expect(h.page.getByRole('tab', { name: 'fresh-start' })).toBeVisible()
  const dir = join(seed, 'fresh-start')
  for (const f of ['README.md', '.gitignore', 'LICENSE']) expect(existsSync(join(dir, f))).toBe(true)
  expect(readFileSync(join(dir, '.gitignore'), 'utf8')).toContain('node_modules')
  expect(h.git(dir, 'rev-list', '--count', 'HEAD')).toBe('1')
})

test('F03-E1 a name with slashes is rejected before anything is created', async () => {
  await initDialog('bad/name')
  await expect(dialog(h.page).getByRole('button', { name: 'Create repository' })).toBeDisabled()
  await expect(dialog(h.page).getByText(/Folder names can’t contain/)).toBeVisible()
  await h.page.keyboard.press('Escape')
})

test('F03-E2 a folder that is already a repository is refused', async () => {
  await initDialog('demo')
  await dialog(h.page).getByRole('button', { name: 'Create repository' }).click()
  await expect(dialog(h.page).getByRole('alert')).toContainText(/already a Git repository/)
  await h.page.keyboard.press('Escape')
})

test('F03-E3 accented names work', async () => {
  rmSync(join(seed, 'nouveau-dépôt'), { recursive: true, force: true })
  await initDialog('nouveau-dépôt')
  await dialog(h.page).getByRole('button', { name: 'Create repository' }).click()
  await expect(h.page.getByRole('tab', { name: 'nouveau-dépôt' })).toBeVisible()
  expect(existsSync(join(seed, 'nouveau-dépôt', '.git'))).toBe(true)
})

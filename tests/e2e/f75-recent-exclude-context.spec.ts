// F75: going back to recent branches (the branch name's menu, the palette, Ctrl+Shift+B as git checkout - does),
// ignoring new files on this computer only (.git/info/exclude, undoable), and how many lines a diff shows around
// each change, with staging working on the blocks as shown.
import { test, expect, type Locator } from '@playwright/test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { appState, commitRow, gitIn, launch, makeRepo, menu, openWip, seed, type Harness } from './harness'

let h: Harness
const repo = join(seed, 'recent')
const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`)

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => {
  h = await launch('recent', {
    open: [repo],
    setup: (env) => {
      makeRepo(env, 'recent', [
        ['Base', { 'ctx.txt': lines.join('\n') + '\n', 'kept.txt': 'kept\n' }],
        ['Second', { 'kept.txt': 'kept, again\n' }]
      ])
      // Made without switching, so there's nothing to go back to yet.
      gitIn(env, repo, 'branch', 'feat-a')
      gitIn(env, repo, 'branch', 'feat-b')
    }
  })
  await h.page.getByRole('tab', { name: 'recent', exact: true }).click()
  await expect(commitRow(h.page, 'Second')).toBeVisible()
})
test.afterAll(async () => {
  await h.close()
})
test.afterEach(() => h.expectClean())

const toasts = () => h.page.getByRole('region', { name: /Notifications/ })
const toolbar = (name: string | RegExp) => h.page.getByRole('toolbar', { name: 'Repository actions' }).getByRole('button', { name })
const branchMenu = () => h.page.getByRole('button', { name: /^Switch branch: / })
const onBranch = (): string => h.git(repo, 'rev-parse', '--abbrev-ref', 'HEAD')
// Switched, and on screen (the next step reads the app's own idea of where it is).
async function switched(to: string): Promise<void> {
  await expect.poll(onBranch).toBe(/^[0-9a-f]{40}$/.test(to) ? 'HEAD' : to)
  await expect(branchMenu()).toHaveAccessibleName(/^[0-9a-f]{40}$/.test(to) ? `Switch branch: Detached at ${to.slice(0, 7)}` : `Switch branch: ${to}`)
}
// Esc closes the newest toast first when it came after the menu or palette opened (Radix puts it on top).
async function dismiss(what: Locator): Promise<void> {
  await expect(async () => {
    await h.page.keyboard.press('Escape')
    await expect(what).toHaveCount(0, { timeout: 500 })
  }).toPass()
}
const refocus = () => h.page.evaluate(() => window.dispatchEvent(new Event('focus')))
async function palette(text: string): Promise<void> {
  await h.page.keyboard.press('Control+p')
  await h.page.keyboard.type(text)
  await h.page.keyboard.press('Enter')
}

test('F75-H1: nothing to go back to at first; Ctrl+Shift+B says so', async () => {
  await branchMenu().click()
  await expect(h.page.getByRole('menuitem', { name: 'No previous branch yet' })).toBeDisabled()
  await dismiss(h.page.getByRole('menu'))
  await h.page.keyboard.press('Control+Shift+B')
  await expect(toasts().getByText('No previous branch')).toBeVisible()
  expect(onBranch()).toBe('main')
})

test('F75-H2: the branch name lists where you were, and Ctrl+Shift+B goes back and forth as git checkout - does', async () => {
  await palette('Check out feat-a')
  await switched('feat-a')
  await palette('Check out feat-b')
  await switched('feat-b')
  await expect(branchMenu()).toHaveAccessibleName('Switch branch: feat-b')
  await branchMenu().click()
  const items = h.page.getByRole('menu').getByRole('menuitem')
  await expect(items).toHaveText([/^Previous: feat-a/, 'main', /^Another branch…/])
  await h.page.getByRole('menuitem', { name: 'main', exact: true }).click()
  await switched('main')
  await h.page.keyboard.press('Control+Shift+B')
  await switched('feat-b')
  await h.page.keyboard.press('Control+Shift+B')
  await switched('main')
  // The palette offers the same, the recent branches first.
  await h.page.keyboard.press('Control+p')
  const options = h.page.getByRole('dialog').getByRole('group', { name: 'Check out' }).getByRole('option')
  await expect(options).toHaveText([/^Switch to the previous branch \(feat-b\)/, 'Check out feat-b', 'Check out feat-a'])
  await dismiss(h.page.getByRole('dialog'))
  // Another branch… is the palette, ready to type in.
  await branchMenu().click()
  await h.page.getByRole('menuitem', { name: /^Another branch/ }).press('Enter')
  await expect(h.page.getByRole('combobox', { name: 'Command palette' })).toBeFocused()
  await dismiss(h.page.getByRole('dialog'))
})

test('F75-H3: a branch deleted since is skipped; a detached commit is gone back to by its sha', async () => {
  h.git(repo, 'branch', '-D', 'feat-b')
  await refocus()
  await branchMenu().click()
  await expect(h.page.getByRole('menuitem', { name: /^Previous: feat-a/ })).toBeVisible()
  await dismiss(h.page.getByRole('menu'))
  const base = h.git(repo, 'rev-parse', 'HEAD~1')
  await menu(h.page, commitRow(h.page, 'Base'), 'Check out this commit (detached)')
  await expect(toasts().getByText(`Switched to ${base.slice(0, 7)}`)).toBeVisible()
  await switched(base)
  await h.page.keyboard.press('Control+Shift+B')
  await switched('main')
  await branchMenu().click()
  await expect(h.page.getByRole('menuitem', { name: new RegExp(`^Previous: ${base.slice(0, 7)}`) })).toBeVisible()
  await dismiss(h.page.getByRole('menu'))
  await h.page.keyboard.press('Control+Shift+B')
  await switched(base)
  await h.page.keyboard.press('Control+Shift+B')
  await switched('main')
})

const notStaged = () => h.page.getByRole('listbox', { name: /Not staged/ })
const file = (name: RegExp) => notStaged().getByRole('option', { name })
const exclude = (): string => readFileSync(join(repo, '.git', 'info', 'exclude'), 'utf8')

test('F75-H4: Ignore › On this computer only adds a new file to .git/info/exclude, not .gitignore; undo takes it out', async () => {
  const before = exclude()
  writeFileSync(join(repo, 'scratch.txt'), 's\n')
  writeFileSync(join(repo, 'kept.txt'), 'kept, changed\n')
  await openWip(h.page)
  await file(/scratch\.txt/).click({ button: 'right' })
  await h.page.getByRole('menuitem', { name: 'Ignore' }).click()
  await h.page.getByRole('menu').last().getByRole('menuitem', { name: 'On this computer only' }).press('Enter')
  await h.page.getByRole('menu').last().getByRole('menuitem', { name: 'This file (scratch.txt)', exact: true }).press('Enter')
  await expect(toasts().getByText('Ignoring scratch.txt on this computer')).toBeVisible()
  expect(exclude()).toBe(`${before}${before.endsWith('\n') ? '' : '\n'}/scratch.txt\n`)
  expect(existsSync(join(repo, '.gitignore'))).toBe(false)
  await expect(file(/scratch\.txt/)).toHaveCount(0)
  expect(h.git(repo, 'status', '--porcelain')).toBe('M kept.txt')
  await toolbar('Undo: Ignore scratch.txt on this computer').click()
  await expect(file(/scratch\.txt/)).toBeVisible()
  expect(exclude()).toBe(before)
  await toolbar('Redo: Ignore scratch.txt on this computer').click()
  await expect(file(/scratch\.txt/)).toHaveCount(0)
  expect(exclude()).toContain('/scratch.txt')
})

test('F75-H5: a tracked file can only be ignored for everyone', async () => {
  await file(/kept\.txt/).click({ button: 'right' })
  await h.page.getByRole('menuitem', { name: 'Ignore' }).click()
  await expect(h.page.getByRole('menu').last().getByRole('menuitem', { name: 'On this computer only (new files)' })).toBeDisabled()
  await h.page.keyboard.press('Escape')
  await h.page.keyboard.press('Escape')
  h.git(repo, 'checkout', '--', 'kept.txt')
})

const view = () => h.page.getByRole('region', { name: 'Changes in ctx.txt' })
const blocks = () => view().getByRole('region', { name: /^Change \d+ of \d+$/ })
async function aroundChanges(from: number, to: string): Promise<void> {
  await view().getByRole('button', { name: 'Diff options' }).click()
  await h.page.getByRole('menuitem', { name: `Lines around changes (${from})` }).press('Enter')
  await h.page.getByRole('menu').last().getByRole('menuitem', { name: to, exact: true }).press('Enter')
}

test('F75-H6: more lines around changes joins two nearby changes into one block, and staging uses it', async () => {
  // Changes at lines 5 and 14: 8 unchanged lines apart.
  writeFileSync(join(repo, 'ctx.txt'), lines.map((l, i) => (i === 4 || i === 13 ? l.toUpperCase() : l)).join('\n') + '\n')
  await refocus()
  await openWip(h.page)
  await file(/ctx\.txt/).click()
  await expect(blocks()).toHaveCount(2)
  await aroundChanges(3, '5 lines')
  await expect(blocks()).toHaveCount(1)
  expect((await appState<{ prefs: { diffContext: number } }>(h.page)).prefs.diffContext).toBe(5)
  // One line of the joined block.
  await view().getByRole('row').filter({ hasText: /LINE 14/ }).getByTitle(/Pick this line/).click()
  await view().getByRole('button', { name: 'Stage 1 line' }).click()
  await expect.poll(() => h.git(repo, 'diff', '--cached', '--numstat')).toBe('1\t0\tctx.txt')
  expect(h.git(repo, 'show', ':ctx.txt')).toContain('LINE 14')
  expect(h.git(repo, 'show', ':ctx.txt')).not.toContain('LINE 5')
  h.git(repo, 'reset', '-q')
})

test('F75-H7: one line shows one line on each side; a block stages as shown; Settings has the same choice', async () => {
  await refocus()
  await aroundChanges(5, '1 line')
  await expect(blocks()).toHaveCount(2)
  await expect(view().getByRole('table', { name: /^@@ -4,3 \+4,3 @@/ })).toBeVisible()
  await blocks().nth(1).getByRole('button', { name: 'Stage hunk' }).click()
  await expect.poll(() => h.git(repo, 'diff', '--cached', '--numstat')).toBe('1\t1\tctx.txt')
  expect(h.git(repo, 'show', ':ctx.txt')).toContain('LINE 14')
  expect(h.git(repo, 'show', ':ctx.txt')).not.toContain('LINE 5')
  // The whole file has nothing to set.
  await view().getByRole('radio', { name: 'File' }).click()
  await view().getByRole('button', { name: 'Diff options' }).click()
  await expect(h.page.getByRole('menuitem', { name: 'Lines around changes: the whole file is shown' })).toBeDisabled()
  await h.page.keyboard.press('Escape')
  await expect(h.page.getByRole('menu')).toHaveCount(0)
  await view().getByRole('radio', { name: 'Changes' }).click()
  await h.page.getByRole('button', { name: 'Settings' }).click()
  await expect(h.page.getByRole('combobox', { name: 'Lines around changes' })).toHaveText('1')
  h.git(repo, 'reset', '-q')
  h.git(repo, 'checkout', '--', 'ctx.txt')
})

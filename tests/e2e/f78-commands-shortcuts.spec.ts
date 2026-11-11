// F78: your own git commands, with questions, on the menus of what they run on and in the palette; and keyboard
// shortcuts you can change, take away or put back, for the app's commands and yours.
import { test, expect } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { axe, commitRow, dialog, gitIn, grid, launch, makeRepo, openWip, seed, toGraph, type Harness } from './harness'

let h: Harness
const repo = join(seed, 'commands')

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => {
  h = await launch('commands', {
    open: [repo],
    setup: (env) => {
      makeRepo(env, 'commands', [
        ['Base', { 'a.txt': 'a\n' }],
        ['Second', { 'b.txt': 'b\n' }]
      ])
      gitIn(env, repo, 'branch', 'feature', 'HEAD~1')
    }
  })
  await h.page.getByRole('tab', { name: 'commands', exact: true }).click()
  await grid(h.page).waitFor()
})
test.afterAll(async () => {
  await h.close()
})
test.afterEach(() => h.expectClean())

const toasts = () => h.page.getByRole('region', { name: /Notifications/ })
const settings = () => h.page.getByRole('region', { name: 'Settings' })
const commandsList = () => settings().getByRole('list', { name: 'Your commands' })
const shortcuts = () => settings().getByRole('region', { name: 'Keyboard shortcuts' })
async function clean(): Promise<void> {
  const v = await axe(h.page)
  expect(v, v.map((x) => `${x.id} ${x.targets.join(', ')}`).join('\n')).toEqual([])
}
/** The keys shown on a row of Settings › Keyboard shortcuts. */
const keysOf = (label: string) => shortcuts().getByRole('listitem', { name: label, exact: true }).locator('[data-keys]')
const leftRail = () => h.page.getByRole('navigation', { name: 'Branches and tags (collapsed)' })

async function openSettings(): Promise<void> {
  await toGraph(h.page)
  await h.page.getByRole('button', { name: 'Settings' }).click()
  await expect(settings()).toBeVisible()
}

async function addCommand(name: string, command: string, opts: { output?: boolean; confirm?: boolean } = {}): Promise<void> {
  await settings().getByRole('button', { name: 'New command…' }).click()
  await dialog(h.page).getByRole('textbox', { name: 'Name' }).fill(name)
  await dialog(h.page).getByRole('textbox', { name: 'Git command' }).fill(command)
  if (opts.output === false) await dialog(h.page).getByRole('switch', { name: 'Show what it prints' }).click()
  if (opts.confirm) await dialog(h.page).getByRole('switch', { name: 'Show the command line before running it' }).click()
  await dialog(h.page).getByRole('button', { name: 'Add the command' }).click()
  await expect(commandsList().getByText(name, { exact: true })).toBeVisible()
}

test('F78-H1: a commit command asks its question, shows the command line and runs on the commit you right-clicked', async () => {
  await openSettings()
  await settings().getByRole('button', { name: 'New command…' }).click()
  await dialog(h.page).getByRole('textbox', { name: 'Git command' }).fill('tag "{?Tag name=v1} {commit}')
  await expect(dialog(h.page).getByText('A double quote isn’t closed.')).toBeVisible()
  await dialog(h.page).getByRole('textbox', { name: 'Git command' }).fill('git tag {?Tag name=v1} {commit}')
  await expect(dialog(h.page).getByRole('status')).toHaveText(/On a commit’s menu/)
  await clean()
  await dialog(h.page).getByRole('textbox', { name: 'Name' }).fill('Tag it')
  await dialog(h.page).getByRole('switch', { name: 'Show what it prints' }).click()
  await dialog(h.page).getByRole('button', { name: 'Add the command' }).click()
  await expect(commandsList().getByText('git git tag {?Tag name=v1} {commit}')).toHaveCount(0)
  await expect(commandsList()).toContainText('git tag {?Tag name=v1} {commit}')

  await toGraph(h.page)
  const base = h.git(repo, 'rev-parse', 'HEAD~1')
  await commitRow(h.page, 'Base').click({ button: 'right' })
  await h.page.getByRole('menuitem', { name: 'Your commands' }).click()
  await h.page.getByRole('menu').last().getByRole('menuitem', { name: 'Tag it' }).press('Enter')
  await expect(dialog(h.page).getByRole('heading', { name: 'Tag it' })).toBeVisible()
  const field = dialog(h.page).getByRole('textbox', { name: 'Tag name' })
  await expect(field).toHaveValue('v1')
  await expect(dialog(h.page).getByLabel('Command line')).toHaveText(`git tag v1 ${base}`)
  await clean()
  await field.fill('first release')
  // One argument with a space in it: shown quoted, and git says it's not a valid tag name.
  await expect(dialog(h.page).getByLabel('Command line')).toHaveText(`git tag "first release" ${base}`)
  await field.fill('v2')
  await dialog(h.page).getByRole('button', { name: 'Run' }).click()
  await expect(dialog(h.page)).toHaveCount(0)
  await expect(toasts().getByText('Tag it: done')).toBeVisible()
  expect(h.git(repo, 'tag', '--points-at', base)).toBe('v2')
})

test('F78-H2: a command with no commit, branch or file runs from the palette and shows what it prints', async () => {
  await openSettings()
  await addCommand('Short log', 'log --format=%s -n {?How many=1}')
  await toGraph(h.page)
  // On no menu: it needs nothing to run on.
  await commitRow(h.page, 'Second').click({ button: 'right' })
  await expect(h.page.getByRole('menuitem', { name: 'Your commands' })).toBeVisible()
  await h.page.getByRole('menuitem', { name: 'Your commands' }).click()
  await expect(h.page.getByRole('menu').last().getByRole('menuitem', { name: 'Short log' })).toHaveCount(0)
  await h.page.keyboard.press('Escape')
  await h.page.keyboard.press('Escape')

  await h.page.keyboard.press('Control+P')
  await h.page.getByRole('dialog').getByRole('group', { name: 'Your commands' }).getByRole('option', { name: 'Short log' }).click()
  await dialog(h.page).getByRole('textbox', { name: 'How many' }).fill('2')
  await dialog(h.page).getByRole('textbox', { name: 'How many' }).press('Enter')
  await expect(dialog(h.page).getByRole('status')).toHaveText('Finished.')
  await expect(dialog(h.page).getByLabel('Output')).toHaveText('Second\nBase')
  await clean()
  await dialog(h.page).getByRole('button', { name: 'Close' }).last().click()
  await expect(dialog(h.page)).toHaveCount(0)
})

test('F78-H3: a branch command runs on the branch you right-clicked; a failing one says so with its exit code', async () => {
  await openSettings()
  await addCommand('Tip of', 'log --format=%s -n 1 {branch}')
  await addCommand('Broken', 'show {?What=no-such-thing}', { confirm: true })
  await toGraph(h.page)
  await h.page.getByRole('treeitem', { name: /^feature/ }).click({ button: 'right' })
  await h.page.getByRole('menuitem', { name: 'Your commands' }).click()
  await h.page.getByRole('menu').last().getByRole('menuitem', { name: 'Tip of' }).press('Enter')
  await expect(dialog(h.page).getByLabel('Output')).toHaveText('Base')
  await dialog(h.page).getByRole('button', { name: 'Close' }).last().click()

  await h.page.keyboard.press('Control+P')
  await h.page.getByRole('dialog').getByRole('option', { name: 'Broken' }).click()
  await expect(dialog(h.page).getByLabel('Command line')).toHaveText('git show no-such-thing')
  await dialog(h.page).getByRole('button', { name: 'Run' }).click()
  await expect(dialog(h.page).getByRole('status')).toHaveText('Failed with exit code 128.')
  await expect(dialog(h.page).getByLabel('Output')).toContainText('no-such-thing')
  await dialog(h.page).getByRole('button', { name: 'Close' }).last().click()
})

test('F78-H4: a file command is on the changed file’s menu, and a file name starting with - is refused', async () => {
  await openSettings()
  await addCommand('Count lines', 'diff --numstat {file}', { output: false })
  writeFileSync(join(repo, 'a.txt'), 'a\nmore\n')
  writeFileSync(join(repo, '-n'), 'tricky\n')
  await openWip(h.page)
  const unstaged = h.page.getByRole('listbox', { name: /Not staged/ })
  await unstaged.getByRole('option', { name: 'Modified a.txt' }).click({ button: 'right' })
  await h.page.getByRole('menuitem', { name: 'Your commands' }).click()
  await h.page.getByRole('menu').last().getByRole('menuitem', { name: 'Count lines' }).press('Enter')
  await expect(toasts().getByText('Count lines: done')).toBeVisible()
  await expect(toasts().getByText(/^1\s+0\s+a\.txt$/)).toBeVisible()

  await unstaged.getByRole('option', { name: 'Untracked -n' }).click({ button: 'right' })
  await h.page.getByRole('menuitem', { name: 'Your commands' }).click()
  await h.page.getByRole('menu').last().getByRole('menuitem', { name: 'Count lines' }).press('Enter')
  await expect(toasts().getByText('Can’t run Count lines')).toBeVisible()
  await expect(toasts().getByText(/“-n” starts with “-”.*Put -- before \{file\}/)).toBeVisible()
})

test('F78-H5: change a shortcut; the old key stops, the new one works, and the menus and the list show it', async () => {
  await openSettings()
  const row = shortcuts().getByRole('button', { name: 'Change the shortcut for Collapse or expand the branches panel' })
  await expect(keysOf('Collapse or expand the branches panel')).toHaveText('CtrlJ')
  await row.click()
  await expect(shortcuts().getByRole('button', { name: 'Press the keys for Collapse or expand the branches panel' })).toBeVisible()
  // A key on its own, and one kept for something else, aren't taken.
  await h.page.keyboard.press('g')
  await expect(shortcuts().getByRole('alert')).toHaveText(/Use Ctrl or Alt with it/)
  await h.page.keyboard.press('Control+C')
  await expect(shortcuts().getByRole('alert')).toHaveText('Ctrl+C is kept for copying.')
  await h.page.keyboard.press('Alt+B')
  await expect(keysOf('Collapse or expand the branches panel')).toHaveText('AltB')
  await expect(shortcuts().getByRole('button', { name: 'Put back Ctrl+J for Collapse or expand the branches panel' })).toBeVisible()

  await toGraph(h.page)
  await grid(h.page).focus()
  await h.page.keyboard.press('Control+J')
  await expect(leftRail()).toHaveCount(0)
  await h.page.keyboard.press('Alt+B')
  await expect(leftRail()).toBeVisible()
  await h.page.keyboard.press('Alt+B')
  await expect(leftRail()).toHaveCount(0)
  await h.page.keyboard.press('Control+/')
  const sheet = dialog(h.page).getByRole('group', { name: 'Shortcuts' })
  await expect(sheet.getByRole('row', { name: /Collapse or expand the branches panel/ })).toContainText('AltB')
  await h.page.keyboard.press('Escape')
})

test('F78-H6: a key another command has can be moved over; the other is left without one', async () => {
  await openSettings()
  await shortcuts().getByRole('button', { name: 'Change the shortcut for Command palette' }).click()
  await h.page.keyboard.press('Control+L')
  await expect(shortcuts().getByRole('alert')).toContainText('Ctrl+L is the shortcut for Fetch all.')
  await clean()
  await shortcuts().getByRole('button', { name: 'Use it here instead' }).click()
  await expect(keysOf('Command palette')).toHaveText('CtrlL')
  await expect(keysOf('Fetch all')).toHaveText('None')
  // And a command with no key out of the box gets one: Esc while listening leaves it as it was.
  const pull = shortcuts().getByRole('button', { name: 'Change the shortcut for Pull', exact: true })
  await pull.click()
  await h.page.keyboard.press('Escape')
  await expect(keysOf('Pull')).toHaveText('None')
  await expect(settings()).toBeVisible()

  await toGraph(h.page)
  await h.page.keyboard.press('Control+L')
  await expect(h.page.getByRole('dialog').getByRole('combobox')).toBeVisible()
  await expect(h.page.getByRole('option', { name: /Fetch all remotes/ })).toBeVisible()
  await h.page.keyboard.press('Escape')
  await h.page.keyboard.press('Control+P')
  await expect(h.page.getByRole('dialog')).toHaveCount(0)
})

test('F78-H7: your command can have a shortcut too; Put every shortcut back undoes them all', async () => {
  await openSettings()
  await shortcuts().getByRole('group', { name: 'Your commands' }).getByRole('button', { name: 'Change the shortcut for Short log' }).click()
  await h.page.keyboard.press('F6')
  await expect(keysOf('Short log')).toHaveText('F6')
  await toGraph(h.page)
  await h.page.keyboard.press('F6')
  await expect(dialog(h.page).getByRole('heading', { name: 'Short log' })).toBeVisible()
  await h.page.keyboard.press('Escape')
  await h.page.keyboard.press('Control+/')
  await expect(dialog(h.page).getByRole('region', { name: 'Others you set' }).getByRole('row', { name: /Short log/ })).toContainText('F6')
  await dialog(h.page).getByRole('button', { name: 'Change shortcuts…' }).click()
  await expect(shortcuts()).toBeInViewport()
  await shortcuts().getByRole('button', { name: 'Put every shortcut back' }).click()
  await expect(keysOf('Fetch all')).toHaveText('CtrlL')
  await expect(keysOf('Short log')).toHaveText('None')
  await toGraph(h.page)
  await h.page.keyboard.press('Control+P')
  await expect(h.page.getByRole('dialog').getByRole('combobox')).toBeVisible()
  await h.page.keyboard.press('Escape')
})

test('F78-H8: deleting a command takes its shortcut too, and Put it back returns both', async () => {
  await openSettings()
  await shortcuts().getByRole('button', { name: 'Change the shortcut for Tip of' }).click()
  await h.page.keyboard.press('Alt+T')
  await commandsList().getByRole('button', { name: 'Delete Tip of' }).click()
  await expect(commandsList().getByText('Tip of', { exact: true })).toHaveCount(0)
  await expect(shortcuts().getByRole('button', { name: 'Change the shortcut for Tip of' })).toHaveCount(0)
  await toasts().getByRole('button', { name: 'Put it back' }).click()
  await expect(commandsList().getByText('Tip of', { exact: true })).toBeVisible()
  await expect(keysOf('Tip of')).toHaveText('AltT')
  // Changing it keeps its place and its shortcut.
  await commandsList().getByRole('button', { name: 'Change Tip of' }).click()
  await dialog(h.page).getByRole('textbox', { name: 'Name' }).fill('Tip of the branch')
  await dialog(h.page).getByRole('button', { name: 'Save' }).click()
  await expect(commandsList().getByRole('listitem').nth(2)).toContainText('Tip of the branch')
  await expect(keysOf('Tip of the branch')).toHaveText('AltT')
})

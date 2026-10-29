// F48: pick several local branches or tags (Ctrl / Shift-click), then push or delete them at once: one question, one
// undo. Unmerged branches ask again; the checked-out branch and ones in another worktree are left alone. Deleting can
// also delete them on the remote, and says undo only brings back the local ones.
import { test, expect } from '@playwright/test'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dialog, gitIn, launch, makeRepo, seed, type Harness } from './harness'

let h: Harness
const repo = join(seed, 'many-br')
const other = `${repo}-wtb`
const origin = join(seed, 'many-br-origin.git')
const names = ['alpha', 'beta', 'gamma']

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => {
  h = await launch('manybr', {
    open: [repo],
    setup: (env) => {
      for (const d of [repo, other, origin]) rmSync(d, { recursive: true, force: true })
      makeRepo(env, 'many-br', [
        ['Start', { 'README.md': 'hi\n' }],
        ['Second', { 'a.txt': 'a\n' }]
      ])
      for (const b of [...names, 'wtb']) gitIn(env, repo, 'branch', b)
      gitIn(env, repo, 'switch', '-q', '-c', 'delta')
      gitIn(env, repo, 'commit', '-q', '--allow-empty', '-m', 'Only on delta')
      gitIn(env, repo, 'switch', '-q', 'main')
      gitIn(env, repo, 'worktree', 'add', '-q', other, 'wtb')
      gitIn(env, seed, 'init', '-q', '--bare', origin)
      gitIn(env, repo, 'remote', 'add', 'origin', origin)
    }
  })
  await h.page.getByRole('tab', { name: 'many-br', exact: true }).click()
})
test.afterAll(async () => {
  await h.close()
  rmSync(other, { recursive: true, force: true })
})
test.afterEach(() => h.expectClean())

const tree = () => h.page.getByRole('tree', { name: 'Local branches' })
const branch = (name: string) => tree().getByRole('treeitem', { name: new RegExp(`^${name}(,|$)`) })
const status = () => h.page.getByRole('status').filter({ hasText: /\d+ picked/ })
const toasts = () => h.page.getByRole('region', { name: /Notifications/ })
const exists = (name: string): string | null => h.gitOr(repo, 'rev-parse', '-q', '--verify', `refs/heads/${name}`)() || null

test('F48-H1: Ctrl-click picks several; Delete 3 branches removes them, one undo brings them all back', async () => {
  const shas = names.map((n) => h.git(repo, 'rev-parse', n))
  await branch('alpha').click()
  await branch('beta').click({ modifiers: ['Control'] })
  await branch('gamma').click({ modifiers: ['Control'] })
  await expect(status()).toHaveText(/3 picked/)
  for (const n of names) await expect(branch(n)).toHaveAttribute('aria-selected', 'true')
  await expect(branch('main')).not.toHaveAttribute('aria-selected', 'true')
  await branch('beta').click({ button: 'right' })
  await h.page.getByRole('menuitem', { name: 'Delete 3 branches…' }).click()
  await expect(dialog(h.page)).toContainText('Delete 3 branches?')
  await expect(dialog(h.page)).toContainText('alpha, beta, gamma')
  await dialog(h.page).getByRole('button', { name: 'Delete 3 branches' }).click()
  await expect(toasts().getByText('Deleted 3 branches')).toBeVisible()
  for (const n of names) await expect(branch(n)).toHaveCount(0)
  expect(names.map(exists)).toEqual([null, null, null])
  await expect(status()).toHaveCount(0)

  await h.page.getByRole('button', { name: /^Undo: Delete 3 branches/ }).click()
  for (const n of names) await expect(branch(n)).toHaveCount(1)
  expect(names.map((n) => h.git(repo, 'rev-parse', n))).toEqual(shas)
  await h.page.getByRole('button', { name: /^Redo: Delete 3 branches/ }).click()
  for (const n of names) await expect(branch(n)).toHaveCount(0)
  await h.page.getByRole('button', { name: /^Undo: Delete 3 branches/ }).click()
  for (const n of names) await expect(branch(n)).toHaveCount(1)
})

test('F48-H2: Shift-click picks a range; the Delete key asks; an unmerged one asks again, then goes too', async () => {
  await branch('alpha').click()
  await branch('gamma').click({ modifiers: ['Shift'] })
  // In the panel's order: alpha, beta, delta, gamma.
  await expect(status()).toHaveText(/4 picked/)
  await expect(branch('delta')).toHaveAttribute('aria-selected', 'true')
  await branch('gamma').press('Delete')
  await expect(dialog(h.page)).toContainText('Delete 4 branches?')
  await dialog(h.page).getByRole('button', { name: 'Delete 4 branches' }).click()
  await expect(dialog(h.page)).toContainText('delta isn’t merged')
  await expect(dialog(h.page)).toContainText('The other 3 are deleted.')
  expect(['alpha', 'beta', 'gamma', 'delta'].map(exists)).toEqual([null, null, null, h.git(repo, 'rev-parse', 'delta')])
  await dialog(h.page).getByRole('button', { name: 'Delete anyway' }).click()
  await expect(branch('delta')).toHaveCount(0)
  expect(exists('delta')).toBeNull()
  await expect(branch('main')).toHaveCount(1)
})

test('F48-H3: the checked-out branch and a branch in another worktree stay; Escape clears the pick', async () => {
  for (const b of ['alpha', 'beta']) h.git(repo, 'branch', b)
  await expect(branch('beta')).toHaveCount(1)
  await branch('alpha').click()
  for (const b of ['beta', 'main', 'wtb']) await branch(b).click({ modifiers: ['Control'] })
  await expect(status()).toHaveText(/4 picked/)
  await status().getByRole('button', { name: 'Delete 2 branches…' }).click()
  await expect(dialog(h.page)).toContainText('Delete 2 branches?')
  await expect(dialog(h.page)).toContainText('main, wtb stay: they’re checked out.')
  await dialog(h.page).getByRole('button', { name: 'Cancel' }).click()
  expect(exists('alpha')).not.toBeNull()

  await branch('beta').press('Escape')
  await expect(status()).toHaveCount(0)
  // Only undeletable branches picked: the menu says why.
  await branch('main').click()
  await branch('wtb').click({ modifiers: ['Control'] })
  await branch('wtb').click({ button: 'right' })
  await expect(h.page.getByRole('menuitem', { name: 'Delete… (checked out)' })).toBeDisabled()
  await h.page.keyboard.press('Escape')
})

const onOrigin = (ref: string): string | null => h.gitOr(origin, 'rev-parse', '-q', '--verify', ref)() || null

test('F48-H4: Push 2 branches pushes both and sets their upstream; deleting them can also delete them on origin', async () => {
  for (const b of ['alpha', 'beta']) expect(onOrigin(`refs/heads/${b}`)).toBeNull()
  await branch('alpha').click()
  await branch('beta').click({ modifiers: ['Control'] })
  await expect(status()).toHaveText(/2 picked/)
  await status().getByRole('button', { name: 'Push 2 branches' }).click()
  await expect(toasts().getByText('Pushed 2 branches')).toBeVisible()
  for (const b of ['alpha', 'beta']) {
    expect(onOrigin(`refs/heads/${b}`)).toBe(h.git(repo, 'rev-parse', b))
    expect(h.git(repo, 'rev-parse', '--abbrev-ref', `${b}@{upstream}`)).toBe(`origin/${b}`)
  }

  const remotes = h.page.getByRole('tree', { name: 'Remotes' })
  for (const b of ['alpha', 'beta']) await expect(remotes.getByRole('treeitem', { name: new RegExp(`^${b}( |$)`) })).toHaveCount(1)
  await branch('alpha').click({ button: 'right' })
  await h.page.getByRole('menuitem', { name: 'Delete 2 branches…' }).click()
  const also = dialog(h.page).getByRole('checkbox', { name: 'Also delete them on origin' })
  await expect(also).not.toBeChecked()
  // Said under the checkbox before it's ticked: undo won't bring them back on origin.
  await expect(dialog(h.page)).toContainText('Undo only brings back the local branches. Deleting on origin can’t be undone')
  await also.click()
  await dialog(h.page).getByRole('button', { name: 'Delete 2 branches' }).click()
  await expect(toasts().getByText('Deleted 2 branches from origin')).toBeVisible()
  for (const b of ['alpha', 'beta']) {
    expect(exists(b)).toBeNull()
    expect(onOrigin(`refs/heads/${b}`)).toBeNull()
  }
})

test('F48-H5: tags too: Shift-click picks them, Push 3 tags pushes them, Delete 3 tags (also on origin) removes them; undo brings the local ones back', async () => {
  const tagNames = ['v1', 'v2', 'v3']
  h.git(repo, 'tag', 'v1')
  h.git(repo, 'tag', '-a', 'v2', '-m', 'Second')
  h.git(repo, 'tag', 'v3')
  const tagTree = () => h.page.getByRole('tree', { name: 'Tags' })
  const tagRow = (n: string) => tagTree().getByRole('treeitem', { name: new RegExp(`^${n}( |$)`) })
  await expect(tagRow('v3')).toBeVisible()
  const objs = tagNames.map((t) => h.git(repo, 'rev-parse', `refs/tags/${t}`))
  await tagRow('v1').click()
  await tagRow('v3').click({ modifiers: ['Shift'] })
  await expect(status()).toHaveText(/3 picked/)
  await tagRow('v2').click({ button: 'right' })
  await h.page.getByRole('menuitem', { name: 'Push 3 tags' }).click()
  await expect(toasts().getByText('Pushed 3 tags to origin')).toBeVisible()
  expect(tagNames.map((t) => onOrigin(`refs/tags/${t}`))).toEqual(objs)

  await tagRow('v2').press('Delete')
  await expect(dialog(h.page)).toContainText('Delete 3 tags?')
  await expect(dialog(h.page)).toContainText('Undo only brings back the local tags. Deleting on origin can’t be undone')
  await dialog(h.page).getByRole('checkbox', { name: 'Also delete them on origin' }).click()
  await dialog(h.page).getByRole('button', { name: 'Delete 3 tags' }).click()
  await expect(toasts().getByText('Deleted 3 tags from origin')).toBeVisible()
  expect(tagNames.map((t) => onOrigin(`refs/tags/${t}`))).toEqual([null, null, null])
  await expect(tagTree()).toHaveCount(0)
  expect(h.git(repo, 'tag', '--list')).toBe('')

  await h.page.getByRole('button', { name: /^Undo: Delete 3 tags/ }).click()
  await expect(tagRow('v3')).toBeVisible()
  expect(tagNames.map((t) => h.git(repo, 'rev-parse', `refs/tags/${t}`))).toEqual(objs)
})

test('F48-H6: remote branches too: Ctrl-click two, the Delete key asks once, both go from origin', async () => {
  for (const b of ['r1', 'r2', 'r3']) h.git(repo, 'push', '-q', 'origin', `main:refs/heads/${b}`)
  h.git(repo, 'fetch', '-q', 'origin')
  const remote = (n: string) => h.page.getByRole('group', { name: 'origin' }).getByRole('treeitem', { name: n, exact: true })
  await expect(remote('r3')).toBeVisible()
  await remote('r1').click()
  await remote('r2').click({ modifiers: ['Control'] })
  await expect(status()).toHaveText(/2 picked/)
  await remote('r2').press('Delete')
  await expect(dialog(h.page)).toContainText('Delete 2 branches from origin?')
  await expect(dialog(h.page)).toContainText('origin/r1, origin/r2')
  await dialog(h.page).getByRole('button', { name: 'Delete from origin' }).click()
  await expect(toasts().getByText('Deleted 2 branches from origin')).toBeVisible()
  expect([onOrigin('refs/heads/r1'), onOrigin('refs/heads/r2')]).toEqual([null, null])
  expect(onOrigin('refs/heads/r3')).not.toBeNull()
  await expect(remote('r1')).toHaveCount(0)
  await expect(remote('r3')).toBeVisible()
})

test('F48-H7: stashes too: Shift-click picks three, Delete 3 stashes removes them, and one undo brings them back in order', async () => {
  for (const n of ['one', 'two', 'three']) {
    writeFileSync(join(repo, `stash-${n}.txt`), `${n}\n`)
    h.git(repo, 'stash', 'push', '-q', '-u', '-m', `stash ${n}`)
  }
  const before = h.git(repo, 'stash', 'list', '--format=%H %gs')
  const stashes = () => h.page.getByRole('tree', { name: 'Stashes' })
  const stash = (n: string) => stashes().getByRole('treeitem', { name: new RegExp(`stash ${n}$`) })
  await expect(stash('one')).toBeVisible()
  await stash('three').click()
  await stash('one').click({ modifiers: ['Shift'] })
  await expect(status()).toHaveText(/3 picked/)
  await stash('two').click({ button: 'right' })
  await h.page.getByRole('menuitem', { name: 'Delete 3 stashes…' }).click()
  await expect(dialog(h.page)).toContainText('Delete 3 stashes?')
  await dialog(h.page).getByRole('button', { name: 'Delete 3 stashes' }).click()
  await expect(toasts().getByText('Deleted 3 stashes')).toBeVisible()
  expect(h.git(repo, 'stash', 'list')).toBe('')
  await expect(stashes()).toHaveCount(0)

  await h.page.getByRole('button', { name: /^Undo: Delete 3 stashes/ }).click()
  await expect(stash('two')).toBeVisible()
  expect(h.git(repo, 'stash', 'list', '--format=%H %gs')).toBe(before)
})

test('F48-H8: one branch on origin: the checkbox says undo only brings back the local branch, and it does', async () => {
  h.git(repo, 'branch', 'solo')
  h.git(repo, 'push', '-q', '-u', 'origin', 'solo')
  const sha = h.git(repo, 'rev-parse', 'solo')
  await expect(branch('solo')).toBeVisible()
  await branch('solo').click({ button: 'right' })
  await h.page.getByRole('menuitem', { name: 'Delete…' }).click()
  await expect(dialog(h.page)).toContainText('Delete solo?')
  await expect(dialog(h.page)).toContainText('Undo only brings back the local branch. Deleting on origin can’t be undone, and affects everyone who uses it.')
  await dialog(h.page).getByRole('checkbox', { name: 'Also delete it on origin' }).click()
  await dialog(h.page).getByRole('button', { name: 'Delete branch' }).click()
  await expect(toasts().getByText('Deleted solo from origin')).toBeVisible()
  expect(onOrigin('refs/heads/solo')).toBeNull()
  await expect(branch('solo')).toHaveCount(0)

  await h.page.getByRole('button', { name: /^Undo: Delete/ }).click()
  await expect.poll(() => exists('solo')).toBe(sha)
  await expect(branch('solo')).toBeVisible()
  expect(onOrigin('refs/heads/solo')).toBeNull()
})

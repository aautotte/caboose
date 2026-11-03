// F69: merge options. Always make a merge commit (--no-ff), or squash a branch into one new commit with a message
// to write. Both undo; a squash that conflicts changes nothing.
import { test, expect } from '@playwright/test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { dialog, gitIn, launch, makeRepo, menu, seed, writeAndCommit, type Harness } from './harness'

let h: Harness
const repo = join(seed, 'merges')

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => {
  h = await launch('merges', {
    open: [repo],
    setup: (env) => {
      makeRepo(env, 'merges', [
        ['Base', { 'base.txt': 'base\n' }],
        ['Main edit', { 'base.txt': 'main\n' }]
      ])
      gitIn(env, repo, 'switch', '-q', '-c', 'small')
      writeAndCommit(env, repo, 'Small fix', { 'small.txt': 's\n' })
      gitIn(env, repo, 'switch', '-q', '-c', 'feature', 'main')
      writeAndCommit(env, repo, 'Feature one', { 'one.txt': '1\n' })
      writeAndCommit(env, repo, 'Feature two', { 'two.txt': '2\n' })
      gitIn(env, repo, 'switch', '-q', '-c', 'clash', 'main~1')
      writeAndCommit(env, repo, 'Clashing edit', { 'base.txt': 'clash\n' })
      gitIn(env, repo, 'switch', '-q', 'main')
    }
  })
  await h.page.getByRole('tab', { name: 'merges', exact: true }).click()
})
test.afterAll(async () => {
  await h.close()
})
test.afterEach(() => h.expectClean())

const toasts = () => h.page.getByRole('region', { name: /Notifications/ })
const local = (name: string) => h.page.getByRole('tree', { name: 'Local branches' }).getByRole('treeitem', { name: new RegExp(`^${name}`) })
const sha = (rev: string): string => h.git(repo, 'rev-parse', rev)
const parents = (rev: string): number => h.git(repo, 'rev-list', '--parents', '-n1', rev).split(' ').length - 1

test('F69-H1: a merge that could fast-forward makes a merge commit when asked; undo takes it off', async () => {
  const main0 = sha('main')
  await menu(h.page, local('small'), 'Merge into main with a merge commit')
  await expect(toasts().getByText('Merged small into main')).toBeVisible()
  expect(parents('main')).toBe(2)
  expect(sha('main^2')).toBe(sha('small'))
  await h.page.keyboard.press('Control+z')
  await expect.poll(() => sha('main')).toBe(main0)
})

test('F69-H2: a squash merge of one commit starts with its message', async () => {
  await menu(h.page, local('small'), 'Squash into one commit on main…')
  await expect(dialog(h.page).getByLabel('Summary')).toHaveValue('Small fix')
  await dialog(h.page).getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog(h.page)).toHaveCount(0)
})

test('F69-H3: a squash merge makes one commit with the branch’s changes; the branch isn’t marked merged', async () => {
  const main0 = sha('main')
  await menu(h.page, local('feature'), 'Squash into one commit on main…')
  await expect(dialog(h.page).getByText(/The changes from 2 commits on feature become one new commit on main/)).toBeVisible()
  await expect(dialog(h.page).getByLabel('Summary')).toHaveValue('Merge feature (squashed)')
  await expect(dialog(h.page).getByLabel('Description')).toHaveValue('* Feature one\n* Feature two')
  await dialog(h.page).getByLabel('Summary').fill('Add the feature')
  await dialog(h.page).getByRole('button', { name: 'Squash and commit' }).click()
  await expect(toasts().getByText('Squashed feature into one commit on main')).toBeVisible()
  expect(parents('main')).toBe(1)
  expect(sha('main~1')).toBe(main0)
  expect(h.git(repo, 'log', '-1', '--format=%B', 'main')).toBe('Add the feature\n\n* Feature one\n* Feature two')
  expect(h.git(repo, 'ls-tree', '--name-only', 'main')).toBe('base.txt\none.txt\ntwo.txt')
  expect(h.git(repo, 'branch', '--merged', 'main', '--format=%(refname:short)')).not.toContain('feature')
  expect(h.git(repo, 'status', '--porcelain')).toBe('')

  await h.page.keyboard.press('Control+z')
  await expect.poll(() => sha('main')).toBe(main0)
  expect(h.git(repo, 'status', '--porcelain')).toBe('')
})

test('F69-H4: a squash merge that conflicts puts everything back', async () => {
  const main0 = sha('main')
  await menu(h.page, local('clash'), 'Squash into one commit on main…')
  await dialog(h.page).getByRole('button', { name: 'Squash and commit' }).click()
  await expect(toasts().getByText(/clash conflicts with this branch, so nothing changed/)).toBeVisible()
  expect(sha('main')).toBe(main0)
  expect(h.git(repo, 'status', '--porcelain')).toBe('')
  expect(h.git(repo, 'show', 'main:base.txt')).toBe('main')
  expect(existsSync(join(repo, '.git', 'SQUASH_MSG'))).toBe(false)
})

// F57: the Not staged and Staged lists can show their files as a folder tree. Folders fold away, a folder that only
// holds one folder shares its row, and a folder's Stage / Unstage acts on every file under it.
import { test, expect } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, makeRepo, openWip, seed, type Harness } from './harness'

let h: Harness
const repo = join(seed, 'filetree')

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => {
  h = await launch('filetree', {
    open: [repo],
    setup: (env) => {
      makeRepo(env, 'filetree', [['Start', { 'top.txt': 'top\n', 'src/app/a.ts': 'a\n', 'src/app/b.ts': 'b\n', 'docs/guide.md': 'g\n' }]])
      for (const f of ['top.txt', 'src/app/a.ts', 'src/app/b.ts', 'docs/guide.md']) writeFileSync(join(repo, f), 'changed\n')
    }
  })
  await h.page.getByRole('tab', { name: 'filetree', exact: true }).click()
  await openWip(h.page)
})
test.afterAll(async () => {
  await h.close()
})
test.afterEach(() => h.expectClean())

const tree = (name: 'Not staged' | 'Staged') => h.page.getByRole('tree', { name: new RegExp(`^${name}`) })
const item = (side: 'Not staged' | 'Staged', name: string | RegExp) => tree(side).getByRole('treeitem', { name })

test('F57-H1: the switch shows folders as a tree, with single-folder chains on one row', async () => {
  const notStaged = h.page.getByRole('region', { name: /^Not staged/ })
  await notStaged.getByRole('button', { name: 'Show as a tree' }).click()
  await expect(item('Not staged', 'src/app')).toHaveAttribute('aria-expanded', 'true')
  await expect(item('Not staged', 'docs')).toHaveAttribute('aria-level', '1')
  await expect(item('Not staged', /a\.ts$/)).toHaveAttribute('aria-level', '2')
  await expect(item('Not staged', /top\.txt$/)).toHaveAttribute('aria-level', '1')
})

test('F57-H2: a folder folds by click and by arrow keys', async () => {
  await item('Not staged', 'src/app').click()
  await expect(item('Not staged', 'src/app')).toHaveAttribute('aria-expanded', 'false')
  await expect(item('Not staged', /a\.ts$/)).toHaveCount(0)
  await item('Not staged', 'src/app').press('ArrowRight')
  await expect(item('Not staged', /a\.ts$/)).toBeVisible()
  await item('Not staged', /a\.ts$/).press('ArrowLeft')
  await expect(item('Not staged', 'src/app')).toBeFocused()
  await item('Not staged', 'src/app').press('ArrowLeft')
  await expect(item('Not staged', 'src/app')).toHaveAttribute('aria-expanded', 'false')
  await item('Not staged', 'src/app').press('Enter')
  await expect(item('Not staged', 'src/app')).toHaveAttribute('aria-expanded', 'true')
})

test('F57-H3: a folder’s Stage and Unstage act on every file under it', async () => {
  await item('Not staged', 'src/app').getByTitle('Stage').click({ force: true })
  await expect(item('Staged', /a\.ts$/)).toBeVisible()
  await expect(item('Staged', /b\.ts$/)).toBeVisible()
  await expect(item('Not staged', 'src/app')).toHaveCount(0)
  await item('Staged', 'src/app').press('u')
  await expect(item('Not staged', /b\.ts$/)).toBeVisible()
  await expect(item('Staged', 'src/app')).toHaveCount(0)
})

test('F57-H4: the switch is remembered and goes back to a flat list', async () => {
  await expect(h.page.getByRole('region', { name: /^Staged/ }).getByRole('button', { name: 'Show as a flat list' })).toBeVisible()
  await h.page.getByRole('region', { name: /^Not staged/ }).getByRole('button', { name: 'Show as a flat list' }).click()
  await expect(h.page.getByRole('listbox', { name: /^Not staged/ }).getByRole('option', { name: /a\.ts/ })).toBeVisible()
})

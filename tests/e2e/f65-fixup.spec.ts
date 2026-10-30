// F65: fixing up older commits. Find the commit the changed lines come from, amend the staged changes into an older
// commit (unstaged ones stay, and undo stages them again), make a fixup! commit, and squash fixups into their commits.
import { test, expect } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { commitRow, launch, makeRepo, seed, type Harness } from './harness'

let h: Harness
const repo = join(seed, 'fixup')

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => {
  h = await launch('fixup', {
    open: [repo],
    setup: (env) => {
      makeRepo(env, 'fixup', [
        ['Base', { 'a.txt': '1\n2\n3\n4\n5\n', 'c.txt': 'c\n' }],
        ['Add b', { 'b.txt': 'b\n' }],
        ['Edit a', { 'a.txt': '1\n2\nthree\n4\n5\n' }],
        ['Top', { 'd.txt': 'd\n' }]
      ])
    }
  })
  await h.page.getByRole('tab', { name: 'fixup', exact: true }).click()
})
test.afterAll(async () => {
  await h.close()
})
test.afterEach(() => h.expectClean())

const toasts = () => h.page.getByRole('region', { name: /Notifications/ })
const refocus = () => h.page.evaluate(() => window.dispatchEvent(new Event('focus')))
const summaries = (): string[] => h.git(repo, 'log', '--format=%s').split('\n')
const fileAt = (rev: string, path: string): string => h.git(repo, 'show', `${rev}:${path}`)
const shaOf = (summary: string): string => h.git(repo, 'log', '--format=%H', `--grep=^${summary}$`, '-n1')
async function pick(summary: string, item: string): Promise<void> {
  await commitRow(h.page, summary).click({ button: 'right' })
  await h.page.getByRole('menuitem', { name: item }).click()
}

test('F65-H1: Find the commit these changes belong to selects the commit that last changed those lines', async () => {
  writeFileSync(join(repo, 'a.txt'), '1\n2\nTHREE\n4\n5\n')
  h.git(repo, 'add', 'a.txt')
  await refocus()
  await h.page.keyboard.press('Control+p')
  await h.page.keyboard.type('changes belong to')
  await h.page.keyboard.press('Enter')
  await expect(toasts().getByText(/^They belong to [0-9a-f]{7} Edit a$/)).toBeVisible()
  await expect(h.page.getByRole('region', { name: 'Details' }).getByText('Edit a', { exact: true })).toBeVisible()
})

let before = ''
let after = ''
test('F65-H2: Amend staged changes into an older commit; unstaged changes stay where they were', async () => {
  writeFileSync(join(repo, 'c.txt'), 'c, not ready\n')
  await refocus()
  before = h.git(repo, 'rev-parse', 'HEAD')
  await pick('Edit a', 'Amend staged changes into this commit')
  await expect(toasts().getByText(/^Put the staged changes into [0-9a-f]{7}$/)).toBeVisible()
  expect(summaries()).toEqual(['Top', 'Edit a', 'Add b', 'Base'])
  expect(fileAt(shaOf('Edit a'), 'a.txt')).toBe('1\n2\nTHREE\n4\n5')
  expect(h.git(repo, 'status', '--porcelain')).toBe('M c.txt')
  after = h.git(repo, 'rev-parse', 'HEAD')
})

test('F65-H3: undo stages the changes again; redo puts them back into the commit', async () => {
  // Undo resets the files, so it waits until nothing else is changed.
  h.git(repo, 'checkout', '--', 'c.txt')
  await refocus()
  await h.page.keyboard.press('Control+z')
  await expect.poll(() => h.git(repo, 'rev-parse', 'HEAD')).toBe(before)
  expect(h.git(repo, 'status', '--porcelain')).toBe('M  a.txt')
  await h.page.keyboard.press('Control+y')
  await expect.poll(() => h.git(repo, 'rev-parse', 'HEAD')).toBe(after)
  expect(h.git(repo, 'status', '--porcelain')).toBe('')
})

test('F65-H4: Create fixup commit makes a fixup! commit from the staged changes', async () => {
  writeFileSync(join(repo, 'b.txt'), 'b, fixed\n')
  h.git(repo, 'add', 'b.txt')
  await refocus()
  await pick('Add b', 'Create fixup commit for this commit')
  await expect(toasts().getByText(/^Made a fixup commit for/)).toBeVisible()
  expect(summaries()[0]).toBe('fixup! Add b')
})

test('F65-H5: Squash fixup commits puts each into the commit it names', async () => {
  await pick('fixup! Add b', 'Squash fixup commits into their commits')
  await expect(toasts().getByText('Squashed the fixup commits into their commits')).toBeVisible()
  expect(summaries()).toEqual(['Top', 'Edit a', 'Add b', 'Base'])
  expect(fileAt(shaOf('Add b'), 'b.txt')).toBe('b, fixed')
  expect(h.git(repo, 'status', '--porcelain')).toBe('')
})

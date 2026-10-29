// F58: a commit that leaves nothing staged or unstaged goes back to the commit list, instead of the file it showed
// with "Nothing staged in this file". With changes left, the file stays open.
import { test, expect } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { commitRow, grid, launch, makeRepo, openWip, seed, type Harness } from './harness'

let h: Harness
const repo = join(seed, 'aftercommit')

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => {
  h = await launch('aftercommit', {
    open: [repo],
    setup: (env) => {
      makeRepo(env, 'aftercommit', [['Start', { 'a.txt': 'a\n', 'b.txt': 'b\n' }]])
      writeFileSync(join(repo, 'a.txt'), 'a changed\n')
      writeFileSync(join(repo, 'b.txt'), 'b changed\n')
    }
  })
  await h.page.getByRole('tab', { name: 'aftercommit', exact: true }).click()
  await openWip(h.page)
})
test.afterAll(async () => {
  await h.close()
})
test.afterEach(() => h.expectClean())

const row = (side: 'Not staged' | 'Staged', path: string) =>
  h.page.getByRole('listbox', { name: new RegExp(`^${side}`) }).getByRole('option', { name: new RegExp(`${path.replace('.', '\\.')}$`) })
const view = (path: string) => h.page.getByRole('region', { name: `Changes in ${path}` })

async function commit(summary: string): Promise<void> {
  await h.page.getByLabel('Commit summary').fill(summary)
  await h.page.getByRole('form', { name: 'Commit' }).getByRole('button', { name: /^Commit/ }).click()
  await expect.poll(h.gitOr(repo, 'log', '-1', '--format=%s')).toBe(summary)
}

test('F58-H1: with changes left, the open file stays open after the commit', async () => {
  await row('Not staged', 'a.txt').click()
  await row('Not staged', 'a.txt').press('s')
  await expect(view('a.txt')).toContainText('Staged')
  await commit('Change a')
  await expect(row('Not staged', 'b.txt')).toBeVisible()
  await expect(view('a.txt')).toBeVisible()
})

test('F58-H2: a commit that takes everything goes back to the commit list', async () => {
  await row('Not staged', 'b.txt').click()
  await row('Not staged', 'b.txt').press('s')
  await expect(view('b.txt')).toContainText('Staged')
  await commit('Change b')
  await expect(commitRow(h.page, 'Change b')).toBeVisible()
  await expect(grid(h.page)).toBeVisible()
  await expect(view('b.txt')).toHaveCount(0)
  await expect(h.page.getByText('Nothing staged in this file')).toHaveCount(0)
})

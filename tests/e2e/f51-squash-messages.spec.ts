// F51: squashing keeps every commit's message. The dialog starts with the oldest commit's summary, then its
// description and each later commit's summary and description, oldest first, ready to edit.
import { test, expect } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dialog, gitIn, grid, launch, makeRepo, seed, type Harness } from './harness'

let h: Harness
const repo = join(seed, 'squash-msg')

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => {
  h = await launch('squashmsg', {
    open: [repo],
    setup: (env) => {
      makeRepo(env, 'squash-msg', [['Start', { 'README.md': 'hi\n' }]])
      const commit = (file: string, ...message: string[]): void => {
        writeFileSync(join(repo, file), `${file}\n`)
        gitIn(env, repo, 'add', '.')
        gitIn(env, repo, 'commit', '-q', ...message.flatMap((m) => ['-m', m]))
      }
      commit('a.txt', 'Add the parser', 'Reads the config file.\nKeeps comments.')
      commit('b.txt', 'Fix a typo')
      commit('c.txt', 'Handle empty files', 'An empty file used to crash the parser.')
    }
  })
  await h.page.getByRole('tab', { name: 'squash-msg', exact: true }).click()
})
test.afterAll(async () => {
  await h.close()
})
test.afterEach(() => h.expectClean())

const row = (summary: string) => grid(h.page).getByRole('row', { name: new RegExp(`^${summary},`) }).first()

test('F51-H1: squashing three commits starts with all their summaries and descriptions, oldest first', async () => {
  await row('Handle empty files').click()
  await row('Add the parser').click({ modifiers: ['Shift'] })
  await h.page.getByRole('region', { name: 'Details' }).getByRole('button', { name: 'Squash into one…' }).click()
  await expect(dialog(h.page).getByLabel('Summary')).toHaveValue('Add the parser')
  await expect(dialog(h.page).getByLabel('Description')).toHaveValue(
    'Reads the config file.\nKeeps comments.\n\nFix a typo\n\nHandle empty files\n\nAn empty file used to crash the parser.'
  )
  await dialog(h.page).getByRole('button', { name: 'Squash', exact: true }).click()
  await expect.poll(h.gitOr(repo, 'log', '-1', '--format=%B')).toBe(
    'Add the parser\n\nReads the config file.\nKeeps comments.\n\nFix a typo\n\nHandle empty files\n\nAn empty file used to crash the parser.'
  )
  expect(h.git(repo, 'rev-list', '--count', 'HEAD')).toBe('2')
})

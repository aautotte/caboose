// F93: in a changed line, the words that changed are marked, a shade stronger than the line, in every layout. A line
// rewritten from scratch isn't marked: all of it changed, and its colour already says so.
import { test, expect } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { axe, launch, makeRepo, openDiffNow, repoId, seed, type Harness } from './harness'

let h: Harness
const repo = join(seed, 'word-diff')
const before = ['const total = price * count', 'const label = `${name} <b>&</b>`', 'return compute(a, b)', 'one two three four five']
const after = ['const total = price * amount', 'const label = `${title} <b>&</b>`', 'return compute(a, b)', 'nothing in common at all here']
let id = ''

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => {
  h = await launch('word-diff', { open: [repo], setup: (env) => void makeRepo(env, 'word-diff', [['Start', { 'calc.ts': before.join('\n') + '\n' }]]) })
  writeFileSync(join(repo, 'calc.ts'), after.join('\n') + '\n')
  await h.page.getByRole('tab', { name: 'word-diff', exact: true }).click()
  await h.page.getByRole('row', { name: /Uncommitted changes/ }).waitFor()
  id = await repoId(h.page, repo)
  await openDiffNow(h.page, id, 'calc.ts', { kind: 'worktree' })
  await view().getByRole('mark').first().waitFor()
})
test.afterAll(() => h.close())
test.afterEach(() => h.expectClean())

const view = () => h.page.getByRole('region', { name: 'Changes in calc.ts' })
const line = (kind: 'added' | 'removed', text: string) => view().getByRole('row', { name: kind }).filter({ hasText: text })
const marked = async (row: ReturnType<typeof line>): Promise<string[]> => (await row.getByRole('mark').allTextContents()).filter((t) => t !== '')

test('F93-H1: one word changed: only that word is marked, on both lines', async () => {
  expect(await marked(line('removed', 'price * count'))).toEqual(['count'])
  expect(await marked(line('added', 'price * amount'))).toEqual(['amount'])
})

test('F93-H2: the syntax colours and the text stay as they are around a marked word', async () => {
  const row = line('added', '${title}')
  expect(await marked(row)).toEqual(['title'])
  await expect(row).toContainText('const label = `${title} <b>&</b>`')
  // Still coloured by the highlighter (a keyword), not only by the mark.
  await expect(row.locator('.hljs-keyword').first()).toHaveText('const')
})

test('F93-H3: a line rewritten from scratch isn’t marked', async () => {
  await expect(line('removed', 'one two three').getByRole('mark')).toHaveCount(0)
  await expect(line('added', 'nothing in common').getByRole('mark')).toHaveCount(0)
})

test('F93-H4: find in file finds a word that is marked', async () => {
  await view().getByRole('button', { name: 'Find in file' }).click()
  await h.page.getByRole('searchbox', { name: 'Find in file' }).or(h.page.getByRole('textbox', { name: 'Find in file' })).fill('amount')
  await expect(h.page.getByRole('search', { name: 'Find in file' }).getByRole('status')).toHaveText('1 of 1')
  await h.page.getByRole('button', { name: 'Close find' }).click()
})

test('F93-H5: the File and Split layouts mark the same words', async () => {
  await view().getByRole('radio', { name: 'File' }).click()
  await expect.poll(() => marked(line('added', 'price * amount'))).toEqual(['amount'])
  await view().getByRole('radio', { name: 'Split' }).click()
  const cells = view().getByRole('cell').filter({ has: h.page.getByRole('mark') })
  await expect.poll(async () => (await cells.getByRole('mark').allTextContents()).filter((t) => t !== '')).toEqual(['count', 'amount', 'name', 'title'])
  expect(await axe(h.page)).toEqual([])
  await view().getByRole('radio', { name: 'Changes' }).click()
})

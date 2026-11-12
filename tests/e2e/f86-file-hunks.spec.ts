// F86: the whole file (the File layout), with Stage hunk and Discard hunk above each hunk, and Unstage hunk in a
// staged file, as the Changes layout has them.
import { test, expect } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { axe, dialog, launch, makeRepo, openDiffNow, repoId, seed, type Harness } from './harness'

let h: Harness
const repo = join(seed, 'filehunks')
const base = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`)
const edited = [...base]
edited[5] = 'line 6, changed'
edited.splice(30, 2, 'new 31', 'new 32', 'new 33')
let id = ''

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => {
  h = await launch('file-hunks', { open: [repo], setup: (env) => void makeRepo(env, 'filehunks', [['Start', { 'ep.h': base.join('\n') + '\n' }]]) })
  writeFileSync(join(repo, 'ep.h'), edited.join('\n') + '\n')
  await h.page.getByRole('tab', { name: 'filehunks', exact: true }).click()
  await h.page.getByRole('row', { name: /Uncommitted changes/ }).waitFor()
  id = await repoId(h.page, repo)
})
test.afterAll(() => h.close())
test.afterEach(() => h.expectClean())

const view = () => h.page.getByRole('region', { name: 'Changes in ep.h' })
const hunk = (n: number, of: number) => view().getByRole('row', { name: `Hunk ${n} of ${of}` })

test('F86-H1: in the Changes layout, each hunk has Discard hunk and Stage hunk', async () => {
  await openDiffNow(h.page, id, 'ep.h', { kind: 'worktree' })
  await expect(view().getByRole('button', { name: 'Stage hunk' })).toHaveCount(2)
  await expect(view().getByRole('button', { name: 'Discard hunk' })).toHaveCount(2)
})

test('F86-H2: in the File layout, each hunk has its own buttons; staging one from the keyboard stages only it', async () => {
  await view().getByRole('radio', { name: 'File' }).click()
  await expect(hunk(1, 2)).toBeVisible()
  await expect(hunk(2, 2)).toBeVisible()
  // The bar on top acts on picked lines only: none picked, none there.
  await expect(view().getByRole('button', { name: /^Stage / })).toHaveCount(2)
  expect(await axe(h.page)).toEqual([])
  await hunk(2, 2).getByRole('button', { name: 'Stage hunk' }).focus()
  await h.page.keyboard.press('Enter')
  await expect(hunk(1, 1)).toBeVisible()
  await expect.poll(() => h.git(repo, 'diff', '--cached', '--name-only')).toBe('ep.h')
  expect(h.git(repo, 'diff', '--cached', '-U0')).toContain('+new 33')
  expect(h.git(repo, 'diff', '--cached', '-U0')).not.toContain('line 6, changed')
  expect(h.git(repo, 'diff', '-U0')).toContain('+line 6, changed')
})

test('F86-H3: Discard hunk asks, then puts that hunk back on disk', async () => {
  await hunk(1, 1).getByRole('button', { name: 'Discard hunk' }).click()
  await expect(dialog(h.page)).toContainText('Discard this hunk?')
  await dialog(h.page).getByRole('button', { name: 'Discard' }).click()
  await expect.poll(() => readFileSync(join(repo, 'ep.h'), 'utf8').split('\n')[5]).toBe('line 6')
  expect(readFileSync(join(repo, 'ep.h'), 'utf8')).toContain('new 33')
  expect(h.git(repo, 'diff')).toBe('')
})

test('F86-H4: in a staged file, Unstage hunk', async () => {
  await openDiffNow(h.page, id, 'ep.h', { kind: 'index' })
  await expect(hunk(1, 1)).toBeVisible()
  await expect(hunk(1, 1).getByRole('button', { name: 'Discard hunk' })).toHaveCount(0)
  await hunk(1, 1).getByRole('button', { name: 'Unstage hunk' }).click()
  await expect.poll(() => h.git(repo, 'diff', '--cached')).toBe('')
  expect(h.git(repo, 'diff', '-U0')).toContain('+new 33')
})

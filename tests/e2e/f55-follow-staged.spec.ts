// F55: the open file follows itself between the lists. Staged, its changes show from the staged side (and back when
// unstaged), whether by the row's button, the last block staged, or git add in a terminal.
import { test, expect } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, makeRepo, openWip, seed, type Harness } from './harness'

let h: Harness
const repo = join(seed, 'follow')
const lines = (n: number, change: (i: number) => string | null): string => Array.from({ length: n }, (_, i) => change(i) ?? `line ${i}`).join('\n') + '\n'

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => {
  h = await launch('follow', {
    open: [repo],
    setup: (env) => {
      makeRepo(env, 'follow', [['Start', { 'a.txt': lines(40, () => null), 'b.txt': 'b\n', 'c.txt': 'c\n' }]])
      // Two changes far apart in a.txt: two blocks, staged one at a time.
      writeFileSync(join(repo, 'a.txt'), lines(40, (i) => (i === 2 ? 'TWO' : i === 35 ? 'THIRTY-FIVE' : null)))
      writeFileSync(join(repo, 'b.txt'), 'b changed\n')
      writeFileSync(join(repo, 'c.txt'), 'c changed\n')
    }
  })
  await h.page.getByRole('tab', { name: 'follow', exact: true }).click()
  await openWip(h.page)
})
test.afterAll(async () => {
  await h.close()
})
test.afterEach(() => h.expectClean())

const list = (name: 'Not staged' | 'Staged') => h.page.getByRole('listbox', { name: new RegExp(`^${name}`) })
const row = (side: 'Not staged' | 'Staged', path: string) => list(side).getByRole('option', { name: new RegExp(`${path.replace('.', '\\.')}$`) })
const view = (path: string) => h.page.getByRole('region', { name: `Changes in ${path}` })

test('F55-H1: staging the open file keeps showing it, from the staged side; unstaging brings it back', async () => {
  await row('Not staged', 'b.txt').click()
  await expect(view('b.txt')).toContainText('Not staged')
  await row('Not staged', 'b.txt').press('s')
  await expect(view('b.txt')).toContainText('Staged')
  await expect(view('b.txt')).not.toContainText('No unstaged changes left')
  await expect(view('b.txt')).toContainText('b changed')
  await expect(row('Staged', 'b.txt')).toHaveAttribute('aria-selected', 'true')
  await row('Staged', 'b.txt').press('u')
  await expect(view('b.txt')).toContainText('Not staged')
  await expect(row('Not staged', 'b.txt')).toHaveAttribute('aria-selected', 'true')
})

test('F55-H2: staging one block of two stays on the unstaged side; staging the last one follows the file', async () => {
  await row('Not staged', 'a.txt').click()
  const stageBlock = view('a.txt').getByRole('button', { name: 'Stage block' })
  await expect(stageBlock).toHaveCount(2)
  await stageBlock.first().click()
  await expect(row('Staged', 'a.txt')).toBeVisible()
  await expect(view('a.txt')).toContainText('Not staged')
  await expect(stageBlock).toHaveCount(1)
  await stageBlock.first().click()
  await expect(view('a.txt')).toContainText('Staged')
  await expect(view('a.txt')).toContainText('THIRTY-FIVE')
})

test('F55-H3: git add in a terminal follows too', async () => {
  await row('Not staged', 'c.txt').click()
  await expect(view('c.txt')).toContainText('Not staged')
  h.git(repo, 'add', 'c.txt')
  await expect(view('c.txt')).toContainText('Staged')
  await expect(row('Staged', 'c.txt')).toHaveAttribute('aria-selected', 'true')
})

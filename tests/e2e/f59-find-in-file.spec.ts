// F59: find in the open file. Ctrl+F (or the search button) on an unstaged or staged file opens a find bar; every
// match is highlighted, Enter / Shift+Enter move between them, Esc closes the bar and then the diff.
import { test, expect } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gitIn, grid, launch, makeRepo, openWip, seed, type Harness } from './harness'

let h: Harness
const repo = join(seed, 'findfile')
const lines = (n: number, change: (i: number) => string | null): string => Array.from({ length: n }, (_, i) => change(i) ?? `const line${i} = ${i}`).join('\n') + '\n'

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => {
  h = await launch('findfile', {
    open: [repo],
    setup: (env) => {
      makeRepo(env, 'findfile', [['Start', { 'a.ts': lines(300, () => null), 'b.ts': 'export const b = 1\n' }]])
      // Three needles, the last one far down; the first one changed so it's in a block.
      writeFileSync(join(repo, 'a.ts'), lines(300, (i) => (i === 3 ? 'const needle = "Needle"' : i === 280 ? 'call(NEEDLE)' : null)))
      writeFileSync(join(repo, 'b.ts'), 'export const b = "needle"\n')
      gitIn(env, repo, 'add', 'b.ts')
    }
  })
  await h.page.getByRole('tab', { name: 'findfile', exact: true }).click()
  await openWip(h.page)
})
test.afterAll(async () => {
  await h.close()
})
test.afterEach(() => h.expectClean())

const row = (side: 'Not staged' | 'Staged', path: string) =>
  h.page.getByRole('listbox', { name: new RegExp(`^${side}`) }).getByRole('option', { name: new RegExp(`${path.replace('.', '\\.')}$`) })
const view = (path: string) => h.page.getByRole('region', { name: `Changes in ${path}` })
const box = () => h.page.getByRole('searchbox', { name: 'Find in file' }).or(h.page.getByRole('textbox', { name: 'Find in file' }))
const found = () => h.page.getByRole('search', { name: 'Find in file' }).getByRole('status')
const painted = (name: string) => h.page.evaluate((n) => CSS.highlights.get(n)?.size ?? 0, name)
/** Whether the current match is inside the diff's scrolling area, on screen. */
const currentOnScreen = (path: string) =>
  h.page.evaluate((label) => {
    const r = [...(CSS.highlights.get('diff-find-current') ?? [])][0] as Range | undefined
    const area = document.querySelector(`section[aria-label="${label}"] [aria-busy], section[aria-label="${label}"] div.overflow-auto`)
    if (!r || !area) return false
    const hit = r.getBoundingClientRect()
    const box = area.getBoundingClientRect()
    return hit.height > 0 && hit.top >= box.top && hit.bottom <= box.bottom
  }, `Changes in ${path}`)

test('F59-H1: Ctrl+F on an unstaged file finds every match, any case, and Enter walks them', async () => {
  await row('Not staged', 'a.ts').click()
  await view('a.ts').getByRole('radio', { name: 'File' }).click()
  await expect(view('a.ts')).toContainText('call(NEEDLE)')
  await h.page.keyboard.press('Control+f')
  await expect(box()).toBeFocused()
  await box().fill('needle')
  await expect(found()).toHaveText('1 of 3')
  await expect.poll(() => painted('diff-find')).toBe(3)
  await expect.poll(() => painted('diff-find-current')).toBe(1)
  await expect.poll(() => currentOnScreen('a.ts')).toBe(true)
  await box().press('Enter')
  await expect(found()).toHaveText('2 of 3')
  await box().press('Enter')
  await expect(found()).toHaveText('3 of 3')
  // The last one is far down: it was scrolled to.
  await expect.poll(() => currentOnScreen('a.ts')).toBe(true)
  await box().press('Enter')
  await expect(found()).toHaveText('1 of 3')
  await box().press('Shift+Enter')
  await expect(found()).toHaveText('3 of 3')
  // Across the highlighter's spans: a keyword, a name and a string.
  await box().fill('const needle = "n')
  await expect(found()).toHaveText('1 of 1')
  await box().fill('nothing like this')
  await expect(found()).toHaveText('No results')
  await expect.poll(() => painted('diff-find')).toBe(0)
})

test('F59-H2: on a staged file too; Esc closes the bar, then the diff', async () => {
  await row('Staged', 'b.ts').click()
  await expect(view('b.ts')).toContainText('Staged')
  // The bar stayed open with its search, and finds in the new file.
  await box().fill('NEEDLE')
  await expect(found()).toHaveText('1 of 1')
  await box().press('Escape')
  await expect(box()).toHaveCount(0)
  await expect(view('b.ts')).toBeVisible()
  await expect.poll(() => painted('diff-find')).toBe(0)
  await view('b.ts').getByRole('button', { name: 'Find in file' }).click()
  await expect(box()).toBeFocused()
  await expect(box()).toHaveValue('NEEDLE')
  await box().press('Escape')
  await h.page.keyboard.press('Escape')
  await expect(view('b.ts')).toHaveCount(0)
})

test('F59-H3: with no file open, Ctrl+F still searches the commits', async () => {
  await expect(grid(h.page)).toBeVisible()
  await grid(h.page).click()
  await h.page.keyboard.press('Control+f')
  await expect(h.page.getByRole('searchbox', { name: 'Search commits' }).or(h.page.getByRole('textbox', { name: 'Search commits' }))).toBeFocused()
})

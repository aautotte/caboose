// Every screen, reached through the UI as a user would, scanned with axe (WCAG 2.1 A/AA + best practices).
import { test, expect } from '@playwright/test'
import { axe, commitRow, dialog, launch, menu, openWip, toGraph, type AxeIssue, type Harness } from './harness'

let h: Harness
const found: Record<string, AxeIssue[]> = {}
const REPORT = process.env.A11Y_REPORT === '1'

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => {
  h = await launch('a11y')
  await h.page.getByRole('tab', { name: 'demo' }).click()
  await h.page.getByRole('row', { name: /Uncommitted changes/ }).waitFor()
})
test.afterAll(async () => {
  if (REPORT) console.log(JSON.stringify(found, null, 1))
  await h.close()
})

async function scan(screen: string): Promise<void> {
  await h.page.waitForTimeout(300)
  const v = await axe(h.page)
  found[screen] = v
  if (!REPORT) expect(v, `${screen}: ${v.map((x) => `${x.id} ${x.targets.join(', ')}`).join('\n')}`).toEqual([])
  h.expectClean()
}

test('S01 home', async () => {
  await h.page.getByRole('tab', { name: 'Repositories' }).click()
  await h.page.getByRole('region', { name: 'Recent' }).waitFor()
  await scan('S01')
})
test('S02 clone dialog', async () => {
  await h.page.getByRole('button', { name: /^Clone/ }).first().click()
  await dialog(h.page).waitFor()
  await scan('S02')
  await h.page.keyboard.press('Escape')
})
test('S03 new repository dialog', async () => {
  await h.page.getByRole('button', { name: /^New/ }).first().click()
  await dialog(h.page).waitFor()
  await scan('S03')
  await h.page.keyboard.press('Escape')
})
test('S04 repository view', async () => {
  await h.page.getByRole('tab', { name: 'demo' }).click()
  await commitRow(h.page, 'Print the real temperature in the CLI').click()
  await scan('S04')
})
test('S05 uncommitted changes', async () => {
  await openWip(h.page)
  await scan('S05')
})
test('S06 commit details (merge)', async () => {
  await commitRow(h.page, 'Merge branch feature/cache').click()
  await h.page.getByRole('heading', { name: 'Merge commit' }).waitFor()
  await scan('S06')
})
test('S07 diff', async () => {
  await openWip(h.page)
  await h.page.getByRole('listbox', { name: /Not staged/ }).getByRole('option', { name: /README\.md/ }).click()
  await h.page.getByRole('region', { name: 'Changes in README.md' }).waitFor()
  await scan('S07')
})
test('S08 blame', async () => {
  await h.page.getByRole('button', { name: 'Blame', exact: true }).click()
  await h.page.getByRole('table', { name: /README\.md, \d+ lines/ }).waitFor()
  await scan('S08')
})
test('S09 file history', async () => {
  await h.page.getByRole('button', { name: 'File history' }).click()
  await h.page.getByRole('region', { name: 'History of README.md' }).getByRole('option').first().waitFor()
  await scan('S09')
})
test('S11 interactive rebase', async () => {
  await toGraph(h.page)
  await menu(h.page, commitRow(h.page, 'Update the changelog (4)'), /^Rewrite main after this commit/)
  await h.page.getByRole('list', { name: 'Commits, oldest first' }).waitFor()
  await scan('S11')
})
test('S12 command palette', async () => {
  await toGraph(h.page)
  await h.page.keyboard.press('Control+p')
  await h.page.getByRole('dialog').waitFor()
  await scan('S12')
  await h.page.keyboard.press('Escape')
})
test('S13 settings', async () => {
  await h.page.getByRole('button', { name: 'Settings' }).click()
  await h.page.getByRole('region', { name: 'Settings' }).waitFor()
  await scan('S13')
})
test('S14 keyboard shortcuts', async () => {
  await toGraph(h.page)
  await h.page.keyboard.press('Control+/')
  await dialog(h.page).waitFor()
  await scan('S14')
  await h.page.keyboard.press('Escape')
})
test('S15 reset dialog', async () => {
  await menu(h.page, commitRow(h.page, 'Update the changelog (5)'), /^Reset main to this commit/)
  await dialog(h.page).waitFor()
  await scan('S15')
  await h.page.keyboard.press('Escape')
})
test('S16 activity log', async () => {
  await h.page.getByRole('button', { name: 'Git log' }).click()
  await h.page.getByRole('region', { name: /activity|log/i }).first().waitFor()
  await scan('S16')
})
test('S10 merge tool', async () => {
  await h.page.getByRole('tab', { name: 'conflict' }).click()
  await openWip(h.page)
  await h.page.getByRole('listbox', { name: /Not staged/ }).getByRole('option', { name: /notes\.md/ }).click()
  await h.page.getByRole('region', { name: /Resolve conflicts in notes\.md/ }).waitFor()
  await scan('S10')
})

// F43: the side panels collapse to a thin rail and expand again, from their buttons or Ctrl+J / Ctrl+K. The state
// is saved app-wide, and clicking commits doesn't reopen a collapsed details panel.
import { test, expect } from '@playwright/test'
import { axe, commitRow, demo, grid, invoke, launch, type Harness } from './harness'

let h: Harness

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => {
  h = await launch('panels', { open: [demo] })
  await h.page.getByRole('tab', { name: 'demo' }).click()
  await grid(h.page).waitFor()
})
test.afterAll(async () => {
  await h.close()
})
test.afterEach(() => h.expectClean())

const left = () => h.page.getByRole('navigation', { name: 'Branches and tags', exact: true })
const leftRail = () => h.page.getByRole('navigation', { name: 'Branches and tags (collapsed)' })
const details = () => h.page.getByRole('region', { name: 'Details', exact: true })
const detailRail = () => h.page.getByRole('region', { name: 'Details (collapsed)' })

test('F43-H1: collapse the branches panel to a rail; a section icon expands it at that section', async () => {
  await h.page.getByRole('button', { name: 'Collapse the branches panel' }).click()
  await expect(left()).toHaveCount(0)
  await expect(leftRail()).toBeVisible()
  // The rail shows each section with its count.
  await expect(leftRail().getByRole('button', { name: /^Local branches \(\d+\)$/ })).toBeVisible()
  await expect(leftRail().getByRole('button', { name: /^Stashes \(\d+\)$/ })).toBeVisible()
  await leftRail().getByRole('button', { name: /^Stashes/ }).click()
  await expect(left()).toBeVisible()
  await expect(left().getByRole('button', { name: /^Stashes/ })).toBeInViewport()
})

test('F43-H2: a collapsed details panel stays collapsed while you click commits, and shows the selection when expanded', async () => {
  await commitRow(h.page, 'Add Fahrenheit output').click()
  await details().getByRole('button', { name: 'Collapse the details panel' }).click()
  await expect(details()).toHaveCount(0)
  await expect(detailRail()).toBeVisible()
  await commitRow(h.page, 'Use the cache before calling the API').click()
  await expect(details()).toHaveCount(0)
  await detailRail().getByRole('button', { name: 'Expand the details panel' }).click()
  await expect(details().getByText('Use the cache before calling the API')).toBeVisible()
})

test('F43-K1: Ctrl+J and Ctrl+K collapse and expand the same panels', async () => {
  await grid(h.page).focus()
  await h.page.keyboard.press('Control+J')
  await expect(leftRail()).toBeVisible()
  await h.page.keyboard.press('Control+K')
  await expect(detailRail()).toBeVisible()
  // Both rails pass the accessibility scan.
  const v = await axe(h.page)
  expect(v, v.map((x) => `${x.id} ${x.targets.join(', ')}`).join('\n')).toEqual([])
  await h.page.keyboard.press('Control+K')
  await expect(details()).toBeVisible()
})

test('F43-H3: the collapsed state is saved and comes back after a restart', async () => {
  // The branches panel is still collapsed from the last test.
  await expect(leftRail()).toBeVisible()
  expect(await invoke(h.page, 'prefs.getAll', {})).toMatchObject({ ok: true, value: { leftCollapsed: true, detailCollapsed: false } })
  await h.close()
  h = await launch('panels', { open: [demo], reseed: false, keepUserData: true })
  await h.page.getByRole('tab', { name: 'demo' }).click()
  await grid(h.page).waitFor()
  await expect(leftRail()).toBeVisible()
  await expect(details()).toBeVisible()
  await leftRail().getByRole('button', { name: 'Expand the branches panel' }).click()
  await expect(left()).toBeVisible()
})

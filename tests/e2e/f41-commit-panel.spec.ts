// F41: a commit with a long message: the message scrolls inside the details panel, and the file list keeps room.
import { test, expect } from '@playwright/test'
import { join } from 'node:path'
import { commitRow, grid, launch, makeRepo, seed, type Harness } from './harness'

let h: Harness
const body = Array.from({ length: 80 }, (_, i) => `- review note ${i + 1}: address the comment on the driver and its HAL`).join('\n')

test.beforeAll(async () => {
  h = await launch('commit-panel', {
    open: [join(seed, 'long-message')],
    setup: (env) => {
      makeRepo(env, 'long-message', [
        ['Start', { 'a.txt': 'a\n' }],
        [`Squashed review rounds\n\n${body}`, { 'b.txt': 'b\n', 'c.txt': 'c\n' }]
      ])
    }
  })
  await h.page.getByRole('tab', { name: 'long-message' }).click()
  await grid(h.page).waitFor()
})
test.afterAll(async () => {
  await h.close()
})

test('F41-E1: a long commit message scrolls in the panel, and the changed files stay in view', async () => {
  await commitRow(h.page, 'Squashed review rounds').click()
  const last = h.page.getByText(/review note 80:/)
  await expect(last).toBeAttached()
  // The changed files are still on screen under the message.
  await expect(h.page.getByRole('option', { name: /c\.txt/ })).toBeInViewport()
  // The end of the message can be scrolled to.
  await last.scrollIntoViewIfNeeded()
  await expect(last).toBeInViewport()
  h.expectClean()
})

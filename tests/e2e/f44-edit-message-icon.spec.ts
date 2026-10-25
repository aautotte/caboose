// F44: editing a commit message starts from a pencil on the summary line, under the author, so a long message
// doesn't push it out of reach.
import { test, expect } from '@playwright/test'
import { join } from 'node:path'
import { commitRow, grid, launch, makeRepo, seed, type Harness } from './harness'

let h: Harness
const body = Array.from({ length: 60 }, (_, i) => `- review note ${i + 1}: address the comment on the driver`).join('\n')

test.beforeAll(async () => {
  h = await launch('edit-icon', {
    open: [join(seed, 'edit-icon')],
    setup: (env) => {
      makeRepo(env, 'edit-icon', [
        ['Start', { 'a.txt': 'a\n' }],
        [`Review rounds\n\n${body}`, { 'b.txt': 'b\n' }]
      ])
    }
  })
  await h.page.getByRole('tab', { name: 'edit-icon' }).click()
  await grid(h.page).waitFor()
})
test.afterAll(async () => {
  await h.close()
})

test('F44-H1: the pencil is in view under the author even with a long message, and opens the editor', async () => {
  await commitRow(h.page, 'Review rounds').click()
  const details = h.page.getByRole('region', { name: 'Details' })
  const pencil = details.getByRole('button', { name: 'Edit message' })
  await expect(pencil).toBeInViewport()
  await expect(pencil).toHaveText('') // an icon, no label text
  // Above the message body, not after it.
  const pencilY = (await pencil.boundingBox())!.y
  const bodyY = (await details.getByText(/review note 1:/).boundingBox())!.y
  expect(pencilY).toBeLessThan(bodyY)
  await pencil.click()
  await expect(details.getByRole('textbox', { name: 'Commit summary' })).toHaveValue('Review rounds')
  await details.getByRole('button', { name: 'Cancel' }).click()
  h.expectClean()
})

// An open repository that nobody touches should cost (almost) nothing: no refresh loops, no git processes.
import { test, expect } from '@playwright/test'
import { demo, grid, invoke, launch } from './harness'

test('an idle repository runs no git commands', async () => {
  const h = await launch('idle', { open: [demo] })
  await h.page.getByRole('tab', { name: 'demo' }).click()
  await grid(h.page).getByRole('row').first().waitFor()
  await h.page.waitForTimeout(3000) // let start-up loads finish
  const count = async (): Promise<number> => {
    const r = await invoke<unknown[]>(h.page, 'activity.list', { limit: 1000 })
    return r.ok ? r.value.length : -1
  }
  const before = await count()
  await h.page.waitForTimeout(5000)
  const ran = (await count()) - before
  // Auto-fetch may fire once a minute; anything more is a loop.
  expect(ran, `${ran} git commands in 5 idle seconds`).toBeLessThanOrEqual(2)
  h.expectClean()
  await h.close()
})

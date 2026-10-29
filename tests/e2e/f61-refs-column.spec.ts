// F61: the Branch / tag column can be resized like the others: drag its right edge (or arrow keys) to see a long branch
// name whole; it stays after a reload, and double-click goes back to the default width.
import { test, expect } from '@playwright/test'
import { join } from 'node:path'
import { gitIn, grid, launch, makeRepo, seed, type Harness } from './harness'

let h: Harness
const name = 'feature/a-rather-long-branch-name-for-the-column'

test.beforeAll(async () => {
  h = await launch('refs-column', {
    open: [join(seed, 'refs-column')],
    setup: (env) => {
      const repo = makeRepo(env, 'refs-column', [['Start', { 'a.txt': 'a\n' }], ['Second', { 'b.txt': 'b\n' }]])
      gitIn(env, repo, 'branch', name, 'HEAD~1')
    }
  })
  await h.page.getByRole('tab', { name: 'refs-column' }).click()
  await grid(h.page).getByRole('row', { name: /^Start/ }).waitFor()
})
test.afterAll(async () => {
  await h.close()
})

test('F61-H1: drag the Branch / tag column wider to see a long name; it stays after a reload, and double-click resets it', async () => {
  const header = grid(h.page).getByRole('columnheader', { name: /^Branch \/ tag/ })
  const handle = grid(h.page).getByRole('separator', { name: /Resize the Branch \/ tag column/ })
  const width = async (): Promise<number> => Math.round((await header.boundingBox())!.width)
  // The long name's pill, cut short or whole.
  const cut = () =>
    grid(h.page)
      .getByRole('row', { name: /^Start/ })
      .getByRole('gridcell')
      .first()
      .evaluate((cell) => [...cell.querySelectorAll<HTMLElement>('*')].some((el) => el.scrollWidth > el.clientWidth + 1))
  const start = await width()
  await expect.poll(cut).toBe(true)

  const box = (await handle.boundingBox())!
  await h.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await h.page.mouse.down()
  await h.page.mouse.move(box.x + box.width / 2 + 300, box.y + box.height / 2, { steps: 5 })
  await h.page.mouse.up()
  await expect.poll(width).toBe(start + 300)
  await expect.poll(cut).toBe(false)
  // The rows follow the header.
  const cellW = () => grid(h.page).getByRole('row', { name: /^Start/ }).getByRole('gridcell').first().evaluate((el) => Math.round(el.getBoundingClientRect().width))
  await expect.poll(cellW).toBe(start + 300)

  // Remembered for this repository.
  await h.page.reload()
  await h.page.getByRole('tab', { name: 'refs-column' }).click()
  await expect.poll(width).toBe(start + 300)

  // From the keyboard, 16 px at a time.
  await handle.press('ArrowLeft')
  await expect.poll(width).toBe(start + 284)
  await handle.dblclick()
  await expect.poll(width).toBe(start)
  await h.page.reload()
  await h.page.getByRole('tab', { name: 'refs-column' }).click()
  await expect.poll(width).toBe(start)
  h.expectClean()
})

test('F61-E1: it can’t get narrower than 80 px', async () => {
  const header = grid(h.page).getByRole('columnheader', { name: /^Branch \/ tag/ })
  const handle = grid(h.page).getByRole('separator', { name: /Resize the Branch \/ tag column/ })
  const box = (await handle.boundingBox())!
  await h.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await h.page.mouse.down()
  await h.page.mouse.move(box.x - 400, box.y + box.height / 2, { steps: 5 })
  await h.page.mouse.up()
  await expect.poll(async () => Math.round((await header.boundingBox())!.width)).toBe(80)
  await handle.dblclick()
  h.expectClean()
})

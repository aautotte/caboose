// F42: a graph with many lanes next to both side panels: every column stays, and the history scrolls sideways to them.
import { test, expect } from '@playwright/test'
import { join } from 'node:path'
import { gitIn, grid, launch, makeRepo, seed, writeAndCommit, type Harness } from './harness'

let h: Harness

test.beforeAll(async () => {
  h = await launch('wide-graph', {
    open: [join(seed, 'wide-graph')],
    setup: (env) => {
      const repo = makeRepo(env, 'wide-graph', [['Start', { 'a.txt': 'a\n' }]])
      // 30 branches off Start, all merged back in one octopus merge: every lane is open at once, past the graph
      // column's cap.
      for (let i = 1; i <= 30; i++) {
        gitIn(env, repo, 'switch', '-q', '-c', `topic-${i}`, 'main')
        writeAndCommit(env, repo, `Topic ${i}`, { [`t${i}.txt`]: `${i}\n` })
      }
      gitIn(env, repo, 'switch', '-q', 'main')
      gitIn(env, repo, 'merge', '-q', '--no-edit', '-m', 'Merge all topics', ...Array.from({ length: 30 }, (_, i) => `topic-${i + 1}`))
    }
  })
  await h.page.getByRole('tab', { name: 'wide-graph' }).click()
  await grid(h.page).getByRole('row', { name: /^Topic 30/ }).waitFor()
})
test.afterAll(async () => {
  await h.close()
})

test('F42-E1: with a wide graph, Author, Date and SHA are all there, and the history scrolls sideways to them', async () => {
  const header = (name: RegExp) => grid(h.page).getByRole('columnheader', { name })
  for (const name of [/Author$/, /Date$/, /SHA$/]) await expect(header(name)).toHaveCount(1)
  const g = grid(h.page)
  expect(await g.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
  await expect(header(/SHA$/)).not.toBeInViewport()
  await g.evaluate((el) => el.scrollTo({ left: el.scrollWidth }))
  await expect(header(/SHA$/)).toBeInViewport()
  // The header scrolled with the rows: the SHA cells line up under it.
  await expect(g.getByRole('row', { name: /^Topic 30/ }).getByRole('gridcell').last()).toBeInViewport()
  h.expectClean()
})

test('F42-H1: drag the Graph column wider to see every lane; it stays after a reload, and double-click fits it again', async () => {
  const graphHeader = grid(h.page).getByRole('columnheader', { name: /^Graph/ })
  const handle = grid(h.page).getByRole('separator', { name: /Resize the Graph column/ })
  const width = async (): Promise<number> => Math.round((await graphHeader.boundingBox())!.width)
  await grid(h.page).evaluate((el) => el.scrollTo({ left: 0 }))
  const fit = await width()
  expect(fit).toBe(400) // 30 lanes need 488 px; fitting stops at 400
  // Next to both side panels the graph's right edge is past the visible part of the history; scroll to it first.
  await handle.scrollIntoViewIfNeeded()
  const box = (await handle.boundingBox())!
  await h.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await h.page.mouse.down()
  await h.page.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2, { steps: 5 })
  await h.page.mouse.up()
  await expect.poll(width).toBe(488) // every lane, and no wider
  // Remembered for this repository.
  await h.page.reload()
  await h.page.getByRole('tab', { name: 'wide-graph' }).click()
  await expect.poll(width).toBe(488)
  // A lane at a time from the keyboard.
  await handle.press('ArrowLeft')
  await expect.poll(width).toBe(472)
  await handle.dblclick()
  await expect.poll(width).toBe(fit)
  h.expectClean()
})

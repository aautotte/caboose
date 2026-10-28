// F56: bisect. Start it from a commit (or a terminal), say good or bad for each commit git checks out (buttons or
// G / B / S), and it finds the first bad one; Back to main ends it. Uncommitted changes are stashed first, if you say so.
import { test, expect } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dialog, gitIn, grid, launch, makeRepo, seed, type Harness } from './harness'

let h: Harness
const repo = join(seed, 'bisect')
const BROKEN_AT = 19

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => {
  h = await launch('bisect', {
    open: [repo],
    setup: (env) => {
      // 32 commits; value.txt says "broken" from step 19 on.
      const commits: Array<[string, Record<string, string>]> = Array.from({ length: 32 }, (_, i) => [
        `Step ${i + 1}`,
        { 'count.txt': `${i + 1}\n`, 'value.txt': i + 1 >= BROKEN_AT ? 'broken\n' : 'ok\n' }
      ])
      makeRepo(env, 'bisect', commits)
      gitIn(env, repo, 'tag', 'v0', 'HEAD~31')
    }
  })
  await h.page.getByRole('tab', { name: 'bisect', exact: true }).click()
})
test.afterAll(async () => {
  await h.close()
})
test.afterEach(() => h.expectClean())

const bar = () => h.page.getByRole('region', { name: 'Bisect' })
const row = (summary: string) => grid(h.page).getByRole('row', { name: new RegExp(`^${summary},`) }).first()
const broken = (): boolean => readFileSync(join(repo, 'value.txt'), 'utf8').includes('broken')
const firstBad = (): string => h.git(repo, 'rev-list', '--reverse', 'main').split('\n')[BROKEN_AT - 1]
const head = (): string => h.git(repo, 'rev-parse', 'HEAD')

/** Answers each step from the file git checked out, until git names the first bad commit. Returns the steps taken. */
async function answerAll(answer: (bad: boolean) => Promise<void>): Promise<number> {
  let steps = 0
  while (steps < 10) {
    await expect(bar()).toContainText(/Bisecting: testing|The first bad commit is/)
    if (/The first bad commit is/.test((await bar().textContent()) ?? '')) return steps
    const before = await bar().textContent()
    await answer(broken())
    steps++
    // Wait for the banner to move on (the next commit to test, or the answer) before reading the next one.
    await expect.poll(async () => (await bar().textContent()) !== before).toBe(true)
  }
  return steps
}

test('F56-H1: from a commit’s menu, good and bad find the first bad commit in a few steps; Back to main ends it', async () => {
  await row('Step 1').click({ button: 'right' })
  await h.page.getByRole('menuitem', { name: 'Bisect: this commit is good…' }).click()
  await expect(dialog(h.page).getByLabel('Bad: has the problem')).toHaveValue('main')
  await dialog(h.page).getByRole('button', { name: 'Start bisect' }).click()
  await expect(bar()).toContainText('Bisecting: testing')
  await expect(bar()).toContainText(/about \d+ steps? left/)
  const steps = await answerAll((bad) => bar().getByRole('button', { name: bad ? 'Bad' : 'Good', exact: true }).click())
  expect(steps).toBeLessThanOrEqual(6)
  await expect(bar()).toContainText(`The first bad commit is ${firstBad().slice(0, 7)} “Step ${BROKEN_AT}”`)
  await expect(row(`Step ${BROKEN_AT}`)).toHaveAccessibleName(/bisect: first bad$/)
  await bar().getByRole('button', { name: 'Back to main' }).click()
  await expect(bar()).toHaveCount(0)
  await expect.poll(() => h.git(repo, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main')
})

test('F56-H2: a bisect started in a terminal shows too; G, B and S answer from the keyboard', async () => {
  h.git(repo, 'bisect', 'start', 'main', 'v0')
  await expect(bar()).toContainText('Bisecting: testing')
  await grid(h.page).focus()
  // Skip the first one: git picks another.
  const at = head()
  await h.page.keyboard.press('s')
  await expect.poll(head).not.toBe(at)
  await expect(row(h.git(repo, 'log', '-1', '--format=%s', at))).toHaveAccessibleName(/bisect: skipped$/)
  await answerAll(async (bad) => {
    await grid(h.page).focus()
    await h.page.keyboard.press(bad ? 'b' : 'g')
  })
  await expect(bar()).toContainText(`“Step ${BROKEN_AT}”`)
  await bar().getByRole('button', { name: 'Back to main' }).click()
  await expect(bar()).toHaveCount(0)
})

test('F56-H3: with uncommitted changes, starting asks to stash them first', async () => {
  writeFileSync(join(repo, 'count.txt'), 'my change\n')
  await row('Step 32').click({ button: 'right' })
  await h.page.getByRole('menuitem', { name: 'Bisect: this commit is bad…' }).click()
  await dialog(h.page).getByLabel('Good: before the problem').fill('v0')
  await dialog(h.page).getByRole('button', { name: 'Start bisect' }).click()
  await expect(dialog(h.page)).toContainText('Stash your changes first?')
  await dialog(h.page).getByRole('button', { name: 'Stash and start' }).click()
  await expect(bar()).toContainText('Bisecting: testing')
  expect(h.git(repo, 'stash', 'list')).toContain('Before bisect')
  await bar().getByRole('button', { name: 'Stop' }).click()
  await expect(bar()).toHaveCount(0)
  await expect.poll(() => h.git(repo, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main')
})

test('F56-H4: with a test command, git bisects on its own and names the first bad commit; the output can be shown', async () => {
  h.git(repo, 'stash', 'clear')
  await row('Step 32').click({ button: 'right' })
  await h.page.getByRole('menuitem', { name: 'Bisect: this commit is bad…' }).click()
  await dialog(h.page).getByLabel('Good: before the problem').fill('v0')
  // grep exits 0 when value.txt still says just ok (good), 1 when it says broken (bad).
  await dialog(h.page).getByLabel('Test each step with a command (optional)').fill('grep -qx ok value.txt')
  await dialog(h.page).getByRole('button', { name: 'Start bisect' }).click()
  await expect(bar()).toContainText(`The first bad commit is ${firstBad().slice(0, 7)} “Step ${BROKEN_AT}”`, { timeout: 60_000 })
  await bar().getByRole('button', { name: 'Back to main' }).click()
  await expect(bar()).toHaveCount(0)
})

test('F56-H5: a run can be cancelled midway: the bisect stays, to answer by hand or stop', async () => {
  h.git(repo, 'bisect', 'start', 'main', 'v0')
  await expect(bar()).toContainText('Bisecting: testing')
  await bar().getByRole('button', { name: 'Run a command…' }).click()
  // Longer than the wait after Cancel: cancelling must not wait for the command to end.
  await dialog(h.page).getByLabel('Command').fill('sleep 60; grep -qx ok value.txt')
  await dialog(h.page).getByRole('button', { name: 'Run' }).click()
  await expect(bar()).toContainText('Bisecting with sleep 60; grep -qx ok value.txt')
  await bar().getByRole('button', { name: 'Show output' }).click()
  await expect(h.page.getByLabel('Bisect output')).toContainText('running')
  await bar().getByRole('button', { name: 'Cancel' }).click()
  await expect(bar()).toContainText('Bisecting: testing', { timeout: 30_000 })
  await bar().getByRole('button', { name: 'Stop' }).click()
  await expect(bar()).toHaveCount(0)
})

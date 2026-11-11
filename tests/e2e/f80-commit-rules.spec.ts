// F80: commit rules for a repository (Settings › Commit rules): a summary length, Conventional Commits with its
// types, an issue to mention in the summary or anywhere. The commit box lists what doesn't fit; Warn commits
// anyway, Hold back the commit keeps the button off until it fits. Merge and fixup! messages aren't checked.
import { test, expect } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { axe, launch, makeRepo, openWip, seed, toGraph, type Harness } from './harness'

let h: Harness
const repo = join(seed, 'rules')

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => {
  h = await launch('rules', {
    open: [repo],
    setup: (env) => {
      makeRepo(env, 'rules', [['Base', { 'a.txt': 'a\n' }]])
    }
  })
  await h.page.getByRole('tab', { name: 'rules', exact: true }).click()
})
test.afterAll(async () => {
  await h.close()
})
test.afterEach(() => h.expectClean())

const settings = () => h.page.getByRole('region', { name: 'Settings' })
const rulesSection = () => settings().getByRole('region', { name: 'Commit rules' })
const summary = () => h.page.getByRole('textbox', { name: 'Commit summary' })
const description = () => h.page.getByRole('textbox', { name: 'Commit description' })
const commitForm = () => h.page.getByRole('form', { name: 'Commit' })
const problems = () => commitForm().getByRole('status', { name: 'Commit rules' })
const commitButton = () => commitForm().locator('button[type=submit]')
const lastSummary = (): string => h.git(repo, 'log', '-1', '--format=%s')
let n = 0
/** The Save button next to a text setting. */
const saveOf = (label: string) => rulesSection().locator('form').filter({ has: h.page.getByRole('textbox', { name: label }) }).getByRole('button', { name: 'Save' })

/** Opens Settings › Commit rules. */
async function openRules(): Promise<void> {
  await h.page.getByRole('button', { name: 'Settings' }).click()
  await rulesSection().scrollIntoViewIfNeeded()
}
async function choose(label: string, option: string): Promise<void> {
  await rulesSection().getByRole('combobox', { name: label }).click()
  await h.page.getByRole('option', { name: option, exact: true }).click()
}
/** A change to stage, and the commit box open. */
async function newChange(): Promise<void> {
  writeFileSync(join(repo, 'a.txt'), `a ${++n}\n`)
  await openWip(h.page)
  await h.page.getByRole('button', { name: 'Stage all' }).first().click()
  await expect(commitButton()).toBeVisible()
}

test('F80-H1: a summary length: the counter shows it, a longer summary is listed, and Warn still commits', async () => {
  await openRules()
  await expect(rulesSection().getByRole('combobox', { name: 'When a message doesn’t fit' })).toHaveCount(0)
  await choose('Summary length', '50 characters')
  await expect(rulesSection().getByRole('combobox', { name: 'When a message doesn’t fit' })).toBeVisible()
  await newChange()
  const long = 'Make the summary of this commit go on for far too long'
  await summary().fill(long)
  await expect(commitForm().getByLabel(`${long.length} of 50 characters`)).toHaveText(`${long.length}/50`)
  await expect(problems()).toContainText(`The summary is ${long.length} characters: keep it to 50.`)
  await expect(commitButton()).toBeEnabled()
  await commitButton().click()
  await expect.poll(lastSummary).toBe(long)
})

test('F80-H2: Conventional Commits: a summary needs a type from the list, and the list can change', async () => {
  await openRules()
  await choose('Summary length', 'No limit')
  await rulesSection().getByRole('switch', { name: 'Conventional Commits' }).click()
  await newChange()
  await summary().fill('add search')
  await expect(problems()).toContainText('Start the summary with a type, like “feat: …” or “fix(api): …”')
  await summary().fill('wip: add search')
  await expect(problems()).toContainText('“wip” isn’t one of this repository’s types: feat, fix, docs')
  for (const ok of ['feat: add search', 'fix(api): time out', 'feat!: drop the old flag']) {
    await summary().fill(ok)
    await expect(problems()).toHaveCount(0)
  }

  await openRules()
  const types = rulesSection().getByRole('textbox', { name: 'Types' })
  await types.fill('feat, fix, wip')
  await saveOf('Types').click()
  await expect(types).toHaveValue('feat, fix, wip')
  await openWip(h.page)
  await summary().fill('wip: add search')
  await expect(problems()).toHaveCount(0)
})

test('F80-H3: an issue to mention, in the summary or anywhere; a pattern that isn’t valid is refused', async () => {
  await openRules()
  await choose('Mention an issue', 'In the summary')
  await openWip(h.page)
  await summary().fill('feat: add search')
  await expect(problems()).toHaveText(/Mention an issue like ABC-123 in the summary\./)
  await description().fill('For ABC-12.')
  await expect(problems()).toHaveCount(1)
  await summary().fill('feat: add search (ABC-12)')
  await expect(problems()).toHaveCount(0)

  await openRules()
  await choose('Mention an issue', 'Anywhere in the message')
  const pattern = rulesSection().getByRole('textbox', { name: 'Issue pattern' })
  await pattern.fill('#(\\d+')
  await saveOf('Issue pattern').click()
  await expect(h.page.getByRole('region', { name: /Notifications/ })).toContainText('That isn’t a valid regular expression.')
  await pattern.fill('#\\d+')
  await saveOf('Issue pattern').click()
  await openWip(h.page)
  await summary().fill('feat: add search')
  await expect(problems()).toContainText('Mention an issue matching #\\d+.')
  await description().fill('Closes #42.')
  await expect(problems()).toHaveCount(0)
  await commitButton().click()
  await expect.poll(lastSummary).toBe('feat: add search')
})

test('F80-H4: Hold back the commit: the button stays off, Ctrl+Enter does nothing, until the message fits', async () => {
  await openRules()
  await choose('When a message doesn’t fit', 'Hold back the commit')
  await newChange()
  await summary().fill('add search')
  await expect(commitButton()).toHaveText('Fix the message to commit')
  await expect(commitButton()).toBeDisabled()
  await summary().press('Control+Enter')
  await expect(problems()).toHaveCount(1)
  expect(lastSummary()).toBe('feat: add search')
  expect(await axe(h.page)).toEqual([])

  // The link under the list goes to the rules.
  await problems().getByRole('button', { name: 'This repository’s rules' }).click()
  await expect(rulesSection()).toBeInViewport()
  expect(await axe(h.page)).toEqual([])
  await openWip(h.page)
  await summary().fill('fix: add search')
  await description().fill('See #7.')
  await expect(commitButton()).toBeEnabled()
  await summary().press('Control+Enter')
  await expect.poll(lastSummary).toBe('fix: add search')
})

test('F80-H5: fixup! and merge messages aren’t checked; the rules are kept after a restart of the window', async () => {
  await newChange()
  await summary().fill('fixup! fix: add search')
  await expect(problems()).toHaveCount(0)
  await summary().fill('Merge branch topic')
  await expect(problems()).toHaveCount(0)

  await h.page.reload()
  await h.page.getByRole('tab', { name: 'rules', exact: true }).click()
  await toGraph(h.page)
  await openWip(h.page)
  await summary().fill('add search')
  await expect(commitButton()).toHaveText('Fix the message to commit')

  // All of them off: nothing is checked any more, and the last choice goes too.
  await openRules()
  await rulesSection().getByRole('switch', { name: 'Conventional Commits' }).click()
  await choose('Mention an issue', 'Not needed')
  await expect(rulesSection().getByRole('combobox', { name: 'When a message doesn’t fit' })).toHaveCount(0)
  await openWip(h.page)
  await summary().fill('add search')
  await expect(problems()).toHaveCount(0)
  await expect(commitButton()).toBeEnabled()
})

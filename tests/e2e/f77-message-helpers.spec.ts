// F77: helpers under the commit message. Start from a recent message (yours comes back if you change your mind),
// add a co-author from the history or anyone, and wrap the description at 72 characters, on the spot or as it's
// committed, leaving code and trailers as typed.
import { test, expect } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dialog, launch, makeRepo, openWip, seed, writeAndCommit, type Harness } from './harness'

let h: Harness
const repo = join(seed, 'messages')

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => {
  h = await launch('messages', {
    open: [repo],
    setup: (env) => {
      const as = (name: string) => ({ ...env, GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: `${name.toLowerCase()}@example.com` })
      makeRepo(as('Pat'), 'messages', [['Base', { 'a.txt': 'a\n' }]])
      writeAndCommit(as('Kim'), repo, 'Parse the config\n\nReads the file once, at start.', { 'b.txt': 'b\n' })
      writeAndCommit(as('Lee'), repo, 'fixup! Parse the config', { 'b.txt': 'b2\n' })
      writeAndCommit(as('Pat'), repo, 'Tidy up', { 'c.txt': 'c\n' })
    }
  })
  await h.page.getByRole('tab', { name: 'messages', exact: true }).click()
  writeFileSync(join(repo, 'a.txt'), 'a, changed\n')
  await openWip(h.page)
  await h.page.getByRole('button', { name: 'Stage all' }).first().click()
})
test.afterAll(async () => {
  await h.close()
})
test.afterEach(() => h.expectClean())

const summary = () => h.page.getByRole('textbox', { name: 'Commit summary' })
const description = () => h.page.getByRole('textbox', { name: 'Commit description' })
const commitForm = () => h.page.getByRole('form', { name: 'Commit' })
const toasts = () => h.page.getByRole('region', { name: /Notifications/ })
const lastMessage = (): string => h.git(repo, 'log', '-1', '--format=%B')

test('F77-H1: Recent lists this branch’s messages, newest first, without fixup! ones; picking one fills both fields', async () => {
  await commitForm().getByRole('button', { name: 'Use a recent message' }).click()
  await expect(h.page.getByRole('menu').getByRole('menuitem')).toHaveText(['Tidy up', 'Parse the config', 'Base'])
  await h.page.getByRole('menuitem', { name: 'Parse the config' }).click()
  await expect(summary()).toHaveValue('Parse the config')
  await expect(description()).toHaveValue('Reads the file once, at start.')
})

test('F77-H2: picking another over a message you wrote can be put back', async () => {
  await summary().fill('My own summary')
  await description().fill('My own words.')
  await commitForm().getByRole('button', { name: 'Use a recent message' }).click()
  await h.page.getByRole('menuitem', { name: 'Tidy up' }).click()
  await expect(summary()).toHaveValue('Tidy up')
  await expect(description()).toHaveValue('')
  await toasts().getByRole('button', { name: 'Put it back' }).click()
  await expect(summary()).toHaveValue('My own summary')
  await expect(description()).toHaveValue('My own words.')
})

test('F77-H3: Co-author lists the people in the history and adds a trailer after a blank line, once', async () => {
  await commitForm().getByRole('button', { name: 'Add a co-author' }).click()
  await expect(h.page.getByRole('menu').getByRole('menuitem')).toHaveText(['Pat <pat@example.com>', 'Lee <lee@example.com>', 'Kim <kim@example.com>', 'Someone else…'])
  await h.page.getByRole('menuitem', { name: 'Kim <kim@example.com>' }).click()
  await expect(description()).toHaveValue('My own words.\n\nCo-authored-by: Kim <kim@example.com>')
  // Kim is on it now, so not offered again; Lee joins the same trailers.
  await commitForm().getByRole('button', { name: 'Add a co-author' }).click()
  await expect(h.page.getByRole('menuitem', { name: 'Kim <kim@example.com>' })).toHaveCount(0)
  await h.page.getByRole('menuitem', { name: 'Lee <lee@example.com>' }).click()
  await expect(description()).toHaveValue('My own words.\n\nCo-authored-by: Kim <kim@example.com>\nCo-authored-by: Lee <lee@example.com>')
})

test('F77-H4: Someone else… takes anyone as Name <email>', async () => {
  await commitForm().getByRole('button', { name: 'Add a co-author' }).click()
  await h.page.getByRole('menuitem', { name: 'Someone else…' }).click()
  await expect(dialog(h.page).getByRole('heading', { name: 'Add a co-author to your commit' })).toBeVisible()
  const field = dialog(h.page).getByRole('combobox', { name: 'Co-author' })
  await field.fill('Ana')
  await expect(dialog(h.page).getByText('Write it as Name <email>.')).toBeVisible()
  await field.fill('Ana Ruiz <ana@example.com>')
  await dialog(h.page).getByRole('button', { name: 'Add co-author' }).click()
  await expect(description()).toHaveValue(/\nCo-authored-by: Ana Ruiz <ana@example\.com>$/)
})

const long = 'This change keeps the parsed config around, so that every later read is a lookup instead of a parse.'

test('F77-H5: Wrap wraps paragraphs and list items at 72, keeps code and trailers, and is off once it’s done', async () => {
  const code = '    const config = parse(readFileSync(path, "utf8")) // a long line of code that stays long'
  await description().fill(`${long}\n\n- a list item that also runs long enough to need a second line to fit it in\n\n${code}\n\nCo-authored-by: Kim <kim@example.com>`)
  const wrap = commitForm().getByRole('button', { name: 'Wrap the description at 72 characters' })
  await wrap.click()
  await expect(description()).toHaveValue(
    [
      'This change keeps the parsed config around, so that every later read is',
      'a lookup instead of a parse.',
      '',
      '- a list item that also runs long enough to need a second line to fit it',
      '  in',
      '',
      code,
      '',
      'Co-authored-by: Kim <kim@example.com>'
    ].join('\n')
  )
  await expect(wrap).toBeDisabled()
})

test('F77-H6: with the setting on, the description is wrapped as it’s committed; Recent then has the new message', async () => {
  await h.page.getByRole('button', { name: 'Settings' }).click()
  await h.page.getByRole('switch', { name: 'Wrap the description when committing' }).click()
  await openWip(h.page)
  await summary().fill('Keep the parsed config')
  await description().fill(long)
  await commitForm().getByRole('button', { name: /^Commit 1 file/ }).click()
  await expect.poll(() => h.git(repo, 'log', '-1', '--format=%s')).toBe('Keep the parsed config')
  expect(lastMessage()).toBe('Keep the parsed config\n\nThis change keeps the parsed config around, so that every later read is\na lookup instead of a parse.')
  writeFileSync(join(repo, 'a.txt'), 'a, again\n')
  await openWip(h.page)
  await commitForm().getByRole('button', { name: 'Use a recent message' }).click()
  await expect(h.page.getByRole('menu').getByRole('menuitem').first()).toHaveText('Keep the parsed config')
  await h.page.keyboard.press('Escape')
})

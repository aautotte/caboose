// F04 stage everything and commit, F05 stage part of a file: edge and negative cases.
// (The happy paths are in slice.spec.ts and features.spec.ts.)
import { test, expect } from '@playwright/test'
import { chmodSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { commitRow, demo, grid, invoke, launch, makeRepo, openWip, repoId, type Harness } from './harness'

let h: Harness
let crlf = ''

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => {
  h = await launch('commit', {
    setup: (env) => {
      crlf = makeRepo(env, 'crlf-repo', [['windows file', { 'win.txt': 'one\r\ntwo\r\nthree\r\nfour\r\nfive\r\nsix\r\nseven\r\neight\r\n' }]])
    },
    open: [demo, join(demo, '..', 'crlf-repo')]
  })
  await h.page.getByRole('tab', { name: 'demo' }).click()
  await grid(h.page).waitFor()
})
test.afterAll(async () => {
  await h.close()
})
test.afterEach(() => h.expectClean())

const commitButton = () => h.page.getByRole('form', { name: 'Commit' }).getByRole('button', { name: /^(Commit|Stage files|Add a summary|Resolve)/ })
const head = (): string => h.git(demo, 'rev-parse', 'HEAD')

test('F04-E2 an empty summary can’t be committed', async () => {
  await openWip(h.page)
  await h.page.getByRole('button', { name: 'Stage all', exact: true }).click()
  await h.page.getByLabel('Commit summary').fill('   ')
  await expect(commitButton()).toHaveText('Add a summary to commit')
  await expect(commitButton()).toBeDisabled()
})

test('F04-E3 a failing pre-commit hook leaves nothing committed and keeps the message', async () => {
  const hook = join(demo, '.git', 'hooks', 'pre-commit')
  writeFileSync(hook, '#!/bin/sh\necho "lint: 2 problems in src/cli.js" >&2\nexit 1\n')
  chmodSync(hook, 0o755)
  const before = head()
  await h.page.getByLabel('Commit summary').fill('Blocked by the hook')
  await commitButton().click()
  await expect(h.page.getByRole('region', { name: /Notifications/ }).getByText('Commit failed')).toBeVisible()
  expect(head()).toBe(before)
  await expect(h.page.getByLabel('Commit summary')).toHaveValue('Blocked by the hook')
})

test('F04-E4 skip hooks commits despite the hook', async () => {
  await h.page.getByRole('checkbox', { name: 'Skip hooks' }).click()
  await commitButton().click()
  await expect.poll(h.gitOr(demo, 'log', '-1', '--format=%s')).toBe('Blocked by the hook')
  writeFileSync(join(demo, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\nexit 0\n')
})

test('F04-E1 nothing to commit: the panel says so and offers no commit', async () => {
  await h.page.getByRole('row', { name: /Uncommitted changes/ }).waitFor({ state: 'detached' })
  // No changes means no "uncommitted changes" row; the commit button can't be reached by mistake.
  await expect(h.page.getByRole('row', { name: /Uncommitted changes/ })).toHaveCount(0)
})

test('F04-E5 long summaries with accents and emoji are kept exactly; the counter warns past 72', async () => {
  writeFileSync(join(demo, 'notes.txt'), 'x\n')
  await openWip(h.page)
  const summary = `Corrige l’affichage des températures — ça marche enfin ✅ ${'é'.repeat(40)}`
  await h.page.getByLabel('Commit summary').fill(summary)
  await expect(h.page.getByLabel(`${summary.length} characters`)).toHaveClass(/text-danger/)
  await h.page.getByLabel('Commit description').fill('Ligne 1\n\nLigne 3 avec 日本語')
  await h.page.getByRole('button', { name: 'Stage all', exact: true }).click()
  await commitButton().click()
  await expect.poll(h.gitOr(demo, 'log', '-1', '--format=%s')).toBe(summary)
  expect(h.git(demo, 'log', '-1', '--format=%b')).toBe('Ligne 1\n\nLigne 3 avec 日本語')
})

test('F04-E6 double-clicking Commit makes one commit', async () => {
  writeFileSync(join(demo, 'twice.txt'), 'twice\n')
  await openWip(h.page)
  await h.page.getByRole('button', { name: 'Stage all', exact: true }).click()
  await h.page.getByLabel('Commit summary').fill('Only once')
  const before = head()
  await commitButton().dblclick()
  await expect.poll(h.gitOr(demo, 'log', '-1', '--format=%s')).toBe('Only once')
  expect(h.git(demo, 'rev-parse', 'HEAD~1')).toBe(before)
  await expect(h.page.getByRole('region', { name: /Notifications/ }).getByText('Commit failed')).toHaveCount(0)
})

test('F04-E7 keyboard only: focus the summary, type, Ctrl+Enter', async () => {
  writeFileSync(join(demo, 'keys.txt'), 'keys\n')
  await grid(h.page).focus()
  await h.page.keyboard.press('Control+Shift+S')
  await expect.poll(h.gitOr(demo, 'diff', '--cached', '--name-only')).toContain('keys.txt')
  await h.page.keyboard.press('Control+Shift+M')
  await expect(h.page.getByLabel('Commit summary')).toBeFocused()
  await h.page.keyboard.type('Typed without a mouse')
  // A person takes longer to type than staging takes to show up; the test has to wait for it.
  await expect(h.page.getByRole('heading', { name: 'Staged · 1' })).toBeVisible()
  await h.page.keyboard.press('Control+Enter')
  await expect.poll(h.gitOr(demo, 'log', '-1', '--format=%s')).toBe('Typed without a mouse')
})

test('F04-E9 a half-typed message survives looking at another commit', async () => {
  writeFileSync(join(demo, 'draft.txt'), 'draft\n')
  await openWip(h.page)
  await h.page.getByLabel('Commit summary').fill('Half-typed message')
  await h.page.getByLabel('Commit description').fill('and a description')
  await commitRow(h.page, 'Update the changelog (6)').click()
  await h.page.getByRole('row', { name: /Uncommitted changes/ }).click()
  await expect(h.page.getByLabel('Commit summary')).toHaveValue('Half-typed message')
  await expect(h.page.getByLabel('Commit description')).toHaveValue('and a description')
})

test('F04-E10 the next message, typed right after committing, is kept', async () => {
  await h.page.getByRole('button', { name: 'Stage all', exact: true }).click()
  await expect.poll(h.gitOr(demo, 'diff', '--cached', '--name-only')).toContain('draft.txt')
  await h.page.getByLabel('Commit summary').fill('Commit the draft')
  await h.page.getByLabel('Commit description').fill('')
  // A file for the next commit, created after staging so the first commit doesn't take it.
  writeFileSync(join(demo, 'after.txt'), 'after\n')
  await expect(h.page.getByRole('heading', { name: 'Not staged · 1' })).toBeVisible()
  await commitButton().click()
  await h.page.getByRole('row', { name: /Uncommitted changes/ }).click()
  await h.page.getByLabel('Commit summary').fill('Typed straight away')
  await expect.poll(h.gitOr(demo, 'log', '-1', '--format=%s')).toBe('Commit the draft')
  await h.page.waitForTimeout(1500)
  await expect(h.page.getByLabel('Commit summary')).toHaveValue('Typed straight away')
  await h.page.getByRole('button', { name: 'Stage all', exact: true }).click()
  await commitButton().click()
  await expect.poll(h.gitOr(demo, 'log', '-1', '--format=%s')).toBe('Typed straight away')
})

test('F04-E8 commit and push on a branch with no upstream asks to publish it', async () => {
  h.git(demo, 'switch', '-q', '-c', 'feature/unpublished')
  writeFileSync(join(demo, 'pub.txt'), 'pub\n')
  await openWip(h.page)
  await h.page.getByRole('button', { name: 'Stage all', exact: true }).click()
  await h.page.getByLabel('Commit summary').fill('First on a new branch')
  await h.page.getByRole('checkbox', { name: 'Push after committing' }).click()
  await commitButton().click()
  await expect(h.page.getByRole('dialog', { name: 'Publish feature/unpublished' })).toBeVisible()
  await h.page.getByRole('dialog').getByRole('button', { name: 'Publish branch' }).click()
  await expect.poll(h.gitOr(demo, 'rev-parse', 'origin/feature/unpublished')).toBe(head())
  await h.page.getByRole('checkbox', { name: 'Push after committing' }).click().catch(() => {})
})

test('F04-N1 git doesn’t know who you are: the error says how to fix it', async () => {
  h.git(demo, 'config', '--unset', 'user.name')
  h.git(demo, 'config', '--unset', 'user.email')
  writeFileSync(join(h.home, '.gitconfig'), '[init]\n\tdefaultBranch = main\n')
  writeFileSync(join(demo, 'anon.txt'), 'who?\n')
  await openWip(h.page)
  await h.page.getByRole('button', { name: 'Stage all', exact: true }).click()
  await h.page.getByLabel('Commit summary').fill('Nobody')
  await commitButton().click()
  const toast = h.page.getByRole('region', { name: /Notifications/ })
  await expect(toast.getByText('Commit failed')).toBeVisible()
  await expect(toast).toContainText(/name and email|who you are|user\.email/i)
  writeFileSync(join(h.home, '.gitconfig'), '[user]\n\tname = E2E\n\temail = e2e@example.com\n')
  await commitButton().click()
  await expect.poll(h.gitOr(demo, 'log', '-1', '--format=%s')).toBe('Nobody')
})

// ---------- F05 ----------

test('F05-E1 staging one line of a CRLF file keeps its line endings', async () => {
  await h.page.getByRole('tab', { name: 'crlf-repo' }).click()
  writeFileSync(join(crlf, 'win.txt'), 'one\r\nTWO\r\nthree\r\nfour\r\nfive\r\nsix\r\nSEVEN\r\neight\r\n')
  await openWip(h.page)
  await h.page.getByRole('listbox', { name: /Not staged/ }).getByRole('option', { name: /win\.txt/ }).click()
  const region = h.page.getByRole('region', { name: 'Changes in win.txt' })
  await region.getByRole('row').filter({ hasText: /TWO/ }).getByTitle(/Pick this line/).click()
  await region.getByRole('row').filter({ hasText: /two/ }).getByTitle(/Pick this line/).click()
  await h.page.getByRole('button', { name: 'Stage 2 lines' }).click()
  await expect.poll(() => h.gitOr(crlf, 'show', ':win.txt')()).toContain('TWO')
  const staged = h.git(crlf, 'show', ':win.txt')
  expect(staged).not.toContain('SEVEN')
  expect(Buffer.from(h.git(crlf, 'cat-file', '-p', ':win.txt') + '\n').includes(Buffer.from('TWO\r\n'))).toBe(true)
  expect(readFileSync(join(crlf, 'win.txt'), 'utf8')).toContain('SEVEN\r\n')
})

test('F05-E2 staging lines of a file that changed on disk since it was shown is refused', async () => {
  const id = await repoId(h.page, crlf)
  const r = await invoke(h.page, 'index.applyPatch', {
    repoId: id,
    path: 'win.txt',
    source: 'worktree',
    hunk: 0,
    header: '@@ -1,8 +1,8 @@ stale header from an older view',
    lines: [0],
    action: 'stage',
    full: false
  })
  expect(r.ok).toBe(false)
  if (!r.ok) expect(r.error.message).toMatch(/changed since it was shown/)
})

test('F05-E3 part of a brand-new file can be staged', async () => {
  writeFileSync(join(crlf, 'new.txt'), 'keep me\ndrop me\n')
  await openWip(h.page)
  await h.page.getByRole('listbox', { name: /Not staged/ }).getByRole('option', { name: /new\.txt/ }).click()
  const region = h.page.getByRole('region', { name: 'Changes in new.txt' })
  await region.getByRole('row').filter({ hasText: 'keep me' }).getByTitle(/Pick this line/).click()
  await h.page.getByRole('button', { name: 'Stage 1 line' }).click()
  await expect.poll(h.gitOr(crlf, 'show', ':new.txt')).toBe('keep me')
})

test('F05-E4 keyboard only: arrows to a line, Space to pick, Enter to stage', async () => {
  writeFileSync(join(crlf, 'kb.txt'), 'alpha\nbeta\n')
  await openWip(h.page)
  await h.page.getByRole('listbox', { name: /Not staged/ }).getByRole('option', { name: /kb\.txt/ }).click()
  const block = h.page.getByRole('region', { name: 'Changes in kb.txt' }).getByRole('table').first()
  await block.focus()
  await h.page.keyboard.press('ArrowDown')
  await h.page.keyboard.press('ArrowDown')
  await h.page.keyboard.press('Space')
  await h.page.keyboard.press('Enter')
  await expect.poll(h.gitOr(crlf, 'show', ':kb.txt')).toBe('beta')
})

test('F04/F05 the graph still shows the new commits', async () => {
  await h.page.getByRole('tab', { name: 'demo' }).click()
  await h.page.keyboard.press('Escape')
  await expect(commitRow(h.page, 'Nobody')).toBeVisible()
})

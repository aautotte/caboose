// F81: Git Flow with plain git. Set it up (the gitflow.* config the git-flow tool uses, develop made from main);
// start a feature, release or hotfix from the right branch; finish it into develop, or into main with a tag and
// then develop; a finish that stops on conflicts carries on after they're resolved and committed.
import { test, expect } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { axe, dialog, launch, makeRepo, seed, type Harness } from './harness'

let h: Harness
const repo = join(seed, 'flow')

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => {
  h = await launch('flow', {
    open: [repo],
    setup: (env) => {
      makeRepo(env, 'flow', [['Base', { 'a.txt': 'one\ntwo\nthree\n' }]])
    }
  })
  await h.page.getByRole('tab', { name: 'flow', exact: true }).click()
})
test.afterAll(async () => {
  await h.close()
})
test.afterEach(() => h.expectClean())

const git = (...args: string[]): string => h.git(repo, ...args)
const head = (): string => git('rev-parse', '--abbrev-ref', 'HEAD')
const has = (ref: string): boolean => h.gitOr(repo, 'rev-parse', '-q', '--verify', ref)() !== ''
const flowBlock = () => h.page.getByRole('navigation', { name: 'Branches and tags' }).getByRole('region', { name: 'Git Flow' })
const toasts = () => h.page.getByRole('region', { name: /Notifications/ })
const local = (name: string) => h.page.getByRole('tree', { name: 'Local branches' }).getByRole('treeitem', { name: new RegExp(`^${name}(,|$)`) })
/** A commit on the checked-out branch, made outside the app. */
function commit(file: string, content: string, message: string): void {
  writeFileSync(join(repo, file), content)
  git('add', file)
  git('commit', '-q', '-m', message)
}
async function start(kind: 'feature' | 'release' | 'hotfix', name: string): Promise<void> {
  await flowBlock().getByRole('button', { name: `Start a ${kind}` }).click()
  await dialog(h.page).getByRole('textbox').fill(name)
  await dialog(h.page).getByRole('button', { name: `Start ${kind}` }).click()
  await expect(dialog(h.page)).toHaveCount(0)
}

test('F81-H1: Set up Git Flow names the branches and prefixes, writes git-flow’s config, and makes develop from main', async () => {
  await expect(flowBlock()).toHaveCount(0)
  await h.page.getByRole('button', { name: /^Local branches/ }).click({ button: 'right' })
  await h.page.getByRole('menuitem', { name: 'Set up Git Flow…' }).click()
  await expect(dialog(h.page).getByRole('combobox', { name: 'Production branch' })).toHaveText('main')
  await expect(dialog(h.page).getByLabel('Develop branch')).toHaveValue('develop')
  await expect(dialog(h.page)).toContainText('Made from main if it isn’t there yet.')
  // Two kinds with the same prefix aren't allowed.
  await dialog(h.page).getByLabel('Release prefix').fill('feature/')
  await expect(dialog(h.page)).toContainText('Features, releases and hotfixes need different prefixes.')
  await expect(dialog(h.page).getByRole('button', { name: 'Set up Git Flow' })).toBeDisabled()
  await dialog(h.page).getByLabel('Release prefix').fill('release/')
  await dialog(h.page).getByLabel('Version tag prefix').fill('v')
  expect(await axe(h.page)).toEqual([])
  await dialog(h.page).getByRole('button', { name: 'Set up Git Flow' }).click()
  await expect(toasts()).toContainText('Git Flow is set up')
  expect(git('config', 'gitflow.branch.master')).toBe('main')
  expect(git('config', 'gitflow.branch.develop')).toBe('develop')
  expect(git('config', 'gitflow.prefix.feature')).toBe('feature/')
  expect(git('config', 'gitflow.prefix.versiontag')).toBe('v')
  expect(git('rev-parse', 'develop')).toBe(git('rev-parse', 'main'))
  await expect(flowBlock()).toBeVisible()
  expect(await axe(h.page)).toEqual([])
  // The palette has them too.
  await h.page.keyboard.press('Control+p')
  await h.page.keyboard.type('git flow')
  await expect(h.page.getByRole('option', { name: /Git Flow: start a feature/ })).toBeVisible()
  await expect(h.page.getByRole('option', { name: /Set up Git Flow/ })).toHaveCount(0)
  await h.page.keyboard.press('Escape')
})

test('F81-H2: a feature starts from develop and finishes into it with a merge commit, then is deleted', async () => {
  await start('feature', 'search')
  await expect.poll(head).toBe('feature/search')
  expect(git('merge-base', 'feature/search', 'develop')).toBe(git('rev-parse', 'develop'))
  commit('search.txt', 'search\n', 'Add search')
  await h.page.evaluate(() => window.dispatchEvent(new Event('focus')))

  await flowBlock().getByRole('button', { name: 'Finish feature search' }).click()
  await expect(dialog(h.page).getByRole('list', { name: 'What it does' })).toContainText('Merge feature/search into develop, with a merge commit.')
  await expect(dialog(h.page)).toContainText('Delete feature/search, and check out develop.')
  await dialog(h.page).getByRole('button', { name: 'Finish feature' }).click()
  await expect(toasts()).toContainText('Finished feature/search')
  await expect(toasts()).toContainText('Merged into develop, feature/search deleted.')
  expect(head()).toBe('develop')
  expect(git('log', '-1', '--format=%s')).toBe("Merge branch 'feature/search' into develop")
  expect(git('rev-list', '--parents', '-n1', 'HEAD').split(' ')).toHaveLength(3)
  expect(has('refs/heads/feature/search')).toBe(false)
  // main hasn't moved.
  expect(git('log', '-1', '--format=%s', 'main')).toBe('Base')
})

test('F81-H3: a release goes into main with a tag, then into develop; only one release at a time', async () => {
  await start('release', '1.0.0')
  await expect.poll(head).toBe('release/1.0.0')
  commit('VERSION', '1.0.0\n', 'Version 1.0.0')
  await h.page.evaluate(() => window.dispatchEvent(new Event('focus')))
  // A second release while this one is open is refused.
  await flowBlock().getByRole('button', { name: 'Start a release' }).click()
  await dialog(h.page).getByRole('textbox').fill('1.1.0')
  await dialog(h.page).getByRole('button', { name: 'Start release' }).click()
  await expect(dialog(h.page)).toContainText('Finish release/1.0.0 first: Git Flow has one release at a time.')
  await dialog(h.page).getByRole('button', { name: 'Cancel' }).click()

  await local('release/1.0.0').click({ button: 'right' })
  await h.page.getByRole('menuitem', { name: 'Finish release 1.0.0…' }).click()
  await expect(dialog(h.page).getByRole('list', { name: 'What it does' })).toContainText('Tag it v1.0.0.')
  await dialog(h.page).getByLabel('Tag message').fill('First release')
  await dialog(h.page).getByRole('switch', { name: 'Keep release/1.0.0' }).click()
  await dialog(h.page).getByRole('button', { name: 'Finish release' }).click()
  await expect(toasts()).toContainText('Merged into main and develop, tagged v1.0.0.')
  expect(head()).toBe('develop')
  expect(git('log', '-1', '--format=%s', 'main')).toBe("Merge branch 'release/1.0.0' into main")
  expect(git('cat-file', '-t', 'v1.0.0')).toBe('tag')
  expect(git('tag', '-l', '--format=%(contents:subject)', 'v1.0.0')).toBe('First release')
  expect(git('rev-parse', 'v1.0.0^{commit}')).toBe(git('rev-parse', 'main'))
  // The release itself went into develop too (as git-flow does: the branch, not main's merge commit).
  git('merge-base', '--is-ancestor', 'release/1.0.0', 'develop')
  expect(git('log', '-1', '--format=%s', 'develop')).toBe("Merge branch 'release/1.0.0' into develop")
  // Kept, as asked.
  expect(has('refs/heads/release/1.0.0')).toBe(true)
  git('branch', '-D', 'release/1.0.0')
})

test('F81-H4: a hotfix from main; finishing stops on conflicts with develop, and carries on once they’re committed', async () => {
  // develop changes the line the hotfix changes.
  commit('a.txt', 'one\nTWO on develop\nthree\n', 'Develop changes two')
  await start('hotfix', '1.0.1')
  await expect.poll(head).toBe('hotfix/1.0.1')
  expect(git('merge-base', 'hotfix/1.0.1', 'main')).toBe(git('rev-parse', 'main'))
  commit('a.txt', 'one\ntwo, fixed\nthree\n', 'Fix two')
  await h.page.evaluate(() => window.dispatchEvent(new Event('focus')))

  await flowBlock().getByRole('button', { name: 'Finish hotfix 1.0.1' }).click()
  await dialog(h.page).getByRole('button', { name: 'Finish hotfix' }).click()
  await expect(dialog(h.page)).toContainText('Merging hotfix/1.0.1 into develop stopped on conflicts.')
  await dialog(h.page).getByRole('button', { name: 'Cancel' }).click()
  // main got it and the tag, before the conflict.
  expect(git('log', '-1', '--format=%s', 'main')).toBe("Merge branch 'hotfix/1.0.1' into main")
  expect(has('refs/tags/v1.0.1')).toBe(true)
  const tag = git('rev-parse', 'v1.0.1')

  // Resolved and committed, in a terminal.
  writeFileSync(join(repo, 'a.txt'), 'one\ntwo, fixed, on develop\nthree\n')
  git('add', 'a.txt')
  git('commit', '-q', '--no-edit')
  await h.page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await local('hotfix/1.0.1').click({ button: 'right' })
  await h.page.getByRole('menuitem', { name: 'Finish hotfix 1.0.1…' }).click()
  await dialog(h.page).getByRole('button', { name: 'Finish hotfix' }).click()
  await expect(toasts()).toContainText('It was already merged, hotfix/1.0.1 deleted.')
  expect(head()).toBe('develop')
  expect(has('refs/heads/hotfix/1.0.1')).toBe(false)
  expect(git('rev-parse', 'v1.0.1')).toBe(tag)
})

test('F81-H5: settings come from git config and can change; a finish with changes in the way is refused', async () => {
  // Set by the git-flow tool, say.
  git('config', 'gitflow.prefix.feature', 'feat/')
  await h.page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await h.page.getByRole('button', { name: /^Local branches/ }).click({ button: 'right' })
  await h.page.getByRole('menuitem', { name: 'Git Flow settings…' }).click()
  await expect(dialog(h.page).getByLabel('Feature prefix')).toHaveValue('feat/')
  await dialog(h.page).getByLabel('Feature prefix').fill('topic/')
  await dialog(h.page).getByRole('button', { name: 'Save' }).click()
  await expect.poll(() => git('config', 'gitflow.prefix.feature')).toBe('topic/')

  await start('feature', 'tidy')
  await expect.poll(head).toBe('topic/tidy')
  writeFileSync(join(repo, 'a.txt'), 'not committed\n')
  await h.page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await flowBlock().getByRole('button', { name: 'Finish feature tidy' }).click()
  await dialog(h.page).getByRole('button', { name: 'Finish feature' }).click()
  await expect(dialog(h.page)).toContainText('Commit or stash your changes first: finishing switches branches.')
  await dialog(h.page).getByRole('button', { name: 'Cancel' }).click()
  expect(head()).toBe('topic/tidy')
  git('checkout', '-q', '--', 'a.txt')
})

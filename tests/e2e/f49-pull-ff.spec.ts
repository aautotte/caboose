// F49: pull a branch that isn't checked out (fast-forward only, without switching); double-click a remote branch to
// fast-forward the local one; interactive rebase onto another branch from its menu; when uncommitted changes are in
// the way of a pull, stash them and pull, or discard them and pull.
import { test, expect } from '@playwright/test'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dialog, gitIn, launch, makeRepo, seed, type Harness } from './harness'

let h: Harness
const origin = join(seed, 'ff-origin.git')
const repo = join(seed, 'ff')
const peer = join(seed, 'ff-peer')

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => {
  h = await launch('ff', {
    open: [repo],
    setup: (env) => {
      for (const d of [origin, repo, peer]) rmSync(d, { recursive: true, force: true })
      const src = makeRepo(env, 'ff-src', [
        ['Start', { 'README.md': 'hi\n', 'a.txt': 'one\ntwo\nthree\nfour\nfive\n' }],
        ['Second', { 'b.txt': 'b\n' }]
      ])
      for (const b of ['other', 'feat']) gitIn(env, src, 'branch', b)
      gitIn(env, seed, 'clone', '-q', '--bare', src, origin)
      gitIn(env, seed, 'clone', '-q', origin, repo)
      for (const b of ['other', 'feat']) gitIn(env, repo, 'branch', '-q', '--track', b, `origin/${b}`)
      gitIn(env, seed, 'clone', '-q', origin, peer)
    }
  })
  await h.page.getByRole('tab', { name: 'ff', exact: true }).click()
})
test.afterAll(async () => {
  await h.close()
})
test.afterEach(() => h.expectClean())

const local = (name: string) => h.page.getByRole('tree', { name: 'Local branches' }).getByRole('treeitem', { name: new RegExp(`^${name}(,|$)`) })
const remoteRow = (name: string) => h.page.getByRole('group', { name: 'origin' }).getByRole('treeitem', { name, exact: true })
const toasts = () => h.page.getByRole('region', { name: /Notifications/ })
const head = (): string => h.git(repo, 'rev-parse', '--abbrev-ref', 'HEAD')
const sha = (dir: string, ref: string): string => h.git(dir, 'rev-parse', ref)
/** A commit on `branch` in the peer clone, pushed to origin. */
function peerCommit(branch: string, file: string, content: string): string {
  h.git(peer, 'switch', '-q', branch)
  writeFileSync(join(peer, file), content)
  h.git(peer, 'commit', '-q', '-am', `Peer: ${file}`)
  h.git(peer, 'push', '-q', 'origin', branch)
  return sha(peer, 'HEAD')
}

test('F49-H1: Pull on a branch that isn’t checked out fetches and fast-forwards it; main stays checked out', async () => {
  const theirs = peerCommit('other', 'b.txt', 'b from peer\n')
  expect(sha(repo, 'other')).not.toBe(theirs)
  await local('other').click({ button: 'right' })
  await h.page.getByRole('menuitem', { name: 'Pull', exact: true }).click()
  await expect(toasts().getByText('Fast-forwarded other to origin/other')).toBeVisible()
  expect(sha(repo, 'other')).toBe(theirs)
  expect(head()).toBe('main')
})

test('F49-H2: Pull on a branch that has its own commits says it can’t fast-forward, and leaves it alone', async () => {
  h.git(repo, 'update-ref', 'refs/heads/other', h.git(repo, 'commit-tree', '-p', 'other', '-m', 'Mine on other', 'other^{tree}'))
  const mine = sha(repo, 'other')
  peerCommit('other', 'b.txt', 'b from peer again\n')
  await local('other').click({ button: 'right' })
  await h.page.getByRole('menuitem', { name: 'Pull', exact: true }).click()
  await expect(toasts().getByText('Can’t fast-forward', { exact: true })).toBeVisible()
  await expect(toasts()).toContainText('it has commits that origin/other doesn’t')
  expect(sha(repo, 'other')).toBe(mine)
})

test('F49-H3: double-clicking a remote branch fast-forwards the local one without switching; if it can’t, it says so', async () => {
  const theirs = peerCommit('feat', 'b.txt', 'feat from peer\n')
  h.git(repo, 'fetch', '-q', 'origin')
  await expect(remoteRow('feat')).toBeVisible()
  await remoteRow('feat').dblclick()
  await expect(toasts().getByText('Fast-forwarded feat to origin/feat')).toBeVisible()
  expect(sha(repo, 'feat')).toBe(theirs)
  expect(head()).toBe('main')

  await remoteRow('feat').dblclick()
  await expect(toasts().getByText('feat is already up to date with origin/feat.')).toBeVisible()

  h.git(repo, 'update-ref', 'refs/heads/feat', h.git(repo, 'commit-tree', '-p', 'feat', '-m', 'Mine on feat', 'feat^{tree}'))
  peerCommit('feat', 'b.txt', 'feat from peer again\n')
  h.git(repo, 'fetch', '-q', 'origin')
  const mine = sha(repo, 'feat')
  await remoteRow('feat').dblclick()
  await expect(toasts().getByText('Can’t fast-forward', { exact: true })).toBeVisible()
  expect(sha(repo, 'feat')).toBe(mine)
})

test('F49-H4: right-click main › Interactive rebase topic onto main… opens the rebase on main, and it runs', async () => {
  h.git(repo, 'switch', '-q', '-c', 'topic')
  for (const n of ['t1', 't2']) {
    writeFileSync(join(repo, `${n}.txt`), `${n}\n`)
    h.git(repo, 'add', '.')
    h.git(repo, 'commit', '-q', '-m', `Topic ${n}`)
  }
  h.git(repo, 'switch', '-q', 'main')
  writeFileSync(join(repo, 'c.txt'), 'c\n')
  h.git(repo, 'add', '.')
  h.git(repo, 'commit', '-q', '-m', 'Main moves on')
  h.git(repo, 'switch', '-q', 'topic')
  await expect(local('topic')).toHaveAttribute('aria-current', 'true')
  await local('main').click({ button: 'right' })
  await h.page.getByRole('menuitem', { name: 'Interactive rebase topic onto main…' }).click()
  const view = h.page.getByRole('region', { name: 'Rebase topic onto main' })
  const list = view.getByRole('list', { name: 'Commits, oldest first' })
  await expect(list.getByRole('listitem')).toHaveCount(2)
  await view.getByRole('button', { name: 'Start rebase' }).click()
  await expect.poll(h.gitOr(repo, 'rev-parse', 'topic~2')).toBe(sha(repo, 'main'))
  h.git(repo, 'switch', '-q', 'main')
})

test('F49-H5: changes in the way of a pull: Stash and pull brings them back after; Discard and pull drops them', async () => {
  h.git(repo, 'reset', '-q', '--hard', 'origin/main')
  // The peer changes line one of a.txt; we change line five, so the stash comes back cleanly.
  const theirs = peerCommit('main', 'a.txt', 'ONE\ntwo\nthree\nfour\nfive\n')
  writeFileSync(join(repo, 'a.txt'), 'one\ntwo\nthree\nfour\nFIVE\n')
  await h.page.getByRole('toolbar', { name: 'Repository actions' }).getByRole('button', { name: /^Pull/ }).first().click()
  await expect(dialog(h.page)).toContainText('Your changes are in the way')
  await expect(dialog(h.page)).toContainText('a.txt has uncommitted changes the pull would overwrite.')
  await dialog(h.page).getByRole('button', { name: 'Stash and pull' }).click()
  await expect.poll(() => sha(repo, 'main')).toBe(theirs)
  // git moves the branch first, then puts the stashed changes back.
  await expect.poll(() => readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('ONE\ntwo\nthree\nfour\nFIVE\n')
  await expect.poll(() => h.git(repo, 'stash', 'list')).toBe('')

  const again = peerCommit('main', 'a.txt', 'ONE\nTWO\nthree\nfour\nfive\n')
  await h.page.getByRole('toolbar', { name: 'Repository actions' }).getByRole('button', { name: /^Pull/ }).first().click()
  await dialog(h.page).getByRole('button', { name: 'Discard and pull…' }).click()
  await expect(dialog(h.page)).toContainText('Discard your changes and pull?')
  await dialog(h.page).getByRole('button', { name: 'Discard and pull' }).click()
  await expect.poll(() => sha(repo, 'main')).toBe(again)
  expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('ONE\nTWO\nthree\nfour\nfive\n')
})

test('F49-H6: right-click origin/other › Reset other to origin/other… moves a branch that isn’t checked out; Undo puts it back', async () => {
  // From H2, other has a commit of its own and origin/other another one.
  const mine = sha(repo, 'other')
  const theirs = sha(repo, 'origin/other')
  expect(mine).not.toBe(theirs)
  await remoteRow('other').click({ button: 'right' })
  await h.page.getByRole('menuitem', { name: 'Reset other to origin/other…' }).click()
  await expect(dialog(h.page)).toContainText('Reset other to origin/other')
  await expect(dialog(h.page)).toContainText('other isn’t checked out, so only the branch moves')
  await expect(dialog(h.page).getByRole('radio')).toHaveCount(0)
  await dialog(h.page).getByRole('button', { name: 'Reset' }).click()
  await expect.poll(() => sha(repo, 'other')).toBe(theirs)
  expect(head()).toBe('main')
  await h.page.getByRole('button', { name: /^Undo: Reset other to origin\/other/ }).click()
  await expect.poll(() => sha(repo, 'other')).toBe(mine)
})

test('F49-H7: on the checked-out branch, Reset main to origin/main… offers soft, mixed and hard', async () => {
  writeFileSync(join(repo, 'mine.txt'), 'mine\n')
  h.git(repo, 'add', '.')
  h.git(repo, 'commit', '-q', '-m', 'Mine on main')
  await expect(local('main')).toHaveAccessibleName(/1 ahead/)
  await remoteRow('main').click({ button: 'right' })
  await h.page.getByRole('menuitem', { name: 'Reset main to origin/main…' }).click()
  await expect(dialog(h.page)).toContainText('Reset main to origin/main')
  await expect(dialog(h.page).getByRole('radio')).toHaveCount(3)
  await dialog(h.page).getByRole('radio', { name: /^Discard changes/ }).check()
  await dialog(h.page).getByRole('button', { name: 'Reset' }).click()
  await expect.poll(() => sha(repo, 'main')).toBe(sha(repo, 'origin/main'))
  await expect.poll(() => h.gitOr(repo, 'status', '--porcelain')()).toBe('')
})

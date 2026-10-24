// Edge and negative cases for profiles (F34), diff controls (F35) and the graphics fallback (F36).
import { test, expect } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { invoke, launch, makeRepo, openDiffNow, openWip, repoId, seed, type Harness } from './harness'

let h: Harness
let repo = ''
let id = ''

test.describe.configure({ mode: 'serial' })

test.describe('profiles and diff controls: edges', () => {
  test.beforeAll(async () => {
    h = await launch('p-edges', {
      open: [join(seed, 'edgy')],
      setup: (env) => {
        repo = makeRepo(env, 'edgy', [['Start', { 'a.txt': 'one\n  two\nthree\n', 'b.txt': 'b\n' }]])
      }
    })
    await h.page.getByRole('tab', { name: 'edgy' }).click()
    id = await repoId(h.page, repo)
  })
  test.afterAll(async () => {
    await h.close()
  })
  test.afterEach(() => h.expectClean())

  const profiles = async (): Promise<Array<{ id: string; name: string; isActive: boolean }>> => {
    const r = await invoke<Array<{ id: string; name: string; isActive: boolean }>>(h.page, 'profile.list', {})
    return r.ok ? r.value : []
  }
  const active = async (): Promise<string> => (await profiles()).find((p) => p.isActive)!.id
  const commitButton = () => h.page.getByRole('form', { name: 'Commit' }).getByRole('button', { name: /^Commit/ })
  const profilesDialog = () => h.page.getByRole('dialog').filter({ has: h.page.getByRole('heading', { name: 'Profiles' }) })
  /** Closes the profiles dialog with its own button and waits until it's gone (Escape is covered by F34-K1). */
  async function closeProfiles(): Promise<void> {
    await profilesDialog().getByRole('button', { name: 'Close', exact: true }).click()
    await expect(profilesDialog()).toHaveCount(0)
  }
  async function commitFile(file: string, summary: string): Promise<void> {
    writeFileSync(join(repo, file), `${summary}\n`)
    await openWip(h.page)
    await h.page.getByRole('button', { name: 'Stage all', exact: true }).click()
    await h.page.getByLabel('Commit summary').fill(summary)
    await commitButton().click()
    await expect.poll(() => h.git(repo, 'log', '-1', '--format=%s')).toBe(summary)
  }

  test('F34-E3: accents and emoji in the profile’s name reach the commit byte for byte', async () => {
    const r = await invoke(h.page, 'profile.update', { id: await active(), authorName: 'Zoë ☀️ Ünïcode', authorEmail: 'zoe@example.com' })
    expect(r).toMatchObject({ ok: true })
    await h.page.reload()
    await commitFile('c.txt', 'Accented author')
    expect(h.git(repo, 'log', '-1', '--format=%an <%ae>')).toBe('Zoë ☀️ Ünïcode <zoe@example.com>')
  })

  test('F34-E2: an SSH key file that has since been deleted is left out, and the dialog says it’s missing', async () => {
    expect(await invoke(h.page, 'profile.update', { id: await active(), sshKey: 'id_gone' })).toMatchObject({ ok: true })
    await commitFile('d.txt', 'Key file gone')
    const log = await invoke<Array<{ argv: string[] }>>(h.page, 'activity.list', { repoId: id, limit: 200 })
    const commit = log.ok ? log.value.find((e) => e.argv.includes('commit')) : undefined
    expect(commit?.argv.join(' ')).toContain('user.email=zoe@example.com')
    expect(commit?.argv.join(' ')).not.toContain('core.sshcommand')
    await h.page.getByRole('button', { name: /^Profile: / }).click()
    await h.page.getByRole('menuitem', { name: 'Manage profiles…' }).click()
    await expect(profilesDialog().getByRole('combobox', { name: 'SSH key for fetch and push' })).toHaveText(/~\/\.ssh\/id_gone \(missing\)/)
    await closeProfiles()
  })

  test('F34-N2: a 61-character name and an odd signing key are refused with a reason', async () => {
    const long = await invoke(h.page, 'profile.create', { name: 'x'.repeat(61) })
    expect(long).toMatchObject({ ok: false, error: { message: 'Give the profile a name of up to 60 characters.' } })
    const key = await invoke(h.page, 'profile.update', { id: await active(), signingKey: 'abc; rm -rf ~' })
    expect(key).toMatchObject({ ok: false, error: { message: 'That doesn’t look like a key ID.' } })
  })

  test('F34-K1: the profile menu and dialog work from the keyboard', async () => {
    await h.page.getByRole('button', { name: /^Profile: / }).focus()
    await h.page.keyboard.press('Enter')
    await expect(h.page.getByRole('menu')).toBeVisible()
    // One profile so far: the arrow moves from it to "Manage profiles…".
    await h.page.keyboard.press('ArrowDown')
    await expect(h.page.getByRole('menuitem', { name: 'Manage profiles…' })).toBeFocused()
    await h.page.keyboard.press('Enter')
    await expect(profilesDialog()).toBeVisible()
    await expect(profilesDialog().locator(':focus')).toHaveCount(1)
    await h.page.keyboard.press('Escape')
    await expect(profilesDialog()).toHaveCount(0)
  })

  test('F34-E6: changing this repository’s email in Settings updates the “As …” line', async () => {
    writeFileSync(join(repo, 'e.txt'), 'e\n')
    await openWip(h.page)
    await expect(h.page.getByText(/^As Zoë ☀️ Ünïcode <zoe@example\.com>/)).toBeVisible()
    await h.page.getByRole('button', { name: 'Settings' }).click()
    const here = h.page.getByRole('region', { name: /^This repository/ })
    await here.getByLabel('Email').fill('here@repo.example')
    await here.getByRole('button', { name: 'Save' }).first().click()
    await expect(h.page.getByText('Saved for this repository', { exact: true })).toBeVisible()
    await h.page.getByRole('button', { name: 'Close settings' }).click()
    await expect(h.page.getByText('As Zoë ☀️ Ünïcode <here@repo.example> · from this repository’s setting')).toBeVisible()
    h.git(repo, 'config', '--unset', 'user.email')
  })

  test('F34-E4: switching profiles while git is busy is refused, and nothing switches', async () => {
    const other = await invoke<{ id: string }>(h.page, 'profile.create', { name: 'Elsewhere' })
    expect(other.ok).toBe(true)
    // A remote whose "server" just sleeps keeps a fetch, and so the repository, busy for a few seconds.
    h.git(repo, 'config', 'protocol.ext.allow', 'always')
    h.git(repo, 'remote', 'add', 'slow', 'ext::sh -c sleep% 6')
    const fetching = invoke(h.page, 'remote.fetch', { repoId: id, opId: crypto.randomUUID() })
    await expect.poll(async () => (await invoke<Array<{ status: string; argv: string[] }>>(h.page, 'activity.list', { repoId: id, limit: 5 })).ok).toBe(true)
    await h.page.waitForTimeout(800)
    const refused = await invoke(h.page, 'profile.switch', { id: other.ok ? (other.value as { id: string }).id : '' })
    expect(refused).toMatchObject({ ok: false, error: { message: 'Wait for the running Git command to finish, then switch.' } })
    expect((await profiles()).find((p) => p.isActive)?.name).toBe('Default')
    await fetching
    h.git(repo, 'remote', 'remove', 'slow')
    await h.page.getByRole('region', { name: /Notifications/ }).getByRole('button', { name: 'Dismiss' }).first().click().catch(() => {})
  })

  test('F35-E2: hiding whitespace works on staged changes and on commits too', async () => {
    writeFileSync(join(repo, 'a.txt'), 'one\n    two\nthree staged\n')
    h.git(repo, 'add', 'a.txt')
    const changed = async (source: unknown): Promise<number> => {
      const r = await invoke<{ hunks: Array<{ lines: Array<{ type: string }> }> }>(h.page, 'diff.get', { repoId: id, path: 'a.txt', source, ignoreWs: true })
      return r.ok ? r.value.hunks.flatMap((x) => x.lines).filter((l) => l.type !== 'ctx').length : -1
    }
    expect(await changed({ kind: 'index' })).toBe(2)
    await openDiffNow(h.page, id, 'a.txt', { kind: 'index' })
    const diff = h.page.getByRole('region', { name: 'Changes in a.txt' })
    await diff.getByRole('button', { name: 'Hide whitespace changes' }).click()
    await expect(diff.getByText(/Whitespace changes are hidden/)).toBeVisible()
    await diff.getByRole('button', { name: 'Hide whitespace changes' }).click()
    h.git(repo, 'commit', '-q', '-m', 'Indent and edit')
    const sha = h.git(repo, 'rev-parse', 'HEAD')
    expect(await changed({ kind: 'commit', sha })).toBe(2)
  })

  test('F35-E4: closing a full-width diff brings the side panels back', async () => {
    writeFileSync(join(repo, 'b.txt'), 'b changed\n')
    await openDiffNow(h.page, id, 'b.txt', { kind: 'worktree' })
    const diff = h.page.getByRole('region', { name: 'Changes in b.txt' })
    await diff.getByRole('button', { name: 'Use the full width' }).click()
    await expect(h.page.getByRole('region', { name: 'Details' })).toHaveCount(0)
    await diff.getByRole('button', { name: 'Close diff' }).click()
    await expect(h.page.getByRole('grid', { name: 'Commit history' })).toBeVisible()
    await expect(h.page.getByRole('region', { name: 'Details' })).toBeVisible()
    await expect(h.page.getByRole('tree', { name: 'Local branches' })).toBeVisible()
  })

  test('F35-E5: with only untracked files and those hidden, the list says what it’s hiding', async () => {
    h.git(repo, 'checkout', '--', 'b.txt')
    h.git(repo, 'clean', '-fdq')
    writeFileSync(join(repo, 'only-new.txt'), 'new\n')
    await openWip(h.page)
    await h.page.getByRole('button', { name: 'Hide untracked files' }).click()
    await expect(h.page.getByText('1 untracked file hidden.')).toBeVisible()
    await expect(h.page.getByRole('region', { name: 'Not staged' }).getByText('Everything is staged.')).toBeVisible()
    await h.page.getByRole('button', { name: 'Show', exact: true }).click()
    await expect(h.page.getByRole('listbox', { name: 'Not staged' }).getByRole('option', { name: /only-new\.txt/ })).toBeVisible()
  })
})

test.describe('graphics fallback: edges', () => {
  const gpuFile = (): string => join(seed, 'userdata-gpu-edges', 'gpu.json')

  test('F36-E1: an unreadable gpu.json is ignored and the app starts accelerated', async () => {
    let g = await launch('gpu-edges', { open: [] })
    await g.close()
    writeFileSync(gpuFile(), '{ not json')
    g = await launch('gpu-edges', { open: [], reseed: false, keepUserData: true })
    try {
      expect(await invoke(g.page, 'gpu.get', {})).toMatchObject({ ok: true, value: { nextStart: true, fellBack: false } })
      await expect(g.page.getByText('Started without graphics acceleration', { exact: true })).toHaveCount(0)
      g.expectClean()
    } finally {
      await g.close()
    }
  })

  test('F36-E2: turned off by you, the next start is in software, with no crash notice', async () => {
    let g = await launch('gpu-edges', { open: [], reseed: false, keepUserData: true })
    expect(await invoke(g.page, 'gpu.set', { on: false })).toMatchObject({ ok: true })
    await g.close()
    g = await launch('gpu-edges', { open: [], reseed: false, keepUserData: true })
    try {
      expect(await invoke(g.page, 'gpu.get', {})).toMatchObject({ ok: true, value: { enabled: false, nextStart: false, fellBack: false } })
      await g.page.waitForTimeout(1500)
      await expect(g.page.getByText('Started without graphics acceleration', { exact: true })).toHaveCount(0)
      g.expectClean()
    } finally {
      await g.close()
    }
  })
})

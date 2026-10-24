// Profiles with their own identity (F34), diff controls (F35) and the
// graphics fallback after a GPU crash (F36).
import { test, expect } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { appState, axe, dialog, invoke, launch, makeRepo, openDiffNow, openWip, repoId, seed, type Harness } from './harness'

let h: Harness
let repo = ''
let id = ''

test.describe.configure({ mode: 'serial' })

test.describe('profiles and diff controls', () => {
  test.beforeAll(async () => {
    h = await launch('profiles', {
      open: [join(seed, 'who')],
      setup: (env) => {
        repo = makeRepo(env, 'who', [['Start', { 'a.txt': 'one\n  two\nthree\n', 'b.txt': 'x\n' }]])
        // Stand-ins for SSH keys: the app only checks that the file is there.
        const ssh = join(env.HOME!, '.ssh')
        mkdirSync(ssh, { recursive: true })
        writeFileSync(join(ssh, 'id_work'), 'not a real key\n')
        writeFileSync(join(ssh, 'id_work.pub'), 'ssh-ed25519 AAAAC3Nza work@laptop\n')
      }
    })
    await h.page.getByRole('tab', { name: 'who' }).click()
    id = await repoId(h.page, repo)
  })
  test.afterAll(async () => {
    await h.close()
  })
  test.afterEach(() => h.expectClean())

  const profileButton = () => h.page.getByRole('button', { name: /^Profile: / })
  const profilesDialog = () => dialog(h.page).filter({ has: h.page.getByRole('heading', { name: 'Profiles' }) })
  /** Closes the profiles dialog with its own button and waits until it's gone (Escape is covered by F34-K1). */
  async function closeProfiles(): Promise<void> {
    await profilesDialog().getByRole('button', { name: 'Close', exact: true }).click()
    await expect(profilesDialog()).toHaveCount(0)
  }
  const chip = (name: string) => profilesDialog().getByRole('group', { name: 'Profiles' }).getByRole('button', { name })
  const author = (): string => h.git(repo, 'log', '-1', '--format=%an <%ae>')
  const commitButton = () => h.page.getByRole('form', { name: 'Commit' }).getByRole('button', { name: /^Commit/ })
  async function commitFile(file: string, text: string, summary: string): Promise<void> {
    writeFileSync(join(repo, file), text)
    await openWip(h.page)
    await h.page.getByRole('button', { name: 'Stage all', exact: true }).click()
    await h.page.getByLabel('Commit summary').fill(summary)
    await commitButton().click()
    await expect.poll(() => h.git(repo, 'log', '-1', '--format=%s')).toBe(summary)
  }
  async function manage(): Promise<void> {
    await profileButton().click()
    await h.page.getByRole('menuitem', { name: 'Manage profiles…' }).click()
    await profilesDialog().waitFor()
  }
  /** Switching reloads the window; wait for the new page rather than for the click. */
  async function reloadsAfter(click: () => Promise<void>): Promise<void> {
    const loaded = h.page.waitForEvent('load')
    await click()
    await loaded
  }
  async function switchTo(name: string): Promise<void> {
    await profileButton().click()
    await reloadsAfter(() => h.page.getByRole('menuitem', { name }).click({ noWaitAfter: true }))
    await expect(profileButton()).toHaveAccessibleName(`Profile: ${name}`)
  }

  test('F34-H1: the profile in use is shown, and commits say who they are by', async () => {
    await expect(profileButton()).toHaveAccessibleName('Profile: Default')
    writeFileSync(join(repo, 'notes.txt'), 'notes\n')
    await openWip(h.page)
    // One profile: no "from" note needed, just the identity.
    await expect(h.page.getByText('As E2E <e2e@example.com>', { exact: true })).toBeVisible()
  })

  test('F34-H2: a new profile with its own name and email commits under it', async () => {
    await manage()
    await profilesDialog().getByRole('button', { name: 'New profile' }).click()
    await profilesDialog().getByLabel('New profile name').fill('Work')
    await profilesDialog().getByRole('button', { name: 'Add' }).click()
    await expect(chip('Work')).toHaveAttribute('aria-pressed', 'true')
    await profilesDialog().getByLabel('Commit as (name)').fill('Wanda Work')
    await profilesDialog().getByLabel('Commit as (email)').fill('wanda@work.example')
    await profilesDialog().getByRole('combobox', { name: 'SSH key for fetch and push' }).click()
    await h.page.getByRole('option', { name: '~/.ssh/id_work' }).click()
    await profilesDialog().getByRole('button', { name: 'Save' }).click()
    await expect(h.page.getByText('Saved the Work profile', { exact: true })).toBeVisible()
    expect(await axe(h.page)).toEqual([])
    await reloadsAfter(() => profilesDialog().getByRole('button', { name: 'Switch to Work' }).click({ noWaitAfter: true }))
    await expect(profileButton()).toHaveAccessibleName('Profile: Work')

    // A profile has its own tabs: Work starts with none.
    await expect(h.page.getByRole('tab', { name: 'who' })).toHaveCount(0)
    expect(await invoke(h.page, 'repo.open', { path: repo })).toMatchObject({ ok: true })
    await h.page.reload()
    await h.page.getByRole('tab', { name: 'who' }).click()
    id = await repoId(h.page, repo)

    await openWip(h.page)
    await expect(h.page.getByText('As Wanda Work <wanda@work.example> · from the Work profile')).toBeVisible()
    await commitFile('c.txt', 'c\n', 'Committed at work')
    expect(author()).toBe('Wanda Work <wanda@work.example>')
    // Git's own config files are untouched; the settings ride along on the command, in plain sight in the log.
    expect(h.git(repo, 'config', '--get', 'user.email')).toBe('e2e@example.com')
    const log = await invoke<Array<{ argv: string[] }>>(h.page, 'activity.list', { repoId: id, limit: 50 })
    const commit = log.ok ? log.value.find((e) => e.argv.includes('commit')) : undefined
    expect(commit?.argv).toEqual(expect.arrayContaining(['-c', 'user.email=wanda@work.example']))
    expect(commit?.argv.join(' ')).toMatch(/core\.sshcommand=ssh -i ".*\/\.ssh\/id_work" -o IdentitiesOnly=yes/)
  })

  test('F34-E1: a repository’s own email still wins over the profile', async () => {
    expect(await invoke(h.page, 'identity.set', { repoId: id, name: '', email: 'repo@local.example' })).toMatchObject({ ok: true })
    await h.page.reload()
    writeFileSync(join(repo, 'd.txt'), 'd\n')
    await openWip(h.page)
    await expect(h.page.getByText('As Wanda Work <repo@local.example> · from this repository’s setting')).toBeVisible()
    await commitFile('d.txt', 'd\n', 'Committed with the repo email')
    expect(author()).toBe('Wanda Work <repo@local.example>')
    h.git(repo, 'config', '--unset', 'user.email')
  })

  test('F34-N1: names must be unique, emails valid, and the profile in use can’t be deleted', async () => {
    await manage()
    await expect(profilesDialog().getByRole('button', { name: 'Delete…' })).toBeDisabled()
    await profilesDialog().getByRole('button', { name: 'New profile' }).click()
    await profilesDialog().getByLabel('New profile name').fill('default')
    await profilesDialog().getByRole('button', { name: 'Add' }).click()
    await expect(profilesDialog().getByRole('alert')).toHaveText('There’s already a profile called default.')
    await profilesDialog().getByRole('button', { name: 'Cancel' }).click()
    await profilesDialog().getByLabel('Commit as (email)').fill('not an email')
    await expect(profilesDialog().getByText('That doesn’t look like an email address.')).toBeVisible()
    await expect(profilesDialog().getByRole('button', { name: 'Save' })).toBeDisabled()
    await closeProfiles()
  })

  test('F34-H3: switching back brings the other profile’s tabs and identity back; a profile can be deleted', async () => {
    await switchTo('Default')
    await h.page.getByRole('tab', { name: 'who' }).click()
    // Each profile has its own record of the folder, so the id is Default's again.
    id = await repoId(h.page, repo)
    await commitFile('e.txt', 'e\n', 'Back home')
    expect(author()).toBe('E2E <e2e@example.com>')
    await manage()
    await chip('Work').click()
    await profilesDialog().getByRole('button', { name: 'Delete…' }).click()
    await dialog(h.page).getByRole('button', { name: 'Delete profile' }).click()
    await profilesDialog().waitFor()
    await expect(chip('Work')).toHaveCount(0)
    await closeProfiles()
    const all = await appState<{ profiles: Array<{ name: string }> }>(h.page)
    expect(all.profiles.map((p) => p.name)).toEqual(['Default'])
  })

  test('F35-H1: hide whitespace changes; blocks can’t be staged while they’re hidden', async () => {
    writeFileSync(join(repo, 'a.txt'), 'one\n    two\nthree changed\n')
    await openDiffNow(h.page, id, 'a.txt', { kind: 'worktree' })
    const diff = h.page.getByRole('region', { name: 'Changes in a.txt' })
    await expect(diff.getByRole('button', { name: /^Stage/ }).first()).toBeVisible()
    await diff.getByRole('button', { name: 'Hide whitespace changes' }).click()
    await expect(diff.getByText(/Whitespace changes are hidden/)).toBeVisible()
    // The re-indented line drops out of the changes; the real edit stays.
    const changed = async (ignoreWs: boolean): Promise<string[]> => {
      const r = await invoke<{ hunks: Array<{ lines: Array<{ type: string; text: string }> }> }>(h.page, 'diff.get', { repoId: id, path: 'a.txt', source: { kind: 'worktree' }, ignoreWs })
      return r.ok ? r.value.hunks.flatMap((x) => x.lines.filter((l) => l.type !== 'ctx').map((l) => `${l.type} ${l.text}`)) : []
    }
    expect((await changed(false)).length).toBe(4)
    expect(await changed(true)).toEqual(['del three', 'add three changed'])
    await expect(diff.getByRole('button', { name: /^Stage/ })).toHaveCount(0)
    expect(await axe(h.page)).toEqual([])
    await diff.getByRole('button', { name: 'Show whitespace' }).click()
    await expect(diff.getByRole('button', { name: /^Stage/ }).first()).toBeVisible()
  })

  test('F35-E1: a file where only whitespace changed says so', async () => {
    writeFileSync(join(repo, 'b.txt'), 'x  \n')
    await openDiffNow(h.page, id, 'b.txt', { kind: 'worktree' })
    const diff = h.page.getByRole('region', { name: 'Changes in b.txt' })
    await diff.getByRole('button', { name: 'Hide whitespace changes' }).click()
    await expect(diff.getByText('Only whitespace changed')).toBeVisible()
    await diff.getByRole('button', { name: 'Show whitespace' }).click()
    await expect(diff.getByText('Only whitespace changed')).toHaveCount(0)
  })

  test('F35-H2: the diff can take the full width, and give it back', async () => {
    const diff = h.page.getByRole('region', { name: 'Changes in b.txt' })
    await diff.getByRole('button', { name: 'Use the full width' }).click()
    await expect(h.page.getByRole('region', { name: 'Details' })).toHaveCount(0)
    await expect(h.page.getByRole('tree', { name: 'Local branches' })).toHaveCount(0)
    await diff.getByRole('button', { name: 'Use the full width' }).click()
    await expect(h.page.getByRole('region', { name: 'Details' })).toBeVisible()
    await expect(h.page.getByRole('tree', { name: 'Local branches' })).toBeVisible()
  })

  test('F35-H3: hiding untracked files hides them from the list and from Stage all', async () => {
    writeFileSync(join(repo, 'new.txt'), 'new\n')
    await openWip(h.page)
    const unstaged = h.page.getByRole('listbox', { name: 'Not staged' })
    await expect(unstaged.getByRole('option', { name: /new\.txt/ })).toBeVisible()
    await h.page.getByRole('button', { name: 'Hide untracked files' }).click()
    await expect(unstaged.getByRole('option', { name: /new\.txt/ })).toHaveCount(0)
    await expect(h.page.getByText('1 untracked file hidden.')).toBeVisible()
    await h.page.getByRole('button', { name: 'Stage all', exact: true }).click()
    await expect.poll(() => h.git(repo, 'status', '--porcelain', '--', 'new.txt', 'a.txt')).toBe('M  a.txt\n?? new.txt')
    await h.page.getByRole('button', { name: 'Show', exact: true }).click()
    await expect(unstaged.getByRole('option', { name: /new\.txt/ })).toBeVisible()
  })
})

test.describe('graphics fallback', () => {
  const gpuFile = (): string => join(seed, 'userdata-gpu', 'gpu.json')

  test('F36-H1: after the GPU process crashes, the next start draws without it and says so once', async () => {
    let g = await launch('gpu', { open: [] })
    try {
      const before = await invoke<{ enabled: boolean }>(g.page, 'gpu.get', {})
      test.skip(!before.ok || !before.value.enabled, 'no graphics acceleration on this machine to fall back from')
      // Chromium's own debug page makes the GPU process crash on purpose.
      await g.electronApp.evaluate(({ BrowserWindow }) => {
        const w = new BrowserWindow({ show: false })
        void w.loadURL('chrome://gpucrash').catch(() => {})
      })
      await expect.poll(() => (existsSync(gpuFile()) ? readFileSync(gpuFile(), 'utf8') : ''), { timeout: 15_000 }).toContain('"reason":"crash"')
    } finally {
      await g.close()
    }

    g = await launch('gpu', { open: [], reseed: false, keepUserData: true })
    try {
      await expect(g.page.getByText('Started without graphics acceleration', { exact: true })).toBeVisible()
      expect(await invoke(g.page, 'gpu.get', {})).toMatchObject({ ok: true, value: { enabled: false, nextStart: false, fellBack: false } })
      expect(await g.electronApp.evaluate(({ app }) => app.isHardwareAccelerationEnabled())).toBe(false)
      g.expectClean()
    } finally {
      await g.close()
    }
  })

  test('F36-H2: Settings turns it back on for the next start and offers a restart', async () => {
    writeFileSync(gpuFile(), JSON.stringify({ off: true, reason: 'crash', told: true }))
    const g = await launch('gpu', { open: [demoRepo()], reseed: false, keepUserData: true })
    try {
      await g.page.getByRole('tab', { name: 'demo' }).click()
      await g.page.getByRole('button', { name: 'Settings' }).click()
      const settings = g.page.getByRole('region', { name: 'Settings' })
      await expect(settings.getByText(/Off: Mergatroid is drawing in software/)).toBeVisible()
      await expect(g.page.getByText('Started without graphics acceleration', { exact: true })).toHaveCount(0)
      await settings.getByRole('switch', { name: 'Graphics acceleration' }).click()
      await expect(settings.getByText('Turns on when Mergatroid restarts.')).toBeVisible()
      await expect(settings.getByRole('button', { name: 'Restart now' })).toBeVisible()
      expect(JSON.parse(readFileSync(gpuFile(), 'utf8'))).toMatchObject({ off: false })
      g.expectClean()
    } finally {
      await g.close()
    }
  })
})

const demoRepo = (): string => join(seed, 'demo')

// F82: SSH setup in Settings › SSH keys. Whether ssh-agent is running (here it isn't: the tests point it at a
// pipe that doesn't exist), adding a key to a git host's page (the public key on the clipboard), and testing a
// connection: a host that can't be reached, and one that isn't a host name.
import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { axe, dialog, launch, makeRepo, seed, type Harness } from './harness'

let h: Harness
const repo = join(seed, 'sshset')
const home = join(seed, 'home-sshset')

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => {
  h = await launch('sshset', {
    open: [repo],
    // No agent to talk to, whatever this computer has running.
    extraEnv: { SSH_AUTH_SOCK: process.platform === 'win32' ? '\\\\.\\pipe\\caboose-e2e-no-agent' : join(seed, 'no-agent.sock') },
    setup: (env) => {
      makeRepo(env, 'sshset', [['Base', { 'a.txt': 'a\n' }]])
      mkdirSync(join(home, '.ssh'), { recursive: true })
      execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-f', join(home, '.ssh', 'id_e2e'), '-N', '', '-C', 'e2e key'], { env, stdio: 'ignore' })
    }
  })
  await h.page.getByRole('tab', { name: 'sshset', exact: true }).click()
  await h.electronApp.evaluate(({ shell }) => {
    const g = globalThis as unknown as { opened: string[] }
    g.opened = []
    shell.openExternal = (async (url: string) => void g.opened.push(url)) as typeof shell.openExternal
  })
  await h.page.getByRole('button', { name: 'Settings' }).click()
  await ssh().scrollIntoViewIfNeeded()
})
test.afterAll(async () => {
  await h.close()
})
test.afterEach(() => h.expectClean())

const ssh = () => h.page.getByRole('region', { name: 'Settings' }).getByRole('region', { name: 'SSH keys' })
const testForm = () => ssh().getByRole('form', { name: 'Test an SSH connection' })
const toasts = () => h.page.getByRole('region', { name: /Notifications/ })
const opened = () => h.electronApp.evaluate(() => (globalThis as unknown as { opened: string[] }).opened.at(-1))
const clipboard = () => h.electronApp.evaluate(({ clipboard }) => clipboard.readText())

test('F82-H1: with no ssh-agent running, the list says so and Add to ssh-agent is off', async () => {
  await expect(ssh().getByRole('status', { name: 'ssh-agent' })).toContainText('ssh-agent isn’t running')
  await expect(ssh().getByText('id_e2e', { exact: true })).toBeVisible()
  await ssh().getByRole('button', { name: 'More for id_e2e' }).click()
  await expect(h.page.getByRole('menuitem', { name: 'Add to ssh-agent' })).toBeDisabled()
  await h.page.keyboard.press('Escape')
  expect(await axe(h.page)).toEqual([])
})

test('F82-H2: Add to GitHub copies the public key and opens GitHub’s page for a new key', async () => {
  await ssh().getByRole('button', { name: 'More for id_e2e' }).click()
  await h.page.getByRole('menuitem', { name: 'Add to GitHub…' }).click()
  await expect.poll(opened).toBe('https://github.com/settings/ssh/new')
  await expect.poll(clipboard).toMatch(/^ssh-ed25519 \S+ e2e key$/)
  await expect(toasts()).toContainText('The public key is on your clipboard')
  await ssh().getByRole('button', { name: 'More for id_e2e' }).click()
  await h.page.getByRole('menuitem', { name: 'Add to GitLab…' }).click()
  await expect.poll(opened).toBe('https://gitlab.com/-/user_settings/ssh_keys')
})

test('F82-H3: Test a connection says when a host can’t be reached, and refuses what isn’t a host', async () => {
  await testForm().getByRole('combobox', { name: 'Host' }).click()
  await h.page.getByRole('option', { name: 'Another host…' }).click()
  await testForm().getByLabel('Other host').fill('not a host!')
  await testForm().getByRole('button', { name: 'Test the connection' }).click()
  await expect(toasts()).toContainText('Write a host like github.com, or user@host:port.')

  // Nothing listens on port 1 here.
  await testForm().getByLabel('Other host').fill('git@127.0.0.1:1')
  await testForm().getByRole('combobox', { name: 'Key' }).click()
  await h.page.getByRole('option', { name: 'id_e2e' }).click()
  await testForm().getByRole('button', { name: 'Test the connection' }).click()
  const result = testForm().getByRole('status', { name: 'Connection test' })
  await expect(result).toContainText('Couldn’t reach 127.0.0.1 over SSH', { timeout: 30_000 })
  await result.getByText('What ssh said').click()
  await expect(result.locator('pre')).toContainText(/refused|port 1/i)
  expect(await axe(h.page)).toEqual([])
  await expect(dialog(h.page)).toHaveCount(0)
})

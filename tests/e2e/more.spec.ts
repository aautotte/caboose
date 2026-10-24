// Settings, external tools, signing and the graph extras, end to end on a fresh seed.
// The app runs with a throwaway home folder, git config and GnuPG keyring, so nothing touches your real ones.
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { ciSize } from './harness'

const app = resolve(__dirname, '..', '..')
const seed = join(app, '.seed')
const demo = join(seed, 'demo')
const home = join(seed, 'home-e2e')
const gitconfig = join(home, '.gitconfig')
// Git for Windows' gpg is an MSYS program; a short /tmp path keeps its agent socket path valid.
const gnupg = process.platform === 'win32' ? `/tmp/gc-e2e-gnupg-${Date.now()}` : join(home, '.gnupg')
const env = {
  ...process.env,
  HOME: home,
  USERPROFILE: home,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: gitconfig,
  GNUPGHOME: gnupg
}
const git = (...args: string[]): string => execFileSync('git', args, { cwd: demo, encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const gitOr = (...args: string[]) => (): string => {
  try {
    return git(...args)
  } catch {
    return ''
  }
}
/** Git for Windows' own tools (gpg, rm) live in usr/bin next to git. */
function gitTool(name: string): string {
  if (process.platform !== 'win32') return name
  const exec = execFileSync('git', ['--exec-path'], { encoding: 'utf8' }).trim() // .../mingw64/libexec/git-core
  return join(dirname(dirname(dirname(exec))), 'usr', 'bin', `${name}.exe`)
}

let electronApp: ElectronApplication
let page: Page

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  // The seed script recreates .seed/ from scratch, so the throwaway home folder comes after it.
  execFileSync(process.execPath, [join(app, 'scripts', 'seed.mjs')], { stdio: 'ignore', env })
  mkdirSync(home, { recursive: true })
  writeFileSync(gitconfig, '[user]\n\tname = E2E\n\temail = signer@example.com\n[init]\n\tdefaultBranch = main\n')
  // Orphaned undo safety refs, as left behind once their entries were trimmed: the app should clean them up,
  // including one from before the rename (refs/gitclone/).
  git('update-ref', 'refs/mergatroid/undo/orphan', 'HEAD~2')
  git('update-ref', 'refs/gitclone/undo/orphan', 'HEAD~2')
  const userData = join(seed, 'userdata-e2e-more')
  rmSync(userData, { recursive: true, force: true })
  electronApp = await electron.launch({ cwd: app, args: ['.', `--open=${demo}`], env: { ...env, GC_USER_DATA: userData } })
  page = await electronApp.firstWindow()
  await ciSize(electronApp)
  page.on('pageerror', (e) => console.error('pageerror', e))
  await page.getByRole('tab', { name: 'demo' }).click()
  await page.getByRole('row', { name: /Uncommitted changes/ }).waitFor()
})

test.afterAll(async () => {
  await electronApp?.close()
  try {
    execFileSync(gitTool('gpgconf'), ['--kill', 'gpg-agent'], { env, stdio: 'ignore' })
    execFileSync(gitTool('rm'), ['-rf', gnupg], { env, stdio: 'ignore' })
  } catch {
    // nothing to clean up
  }
})

const dialog = () => page.getByRole('dialog')
const grid = () => page.getByRole('grid', { name: 'Commit history' })
const commitRow = (summary: string) => grid().getByRole('row', { name: new RegExp(`^${summary.replace(/[()]/g, '\\$&')}`) })
async function menu(target: ReturnType<Page['locator']>, item: string | RegExp): Promise<void> {
  await target.click({ button: 'right' })
  await page.getByRole('menuitem', { name: item }).click()
}
async function toGraph(): Promise<void> {
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await grid().waitFor()
}
async function openSettings(): Promise<void> {
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('region', { name: 'Settings' }).waitFor()
}

test('orphaned undo refs are cleaned up when the repo loads', async () => {
  await expect.poll(gitOr('for-each-ref', 'refs/mergatroid/undo/', 'refs/gitclone/undo/')).toBe('')
})

test('rename a stash', async () => {
  await menu(page.getByRole('tree', { name: 'Stashes' }).getByRole('treeitem').first(), 'Rename…')
  await dialog().getByLabel('Name').fill('Config file support, part one')
  await dialog().getByRole('button', { name: 'Rename' }).click()
  await expect.poll(gitOr('stash', 'list')).toContain('Config file support, part one')
  expect(git('stash', 'list')).not.toContain('Half-done')
})

test('hovering a branch dims commits outside its history', async () => {
  const units = commitRow('Document the --units flag')
  await units.locator('[draggable]').first().hover()
  await expect(commitRow('Use the cache before calling the API')).toHaveClass(/opacity-40/)
  await expect(commitRow('Add Fahrenheit output')).not.toHaveClass(/opacity-40/)
  await page.mouse.move(0, 0)
  await expect(commitRow('Use the cache before calling the API')).not.toHaveClass(/opacity-40/)
})

test('focus on this branch, then show all', async () => {
  const onlyTimeout = commitRow('Time out slow API calls after 5 seconds')
  await expect(onlyTimeout).toHaveCount(1)
  await page.getByRole('button', { name: 'Focus on this branch' }).click()
  await expect(page.getByText('Focused on main')).toBeVisible()
  await expect(onlyTimeout).toHaveCount(0)
  await page.getByRole('button', { name: 'Show all' }).click()
  await expect(onlyTimeout).toHaveCount(1)
})

test('hide a column, and the choice is saved for the repo', async () => {
  // At 1024 wide the Author column only fits with the left panel out of the way.
  await page.keyboard.press('Control+J')
  await expect(page.getByRole('columnheader', { name: /Author$/ })).toBeVisible()
  await menu(page.getByRole('row', { name: /^Columns/ }), 'Hide the Author column')
  await expect(page.getByRole('columnheader', { name: /Author$/ })).toHaveCount(0)
  const saved = await page.evaluate(async () => {
    const gc = (window as unknown as { gc: { invoke: (c: string, i: unknown) => Promise<unknown> } }).gc
    const list = (await gc.invoke('repo.list', {})) as { value: { open: Array<{ id: string }> } }
    const res = (await gc.invoke('graph.getColumns', { repoId: list.value.open[0].id })) as { value: Array<{ key: string; visible: boolean }> }
    return res.value
  })
  expect(saved.find((c) => c.key === 'author')?.visible).toBe(false)
  await menu(page.getByRole('row', { name: /^Columns/ }), 'Reset columns')
  await expect(page.getByRole('columnheader', { name: /Author$/ })).toBeVisible()
  await page.keyboard.press('Control+J')
})

test('pin a branch to the left of the graph', async () => {
  // A commit dot's horizontal position tells which lane it is in; lane 0 is the leftmost.
  const dotX = (summary: string) => commitRow(summary).locator('svg circle').last().getAttribute('cx')
  const lane0 = '8' // half of --gc-lane-w
  await menu(page.getByRole('tree', { name: 'Local branches' }).getByRole('treeitem', { name: /feature\/cache/ }), 'Pin to the left of the graph')
  await expect(page.getByRole('tree', { name: 'Local branches' }).getByLabel('Pinned to the left')).toHaveCount(1)
  await expect.poll(() => dotX('Use the cache before calling the API')).toBe(lane0)
  expect(await dotX('Cache forecasts in memory')).toBe(lane0)
  expect(await dotX('Print the real temperature in the CLI')).not.toBe(lane0)
  await menu(page.getByRole('tree', { name: 'Local branches' }).getByRole('treeitem', { name: /feature\/cache/ }), 'Unpin from the left')
  await expect.poll(() => dotX('Print the real temperature in the CLI')).toBe(lane0)
})

test('a commit template fills an empty message', async () => {
  const tpl = join(home, 'commit-template.txt')
  writeFileSync(tpl, 'Fix:\n\n# Lines starting with # are left out.\nWhy:\n')
  git('config', 'commit.template', tpl.split('\\').join('/'))
  await page.getByRole('tab', { name: 'demo' }).click()
  // Re-open the panel so it reads the template.
  await commitRow('Print the real temperature in the CLI').click()
  await page.getByRole('row', { name: /Uncommitted changes/ }).click()
  await expect(page.getByLabel('Commit summary')).toHaveValue('Fix:')
  await expect(page.getByLabel('Commit description')).toHaveValue('Why:')
  git('config', '--unset', 'commit.template')
  await page.getByLabel('Commit summary').fill('')
  await page.getByLabel('Commit description').fill('')
})

test('sign commits with a GPG key from Settings', async () => {
  execFileSync(gitTool('mkdir'), ['-p', gnupg], { env })
  execFileSync(gitTool('gpg'), ['--batch', '--passphrase', '', '--quick-gen-key', 'E2E Signer <signer@example.com>', 'ed25519', 'sign', 'never'], { env, stdio: 'ignore' })
  const fpr = execFileSync(gitTool('gpg'), ['--list-secret-keys', '--with-colons'], { env, encoding: 'utf8' })
    .split('\n')
    .find((l) => l.startsWith('fpr'))!
    .split(':')[9]

  await openSettings()
  const signing = page.getByRole('region', { name: 'Commit signing' })
  await signing.getByRole('switch', { name: 'Sign every commit' }).click()
  await signing.getByLabel('Signing key').fill(fpr)
  await signing.getByRole('button', { name: 'Save' }).first().click()
  await expect.poll(() => execFileSync('git', ['config', '--global', 'user.signingkey'], { env, encoding: 'utf8' }).trim()).toBe(fpr)

  await toGraph()
  await page.getByRole('row', { name: /Uncommitted changes/ }).click()
  await page.getByRole('button', { name: 'Stage all', exact: true }).click()
  await page.getByLabel('Commit summary').fill('A signed commit')
  await page.getByRole('button', { name: /^Commit \d+ files?$/ }).click()
  await expect.poll(gitOr('log', '-1', '--format=%s')).toBe('A signed commit')
  expect(git('log', '-1', '--format=%G?')).toBe('G')

  await commitRow('A signed commit').click()
  await expect(page.getByRole('region', { name: 'Details' }).getByText(/^Signed · E2E Signer/)).toBeVisible()
  execFileSync('git', ['config', '--global', '--unset', 'commit.gpgsign'], { env })
})

test('create an SSH key from Settings', async () => {
  await openSettings()
  const ssh = page.getByRole('region', { name: 'SSH keys' })
  await expect(ssh.getByText('No SSH keys yet.')).toBeVisible()
  await ssh.getByLabel('Label').fill('e2e laptop')
  await ssh.getByRole('button', { name: 'Create an SSH key' }).click()
  await expect(ssh.getByText('id_ed25519', { exact: true })).toBeVisible()
  expect(existsSync(join(home, '.ssh', 'id_ed25519.pub'))).toBe(true)
  await toGraph()
})

test('open a file in the editor command from Settings', async () => {
  const marker = (f: string): string => `${f}.opened`
  const script = "require('fs').writeFileSync(process.argv[1] + '.opened', 'x')"
  await openSettings()
  const tools = page.getByRole('region', { name: 'External tools' })
  await tools.getByLabel('Editor command').fill(`"${process.execPath}" -e "${script}" {file}`)
  await tools.getByRole('button', { name: 'Save' }).nth(1).click()
  await toGraph()
  // The signing test committed everything; make a change to open.
  writeFileSync(join(demo, 'README.md'), '# skycast\n\nEdited for the editor test.\n')
  await page.getByRole('row', { name: /Uncommitted changes/ }).click()
  await menu(page.getByRole('listbox', { name: /Not staged/ }).getByRole('option', { name: /README\.md/ }), 'Open in editor')
  await expect.poll(() => existsSync(marker(join(demo, 'README.md')))).toBe(true)
  rmSync(marker(join(demo, 'README.md')), { force: true })
})

test('open a file in the external diff tool', async () => {
  const marker = join(home, 'difftool-ran')
  const node = process.execPath.split('\\').join('/')
  execFileSync('git', ['config', '--global', 'diff.tool', 'e2e'], { env })
  execFileSync('git', ['config', '--global', 'difftool.e2e.cmd', `"${node}" -e "require('fs').writeFileSync(process.argv[1], process.argv[2])" "${marker.split('\\').join('/')}" "$MERGED"`], { env })
  await page.getByRole('row', { name: /Uncommitted changes/ }).click()
  await menu(page.getByRole('listbox', { name: /Not staged/ }).getByRole('option', { name: /README\.md/ }), 'Open in diff tool')
  await expect.poll(() => existsSync(marker)).toBe(true)
})

test('sparse clone checks out only the chosen folder', async () => {
  const dest = join(seed, 'sparse-copy')
  rmSync(dest, { recursive: true, force: true })
  await page.getByRole('tab', { name: 'Repositories' }).click()
  await page.getByRole('button', { name: /Clone/ }).first().click()
  await dialog().getByLabel('Repository URL').fill(join(seed, 'origin.git'))
  await dialog().getByLabel('Put it in').fill(seed)
  await dialog().getByLabel('Folder name').fill('sparse-copy')
  await dialog().getByRole('switch', { name: 'Only some folders (sparse checkout)' }).click()
  await dialog().getByLabel('Folders to check out').fill('src')
  await dialog().getByRole('button', { name: 'Clone', exact: true }).click()
  await expect.poll(() => existsSync(join(dest, 'src', 'fetch.js'))).toBe(true)
  expect(execFileSync('git', ['sparse-checkout', 'list'], { cwd: dest, env, encoding: 'utf8' }).trim()).toBe('src')
  expect(readdirSync(dest).sort()).toEqual(['.git', '.gitignore', 'CHANGELOG.md', 'README.md', 'src'])
})

test('group repositories on the home screen', async () => {
  await page.getByRole('tab', { name: 'Repositories' }).click()
  const recent = page.getByRole('region', { name: 'Recent' })
  // The list refreshes after the clone in the previous test; wait for it to include that repo.
  await expect(recent.getByRole('listitem').filter({ hasText: 'sparse-copy' })).toHaveCount(1)
  await page.waitForTimeout(500)
  await recent.getByRole('listitem').filter({ hasText: 'demo' }).first().click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Move to group' }).click()
  await page.getByRole('menuitem', { name: 'New group…' }).click()
  await dialog().getByLabel('Group name').fill('Weather tools')
  await dialog().getByRole('button', { name: 'Create group' }).click()
  const group = page.getByRole('region', { name: 'Weather tools' })
  await expect(group.getByRole('listitem').filter({ hasText: 'demo' })).toHaveCount(1)
  await group.getByRole('button', { name: 'Group options for Weather tools' }).click()
  await page.getByRole('menuitem', { name: /Delete group/ }).click()
  await expect(page.getByRole('region', { name: 'Weather tools' })).toHaveCount(0)
})

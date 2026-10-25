// F40: after the rename to Caboose, the data folder follows the new name. The first start copies the old
// Mergatroid (or gitclone) folder over once: settings, profiles and the repository list survive, and the old folder
// is never changed. Runs in a throwaway app data folder under .seed/, never the real one.
import { test, expect } from '@playwright/test'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { demo, invoke, launch, seed } from './harness'
import type { Profile, RepoList } from '../../src/shared/types'

test.describe.configure({ mode: 'serial' })

const appData = join(seed, 'appdata-move')
const oldDir = join(appData, 'Mergatroid')
const newDir = join(appData, 'Caboose')
const log = join(newDir, 'data-move.log')

/** Every file under a folder with its size, modified time and content hash, to prove nothing in it changed. */
function snapshot(dir: string): string[] {
  const out: string[] = []
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p)
      else {
        const st = statSync(p)
        out.push(`${relative(dir, p)} ${st.size} ${st.mtimeMs} ${createHash('sha1').update(readFileSync(p)).digest('hex')}`)
      }
    }
  }
  walk(dir)
  return out.sort()
}

/** A data folder as an older build left it: made by a real run, then given the old database name. */
async function makeOldFolder(dest: string, dbName: string, marker: string): Promise<void> {
  const h = await launch('move-old', { open: [demo] })
  try {
    await h.page.getByRole('tab', { name: 'demo' }).waitFor()
    expect(await invoke(h.page, 'prefs.set', { key: 'e2e.marker', value: marker })).toMatchObject({ ok: true })
    expect(await invoke(h.page, 'profile.create', { name: 'Work' })).toMatchObject({ ok: true })
  } finally {
    await h.close()
  }
  cpSync(join(seed, 'userdata-move-old'), dest, { recursive: true })
  for (const ext of ['', '-wal', '-shm']) {
    if (existsSync(join(dest, `caboose.db${ext}`))) renameSync(join(dest, `caboose.db${ext}`), join(dest, `${dbName}${ext}`))
  }
  // As if that version were still running: a lock file that must not come along.
  writeFileSync(join(dest, 'lockfile'), '')
}

async function startCaboose(): Promise<Awaited<ReturnType<typeof launch>>> {
  return launch('move-new', { open: [], reseed: false, appData })
}

test.beforeAll(() => rmSync(appData, { recursive: true, force: true }))

test('F40-H1: settings, profiles and the repository list come over from Mergatroid; its folder is left alone', async () => {
  await makeOldFolder(oldDir, 'mergatroid.db', 'from-mergatroid')
  const before = snapshot(oldDir)
  const g = await startCaboose()
  try {
    const repos = await invoke<RepoList>(g.page, 'repo.list', {})
    expect(repos.ok && [...repos.value.open, ...repos.value.recent].map((r) => r.name)).toContain('demo')
    expect(await invoke(g.page, 'prefs.getAll', {})).toMatchObject({ ok: true, value: { 'e2e.marker': 'from-mergatroid' } })
    const profiles = await invoke<Profile[]>(g.page, 'profile.list', {})
    expect(profiles.ok && profiles.value.map((p) => p.name)).toContain('Work')
    expect(existsSync(join(newDir, 'caboose.db'))).toBe(true)
    expect(existsSync(join(newDir, 'mergatroid.db'))).toBe(false)
    expect(existsSync(join(newDir, 'lockfile'))).toBe(false)
    expect(readFileSync(log, 'utf8')).toContain(`Copied settings, profiles and the repository list from ${oldDir}`)
    // Changed in Caboose from here on; the next test checks a restart keeps it.
    await invoke(g.page, 'prefs.set', { key: 'e2e.marker', value: 'changed-in-caboose' })
    g.expectClean()
  } finally {
    await g.close()
  }
  expect(snapshot(oldDir)).toEqual(before)
})

test('F40-E1: once Caboose has its own data, a restart doesn’t copy the old folder again', async () => {
  const g = await startCaboose()
  try {
    expect(await invoke(g.page, 'prefs.getAll', {})).toMatchObject({ ok: true, value: { 'e2e.marker': 'changed-in-caboose' } })
    expect(readFileSync(log, 'utf8').trim().split('\n')).toHaveLength(1)
    g.expectClean()
  } finally {
    await g.close()
  }
})

test('F40-E2: from a gitclone folder too, when there is no Mergatroid one', async () => {
  rmSync(appData, { recursive: true, force: true })
  await makeOldFolder(join(appData, 'gitclone'), 'gitclone.db', 'from-gitclone')
  const g = await startCaboose()
  try {
    expect(await invoke(g.page, 'prefs.getAll', {})).toMatchObject({ ok: true, value: { 'e2e.marker': 'from-gitclone' } })
    expect(readFileSync(log, 'utf8')).toContain(join(appData, 'gitclone'))
    g.expectClean()
  } finally {
    await g.close()
  }
})

test('F40-E3: with no older folder, it starts fresh and writes no log', async () => {
  rmSync(appData, { recursive: true, force: true })
  const g = await startCaboose()
  try {
    const repos = await invoke<RepoList>(g.page, 'repo.list', {})
    expect(repos.ok && repos.value.recent).toEqual([])
    expect(await invoke<Record<string, unknown>>(g.page, 'prefs.getAll', {})).not.toMatchObject({ value: { 'e2e.marker': expect.anything() } })
    expect(existsSync(log)).toBe(false)
    g.expectClean()
  } finally {
    await g.close()
  }
})

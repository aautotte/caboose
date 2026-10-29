// F60: the folder picker opens where the last folder was picked (in its parent, so it's right there again), also
// after a restart. Cancelling keeps the place; a place that's gone leaves the picker to the system's default.
import { test, expect } from '@playwright/test'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { invoke, launch, makeRepo, seed, type Harness } from './harness'

const place = join(seed, 'picks')
const repo = join(place, 'lastfolder')

/** Puts a stand-in for the system folder picker in the main process: it notes where it opened, and answers `answer`. */
async function stubPicker(h: Harness, answer: string | null): Promise<void> {
  await h.electronApp.evaluate(({ dialog }, a) => {
    const g = globalThis as unknown as { picks: Array<string | undefined> }
    g.picks = []
    dialog.showOpenDialog = (async (...args: unknown[]) => {
      const o = args[args.length - 1] as { defaultPath?: string }
      g.picks.push(o.defaultPath)
      return a ? { canceled: false, filePaths: [a] } : { canceled: true, filePaths: [] }
    }) as typeof dialog.showOpenDialog
  }, answer)
}
const picks = (h: Harness) => h.electronApp.evaluate(() => (globalThis as unknown as { picks: Array<string | undefined> }).picks)
/** The home screen's Open card (what Alt+O does). Later picks ask for the picker directly, as the card does. */
const pick = (h: Harness) => h.page.getByText('A folder on this computer').click()
const tab = (h: Harness) => h.page.getByRole('tab', { name: 'lastfolder', exact: true })

test('F60-H1: the picker opens where the last folder was picked, also after a restart', async () => {
  let h = await launch('lastfolder', {
    open: [],
    setup: (env) => {
      mkdirSync(place, { recursive: true })
      makeRepo(env, join('picks', 'lastfolder'), [['Start', { 'a.txt': 'a\n' }]])
    }
  })
  try {
    // Nothing picked yet: the system decides.
    await stubPicker(h, repo)
    await pick(h)
    await expect(tab(h)).toBeVisible()
    expect(await picks(h)).toEqual([undefined])

    // Next time it opens in the folder that holds it; cancelling doesn't forget it.
    await stubPicker(h, null)
    await invoke(h.page, 'dialog.pickFolder', { title: 'Open a repository' })
    await expect.poll(() => picks(h)).toEqual([place])
    await invoke(h.page, 'dialog.pickFolder', { title: 'Open a repository' })
    await expect.poll(() => picks(h)).toEqual([place, place])
    h.expectClean()
  } finally {
    await h.close()
  }

  h = await launch('lastfolder', { open: [], reseed: false, keepUserData: true })
  try {
    await stubPicker(h, null)
    await invoke(h.page, 'dialog.pickFolder', { title: 'Open a repository' })
    await expect.poll(() => picks(h)).toEqual([place])
    h.expectClean()
  } finally {
    await h.close()
  }

  // The place is gone: the system decides again.
  rmSync(place, { recursive: true, force: true })
  h = await launch('lastfolder', { open: [], reseed: false, keepUserData: true })
  try {
    await stubPicker(h, null)
    await invoke(h.page, 'dialog.pickFolder', { title: 'Open a repository' })
    await expect.poll(() => picks(h)).toEqual([undefined])
    h.expectClean()
  } finally {
    await h.close()
  }
})

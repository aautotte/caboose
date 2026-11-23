// F94: a changed image shows as pictures, not "binary file": before and after side by side with their sizes, or one
// over the other with a slider (swipe, onion skin); a new or deleted image shows its one version.
import { test, expect } from '@playwright/test'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { axe, commitRow, gitIn, launch, makeRepo, openDiffNow, repoId, seed, toGraph, type Harness } from './harness'

/** A w × h PNG of one colour, made here so the test needs no image files. */
function png(w: number, h: number, rgb: [number, number, number]): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (b: Buffer): number => {
    let c = 0xffffffff
    for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const sum = Buffer.alloc(4)
    sum.writeUInt32BE(crc(body))
    return Buffer.concat([len, body, sum])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // truecolour
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => rgb).flat())])
  const pixels = deflateSync(Buffer.concat(Array.from({ length: h }, () => row)))
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', pixels), chunk('IEND', Buffer.alloc(0))])
}

let h: Harness
const repo = join(seed, 'image-diff')
let id = ''

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => {
  h = await launch('image-diff', {
    open: [repo],
    setup: (env) => {
      makeRepo(env, 'image-diff', [['Start', { 'README.md': 'images\n' }]])
      writeFileSync(join(repo, 'logo.png'), png(4, 2, [200, 30, 30]))
      writeFileSync(join(repo, 'old.png'), png(2, 2, [30, 30, 200]))
      gitIn(env, repo, 'add', '-A')
      gitIn(env, repo, 'commit', '-q', '-m', 'Add the images')
      // Then the logo gets bigger and greener in a commit, and bigger and bluer on disk.
      writeFileSync(join(repo, 'logo.png'), png(6, 3, [30, 160, 60]))
      gitIn(env, repo, 'commit', '-q', '-am', 'A new logo')
      writeFileSync(join(repo, 'logo.png'), png(8, 4, [30, 60, 160]))
    }
  })
  await h.page.getByRole('tab', { name: 'image-diff', exact: true }).click()
  await h.page.getByRole('row', { name: /Uncommitted changes/ }).waitFor()
  id = await repoId(h.page, repo)
})
test.afterAll(() => h.close())
test.afterEach(() => h.expectClean())

const view = (name: string) => h.page.getByRole('region', { name: `Changes in ${name}` })
const figure = (name: string, label: 'Before' | 'After') => view(name).getByRole('figure').filter({ has: h.page.getByText(label, { exact: true }) })

test('F94-H1: a changed image shows before and after, side by side, with their sizes', async () => {
  await openDiffNow(h.page, id, 'logo.png', { kind: 'worktree' })
  await expect(view('logo.png').getByRole('img', { name: 'logo.png, before' })).toBeVisible()
  await expect(view('logo.png').getByRole('img', { name: 'logo.png, after' })).toBeVisible()
  await expect(figure('logo.png', 'Before')).toContainText('6 × 3')
  await expect(figure('logo.png', 'After')).toContainText('8 × 4')
  await expect(view('logo.png')).not.toContainText('Binary file')
  expect(await axe(h.page)).toEqual([])
})

test('F94-H2: Swipe and Onion skin put the new version over the old, as far as the slider says', async () => {
  const after = view('logo.png').getByRole('img', { name: 'logo.png, after' })
  await view('logo.png').getByRole('radio', { name: 'Swipe' }).click()
  await view('logo.png').getByRole('slider', { name: 'How much of the new version shows' }).fill('30')
  await expect(after).toHaveCSS('clip-path', /inset\(0(px)? 70% 0(px)? 0(px)?\)/)
  await view('logo.png').getByRole('radio', { name: 'Onion skin' }).click()
  await view('logo.png').getByRole('slider', { name: 'How strongly the new version shows' }).fill('25')
  await expect(after).toHaveCSS('opacity', '0.25')
  expect(await axe(h.page)).toEqual([])
  await view('logo.png').getByRole('radio', { name: 'Side by side' }).click()
})

test('F94-H3: in a commit, the image as its parent had it and as the commit left it', async () => {
  await toGraph(h.page)
  await commitRow(h.page, 'A new logo').click()
  await h.page.getByRole('listbox', { name: 'Changed files' }).getByRole('option', { name: /logo\.png/ }).click()
  await expect(figure('logo.png', 'Before')).toContainText('4 × 2')
  await expect(figure('logo.png', 'After')).toContainText('6 × 3')
})

test('F94-H4: a new image shows only its one version, and a deleted one only the old', async () => {
  writeFileSync(join(repo, 'new.png'), png(5, 5, [250, 200, 0]))
  rmSync(join(repo, 'old.png'))
  h.git(repo, 'add', 'new.png')
  await openDiffNow(h.page, id, 'new.png', { kind: 'index' })
  await expect(figure('new.png', 'After')).toContainText('5 × 5')
  await expect(view('new.png').getByRole('img')).toHaveCount(1)
  await openDiffNow(h.page, id, 'old.png', { kind: 'worktree' })
  await expect(figure('old.png', 'Before')).toContainText('2 × 2')
  await expect(view('old.png').getByRole('img')).toHaveCount(1)
})

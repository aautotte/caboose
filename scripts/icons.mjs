// Renders the app icon with Electron's own Chromium: resources/icon-small.svg (a simplified close-up) for 32 px and
// below, icon.svg for 48 px and up. Each small size is drawn from the SVG at that size, so it stays crisp.
// then writes the PNGs and a Windows .ico. Run: npx electron scripts/icons.mjs
import { app, BrowserWindow, nativeImage } from 'electron'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const res = join(dirname(fileURLToPath(import.meta.url)), '..', 'resources')
const RENDER = 1024

/** Draws an SVG file at the given size and returns it as a NativeImage. */
async function render(svgFile, size) {
  // The SVG is drawn onto a canvas of the exact size, so neither the screen's size nor its scale gets in the way.
  const win = new BrowserWindow({ width: 200, height: 200, show: false })
  const dir = mkdtempSync(join(tmpdir(), 'caboose-icon-'))
  const page = join(dir, 'icon.html')
  writeFileSync(page, '<html><body></body></html>')
  await win.loadFile(page)
  const src = pathToFileURL(join(res, svgFile)).href
  const dataUrl = await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const c = document.createElement('canvas')
      c.width = c.height = ${size}
      c.getContext('2d').drawImage(img, 0, 0, ${size}, ${size})
      resolve(c.toDataURL('image/png'))
    }
    img.onerror = () => reject(new Error('could not load the SVG'))
    img.src = ${JSON.stringify(src)}
  })`)
  win.destroy()
  rmSync(dir, { recursive: true, force: true })
  return nativeImage.createFromDataURL(dataUrl)
}

/** A .ico holding PNG images (Windows Vista and later read PNG entries). */
function ico(pngs) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(pngs.length, 4)
  const dir = Buffer.alloc(16 * pngs.length)
  let offset = 6 + dir.length
  pngs.forEach(({ size, data }, i) => {
    const o = i * 16
    dir.writeUInt8(size >= 256 ? 0 : size, o)
    dir.writeUInt8(size >= 256 ? 0 : size, o + 1)
    dir.writeUInt8(0, o + 2)
    dir.writeUInt8(0, o + 3)
    dir.writeUInt16LE(1, o + 4)
    dir.writeUInt16LE(32, o + 6)
    dir.writeUInt32LE(data.length, o + 8)
    dir.writeUInt32LE(offset, o + 12)
    offset += data.length
  })
  return Buffer.concat([header, dir, ...pngs.map((p) => p.data)])
}

// Each render closes its window; without this, closing the first one would quit before the next.
app.on('window-all-closed', () => {})

app.whenReady().then(async () => {
  try {
    const big = await render('icon.svg', RENDER)
    const small = new Map()
    for (const size of [16, 24, 32]) small.set(size, await render('icon-small.svg', size))
    const at = (size) => (size <= 32 ? small.get(size) : big.resize({ width: size, height: size, quality: 'best' })).toPNG()
    writeFileSync(join(res, 'icon-1024.png'), big.toPNG())
    writeFileSync(join(res, 'icon.png'), at(512))
    writeFileSync(join(res, 'icon.ico'), ico([16, 24, 32, 48, 64, 128, 256].map((size) => ({ size, data: at(size) }))))
    console.log('wrote icon-1024.png, icon.png and icon.ico in', res)
  } catch (err) {
    console.error(err)
    process.exitCode = 1
  } finally {
    app.quit()
  }
})

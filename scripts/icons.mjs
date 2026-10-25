// Renders the app icons with Electron's own Chromium, on a transparent canvas (no background anywhere):
//   resources/icon.svg        main master: icon-1024.png, icon.png, and 64 px and up in the .ico and the Linux set
//   resources/icon-small.svg  close-up filling the canvas: 48 px and below in the .ico and the Linux set (at 125 to
//                             150% scaling the Windows taskbar uses the 40 and 48 px entries)
//   resources/icon-macos.svg  the same artwork on Apple's rounded tile: every size in icon.icns, and nothing else
// Each size is drawn from its SVG at that size, so small ones stay crisp. Run: npm run icons
import { app, BrowserWindow, nativeImage } from 'electron'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const res = join(dirname(fileURLToPath(import.meta.url)), '..', 'resources')

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

/** A macOS .icns holding PNG images: each entry is a type code, its length, then the PNG. */
function icns(entries) {
  const parts = entries.map(({ type, data }) => {
    const head = Buffer.alloc(8)
    head.write(type, 0, 'ascii')
    head.writeUInt32BE(data.length + 8, 4)
    return Buffer.concat([head, data])
  })
  const head = Buffer.alloc(8)
  head.write('icns', 0, 'ascii')
  head.writeUInt32BE(8 + parts.reduce((n, p) => n + p.length, 0), 4)
  return Buffer.concat([head, ...parts])
}

// The .icns types and their pixel sizes (the @2x ones are the Retina versions of the size below them).
const ICNS_TYPES = [
  ['icp4', 16], ['icp5', 32], ['ic11', 32], ['ic12', 64], ['ic07', 128],
  ['ic13', 256], ['ic08', 256], ['ic14', 512], ['ic09', 512], ['ic10', 1024]
]
const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 256]
const LINUX_SIZES = [16, 24, 32, 48, 64, 128, 256, 512]

// Each render closes its window; without this, closing the first one would quit before the next.
app.on('window-all-closed', () => {})

app.whenReady().then(async () => {
  try {
    const cache = new Map()
    /** PNG bytes for one size: the close-up up to 48 px, the main master from 64 px (or the given master). */
    const png = async (size, master = size <= 48 ? 'icon-small.svg' : 'icon.svg') => {
      const key = `${master}@${size}`
      if (!cache.has(key)) cache.set(key, (await render(master, size)).toPNG())
      return cache.get(key)
    }
    writeFileSync(join(res, 'icon-1024.png'), await png(1024, 'icon.svg'))
    writeFileSync(join(res, 'icon.png'), await png(512, 'icon.svg'))
    const icoImages = []
    for (const size of ICO_SIZES) icoImages.push({ size, data: await png(size) })
    writeFileSync(join(res, 'icon.ico'), ico(icoImages))
    mkdirSync(join(res, 'linux'), { recursive: true })
    for (const size of LINUX_SIZES) writeFileSync(join(res, 'linux', `${size}x${size}.png`), await png(size))
    const mac = []
    for (const [type, size] of ICNS_TYPES) mac.push({ type, data: await png(size, 'icon-macos.svg') })
    writeFileSync(join(res, 'icon.icns'), icns(mac))
    console.log('wrote icon-1024.png, icon.png, icon.ico, icon.icns and linux/*.png in', res)
  } catch (err) {
    console.error(err)
    process.exitCode = 1
  } finally {
    app.quit()
  }
})

// Captures every screen against the seed repos into docs/screenshots/. Run `npm run seed` first.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { rmSync } from 'node:fs'
import { join, resolve } from 'node:path'

const app = resolve(import.meta.dirname, '..')
const seed = join(app, '.seed')
const userData = join(seed, 'userdata')
rmSync(userData, { recursive: true, force: true })
const screens = process.argv[2] ?? 'S01,S02,S03,S04,S05,S06,S07,S08,S09,S10,S11,S12,S13,S14,S15,S16,S04-multi,S11-range'
const electron = createRequire(import.meta.url)('electron') // path to the Electron binary
execFileSync(electron, ['.', `--open=${join(seed, 'demo')}|${join(seed, 'conflict')}`, `--screenshot=${join(app, 'docs', 'screenshots')}`, `--screens=${screens}`], {
  cwd: app,
  stdio: 'inherit',
  env: { ...process.env, GC_USER_DATA: userData }
})

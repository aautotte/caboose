// Builds a demo repo for development and screenshots: app/.seed/demo (working copy) + app/.seed/origin.git (its remote).
// All content is invented. Run: npm run seed   (deletes and recreates .seed/)
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync, appendFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..', '.seed')
const origin = join(root, 'origin.git')
const repo = join(root, 'demo')

const people = [
  ['Sam Lee', 'sam@example.com'],
  ['Ana Duarte', 'ana@example.org'],
  ['Kofi Mensah', 'kofi@example.net'],
  ['Li Wei', 'li@example.dev']
]

let clock = Date.UTC(2026, 8, 1, 9, 0, 0) / 1000 // 2026-09-01 09:00 UTC, then +3h per commit

function git(args, opts = {}) {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...opts })
}

function commit(message, who = 0, extraArgs = []) {
  clock += 3 * 3600
  const [name, email] = people[who]
  const date = `${clock} +0000`
  git(['add', '-A'])
  git(['commit', '-q', '-F', '-', ...extraArgs], {
    input: message,
    env: { ...process.env, GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email, GIT_COMMITTER_DATE: date }
  })
}

function write(path, text) {
  const full = join(repo, path)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, text)
}

function append(path, text) {
  appendFileSync(join(repo, path), text)
}

function merge(branch, message, who) {
  clock += 3 * 3600
  const [name, email] = people[who]
  const date = `${clock} +0000`
  git(['merge', '--no-ff', '-q', '-m', message, branch], {
    env: { ...process.env, GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email, GIT_COMMITTER_DATE: date }
  })
}

if (existsSync(root)) rmSync(root, { recursive: true, force: true })
mkdirSync(repo, { recursive: true })
execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin])
git(['init', '-q', '-b', 'main'])
git(['config', 'user.name', 'Sam Lee'])
git(['config', 'user.email', 'sam@example.com'])
git(['config', 'core.autocrlf', 'false'])
git(['remote', 'add', 'origin', origin])

write('README.md', '# skycast\n\nA tiny command line weather tool.\n')
write('src/cli.js', "export function main(argv) {\n  const city = argv[0] ?? 'Lisbon'\n  console.log(`Weather for ${city}`)\n}\n")
commit('Start skycast with a hello-world CLI')

write('src/fetch.js', "export async function fetchForecast(city) {\n  const res = await fetch(`https://api.example.test/forecast?q=${city}`)\n  return res.json()\n}\n")
commit('Fetch the forecast from the API', 1)

write('src/format.js', "export function formatTemp(c) {\n  return `${Math.round(c)}°C`\n}\n")
commit('Format temperatures for display', 0)
git(['tag', 'v0.1.0'])

// feature/units: Fahrenheit support
git(['switch', '-q', '-c', 'feature/units'])
write('src/format.js', "export function formatTemp(c, unit = 'C') {\n  const v = unit === 'F' ? c * 9 / 5 + 32 : c\n  return `${Math.round(v)}°${unit}`\n}\n")
commit('Add Fahrenheit output', 2)
append('README.md', '\nUse `--units F` for Fahrenheit.\n')
commit('Document the --units flag', 2)

// feature/cache, branched from main
git(['switch', '-q', 'main'])
git(['switch', '-q', '-c', 'feature/cache'])
write('src/cache.js', "const store = new Map()\nexport const cache = {\n  get: (k) => store.get(k),\n  set: (k, v) => store.set(k, v)\n}\n")
commit('Cache forecasts in memory', 1)
write('src/fetch.js', "import { cache } from './cache.js'\n\nexport async function fetchForecast(city) {\n  const hit = cache.get(city)\n  if (hit) return hit\n  const res = await fetch(`https://api.example.test/forecast?q=${city}`)\n  const data = await res.json()\n  cache.set(city, data)\n  return data\n}\n")
commit('Use the cache before calling the API', 1)

// main moves on, then merges both features
git(['switch', '-q', 'main'])
write('.gitignore', 'node_modules/\n.env\n')
commit('Ignore node_modules and .env', 3)
merge('feature/cache', 'Merge branch feature/cache', 0)
merge('feature/units', 'Merge branch feature/units', 0)
git(['tag', '-a', 'v0.2.0', '-m', 'Units and caching'])

for (let i = 1; i <= 6; i++) {
  append('CHANGELOG.md', `- note ${i}\n`)
  commit(`Update the changelog (${i})`, i % 4)
}
git(['push', '-q', 'origin', 'main', 'feature/cache', '--tags'])
git(['branch', '-q', '-u', 'origin/main', 'main'])
git(['branch', '-q', '-u', 'origin/feature/cache', 'feature/cache'])

// fix/timeout: open branch, pushed
git(['switch', '-q', '-c', 'fix/timeout'])
write('src/fetch.js', "import { cache } from './cache.js'\n\nexport async function fetchForecast(city, { timeoutMs = 5000 } = {}) {\n  const hit = cache.get(city)\n  if (hit) return hit\n  const res = await fetch(`https://api.example.test/forecast?q=${city}`, { signal: AbortSignal.timeout(timeoutMs) })\n  const data = await res.json()\n  cache.set(city, data)\n  return data\n}\n")
commit('Time out slow API calls after 5 seconds', 3)
git(['push', '-q', '-u', 'origin', 'fix/timeout'])

// A branch with a very long name, for long-content states
git(['switch', '-q', 'main'])
git(['branch', 'experiment/try-a-much-longer-branch-name-to-test-truncation-ok'])

// main: one local commit not pushed yet (ahead 1)
write('src/cli.js', "import { fetchForecast } from './fetch.js'\nimport { formatTemp } from './format.js'\n\nexport async function main(argv) {\n  const city = argv[0] ?? 'Lisbon'\n  const data = await fetchForecast(city)\n  console.log(`${city}: ${formatTemp(data.tempC)}`)\n}\n")
commit('Print the real temperature in the CLI', 0)

// A stash
append('README.md', '\nWork in progress: config file support.\n')
git(['stash', 'push', '-q', '-m', 'Half-done config file support'])

// Uncommitted work: one staged, one modified, one new file
write('src/format.js', "export function formatTemp(c, unit = 'C') {\n  const v = unit === 'F' ? (c * 9) / 5 + 32 : c\n  return `${v.toFixed(1)}°${unit}`\n}\n")
git(['add', 'src/format.js'])
append('README.md', '\n## Install\n\nnpm install -g skycast\n')
write('src/wind.js', "export function formatWind(kmh) {\n  return `${Math.round(kmh)} km/h`\n}\n")

console.log('Seeded', repo)
console.log(git(['log', '--oneline', '--graph', '--all', '-n', '30']))
console.log(git(['status', '--short', '--branch']))

// A second repo, stopped in the middle of a merge with conflicts (for the merge tool).
{
  const conflict = join(root, 'conflict')
  mkdirSync(conflict, { recursive: true })
  const g = (args, opts = {}) => execFileSync('git', args, { cwd: conflict, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...opts })
  g(['init', '-q', '-b', 'main'])
  g(['config', 'user.name', 'Sam Lee'])
  g(['config', 'user.email', 'sam@example.com'])
  g(['config', 'core.autocrlf', 'false'])
  const w = (p, t) => writeFileSync(join(conflict, p), t)
  w('settings.js', "export const settings = {\n  units: 'C',\n  timeoutMs: 5000,\n  city: 'Lisbon',\n  retries: 1\n}\n")
  w('notes.md', '# Notes\n\nNothing yet.\n')
  g(['add', '-A']); g(['commit', '-q', '-m', 'Add default settings'])
  g(['switch', '-q', '-c', 'feature/faster'])
  w('settings.js', "export const settings = {\n  units: 'C',\n  timeoutMs: 2000,\n  city: 'Lisbon',\n  retries: 3\n}\n")
  w('notes.md', '# Notes\n\nLower the timeout and retry more.\n')
  g(['commit', '-q', '-am', 'Retry faster'])
  g(['switch', '-q', 'main'])
  w('settings.js', "export const settings = {\n  units: 'F',\n  timeoutMs: 8000,\n  city: 'Porto',\n  retries: 1\n}\n")
  w('notes.md', '# Notes\n\nDefault to Porto and Fahrenheit.\n')
  g(['commit', '-q', '-am', 'Change defaults for the US build'])
  try { g(['merge', '--no-edit', 'feature/faster']) } catch { /* expected: conflicts */ }
  console.log('Seeded', conflict)
  console.log(g(['status', '--short']))
}

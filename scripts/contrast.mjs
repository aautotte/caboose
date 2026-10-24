// Checks every text / background pair listed under "pairs" in design/tokens.json and tokens.light.json against
// WCAG 2.2 AA: 4.5:1 for normal text, 3:1 for large text ("large") and for borders and focus rings ("ui").
// Exits 1 if any pair falls short. Run: npm run contrast
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const NEEDS = { normal: 4.5, large: 3, ui: 3 }

function luminance(hex) {
  const n = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255)
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

let failed = 0
for (const file of ['tokens.json', 'tokens.light.json']) {
  const t = JSON.parse(readFileSync(join(root, 'design', file), 'utf8'))
  let bad = 0
  for (const [fg, bg, kind = 'normal'] of t.pairs) {
    const [a, b] = [t.color[fg], t.color[bg]]
    if (!a || !b) {
      console.log(`  ?      ${file}: ${!a ? fg : bg} is not a colour role`)
      bad++
      continue
    }
    const r = ratio(a, b)
    if (r < NEEDS[kind]) {
      console.log(`  FAIL   ${r.toFixed(2)}:1  ${fg} on ${bg} (${kind} needs ${NEEDS[kind]}:1)`)
      bad++
    }
  }
  console.log(`${file}: ${t.pairs.length} pairs, ${bad} below AA`)
  failed += bad
}
process.exit(failed ? 1 : 0)

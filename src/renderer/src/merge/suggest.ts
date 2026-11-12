// What to do with a conflict when the answer is clear from the two sides and what they started from, and which words
// each side changed. Plain text comparisons: nothing is guessed about the language.
import type { Pick } from './conflicts'

export interface Suggestion {
  /** Sides to use, in order; null when the result is lines of its own (both changes combined). */
  pick: Pick | null
  /** The resolved lines. */
  lines: string[]
  /** What to keep, for "Suggested: …". */
  what: string
  why: string
}

const same = (a: string[], b: string[]): boolean => a.length === b.length && a.every((l, i) => l === b[i])
// Whitespace inside lines, and blank lines, left out.
const squeeze = (a: string[]): string[] => a.map((l) => l.replace(/\s+/g, ' ').trim()).filter((l) => l !== '')

/** Too big to align line by line in the window: no suggestion. */
const MAX_CELLS = 250_000

/** The longest common subsequence of a and b, as pairs of indexes. */
function lcs<T>(a: T[], b: T[], eq: (x: T, y: T) => boolean = (x, y) => x === y): Array<[number, number]> | null {
  const n = a.length
  const m = b.length
  if ((n + 1) * (m + 1) > MAX_CELLS) return null
  const len: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) len[i][j] = eq(a[i], b[j]) ? len[i + 1][j + 1] + 1 : Math.max(len[i + 1][j], len[i][j + 1])
  const out: Array<[number, number]> = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (eq(a[i], b[j])) {
      out.push([i, j])
      i++
      j++
    } else if (len[i + 1][j] >= len[i][j + 1]) i++
    else j++
  }
  return out
}

/** One side's change to the base: base lines [start, end) became `lines` (start === end: lines inserted there). */
interface Edit {
  start: number
  end: number
  lines: string[]
}

function editsOf(base: string[], side: string[]): Edit[] | null {
  const pairs = lcs(base, side)
  if (!pairs) return null
  const out: Edit[] = []
  let bi = 0
  let si = 0
  for (const [b, s] of [...pairs, [base.length, side.length] as [number, number]]) {
    if (b > bi || s > si) out.push({ start: bi, end: b, lines: side.slice(si, s) })
    bi = b + 1
    si = s + 1
  }
  return out
}

const key = (l: string): string => l.trim().toLowerCase()
const ordered = (ls: string[]): boolean => ls.every((l, i) => i === 0 || key(ls[i - 1]) <= key(l))

/**
 * Both sides only added lines at the same place. A sorted list (the lines around agree) gets them merged in order,
 * otherwise yours come first. A line both added is kept once.
 */
function bothAdded(mine: string[], other: string[], before: string | undefined, after: string | undefined): { lines: string[]; sorted: boolean } {
  const extra = other.filter((l) => !mine.includes(l))
  const all = [...mine, ...extra]
  const around = [before, after].filter((l): l is string => l !== undefined && l.trim() !== '')
  const merged = [...all].sort((x, y) => (key(x) < key(y) ? -1 : key(x) > key(y) ? 1 : 0))
  const listy = all.length > 1 && all.every((l) => l.trim() !== '') && ordered(mine) && ordered(other)
  const fits = (before === undefined || before.trim() === '' || key(before) <= key(merged[0])) && (after === undefined || after.trim() === '' || key(merged[merged.length - 1]) <= key(after))
  if (listy && fits && (around.length > 0 || merged.length > 2)) return { lines: merged, sorted: true }
  return { lines: all, sorted: false }
}

/**
 * The two sides' changes to the base, applied together, when they don't touch the same lines: git calls changes on
 * lines next to each other a conflict too. Null when they overlap.
 */
function combine(base: string[], ours: string[], theirs: string[], before?: string, after?: string): { lines: string[]; why: string } | null {
  const a = editsOf(base, ours)
  const b = editsOf(base, theirs)
  if (!a || !b) return null
  type Tagged = Edit & { side: 'ours' | 'theirs' }
  const all: Tagged[] = [...a.map((e) => ({ ...e, side: 'ours' as const })), ...b.map((e) => ({ ...e, side: 'theirs' as const }))].sort((x, y) => x.start - y.start || x.end - y.end)
  const out: string[] = []
  let at = 0
  let sorted = false
  let added = false
  for (let k = 0; k < all.length; k++) {
    const e = all[k]
    const next = all[k + 1]
    if (e.start < at) return null
    out.push(...base.slice(at, e.start))
    if (next && next.start === e.start && next.end === e.end && same(next.lines, e.lines)) {
      // Both made this change: once.
      out.push(...e.lines)
      at = e.end
      k++
      continue
    }
    if (next && e.start === e.end && next.start === e.start && next.end === e.start && next.side !== e.side) {
      const mine = e.side === 'ours' ? e.lines : next.lines
      const other = e.side === 'ours' ? next.lines : e.lines
      const r = bothAdded(mine, other, e.start > 0 ? base[e.start - 1] : before, e.start < base.length ? base[e.start] : after)
      out.push(...r.lines)
      sorted ||= r.sorted
      added = true
      at = e.start
      k++
      continue
    }
    // Touching the other side's change, or inside it: which comes first isn't clear.
    if (next && (next.start < e.end || next.start === e.start || (next.start === e.end && (e.start === e.end || next.start === next.end)))) return null
    out.push(...e.lines)
    at = e.end
  }
  out.push(...base.slice(at))
  if (sorted) return { lines: out, why: 'Both sides added lines to a sorted list: they all go in, in order.' }
  if (added && a.length === 1 && b.length === 1) return { lines: out, why: 'Both sides only added lines here: they all go in, yours first.' }
  return { lines: out, why: 'The two sides changed different lines, next to each other: both changes go in.' }
}

/**
 * A suggested resolution for one conflict, or null when it takes a person. `base`: what both started from (null if
 * not known; empty when both added the lines). `before` / `after`: the lines just outside the conflict.
 */
export function suggest(ours: string[], theirs: string[], base: string[] | null, before?: string, after?: string): Suggestion | null {
  const keep = (side: 'ours' | 'theirs', why: string): Suggestion => ({ pick: [side], lines: side === 'ours' ? ours : theirs, what: side === 'ours' ? 'keep yours' : 'keep theirs', why })
  if (same(ours, theirs)) return { pick: ['ours'], lines: ours, what: 'keep it once', why: 'Both sides made the same change.' }
  if (same(squeeze(ours), squeeze(theirs))) {
    // The side that changed the spacing on purpose, if the other left it as it was.
    const side = base && same(ours, base) ? 'theirs' : 'ours'
    return keep(side, 'Both sides made the same change; only the spacing differs.')
  }
  if (base === null) return null
  if (same(ours, base)) return keep('theirs', 'Only theirs changed these lines.')
  if (same(theirs, base)) return keep('ours', 'Only yours changed these lines.')
  if (same(squeeze(ours), squeeze(base))) return keep('theirs', 'Yours only changed spacing here; theirs changed what the lines say.')
  if (same(squeeze(theirs), squeeze(base))) return keep('ours', 'Theirs only changed spacing here; yours changed what the lines say.')
  const c = combine(base, ours, theirs, before, after)
  if (!c) return null
  if (same(c.lines, theirs)) return keep('theirs', 'Theirs already has your change, and more.')
  if (same(c.lines, ours)) return keep('ours', 'Yours already has their change, and more.')
  return { pick: null, lines: c.lines, what: c.why.startsWith('Both sides added lines to a sorted') ? 'keep both, sorted' : 'keep both', why: c.why }
}

/** One line's text in pieces, `true` for the words that changed. */
export type Marked = Array<[string, boolean]>

const tokens = (l: string): string[] => l.match(/\w+|\s+|[^\w\s]/g) ?? []

/**
 * Which words of `lines` differ from `ref` (the base, or the other side). Lines matched in both are plain; a changed
 * line is compared word by word with the one in the same place in `ref`; a line `ref` has nothing for is all marked.
 */
export function wordMarks(lines: string[], ref: string[]): Marked[] {
  const pairs = lcs(lines, ref)
  if (!pairs) return lines.map((l) => [[l, false]])
  const out: Marked[] = lines.map((l) => [[l, false]])
  let li = 0
  let ri = 0
  for (const [l, r] of [...pairs, [lines.length, ref.length] as [number, number]]) {
    for (let k = 0; li + k < l; k++) {
      const mine = lines[li + k]
      const theirs = ri + k < r ? ref[ri + k] : null
      out[li + k] = theirs === null ? [[mine, mine.trim() !== '']] : markWords(mine, theirs)
    }
    li = l + 1
    ri = r + 1
  }
  return out
}

function markWords(line: string, ref: string): Marked {
  const a = tokens(line)
  const b = tokens(ref)
  const keepIdx = new Set((lcs(a, b) ?? []).map(([i]) => i))
  const out: Marked = []
  a.forEach((t, i) => {
    // Spaces between two changed words read as part of the change.
    const changed = !keepIdx.has(i) && !(t.trim() === '' && keepIdx.has(i - 1) && keepIdx.has(i + 1))
    const last = out[out.length - 1]
    if (last && last[1] === changed) last[0] += t
    else out.push([t, changed])
  })
  return out
}

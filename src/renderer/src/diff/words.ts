// Which words changed in a changed line: a removed line and the added line that took its place are compared word by
// word, so a renamed variable shows as that word, not as two whole lines.
import type { DiffLine } from '../../../shared/types'
import { markWords, type Marked } from '@/merge/suggest'

/** Longer lines aren't compared: too slow to do for each one, and rarely read word by word. */
const MAX_LENGTH = 1000
/** A pair that kept less than this share of its text was rewritten: marking nearly all of it would say nothing. */
const MIN_KEPT = 0.4

const kept = (parts: Marked): number => parts.reduce((n, [t, changed]) => (changed ? n : n + t.replace(/\s/g, '').length), 0)
const solid = (s: string): number => s.replace(/\s/g, '').length

/**
 * The changed lines of a block that have a counterpart, in pieces with the changed words marked. Removed lines followed
 * by added ones pair up in order (the first removed with the first added, and so on), as the split layout shows them.
 */
export function wordChanges(lines: DiffLine[]): Map<DiffLine, Marked> {
  const out = new Map<DiffLine, Marked>()
  let i = 0
  while (i < lines.length) {
    if (lines[i].type !== 'del') {
      i++
      continue
    }
    const dels: DiffLine[] = []
    const adds: DiffLine[] = []
    while (i < lines.length && lines[i].type === 'del') dels.push(lines[i++])
    while (i < lines.length && lines[i].type === 'add') adds.push(lines[i++])
    for (let k = 0; k < Math.min(dels.length, adds.length); k++) {
      const [del, add] = [dels[k], adds[k]]
      if (del.text.length > MAX_LENGTH || add.text.length > MAX_LENGTH) continue
      const before = markWords(del.text, add.text)
      const after = markWords(add.text, del.text)
      if (!before.some(([, c]) => c) && !after.some(([, c]) => c)) continue
      const size = Math.max(solid(del.text), solid(add.text))
      if (size && kept(after) / size < MIN_KEPT) continue
      out.set(del, before)
      out.set(add, after)
    }
  }
  return out
}

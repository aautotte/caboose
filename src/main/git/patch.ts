// Builds a patch for part of one file's diff: one hunk, or some of its lines.
// Works on git's own diff text, so line endings and bytes stay exactly as git produced them.

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/

interface RawHunk {
  header: string
  oldStart: number
  body: string[]
}

export function splitDiff(raw: string): { head: string[]; hunks: RawHunk[] } {
  const lines = raw.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  const head: string[] = []
  const hunks: RawHunk[] = []
  for (const line of lines) {
    const m = HUNK.exec(line)
    if (m) hunks.push({ header: line, oldStart: Number(m[1]), body: [] })
    else if (hunks.length) hunks[hunks.length - 1].body.push(line)
    else head.push(line)
  }
  return { head, hunks }
}

/**
 * The patch that applies only the chosen lines of hunk `index`.
 * `lines` are indexes into the hunk's +/-/context lines (the "\ No newline" markers don't count); null = the whole hunk.
 * `reverse` builds it for `git apply --reverse` (unstage, discard): unchosen added lines become context
 * and unchosen removed lines drop out, the mirror of the forward case.
 * Returns null when nothing would change.
 */
export function buildPartialPatch(raw: string, index: number, lines: number[] | null, reverse: boolean): { patch: string; header: string } | null {
  const { head, hunks } = splitDiff(raw)
  const h = hunks[index]
  if (!h || !head.length) return null
  const chosen = lines ? new Set(lines) : null
  const out: string[] = []
  let n = 0
  let emittedLast = false
  let changes = 0
  let oldCount = 0
  let newCount = 0
  for (const line of h.body) {
    const tag = line[0]
    if (tag === '\\') {
      if (emittedLast) out.push(line)
      continue
    }
    const text = line.slice(1)
    const sel = chosen ? chosen.has(n) : true
    n++
    emittedLast = true
    if (tag === ' ') {
      out.push(line)
      oldCount++
      newCount++
    } else if (tag === '+') {
      if (sel) {
        out.push(line)
        newCount++
        changes++
      } else if (reverse) {
        out.push(' ' + text)
        oldCount++
        newCount++
      } else emittedLast = false
    } else if (tag === '-') {
      if (sel) {
        out.push(line)
        oldCount++
        changes++
      } else if (!reverse) {
        out.push(' ' + text)
        oldCount++
        newCount++
      } else emittedLast = false
    } else emittedLast = false
  }
  if (!changes) return null
  const fileHead = head.filter((l) => !/^(similarity|rename|copy|dissimilarity) /.test(l))
  const start = h.oldStart
  const hunkHeader = `@@ -${start},${oldCount} +${oldCount === 0 && start === 0 ? 1 : start},${newCount} @@`
  return { patch: [...fileHead, hunkHeader, ...out].join('\n') + '\n', header: h.header }
}

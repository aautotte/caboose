// Splits a file with git conflict markers into shared text and conflict chunks, and builds the result back.

export type Segment =
  | { kind: 'common'; lines: string[] }
  | { kind: 'conflict'; ours: string[]; base: string[] | null; theirs: string[] }

export type Pick = Array<'ours' | 'theirs'> // in the order the user ticked them

export function parseConflicts(text: string): Segment[] {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(eol)
  const segs: Segment[] = []
  let common: string[] = []
  let i = 0
  const flush = (): void => {
    if (common.length) segs.push({ kind: 'common', lines: common })
    common = []
  }
  while (i < lines.length) {
    if (lines[i].startsWith('<<<<<<< ') || lines[i] === '<<<<<<<') {
      const ours: string[] = []
      let base: string[] | null = null
      const theirs: string[] = []
      let j = i + 1
      let part: 'ours' | 'base' | 'theirs' = 'ours'
      let closed = false
      for (; j < lines.length; j++) {
        const l = lines[j]
        if (part === 'ours' && (l.startsWith('||||||| ') || l === '|||||||')) {
          part = 'base'
          base = []
        } else if ((part === 'ours' || part === 'base') && l === '=======') part = 'theirs'
        else if (part === 'theirs' && (l.startsWith('>>>>>>> ') || l === '>>>>>>>')) {
          closed = true
          break
        } else if (part === 'ours') ours.push(l)
        else if (part === 'base') base!.push(l)
        else theirs.push(l)
      }
      if (closed) {
        flush()
        segs.push({ kind: 'conflict', ours, base, theirs })
        i = j + 1
        continue
      }
    }
    common.push(lines[i])
    i++
  }
  flush()
  return segs
}

export function eolOf(text: string): string {
  return text.includes('\r\n') ? '\r\n' : '\n'
}

/** The result text: picked sides in pick order; unpicked conflicts keep their markers so they can't be saved by accident. */
export function compose(segs: Segment[], picks: Pick[], labels: { ours: string; theirs: string }, eol: string): string {
  const out: string[] = []
  let c = 0
  for (const s of segs) {
    if (s.kind === 'common') {
      out.push(...s.lines)
      continue
    }
    const pick = picks[c++] ?? []
    if (pick.length === 0) {
      out.push(`<<<<<<< ${labels.ours}`, ...s.ours, '=======', ...s.theirs, `>>>>>>> ${labels.theirs}`)
    } else {
      for (const side of pick) out.push(...(side === 'ours' ? s.ours : s.theirs))
    }
  }
  return out.join(eol)
}

export const hasMarkers = (text: string): boolean => /^(<<<<<<<|=======|>>>>>>>)( |$)/m.test(text)

/**
 * The common ancestor's lines for each conflict, from a diff3-style copy of the same merge (built from the index).
 * A conflict only gets them when that copy split the file the same way: same number of conflicts, same lines on both sides.
 */
export function baseLines(segs: Segment[], diff3: string | null): Array<string[] | null> {
  const mine = segs.filter((s): s is Extract<Segment, { kind: 'conflict' }> => s.kind === 'conflict')
  const other = diff3 ? parseConflicts(diff3).filter((s): s is Extract<Segment, { kind: 'conflict' }> => s.kind === 'conflict') : []
  const same = (a: string[], b: string[]): boolean => a.length === b.length && a.every((l, i) => l === b[i])
  const aligned = other.length === mine.length && mine.every((c, i) => same(c.ours, other[i].ours) && same(c.theirs, other[i].theirs))
  return mine.map((c, i) => c.base ?? (aligned ? other[i].base : null))
}

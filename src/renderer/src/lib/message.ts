// Commit message helpers: wrapping the description, and adding a co-author as a trailer.

/** A trailer line, as git interpret-trailers reads them: "Token: value". */
const TRAILER = /^[A-Za-z][\w-]*: \S/
const BULLET = /^(\s*)([-*+]|\d+[.)])\s+/

/** Greedy word wrap at `width`; a word longer than the line (a URL) gets a line of its own. */
function wrapWords(text: string, width: number, first: string, rest: string): string[] {
  const out: string[] = []
  let line = first
  let empty = true
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (!empty && line.length + 1 + word.length > width) {
      out.push(line)
      line = rest + word
    } else line += (empty ? '' : ' ') + word
    empty = false
  }
  out.push(line)
  return out
}

/**
 * Wraps the description's paragraphs and list items at `width` characters, as `git log` reads best. Code (fenced
 * or indented), quotes, tables and the trailers at the end (Co-authored-by:, Signed-off-by:) are left as they are.
 */
export function wrapMessage(body: string, width = 72): string {
  // Trailing blank lines go: git drops them anyway, and the trailers are then the last paragraph.
  const text = body.replace(/\r\n/g, '\n').replace(/\s+$/, '')
  if (!text) return ''
  const lines = text.split('\n')
  const out: string[] = []
  let fenced = false
  // A paragraph or list item being gathered: its first line's lead, the lead of the lines after, and its words.
  let item: { first: string; rest: string; text: string } | null = null
  const flush = (): void => {
    if (item) out.push(...wrapWords(item.text, width, item.first, item.rest))
    item = null
  }
  const last = (text.split(/\n\s*\n/).pop() ?? '').split('\n')
  const trailersAt = last.every((l) => TRAILER.test(l)) ? lines.length - last.length : lines.length
  lines.forEach((l, i) => {
    if (/^\s*(```|~~~)/.test(l)) {
      flush()
      fenced = !fenced
      out.push(l)
      return
    }
    // Kept as typed: inside a fence, indented code, quotes, tables, the trailers, and blank lines.
    if (fenced || i >= trailersAt || !l.trim() || /^( {4}|\t)/.test(l) || /^\s*[>|]/.test(l)) {
      flush()
      out.push(l)
      return
    }
    const bullet = BULLET.exec(l)
    if (bullet) {
      flush()
      item = { first: bullet[0], rest: ' '.repeat(bullet[0].length), text: l.slice(bullet[0].length) }
    } else if (item) item.text += ' ' + l.trim()
    else item = { first: '', rest: '', text: l.trim() }
  })
  flush()
  return out.join('\n')
}

/**
 * Adds "Co-authored-by: Name <email>" to the description: to its trailers if it ends with some, otherwise after a
 * blank line. Unchanged when that person is already there.
 */
export function addCoAuthor(body: string, person: string): string {
  const line = `Co-authored-by: ${person.trim()}`
  const email = /<([^>]+)>/.exec(person)?.[1]?.toLowerCase()
  if (email && new RegExp(`^Co-authored-by:.*<${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}>`, 'im').test(body)) return body
  const text = body.replace(/\s+$/, '')
  if (!text) return line
  const last = text.split(/\n\s*\n/).pop() ?? ''
  return last.split('\n').every((l) => TRAILER.test(l)) ? `${text}\n${line}` : `${text}\n\n${line}`
}

/** "Name <email>", the form git wants for an author or a co-author. */
export const isPerson = (s: string): boolean => /^[^<>\n]+ <[^<>\s]+>$/.test(s.trim())

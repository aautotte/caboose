const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
const dtf = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const dayFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })

/** "3 hours ago", "yesterday", or just the day for anything older than 30 days (the time is in fullDate). */
export function relativeTime(unixSeconds: number, nowMs = Date.now()): string {
  const diff = unixSeconds * 1000 - nowMs
  const abs = Math.abs(diff)
  const min = 60_000
  const hour = 60 * min
  const day = 24 * hour
  if (abs < min) return 'just now'
  if (abs < hour) return rtf.format(Math.round(diff / min), 'minute')
  if (abs < day) return rtf.format(Math.round(diff / hour), 'hour')
  if (abs < 30 * day) return rtf.format(Math.round(diff / day), 'day')
  return dayFmt.format(new Date(unixSeconds * 1000))
}

export function fullDate(unixSeconds: number): string {
  return dtf.format(new Date(unixSeconds * 1000))
}

export const shortSha = (sha: string): string => sha.slice(0, 7)

export function splitPath(p: string): { dir: string; name: string } {
  const i = p.lastIndexOf('/')
  return i === -1 ? { dir: '', name: p } : { dir: p.slice(0, i + 1), name: p.slice(i + 1) }
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

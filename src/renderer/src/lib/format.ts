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

/** 1536 → "1.5 KB"; powers of 1024, one decimal under 10. */
export function fileSize(bytes: number): string {
  const units = ['bytes', 'KB', 'MB', 'GB', 'TB']
  let n = bytes
  let u = 0
  while (n >= 1024 && u < units.length - 1) {
    n /= 1024
    u++
  }
  return u === 0 ? plural(bytes, 'byte') : `${n < 10 ? n.toFixed(1) : Math.round(n)} ${units[u]}`
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

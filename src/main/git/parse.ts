// Pure parsers for git's machine-readable output. No I/O here, so they can be unit tested.
import type { Blame, BlameCommit, BlameLine, Change, CommitRow, DiffLine, FileChange, FileDiff, FileHistoryEntry, Hunk, Person, Ref, StatusCode, Stash } from '../../shared/types'

export const US = '\x1f' // unit separator between fields
export const RS = '\x1e' // record separator between commits

export const LOG_FORMAT = ['%H', '%P', '%an', '%ae', '%at', '%s'].join('%x1f') + '%x1e'

export function parseLog(out: string): CommitRow[] {
  const rows: CommitRow[] = []
  for (const rec of out.split(RS)) {
    const r = rec.replace(/^\n/, '')
    if (!r) continue
    const [sha, parents, authorName, authorEmail, at, summary] = r.split(US)
    rows.push({
      sha,
      parents: parents ? parents.split(' ') : [],
      authorName,
      authorEmail,
      authorTime: Number(at),
      summary: summary ?? '',
      kind: 'commit'
    })
  }
  return rows
}

export const REF_FORMAT = [
  '%(refname)',
  '%(objectname)',
  '%(*objectname)',
  '%(upstream)',
  '%(upstream:track,nobracket)',
  '%(HEAD)',
  '%(contents:subject)'
].join('%1f')

export function parseRefs(out: string, remotes: string[]): Ref[] {
  const refs: Ref[] = []
  for (const line of out.split('\n')) {
    if (!line) continue
    const [name, sha, peeled, upstream, track, head, subject] = line.split(US)
    if (name.startsWith('refs/heads/')) {
      const ref: Ref = { name, short: name.slice(11), kind: 'local', sha, isHead: head === '*' }
      if (upstream) {
        ref.upstream = upstream
        ref.upstreamGone = track === 'gone'
        ref.ahead = Number(/ahead (\d+)/.exec(track)?.[1] ?? 0)
        ref.behind = Number(/behind (\d+)/.exec(track)?.[1] ?? 0)
      }
      refs.push(ref)
    } else if (name.startsWith('refs/remotes/')) {
      if (name.endsWith('/HEAD')) continue
      const short = name.slice(13)
      // Remote names can contain '/', so match against the known remote list, longest first.
      const remote = [...remotes].sort((a, b) => b.length - a.length).find((r) => short.startsWith(r + '/')) ?? short.split('/')[0]
      refs.push({ name, short, kind: 'remote', sha, remote, isHead: false })
    } else if (name.startsWith('refs/tags/')) {
      refs.push({
        name,
        short: name.slice(10),
        kind: 'tag',
        sha: peeled || sha,
        isHead: false,
        annotation: peeled ? subject : undefined
      })
    }
  }
  return refs
}

export const STASH_FORMAT = ['%H', '%P', '%gs'].join('%x1f')

export function parseStashes(out: string): Stash[] {
  return out
    .split('\n')
    .filter(Boolean)
    .map((line, index) => {
      const [sha, parents, subject] = line.split(US)
      return {
        index,
        sha,
        base: parents.split(' ')[0],
        message: subject.replace(/^(WIP on|On) [^:]+: /, '')
      }
    })
}

const code = (c: string): StatusCode => (c === '.' ? '.' : (c as StatusCode))

export interface ParsedStatus {
  branch: string | null
  headSha: string | null
  upstream: string | null
  ahead: number
  behind: number
  changes: Change[]
}

/** `git status --porcelain=v2 -z --branch` */
export function parseStatus(out: string): ParsedStatus {
  const s: ParsedStatus = { branch: null, headSha: null, upstream: null, ahead: 0, behind: 0, changes: [] }
  const parts = out.split('\0')
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]
    if (!p) continue
    if (p.startsWith('# ')) {
      const [, key, ...rest] = p.split(' ')
      const val = rest.join(' ')
      if (key === 'branch.oid') s.headSha = val === '(initial)' ? null : val
      else if (key === 'branch.head') s.branch = val === '(detached)' ? null : val
      else if (key === 'branch.upstream') s.upstream = val
      else if (key === 'branch.ab') {
        const m = /\+(\d+) -(\d+)/.exec(val)
        if (m) {
          s.ahead = Number(m[1])
          s.behind = Number(m[2])
        }
      }
    } else if (p[0] === '1') {
      const f = p.split(' ')
      s.changes.push({ path: f.slice(8).join(' '), index: code(f[1][0]), worktree: code(f[1][1]), conflicted: false })
    } else if (p[0] === '2') {
      const f = p.split(' ')
      s.changes.push({
        path: f.slice(9).join(' '),
        origPath: parts[++i],
        index: code(f[1][0]),
        worktree: code(f[1][1]),
        conflicted: false
      })
    } else if (p[0] === 'u') {
      const f = p.split(' ')
      s.changes.push({ path: f.slice(10).join(' '), index: 'U', worktree: 'U', conflicted: true })
    } else if (p[0] === '?') {
      s.changes.push({ path: p.slice(2), index: '.', worktree: '?', conflicted: false })
    }
  }
  return s
}

/** `git diff-tree -r -M -z --name-status` */
export function parseNameStatus(out: string): FileChange[] {
  const parts = out.split('\0').filter((p, i, a) => p !== '' || i < a.length - 1)
  const files: FileChange[] = []
  for (let i = 0; i < parts.length; i++) {
    const st = parts[i]
    if (!st) continue
    const letter = st[0] as FileChange['status']
    if (letter === 'R' || letter === 'C') {
      files.push({ status: letter, origPath: parts[i + 1], path: parts[i + 2] })
      i += 2
    } else {
      files.push({ status: letter, path: parts[i + 1] })
      i += 1
    }
  }
  return files
}

export function parseCoAuthors(body: string): Person[] {
  const out: Person[] = []
  for (const m of body.matchAll(/^Co-authored-by:\s*(.+?)\s*<([^>]+)>\s*$/gim)) out.push({ name: m[1], email: m[2] })
  return out
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/

/** Parses one file's unified diff (the output of `git diff -- <path>`). */
export function parseDiff(text: string, path: string): FileDiff {
  const diff: FileDiff = { path, binary: false, tooLarge: false, lineCount: 0, isNew: false, isDeleted: false, hunks: [] }
  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  let hunk: Hunk | null = null
  let oldNo = 0
  let newNo = 0
  let oldMode = ''
  for (const line of lines) {
    if (!hunk) {
      if (line.startsWith('new file mode')) diff.isNew = true
      else if (line.startsWith('deleted file mode')) diff.isDeleted = true
      else if (line.startsWith('rename from ')) diff.oldPath = line.slice(12)
      else if (line.startsWith('old mode ')) oldMode = line.slice(9)
      else if (line.startsWith('new mode ')) diff.modeChange = `${oldMode} → ${line.slice(9)}`
      else if (line.startsWith('Binary files') || line.startsWith('GIT binary patch')) diff.binary = true
    }
    const m = HUNK.exec(line)
    if (m) {
      hunk = {
        header: line,
        oldStart: Number(m[1]),
        oldLines: m[2] === undefined ? 1 : Number(m[2]),
        newStart: Number(m[3]),
        newLines: m[4] === undefined ? 1 : Number(m[4]),
        lines: []
      }
      oldNo = hunk.oldStart
      newNo = hunk.newStart
      diff.hunks.push(hunk)
      continue
    }
    if (!hunk) continue
    const tag = line[0]
    let dl: DiffLine | null = null
    if (tag === '+') dl = { type: 'add', text: line.slice(1), newNo: newNo++ }
    else if (tag === '-') dl = { type: 'del', text: line.slice(1), oldNo: oldNo++ }
    else if (tag === ' ') dl = { type: 'ctx', text: line.slice(1), oldNo: oldNo++, newNo: newNo++ }
    else if (tag === '\\') {
      const last = hunk.lines[hunk.lines.length - 1]
      if (last) last.noNewline = true
    }
    if (dl) {
      hunk.lines.push(dl)
      diff.lineCount++
    }
  }
  return diff
}

export const HISTORY_FORMAT = '%x1e' + ['%H', '%P', '%an', '%ae', '%at', '%s'].join('%x1f')

/** `git log --follow --name-status -z --format=HISTORY_FORMAT -- path`: one entry per commit, with the file's name at that commit. */
export function parseFileHistory(out: string): FileHistoryEntry[] {
  const rows: FileHistoryEntry[] = []
  for (const rec of out.split(RS)) {
    if (!rec) continue
    const parts = rec.split('\0')
    const [sha, parents, authorName, authorEmail, at, summary] = parts[0].split(US)
    const rest = parts.slice(1).map((p) => p.replace(/^\n/, '')).filter((p, i, a) => p !== '' || i < a.length - 1)
    const status = rest[0] ?? ''
    const letter = status[0] ?? 'M'
    const two = letter === 'R' || letter === 'C'
    rows.push({
      sha,
      parents: parents ? parents.split(' ') : [],
      authorName,
      authorEmail,
      authorTime: Number(at),
      summary: summary ?? '',
      kind: 'commit',
      status: letter as FileHistoryEntry['status'],
      path: (two ? rest[2] : rest[1]) ?? '',
      oldPath: two ? rest[1] : undefined
    })
  }
  return rows
}

/** `git blame --porcelain`: commit details appear once, the first time a commit is seen. */
export function parseBlame(out: string, path: string): Blame {
  const lines: BlameLine[] = []
  const commits: Record<string, BlameCommit> = {}
  let cur: BlameCommit | null = null
  let lineNo = 0
  for (const line of out.split('\n')) {
    if (line.startsWith('\t')) {
      if (cur) lines.push({ sha: cur.sha, line: lineNo, text: line.slice(1) })
      continue
    }
    const head = /^([0-9a-f]{40}) \d+ (\d+)/.exec(line)
    if (head) {
      const sha = head[1]
      lineNo = Number(head[2])
      cur = commits[sha] ??= { sha, author: '', email: '', time: 0, summary: '', uncommitted: /^0+$/.test(sha) }
      continue
    }
    if (!cur) continue
    const sp = line.indexOf(' ')
    const key = sp < 0 ? line : line.slice(0, sp)
    const val = sp < 0 ? '' : line.slice(sp + 1)
    if (key === 'author') cur.author = val
    else if (key === 'author-mail') cur.email = val.replace(/^<|>$/g, '')
    else if (key === 'author-time') cur.time = Number(val)
    else if (key === 'summary') cur.summary = val
  }
  return { path, lines, commits }
}

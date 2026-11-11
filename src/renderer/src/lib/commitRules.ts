// A repository's commit message rules: a summary length, an issue to mention, Conventional Commits. The commit box
// checks the message as you type, and either warns or holds the commit back until it fits.

export interface CommitRules {
  /** The longest summary allowed, in characters; null for no limit. */
  summaryMax: number | null
  /** A regular expression the message must match somewhere, like an issue key; null for none. */
  issue: { pattern: string; where: 'summary' | 'anywhere' } | null
  /** The summary starts with one of `types`, as Conventional Commits has it: "feat(scope)!: what changed". */
  conventional: boolean
  types: string[]
  /** warn: say what's wrong, commit anyway. block: no commit until the message fits. */
  enforce: 'warn' | 'block'
}

export const CONVENTIONAL_TYPES = ['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'build', 'ci', 'chore', 'revert']
export const ISSUE_KEY = '[A-Z][A-Z0-9]+-\\d+'

export const DEFAULT_RULES: CommitRules = { summaryMax: null, issue: null, conventional: false, types: CONVENTIONAL_TYPES, enforce: 'warn' }

/** Rules read back from settings: anything malformed is left out rather than trusted. */
export function readRules(v: unknown): CommitRules | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Partial<CommitRules>
  const max = typeof o.summaryMax === 'number' && o.summaryMax > 0 ? Math.floor(o.summaryMax) : null
  const issue = o.issue && typeof o.issue.pattern === 'string' && o.issue.pattern && !patternProblem(o.issue.pattern) ? { pattern: o.issue.pattern, where: o.issue.where === 'summary' ? ('summary' as const) : ('anywhere' as const) } : null
  const types = Array.isArray(o.types) ? o.types.filter((t): t is string => typeof t === 'string' && /^[a-z][a-z0-9-]*$/.test(t)) : []
  const rules: CommitRules = { summaryMax: max, issue, conventional: o.conventional === true, types: types.length ? types : CONVENTIONAL_TYPES, enforce: o.enforce === 'block' ? 'block' : 'warn' }
  return hasRules(rules) ? rules : null
}

export const hasRules = (r: CommitRules | null): r is CommitRules => !!r && (r.summaryMax !== null || r.issue !== null || r.conventional)

/** Why a pattern can't be used, or null. */
export function patternProblem(pattern: string): string | null {
  try {
    new RegExp(pattern)
    return null
  } catch {
    return 'That isn’t a valid regular expression.'
  }
}

/** "like ABC-123" for the usual issue key, otherwise the pattern itself. */
export const issueExample = (pattern: string): string => (pattern === ISSUE_KEY ? 'like ABC-123' : `matching ${pattern}`)

/**
 * What's wrong with a message under these rules, one sentence each; empty when it fits. A summary git or Caboose
 * wrote (Merge …, Revert …, fixup! …, squash! …) isn't checked.
 */
export function checkMessage(rules: CommitRules | null, summary: string, body: string): string[] {
  if (!hasRules(rules)) return []
  const s = summary.trim()
  if (!s || /^(fixup|squash|amend)! /.test(s) || /^(Merge|Revert) /.test(s)) return []
  const out: string[] = []
  if (rules.conventional) {
    const m = /^([a-zA-Z]+)(\([^()\s][^()]*\))?(!)?: \S/.exec(s)
    if (!m) out.push(`Start the summary with a type, like “feat: …” or “fix(api): …” (Conventional Commits).`)
    else if (!rules.types.includes(m[1])) out.push(`“${m[1]}” isn’t one of this repository’s types: ${rules.types.join(', ')}.`)
  }
  if (rules.summaryMax !== null && s.length > rules.summaryMax) out.push(`The summary is ${s.length} characters: keep it to ${rules.summaryMax}.`)
  if (rules.issue) {
    const re = new RegExp(rules.issue.pattern)
    const text = rules.issue.where === 'summary' ? s : `${s}\n${body}`
    if (!re.test(text)) out.push(`Mention an issue ${issueExample(rules.issue.pattern)}${rules.issue.where === 'summary' ? ' in the summary' : ''}.`)
  }
  return out
}

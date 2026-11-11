// Your own git commands: a command line with placeholders for the commit, branch or file it runs on, and prompts.
// It's split into arguments first and the values go in afterwards, one argument each, so a branch or a file name
// can never add options of its own. Git runs it directly, without a shell.

export interface CustomCommand {
  id: string
  name: string
  /** The git command line, with or without the leading "git". */
  command: string
  /** Show the command line before running it, even with nothing to ask. */
  confirm: boolean
  /** Show what it prints in a window; otherwise a notification says how it went. */
  output: boolean
}

/** What a command runs on: the commit, branch or file its menu was opened on. */
export interface CommandContext {
  commit?: string
  branch?: string
  file?: string
}

/** {head} is the checked-out branch, read as the command runs. */
export type Need = 'commit' | 'branch' | 'file' | 'head'

export interface Prompt {
  label: string
  /** What the field starts with: {?Label=this}. */
  value: string
}

export interface ParsedCommand {
  args: string[]
  needs: Need[]
  prompts: Prompt[]
  problem: string | null
}

// Anything else in braces stays as typed, like HEAD@{1} or @{upstream}.
const PLACEHOLDER = /\{(commit|branch|file|head|\?[^{}]*)\}/g

/**
 * Splits a command line like a shell would: spaces separate, quotes group, and so does a question ({?Tag name}).
 * A backslash only escapes inside "…".
 */
export function splitArgs(line: string): { args: string[]; problem: string | null } {
  const args: string[] = []
  let cur = ''
  let started = false
  let quote: '"' | "'" | null = null
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quote) {
      if (ch === quote) quote = null
      else if (quote === '"' && ch === '\\' && (line[i + 1] === '"' || line[i + 1] === '\\')) cur += line[++i]
      else cur += ch
    } else if (ch === '{' && /^\{\?[^{}]*\}/.test(line.slice(i))) {
      // A question's label can have spaces: {?Tag name} is one piece.
      const q = /^\{\?[^{}]*\}/.exec(line.slice(i))![0]
      cur += q
      i += q.length - 1
      started = true
    } else if (ch === '"' || ch === "'") {
      quote = ch
      started = true
    } else if (/\s/.test(ch)) {
      if (started) args.push(cur)
      cur = ''
      started = false
    } else {
      cur += ch
      started = true
    }
  }
  if (quote) return { args, problem: `A ${quote === '"' ? 'double' : 'single'} quote isn’t closed.` }
  if (started) args.push(cur)
  return { args, problem: null }
}

export function parseCommand(line: string): ParsedCommand {
  const split = splitArgs(line)
  const args = split.args[0] === 'git' ? split.args.slice(1) : split.args
  const needs = new Set<Need>()
  const prompts: Prompt[] = []
  let problem = split.problem
  for (const a of args) {
    for (const m of a.matchAll(PLACEHOLDER)) {
      const name = m[1]
      if (!name.startsWith('?')) {
        needs.add(name as Need)
        continue
      }
      const eq = name.indexOf('=')
      const label = (eq < 0 ? name.slice(1) : name.slice(1, eq)).trim()
      if (!label) problem ??= 'A question needs a label, like {?Tag name}.'
      else if (!prompts.some((p) => p.label === label)) prompts.push({ label, value: eq < 0 ? '' : name.slice(eq + 1) })
    }
  }
  if (!args.length) problem ??= 'Write the git command to run, like log --oneline -n 20.'
  return { args, needs: [...needs], prompts, problem }
}

/**
 * The arguments with the values in. `answers` are the prompts' values by label. A commit, branch or file that would
 * make up a whole argument starting with "-" is refused unless a "--" comes before it: git would take it as an option.
 */
export function fillCommand(p: ParsedCommand, ctx: CommandContext & { head?: string }, answers: Record<string, string>): { args: string[] } | { problem: string } {
  if (p.problem) return { problem: p.problem }
  const missing = p.needs.find((n) => !ctx[n])
  if (missing) return { problem: missingText[missing] }
  const out: string[] = []
  let pathsFollow = false
  for (const a of p.args) {
    const whole = /^\{(commit|branch|file|head)\}$/.exec(a)
    if (whole && !pathsFollow && ctx[whole[1] as Need]!.startsWith('-'))
      return { problem: `“${ctx[whole[1] as Need]}” starts with “-”, so git would read it as an option. Put -- before {${whole[1]}} in the command.` }
    out.push(
      a.replace(PLACEHOLDER, (_, name: string) => {
        if (!name.startsWith('?')) return ctx[name as Need]!
        const eq = name.indexOf('=')
        return answers[(eq < 0 ? name.slice(1) : name.slice(1, eq)).trim()] ?? ''
      })
    )
    if (a === '--') pathsFollow = true
  }
  return { args: out }
}

const missingText: Record<Need, string> = {
  commit: 'Pick a commit first: this command runs on one.',
  branch: 'Run this from a branch’s menu: it runs on that branch.',
  file: 'Open a file first: this command runs on one.',
  head: 'Check out a branch first: this command uses the current one ({head}).'
}

/** The command line as it will run, quoted where an argument has spaces. */
export function showCommand(args: string[]): string {
  return ['git', ...args].map((a) => (a === '' || /[\s"']/.test(a) ? `"${a.replace(/(["\\])/g, '\\$1')}"` : a)).join(' ')
}

/** Commit, branch and file commands show on that thing's menus; any command can run from the palette. */
export type MenuKind = 'commit' | 'branch' | 'file'

/** Whether a command belongs on a menu for `kind`, where `also` is known too (a commit's files know the commit). */
export function fitsMenu(needs: Need[], kind: MenuKind, also: Need[] = []): boolean {
  return needs.includes(kind) && needs.every((n) => n === kind || n === 'head' || also.includes(n))
}

/** Where a command shows, for its editor. */
export function whereShown(needs: Need[]): string {
  if (fitsMenu(needs, 'file', ['commit'])) {
    const where = needs.includes('commit') ? 'a file’s menu in a commit' : 'a file’s menu'
    return `On ${where}, under Your commands, and in the command palette while a file is open.`
  }
  if (fitsMenu(needs, 'commit')) return 'On a commit’s menu, under Your commands, and in the command palette while a commit is picked.'
  if (fitsMenu(needs, 'branch')) return 'On a branch’s menu, under Your commands, and in the command palette for the checked-out branch.'
  return 'In the command palette, and on a shortcut if you give it one.'
}

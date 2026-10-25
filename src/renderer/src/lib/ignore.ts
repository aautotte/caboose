import { plural, splitPath } from './format'

/** One way to ignore some files: the lines it adds to the root .gitignore, and how to name it. */
export interface IgnoreChoice {
  label: string
  patterns: string[]
  /** For the toast and the undo label, e.g. "*.log files". */
  what: string
}

/** Escapes a path so .gitignore matches it literally. Trailing spaces only count when escaped. */
export const ignoreEscape = (s: string): string => s.replace(/[\\*?[\]!#]/g, (c) => `\\${c}`).replace(/ +$/, (sp) => '\\ '.repeat(sp.length))

/** An extension for "All *.ext files"; none for a dotfile like .env, where it would be the whole name. */
const extOf = (path: string): string | null => /.\.([^./]+)$/.exec(splitPath(path).name)?.[1] ?? null

/** The folders that hold every one of these paths, deepest first. */
function sharedFolders(paths: string[]): string[] {
  const parts = paths.map((p) => p.split('/').slice(0, -1))
  const common: string[] = []
  for (let i = 0; parts.every((d) => i < d.length && d[i] === parts[0][i]); i++) common.push(parts[0][i])
  return common.map((_, i) => common.slice(0, i + 1).join('/')).reverse()
}

/**
 * The Ignore menu for these files: the files themselves, their kind when they share one, and each folder
 * that holds them all, from the nearest out to the top.
 */
export function ignoreChoices(paths: string[]): IgnoreChoice[] {
  const one = paths.length === 1
  const { name } = splitPath(paths[0])
  const exts = new Set(paths.map(extOf))
  const ext = exts.size === 1 ? [...exts][0] : null
  return [
    {
      label: one ? `This file (${name})` : `These ${paths.length} files`,
      patterns: paths.map((p) => `/${ignoreEscape(p)}`),
      what: one ? name : plural(paths.length, 'file')
    },
    ...(ext ? [{ label: `All *.${ext} files`, patterns: [`*.${ignoreEscape(ext)}`], what: `*.${ext} files` }] : []),
    ...sharedFolders(paths)
      .slice(0, 8)
      .map((dir) => ({ label: `Folder ${dir}/`, patterns: [`/${ignoreEscape(dir)}/`], what: `${dir}/` }))
  ]
}

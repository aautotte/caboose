// Git LFS rules for the file menus: which ones a file can be tracked with, and which one tracks it now.
import { splitPath } from './format'

/** "*.psd" for art/cover.psd; null for a name without an extension (README, .env). */
export function extensionRule(path: string): string | null {
  const { name } = splitPath(path)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? `*${name.slice(dot)}` : null
}

/** How `git lfs track --filename` writes one file's rule: glob characters escaped, a space as [[:space:]]. */
export function exactRule(path: string): string {
  return path.replace(/[[\]*?!#\\]/g, (c) => `\\${c}`).replace(/ /g, '[[:space:]]')
}

/** The rule in the root .gitattributes that puts this file in LFS, when it's one of the forms the menus write. */
export function ruleFor(path: string, patterns: string[]): string | null {
  const candidates = [extensionRule(path), exactRule(path), path, splitPath(path).name].filter((c): c is string => !!c)
  return candidates.find((c) => patterns.includes(c)) ?? null
}

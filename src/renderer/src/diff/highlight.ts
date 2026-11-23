import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import csharp from 'highlight.js/lib/languages/csharp'
import css from 'highlight.js/lib/languages/css'
import go from 'highlight.js/lib/languages/go'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import markdown from 'highlight.js/lib/languages/markdown'
import python from 'highlight.js/lib/languages/python'
import rust from 'highlight.js/lib/languages/rust'
import sql from 'highlight.js/lib/languages/sql'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'

const langs = { bash, c, cpp, csharp, css, go, java, javascript, json, markdown, python, rust, sql, typescript, xml, yaml }
for (const [name, def] of Object.entries(langs)) hljs.registerLanguage(name, def)

const byExt: Record<string, string> = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  json: 'json', css: 'css', scss: 'css', html: 'xml', htm: 'xml', xml: 'xml', svg: 'xml', vue: 'xml',
  md: 'markdown', markdown: 'markdown', py: 'python', go: 'go', rs: 'rust', java: 'java', kt: 'java',
  c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', hpp: 'cpp', cs: 'csharp', sh: 'bash', bash: 'bash', zsh: 'bash',
  yml: 'yaml', yaml: 'yaml', sql: 'sql'
}

export function languageFor(path: string): string | null {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  return byExt[ext] ?? null
}

/**
 * Highlights one line. Line-by-line is approximate for multi-line strings and comments, but keeps
 * diff rendering simple and fast. Output is escaped by highlight.js.
 */
export function highlightLine(text: string, lang: string | null): string {
  if (!lang || text.length > 2000) return escapeHtml(text)
  try {
    return hljs.highlight(text, { language: lang, ignoreIllegals: true }).value
  } catch {
    return escapeHtml(text)
  }
}

/**
 * Wraps the changed pieces of a line in `<mark class>` inside its highlighted HTML. A mark that meets one of the
 * highlighter's tags closes before it and opens again after, so the two never overlap.
 */
export function markChanged(html: string, parts: Array<[string, boolean]>, className: string): string {
  const ranges: Array<[number, number]> = []
  let pos = 0
  for (const [t, changed] of parts) {
    if (changed && t) ranges.push([pos, pos + t.length])
    pos += t.length
  }
  if (!ranges.length) return html
  const open = `<mark class="${className}">`
  let out = ''
  let at = 0 // characters of text so far, an entity (&lt;) counting as one
  let r = 0
  let inside = false
  for (let i = 0; i < html.length; ) {
    if (html[i] === '<') {
      const end = html.indexOf('>', i) + 1
      const tag = html.slice(i, end)
      out += inside ? `</mark>${tag}${open}` : tag
      i = end
      continue
    }
    if (inside && at === ranges[r][1]) {
      out += '</mark>'
      inside = false
      r++
    }
    if (!inside && r < ranges.length && at === ranges[r][0]) {
      out += open
      inside = true
    }
    const len = html[i] === '&' ? html.indexOf(';', i) + 1 - i : 1
    out += html.slice(i, i + len)
    i += len
    at++
  }
  return inside ? `${out}</mark>` : out
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

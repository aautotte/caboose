import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { IconButton, TextInput, Tooltip } from '@/ui'

// Every match, and the current one stronger. Added here: the CSS build doesn't know ::highlight and drops it.
const style = document.createElement('style')
style.textContent = `
::highlight(diff-find) { background-color: color-mix(in srgb, var(--gc-color-warning) 35%, transparent); }
::highlight(diff-find-current) { background-color: var(--gc-color-warning); color: var(--gc-color-on-lane); }`
document.head.append(style)

/**
 * Finds `query` (any case) in the code lines under `root` and paints the hits with the CSS highlight API, so the
 * syntax highlighting's markup stays as it is. `redo` changes when the lines on screen do (a reload, another layout).
 */
export function useFindInView(root: RefObject<HTMLElement | null>, query: string, redo: unknown): { count: number; current: number; go: (dirn: 1 | -1) => void } {
  const ranges = useRef<Range[]>([])
  const [count, setCount] = useState(0)
  const [current, setCurrent] = useState(0)
  const lastQuery = useRef('')

  useLayoutEffect(() => {
    const found: Range[] = []
    const needle = query.toLowerCase()
    if (needle && root.current) {
      for (const line of root.current.querySelectorAll<HTMLElement>('.hljs-line')) {
        // A match can run across the highlighter's spans: search the line's text, then map back to its text nodes.
        const nodes: Text[] = []
        const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT)
        for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text)
        const text = nodes.map((n) => n.data).join('').toLowerCase()
        const at = (pos: number): [Text, number] => {
          for (const n of nodes) {
            if (pos <= n.data.length) return [n, pos]
            pos -= n.data.length
          }
          return [nodes[nodes.length - 1], nodes[nodes.length - 1].data.length]
        }
        for (let i = text.indexOf(needle); i >= 0; i = text.indexOf(needle, i + needle.length)) {
          const r = new Range()
          r.setStart(...at(i))
          r.setEnd(...at(i + needle.length))
          found.push(r)
        }
      }
    }
    ranges.current = found
    setCount(found.length)
    // A new search starts at the first hit; a reload of the same one stays about where it was.
    setCurrent((c) => (query !== lastQuery.current ? 0 : Math.min(c, Math.max(0, found.length - 1))))
    lastQuery.current = query
  }, [root, query, redo])

  useLayoutEffect(() => {
    const all = ranges.current
    if (!all.length) {
      CSS.highlights.delete('diff-find')
      CSS.highlights.delete('diff-find-current')
      return
    }
    CSS.highlights.set('diff-find', new Highlight(...all))
    CSS.highlights.set('diff-find-current', new Highlight(all[current] ?? all[0]))
  }, [count, current, redo])

  // Scroll the current hit into view, clear of the sticky block header.
  useEffect(() => {
    const el = root.current
    const r = ranges.current[current]
    if (!el || !r) return
    const hit = r.getBoundingClientRect()
    const box = el.getBoundingClientRect()
    if (hit.top < box.top + 32 || hit.bottom > box.bottom) el.scrollTop += hit.top - box.top - el.clientHeight / 2
    if (hit.left < box.left + 120 || hit.right > box.right) el.scrollLeft += hit.left - box.left - el.clientWidth / 2
  }, [root, current, query, count])

  useEffect(
    () => () => {
      CSS.highlights.delete('diff-find')
      CSS.highlights.delete('diff-find-current')
    },
    []
  )

  const go = (dirn: 1 | -1): void => {
    if (count) setCurrent((c) => (c + dirn + count) % count)
  }
  return { count, current, go }
}

/** The bar under the diff's header: the search box, where you are among the hits, previous / next, close. */
export function FindBar({
  query,
  onQuery,
  count,
  current,
  onGo,
  onClose,
  focusKey
}: {
  query: string
  onQuery: (q: string) => void
  count: number
  current: number
  onGo: (dirn: 1 | -1) => void
  onClose: () => void
  /** Changes each time Ctrl+F asks for the box again, to focus and select it. */
  focusKey: number
}): React.JSX.Element {
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [focusKey])
  return (
    <div role="search" aria-label="Find in file" className="flex h-9 shrink-0 items-center gap-1 border-b border-border bg-surface px-3">
      <div className="w-72">
        <TextInput
          ref={input}
          variant="search"
          size="sm"
          aria-label="Find in file"
          placeholder="Find in file"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          onClear={() => onQuery('')}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              onGo(e.shiftKey ? -1 : 1)
            } else if (e.key === 'Escape') {
              // Esc closes the bar, not the diff behind it.
              e.stopPropagation()
              onClose()
            }
          }}
        />
      </div>
      <span className="min-w-20 px-1 text-xs text-muted" role="status" aria-live="polite">
        {query ? (count ? `${current + 1} of ${count}` : 'No results') : ''}
      </span>
      <Tooltip content="Previous match" shortcut="Shift+Enter">
        <IconButton label="Previous match" disabled={!count} onClick={() => onGo(-1)}>
          <ChevronUp size={16} />
        </IconButton>
      </Tooltip>
      <Tooltip content="Next match" shortcut="Enter">
        <IconButton label="Next match" disabled={!count} onClick={() => onGo(1)}>
          <ChevronDown size={16} />
        </IconButton>
      </Tooltip>
      <Tooltip content="Close" shortcut="Esc">
        <IconButton label="Close find" onClick={onClose}>
          <X size={16} />
        </IconButton>
      </Tooltip>
    </div>
  )
}

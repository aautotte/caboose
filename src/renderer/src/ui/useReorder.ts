import { useEffect, useRef, useState } from 'react'

/** How far the pointer moves before a press becomes a drag: a click that wobbles a little is still a click. */
const THRESHOLD = 5
/** Within this far of the list's edge, the list scrolls by itself. */
const EDGE = 32

interface Press {
  index: number
  pointerId: number
  start: number
  scroller: HTMLElement | null
  scrollStart: number
  last: number
  /** Measured once the drag starts: where each item is (in the list's scrolled coordinates) and how big. */
  pos?: number[]
  size?: number[]
  gap?: number
}

/**
 * Reordering a list by dragging, with the pointer rather than HTML drag and drop: the item follows the pointer, the
 * others slide out of its way, and it lands where it's dropped. It moves past an item once its middle crosses that
 * item's middle, measured from where everything was when the drag started, so it doesn't flicker back and forth at
 * the edges. Esc puts it back. Near the list's edge the list scrolls.
 */
export function useReorder({ axis, count, onMove }: { axis: 'x' | 'y'; count: number; onMove: (from: number, to: number) => void }): {
  dragging: number | null
  itemProps: (index: number) => { ref: (el: HTMLElement | null) => void; onPointerDown: (e: React.PointerEvent) => void; style: React.CSSProperties | undefined; 'data-dragging'?: '' }
} {
  const els = useRef<(HTMLElement | null)[]>([])
  const press = useRef<Press | null>(null)
  const [drag, setDrag] = useState<{ index: number; to: number; offset: number; shift: number } | null>(null)
  const move = useRef(onMove)
  move.current = onMove
  const stop = useRef<() => void>(() => {})

  useEffect(() => () => stop.current(), [])

  const coord = (e: { clientX: number; clientY: number }): number => (axis === 'x' ? e.clientX : e.clientY)
  const scrollOf = (el: HTMLElement | null): number => (el ? (axis === 'x' ? el.scrollLeft : el.scrollTop) : 0)

  /** Where the dragged item is now, and the index it would land at. */
  const place = (p: Press): { offset: number; to: number } => {
    const offset = p.last - p.start + scrollOf(p.scroller) - p.scrollStart
    const pos = p.pos!
    const size = p.size!
    const middle = pos[p.index] + size[p.index] / 2 + offset
    let to = 0
    for (let j = 0; j < pos.length; j++) if (j !== p.index && pos[j] + size[j] / 2 < middle) to++
    return { offset, to }
  }

  const begin = (p: Press): void => {
    const rects = els.current.slice(0, count).map((el) => el?.getBoundingClientRect())
    const base = p.scroller?.getBoundingClientRect()
    const at = (r: DOMRect | undefined): number => (r ? (axis === 'x' ? r.left - (base?.left ?? 0) : r.top - (base?.top ?? 0)) : 0) + p.scrollStart
    p.pos = rects.map(at)
    p.size = rects.map((r) => (r ? (axis === 'x' ? r.width : r.height) : 0))
    p.gap = count > 1 ? Math.max(0, p.pos[1] - p.pos[0] - p.size[0]) : 0
    document.body.style.userSelect = 'none'
  }

  const update = (p: Press): void => {
    const { offset, to } = place(p)
    setDrag({ index: p.index, to, offset, shift: p.size![p.index] + p.gap! })
  }

  const onPointerDown = (index: number) => (e: React.PointerEvent): void => {
    if (e.button !== 0 || count < 2 || press.current) return
    const t = e.target as HTMLElement
    if (t.closest('input, textarea, select, [contenteditable], [data-no-drag]')) return
    const el = els.current[index]
    const scroller = scrollParent(el, axis)
    const p: Press = { index, pointerId: e.pointerId, start: coord(e), scroller, scrollStart: scrollOf(scroller), last: coord(e) }
    press.current = p
    let frame = 0

    // Near an edge of the list, it scrolls a little each frame for as long as the pointer stays there.
    const edgeScroll = (): void => {
      frame = 0
      const s = p.scroller
      if (!s || !p.pos) return
      const r = s.getBoundingClientRect()
      const lo = axis === 'x' ? r.left : r.top
      const hi = axis === 'x' ? r.right : r.bottom
      const speed = p.last < lo + EDGE ? -Math.ceil((lo + EDGE - p.last) / 4) : p.last > hi - EDGE ? Math.ceil((p.last - hi + EDGE) / 4) : 0
      if (!speed) return
      const before = scrollOf(s)
      if (axis === 'x') s.scrollLeft += speed
      else s.scrollTop += speed
      if (scrollOf(s) === before) return
      update(p)
      frame = requestAnimationFrame(edgeScroll)
    }

    const onMoveEvt = (ev: PointerEvent): void => {
      if (ev.pointerId !== p.pointerId) return
      p.last = coord(ev)
      if (!p.pos) {
        if (Math.abs(p.last - p.start) < THRESHOLD) return
        begin(p)
      }
      update(p)
      if (!frame) frame = requestAnimationFrame(edgeScroll)
    }
    const end = (commit: boolean): void => {
      const started = !!p.pos
      const to = started ? place(p).to : p.index
      stop.current()
      if (!started) return
      // The click that ends a drag isn't a click on the item.
      const swallow = (ev: MouseEvent): void => {
        ev.stopPropagation()
        ev.preventDefault()
      }
      window.addEventListener('click', swallow, true)
      setTimeout(() => window.removeEventListener('click', swallow, true))
      if (commit && to !== p.index) move.current(p.index, to)
    }
    const onUp = (ev: PointerEvent): void => {
      if (ev.pointerId === p.pointerId) end(true)
    }
    const onCancel = (ev: PointerEvent): void => {
      if (ev.pointerId === p.pointerId) end(false)
    }
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key !== 'Escape' || !p.pos) return
      ev.preventDefault()
      ev.stopPropagation()
      end(false)
    }
    stop.current = () => {
      window.removeEventListener('pointermove', onMoveEvt)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('keydown', onKey, true)
      if (frame) cancelAnimationFrame(frame)
      if (p.pos) document.body.style.userSelect = ''
      press.current = null
      stop.current = () => {}
      setDrag(null)
    }
    window.addEventListener('pointermove', onMoveEvt)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('keydown', onKey, true)
  }

  const styleFor = (i: number): React.CSSProperties | undefined => {
    if (!drag) return undefined
    const translate = (n: number): string => (axis === 'x' ? `translateX(${n}px)` : `translateY(${n}px)`)
    if (i === drag.index) return { transform: translate(drag.offset), position: 'relative', zIndex: 1, transition: 'none' }
    const { index: from, to, shift } = drag
    const by = from < to && i > from && i <= to ? -shift : to < from && i >= to && i < from ? shift : 0
    return { transform: translate(by), transition: 'transform 120ms ease' }
  }

  return {
    dragging: drag?.index ?? null,
    itemProps: (i) => ({
      ref: (el) => {
        els.current[i] = el
      },
      onPointerDown: onPointerDown(i),
      style: styleFor(i),
      ...(drag?.index === i ? { 'data-dragging': '' as const } : {})
    })
  }
}

function scrollParent(el: HTMLElement | null, axis: 'x' | 'y'): HTMLElement | null {
  for (let p = el?.parentElement ?? null; p; p = p.parentElement) {
    const o = getComputedStyle(p)[axis === 'x' ? 'overflowX' : 'overflowY']
    if (o === 'auto' || o === 'scroll') return p
  }
  return el?.parentElement ?? null
}

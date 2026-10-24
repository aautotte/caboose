import { useRef } from 'react'
import { cn } from './cn'

/**
 * Vertical splitter between two panes. Controlled: the parent owns `value` (px width of the pane it sizes).
 * `edge` says which side that pane is on, so dragging moves the right way.
 */
export function Splitter({
  label,
  value,
  min,
  max,
  defaultValue,
  edge = 'left',
  onChange
}: {
  label: string
  value: number
  min: number
  max: number
  defaultValue: number
  edge?: 'left' | 'right'
  onChange: (v: number) => void
}): React.JSX.Element {
  const start = useRef<{ x: number; v: number } | null>(null)
  const clamp = (v: number): number => Math.min(max, Math.max(min, v))
  const dir = edge === 'left' ? 1 : -1
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      tabIndex={0}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        start.current = { x: e.clientX, v: value }
      }}
      onPointerMove={(e) => {
        if (start.current) onChange(clamp(start.current.v + dir * (e.clientX - start.current.x)))
      }}
      onPointerUp={() => (start.current = null)}
      onKeyDown={(e) => {
        const step = { ArrowLeft: -16 * dir, ArrowRight: 16 * dir } as Record<string, number>
        if (e.key in step) onChange(clamp(value + step[e.key]))
        else if (e.key === 'Home') onChange(min)
        else if (e.key === 'End') onChange(max)
        else if (e.key === 'Enter') onChange(defaultValue)
        else return
        e.preventDefault()
      }}
      className={cn(
        'group relative w-px shrink-0 cursor-col-resize bg-border outline-none',
        'before:absolute before:inset-y-0 before:-left-0.75 before:w-1.75 before:content-[""]'
      )}
    >
      <div className="absolute inset-y-0 -left-px w-0.75 bg-accent opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 group-active:opacity-100" />
    </div>
  )
}

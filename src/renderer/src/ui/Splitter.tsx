import { useRef } from 'react'
import { cn } from './cn'

/**
 * Splitter between two panes, side by side (vertical, the default) or one above the other (horizontal). Controlled:
 * the parent owns `value` (px width, or height, of the pane it sizes). `edge` says which side that pane is on
 * ('left' for the one before, above too), so dragging moves the right way.
 */
export function Splitter({
  label,
  value,
  min,
  max,
  defaultValue,
  edge = 'left',
  orientation = 'vertical',
  onChange
}: {
  label: string
  value: number
  min: number
  max: number
  defaultValue: number
  edge?: 'left' | 'right'
  orientation?: 'vertical' | 'horizontal'
  onChange: (v: number) => void
}): React.JSX.Element {
  const start = useRef<{ x: number; v: number } | null>(null)
  const clamp = (v: number): number => Math.min(max, Math.max(min, v))
  const dir = edge === 'left' ? 1 : -1
  const across = orientation === 'horizontal'
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      tabIndex={0}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        start.current = { x: across ? e.clientY : e.clientX, v: value }
      }}
      onPointerMove={(e) => {
        if (start.current) onChange(clamp(start.current.v + dir * ((across ? e.clientY : e.clientX) - start.current.x)))
      }}
      onPointerUp={() => (start.current = null)}
      onKeyDown={(e) => {
        const step = (across ? { ArrowUp: -16 * dir, ArrowDown: 16 * dir } : { ArrowLeft: -16 * dir, ArrowRight: 16 * dir }) as Record<string, number>
        if (e.key in step) onChange(clamp(value + step[e.key]))
        else if (e.key === 'Home') onChange(min)
        else if (e.key === 'End') onChange(max)
        else if (e.key === 'Enter') onChange(defaultValue)
        else return
        e.preventDefault()
      }}
      className={cn(
        'group relative shrink-0 bg-border outline-none',
        across
          ? 'h-px cursor-row-resize before:absolute before:inset-x-0 before:-top-0.75 before:h-1.75 before:content-[""]'
          : 'w-px cursor-col-resize before:absolute before:inset-y-0 before:-left-0.75 before:w-1.75 before:content-[""]'
      )}
    >
      <div
        className={cn(
          'absolute bg-accent opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 group-active:opacity-100',
          across ? 'inset-x-0 -top-px h-0.75' : 'inset-y-0 -left-px w-0.75'
        )}
      />
    </div>
  )
}

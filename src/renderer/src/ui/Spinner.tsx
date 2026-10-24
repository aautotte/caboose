import { cn } from './cn'

export function Spinner({ size = 16, className }: { size?: number; className?: string }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden="true"
      className={cn('shrink-0 animate-spin text-accent motion-reduce:animate-none', className)}
    >
      <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeOpacity=".25" strokeWidth="2" />
      <path d="M14.5 8A6.5 6.5 0 0 0 8 1.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

/** value 0-100 for determinate, undefined for indeterminate. */
export function ProgressBar({ value, label }: { value?: number; label: string }): React.JSX.Element {
  const known = typeof value === 'number'
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={known ? 0 : undefined}
      aria-valuemax={known ? 100 : undefined}
      aria-valuenow={known ? Math.round(value) : undefined}
      className="relative h-1 w-full overflow-hidden rounded-pill bg-surface-sunken"
    >
      <div
        className={cn(
          'absolute inset-y-0 left-0 rounded-pill bg-accent',
          !known && 'w-1/3 animate-[gc-indeterminate_1.2s_ease-in-out_infinite] motion-reduce:animate-none'
        )}
        style={known ? { width: `${Math.min(100, Math.max(0, value))}%` } : undefined}
      />
    </div>
  )
}

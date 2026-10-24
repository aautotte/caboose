import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cn } from './cn'
import { Spinner } from './Spinner'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

const variants: Record<Variant, string> = {
  primary: 'bg-accent text-on-accent enabled:hover:bg-accent-hover',
  secondary: 'bg-surface-raised text-text border border-border enabled:hover:bg-row-hover',
  ghost: 'bg-transparent text-text enabled:hover:bg-row-hover',
  danger: 'bg-danger-solid text-on-danger enabled:hover:brightness-110'
}

const sizes: Record<Size, string> = {
  sm: 'h-6 px-2 text-sm gap-1',
  md: 'h-7 px-3 text-base font-medium gap-1.5',
  lg: 'h-8 px-4 text-md gap-2'
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  icon?: ReactNode
  loading?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, loading = false, disabled, className, children, onClick, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type="button"
      {...rest}
      disabled={disabled}
      aria-busy={loading || undefined}
      onClick={loading ? undefined : onClick}
      className={cn(
        'inline-flex select-none items-center justify-center whitespace-nowrap rounded-md transition-colors duration-(--gc-motion-fast)',
        'active:translate-y-px disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-disabled disabled:border-border',
        variants[variant],
        sizes[size],
        loading && 'cursor-progress',
        className
      )}
    >
      {loading ? <Spinner size={size === 'lg' ? 16 : 14} className="text-current" /> : icon}
      {children}
    </button>
  )
})

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  size?: 'sm' | 'md'
  pressed?: boolean
  children: ReactNode
}

/** Icon-only button. `label` becomes aria-label; wrap in <Tooltip> to show it. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, size = 'md', pressed, className, children, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      {...rest}
      className={cn(
        'inline-flex items-center justify-center rounded-md text-muted transition-colors duration-(--gc-motion-fast)',
        'enabled:hover:bg-row-hover enabled:hover:text-text disabled:cursor-not-allowed disabled:text-disabled',
        pressed && 'bg-row-selected text-text',
        size === 'sm' ? 'size-6' : 'size-7',
        className
      )}
    >
      {children}
    </button>
  )
})

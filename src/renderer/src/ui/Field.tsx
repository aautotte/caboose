import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react'
import { Search, X } from 'lucide-react'
import { cn } from './cn'

const control =
  'w-full rounded-sm border border-input bg-surface-sunken text-base text-text placeholder:text-muted ' +
  'hover:border-text-muted focus:border-accent focus:outline-2 focus:outline-focus-ring focus:outline-offset-0 ' +
  'disabled:cursor-not-allowed disabled:text-disabled disabled:border-border read-only:bg-surface ' +
  'aria-invalid:border-danger'

export interface TextInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: 'sm' | 'md'
  variant?: 'default' | 'search' | 'inline'
  onClear?: () => void
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { size = 'md', variant = 'default', onClear, className, ...rest },
  ref
) {
  const input = (
    <input
      ref={ref}
      {...rest}
      className={cn(
        control,
        size === 'sm' ? 'h-6 px-1.5' : 'h-7 px-2',
        variant === 'search' && 'pl-7 pr-7',
        variant === 'inline' && 'border-transparent bg-transparent hover:border-border focus:bg-surface-sunken',
        className
      )}
    />
  )
  if (variant !== 'search') return input
  return (
    <div className="relative w-full">
      <Search size={14} aria-hidden className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-muted" />
      {input}
      {onClear && rest.value ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={onClear}
          className="absolute top-1/2 right-1.5 grid size-5 -translate-y-1/2 place-items-center rounded-sm text-muted hover:bg-row-hover hover:text-text"
        >
          <X size={12} />
        </button>
      ) : null}
    </div>
  )
})

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function TextArea(
  { className, rows = 3, ...rest },
  ref
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      {...rest}
      className={cn(control, 'field-sizing-content max-h-[calc(12lh+(--spacing(3)))] min-h-[calc(3lh+(--spacing(3)))] resize-y px-2 py-1.5', className)}
    />
  )
})

/** Label + control + help/error, wired with ids for screen readers. */
export function Field({
  label,
  help,
  error,
  children
}: {
  label: string
  help?: string
  error?: string
  children: (props: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => ReactNode
}): React.JSX.Element {
  const id = useId()
  const describedBy = error ? `${id}-err` : help ? `${id}-help` : undefined
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-text">
        {label}
      </label>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {error ? (
        <p id={`${id}-err`} className="text-sm text-danger">
          {error}
        </p>
      ) : help ? (
        <p id={`${id}-help`} className="text-sm text-muted">
          {help}
        </p>
      ) : null}
    </div>
  )
}

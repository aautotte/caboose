import { Checkbox as RCheckbox, Switch as RSwitch, Select as RSelect, ToggleGroup } from 'radix-ui'
import { Check, ChevronDown, Minus } from 'lucide-react'
import { useId, type ReactNode } from 'react'
import { cn } from './cn'

export function Checkbox({
  label,
  checked,
  onCheckedChange,
  disabled
}: {
  label: ReactNode
  checked: boolean | 'indeterminate'
  onCheckedChange: (v: boolean) => void
  disabled?: boolean
}): React.JSX.Element {
  const id = useId()
  return (
    <div className="flex items-center gap-2">
      <RCheckbox.Root
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(v) => onCheckedChange(v === true)}
        className={cn(
          'grid size-3.5 shrink-0 place-items-center rounded-sm border border-input bg-surface-sunken',
          'data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=indeterminate]:border-accent data-[state=indeterminate]:bg-accent',
          'disabled:cursor-not-allowed disabled:opacity-50'
        )}
      >
        <RCheckbox.Indicator className="text-on-accent">
          {checked === 'indeterminate' ? <Minus size={11} strokeWidth={3} /> : <Check size={11} strokeWidth={3} />}
        </RCheckbox.Indicator>
      </RCheckbox.Root>
      <label htmlFor={id} className={cn('text-base select-none', disabled ? 'text-disabled' : 'text-text')}>
        {label}
      </label>
    </div>
  )
}

export function Switch({
  label,
  checked,
  onCheckedChange,
  disabled,
  hideLabel = false
}: {
  label: string
  checked: boolean
  onCheckedChange: (v: boolean) => void
  disabled?: boolean
  /** The row around it already shows the label; keep it for screen readers only. */
  hideLabel?: boolean
}): React.JSX.Element {
  const id = useId()
  return (
    <div className="relative flex items-center gap-2">
      <RSwitch.Root
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
        className={cn(
          'relative h-4 w-7 shrink-0 rounded-pill border border-input bg-surface-sunken transition-colors duration-(--gc-motion-fast)',
          'data-[state=checked]:border-accent data-[state=checked]:bg-accent disabled:cursor-not-allowed disabled:opacity-50'
        )}
      >
        <RSwitch.Thumb
          className={cn(
            'block size-2.5 translate-x-0.5 rounded-pill bg-text-muted transition-transform duration-(--gc-motion-fast)',
            'data-[state=checked]:translate-x-3.25 data-[state=checked]:bg-on-accent'
          )}
        />
      </RSwitch.Root>
      <label htmlFor={id} className={cn('text-base select-none', disabled ? 'text-disabled' : 'text-text', hideLabel && 'sr-only')}>
        {label}
      </label>
    </div>
  )
}

export function Select({
  label,
  value,
  onValueChange,
  options,
  disabled
}: {
  label: string
  value: string
  onValueChange: (v: string) => void
  options: Array<{ value: string; label: string }>
  disabled?: boolean
}): React.JSX.Element {
  return (
    <RSelect.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <RSelect.Trigger
        aria-label={label}
        className={cn(
          'inline-flex h-7 min-w-36 items-center justify-between gap-2 rounded-md border border-border bg-surface-raised px-2.5 text-base text-text',
          'hover:bg-row-hover disabled:cursor-not-allowed disabled:text-disabled'
        )}
      >
        <RSelect.Value />
        <RSelect.Icon>
          <ChevronDown size={14} className="text-muted" />
        </RSelect.Icon>
      </RSelect.Trigger>
      <RSelect.Portal>
        <RSelect.Content
          position="popper"
          sideOffset={4}
          className="z-(--gc-z-dropdown) min-w-(--radix-select-trigger-width) rounded-md border border-border bg-surface-raised p-1 shadow-pop"
        >
          <RSelect.Viewport>
            {options.map((o) => (
              <RSelect.Item
                key={o.value}
                value={o.value}
                className="flex h-7 cursor-default items-center justify-between gap-4 rounded-sm px-2 text-base text-text outline-none select-none data-highlighted:bg-row-selected"
              >
                <RSelect.ItemText>{o.label}</RSelect.ItemText>
                <RSelect.ItemIndicator>
                  <Check size={14} className="text-accent-text" />
                </RSelect.ItemIndicator>
              </RSelect.Item>
            ))}
          </RSelect.Viewport>
        </RSelect.Content>
      </RSelect.Portal>
    </RSelect.Root>
  )
}

export function SegmentedControl<T extends string>({
  label,
  value,
  onValueChange,
  options
}: {
  label: string
  value: T
  onValueChange: (v: T) => void
  options: Array<{ value: T; label: string }>
}): React.JSX.Element {
  return (
    <ToggleGroup.Root
      type="single"
      aria-label={label}
      value={value}
      onValueChange={(v) => v && onValueChange(v as T)}
      className="inline-flex h-6 shrink-0 items-center rounded-md bg-surface-sunken p-0.5"
    >
      {options.map((o) => (
        <ToggleGroup.Item
          key={o.value}
          value={o.value}
          className={cn(
            'h-5 rounded-sm border border-transparent px-2.5 text-sm whitespace-nowrap text-muted hover:text-text',
            'data-[state=on]:border-border data-[state=on]:bg-surface-raised data-[state=on]:text-text'
          )}
        >
          {o.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  )
}

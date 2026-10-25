import { Tooltip as RTooltip } from 'radix-ui'
import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from './cn'

export function Kbd({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <kbd className="inline-flex h-4 min-w-4 items-center justify-center rounded-sm border border-border bg-surface-sunken px-1 font-mono text-xs text-muted">
      {children}
    </kbd>
  )
}

/** Shortcut like "Ctrl+Shift+S" rendered as separate key caps. */
export function Shortcut({ keys }: { keys: string }): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={keys}>
      {keys.split('+').map((k) => (
        <Kbd key={k}>{k}</Kbd>
      ))}
    </span>
  )
}

type Tone = 'neutral' | 'accent' | 'danger' | 'success' | 'warning'
const tones: Record<Tone, string> = {
  neutral: 'bg-surface-raised text-muted border-border',
  accent: 'bg-row-selected text-accent-text border-transparent',
  danger: 'bg-surface-raised text-danger border-danger/40',
  success: 'bg-surface-raised text-success border-success/40',
  warning: 'bg-surface-raised text-warning border-warning/40'
}

export function Badge({ tone = 'neutral', children, label }: { tone?: Tone; children: ReactNode; label?: string }): React.JSX.Element {
  return (
    <span
      aria-label={label}
      className={cn('inline-flex h-4 shrink-0 items-center gap-0.5 rounded-pill border px-1.5 text-xs whitespace-nowrap tabular-nums', tones[tone])}
    >
      {children}
    </span>
  )
}

export const TooltipProvider = RTooltip.Provider

export function Tooltip({
  content,
  shortcut,
  side,
  children
}: {
  content: string
  shortcut?: string
  /** Where it opens; Radix picks above or below by default. */
  side?: 'top' | 'right' | 'bottom' | 'left'
  children: ReactNode
}): React.JSX.Element {
  return (
    <RTooltip.Root>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content
          side={side}
          sideOffset={6}
          className="z-(--gc-z-tooltip) flex max-w-80 items-center gap-2 rounded-sm border border-border bg-surface-raised px-2 py-1 text-sm text-text shadow-pop"
        >
          {content}
          {shortcut ? <Shortcut keys={shortcut} /> : null}
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  )
}

function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : (parts[0]?.[1] ?? ''))).toUpperCase()
}

/** Initials on a lane-coloured circle. Decorative when the name is shown next to it. */
export function Avatar({
  name,
  email,
  size = 18,
  decorative = false
}: {
  name: string
  email: string
  size?: 18 | 28
  decorative?: boolean
}): React.JSX.Element {
  const lane = hash(email.toLowerCase()) % 8
  return (
    <span
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : name}
      aria-hidden={decorative || undefined}
      className={cn('inline-grid shrink-0 place-items-center rounded-pill font-semibold text-on-lane', size === 18 ? 'text-2xs' : 'text-xs')}
      style={{ width: size, height: size, background: `var(--gc-color-lane-${lane})` }}
    >
      {initials(name)}
    </span>
  )
}

export function EmptyState({
  icon: Icon,
  title,
  body,
  actions
}: {
  icon: LucideIcon
  title: string
  body?: string
  actions?: ReactNode
}): React.JSX.Element {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      <Icon size={32} strokeWidth={1.5} className="text-muted" aria-hidden />
      <p className="text-md text-text">{title}</p>
      {body ? <p className="max-w-80 text-base text-muted">{body}</p> : null}
      {actions ? <div className="mt-2 flex gap-2">{actions}</div> : null}
    </div>
  )
}

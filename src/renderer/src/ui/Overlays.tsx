import { ContextMenu as RContext, Dialog as RDialog, DropdownMenu as RMenu, Toast as RToast } from 'radix-ui'
import { X } from 'lucide-react'
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from './Button'
import { setToastHandler } from './toastBus'
import { Shortcut } from './Display'
import { Checkbox } from './Controls'
import { cn } from './cn'

/* ---------- Menus ---------- */

export type MenuEntry =
  | { type: 'item'; label: string; icon?: ReactNode; shortcut?: string; danger?: boolean; disabled?: boolean; onSelect?: () => void }
  | { type: 'separator' }
  | { type: 'sub'; label: string; icon?: ReactNode; items: MenuEntry[] }

const menuPanel = 'z-(--gc-z-dropdown) min-w-50 rounded-md border border-border bg-surface-raised p-1 shadow-pop'
const menuItem =
  'flex h-7 cursor-default items-center gap-2 rounded-sm px-2 text-base outline-none select-none ' +
  'data-highlighted:bg-row-selected data-disabled:text-disabled data-[state=open]:bg-row-selected'

type MenuParts = typeof RMenu | typeof RContext


function renderEntries(P: MenuParts, entries: MenuEntry[]): ReactNode {
  return entries.map((e, i) => {
    if (e.type === 'separator') return <P.Separator key={i} className="my-1 h-px bg-border" />
    if (e.type === 'sub')
      return (
        <P.Sub key={i}>
          <P.SubTrigger className={cn(menuItem, 'text-text')}>
            <span className="w-4 text-muted">{e.icon}</span>
            <span className="flex-1">{e.label}</span>
            <span aria-hidden className="text-muted">›</span>
          </P.SubTrigger>
          <P.Portal>
            <P.SubContent className={menuPanel} sideOffset={4}>
              {renderEntries(P, e.items)}
            </P.SubContent>
          </P.Portal>
        </P.Sub>
      )
    return (
      <P.Item key={i} disabled={e.disabled} onSelect={e.onSelect} className={cn(menuItem, e.danger ? 'text-danger' : 'text-text')}>
        <span className={cn('w-4', e.danger ? 'text-danger' : 'text-muted')}>{e.icon}</span>
        <span className="flex-1">{e.label}</span>
        {e.shortcut ? <Shortcut keys={e.shortcut} /> : null}
      </P.Item>
    )
  })
}

export function DropdownMenu({ trigger, items }: { trigger: ReactNode; items: MenuEntry[] }): React.JSX.Element {
  return (
    <RMenu.Root>
      <RMenu.Trigger asChild>{trigger}</RMenu.Trigger>
      <RMenu.Portal>
        <RMenu.Content className={menuPanel} sideOffset={4} align="start">
          {renderEntries(RMenu, items)}
        </RMenu.Content>
      </RMenu.Portal>
    </RMenu.Root>
  )
}

export function ContextMenu({ children, items }: { children: ReactNode; items: MenuEntry[] }): React.JSX.Element {
  return (
    <RContext.Root>
      <RContext.Trigger asChild>{children}</RContext.Trigger>
      <RContext.Portal>
        <RContext.Content className={menuPanel}>{renderEntries(RContext, items)}</RContext.Content>
      </RContext.Portal>
    </RContext.Root>
  )
}

const MenuOffer = createContext<((items: () => MenuEntry[]) => void) | null>(null)

/**
 * One context menu for a long list. A row hands over its items as it's right-clicked (`useMenuOffer`), and they're
 * only built while the menu is open (again on each render, so they follow changes that land while it's open), so a
 * list of thousands of rows doesn't carry a menu per row through every render. A right-click that no row claims
 * shows nothing.
 */
export function SharedContextMenu({ children }: { children: ReactNode }): React.JSX.Element {
  const pending = useRef<(() => MenuEntry[]) | null>(null)
  const [items, setItems] = useState<(() => MenuEntry[]) | null>(null)
  const offer = useCallback((f: () => MenuEntry[]) => {
    pending.current = f
  }, [])
  return (
    <MenuOffer.Provider value={offer}>
      <RContext.Root onOpenChange={(open) => !open && setItems(null)}>
        <RContext.Trigger
          asChild
          onContextMenu={(e) => {
            const f = pending.current
            pending.current = null
            if (f) setItems(() => f)
            else e.preventDefault()
          }}
        >
          {children}
        </RContext.Trigger>
        <RContext.Portal>
          <RContext.Content className={menuPanel}>{items ? renderEntries(RContext, items()) : null}</RContext.Content>
        </RContext.Portal>
      </RContext.Root>
    </MenuOffer.Provider>
  )
}

/**
 * For a row inside a SharedContextMenu: put the result on the row's onContextMenu. The menu calls the row's latest
 * `items`, so it follows the row's data while it's open, as a menu of the row's own would.
 */
export function useMenuOffer(items: () => MenuEntry[]): () => void {
  const offer = useContext(MenuOffer)
  const latest = useRef(items)
  latest.current = items
  return () => offer?.(() => latest.current())
}

/* ---------- Dialogs ---------- */

export function Dialog({
  open,
  onOpenChange,
  title,
  children,
  footer,
  error
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  title: string
  children: ReactNode
  footer: ReactNode
  error?: string
}): React.JSX.Element {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-(--gc-z-modal) bg-scrim/55 [:root[data-theme=light]_&]:bg-scrim/30" />
        <RDialog.Content
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => {
            // A field that asked for focus (autoFocus) has it already, unless the dialog was opened from a menu, which
            // still held the focus then. Rather than the Close button, start on the first text field.
            const box = e.currentTarget as HTMLElement
            if (box.contains(document.activeElement)) return e.preventDefault()
            const field = box.querySelector<HTMLElement>('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([disabled]):not([aria-hidden=true]), textarea:not([disabled])')
            if (field) {
              e.preventDefault()
              field.focus()
            }
          }}
          className="fixed top-1/2 left-1/2 z-(--gc-z-modal) w-(--gc-modal-w) max-w-[calc(100vw-(--spacing(8)))] -translate-x-1/2 -translate-y-1/2 rounded-lg bg-surface-raised p-5 shadow-modal"
        >
          <div className="mb-4 flex items-start justify-between gap-4">
            <RDialog.Title className="text-lg text-text">{title}</RDialog.Title>
            <RDialog.Close aria-label="Close" className="grid size-6 place-items-center rounded-md text-muted hover:bg-row-hover hover:text-text">
              <X size={14} />
            </RDialog.Close>
          </div>
          <div className="flex flex-col gap-3">{children}</div>
          {error ? (
            <p role="alert" className="mt-3 text-base text-danger">
              {error}
            </p>
          ) : null}
          <div className="mt-5 flex justify-end gap-2">{footer}</div>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  )
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  danger = false,
  undoable,
  onConfirm,
  alt,
  check
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  title: string
  body: string
  confirmLabel: string
  danger?: boolean
  /** null: nothing to undo (it only opens or shows something), so neither line is shown. */
  undoable: boolean | null
  /** Gets the checkbox's state, when there is one. */
  onConfirm: (checked: boolean) => void
  /** A checkbox, off by default, e.g. "Also delete them on origin". `hint` shows while it's on. */
  check?: { label: string; hint?: string }
  /** Another way out, e.g. "Create a branch…": the dialog closes first, so it can open another one. */
  alt?: { label: string; onSelect: () => void; danger?: boolean }
}): React.JSX.Element {
  const [checked, setChecked] = useState(false)
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      footer={
        <>
          {/* Cancel gets focus first when the action can't be undone. */}
          <Button autoFocus={undoable === false} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {alt ? (
            <Button
              variant={alt.danger ? 'danger' : undefined}
              onClick={() => {
                onOpenChange(false)
                alt.onSelect()
              }}
            >
              {alt.label}
            </Button>
          ) : null}
          <Button
            autoFocus={undoable !== false}
            variant={danger ? 'danger' : 'primary'}
            onClick={() => {
              onConfirm(checked)
              onOpenChange(false)
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-base text-text">{body}</p>
      {check ? <Checkbox label={check.label} checked={checked} onCheckedChange={setChecked} /> : null}
      {undoable === null ? null : <p className="text-sm text-muted">{undoable ? 'You can undo this with Ctrl+Z.' : 'This can’t be undone.'}{checked && check?.hint ? ` ${check.hint}` : ''}</p>}
    </Dialog>
  )
}

/* ---------- Toasts ---------- */

type ToastTone = 'info' | 'success' | 'error'
interface ToastItem {
  id: number
  tone: ToastTone
  title: string
  body?: string
  action?: { label: string; onClick: () => void }
}

const ToastCtx = createContext<(t: Omit<ToastItem, 'id'>) => void>(() => {})
export const useToast = (): ((t: Omit<ToastItem, 'id'>) => void) => useContext(ToastCtx)

const stripe: Record<ToastTone, string> = { info: 'border-l-info', success: 'border-l-success', error: 'border-l-danger' }

export function ToastProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [items, setItems] = useState<ToastItem[]>([])
  const push = useCallback((t: Omit<ToastItem, 'id'>) => {
    setItems((prev) => [...prev.slice(-2), { ...t, id: Date.now() + Math.random() }])
  }, [])
  useEffect(() => {
    setToastHandler(push)
    return () => setToastHandler(null)
  }, [push])
  return (
    <ToastCtx.Provider value={push}>
      <RToast.Provider swipeDirection="left">
        {children}
        {items.map((t) => (
          <RToast.Root
            key={t.id}
            type={t.tone === 'error' ? 'foreground' : 'background'}
            duration={t.tone === 'error' ? Infinity : 4000}
            onOpenChange={(open) => !open && setItems((prev) => prev.filter((x) => x.id !== t.id))}
            className={cn('flex w-90 gap-3 rounded-md border border-l-(length:--gc-stripe-w) border-border bg-surface-raised p-3 shadow-pop', stripe[t.tone])}
          >
            <div className="flex-1">
              <RToast.Title className="text-base font-medium text-text">{t.title}</RToast.Title>
              {t.body ? <RToast.Description className="mt-0.5 text-sm text-muted">{t.body}</RToast.Description> : null}
              {t.action ? (
                <RToast.Action altText={t.action.label} asChild>
                  <Button size="sm" variant="ghost" className="mt-1 -ml-2 text-accent-text" onClick={t.action.onClick}>
                    {t.action.label}
                  </Button>
                </RToast.Action>
              ) : null}
            </div>
            <RToast.Close aria-label="Dismiss" className="grid size-5 place-items-center rounded-sm text-muted hover:bg-row-hover hover:text-text">
              <X size={12} />
            </RToast.Close>
          </RToast.Root>
        ))}
        {/* Bottom-left, over the lower branch list: the right side holds the commit form, where the next action usually is. */}
        <RToast.Viewport className="fixed bottom-8 left-4 z-(--gc-z-toast) flex flex-col gap-2 outline-none" />
      </RToast.Provider>
    </ToastCtx.Provider>
  )
}

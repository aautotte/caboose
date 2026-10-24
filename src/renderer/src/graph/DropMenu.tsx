import { DropdownMenu as RMenu } from 'radix-ui'
import { GitMerge, GitPullRequestArrow, ListOrdered, Upload } from 'lucide-react'
import * as act from '@/actions'

export interface DropTarget {
  source: string
  sourceKind: string
  target: string
  targetKind: string
  x: number
  y: number
}

const panel = 'z-(--gc-z-dropdown) min-w-60 rounded-md border border-border bg-surface-raised p-1 shadow-pop'
const item =
  'flex h-7 cursor-default items-center gap-2 rounded-sm px-2 text-base text-text outline-none select-none data-highlighted:bg-row-selected data-disabled:text-disabled'

/** The menu that appears where one branch is dropped on another. Same actions exist in the right-click menu. */
export function DropMenu({ repoId, target, headBranch, onClose }: { repoId: string; target: DropTarget; headBranch: string | null; onClose: () => void }): React.JSX.Element {
  const { source, target: dest, targetKind, sourceKind } = target
  const destIsBranch = targetKind === 'local' || targetKind === 'both'
  const srcIsLocal = sourceKind === 'local' || sourceKind === 'both'
  const pushTarget = targetKind === 'remote' && srcIsLocal
  return (
    <RMenu.Root open onOpenChange={(o) => !o && onClose()}>
      <RMenu.Trigger asChild>
        <span aria-hidden className="fixed size-0" style={{ left: target.x, top: target.y }} />
      </RMenu.Trigger>
      <RMenu.Portal>
        <RMenu.Content className={panel} align="start" sideOffset={2}>
          <RMenu.Label className="px-2 py-1 text-xs text-muted">
            {source} → {dest}
          </RMenu.Label>
          <RMenu.Item className={item} disabled={!destIsBranch} onSelect={() => void act.mergeInto(repoId, source, dest)}>
            <GitMerge size={14} className="text-muted" /> Merge {source} into {dest}
          </RMenu.Item>
          <RMenu.Item className={item} disabled={!srcIsLocal} onSelect={() => void act.rebaseOnto(repoId, source, dest)}>
            <GitPullRequestArrow size={14} className="text-muted" /> Rebase {source} onto {dest}
          </RMenu.Item>
          <RMenu.Item
            className={item}
            disabled={!srcIsLocal}
            onSelect={async () => {
              // The interactive view rewrites the checked-out branch, so switch to it first.
              if (source !== headBranch) await act.checkout(repoId, source)
              act.setCenter(repoId, { kind: 'rebase', onto: dest, ontoLabel: dest })
            }}
          >
            <ListOrdered size={14} className="text-muted" /> Rebase {source} onto {dest} step by step…
          </RMenu.Item>
          {pushTarget ? (
            <RMenu.Item
              className={item}
              onSelect={() => {
                const slash = dest.indexOf('/')
                void act.push(repoId, { remote: dest.slice(0, slash), branch: source })
              }}
            >
              <Upload size={14} className="text-muted" /> Push {source} to {dest.slice(0, dest.indexOf('/'))}
            </RMenu.Item>
          ) : null}
        </RMenu.Content>
      </RMenu.Portal>
    </RMenu.Root>
  )
}

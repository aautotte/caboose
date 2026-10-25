import { AlertTriangle } from 'lucide-react'
import { Button } from '@/ui'
import { useRepo } from '@/store'
import * as act from '@/actions'

/**
 * Under the toolbar when this repository keeps large files in Git LFS and the system git can't run it: without LFS,
 * those files check out as small pointer files and new ones commit whole, both without a word from git.
 */
export function LfsNotice({ repoId }: { repoId: string }): React.JSX.Element | null {
  const lfs = useRepo(repoId, (r) => r.lfs)
  const dismissed = useRepo(repoId, (r) => r.lfsDismissed)
  const busy = useRepo(repoId, (r) => r.busy.op)
  if (!lfs?.uses || (lfs.installed && lfs.on) || dismissed) return null
  return (
    <div role="status" aria-label="Git LFS" className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-surface-raised px-3 py-1.5 text-sm">
      <AlertTriangle size={14} aria-hidden className="shrink-0 text-warning" />
      <span className="min-w-0 flex-1">
        {lfs.installed
          ? 'This repository keeps large files in Git LFS, but LFS isn’t turned on in your Git. Large files show as small pointer files, and new ones would be committed whole.'
          : 'This repository keeps large files in Git LFS, which isn’t installed. Large files show as small pointer files, and new ones would be committed whole.'}
      </span>
      {lfs.installed ? (
        <Button size="sm" variant="primary" loading={busy === 'Turning on Git LFS'} disabled={!!busy} title="Runs git lfs install (for all your repositories), then git lfs pull here" onClick={() => void act.turnOnLfs(repoId)}>
          Turn on Git LFS
        </Button>
      ) : (
        <>
          <a href="https://git-lfs.com" target="_blank" rel="noreferrer" className="text-accent underline-offset-2 hover:underline">
            Get Git LFS
          </a>
          <Button size="sm" onClick={() => void act.checkLfs(repoId)}>
            Check again
          </Button>
        </>
      )}
      <Button size="sm" variant="ghost" onClick={() => act.dismissLfs(repoId)}>
        Not now
      </Button>
    </div>
  )
}

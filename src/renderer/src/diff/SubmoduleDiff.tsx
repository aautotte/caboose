import { AlertTriangle, Boxes } from 'lucide-react'
import type { DiffSource, SubmoduleChange } from '../../../shared/types'
import { Button } from '@/ui'
import { plural, shortSha } from '@/lib/format'
import { useRepo } from '@/store'
import * as act from '@/actions'

/** The headline: which way the pointer moves, and by how much. */
function headline(c: SubmoduleChange): string {
  switch (c.direction) {
    case 'forward':
      return `Moves forward ${plural(c.ahead, 'commit')}`
    case 'back':
      return `Moves back ${plural(c.behind, 'commit')}`
    case 'diverged':
      return `Moves to another line: ${c.ahead} ahead, ${c.behind} behind`
    case 'same':
      return c.dirty ? 'Has changes inside' : 'Same commit'
    case 'added':
      return `Submodule added at ${shortSha(c.new ?? '')}`
    case 'removed':
      return `Submodule removed (was at ${shortSha(c.old ?? '')})`
    default:
      return `Points at ${shortSha(c.new ?? '')} instead of ${shortSha(c.old ?? '')}`
  }
}

/**
 * A submodule's diff: instead of git's two "Subproject commit" lines, which way it moves and the commits in between,
 * read in the submodule's own history. Moving back gets a warning and the way out.
 */
export function SubmoduleDiff({ repoId, path, change: c, source }: { repoId: string; path: string; change: SubmoduleChange; source: DiffSource }): React.JSX.Element {
  const setUp = useRepo(repoId, (r) => r.submodules?.list.find((m) => m.path === path)?.setUp ?? false)
  const running = useRepo(repoId, (r) => !!r.subOp)
  const more = (c.direction === 'back' ? c.behind : c.ahead) - c.commits.length
  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-start gap-3">
        <Boxes size={20} className="mt-0.5 shrink-0 text-muted" aria-hidden />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-md text-text">{headline(c)}</p>
          {c.old && c.new && c.old !== c.new ? (
            <p className="font-mono text-sm text-muted">
              {shortSha(c.old)} → {shortSha(c.new)}
            </p>
          ) : null}
          {c.reason === 'not set up' ? <p className="text-sm text-muted">The submodule isn’t set up here, so its commits can’t be listed.</p> : null}
          {c.reason === 'missing commits' ? <p className="text-sm text-muted">This copy of the submodule doesn’t have both commits yet, so they can’t be compared. Fetch inside it to see them.</p> : null}
          {c.dirty ? <p className="text-sm text-muted">It also has changes inside that aren’t committed there.</p> : null}
        </div>
      </div>

      {c.direction === 'back' && source.kind !== 'commit' ? (
        <div role="alert" className="flex flex-col gap-2 rounded-md border border-l-(length:--gc-stripe-w) border-border border-l-warning bg-surface-raised p-3">
          <p className="flex items-start gap-2 text-base text-text">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warning" aria-hidden />
            {source.kind === 'worktree'
              ? 'The submodule is on an older commit than this repository records. Staging this would move the pointer back and undo the commits below. Usually that means it wasn’t updated after a pull or a branch switch.'
              : 'Committing this moves the pointer back and undoes the commits below. Usually that means the submodule wasn’t updated after a pull or a branch switch.'}
          </p>
          <div className="flex gap-2">
            {source.kind === 'worktree' ? (
              <Button size="sm" variant="primary" disabled={running || c.dirty} onClick={() => void act.updateSubmodules(repoId, [path])}>
                Update to the expected commit
              </Button>
            ) : (
              <Button size="sm" onClick={() => void act.unstage(repoId, [path])}>
                Unstage it
              </Button>
            )}
          </div>
        </div>
      ) : null}

      {c.commits.length ? (
        <section aria-label={c.direction === 'back' ? 'Commits it takes away' : 'Commits it brings'} className="flex flex-col">
          <h3 className="pb-1 text-sm font-medium text-muted">{c.direction === 'back' ? 'Commits it takes away' : 'Commits it brings'}</h3>
          <ul className="flex flex-col">
            {c.commits.map((k) => (
              <li key={k.sha} className="flex h-(--gc-list-row-h) items-center gap-3 border-b border-border text-base">
                <span className="shrink-0 font-mono text-sm text-muted">{shortSha(k.sha)}</span>
                <span className="min-w-0 flex-1 truncate text-text">{k.summary}</span>
                <span className="shrink-0 text-sm text-muted">{k.author}</span>
              </li>
            ))}
          </ul>
          {more > 0 ? <p className="pt-1 text-sm text-muted">and {plural(more, 'more commit')}</p> : null}
        </section>
      ) : null}

      {setUp ? (
        <div>
          <Button size="sm" onClick={() => void act.openSubmodule(repoId, path)}>
            Open the submodule
          </Button>
        </div>
      ) : c.reason === 'not set up' ? (
        <div>
          <Button size="sm" disabled={running} onClick={() => void act.setUpSubmodules(repoId, [path])}>
            Set up
          </Button>
        </div>
      ) : null}
    </div>
  )
}

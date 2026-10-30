import { FolderX, MousePointerClick } from 'lucide-react'
import { Button, EmptyState, Splitter } from '@/ui'
import { setPrefs, useApp, useRepo } from '@/store'
import * as act from '@/actions'
import { GraphView } from '@/graph/GraphView'
import { DiffView } from '@/diff/DiffView'
import { MergeTool } from '@/merge/MergeTool'
import { ActivityLog } from '@/log/ActivityLog'
import { PrefsView } from '@/screens/PrefsView'
import { BlameView } from '@/history/BlameView'
import { FileHistoryView } from '@/history/FileHistoryView'
import { RebaseView } from '@/history/RebaseView'
import { ReflogView } from '@/history/ReflogView'
import { CompareView } from '@/history/CompareView'
import { WipPanel } from '@/detail/WipPanel'
import { CommitPanel } from '@/detail/CommitPanel'
import { MultiPanel } from '@/detail/MultiPanel'
import { Toolbar } from './Toolbar'
import { LeftPanel } from './LeftPanel'
import { StatusBar } from './StatusBar'
import { CollapseDetailsButton, DetailRail, LeftRail } from './PanelRails'
import { LfsNotice } from './LfsNotice'
import { BisectBar } from './BisectBar'

/** S04: toolbar, branches on the left, history in the middle, details on the right. */
export function RepoView({ repoId }: { repoId: string }): React.JSX.Element {
  const center = useRepo(repoId, (r) => r.center)
  const selected = useRepo(repoId, (r) => r.selected)
  const multi = useRepo(repoId, (r) => r.multi)
  const loadError = useRepo(repoId, (r) => r.loadError)
  const hasRefs = useRepo(repoId, (r) => r.refs !== null)
  // A full-width diff hides both side panels, rails too; closing the diff brings them back.
  const wideDiff = useApp((s) => s.diffWide) && center.kind === 'diff'
  const leftCollapsed = useApp((s) => s.prefs.leftCollapsed)
  const detailCollapsed = useApp((s) => s.prefs.detailCollapsed)
  const leftWidth = useApp((s) => s.prefs.leftWidth)
  const detailWidth = useApp((s) => s.prefs.detailWidth)
  const tab = useApp((s) => s.tabs.find((t) => t.id === repoId))

  if (loadError && !hasRefs) {
    return (
      <div className="grid flex-1 place-items-center">
        <EmptyState
          icon={FolderX}
          title="Couldn’t read this repository"
          body={loadError}
          actions={
            <>
              <Button variant="primary" onClick={() => void act.loadRepo(repoId)}>
                Try again
              </Button>
              <Button onClick={() => void act.closeTab(repoId)}>Close tab</Button>
            </>
          }
        />
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <main aria-label={tab?.alias ?? tab?.name ?? 'Repository'} className="flex min-h-0 flex-1 flex-col">
      <Toolbar repoId={repoId} />
      <LfsNotice repoId={repoId} />
      <BisectBar repoId={repoId} />
      <div className="flex min-h-0 flex-1">
        {wideDiff ? null : leftCollapsed ? (
          <LeftRail repoId={repoId} />
        ) : (
          <>
            <LeftPanel repoId={repoId} width={leftWidth} />
            <Splitter label="Resize the branches panel" value={leftWidth} min={180} max={480} defaultValue={240} onChange={(v) => setPrefs({ leftWidth: v })} />
          </>
        )}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {center.kind === 'graph' ? (
            <GraphView repoId={repoId} />
          ) : center.kind === 'diff' ? (
            <DiffView repoId={repoId} path={center.path} oldPath={center.oldPath} source={center.source} />
          ) : center.kind === 'merge' ? (
            <MergeTool repoId={repoId} path={center.path} />
          ) : center.kind === 'log' ? (
            <ActivityLog repoId={repoId} />
          ) : center.kind === 'blame' ? (
            <BlameView key={`${center.path}@${center.rev}`} repoId={repoId} path={center.path} rev={center.rev} />
          ) : center.kind === 'history' ? (
            <FileHistoryView key={center.path} repoId={repoId} path={center.path} />
          ) : center.kind === 'rebase' ? (
            <RebaseView key={`${center.onto}:${center.range?.join(',') ?? ''}`} repoId={repoId} mode="rebase" base={center.onto} baseLabel={center.ontoLabel} range={center.range} ontoBranch={center.ontoBranch} />
          ) : center.kind === 'cherry' ? (
            <RebaseView key={center.tip} repoId={repoId} mode="cherry" base={center.tip} baseLabel={center.tipLabel} />
          ) : center.kind === 'reflog' ? (
            <ReflogView repoId={repoId} />
          ) : center.kind === 'compare' ? (
            <CompareView key={`${center.base}..${center.target}`} repoId={repoId} base={center.base} target={center.target} baseLabel={center.baseLabel} targetLabel={center.targetLabel} />
          ) : (
            <PrefsView repoId={repoId} />
          )}
        </div>
        {wideDiff ? null : detailCollapsed ? (
          <DetailRail />
        ) : (
          <>
            <Splitter label="Resize the details panel" edge="right" value={detailWidth} min={300} max={720} defaultValue={380} onChange={(v) => setPrefs({ detailWidth: v })} />
            <section aria-label="Details" className="flex min-h-0 shrink-0 flex-col bg-surface" style={{ width: detailWidth }}>
              {multi.length > 1 ? (
                <MultiPanel repoId={repoId} shas={multi} />
              ) : selected === 'wip' ? (
                <WipPanel repoId={repoId} />
              ) : selected ? (
                <CommitPanel repoId={repoId} sha={selected} />
              ) : (
                <>
                  <header className="flex h-10 shrink-0 items-center px-3">
                    <CollapseDetailsButton />
                  </header>
                  <div className="grid flex-1 place-items-center">
                    <EmptyState icon={MousePointerClick} title="Pick something" body="Click a commit to see what changed, or the top row to work on your own changes." />
                  </div>
                </>
              )}
            </section>
          </>
        )}
      </div>
      </main>
      <StatusBar repoId={repoId} />
    </div>
  )
}

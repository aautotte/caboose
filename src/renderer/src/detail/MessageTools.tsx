import { useEffect, useMemo, useState } from 'react'
import { History, UserPlus, WrapText } from 'lucide-react'
import { Button, DropdownMenu, Tooltip, type MenuEntry } from '@/ui'
import { call } from '@/lib/api'
import { addCoAuthor, wrapMessage } from '@/lib/message'
import { useApp, useRepo } from '@/store'
import { toast } from '@/ui/toastBus'
import * as act from '@/actions'

const RECENT = 15
const PEOPLE = 12

/**
 * Under the commit message: start from a recent message, add a co-author (a Co-authored-by trailer), and wrap the
 * description at 72 characters.
 */
export function MessageTools({ repoId }: { repoId: string }): React.JSX.Element {
  const draft = useRepo(repoId, (r) => r.draft)
  const head = useRepo(repoId, (r) => r.refs?.head.sha)
  const commits = useRepo(repoId, (r) => r.commits)
  const [recent, setRecent] = useState<{ summary: string; body: string }[] | null>(null)

  // Asked again after each commit: the newest message is the one just written.
  useEffect(() => {
    let live = true
    call('commit.recentMessages', { repoId, limit: RECENT })
      .then((m) => live && setRecent(m))
      .catch(() => live && setRecent([]))
    return () => {
      live = false
    }
  }, [repoId, head])

  // The people in the history, the most recent first, once each; not those already on the message.
  const people = useMemo(() => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const c of commits) {
      const email = c.authorEmail?.toLowerCase()
      if (c.kind !== 'commit' || !email || seen.has(email)) continue
      seen.add(email)
      out.push(`${c.authorName} <${c.authorEmail}>`)
      if (out.length === PEOPLE * 2) break
    }
    return out
  }, [commits])
  const shown = people.filter((p) => addCoAuthor(draft.body, p) !== draft.body).slice(0, PEOPLE)

  const useMessage = (m: { summary: string; body: string }): void => {
    const was = { summary: draft.summary, body: draft.body }
    act.setDraft(repoId, m)
    if ((was.summary.trim() || was.body.trim()) && (was.summary !== m.summary || was.body !== m.body)) {
      toast({ tone: 'info', title: 'Replaced your message', action: { label: 'Put it back', onClick: () => act.setDraft(repoId, was) } })
    }
  }
  const recentItems: MenuEntry[] = recent?.length
    ? recent.map((m) => ({ type: 'item', label: m.summary.length > 60 ? `${m.summary.slice(0, 59)}…` : m.summary, onSelect: () => useMessage(m) }))
    : [{ type: 'item', label: recent ? 'No messages on this branch yet' : 'Loading…', disabled: true }]
  const peopleItems: MenuEntry[] = [
    ...shown.map((p) => ({ type: 'item' as const, label: p, onSelect: () => act.setDraft(repoId, { body: addCoAuthor(useApp.getState().repos[repoId]?.draft.body ?? '', p) }) })),
    ...(shown.length ? [{ type: 'separator' as const }] : []),
    { type: 'item', label: 'Someone else…', onSelect: () => act.openDialog({ kind: 'author', repoId, shas: [], mode: 'draft' }) }
  ]
  const wrapped = wrapMessage(draft.body)

  return (
    <div className="flex flex-wrap gap-1">
      <DropdownMenu
        trigger={
          <Button size="sm" variant="ghost" aria-label="Use a recent message">
            <History size={14} aria-hidden />
            Recent
          </Button>
        }
        items={recentItems}
      />
      <DropdownMenu
        trigger={
          <Button size="sm" variant="ghost" aria-label="Add a co-author">
            <UserPlus size={14} aria-hidden />
            Co-author
          </Button>
        }
        items={peopleItems}
      />
      <Tooltip content="Wrap the description at 72 characters, as git log shows best">
        <Button size="sm" variant="ghost" aria-label="Wrap the description at 72 characters" disabled={!draft.body.trim() || wrapped === draft.body} onClick={() => act.setDraft(repoId, { body: wrapped })}>
          <WrapText size={14} aria-hidden />
          Wrap
        </Button>
      </Tooltip>
    </div>
  )
}

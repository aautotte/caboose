import { useEffect, useMemo, useState } from 'react'
import type { FlowConfig, FlowKind } from '../../../shared/types'
import { Button, Dialog, Field, Select, Switch, TextInput } from '@/ui'
import { useApp, type Dialog as D } from '@/store'
import * as act from '@/actions'
import { call } from '@/lib/api'

const close = (): void => act.closeDialog()
const NOUN: Record<FlowKind, string> = { feature: 'feature', release: 'release', hotfix: 'hotfix' }

/** Git Flow's settings: which branches are production and develop, and the prefixes. Also changes them later. */
export function FlowInitDialog({ d }: { d: Extract<D, { kind: 'flowInit' }> }): React.JSX.Element {
  const refs = useApp((s) => s.repos[d.repoId]?.refs)
  const was = useApp((s) => s.repos[d.repoId]?.flow)
  const locals = useMemo(() => refs?.refs.filter((r) => r.kind === 'local').map((r) => r.short) ?? [], [refs])
  const guess = locals.find((b) => b === 'main') ?? locals.find((b) => b === 'master') ?? refs?.head.branch ?? locals[0] ?? 'main'
  const [production, setProduction] = useState(was?.production ?? guess)
  const [develop, setDevelop] = useState(was?.develop ?? 'develop')
  const [prefix, setPrefix] = useState<Record<FlowKind, string>>(was?.prefix ?? { feature: 'feature/', release: 'release/', hotfix: 'hotfix/' })
  const [tagPrefix, setTagPrefix] = useState(was?.tagPrefix ?? '')
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  // Read again as it opens: git-flow, or git config in a terminal, may have changed them since the repository loaded.
  useEffect(() => {
    let live = true
    call('flow.config', { repoId: d.repoId })
      .then((c) => {
        if (!live || !c) return
        setProduction(c.production)
        setDevelop(c.develop)
        setPrefix(c.prefix)
        setTagPrefix(c.tagPrefix)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [d.repoId])
  const problem =
    develop.trim() === production
      ? 'Develop has to be another branch than production.'
      : Object.values(prefix).some((p) => !p.trim())
        ? 'Each kind of branch needs a prefix.'
        : new Set(Object.values(prefix).map((p) => p.trim())).size < 3
          ? 'Features, releases and hotfixes need different prefixes.'
          : undefined
  const submit = async (): Promise<void> => {
    if (problem || !develop.trim() || busy) return
    setBusy(true)
    const config: FlowConfig = {
      production,
      develop: develop.trim(),
      prefix: { feature: prefix.feature.trim(), release: prefix.release.trim(), hotfix: prefix.hotfix.trim() },
      tagPrefix: tagPrefix.trim()
    }
    const err = await act.flowInit(d.repoId, config)
    setBusy(false)
    if (err) setFailed(err)
    else close()
  }
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && close()}
      title={was ? 'Git Flow settings' : 'Set up Git Flow'}
      error={problem ?? failed ?? undefined}
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" disabled={!!problem || !develop.trim()} loading={busy} onClick={() => void submit()}>
            {was ? 'Save' : 'Set up Git Flow'}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <p className="text-sm text-muted">Features start from develop and are merged back into it. Releases and hotfixes are merged into production, tagged with their version, and into develop.</p>
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium text-text">Production branch</span>
          <Select label="Production branch" value={production} onValueChange={setProduction} options={locals.map((b) => ({ value: b, label: b }))} />
        </div>
        <Field label="Develop branch" help={locals.includes(develop.trim()) ? 'Already here.' : `Made from ${production} if it isn’t there yet.`}>
          {(p) => <TextInput {...p} value={develop} onChange={(e) => setDevelop(e.target.value)} />}
        </Field>
        <div className="grid grid-cols-3 gap-2">
          {(['feature', 'release', 'hotfix'] as const).map((k) => (
            <Field key={k} label={`${NOUN[k][0].toUpperCase()}${NOUN[k].slice(1)} prefix`}>
              {(p) => <TextInput {...p} className="font-mono text-sm" value={prefix[k]} onChange={(e) => setPrefix({ ...prefix, [k]: e.target.value })} />}
            </Field>
          ))}
        </div>
        <Field label="Version tag prefix" help="Put in front of a release’s version for its tag: “v” makes v1.2.0. Empty tags it 1.2.0.">
          {(p) => <TextInput {...p} className="font-mono text-sm" value={tagPrefix} onChange={(e) => setTagPrefix(e.target.value)} placeholder="v" />}
        </Field>
        <button type="submit" hidden />
      </form>
    </Dialog>
  )
}

/** A new feature, release or hotfix branch, checked out. */
export function FlowStartDialog({ d }: { d: Extract<D, { kind: 'flowStart' }> }): React.JSX.Element | null {
  const flow = useApp((s) => s.repos[d.repoId]?.flow)
  const refs = useApp((s) => s.repos[d.repoId]?.refs)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  if (!flow) return null
  const kind = d.flowKind
  const branch = `${flow.prefix[kind]}${name.trim()}`
  const base = kind === 'hotfix' ? flow.production : flow.develop
  const exists = !!name.trim() && !!refs?.refs.some((r) => r.kind === 'local' && r.short === branch)
  const problem = /\s/.test(name.trim()) ? 'Use dashes instead of spaces.' : exists ? `${branch} already exists.` : undefined
  const submit = async (): Promise<void> => {
    if (!name.trim() || problem || busy) return
    setBusy(true)
    const err = await act.flowStart(d.repoId, kind, name.trim())
    setBusy(false)
    if (err) setFailed(err)
    else close()
  }
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && close()}
      title={`Start a ${NOUN[kind]}`}
      error={failed ?? undefined}
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" disabled={!name.trim() || !!problem} loading={busy} onClick={() => void submit()}>
            Start {NOUN[kind]}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <Field label={kind === 'feature' ? 'Feature name' : 'Version'} error={problem} help={`Makes ${name.trim() ? branch : `${flow.prefix[kind]}…`} from ${base} and checks it out.`}>
          {(p) => <TextInput {...p} autoFocus value={name} onChange={(e) => (setName(e.target.value), setFailed(null))} placeholder={kind === 'feature' ? 'search-box' : '1.2.0'} />}
        </Field>
        <button type="submit" hidden />
      </form>
    </Dialog>
  )
}

/** Merges the branch where Git Flow says it goes, tags a release or hotfix, and deletes the branch. */
export function FlowFinishDialog({ d }: { d: Extract<D, { kind: 'flowFinish' }> }): React.JSX.Element | null {
  const flow = useApp((s) => s.repos[d.repoId]?.flow)
  const kind = d.flowKind
  const [keep, setKeep] = useState(false)
  const [tagMessage, setTagMessage] = useState(`${kind === 'release' ? 'Release' : 'Hotfix'} ${d.name}`)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  if (!flow) return null
  const branch = `${flow.prefix[kind]}${d.name}`
  const tag = `${flow.tagPrefix}${d.name}`
  const steps =
    kind === 'feature'
      ? [`Merge ${branch} into ${flow.develop}, with a merge commit.`]
      : [`Merge ${branch} into ${flow.production}, with a merge commit.`, `Tag it ${tag}.`, `Merge ${branch} into ${flow.develop} too.`]
  steps.push(keep ? `Keep ${branch}, and check out ${flow.develop}.` : `Delete ${branch}, and check out ${flow.develop}.`)
  const submit = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setFailed(null)
    const err = await act.flowFinish(d.repoId, kind, d.name, keep, tagMessage)
    setBusy(false)
    if (err) setFailed(err)
    else close()
  }
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && close()}
      title={`Finish ${branch}`}
      error={failed ?? undefined}
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>
            Finish {NOUN[kind]}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <ol aria-label="What it does" className="list-decimal pl-5 text-base text-text">
          {steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        {kind !== 'feature' ? (
          <Field label="Tag message">{(p) => <TextInput {...p} value={tagMessage} onChange={(e) => setTagMessage(e.target.value)} />}</Field>
        ) : null}
        <Switch label={`Keep ${branch}`} checked={keep} onCheckedChange={setKeep} />
        <p className="text-sm text-muted">If a merge stops on conflicts, resolve them and commit the merge, then finish again: it picks up where it stopped. Undo doesn’t cover a finish.</p>
      </div>
    </Dialog>
  )
}

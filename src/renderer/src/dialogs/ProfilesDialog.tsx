import { useCallback, useEffect, useState } from 'react'
import { Check, Plus } from 'lucide-react'
import type { Profile, SshKey } from '../../../shared/types'
import { Button, Dialog, Field, Select, TextInput } from '@/ui'
import { cn } from '@/ui/cn'
import { call } from '@/lib/api'
import { type Dialog as D } from '@/store'
import * as act from '@/actions'
import { toast } from '@/ui/toastBus'

const NO_KEY = 'ssh-config'
const emailOk = (e: string): boolean => !e || /^[^\s@<>]+@[^\s@<>]+$/.test(e)

interface Draft {
  name: string
  authorName: string
  authorEmail: string
  signingKey: string
  sshKey: string
}
const toDraft = (p: Profile): Draft => ({
  name: p.name,
  authorName: p.authorName ?? '',
  authorEmail: p.authorEmail ?? '',
  signingKey: p.signingKey ?? '',
  sshKey: p.sshKey ?? NO_KEY
})

/**
 * Profiles: each one keeps its own tabs, recent list and settings, and can commit under its own name and email,
 * sign with its own key and push with its own SSH key. A repository's own Git settings still come first.
 */
export function ProfilesDialog({ d }: { d: Extract<D, { kind: 'profiles' }> }): React.JSX.Element {
  const [list, setList] = useState<Profile[] | null>(null)
  const [sel, setSel] = useState<string | null>(d.edit ?? null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [keys, setKeys] = useState<SshKey[]>([])
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()

  const load = useCallback(async (select?: string): Promise<void> => {
    const all = await call('profile.list', {})
    setList(all)
    void act.loadProfiles()
    const pick = all.find((p) => p.id === (select ?? sel)) ?? all.find((p) => p.isActive) ?? all[0]
    setSel(pick.id)
    setDraft(toDraft(pick))
    // sel is read once per call on purpose: reloading shouldn't depend on it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    load().catch((e: Error) => setError(e.message))
    call('ssh.keys', {})
      .then(setKeys)
      .catch(() => setKeys([]))
  }, [load])

  const current = list?.find((p) => p.id === sel) ?? null
  const pick = (p: Profile): void => {
    setSel(p.id)
    setDraft(toDraft(p))
    setError(undefined)
  }
  const changed = !!current && !!draft && JSON.stringify(toDraft(current)) !== JSON.stringify(draft)
  const badEmail = !!draft && !emailOk(draft.authorEmail.trim())

  const save = async (): Promise<void> => {
    if (!current || !draft || badEmail) return
    setBusy(true)
    setError(undefined)
    try {
      await call('profile.update', {
        id: current.id,
        name: draft.name,
        authorName: draft.authorName,
        authorEmail: draft.authorEmail,
        signingKey: draft.signingKey,
        sshKey: draft.sshKey === NO_KEY ? null : draft.sshKey
      })
      await load(current.id)
      toast({ tone: 'success', title: `Saved the ${draft.name.trim()} profile` })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const create = async (): Promise<void> => {
    if (!newName.trim()) return
    setError(undefined)
    try {
      const p = await call('profile.create', { name: newName })
      setAdding(false)
      setNewName('')
      await load(p.id)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const remove = (p: Profile): void =>
    act.confirm({
      title: `Delete the ${p.name} profile?`,
      body: 'Its tabs, recent list and settings are forgotten. The repositories themselves stay on your disk, untouched.',
      confirmLabel: 'Delete profile',
      danger: true,
      undoable: false,
      onConfirm: () => {
        void call('profile.delete', { id: p.id })
          .then(() => act.loadProfiles())
          .then(() => act.openDialog({ kind: 'profiles' }))
          .catch((e) => act.fail(e, 'Couldn’t delete the profile'))
      }
    })

  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement>) => setDraft((cur) => (cur ? { ...cur, [k]: e.target.value } : cur))
  const keyOptions = [{ value: NO_KEY, label: 'Whatever your SSH config says' }, ...keys.map((k) => ({ value: k.name, label: `~/.ssh/${k.name}` }))]
  if (draft && draft.sshKey !== NO_KEY && !keys.some((k) => k.name === draft.sshKey)) keyOptions.push({ value: draft.sshKey, label: `~/.ssh/${draft.sshKey} (missing)` })

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && act.closeDialog()}
      title="Profiles"
      error={error}
      footer={
        current ? (
          <>
            <Button variant="ghost" className="mr-auto text-danger" disabled={current.isActive} onClick={() => remove(current)}>
              Delete…
            </Button>
            {current.isActive ? null : (
              <Button disabled={changed} onClick={() => void act.switchProfile(current.id)}>
                Switch to {current.name}
              </Button>
            )}
            <Button variant="primary" disabled={!changed || badEmail || !draft?.name.trim()} loading={busy} onClick={() => void save()}>
              Save
            </Button>
          </>
        ) : (
          <Button onClick={() => act.closeDialog()}>Close</Button>
        )
      }
    >
      <p className="text-base text-muted">
        Each profile keeps its own tabs, recent list and settings. Give one a name and email to commit as someone else, say work and personal. A
        repository’s own Git settings still win.
      </p>
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Profiles">
        {(list ?? []).map((p) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={p.id === sel}
            onClick={() => pick(p)}
            className={cn(
              'inline-flex h-7 max-w-48 items-center gap-1.5 rounded-md border px-2.5 text-base',
              p.id === sel ? 'border-accent bg-row-selected text-text' : 'border-border text-muted hover:bg-row-hover hover:text-text'
            )}
          >
            {p.isActive ? <Check size={14} aria-label="In use" className="shrink-0 text-accent-text" /> : null}
            <span className="truncate">{p.name}</span>
          </button>
        ))}
        {adding ? (
          <form
            className="flex items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault()
              void create()
            }}
          >
            <TextInput aria-label="New profile name" autoFocus value={newName} placeholder="Work" onChange={(e) => setNewName(e.target.value)} className="w-36" />
            <Button size="sm" type="submit" variant="primary" disabled={!newName.trim()}>
              Add
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </form>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
            <Plus size={14} aria-hidden /> New profile
          </Button>
        )}
      </div>
      {draft && current ? (
        <form
          className="flex flex-col gap-3"
          aria-label={`${current.name} profile`}
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <Field label="Profile name">{(p) => <TextInput {...p} value={draft.name} onChange={set('name')} />}</Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Commit as (name)" help="Empty uses Git’s setting.">
              {(p) => <TextInput {...p} value={draft.authorName} placeholder="Git’s user.name" onChange={set('authorName')} />}
            </Field>
            <Field label="Commit as (email)" error={badEmail ? 'That doesn’t look like an email address.' : undefined} help={badEmail ? undefined : 'Empty uses Git’s setting.'}>
              {(p) => <TextInput {...p} type="email" value={draft.authorEmail} placeholder="Git’s user.email" onChange={set('authorEmail')} />}
            </Field>
          </div>
          <div className="grid grid-cols-2 items-start gap-3">
            <Field label="Signing key" help="Used when commit signing is on.">
              {(p) => <TextInput {...p} className="font-mono text-sm" value={draft.signingKey} placeholder="Git’s user.signingkey" onChange={set('signingKey')} />}
            </Field>
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium text-text">SSH key for fetch and push</span>
              <Select label="SSH key for fetch and push" value={draft.sshKey} onValueChange={(v) => setDraft((cur) => (cur ? { ...cur, sshKey: v } : cur))} options={keyOptions} />
            </div>
          </div>
        </form>
      ) : (
        <p className="text-sm text-muted">Loading…</p>
      )}
    </Dialog>
  )
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { Copy, KeyRound, X } from 'lucide-react'
import type { GitConfigKey, GitIdentity, GpuState, PullMode, SshKey } from '../../../shared/types'
import { Button, Field, IconButton, Select, Switch, TextInput } from '@/ui'
import { cn } from '@/ui/cn'
import { call } from '@/lib/api'
import { setPrefs, useApp, type DiffMode } from '@/store'
import * as act from '@/actions'
import { toast } from '@/ui/toastBus'

const sections = [
  { id: 'general', label: 'General' },
  { id: 'profile', label: 'Profile' },
  { id: 'commits', label: 'Commits and stashes' },
  { id: 'diffs', label: 'Diffs and code' },
  { id: 'identity', label: 'Your name and email' },
  { id: 'signing', label: 'Commit signing' },
  { id: 'tools', label: 'External tools' },
  { id: 'ssh', label: 'SSH keys' },
  { id: 'repo', label: 'This repository' }
] as const

/** S13: settings. App settings are saved in the app's database; names and emails go into Git's own config. */
export function PrefsView({ repoId }: { repoId: string }): React.JSX.Element {
  const prefs = useApp((s) => s.prefs)
  const tab = useApp((s) => s.tabs.find((t) => t.id === repoId))
  const [active, setActive] = useState<string>('general')
  const body = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = body.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
        if (top) setActive(top.target.id.replace('prefs-', ''))
      },
      { root: el, rootMargin: '0px 0px -60% 0px' }
    )
    for (const s of sections) {
      const t = document.getElementById(`prefs-${s.id}`)
      if (t) io.observe(t)
    }
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !document.querySelector('[role=dialog],[role=menu],[data-radix-popper-content-wrapper]')) act.setCenter(repoId, { kind: 'graph' })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [repoId])

  return (
    // A container, so the section list can step aside when Settings is squeezed between both side panels.
    <section aria-label="Settings" className="@container flex min-h-0 flex-1 flex-col bg-bg">
      <header className="flex h-10 shrink-0 items-center border-b border-border bg-surface px-3">
        <h2 className="flex-1 text-md text-text">Settings</h2>
        <IconButton label="Close settings" onClick={() => act.setCenter(repoId, { kind: 'graph' })}>
          <X size={16} />
        </IconButton>
      </header>
      <div className="flex min-h-0 flex-1">
        <nav aria-label="Settings sections" className="hidden w-52 shrink-0 border-r border-border bg-surface p-2 @2xl:block">
          {sections.map((s) => (
            <button
              key={s.id}
              aria-current={active === s.id ? 'true' : undefined}
              onClick={() => document.getElementById(`prefs-${s.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              className={cn('flex h-8 w-full items-center rounded-md px-2 text-left text-base', active === s.id ? 'bg-row-selected text-text' : 'text-muted hover:bg-row-hover hover:text-text')}
            >
              {s.label}
            </button>
          ))}
        </nav>
        <div ref={body} className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-(--gc-prefs-w) flex-col gap-8 p-6 pb-24">
            <Group id="general" title="General">
              <Row label="Theme" help="System follows your computer’s light or dark setting.">
                <Select
                  label="Theme"
                  value={prefs.theme}
                  onValueChange={(v) => setPrefs({ theme: v as 'dark' | 'light' | 'system' })}
                  options={[
                    { value: 'dark', label: 'Dark' },
                    { value: 'light', label: 'Light' },
                    { value: 'system', label: 'System' }
                  ]}
                />
              </Row>
              <Row label="Pull button" help="What the Pull button does. The arrow next to it always offers every option.">
                <Select
                  label="Pull button"
                  value={prefs.pullMode}
                  onValueChange={(v) => setPrefs({ pullMode: v as PullMode })}
                  options={[
                    { value: 'ff', label: 'Fast-forward when possible' },
                    { value: 'ff-only', label: 'Fast-forward only' },
                    { value: 'rebase', label: 'Rebase' }
                  ]}
                />
              </Row>
              <Row label="Fetch in the background" help="Keeps remote branches and the ahead / behind counts current. It never asks for a password; after a sign-in failure it waits for you to fetch by hand.">
                <Select
                  label="Fetch in the background"
                  value={String(prefs.autoFetchMinutes)}
                  onValueChange={(v) => setPrefs({ autoFetchMinutes: Number(v) })}
                  options={[
                    { value: '0', label: 'Off' },
                    { value: '1', label: 'Every minute' },
                    { value: '5', label: 'Every 5 minutes' },
                    { value: '15', label: 'Every 15 minutes' },
                    { value: '60', label: 'Every hour' }
                  ]}
                />
              </Row>
              <GraphicsRow />
            </Group>

            <ProfileGroup />

            <Group id="commits" title="Commits and stashes">
              <Row label="Push after committing" help="Ticks the box under the commit message by default.">
                <Switch hideLabel label="Push after committing" checked={prefs.pushAfterCommit} onCheckedChange={(v) => setPrefs({ pushAfterCommit: v })} />
              </Row>
              <Row label="Stash new files" help="Include files Git isn’t tracking yet when you stash.">
                <Switch hideLabel label="Stash new files" checked={prefs.stashUntracked} onCheckedChange={(v) => setPrefs({ stashUntracked: v })} />
              </Row>
              <Row label="Show untracked files" help="Lists files Git isn’t tracking yet among your changes. The eye on the list switches it too.">
                <Switch hideLabel label="Show untracked files" checked={prefs.showUntracked} onCheckedChange={(v) => setPrefs({ showUntracked: v })} />
              </Row>
            </Group>

            <Group id="diffs" title="Diffs">
              <Row label="Layout" help="How a file’s changes open. You can switch any time from the diff itself.">
                <Select
                  label="Diff layout"
                  value={prefs.diffMode}
                  onValueChange={(v) => setPrefs({ diffMode: v as DiffMode })}
                  options={[
                    { value: 'hunk', label: 'Changed blocks' },
                    { value: 'inline', label: 'Whole file' },
                    { value: 'split', label: 'Side by side' }
                  ]}
                />
              </Row>
              <Row label="Hide whitespace changes" help="Leaves out lines where only spaces, tabs or line endings changed. Lines can’t be staged from the diff while it’s on.">
                <Switch hideLabel label="Hide whitespace changes" checked={prefs.diffIgnoreWs} onCheckedChange={(v) => setPrefs({ diffIgnoreWs: v })} />
              </Row>
              <Row label="Wrap long lines" help="Otherwise long lines scroll sideways.">
                <Switch hideLabel label="Wrap long lines" checked={prefs.diffWrap} onCheckedChange={(v) => setPrefs({ diffWrap: v })} />
              </Row>
              <Row label="Code size" help="Text size in diffs, blame and the merge tool.">
                <Select
                  label="Code size"
                  value={String(prefs.codeFontSize)}
                  onValueChange={(v) => setPrefs({ codeFontSize: Number(v) })}
                  options={[11, 12, 13, 14, 16].map((n) => ({ value: String(n), label: `${n}${n === 12 ? ' (default)' : ''}` }))}
                />
              </Row>
              <Row label="Tab width" help="How many spaces a tab character takes up.">
                <Select label="Tab width" value={String(prefs.tabSize)} onValueChange={(v) => setPrefs({ tabSize: Number(v) })} options={[2, 4, 8].map((n) => ({ value: String(n), label: String(n) }))} />
              </Row>
            </Group>

            <Group id="identity" title="Your name and email" note="Saved in Git’s global config (the same one the git command uses), and written into every commit you make. A profile can use another name and email without changing this.">
              <IdentityForm repoId={undefined} />
            </Group>

            <Group id="signing" title="Commit signing" note="Signs your commits with a GPG key so others can check they came from you. Git does the signing with the gpg on your computer.">
              <SigningForm repoId={undefined} />
            </Group>

            <Group id="tools" title="External tools" note="Commands run without a shell. {path} is the repository folder, {file} the file you picked (or the folder).">
              <CommandRow label="Terminal" prefKey="terminalCommand" repoId={repoId} target="terminal" />
              <CommandRow label="Editor" prefKey="editorCommand" repoId={repoId} target="editor" />
              <ConfigRow label="Diff tool" configKey="diff.tool" help="The name Git uses, like meld, kdiff3, bc or winmerge (git difftool --tool-help lists them)." />
              <ConfigRow label="Merge tool" configKey="merge.tool" help="Used by “Open in merge tool” on a conflicted file." />
            </Group>

            <Group id="ssh" title="SSH keys" note="Public keys in your .ssh folder. Add one to your Git host to push and pull over SSH.">
              <SshKeys />
            </Group>

            <Group id="repo" title={`This repository: ${tab?.alias ?? tab?.name ?? ''}`} note="Overrides your global name and email for commits in this repository only, for example a work address. Leave both empty to use the global ones.">
              <IdentityForm repoId={repoId} />
              <SigningForm repoId={repoId} />
            </Group>
          </div>
        </div>
      </div>
    </section>
  )
}

/** Graphics acceleration: decided when the app starts, so a change asks for a restart. */
function GraphicsRow(): React.JSX.Element {
  const [gpu, setGpu] = useState<GpuState | null>(null)
  const load = useCallback(() => void call('gpu.get', {}).then(setGpu).catch(() => setGpu(null)), [])
  useEffect(load, [load])
  if (!gpu) return <></>
  const pending = gpu.nextStart !== gpu.enabled
  return (
    <Row
      label="Graphics acceleration"
      help={
        pending
          ? `Turns ${gpu.nextStart ? 'on' : 'off'} when Mergatroid restarts.`
          : gpu.enabled
            ? 'Draws with your graphics card. Turn it off if the window goes blank or the app crashes on start.'
            : 'Off: Mergatroid is drawing in software. That’s slower, but it works with any graphics driver.'
      }
    >
      <div className="flex items-center gap-2">
        {pending ? (
          <Button size="sm" onClick={() => void call('app.restart', {})}>
            Restart now
          </Button>
        ) : null}
        <Switch
          hideLabel
          label="Graphics acceleration"
          checked={gpu.nextStart}
          onCheckedChange={(v) =>
            void call('gpu.set', { on: v })
              .then(load)
              .catch((e) => act.fail(e, 'Couldn’t save'))
          }
        />
      </div>
    </Row>
  )
}

/** The profile in use, with a way to edit or switch. */
function ProfileGroup(): React.JSX.Element {
  const profiles = useApp((s) => s.profiles)
  const current = profiles.find((p) => p.isActive)
  const who = current?.authorEmail ? `${current.authorName ?? 'Git’s name'} <${current.authorEmail}>` : current?.authorName ? current.authorName : null
  return (
    <Group id="profile" title={`Profile: ${current?.name ?? ''}`} note="A profile has its own tabs, recent list and settings, and can commit under its own name and email, or push with its own SSH key.">
      <Row label={who ? `Commits as ${who}` : 'Commits as set in Git'} help={profiles.length > 1 ? `${profiles.length} profiles. Switch from the profile button at the top right.` : 'Add a second profile to keep work and personal projects apart.'}>
        <Button onClick={() => act.openDialog({ kind: 'profiles', edit: current?.id })}>Manage profiles…</Button>
      </Row>
    </Group>
  )
}

function Group({ id, title, note, children }: { id: string; title: string; note?: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <section id={`prefs-${id}`} aria-labelledby={`prefs-${id}-h`} className="scroll-mt-4">
      <h3 id={`prefs-${id}-h`} className="text-lg text-text">
        {title}
      </h3>
      {note ? <p className="mt-1 text-sm text-muted">{note}</p> : null}
      <div className="mt-2 flex flex-col">{children}</div>
    </section>
  )
}

/** In a narrow window the controls wrap under the text rather than squeezing it to nothing. */
function Row({ label, help, children }: { label: string; help: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2 border-b border-border py-3">
      <div className="min-w-0 flex-1 basis-56">
        <p className="text-base font-medium text-text">{label}</p>
        <p className="text-sm text-muted">{help}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

const emailOk = (e: string): boolean => !e || /^[^\s@<>]+@[^\s@<>]+$/.test(e)

/** Global identity when repoId is undefined, else this repo's override. */
function IdentityForm({ repoId }: { repoId: string | undefined }): React.JSX.Element {
  const [loaded, setLoaded] = useState<GitIdentity | null>(null)
  const [fallback, setFallback] = useState<GitIdentity | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    call('identity.get', { repoId })
      .then((r) => {
        const mine = repoId ? r.repo! : r.global
        setLoaded(mine)
        setFallback(r.global)
        setName(mine.name ?? '')
        setEmail(mine.email ?? '')
      })
      .catch((e: Error) => setError(e.message))
  }, [repoId])

  const changed = loaded !== null && (name !== (loaded.name ?? '') || email !== (loaded.email ?? ''))
  const badEmail = !emailOk(email.trim())
  const save = async (): Promise<void> => {
    if (badEmail) return
    setBusy(true)
    try {
      await call('identity.set', { repoId, name, email })
      setLoaded({ name: name.trim() || null, email: email.trim() || null })
      act.identityChanged()
      toast({ tone: 'success', title: repoId ? 'Saved for this repository' : 'Saved your name and email' })
    } catch (err) {
      act.fail(err, 'Couldn’t save')
    } finally {
      setBusy(false)
    }
  }

  if (error) return <p className="py-3 text-sm text-danger">{error}</p>
  return (
    <form
      className="flex flex-col gap-3 py-3"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name" help={repoId && fallback?.name ? `Empty uses ${fallback.name}` : undefined}>
          {(p) => <TextInput {...p} value={name} onChange={(e) => setName(e.target.value)} disabled={!loaded} placeholder={repoId ? (fallback?.name ?? '') : 'Ada Lovelace'} />}
        </Field>
        <Field label="Email" error={badEmail ? 'That doesn’t look like an email address.' : undefined} help={repoId && fallback?.email ? `Empty uses ${fallback.email}` : undefined}>
          {(p) => (
            <TextInput {...p} type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={!loaded} placeholder={repoId ? (fallback?.email ?? '') : 'ada@example.com'} />
          )}
        </Field>
      </div>
      {!repoId && loaded && !loaded.name && !loaded.email ? (
        <p role="note" className="text-sm text-warning">
          Git doesn’t know who you are yet, so commits will fail until you fill this in.
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          disabled={!changed}
          onClick={() => {
            setName(loaded?.name ?? '')
            setEmail(loaded?.email ?? '')
          }}
        >
          Revert
        </Button>
        <Button type="submit" variant="primary" disabled={!changed || badEmail} loading={busy}>
          Save
        </Button>
      </div>
    </form>
  )
}

/** Reads Git's config once and refreshes after each change. */
function useGitConfig(repoId: string | undefined): {
  values: Partial<Record<GitConfigKey, string>> | null
  global: Partial<Record<GitConfigKey, string>>
  save: (key: GitConfigKey, value: string | null) => Promise<boolean>
} {
  const [data, setData] = useState<{ global: Partial<Record<GitConfigKey, string>>; repo: Partial<Record<GitConfigKey, string>> | null } | null>(null)
  const load = useCallback(() => {
    call('gitConfig.get', { repoId })
      .then(setData)
      .catch((e) => act.fail(e, 'Couldn’t read Git’s settings'))
  }, [repoId])
  useEffect(load, [load])
  const save = async (key: GitConfigKey, value: string | null): Promise<boolean> => {
    try {
      await call('gitConfig.set', { repoId, key, value })
      load()
      return true
    } catch (err) {
      act.fail(err, 'Couldn’t save')
      return false
    }
  }
  return { values: data ? (repoId ? data.repo : data.global) : null, global: data?.global ?? {}, save }
}

/** A text setting with its own Save, for values that shouldn't change on every keystroke. */
function TextSetting({ label, value, placeholder, onSave, mono }: { label: string; value: string; placeholder?: string; onSave: (v: string) => Promise<unknown> | void; mono?: boolean }): React.JSX.Element {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return (
    <form
      className="flex w-80 gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        void onSave(draft.trim())
      }}
    >
      <TextInput aria-label={label} value={draft} placeholder={placeholder} onChange={(e) => setDraft(e.target.value)} className={mono ? 'font-mono text-sm' : undefined} />
      <Button type="submit" disabled={draft.trim() === value}>
        Save
      </Button>
    </form>
  )
}

function SigningForm({ repoId }: { repoId: string | undefined }): React.JSX.Element {
  const { values, global, save } = useGitConfig(repoId)
  if (!values) return <p className="py-3 text-sm text-muted">Loading…</p>
  const sign = values['commit.gpgsign']
  return (
    <>
      <Row
        label={repoId ? 'Sign commits here' : 'Sign every commit'}
        help={repoId ? `Default: ${global['commit.gpgsign'] === 'true' ? 'on' : 'off'} (your global setting).` : 'Adds a signature to each commit you make (commit.gpgsign).'}
      >
        {repoId ? (
          <Select
            label="Sign commits here"
            value={sign ?? 'default'}
            onValueChange={(v) => void save('commit.gpgsign', v === 'default' ? null : v)}
            options={[
              { value: 'default', label: 'Use the global setting' },
              { value: 'true', label: 'On' },
              { value: 'false', label: 'Off' }
            ]}
          />
        ) : (
          <Switch hideLabel label="Sign every commit" checked={sign === 'true'} onCheckedChange={(v) => void save('commit.gpgsign', v ? 'true' : null)} />
        )}
      </Row>
      <Row label="Signing key" help={repoId ? 'Leave empty to use your global key.' : 'The key ID or fingerprint (gpg --list-secret-keys shows it). Empty uses the key that matches your email.'}>
        <TextSetting label="Signing key" mono value={values['user.signingkey'] ?? ''} placeholder={repoId ? (global['user.signingkey'] ?? '') : 'e.g. 3AA5C34371567BD2'} onSave={(v) => save('user.signingkey', v || null)} />
      </Row>
      {!repoId ? (
        <Row label="Commit message template" help="A file whose text pre-fills the commit message (commit.template).">
          <TextSetting label="Commit message template" mono value={values['commit.template'] ?? ''} placeholder="~/.gitmessage" onSave={(v) => save('commit.template', v || null)} />
        </Row>
      ) : null}
    </>
  )
}

function CommandRow({ label, prefKey, repoId, target }: { label: string; prefKey: 'terminalCommand' | 'editorCommand'; repoId: string; target: 'terminal' | 'editor' }): React.JSX.Element {
  const value = useApp((s) => s.prefs[prefKey])
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2 border-b border-border py-3">
      <div className="min-w-0 flex-1 basis-56">
        <p className="text-base font-medium text-text">{label}</p>
        <p className="text-sm text-muted">Empty uses the usual one for your system.</p>
        <Button size="sm" variant="ghost" className="-ml-2 text-accent-text" onClick={() => void act.openIn(repoId, target)}>
          Try it on this repository
        </Button>
      </div>
      <TextSetting label={`${label} command`} mono value={value} placeholder={target === 'terminal' ? 'wt.exe -d {path}' : 'code {file}'} onSave={(v) => setPrefs({ [prefKey]: v })} />
    </div>
  )
}

function ConfigRow({ label, configKey, help }: { label: string; configKey: GitConfigKey; help: string }): React.JSX.Element {
  const { values, save } = useGitConfig(undefined)
  return (
    <Row label={label} help={help}>
      <TextSetting label={label} mono value={values?.[configKey] ?? ''} placeholder="not set" onSave={(v) => save(configKey, v || null)} />
    </Row>
  )
}

function SshKeys(): React.JSX.Element {
  const [keys, setKeys] = useState<SshKey[] | null>(null)
  const [name, setName] = useState('id_ed25519')
  const [label, setLabel] = useState('')
  const [pass, setPass] = useState('')
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => void call('ssh.keys', {}).then(setKeys).catch((e) => act.fail(e, 'Couldn’t read your SSH keys')), [])
  useEffect(load, [load])
  const create = async (): Promise<void> => {
    setBusy(true)
    try {
      const k = await call('ssh.generate', { name, comment: label, passphrase: pass })
      await navigator.clipboard.writeText(k.publicKey).catch(() => {})
      toast({ tone: 'success', title: `Created ~/.ssh/${k.name}`, body: 'The public key is on your clipboard, ready to add to your Git host.' })
      setPass('')
      load()
    } catch (err) {
      act.fail(err, 'Couldn’t create the key')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-col gap-3 py-3">
      {keys === null ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : keys.length === 0 ? (
        <p className="text-sm text-muted">No SSH keys yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {keys.map((k) => (
            <li key={k.name} className="flex items-center gap-3 px-3 py-2">
              <KeyRound size={16} aria-hidden className="shrink-0 text-muted" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-base text-text">{k.name}</p>
                <p className="truncate font-mono text-xs text-muted">
                  {k.type} {k.comment}
                </p>
              </div>
              <Button
                size="sm"
                onClick={() => void navigator.clipboard.writeText(k.publicKey).then(() => toast({ tone: 'success', title: 'Public key copied' }))}
              >
                <Copy size={14} aria-hidden /> Copy public key
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="grid grid-cols-1 items-end gap-3 @xl:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault()
          void create()
        }}
      >
        <Field label="File name">{(p) => <TextInput {...p} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label="Label">{(p) => <TextInput {...p} value={label} placeholder="laptop" onChange={(e) => setLabel(e.target.value)} />}</Field>
        <Field label="Passphrase (optional)">{(p) => <TextInput {...p} type="password" autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)} />}</Field>
        <div className="flex justify-end @xl:col-span-3">
          <Button type="submit" variant="primary" loading={busy} disabled={!name.trim()}>
            Create an SSH key
          </Button>
        </div>
      </form>
    </div>
  )
}

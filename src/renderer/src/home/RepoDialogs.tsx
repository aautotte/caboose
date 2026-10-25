import { useEffect, useMemo, useState } from 'react'
import { FolderOpen } from 'lucide-react'
import { Button, Dialog, Field, IconButton, ProgressBar, Select, Switch, TextInput } from '@/ui'
import { ApiError, call, newOpId, on } from '@/lib/api'
import { toast } from '@/ui/toastBus'
import { useApp } from '@/store'
import * as act from '@/actions'

const LAST_DIR = 'caboose.lastParentDir'
const rememberDir = (d: string): void => {
  try {
    localStorage.setItem(LAST_DIR, d)
  } catch {
    // convenience only
  }
}
const lastDir = (): string => {
  try {
    return localStorage.getItem(LAST_DIR) ?? localStorage.getItem('mergatroid.lastParentDir') ?? localStorage.getItem('gitclone.lastParentDir') ?? ''
  } catch {
    return ''
  }
}

function FolderField({ label, value, onChange, help }: { label: string; value: string; onChange: (v: string) => void; help?: string }): React.JSX.Element {
  return (
    <Field label={label} help={help}>
      {(p) => (
        <div className="flex gap-1">
          <TextInput {...p} value={value} onChange={(e) => onChange(e.target.value)} placeholder="C:\Users\you\code" />
          <IconButton
            label="Choose folder"
            className="border border-border"
            onClick={async () => {
              const d = await call('dialog.pickFolder', { title: label }).catch(() => null)
              if (d) onChange(d)
            }}
          >
            <FolderOpen size={16} />
          </IconButton>
        </div>
      )}
    </Field>
  )
}

/** "https://host/team/skycast.git" -> "skycast" */
export function repoNameFromUrl(url: string): string {
  const m = /([^/:\\]+?)(?:\.git)?\/?$/.exec(url.trim())
  return m?.[1] ?? ''
}

/** S02 */
export function CloneDialog(): React.JSX.Element {
  const [url, setUrl] = useState('')
  const [parent, setParent] = useState(lastDir)
  const [name, setName] = useState('')
  const [nameTouched, setNameTouched] = useState(false)
  const [shallow, setShallow] = useState(false)
  const [depth, setDepth] = useState('1')
  const [branch, setBranch] = useState('')
  const [sparse, setSparse] = useState(false)
  const [folders, setFolders] = useState('')
  const [busy, setBusy] = useState<{ opId: string; phase: string; percent?: number } | null>(null)
  const [error, setError] = useState<string | undefined>()

  useEffect(() => {
    if (!nameTouched) setName(repoNameFromUrl(url))
  }, [url, nameTouched])

  useEffect(() => {
    if (!busy) return
    return on('op:progress', (p) => {
      if (p.opId === busy.opId) setBusy((b) => (b ? { ...b, phase: p.phase, percent: p.percent } : b))
    })
  }, [busy?.opId]) // eslint-disable-line react-hooks/exhaustive-deps

  const sep = window.gc.platform === 'win32' ? '\\' : '/'
  const dest = parent && name ? `${parent.replace(/[\\/]+$/, '')}${sep}${name}` : ''
  const valid = url.trim() && parent.trim() && name.trim() && (!shallow || Number(depth) > 0) && (!sparse || folders.trim().length > 0)

  const start = async (): Promise<void> => {
    const opId = newOpId()
    setError(undefined)
    setBusy({ opId, phase: 'Starting' })
    try {
      const repo = await call('repo.clone', {
        url: url.trim(),
        dest,
        opId,
        depth: shallow ? Number(depth) : undefined,
        branch: shallow && branch.trim() ? branch.trim() : undefined,
        sparse: sparse ? folders.split(/[\s,]+/).filter(Boolean) : undefined
      })
      rememberDir(parent)
      act.closeDialog()
      toast({ tone: 'success', title: `Cloned ${repo.name}` })
      await act.openRepo(repo.path)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !busy && act.closeDialog()}
      title="Clone a repository"
      error={error}
      footer={
        <>
          <Button
            onClick={() => {
              if (busy) void call('op.cancel', { opId: busy.opId })
              else act.closeDialog()
            }}
          >
            {busy ? 'Stop' : 'Cancel'}
          </Button>
          <Button variant="primary" disabled={!valid} loading={!!busy} onClick={() => void start()}>
            Clone
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (valid && !busy) void start()
        }}
      >
        <Field label="Repository URL" help="HTTPS or SSH, for example https://host/team/project.git">
          {(p) => <TextInput {...p} autoFocus value={url} disabled={!!busy} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />}
        </Field>
        <FolderField label="Put it in" value={parent} onChange={setParent} />
        <Field label="Folder name" help={dest ? `Clones into ${dest}` : undefined}>
          {(p) => (
            <TextInput
              {...p}
              value={name}
              disabled={!!busy}
              onChange={(e) => {
                setNameTouched(true)
                setName(e.target.value)
              }}
            />
          )}
        </Field>
        <Switch label="Shallow clone (recent history only)" checked={shallow} onCheckedChange={setShallow} disabled={!!busy} />
        {shallow ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Commits to fetch">{(p) => <TextInput {...p} inputMode="numeric" value={depth} onChange={(e) => setDepth(e.target.value.replace(/\D/g, ''))} />}</Field>
            <Field label="Branch (optional)">{(p) => <TextInput {...p} value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="default branch" />}</Field>
          </div>
        ) : null}
        <Switch label="Only some folders (sparse checkout)" checked={sparse} onCheckedChange={setSparse} disabled={!!busy} />
        {sparse ? (
          <Field label="Folders to check out" help="Separated by spaces or commas, like src docs. Files at the top level always come along.">
            {(p) => <TextInput {...p} value={folders} onChange={(e) => setFolders(e.target.value)} placeholder="src docs" />}
          </Field>
        ) : null}
        {busy ? (
          <div className="flex flex-col gap-1" aria-live="polite">
            <ProgressBar label={busy.phase} value={busy.percent} />
            <span className="text-sm text-muted">
              {busy.phase}
              {busy.percent !== undefined ? ` ${busy.percent}%` : '…'}
            </span>
          </div>
        ) : null}
        <button type="submit" hidden />
      </form>
    </Dialog>
  )
}

/** S03 */
export function InitDialog(): React.JSX.Element {
  const [parent, setParent] = useState(lastDir)
  const [name, setName] = useState('')
  const [branch, setBranch] = useState('main')
  const [gitignore, setGitignore] = useState('none')
  const [license, setLicense] = useState('none')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const nameError = useMemo(() => (name && /[<>:"|?*\\/]/.test(name) ? 'Folder names can’t contain < > : " | ? * \\ or /' : undefined), [name])

  const create = async (): Promise<void> => {
    setBusy(true)
    setError(undefined)
    try {
      const repo = await call('repo.init', {
        parentDir: parent,
        name: name.trim(),
        defaultBranch: branch.trim() || 'main',
        gitignore: gitignore === 'none' ? null : gitignore,
        license: license === 'none' ? null : license
      })
      rememberDir(parent)
      act.closeDialog()
      toast({ tone: 'success', title: `Created ${repo.name}` })
      await act.openRepo(repo.path)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  const valid = parent.trim() && name.trim() && !nameError

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !busy && act.closeDialog()}
      title="Start a new repository"
      error={error}
      footer={
        <>
          <Button onClick={() => act.closeDialog()} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!valid} loading={busy} onClick={() => void create()}>
            Create repository
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (valid && !busy) void create()
        }}
      >
        <Field label="Name" error={nameError}>
          {(p) => <TextInput {...p} autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="my-project" />}
        </Field>
        <FolderField label="Create it in" value={parent} onChange={setParent} />
        <Field label="First branch">{(p) => <TextInput {...p} value={branch} onChange={(e) => setBranch(e.target.value)} />}</Field>
        <div className="flex flex-wrap gap-4">
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-text">Ignore file</span>
            <Select
              label="Ignore file"
              value={gitignore}
              onValueChange={setGitignore}
              options={[
                { value: 'none', label: 'None' },
                { value: 'general', label: 'General' },
                { value: 'node', label: 'Node.js' },
                { value: 'python', label: 'Python' },
                { value: 'dotnet', label: '.NET' }
              ]}
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-text">Licence</span>
            <Select
              label="Licence"
              value={license}
              onValueChange={setLicense}
              options={[
                { value: 'none', label: 'None' },
                { value: 'mit', label: 'MIT' }
              ]}
            />
          </div>
        </div>
        <p className="text-sm text-muted">Adds a README, plus the files you pick, as the first commit.</p>
        <button type="submit" hidden />
      </form>
    </Dialog>
  )
}

export function useDialogOpen(): boolean {
  return useApp((s) => s.dialog !== null)
}

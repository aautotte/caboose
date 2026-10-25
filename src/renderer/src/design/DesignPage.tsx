import { useState, type ReactNode } from 'react'
import {
  ArchiveRestore,
  ArrowDownToLine,
  ArrowUpFromLine,
  Copy,
  FolderGit2,
  GitBranch,
  GitMerge,
  Moon,
  MoreHorizontal,
  Redo2,
  Settings,
  Sun,
  Trash2,
  Undo2
} from 'lucide-react'
import {
  Avatar,
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  ContextMenu,
  Dialog,
  DropdownMenu,
  EmptyState,
  Field,
  IconButton,
  ProgressBar,
  RefPill,
  SegmentedControl,
  Select,
  Shortcut,
  Spinner,
  Splitter,
  StatusIcon,
  Switch,
  TextArea,
  TextInput,
  ToastProvider,
  Tooltip,
  TooltipProvider,
  useToast,
  type MenuEntry
} from '@/ui'

const colourRoles = [
  'bg', 'surface', 'surface-raised', 'surface-sunken', 'row-hover', 'row-selected', 'border', 'border-input',
  'text', 'text-muted', 'text-disabled', 'accent', 'accent-hover', 'on-accent', 'accent-text', 'focus-ring',
  'danger', 'danger-solid', 'success', 'warning', 'info',
  'diff-add-bg', 'diff-add-emph', 'diff-del-bg', 'diff-del-emph', 'conflict-ours-bg', 'conflict-theirs-bg',
  'lane-0', 'lane-1', 'lane-2', 'lane-3', 'lane-4', 'lane-5', 'lane-6', 'lane-7'
]

// Literal class names so Tailwind's scanner sees them.
const typeScale = [
  ['xs', 'text-xs'],
  ['sm', 'text-sm'],
  ['base', 'text-base'],
  ['md', 'text-md'],
  ['lg', 'text-lg'],
  ['xl', 'text-xl']
] as const

const branchMenu: MenuEntry[] = [
  { type: 'item', label: 'Check out', icon: <GitBranch size={14} /> },
  { type: 'item', label: 'Merge into current branch', icon: <GitMerge size={14} /> },
  { type: 'sub', label: 'Reset current branch here', items: [
    { type: 'item', label: 'Soft: keep all changes' },
    { type: 'item', label: 'Mixed: keep changes, unstage them' },
    { type: 'item', label: 'Hard: throw away changes', danger: true }
  ] },
  { type: 'item', label: 'Copy name', icon: <Copy size={14} />, shortcut: 'Ctrl+C' },
  { type: 'item', label: 'Push', icon: <ArrowUpFromLine size={14} />, disabled: true },
  { type: 'separator' },
  { type: 'item', label: 'Delete branch', icon: <Trash2 size={14} />, danger: true, shortcut: 'Del' }
]

function Section({ title, children }: { title: string; children: ReactNode }): React.JSX.Element {
  return (
    <section className="border-t border-border py-6">
      <h2 className="mb-4 text-lg text-text">{title}</h2>
      {children}
    </section>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-3 py-1.5">
      <span className="w-28 shrink-0 text-sm text-muted">{label}</span>
      {children}
    </div>
  )
}

function ToastDemo(): React.JSX.Element {
  const toast = useToast()
  return (
    <div className="flex gap-2">
      <Button onClick={() => toast({ tone: 'info', title: 'Fetched origin', body: '3 new commits on main' })}>Info toast</Button>
      <Button onClick={() => toast({ tone: 'success', title: 'Pushed feature/login to origin' })}>Success toast</Button>
      <Button
        onClick={() =>
          toast({
            tone: 'error',
            title: 'Push was rejected',
            body: 'The remote has commits you don’t have yet. Pull first, then push.',
            action: { label: 'Show details', onClick: () => {} }
          })
        }
      >
        Error toast
      </Button>
    </div>
  )
}

export function DesignPage(): React.JSX.Element {
  const [theme, setTheme] = useState(document.documentElement.dataset.theme ?? 'dark')
  const [diffMode, setDiffMode] = useState<'hunk' | 'inline' | 'split'>('inline')
  const [pull, setPull] = useState('ff')
  const [amend, setAmend] = useState(false)
  const [push, setPush] = useState(true)
  const [shallow, setShallow] = useState(false)
  const [search, setSearch] = useState('login')
  const [dialog, setDialog] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [panel, setPanel] = useState(240)

  const switchTheme = (): void => {
    const next = theme === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = next
    setTheme(next)
  }

  return (
    <TooltipProvider delayDuration={500} skipDelayDuration={0}>
      <ToastProvider>
        <main className="mx-auto max-w-(--gc-design-w) px-8 pb-16">
          <header className="flex items-center justify-between py-6">
            <div>
              <h1 className="text-xl text-text">Caboose design system</h1>
              <p className="text-base text-muted">The building blocks every screen uses. Tokens only, no raw colours.</p>
            </div>
            <Button icon={theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />} onClick={switchTheme}>
              {theme === 'dark' ? 'Light theme' : 'Dark theme'}
            </Button>
          </header>

          <Section title="Colour roles">
            <div className="grid grid-cols-[repeat(auto-fill,minmax(var(--gc-col-author-w),1fr))] gap-2">
              {colourRoles.map((r) => (
                <div key={r} className="overflow-hidden rounded-md border border-border">
                  <div className="h-10" style={{ background: `var(--gc-color-${r})` }} />
                  <div className="bg-surface px-2 py-1 font-mono text-xs text-muted">{r}</div>
                </div>
              ))}
            </div>
          </Section>

          <Section title="Type">
            {typeScale.map(([t, cls]) => (
              <div key={t} className="flex items-baseline gap-4 py-1">
                <span className="w-16 font-mono text-xs text-muted">{t}</span>
                <span className={`${cls} text-text`}>Merge feature/login into main</span>
              </div>
            ))}
            <div className="flex items-baseline gap-4 py-1">
              <span className="w-16 font-mono text-xs text-muted">code</span>
              <span className="font-mono text-code text-text">git rebase --onto main 4f2a91c feature/login</span>
            </div>
          </Section>

          <Section title="Buttons">
            {(['primary', 'secondary', 'ghost', 'danger'] as const).map((v) => (
              <Row key={v} label={v}>
                <Button variant={v} size="sm">Small</Button>
                <Button variant={v}>Medium</Button>
                <Button variant={v} size="lg">Large</Button>
                <Button variant={v} icon={<ArrowUpFromLine size={16} />}>With icon</Button>
                <Button variant={v} loading>Pushing</Button>
                <Button variant={v} disabled>Disabled</Button>
              </Row>
            ))}
            <Row label="icon buttons">
              <Tooltip content="Undo commit" shortcut="Ctrl+Z">
                <IconButton label="Undo commit"><Undo2 size={16} /></IconButton>
              </Tooltip>
              <Tooltip content="Nothing to redo">
                <span><IconButton label="Redo" disabled><Redo2 size={16} /></IconButton></span>
              </Tooltip>
              <Tooltip content="Pull" shortcut="Ctrl+L">
                <IconButton label="Pull"><ArrowDownToLine size={16} /></IconButton>
              </Tooltip>
              <IconButton label="Show labels" pressed><Settings size={16} /></IconButton>
              <IconButton label="More" size="sm"><MoreHorizontal size={14} /></IconButton>
            </Row>
            <Row label="commit button">
              <Button variant="primary" size="lg" className="w-80">Commit 3 files and push</Button>
              <Button variant="primary" size="lg" className="w-80" disabled>Stage something to commit</Button>
            </Row>
          </Section>

          <Section title="Inputs">
            <div className="grid max-w-(--gc-design-narrow-w) grid-cols-2 gap-4">
              <Field label="Repository URL" help="HTTPS or SSH, for example git@host:team/repo.git">
                {(p) => <TextInput {...p} placeholder="https://…" />}
              </Field>
              <Field label="Branch name" error="A branch called main already exists">
                {(p) => <TextInput {...p} defaultValue="main" />}
              </Field>
              <Field label="Search commits">
                {(p) => <TextInput {...p} variant="search" value={search} onChange={(e) => setSearch(e.target.value)} onClear={() => setSearch('')} placeholder="Message, SHA or author" />}
              </Field>
              <Field label="Disabled">
                {(p) => <TextInput {...p} disabled defaultValue="Can’t change while cloning" />}
              </Field>
              <Field label="Inline rename (graph row)">
                {(p) => <TextInput {...p} variant="inline" size="sm" defaultValue="feature/login" />}
              </Field>
              <Field label="Description">
                {(p) => <TextArea {...p} placeholder="Description" defaultValue={'Redirect to the page the user came from.\n\nCloses #42'} />}
              </Field>
            </div>
          </Section>

          <Section title="Choices">
            <Row label="checkbox">
              <Checkbox label="Amend last commit" checked={amend} onCheckedChange={setAmend} />
              <Checkbox label="Push after committing" checked={push} onCheckedChange={setPush} />
              <Checkbox label="Some lines" checked="indeterminate" onCheckedChange={() => {}} />
              <Checkbox label="Skip hooks" checked={false} onCheckedChange={() => {}} disabled />
            </Row>
            <Row label="switch">
              <Switch label="Shallow clone" checked={shallow} onCheckedChange={setShallow} />
              <Switch label="Auto-fetch" checked onCheckedChange={() => {}} />
              <Switch label="Disabled" checked={false} onCheckedChange={() => {}} disabled />
            </Row>
            <Row label="select">
              <Select
                label="Pull mode"
                value={pull}
                onValueChange={setPull}
                options={[
                  { value: 'ff', label: 'Fast-forward when possible' },
                  { value: 'ff-only', label: 'Fast-forward only' },
                  { value: 'rebase', label: 'Rebase' }
                ]}
              />
            </Row>
            <Row label="segmented">
              <SegmentedControl
                label="Diff view"
                value={diffMode}
                onValueChange={setDiffMode}
                options={[
                  { value: 'hunk', label: 'Hunk' },
                  { value: 'inline', label: 'Inline' },
                  { value: 'split', label: 'Split' }
                ]}
              />
            </Row>
          </Section>

          <Section title="Status and identity">
            <Row label="badges">
              <Badge label="2 ahead">↑2</Badge>
              <Badge label="1 behind">↓1</Badge>
              <Badge tone="accent">12</Badge>
              <Badge tone="danger">Conflicted</Badge>
              <Badge tone="success">Clean</Badge>
              <Badge tone="warning">Rebasing 2/5</Badge>
            </Row>
            <Row label="shortcuts">
              <Shortcut keys="Ctrl+Shift+Enter" />
              <Shortcut keys="Ctrl+P" />
              <Shortcut keys="J" />
            </Row>
            <Row label="file status">
              {(['added', 'modified', 'deleted', 'renamed', 'copied', 'conflicted', 'untracked'] as const).map((k) => (
                <span key={k} className="inline-flex items-center gap-1.5 text-base text-text">
                  <StatusIcon kind={k} />
                  {k}
                </span>
              ))}
            </Row>
            <Row label="ref pills">
              <RefPill name="main" kind="both" lane={0} current />
              <RefPill name="feature/login" kind="local" lane={1} />
              <RefPill name="feature/login" kind="remote" remote="origin" lane={1} />
              <RefPill name="v2.4.0" kind="tag" lane={2} />
              <RefPill name="" kind="local" lane={3} detached />
            </Row>
            <Row label="avatars">
              {[
                ['Sam Lee', 'sam@example.com'],
                ['Ana Duarte', 'ana@example.org'],
                ['Kofi Mensah', 'kofi@example.net'],
                ['Li Wei', 'li@example.dev'],
                ['Jo', 'jo@example.io']
              ].map(([n, e]) => (
                <Avatar key={e} name={n} email={e} />
              ))}
              <Avatar name="Sam Lee" email="sam@example.com" size={28} />
            </Row>
            <Row label="progress">
              <Spinner />
              <div className="w-60"><ProgressBar label="Receiving objects" value={42} /></div>
              <div className="w-60"><ProgressBar label="Fetching" /></div>
            </Row>
          </Section>

          <Section title="Diff and conflict surfaces">
            <div className="overflow-hidden rounded-md border border-border font-mono text-code">
              <div className="bg-surface-raised px-3 py-1 text-muted">@@ -12,6 +12,7 @@ export function redirectAfterLogin(</div>
              <div className="px-3 text-text">{'   const target = params.get(\'next\')'}</div>
              <div className="bg-diff-del-bg px-3 text-text">
                {'-  return '}<span className="bg-diff-del-emph">'/'</span>
              </div>
              <div className="bg-diff-add-bg px-3 text-text">
                {'+  return '}<span className="bg-diff-add-emph">{'isSafe(target) ? target : \'/\''}</span>
              </div>
              <div className="bg-conflict-ours-bg px-3 text-text">{'   yours:   const timeout = 30'}</div>
              <div className="bg-conflict-theirs-bg px-3 text-text">{'   theirs:  const timeout = 60'}</div>
            </div>
          </Section>

          <Section title="Menus, dialogs, toasts">
            <Row label="dropdown">
              <DropdownMenu trigger={<Button icon={<GitBranch size={16} />}>Branch actions</Button>} items={branchMenu} />
              <ContextMenu items={branchMenu}>
                <div className="flex h-7 items-center rounded-md border border-dashed border-border px-3 text-base text-muted">
                  Right-click here
                </div>
              </ContextMenu>
            </Row>
            <Row label="dialogs">
              <Button onClick={() => setDialog(true)}>Clone dialog</Button>
              <Button variant="danger" onClick={() => setConfirm(true)}>Hard reset…</Button>
            </Row>
            <Row label="toasts">
              <ToastDemo />
            </Row>
            <Dialog
              open={dialog}
              onOpenChange={setDialog}
              title="Clone a repository"
              error="Couldn’t reach github.com. Check the URL and your connection."
              footer={
                <>
                  <Button onClick={() => setDialog(false)}>Cancel</Button>
                  <Button variant="primary">Clone</Button>
                </>
              }
            >
              <Field label="Repository URL">{(p) => <TextInput {...p} autoFocus placeholder="https://…" />}</Field>
              <Field label="Clone into">{(p) => <TextInput {...p} defaultValue="C:\Users\me\code" />}</Field>
              <Switch label="Shallow clone" checked={shallow} onCheckedChange={setShallow} />
            </Dialog>
            <ConfirmDialog
              open={confirm}
              onOpenChange={setConfirm}
              title="Hard reset main?"
              body="This moves main to 4f2a91c and throws away your uncommitted changes."
              confirmLabel="Hard reset"
              danger
              undoable
              onConfirm={() => {}}
            />
          </Section>

          <Section title="Empty state and splitter">
            <div className="flex h-56 overflow-hidden rounded-md border border-border">
              <div style={{ width: panel }} className="shrink-0 bg-surface p-3 text-sm text-muted">
                Left panel: {panel}px (drag, or focus and use arrows / Home / End / Enter)
              </div>
              <Splitter label="Resize left panel" value={panel} min={180} max={480} defaultValue={240} onChange={setPanel} />
              <div className="flex-1 bg-bg">
                <EmptyState
                  icon={FolderGit2}
                  title="Nobody here but us robots"
                  body="Open a folder that already uses Git, clone one, or start a new one."
                  actions={
                    <>
                      <Button variant="primary">Open folder</Button>
                      <Button icon={<ArchiveRestore size={16} />}>Clone</Button>
                    </>
                  }
                />
              </div>
            </div>
          </Section>
        </main>
      </ToastProvider>
    </TooltipProvider>
  )
}

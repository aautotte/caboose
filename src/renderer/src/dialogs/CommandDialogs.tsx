import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Dialog, Field, Switch, TextInput } from '@/ui'
import { call, on, newOpId } from '@/lib/api'
import { fillCommand, parseCommand, showCommand, whereShown, type CustomCommand } from '@/lib/custom'
import { useApp, type Dialog as D } from '@/store'
import * as act from '@/actions'

const close = (): void => act.closeDialog()
/** Lines kept on screen while it runs; the whole output (up to 1 MB) comes once it's finished. */
const LIVE_LINES = 2000

type Run = { opId: string; lines: string[]; done?: { code: number; output: string } | { error: string } }

/**
 * One of your commands: its questions and the command line they make, then (when it shows its output) what it
 * prints as it runs, with a way to stop it.
 */
export function RunCommandDialog({ d }: { d: Extract<D, { kind: 'runCommand' }> }): React.JSX.Element | null {
  const cmd = useApp((s) => s.prefs.customCommands.find((c) => c.id === d.commandId))
  const head = useApp((s) => s.repos[d.repoId]?.refs?.head.branch ?? undefined)
  const parsed = useMemo(() => parseCommand(cmd?.command ?? ''), [cmd?.command])
  const [answers, setAnswers] = useState<Record<string, string>>(() => Object.fromEntries(parsed.prompts.map((p) => [p.label, p.value])))
  const [run, setRun] = useState<Run | null>(null)
  const filled = fillCommand(parsed, { ...d.ctx, head }, answers)
  const asks = parsed.prompts.length > 0 || !!cmd?.confirm
  const started = useRef(false)

  const start = async (): Promise<void> => {
    if (!cmd || 'problem' in filled || started.current) return
    started.current = true
    if (!cmd.output) {
      close()
      return void act.runCustomQuietly(d.repoId, cmd.name, filled.args)
    }
    const opId = newOpId()
    setRun({ opId, lines: [] })
    const off = on('op:output', (p) => {
      if (p.opId === opId) setRun((r) => (r && !r.done ? { ...r, lines: [...r.lines, p.line].slice(-LIVE_LINES) } : r))
    })
    try {
      const r = await call('custom.run', { repoId: d.repoId, args: filled.args, opId })
      setRun((cur) => cur && { ...cur, done: { code: r.code, output: [r.stdout.trimEnd(), r.stderr.trimEnd()].filter(Boolean).join('\n') } })
    } catch (e) {
      setRun((cur) => cur && { ...cur, done: { error: (e as Error).message } })
    } finally {
      off()
      void act.loadRepo(d.repoId, { keepSelection: true })
    }
  }

  // Nothing to ask: it starts as the window opens.
  useEffect(() => {
    if (!asks) void start()
  }, [])

  if (!cmd) return null
  const done = run?.done
  const running = !!run && !done
  const output = done && 'output' in done ? done.output : (run?.lines.join('\n') ?? '')
  const status = !run
    ? null
    : !done
      ? 'Running…'
      : 'error' in done
        ? `It didn’t finish: ${done.error}`
        : done.code === 0
          ? 'Finished.'
          : `Failed with exit code ${done.code}.`

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (o) return
        if (running) void call('op.cancel', { opId: run.opId })
        close()
      }}
      title={cmd.name}
      error={!run && 'problem' in filled ? filled.problem : undefined}
      footer={
        !run ? (
          <>
            <Button onClick={close}>Cancel</Button>
            <Button variant="primary" disabled={'problem' in filled} onClick={() => void start()}>
              Run
            </Button>
          </>
        ) : running ? (
          <Button onClick={() => void call('op.cancel', { opId: run.opId })}>Stop it</Button>
        ) : (
          <>
            {output ? <Button onClick={() => void navigator.clipboard.writeText(output)}>Copy the output</Button> : null}
            <Button variant="primary" onClick={close}>
              Close
            </Button>
          </>
        )
      }
    >
      {!run ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            void start()
          }}
        >
          {parsed.prompts.map((p, i) => (
            <Field key={p.label} label={p.label}>
              {(f) => <TextInput {...f} autoFocus={i === 0} value={answers[p.label] ?? ''} onChange={(e) => setAnswers({ ...answers, [p.label]: e.target.value })} />}
            </Field>
          ))}
          {'args' in filled ? (
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium text-text">Runs</p>
              <code aria-label="Command line" className="rounded-md bg-surface-sunken px-2 py-1.5 font-mono text-code break-all text-text">
                {showCommand(filled.args)}
              </code>
            </div>
          ) : null}
          <button type="submit" hidden />
        </form>
      ) : (
        <>
          <p role="status" className={'error' in (done ?? {}) || (done && 'code' in done && done.code !== 0) ? 'text-base text-danger' : 'text-base text-muted'}>
            {status}
          </p>
          <pre
            tabIndex={0}
            aria-label="Output"
            className="max-h-[50vh] min-h-24 overflow-auto rounded-md bg-surface-sunken px-2 py-1.5 font-mono text-code whitespace-pre text-text outline-none focus-visible:outline-2 focus-visible:outline-focus-ring"
          >
            {output || (done ? 'It printed nothing.' : '')}
          </pre>
        </>
      )}
    </Dialog>
  )
}

const PLACEHOLDER_HELP = 'Leave out “git”. {commit}, {branch} and {file} are what you run it on, {head} the checked-out branch; {?Question} asks as it runs, {?Question=answer} with an answer filled in.'

/** Write one of your commands, or change one (Settings › Your commands). */
export function EditCommandDialog({ d }: { d: Extract<D, { kind: 'editCommand' }> }): React.JSX.Element {
  const was = useApp((s) => s.prefs.customCommands.find((c) => c.id === d.commandId))
  const [name, setName] = useState(was?.name ?? '')
  const [command, setCommand] = useState(was?.command ?? '')
  const [output, setOutput] = useState(was?.output ?? true)
  const [confirm, setConfirm] = useState(was?.confirm ?? false)
  const parsed = parseCommand(command)
  const problem = command.trim() ? parsed.problem : null
  const ok = !!name.trim() && !!command.trim() && !parsed.problem
  const save = (): void => {
    if (!ok) return
    const cmd: CustomCommand = { id: was?.id ?? crypto.randomUUID().slice(0, 8), name: name.trim(), command: command.trim().replace(/^git\s+/, ''), output, confirm }
    act.saveCustomCommand(cmd)
    close()
  }
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && close()}
      title={was ? `Change ${was.name}` : 'New command'}
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" disabled={!ok} onClick={save}>
            {was ? 'Save' : 'Add the command'}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        <Field label="Name" help="As the menus and the command palette show it.">
          {(f) => <TextInput {...f} autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Short log" />}
        </Field>
        <Field label="Git command" help={PLACEHOLDER_HELP} error={problem ?? undefined}>
          {(f) => <TextInput {...f} value={command} onChange={(e) => setCommand(e.target.value)} placeholder="log --oneline -n {?How many=20}" className="font-mono" spellCheck={false} />}
        </Field>
        {command.trim() && !parsed.problem ? (
          <p role="status" className="text-sm text-muted">
            {whereShown(parsed.needs)}
          </p>
        ) : null}
        <Switch label="Show what it prints" checked={output} onCheckedChange={setOutput} />
        <Switch label="Show the command line before running it" checked={confirm} onCheckedChange={setConfirm} />
        <button type="submit" hidden />
      </form>
    </Dialog>
  )
}

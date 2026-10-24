// Opening the repo in other programs: a terminal, an editor. Commands come from Settings as templates like
// `wt.exe -d {path}`. They are split into argv first and the placeholders filled in afterwards, so a path
// with spaces or quotes stays one argument. Nothing runs through a shell.
import { spawn } from 'node:child_process'
import { invalid } from './errors'

export type ToolKind = 'terminal' | 'editor'

export function defaultCommand(kind: ToolKind): string {
  if (process.platform === 'win32') return kind === 'terminal' ? 'wt.exe -d {path}' : '"%LOCALAPPDATA%\\Programs\\Microsoft VS Code\\Code.exe" {file}'
  if (process.platform === 'darwin') return kind === 'terminal' ? 'open -a Terminal {path}' : 'open -a "Visual Studio Code" {file}'
  return kind === 'terminal' ? 'x-terminal-emulator --working-directory={path}' : 'code {file}'
}

/** Splits on spaces; double quotes group. Backslashes are literal (Windows paths). */
export function splitCommand(cmd: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  let has = false
  for (const ch of cmd.trim()) {
    if (ch === '"') {
      quoted = !quoted
      has = true
    } else if (/\s/.test(ch) && !quoted) {
      if (has) out.push(cur)
      cur = ''
      has = false
    } else {
      cur += ch
      has = true
    }
  }
  if (quoted) throw invalid('The command has an unclosed quote.')
  if (has) out.push(cur)
  return out
}

function expandEnv(s: string): string {
  return s
    .replace(/%([A-Za-z_][\w]*)%/g, (m, name: string) => process.env[name] ?? m)
    .replace(/\$\{([A-Za-z_]\w*)\}|\$([A-Za-z_]\w*)/g, (m, a?: string, b?: string) => process.env[(a ?? b)!] ?? m)
}

/** Builds the argv for a template. Exported for tests. */
export function buildArgv(template: string, vars: { path: string; file: string }): string[] {
  const parts = splitCommand(template)
  if (!parts.length) throw invalid('Set a command in Settings first.')
  const fill = (p: string): string => p.split('{path}').join(vars.path).split('{file}').join(vars.file)
  return [expandEnv(fill(parts[0])), ...parts.slice(1).map(fill)]
}

/** Starts the program detached and returns once it has started (or failed to). */
export function launch(template: string, vars: { path: string; file: string }): Promise<void> {
  const [cmd, ...args] = buildArgv(template, vars)
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(cmd)) {
    throw invalid('Batch files (.cmd, .bat) can’t be started safely without a shell. Point the command at the program’s .exe instead.')
  }
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: vars.path, detached: true, stdio: 'ignore' })
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
    child.once('error', (e) => reject(invalid(`Couldn’t start ${cmd}: ${e.message}. Check the command in Settings.`)))
  })
}

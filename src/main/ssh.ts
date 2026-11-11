// SSH keys for Settings: list the public keys in ~/.ssh and create a new one with ssh-keygen.
// Private keys are never read; only *.pub files.
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { invalid } from './errors'
import type { AgentState, SshTest } from '../shared/types'

export interface SshKey {
  name: string
  type: string
  comment: string
  publicKey: string
}

const dir = (): string => join(homedir(), '.ssh')

export function listKeys(): SshKey[] {
  if (!existsSync(dir())) return []
  return readdirSync(dir())
    .filter((f) => f.endsWith('.pub') && statSync(join(dir(), f)).size < 16_000)
    .map((f) => {
      const publicKey = readFileSync(join(dir(), f), 'utf8').trim()
      const [type = '', , ...comment] = publicKey.split(/\s+/)
      return { name: f.replace(/\.pub$/, ''), type, comment: comment.join(' '), publicKey }
    })
}

/**
 * Creates ~/.ssh/<name> (ed25519). ssh-keygen takes the passphrase as an argument (-N), so it is briefly visible
 * to other programs running as you; an empty passphrase avoids that, at the cost of an unprotected key.
 */
export function generateKey(name: string, comment: string, passphrase: string): Promise<SshKey> {
  if (!/^[\w.-]{1,64}$/.test(name) || name.startsWith('.')) throw invalid('Use letters, numbers, dots, dashes or underscores for the file name.')
  if (/[\r\n]/.test(comment)) throw invalid('The label must be one line.')
  const file = join(dir(), name)
  if (existsSync(file) || existsSync(`${file}.pub`)) throw invalid(`~/.ssh/${name} already exists. Pick another name.`)
  mkdirSync(dir(), { recursive: true })
  return new Promise((resolve, reject) => {
    execFile('ssh-keygen', ['-q', '-t', 'ed25519', '-f', file, '-N', passphrase, '-C', comment], { windowsHide: true, timeout: 60_000 }, (err, _out, stderr) => {
      if (err) return reject(invalid(`ssh-keygen failed: ${(stderr || err.message).trim()}`))
      const key = listKeys().find((k) => k.name === name)
      if (key) resolve(key)
      else reject(invalid('ssh-keygen finished but the key file isn’t there.'))
    })
  })
}


const keyOf = (publicKey: string): string => publicKey.trim().split(/\s+/).slice(0, 2).join(' ')

function run(cmd: string, args: string[], env?: NodeJS.ProcessEnv, timeout = 60_000): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout, env: env ?? process.env }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? ((err as { code: number }).code) : -1) : 0
      resolve({ code, out: `${stdout}${stderr}`.trim() })
    })
  })
}

/** ssh-add -L: 0 lists the keys, 1 has none, 2 (or no ssh-add at all) means no agent to talk to. */
export async function agentState(): Promise<AgentState> {
  const r = await run('ssh-add', ['-L'], undefined, 10_000)
  if (r.code === 0) return { running: true, keys: r.out.split('\n').filter((l) => /^(ssh|ecdsa|sk-)/.test(l)).map(keyOf) }
  if (r.code === 1 && !/connect|communicat/i.test(r.out)) return { running: true, keys: [] }
  return { running: false, keys: [] }
}

const NO_AGENT =
  process.platform === 'win32'
    ? 'ssh-agent isn’t running. Start the “OpenSSH Authentication Agent” service (in Services, set it to Automatic), then try again.'
    : 'ssh-agent isn’t running. Start one (eval "$(ssh-agent)" in your shell profile, or your desktop’s keyring), then try again.'

/**
 * Adds ~/.ssh/<name> to ssh-agent, so git can use it without asking for its passphrase each time. A passphrase is
 * asked in the app (`askEnv`), except on Windows, where ssh can't run the app's prompt: there it's ssh-add in a
 * terminal, once.
 */
export async function addToAgent(name: string, askEnv: Record<string, string>): Promise<void> {
  if (!/^[\w.-]{1,64}$/.test(name) || name.startsWith('.')) throw invalid('Pick a key from your .ssh folder.')
  const file = join(dir(), name)
  if (!existsSync(file)) throw invalid(`There’s no private key ~/.ssh/${name} next to its public key.`)
  if (!(await agentState()).running) throw invalid(NO_AGENT)
  // Whether it has a passphrase: ssh-keygen -y works with an empty one only when there's none.
  const open = (await run('ssh-keygen', ['-y', '-P', '', '-f', file], undefined, 10_000)).code === 0
  if (!open && process.platform === 'win32') throw invalid(`This key has a passphrase, and on Windows ssh-add has to ask for it in a terminal. Run this once: ssh-add ~/.ssh/${name}`)
  const r = await run('ssh-add', [file], { ...process.env, ...(open ? {} : askEnv) }, 5 * 60_000)
  if (r.code !== 0) throw invalid(/bad passphrase|incorrect passphrase/i.test(r.out) ? 'That passphrase isn’t right.' : `ssh-add failed: ${r.out || 'no reason given'}`)
}

/**
 * ssh -T to a git host, the way git connects: it says who the key belongs to, or why it was turned away. It never
 * asks anything (BatchMode); a host seen for the first time is remembered (accept-new), one whose key changed isn't.
 */
export async function testConnection(target: string, key: string | null): Promise<SshTest> {
  const m = /^(?:([\w.-]+)@)?([a-z0-9][a-z0-9.-]*)(?::(\d{1,5}))?$/i.exec(target.trim())
  if (!m) throw invalid('Write a host like github.com, or user@host:port.')
  const [, user = 'git', host, port] = m
  if (key && (!/^[\w.-]{1,64}$/.test(key) || key.startsWith('.') || !existsSync(join(dir(), key)))) throw invalid('Pick a key from your .ssh folder.')
  const args = ['-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=10', ...(port ? ['-p', port] : []), ...(key ? ['-i', join(dir(), key), '-o', 'IdentitiesOnly=yes'] : []), `${user}@${host}`]
  const r = await run('ssh', args, undefined, 30_000)
  return { ...sshVerdict(r.code, r.out, host), output: r.out }
}

/** Git hosts answer ssh -T with a greeting and close the connection (GitHub with exit code 1): that's a yes. */
export function sshVerdict(code: number, out: string, host: string): { ok: boolean; message: string } {
  const who = /Hi ([^!]+)!|Welcome to GitLab, @?([^!]+)!|logged in as ([^\s.]+)|authenticated as ([^\s.]+)/i.exec(out)
  if (who) return { ok: true, message: `${host} knows this key: you’re ${who.slice(1).find(Boolean)}.` }
  if (/successfully authenticated|authenticated via (an )?ssh key|Shell access is not supported/i.test(out)) return { ok: true, message: `${host} accepted the key.` }
  if (/Permission denied \(publickey/i.test(out)) return { ok: false, message: `${host} didn’t accept any of your keys. Add your public key to your account there, or add the key to ssh-agent if it has a passphrase.` }
  if (/HOST IDENTIFICATION HAS CHANGED|Host key verification failed/i.test(out)) return { ok: false, message: `${host}’s host key isn’t the one you saw before. Check with the host before trusting it, then fix ~/.ssh/known_hosts.` }
  if (/Could not resolve hostname/i.test(out)) return { ok: false, message: `Couldn’t find ${host}. Check the name and your connection.` }
  if (/Connection refused|timed out|Network is unreachable|No route to host/i.test(out)) return { ok: false, message: `Couldn’t reach ${host} over SSH: ${out.split('\n').pop()}` }
  if (code === -1 && !out) return { ok: false, message: 'ssh isn’t installed, or isn’t on the PATH.' }
  return { ok: code === 0, message: code === 0 ? `Connected to ${host}.` : out.split('\n').filter(Boolean).pop() ?? `ssh stopped with exit code ${code}.` }
}

/** The page where a git host takes a new SSH key. */
export const KEY_PAGES = {
  github: 'https://github.com/settings/ssh/new',
  gitlab: 'https://gitlab.com/-/user_settings/ssh_keys',
  bitbucket: 'https://bitbucket.org/account/settings/ssh-keys/',
  azure: 'https://dev.azure.com/_usersSettings/keys'
} as const

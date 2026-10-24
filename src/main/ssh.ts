// SSH keys for Settings: list the public keys in ~/.ssh and create a new one with ssh-keygen.
// Private keys are never read; only *.pub files.
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { invalid } from './errors'

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

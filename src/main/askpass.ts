// In-app credential prompts. Git (and ssh, outside Windows) runs our tiny askpass helper, which asks the
// main process over a local pipe guarded by a one-time token. The answer goes straight back to git and is
// never written anywhere. Credential managers (Git Credential Manager, the macOS keychain) still go first.
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { createServer, type Server, type Socket } from 'node:net'
import { join } from 'node:path'
import type { AuthPromptEvent } from '../shared/types'

const HELPER_JS = `// Caboose askpass helper: forwards git's prompt to the app and prints the answer.
const net = require('net')
const prompt = process.argv.slice(2).join(' ')
const s = net.connect(process.env.GC_ASKPASS_PIPE, () => {
  s.write(JSON.stringify({ token: process.env.GC_ASKPASS_TOKEN, prompt }) + '\\n')
})
let buf = ''
s.on('data', (d) => {
  buf += d
  const i = buf.indexOf('\\n')
  if (i < 0) return
  const m = JSON.parse(buf.slice(0, i))
  s.end()
  if (typeof m.answer !== 'string') process.exit(1)
  process.stdout.write(m.answer + '\\n', () => process.exit(0))
})
s.on('error', () => process.exit(1))
`

const TIMEOUT_MS = 5 * 60_000

export class Askpass {
  private server: Server
  private pipe: string
  private token = randomBytes(32)
  private script: string
  private helper: string
  private pending = new Map<string, { resolve: (answer: string | null) => void; timer: NodeJS.Timeout }>()

  constructor(
    dir: string,
    private ask: (e: AuthPromptEvent) => void,
    private closed: (promptId: string) => void
  ) {
    mkdirSync(dir, { recursive: true })
    const id = randomBytes(8).toString('hex')
    this.pipe = process.platform === 'win32' ? `\\\\.\\pipe\\caboose-askpass-${id}` : join(dir, `askpass-${id}.sock`)
    this.helper = join(dir, 'askpass-helper.js')
    this.script = join(dir, 'askpass.sh')
    writeFileSync(this.helper, HELPER_JS)
    // Git for Windows runs scripts with a #! line through its own sh, so one script works everywhere.
    writeFileSync(this.script, '#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "$GC_ASKPASS_NODE" "$GC_ASKPASS_JS" "$@"\n')
    chmodSync(this.script, 0o700)
    this.server = createServer((sock) => this.onConnection(sock))
    this.server.listen(this.pipe)
  }

  env(): Record<string, string> {
    const fwd = (p: string): string => p.split('\\').join('/')
    const e: Record<string, string> = {
      GIT_ASKPASS: fwd(this.script),
      GC_ASKPASS_JS: fwd(this.helper),
      GC_ASKPASS_NODE: fwd(process.execPath),
      GC_ASKPASS_PIPE: this.pipe,
      GC_ASKPASS_TOKEN: this.token.toString('hex')
    }
    // Windows' ssh.exe can't start a #! script, so ssh passphrases there rely on ssh-agent.
    if (process.platform !== 'win32') Object.assign(e, { SSH_ASKPASS: e.GIT_ASKPASS, SSH_ASKPASS_REQUIRE: 'force' })
    return e
  }

  respond(promptId: string, answer: string | null): void {
    const p = this.pending.get(promptId)
    if (!p) return
    clearTimeout(p.timer)
    this.pending.delete(promptId)
    p.resolve(answer)
    this.closed(promptId)
  }

  close(): void {
    for (const id of [...this.pending.keys()]) this.respond(id, null)
    this.server.close()
  }

  private onConnection(sock: Socket): void {
    let buf = ''
    let promptId: string | null = null
    sock.setEncoding('utf8')
    sock.on('data', (d: string) => {
      buf += d
      if (buf.length > 16_384) return void sock.destroy()
      const i = buf.indexOf('\n')
      if (i < 0 || promptId) return
      let msg: { token?: unknown; prompt?: unknown }
      try {
        msg = JSON.parse(buf.slice(0, i))
      } catch {
        return void sock.destroy()
      }
      const given = Buffer.from(typeof msg.token === 'string' ? msg.token : '', 'hex')
      if (given.length !== this.token.length || !timingSafeEqual(given, this.token)) return void sock.destroy()
      const prompt = String(msg.prompt ?? '').slice(0, 500)
      const id = randomUUID()
      promptId = id
      const timer = setTimeout(() => this.respond(id, null), TIMEOUT_MS)
      this.pending.set(id, {
        timer,
        resolve: (answer) => {
          if (!sock.destroyed) sock.end(JSON.stringify({ answer }) + '\n')
        }
      })
      this.ask({ promptId: id, prompt, secret: !/username/i.test(prompt) })
    })
    // git gave up (cancelled or timed out): forget the prompt.
    sock.on('close', () => promptId && this.respond(promptId, null))
    sock.on('error', () => {})
  }
}

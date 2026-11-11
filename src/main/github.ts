// GitHub: signing in with the device flow (or the gh CLI's sign-in), and reading a repository's pull requests.
// The device flow needs only the app's client ID, which is public: no secret ships with Caboose. The token is kept
// encrypted with the system's keychain (safeStorage), one per profile, and never written in plain text: where the
// system can't encrypt, it lasts until Caboose quits.
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { net, safeStorage } from 'electron'
import type { DeviceCode, GitHubUser, PullRequest } from '../shared/types'
import { GcFail, invalid } from './errors'

const CLIENT_ID = 'Ov23liR8tIc71IGL9jko'
/** repo: the pull requests of private repositories too. */
const SCOPE = 'repo'
// The e2e tests point these at a fake GitHub; only under GC_TEST, so nothing else can send a token elsewhere.
const TEST = process.env.GC_TEST === '1'
const WEB = (TEST && process.env.GC_GITHUB_WEB) || 'https://github.com'
const API = (TEST && process.env.GC_GITHUB_API) || 'https://api.github.com'

const fail = (message: string, detail?: string): GcFail => new GcFail('git', message, detail)

async function post(url: string, body: Record<string, string>): Promise<Record<string, unknown>> {
  let res: Response
  try {
    res = await net.fetch(url, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  } catch (e) {
    throw fail('Couldn’t reach GitHub. Check your connection, then try again.', (e as Error).message)
  }
  const text = await res.text()
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    throw fail(`GitHub answered with something unexpected (HTTP ${res.status}).`, text.slice(0, 500))
  }
}

export class GitHub {
  /** Tokens kept only in memory: where safeStorage can't encrypt. */
  private memory = new Map<string, string>()
  private pending: { device: string; interval: number; until: number; cancelled: boolean } | null = null

  constructor(
    private dir: string,
    private profileId: () => string
  ) {}

  private file(): string {
    return join(this.dir, `github-${this.profileId().replace(/[^\w-]/g, '')}.bin`)
  }

  /** Encryption the system offers; without it, a sign-in lasts until Caboose quits. */
  canKeep(): boolean {
    return safeStorage.isEncryptionAvailable()
  }

  token(): string | null {
    const mem = this.memory.get(this.profileId())
    if (mem) return mem
    const f = this.file()
    if (!existsSync(f) || !this.canKeep()) return null
    try {
      return safeStorage.decryptString(readFileSync(f))
    } catch {
      return null
    }
  }

  private save(token: string): void {
    if (this.canKeep()) {
      mkdirSync(this.dir, { recursive: true })
      writeFileSync(this.file(), safeStorage.encryptString(token))
      this.memory.delete(this.profileId())
    } else this.memory.set(this.profileId(), token)
  }

  signOut(): void {
    this.memory.delete(this.profileId())
    rmSync(this.file(), { force: true })
  }

  /** Who the token belongs to; null when there's none. A token GitHub no longer takes is forgotten. */
  async user(): Promise<GitHubUser | null> {
    const t = this.token()
    if (!t) return null
    const u = (await this.api(t, '/user')) as { login: string; name: string | null }
    return { login: u.login, name: u.name ?? null }
  }

  /** Step one of the device flow: the code to type at GitHub's page. step two is `waitForApproval`. */
  async startSignIn(): Promise<DeviceCode> {
    const r = await post(`${WEB}/login/device/code`, { client_id: CLIENT_ID, scope: SCOPE })
    if (typeof r.device_code !== 'string' || typeof r.user_code !== 'string') {
      throw fail(r.error === 'device_flow_disabled' ? 'Signing in this way is turned off for Caboose on GitHub.' : 'GitHub didn’t give a sign-in code.', JSON.stringify(r))
    }
    const expires = Number(r.expires_in) || 900
    this.pending = { device: r.device_code, interval: Math.max(1, Number(r.interval) || 5), until: Date.now() + expires * 1000, cancelled: false }
    return { userCode: r.user_code, verificationUri: String(r.verification_uri ?? `${WEB}/login/device`), expiresIn: expires }
  }

  /** Asks GitHub, as often as it allows, until the code is approved, refused or runs out. */
  async waitForApproval(): Promise<GitHubUser> {
    const p = this.pending
    if (!p) throw invalid('Start signing in first.')
    for (;;) {
      await new Promise((r) => setTimeout(r, p.interval * 1000))
      if (p.cancelled || this.pending !== p) throw invalid('Signing in was cancelled.')
      if (Date.now() > p.until) throw invalid('The code ran out before it was approved. Start again for a new one.')
      const r = await post(`${WEB}/login/oauth/access_token`, { client_id: CLIENT_ID, device_code: p.device, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' })
      if (typeof r.access_token === 'string') {
        this.pending = null
        this.save(r.access_token)
        const u = await this.user()
        if (!u) throw fail('GitHub gave a token it then didn’t accept.')
        return u
      }
      if (r.error === 'authorization_pending') continue
      if (r.error === 'slow_down') {
        p.interval += 5
        continue
      }
      this.pending = null
      if (r.error === 'access_denied') throw invalid('Caboose wasn’t authorized on GitHub.')
      if (r.error === 'expired_token') throw invalid('The code ran out before it was approved. Start again for a new one.')
      throw fail(`GitHub refused the sign-in: ${String(r.error_description ?? r.error ?? 'no reason given')}`)
    }
  }

  cancelSignIn(): void {
    if (this.pending) this.pending.cancelled = true
    this.pending = null
  }

  /** The gh CLI's sign-in, when it's installed and signed in: its token is copied, and checked first. */
  async useGhCli(): Promise<GitHubUser> {
    // Started from the Start menu or the Dock, Caboose may not have the PATH a terminal has: the usual places too.
    const where =
      process.platform === 'win32'
        ? ['gh', join(process.env.ProgramFiles ?? 'C:\\Program Files', 'GitHub CLI', 'gh.exe')]
        : ['gh', '/opt/homebrew/bin/gh', '/usr/local/bin/gh', '/usr/bin/gh']
    const run = (cmd: string): Promise<{ missing: boolean; token: string }> =>
      new Promise((resolve) => {
        execFile(cmd, ['auth', 'token', '--hostname', 'github.com'], { windowsHide: true, timeout: 15_000 }, (err, out) => {
          resolve({ missing: !!err && (err as NodeJS.ErrnoException).code === 'ENOENT', token: err ? '' : out.trim() })
        })
      })
    let found = false
    let token = ''
    for (const cmd of where) {
      const r = await run(cmd)
      if (r.missing) continue
      found = true
      token = r.token
      break
    }
    if (!found) throw invalid('The gh CLI isn’t installed (or isn’t where Caboose can find it).')
    if (!token) throw invalid('The gh CLI isn’t signed in to github.com. Run gh auth login, or sign in here instead.')
    const u = (await this.api(token, '/user')) as { login: string; name: string | null }
    this.save(token)
    return { login: u.login, name: u.name ?? null }
  }

  /** The open pull requests of owner/name, newest activity first, with their checks and review state. */
  async pulls(repo: string): Promise<PullRequest[]> {
    const t = this.token()
    if (!t) throw invalid('Sign in to GitHub first.')
    const [owner, name] = repo.split('/')
    const r = (await this.api(t, '/graphql', { query: PULLS_QUERY, variables: { owner, name } })) as GraphQLPulls
    const nodes = r.data?.repository?.pullRequests.nodes
    if (!nodes) {
      if (r.errors?.some((e) => e.type === 'NOT_FOUND')) throw invalid(`GitHub doesn’t show you ${repo}: it doesn’t exist, or it’s private and this sign-in can’t see it.`)
      throw fail(`GitHub didn’t list the pull requests: ${r.errors?.[0]?.message ?? 'no reason given'}`)
    }
    return nodes.map((n) => {
      const state = n.commits.nodes[0]?.commit.statusCheckRollup?.state
      return {
        number: n.number,
        title: n.title,
        url: n.url,
        author: n.author?.login ?? 'ghost',
        draft: n.isDraft,
        updatedAt: n.updatedAt,
        head: n.headRefName,
        headSha: n.headRefOid,
        base: n.baseRefName,
        fromFork: n.isCrossRepository,
        checks: state === 'SUCCESS' ? 'success' : state === 'FAILURE' || state === 'ERROR' ? 'failure' : state === 'PENDING' || state === 'EXPECTED' ? 'pending' : null,
        review: n.reviewDecision === 'APPROVED' ? 'approved' : n.reviewDecision === 'CHANGES_REQUESTED' ? 'changes' : n.reviewDecision === 'REVIEW_REQUIRED' ? 'required' : null
      }
    })
  }

  private async api(token: string, path: string, graphql?: unknown): Promise<unknown> {
    let res: Response
    try {
      res = await net.fetch(`${API}${path}`, {
        method: graphql ? 'POST' : 'GET',
        headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', ...(graphql ? { 'Content-Type': 'application/json' } : {}) },
        body: graphql ? JSON.stringify(graphql) : undefined
      })
    } catch (e) {
      throw fail('Couldn’t reach GitHub. Check your connection, then try again.', (e as Error).message)
    }
    const text = await res.text()
    if (res.status === 401) {
      if (token === this.token()) this.signOut()
      throw invalid('GitHub no longer accepts this sign-in (it was revoked, or it ran out). Sign in again.')
    }
    if (!res.ok) {
      const message = (() => {
        try {
          return (JSON.parse(text) as { message?: string }).message
        } catch {
          return undefined
        }
      })()
      throw fail(res.status === 403 ? `GitHub refused: ${message ?? 'no reason given'}. An organization may need to approve Caboose first.` : `GitHub answered HTTP ${res.status}${message ? `: ${message}` : ''}.`, text.slice(0, 500))
    }
    return JSON.parse(text)
  }
}

const PULLS_QUERY = `query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: OPEN, first: 50, orderBy: { field: UPDATED_AT, direction: DESC }) {
      nodes {
        number title url isDraft updatedAt isCrossRepository
        author { login }
        headRefName headRefOid baseRefName reviewDecision
        commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
      }
    }
  }
}`

interface GraphQLPulls {
  data?: {
    repository: {
      pullRequests: {
        nodes: Array<{
          number: number
          title: string
          url: string
          isDraft: boolean
          updatedAt: string
          isCrossRepository: boolean
          author: { login: string } | null
          headRefName: string
          headRefOid: string
          baseRefName: string
          reviewDecision: string | null
          commits: { nodes: Array<{ commit: { statusCheckRollup: { state: string } | null } }> }
        }>
      }
    } | null
  }
  errors?: Array<{ type?: string; message: string }>
}

/** owner/name of a github.com repository, from a remote URL (https, ssh or git@github.com:owner/name). */
export function githubRepo(url: string): string | null {
  const m = /^(?:https?:\/\/(?:[^@/]+@)?github\.com\/|(?:ssh:\/\/)?git@github\.com[:/])([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(url.trim())
  return m ? `${m[1]}/${m[2]}` : null
}

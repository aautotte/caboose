// A stand-in for github.com and api.github.com, for the tests: the device flow (a code, "pending" until the test
// approves or denies it), /user, the GraphQL query for a repository's pull requests, and creating one. Every request
// is kept so a test can check what Caboose sent.
import { createServer, type IncomingMessage } from 'node:http'
import type { AddressInfo } from 'node:net'

export interface FakePull {
  number: number
  title: string
  author: string
  head: string
  headSha: string
  base?: string
  draft?: boolean
  fork?: boolean
  checks?: 'SUCCESS' | 'FAILURE' | 'PENDING' | null
  review?: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null
}

export interface FakeGitHub {
  url: string
  requests: Array<{ method: string; path: string; auth: string | undefined; body: string }>
  /** The next poll gets a token (or a refusal). */
  approve: () => void
  deny: () => void
  /** Tokens GitHub accepts; revoke() makes them all fail with 401. */
  tokens: Set<string>
  revoke: () => void
  pulls: FakePull[]
  /** owner/name it knows; any other gets NOT_FOUND. */
  repo: string
  /** A new pull request's head commit, from its branch: the test reads it from the origin. */
  shaOf: (branch: string) => string
  /** The next new pull request is turned down (422) with this. */
  refuse: string | null
  close: () => Promise<void>
}

const read = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve) => {
    let b = ''
    req.on('data', (d) => (b += d))
    req.on('end', () => resolve(b))
  })

export async function fakeGitHub(repo: string, pulls: FakePull[]): Promise<FakeGitHub> {
  let answer: 'pending' | 'approve' | 'deny' = 'pending'
  let issued = 0
  const f: Omit<FakeGitHub, 'url' | 'close'> = {
    requests: [],
    approve: () => void (answer = 'approve'),
    deny: () => void (answer = 'deny'),
    tokens: new Set(['gho_cli_token']),
    revoke: () => f.tokens.clear(),
    pulls,
    repo,
    shaOf: () => '',
    refuse: null
  }
  const server = createServer(async (req, res) => {
    const body = await read(req)
    const path = (req.url ?? '').split('?')[0]
    const auth = req.headers.authorization
    f.requests.push({ method: req.method ?? '', path, auth, body })
    const json = (status: number, data: unknown): void => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(data))
    }
    const authed = (): boolean => !!auth && f.tokens.has(auth.replace(/^Bearer /, ''))
    if (req.method === 'POST' && path === '/login/device/code') {
      answer = 'pending'
      return json(200, { device_code: 'device-123', user_code: 'WDJB-MJHT', verification_uri: `${url}/login/device`, expires_in: 900, interval: 1 })
    }
    if (req.method === 'POST' && path === '/login/oauth/access_token') {
      if (answer === 'pending') return json(200, { error: 'authorization_pending' })
      if (answer === 'deny') return json(200, { error: 'access_denied' })
      const token = `gho_device_${++issued}`
      f.tokens.add(token)
      answer = 'pending'
      return json(200, { access_token: token, token_type: 'bearer', scope: 'repo' })
    }
    if (path === '/user') return authed() ? json(200, { login: 'octo', name: 'Octo Cat' }) : json(401, { message: 'Bad credentials' })
    if (req.method === 'POST' && path === `/repos/${f.repo}/pulls`) {
      if (!authed()) return json(401, { message: 'Bad credentials' })
      const p = JSON.parse(body) as { head: string; base: string; title: string; body: string; draft: boolean }
      const why = f.refuse ?? (f.pulls.some((x) => x.head === p.head && !x.fork) ? `A pull request already exists for ${f.repo.split('/')[0]}:${p.head}.` : null)
      f.refuse = null
      if (why) return json(422, { message: 'Validation Failed', errors: [{ resource: 'PullRequest', code: 'custom', message: why }] })
      const number = Math.max(0, ...f.pulls.map((x) => x.number)) + 1
      const made: FakePull = { number, title: p.title, author: 'octo', head: p.head, headSha: f.shaOf(p.head), base: p.base, draft: p.draft }
      f.pulls.unshift(made)
      return json(201, {
        number,
        title: p.title,
        html_url: `https://github.com/${f.repo}/pull/${number}`,
        draft: p.draft,
        updated_at: '2026-11-11T10:00:00Z',
        user: { login: 'octo' },
        head: { ref: p.head, sha: made.headSha },
        base: { ref: p.base }
      })
    }
    if (req.method === 'POST' && path === '/graphql') {
      if (!authed()) return json(401, { message: 'Bad credentials' })
      const v = (JSON.parse(body) as { variables: { owner: string; name: string } }).variables
      if (`${v.owner}/${v.name}` !== f.repo) return json(200, { data: { repository: null }, errors: [{ type: 'NOT_FOUND', message: 'Could not resolve to a Repository' }] })
      return json(200, {
        data: {
          repository: {
            defaultBranchRef: { name: 'main' },
            pullRequests: {
              nodes: f.pulls.map((p) => ({
                number: p.number,
                title: p.title,
                url: `https://github.com/${f.repo}/pull/${p.number}`,
                isDraft: !!p.draft,
                updatedAt: '2026-11-01T10:00:00Z',
                isCrossRepository: !!p.fork,
                author: { login: p.author },
                headRefName: p.head,
                headRefOid: p.headSha,
                baseRefName: p.base ?? 'main',
                reviewDecision: p.review ?? null,
                commits: { nodes: [{ commit: { statusCheckRollup: p.checks ? { state: p.checks } : null } }] }
              }))
            }
          }
        }
      })
    }
    json(404, { message: 'Not Found' })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  // The same object, not a copy: the test sets refuse and shaOf on it.
  return Object.assign(f, { url, close: () => new Promise<void>((r) => server.close(() => r())) }) as FakeGitHub
}

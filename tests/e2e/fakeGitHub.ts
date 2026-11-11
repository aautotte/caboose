// A stand-in for github.com and api.github.com, for the tests: the device flow (a code, "pending" until the test
// approves or denies it), /user, and the GraphQL query for a repository's pull requests. Every request is kept so a
// test can check what Caboose sent.
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
    repo
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
    if (req.method === 'POST' && path === '/graphql') {
      if (!authed()) return json(401, { message: 'Bad credentials' })
      const v = (JSON.parse(body) as { variables: { owner: string; name: string } }).variables
      if (`${v.owner}/${v.name}` !== f.repo) return json(200, { data: { repository: null }, errors: [{ type: 'NOT_FOUND', message: 'Could not resolve to a Repository' }] })
      return json(200, {
        data: {
          repository: {
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
  return { ...f, url, close: () => new Promise((r) => server.close(() => r())) } as FakeGitHub
}

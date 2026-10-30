// Web pages for a repository on a git host: the repository, a branch, a commit, a new pull request. Built from a
// remote's URL alone, so nothing is fetched and no account is needed.

export type HostKind = 'github' | 'gitlab' | 'bitbucket' | 'azure'

export const HOST_NAMES: Record<HostKind, string> = { github: 'GitHub', gitlab: 'GitLab', bitbucket: 'Bitbucket', azure: 'Azure DevOps' }

export interface WebRepo {
  kind: HostKind
  /** The repository's page, like https://github.com/acme/widgets. */
  base: string
}

export type WebTarget = { kind: 'repo' } | { kind: 'branch'; name: string } | { kind: 'commit'; sha: string } | { kind: 'pr'; branch: string }

/** host and path from https://, ssh://, git:// and scp-like (git@host:path) URLs; null for local paths. */
function hostAndPath(url: string): { host: string; path: string } | null {
  const u = url.trim()
  const scp = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/)(.+)$/.exec(u)
  if (scp && !/^[a-zA-Z]$/.test(scp[1])) return { host: scp[1].toLowerCase(), path: scp[2] }
  const full = /^(?:https?|ssh|git):\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+)$/i.exec(u)
  return full ? { host: full[1].toLowerCase(), path: full[2] } : null
}

const kindOfHost = (host: string): HostKind | null =>
  host.includes('github') ? 'github' : host.includes('gitlab') ? 'gitlab' : host.includes('bitbucket') ? 'bitbucket' : host === 'dev.azure.com' || host === 'ssh.dev.azure.com' || host.endsWith('.visualstudio.com') ? 'azure' : null

/**
 * Which host a remote URL is on, and its repository page. `kind` overrides the guess from the host name, for
 * self-hosted servers whose name doesn't say (git config caboose.hosting).
 */
export function webRepo(remoteUrl: string, kind?: HostKind | null): WebRepo | null {
  const hp = hostAndPath(remoteUrl)
  if (!hp) return null
  const k = kind ?? kindOfHost(hp.host)
  if (!k) return null
  const path = hp.path.replace(/\/+$/, '').replace(/\.git$/, '')
  if (k === 'azure') {
    // https://dev.azure.com/org/project/_git/repo, git@ssh.dev.azure.com:v3/org/project/repo, https://org.visualstudio.com/project/_git/repo
    const v3 = /^v3\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(path)
    if (v3) return { kind: k, base: `https://dev.azure.com/${v3[1]}/${v3[2]}/_git/${v3[3]}` }
    if (hp.host.endsWith('.visualstudio.com')) return { kind: k, base: `https://${hp.host}/${path}` }
    return { kind: k, base: `https://dev.azure.com/${path.replace(/^[^@/]+@/, '')}` }
  }
  return { kind: k, base: `https://${hp.host}/${path}` }
}

/** A branch name in a path: each part encoded, the slashes kept (feature/login stays readable). */
const pathOf = (name: string): string => name.split('/').map(encodeURIComponent).join('/')

export function webUrl(repo: WebRepo, t: WebTarget): string {
  const { kind, base } = repo
  if (t.kind === 'repo') return base
  if (t.kind === 'commit') return kind === 'gitlab' ? `${base}/-/commit/${t.sha}` : kind === 'bitbucket' ? `${base}/commits/${t.sha}` : `${base}/commit/${t.sha}`
  if (t.kind === 'branch') {
    if (kind === 'gitlab') return `${base}/-/tree/${pathOf(t.name)}`
    if (kind === 'bitbucket') return `${base}/src/${pathOf(t.name)}`
    if (kind === 'azure') return `${base}?version=GB${encodeURIComponent(t.name)}`
    return `${base}/tree/${pathOf(t.name)}`
  }
  const b = encodeURIComponent(t.branch)
  if (kind === 'gitlab') return `${base}/-/merge_requests/new?merge_request%5Bsource_branch%5D=${b}`
  if (kind === 'bitbucket') return `${base}/pull-requests/new?source=${b}`
  if (kind === 'azure') return `${base}/pullrequestcreate?sourceRef=${b}`
  return `${base}/compare/${pathOf(t.branch)}?expand=1`
}

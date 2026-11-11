// Git Flow with plain git: feature, release and hotfix branches, started from and finished into develop and the
// production branch. Its settings are the git config keys the git-flow tool uses, so a repository set up with one
// works with the other, and nothing needs installing.
import type { FlowConfig, FlowFinished, FlowKind } from '../../shared/types'
import { GcFail, invalid } from '../errors'
import type { RepoOps } from './ops'

const DEFAULT_PREFIX: Record<FlowKind, string> = { feature: 'feature/', release: 'release/', hotfix: 'hotfix/' }

/** This repository's Git Flow settings, or null when it isn't set up (no production or develop branch named). */
export async function flowConfig(o: RepoOps): Promise<FlowConfig | null> {
  const out = (await o.tryGit(['config', '--local', '-z', '--get-regexp', '^gitflow\\.'])) ?? ''
  const values = new Map<string, string>()
  for (const entry of out.split('\0').filter(Boolean)) {
    const nl = entry.indexOf('\n')
    values.set((nl < 0 ? entry : entry.slice(0, nl)).toLowerCase(), nl < 0 ? '' : entry.slice(nl + 1))
  }
  const production = values.get('gitflow.branch.master')
  const develop = values.get('gitflow.branch.develop')
  if (!production || !develop) return null
  const prefix = (k: FlowKind): string => values.get(`gitflow.prefix.${k}`) ?? DEFAULT_PREFIX[k]
  return { production, develop, prefix: { feature: prefix('feature'), release: prefix('release'), hotfix: prefix('hotfix') }, tagPrefix: values.get('gitflow.prefix.versiontag') ?? '' }
}

const hasBranch = async (o: RepoOps, name: string): Promise<boolean> => (await o.tryGit(['rev-parse', '-q', '--verify', `refs/heads/${name}`])) !== null

/** Sets Git Flow up: writes its settings, and makes the develop branch from the production one if there isn't one. */
export async function flowInit(o: RepoOps, c: FlowConfig): Promise<void> {
  await o.safeBranchName(c.production)
  await o.safeBranchName(c.develop)
  if (c.production === c.develop) throw invalid('The production and develop branches have to be different.')
  for (const k of ['feature', 'release', 'hotfix'] as const) {
    const p = c.prefix[k]
    if (!p) throw invalid(`Give ${k} branches a prefix, like ${DEFAULT_PREFIX[k]}.`)
    if ((await o.tryGit(['check-ref-format', '--branch', `${p}x`])) === null || p.startsWith('-')) throw invalid(`“${p}” can’t start a branch name.`)
  }
  if (new Set(Object.values(c.prefix)).size < 3) throw invalid('Features, releases and hotfixes need different prefixes.')
  if (c.tagPrefix && ((await o.tryGit(['check-ref-format', `refs/tags/${c.tagPrefix}1.0`])) === null || c.tagPrefix.startsWith('-'))) throw invalid(`“${c.tagPrefix}” can’t start a tag name.`)
  if (!(await hasBranch(o, c.production))) throw invalid(`There’s no local branch ${c.production}.`)
  if (!(await hasBranch(o, c.develop))) await o.mut(['branch', c.develop, c.production])
  const set = (key: string, value: string): Promise<string> => o.mut(['config', '--local', key, value])
  await set('gitflow.branch.master', c.production)
  await set('gitflow.branch.develop', c.develop)
  for (const k of ['feature', 'release', 'hotfix'] as const) await set(`gitflow.prefix.${k}`, c.prefix[k])
  await set('gitflow.prefix.versiontag', c.tagPrefix)
}

async function needConfig(o: RepoOps): Promise<FlowConfig> {
  const c = await flowConfig(o)
  if (!c) throw invalid('Git Flow isn’t set up in this repository.')
  return c
}

/** A feature from develop, or a release from develop, or a hotfix from the production branch; then checks it out. */
export async function flowStart(o: RepoOps, kind: FlowKind, name: string): Promise<string> {
  const c = await needConfig(o)
  if (!name.trim()) throw invalid(kind === 'feature' ? 'Name the feature.' : 'Give it a version, like 1.2.0.')
  const branch = await o.safeBranchName(c.prefix[kind] + name.trim())
  const base = kind === 'hotfix' ? c.production : c.develop
  if (!(await hasBranch(o, base))) throw invalid(`There’s no local branch ${base} to start from.`)
  if (await hasBranch(o, branch)) throw invalid(`A branch called ${branch} already exists.`)
  if (kind !== 'feature') {
    const open = (await o.tryGit(['for-each-ref', '--format=%(refname:short)', `refs/heads/${c.prefix[kind]}`]))?.trim()
    if (open) throw invalid(`Finish ${open.split('\n')[0]} first: Git Flow has one ${kind} at a time.`)
  }
  await o.mut(['switch', '-c', branch, base])
  return branch
}

/**
 * Merges a feature into develop; a release or hotfix into the production branch (tagged with its version), then
 * into develop. Then deletes it unless `keep`, and leaves develop checked out. Each step is skipped when it's
 * already done, so after a merge that stopped on conflicts (resolved and committed), finishing again carries on.
 */
export async function flowFinish(o: RepoOps, kind: FlowKind, name: string, opts: { keep: boolean; tagMessage: string }): Promise<FlowFinished> {
  const c = await needConfig(o)
  const branch = await o.safeBranchName(c.prefix[kind] + name)
  if (!(await hasBranch(o, branch))) throw invalid(`There’s no branch ${branch}.`)
  if ((await o.opState()).kind !== 'none') throw invalid('Finish or abort the operation in progress first.')
  if (await o.hasTrackedChanges()) throw invalid('Commit or stash your changes first: finishing switches branches.')
  for (const b of kind === 'feature' ? [c.develop] : [c.production, c.develop]) if (!(await hasBranch(o, b))) throw invalid(`There’s no local branch ${b} to finish into.`)

  const done: FlowFinished = { merged: [], tag: null, deleted: false }
  const mergeInto = async (target: string): Promise<void> => {
    if ((await o.tryGit(['merge-base', '--is-ancestor', branch, target])) !== null) return
    await o.mut(['switch', target])
    try {
      await o.mut(['merge', '--no-ff', '--no-edit', '-m', `Merge branch '${branch}' into ${target}`, branch])
    } catch (e) {
      if ((await o.opState()).kind === 'merge') {
        throw new GcFail('git', `Merging ${branch} into ${target} stopped on conflicts. Resolve them and commit the merge, then finish the ${kind} again: it carries on from there.`, e instanceof GcFail ? e.detail : undefined)
      }
      throw e
    }
    done.merged.push(target)
  }

  if (kind === 'feature') await mergeInto(c.develop)
  else {
    await mergeInto(c.production)
    const tag = await o.safeTagName(c.tagPrefix + name)
    if ((await o.tryGit(['rev-parse', '-q', '--verify', `refs/tags/${tag}`])) === null) {
      await o.mut(['tag', '-a', '-F', '-', tag, c.production], { stdin: (opts.tagMessage.trim() || `${kind === 'release' ? 'Release' : 'Hotfix'} ${name}`) + '\n' })
      done.tag = tag
    }
    await mergeInto(c.develop)
  }
  if ((await o.status()).branch !== c.develop) await o.mut(['switch', c.develop])
  if (!opts.keep) {
    try {
      await o.mut(['branch', '-d', branch])
      done.deleted = true
    } catch (e) {
      // It tracks a remote branch that's behind it: git won't call it merged. It is, here; it stays for now.
      if (!(e instanceof GcFail && /not fully merged/.test(e.detail ?? ''))) throw e
    }
  }
  return done
}

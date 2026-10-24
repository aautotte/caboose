// Screenshot mode (?shots=1): window.__gcShot('S04') puts the app into that screen's state for `npm run shots`.
import { setPrefs, useApp } from '@/store'
import * as act from '@/actions'

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function repoByName(name: string): string | undefined {
  return useApp.getState().tabs.find((t) => t.name === name)?.id
}

async function settle(repoId: string): Promise<void> {
  for (let i = 0; i < 50; i++) {
    const r = useApp.getState().repos[repoId]
    if (r && !r.loading && r.refs) return
    await wait(100)
  }
}

export function installShots(): void {
  if (new URLSearchParams(location.search).get('shots') !== '1') return
  const theme = new URLSearchParams(location.search).get('theme')
  if (theme === 'light' || theme === 'dark') setPrefs({ theme })
  window.__gcShot = async (screen: string): Promise<boolean> => {
    act.closeDialog()
    useApp.setState({ paletteOpen: false })
    const demo = repoByName('demo')
    const conflict = repoByName('conflict')
    const inRepo = async (id: string | undefined): Promise<string | null> => {
      if (!id) return null
      act.setActive(id)
      await settle(id)
      act.setCenter(id, { kind: 'graph' })
      return id
    }
    switch (screen) {
      case 'S01':
        act.setActive('home')
        break
      case 'S02':
        act.setActive('home')
        act.openDialog({ kind: 'clone' })
        break
      case 'S03':
        act.setActive('home')
        act.openDialog({ kind: 'init' })
        break
      case 'S04': {
        const id = await inRepo(demo)
        if (!id) return false
        const head = useApp.getState().repos[id]?.refs?.head.sha ?? null
        act.select(id, head)
        break
      }
      case 'S05': {
        const id = await inRepo(demo)
        if (!id) return false
        act.select(id, 'wip')
        break
      }
      case 'S06': {
        const id = await inRepo(demo)
        if (!id) return false
        const merge = useApp.getState().repos[id]?.commits.find((c) => c.parents.length > 1)
        act.select(id, merge?.sha ?? null)
        break
      }
      case 'S07': {
        const id = await inRepo(demo)
        if (!id) return false
        act.select(id, 'wip')
        act.openDiff(id, 'README.md', { kind: 'worktree' })
        break
      }
      case 'S08': {
        const id = await inRepo(demo)
        if (!id) return false
        act.setCenter(id, { kind: 'blame', path: 'src/fetch.js', rev: null })
        await wait(800)
        break
      }
      case 'S09': {
        const id = await inRepo(demo)
        if (!id) return false
        act.setCenter(id, { kind: 'history', path: 'src/fetch.js' })
        await wait(800)
        break
      }
      case 'S11': {
        const id = await inRepo(demo)
        if (!id) return false
        const base = useApp.getState().repos[id]?.commits.find((c) => c.summary === 'Update the changelog (3)')
        if (!base) return false
        act.setCenter(id, { kind: 'rebase', onto: base.sha, ontoLabel: base.sha.slice(0, 7) })
        await wait(800)
        break
      }
      case 'S04-multi':
      case 'S11-range': {
        // Three commits on the current branch picked in the graph; the range one opens S11 with just those.
        const id = await inRepo(demo)
        if (!id) return false
        const line = act.headLine(id).slice(1, 4)
        if (line.length < 3) return false
        act.select(id, line[0])
        act.extendSelect(id, line[2], line)
        if (screen === 'S11-range') act.rebaseRange(id, line)
        await wait(800)
        break
      }
      case 'S10': {
        const id = await inRepo(conflict)
        if (!id) return false
        act.select(id, 'wip')
        const file = useApp.getState().repos[id]?.status?.changes.find((c) => c.conflicted)
        if (!file) return false
        act.setCenter(id, { kind: 'merge', path: file.path })
        break
      }
      case 'S12': {
        const id = await inRepo(demo)
        if (!id) return false
        useApp.setState({ paletteOpen: true })
        break
      }
      case 'S13': {
        const id = await inRepo(demo)
        if (!id) return false
        act.setCenter(id, { kind: 'prefs' })
        break
      }
      case 'S14':
        act.openDialog({ kind: 'shortcuts' })
        break
      case 'S15': {
        const id = await inRepo(demo)
        if (!id) return false
        const head = useApp.getState().repos[id]?.refs?.head
        const target = useApp.getState().repos[id]?.commits.find((c) => c.summary === 'Update the changelog (5)')
        act.openDialog(
          target
            ? { kind: 'reset', repoId: id, target: target.sha, targetLabel: target.sha.slice(0, 7) }
            : { kind: 'createBranch', repoId: id, at: head?.sha ?? 'HEAD', atLabel: head?.branch ?? 'HEAD' }
        )
        break
      }
      case 'S16': {
        const id = await inRepo(demo)
        if (!id) return false
        act.setCenter(id, { kind: 'log' })
        break
      }
      default:
        return false
    }
    await wait(700)
    return true
  }
}

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/app.css'
import { DesignPage } from './design/DesignPage'
import { App } from './shell/App'
import { patchRepo, useApp } from './store'
import { openDiff } from './actions'

const params = new URLSearchParams(location.search)
const view = params.get('view')

// End-to-end tests (GC_TEST=1) read the app's state; a JSON copy, so tests can't change it.
if (params.get('test') === '1') {
  ;(window as unknown as { __gcState: () => unknown }).__gcState = () => JSON.parse(JSON.stringify(useApp.getState()))
  // Opens a file's diff the way clicking it does, for states a click can't reach on cue.
  ;(window as unknown as { __gcOpenDiff: typeof openDiff }).__gcOpenDiff = openDiff
  // Makes a repository's pull requests old enough to be read again, without waiting minutes.
  ;(window as unknown as { __gcAgePulls: (repoId: string) => void }).__gcAgePulls = (repoId) => patchRepo(repoId, { pullsAt: 0 })
}

createRoot(document.getElementById('root')!).render(<StrictMode>{view === 'design' ? <DesignPage /> : <App />}</StrictMode>)

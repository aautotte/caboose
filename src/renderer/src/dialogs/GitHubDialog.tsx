import { useEffect, useRef, useState } from 'react'
import { Copy } from 'lucide-react'
import type { DeviceCode } from '../../../shared/types'
import { Button, Dialog, Spinner } from '@/ui'
import { call } from '@/lib/api'
import * as act from '@/actions'

/**
 * Signing in to GitHub with the device flow: GitHub gives a short code, you type it at its page and authorize
 * Caboose there, and the sign-in arrives here on its own. No password or token passes through Caboose.
 */
export function GitHubSignInDialog(): React.JSX.Element {
  const [code, setCode] = useState<DeviceCode | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [opened, setOpened] = useState(false)
  const [round, setRound] = useState(0)
  const open = useRef(true)

  useEffect(() => {
    open.current = true
    setCode(null)
    setError(null)
    setOpened(false)
    call('github.startSignIn', {})
      .then((c) => {
        if (!open.current) return
        setCode(c)
        return call('github.waitSignIn', {}).then((user) => {
          if (!open.current) return
          act.closeDialog()
          act.signedInToGitHub(user)
        })
      })
      .catch((e: Error) => open.current && setError(e.message))
    return () => {
      open.current = false
    }
  }, [round])

  const close = (): void => {
    open.current = false
    void call('github.cancelSignIn', {}).catch(() => {})
    act.closeDialog()
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && close()}
      title="Sign in to GitHub"
      error={error ?? undefined}
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          {error ? (
            <Button variant="primary" onClick={() => setRound((n) => n + 1)}>
              Try again
            </Button>
          ) : (
            <Button
              variant="primary"
              icon={<Copy size={14} />}
              disabled={!code}
              onClick={() => {
                if (!code) return
                setOpened(true)
                void call('github.openDevicePage', code).catch((e: Error) => setError(e.message))
              }}
            >
              Copy the code and open GitHub
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-base text-text">On GitHub’s page, paste this code, then authorize Caboose. It can then read your repositories’ pull requests, private ones too.</p>
        {code ? (
          <p aria-label="Your code" className="self-center rounded-md border border-border bg-surface-sunken px-4 py-2 font-mono text-2xl tracking-widest text-text select-all">
            {code.userCode}
          </p>
        ) : !error ? (
          <p className="flex items-center gap-2 self-center text-sm text-muted">
            <Spinner size={14} /> Asking GitHub for a code…
          </p>
        ) : null}
        {code && !error ? (
          <p role="status" className="flex items-center gap-2 text-sm text-muted">
            <Spinner size={14} />
            {opened ? 'Waiting for you to authorize Caboose on GitHub…' : `The code works for ${Math.round(code.expiresIn / 60)} minutes.`}
          </p>
        ) : null}
      </div>
    </Dialog>
  )
}

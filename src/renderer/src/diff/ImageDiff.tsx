import { useEffect, useState } from 'react'
import { FileWarning } from 'lucide-react'
import type { DiffSource, ImageDiff as Images, ImageSide } from '../../../shared/types'
import { EmptyState, SegmentedControl } from '@/ui'
import { call } from '@/lib/api'
import { fileSize } from '@/lib/format'

type Layout = 'side' | 'swipe' | 'onion'

/** An image's two versions, for a binary diff: side by side, or one over the other with a slider (swipe, or fade). */
export function ImageDiff({ repoId, path, oldPath, source, reload }: { repoId: string; path: string; oldPath?: string; source: DiffSource; reload: unknown }): React.JSX.Element {
  const [images, setImages] = useState<Images | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [layout, setLayout] = useState<Layout>('side')
  const [at, setAt] = useState(50)
  const [dims, setDims] = useState<{ old?: string; new?: string }>({})
  const srcKey = JSON.stringify(source)

  useEffect(() => {
    let live = true
    setError(null)
    call('diff.images', { repoId, path, oldPath, source })
      .then((v) => {
        if (!live) return
        setImages(v)
        setDims({})
      })
      .catch((e: Error) => live && setError(e.message))
    return () => {
      live = false
    }
    // srcKey stands in for source; `reload` changes when the file may have
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoId, path, oldPath, srcKey, reload])

  if (error) return <EmptyState icon={FileWarning} title="Couldn’t show this image" body={error} />
  if (!images) return <div role="status" aria-label="Loading image" className="p-4" />

  const name = path.split('/').pop() ?? path
  const url = (s: ImageSide): string => `data:${images.mime};base64,${s.data}`
  const measured = (which: 'old' | 'new') => (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget
    setDims((d) => ({ ...d, [which]: `${img.naturalWidth} × ${img.naturalHeight}` }))
  }
  const both = !!images.old?.data && !!images.new?.data
  const pane = (which: 'old' | 'new', label: string): React.JSX.Element => {
    const s = images[which]
    return (
      <figure className="flex min-w-0 flex-1 flex-col items-center gap-2">
        <figcaption className="text-sm text-muted">
          <span className="font-medium text-text">{label}</span>
          {s ? ` · ${[dims[which], fileSize(s.size)].filter(Boolean).join(' · ')}` : ''}
        </figcaption>
        {!s ? (
          <p className="text-sm text-muted">Not in this version.</p>
        ) : s.data ? (
          <img src={url(s)} alt={`${name}, ${label.toLowerCase()}`} onLoad={measured(which)} className="max-w-full border border-border bg-surface-sunken object-contain" />
        ) : (
          <p className="text-sm text-muted">Too large to show here ({fileSize(s.size)}).</p>
        )}
      </figure>
    )
  }

  return (
    <section aria-label={`Image ${name}`} className="flex flex-col gap-3 p-4 font-sans">
      {both ? (
        <div className="flex flex-wrap items-center gap-3">
          <SegmentedControl
            label="Compare images"
            value={layout}
            onValueChange={(v: Layout) => setLayout(v)}
            options={[
              { value: 'side', label: 'Side by side' },
              { value: 'swipe', label: 'Swipe' },
              { value: 'onion', label: 'Onion skin' }
            ]}
          />
          {layout !== 'side' ? (
            <input
              type="range"
              min={0}
              max={100}
              value={at}
              onChange={(e) => setAt(Number(e.target.value))}
              aria-label={layout === 'swipe' ? 'How much of the new version shows' : 'How strongly the new version shows'}
              className="w-48 max-w-full accent-accent"
            />
          ) : null}
        </div>
      ) : null}
      {both && layout !== 'side' ? (
        <figure className="flex flex-col items-center gap-2">
          <figcaption className="text-sm text-muted">
            <span className="font-medium text-text">Before</span> {dims.old ? `· ${dims.old}` : ''} ·{' '}
            <span className="font-medium text-text">After</span> {dims.new ? `· ${dims.new}` : ''}
          </figcaption>
          {/* Both in one grid cell, the new one over the old, from the top left. */}
          <div className="grid max-w-full border border-border bg-surface-sunken">
            <img src={url(images.old!)} alt={`${name}, before`} onLoad={measured('old')} className="col-start-1 row-start-1 max-w-full" />
            <img
              src={url(images.new!)}
              alt={`${name}, after`}
              onLoad={measured('new')}
              className="col-start-1 row-start-1 max-w-full"
              style={layout === 'swipe' ? { clipPath: `inset(0 ${100 - at}% 0 0)` } : { opacity: at / 100 }}
            />
          </div>
        </figure>
      ) : (
        <div className="flex flex-wrap items-start gap-4">
          {images.old || !images.new ? pane('old', 'Before') : null}
          {images.new || !images.old ? pane('new', 'After') : null}
        </div>
      )}
    </section>
  )
}

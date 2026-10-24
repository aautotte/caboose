import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { GpuState } from '../shared/types'

/**
 * Graphics acceleration, decided before the app is ready. Off when you turned it off, or when the GPU process
 * crashed last time (some Linux drivers and VMs): the next start draws in software instead of failing to open.
 * Kept in a small file next to the database, because the database is per profile and this is per machine.
 */
interface Saved {
  off: boolean
  reason: 'crash' | 'you'
  /** A crash fallback is announced once, on the first start after it. */
  told: boolean
}

const file = (): string => join(app.getPath('userData'), 'gpu.json')

function read(): Saved | null {
  try {
    return existsSync(file()) ? (JSON.parse(readFileSync(file(), 'utf8')) as Saved) : null
  } catch {
    return null
  }
}

function write(s: Saved | null): void {
  writeFileSync(file(), JSON.stringify(s ?? { off: false, reason: 'you', told: true }))
}

/** Call before app.whenReady(). */
export function applyGpuSetting(): void {
  if (read()?.off) app.disableHardwareAcceleration()
  app.on('child-process-gone', (_e, d) => {
    if (d.type !== 'GPU' || d.reason === 'clean-exit' || !app.isHardwareAccelerationEnabled()) return
    write({ off: true, reason: 'crash', told: false })
  })
}

export function gpuState(): GpuState {
  const s = read()
  const fellBack = !!s?.off && s.reason === 'crash' && !s.told && !app.isHardwareAccelerationEnabled()
  if (fellBack) write({ ...s!, told: true })
  return { enabled: app.isHardwareAccelerationEnabled(), nextStart: !s?.off, fellBack }
}

export function setGpu(on: boolean): void {
  write(on ? null : { off: true, reason: 'you', told: true })
}

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

const EVENTS = new Set(['repo:changed', 'op:progress', 'op:output', 'auth:prompt', 'auth:closed'])

// The only bridge between the sandboxed renderer and the main process. Channels are checked in main.
contextBridge.exposeInMainWorld('gc', {
  platform: process.platform,
  invoke: (channel: string, input: unknown) => ipcRenderer.invoke(channel, input),
  on: (event: string, cb: (payload: unknown) => void) => {
    if (!EVENTS.has(event)) throw new Error(`Unknown event ${event}`)
    const listener = (_e: IpcRendererEvent, payload: unknown): void => cb(payload)
    ipcRenderer.on(event, listener)
    return () => ipcRenderer.removeListener(event, listener)
  }
})

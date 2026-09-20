import { contextBridge, ipcRenderer } from 'electron'

const api = {
  onTheme(callback: (css: string) => void): () => void {
    const handler = (_event: unknown, css: string): void => callback(css)
    ipcRenderer.on('notification:theme', handler)
    return () => ipcRenderer.off('notification:theme', handler)
  },
  ready(): void {
    ipcRenderer.send('notification:ready')
  },
  action(notificationId: string, action: 'open' | 'dismiss'): void {
    ipcRenderer.send('notification:action', { notificationId, action })
  },
  hover(paused: boolean): void {
    ipcRenderer.send('notification:hover', { paused: paused === true })
  },
  onFocus(callback: () => void): () => void {
    const handler = (): void => callback()
    ipcRenderer.on('notification:focus', handler)
    return () => ipcRenderer.off('notification:focus', handler)
  },
  onUpdate(callback: (cards: unknown[]) => void): () => void {
    const handler = (_event: unknown, cards: unknown[]): void => callback(cards)
    ipcRenderer.on('notification:update', handler)
    return () => ipcRenderer.off('notification:update', handler)
  },
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('piNotify', api)
} else {
  // @ts-expect-error isolated fallback
  window.piNotify = api
}

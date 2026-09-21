import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isAllowedIpcChannel } from '@shared/ipc-channels'
import { registerAppUpdateHandlers } from './app-update'

const mocks = vi.hoisted(() => ({ handlers: new Map<string, (data?: unknown) => Promise<unknown>>(), download: vi.fn(), install: vi.fn(), check: vi.fn(), open: vi.fn() }))
vi.mock('electron', () => ({ ipcMain: { handle: (name: string, callback: (event: object, data: unknown) => Promise<unknown>) => mocks.handlers.set(name, (data) => callback({}, data)), removeHandler: vi.fn() } }))
vi.mock('../../app-updater', () => ({
  appUpdateController: () => ({ state: { phase: 'idle' }, check: mocks.check, download: mocks.download, install: mocks.install, ignore: vi.fn() }),
  openAppReleasePage: mocks.open,
}))

beforeEach(() => { vi.clearAllMocks(); registerAppUpdateHandlers() })

describe('update IPC boundary', () => {
  it('exposes only explicit allowlisted actions', async () => {
    for (const name of mocks.handlers.keys()) expect(isAllowedIpcChannel(name)).toBe(true)
    await mocks.handlers.get('ipc:app.update.check')!({})
    expect(mocks.check).toHaveBeenCalledWith(true)
    await mocks.handlers.get('ipc:app.update.openRelease')!({})
    expect(mocks.open).toHaveBeenCalledWith()
  })

  it('rejects caller-selected feeds and paths and removes the auto-check preference action', async () => {
    await expect(mocks.handlers.get('ipc:app.update.download')!({ url: 'https://evil.example/app.exe' })).rejects.toThrow('Invalid IPC input')
    await expect(mocks.handlers.get('ipc:app.update.install')!({ path: 'C:/tmp/app.exe' })).rejects.toThrow('Invalid IPC input')
    expect(mocks.handlers.has('ipc:app.update.autoCheck')).toBe(false)
    expect(isAllowedIpcChannel('ipc:app.update.autoCheck')).toBe(false)
    expect(mocks.download).not.toHaveBeenCalled()
    expect(mocks.install).not.toHaveBeenCalled()
  })
})

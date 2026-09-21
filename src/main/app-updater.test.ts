import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ check: vi.fn(), create: vi.fn(), packaged: true }))
vi.mock('electron', () => ({
  app: { get isPackaged() { return mocks.packaged }, getVersion: () => '1.0.9' }, shell: {},
}))
vi.mock('electron-updater', () => ({ default: { autoUpdater: {} } }))
vi.mock('./window', () => ({ getMainWindow: () => null }))
vi.mock('./ipc/registry', () => ({ sendEvent: vi.fn() }))
vi.mock('./config-store', () => ({ configStore: { get: () => false, set: vi.fn() } }))
vi.mock('./app-update-controller', () => ({ AppUpdateController: class {
  constructor(options: unknown) { mocks.create(options) }
  check = mocks.check
} }))
afterEach(() => vi.useRealTimers())

describe('startup update scheduling', () => {
  it('checks exactly once per app launch, never periodically, and cancels a pending startup check on quit', async () => {
    vi.useFakeTimers()
    vi.resetModules()
    mocks.packaged = true
    mocks.check.mockClear()
    const updater = await import('./app-updater')
    const options = { busy: () => false, prepareInstall: async () => {} }
    updater.initializeAppUpdater(options)
    updater.initializeAppUpdater(options)
    expect(mocks.check).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(3000)
    expect(mocks.check).toHaveBeenCalledExactlyOnceWith(false)
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000)
    expect(mocks.check).toHaveBeenCalledOnce()
    updater.stopAppUpdateChecks()
    vi.resetModules()
    const nextLaunch = await import('./app-updater')
    nextLaunch.initializeAppUpdater(options)
    nextLaunch.stopAppUpdateChecks()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(mocks.check).toHaveBeenCalledOnce()
  })

  it('does not schedule release checks in development mode', async () => {
    vi.useFakeTimers()
    vi.resetModules()
    mocks.packaged = false
    mocks.check.mockClear()
    const updater = await import('./app-updater')
    updater.initializeAppUpdater({ busy: () => false, prepareInstall: async () => {} })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(mocks.check).not.toHaveBeenCalled()
  })
})

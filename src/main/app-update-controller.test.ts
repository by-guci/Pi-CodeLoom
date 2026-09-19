import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppUpdateController, type UpdateEngine } from './app-update-controller'

const info = { version: '1.0.8', files: [{ url: 'Pi-CodeLoom-Setup-1.0.8-x64.exe', sha512: 'digest', size: 100 }], releaseNotes: 'Fix conversation navigation' }

function setup(mode: 'automatic' | 'manual' | 'development' = 'automatic') {
  const engine = Object.assign(new EventEmitter(), {
    autoDownload: true, autoInstallOnAppQuit: true, allowDowngrade: true, allowPrerelease: true,
    setFeedURL: vi.fn(), checkForUpdates: vi.fn(async () => { engine.emit('update-available', info); return {} }),
    downloadUpdate: vi.fn(async () => { engine.emit('update-downloaded', info); return ['update.exe'] }),
    quitAndInstall: vi.fn(),
  })
  const prefs = { autoCheck: true, ignoredVersion: null as string | null, lastCheckedAt: null as number | null }
  const notify = vi.fn()
  const busy = vi.fn(() => false)
  const prepareInstall = vi.fn(async () => {})
  const controller = new AppUpdateController({
    engine: engine as unknown as UpdateEngine, currentVersion: '1.0.7', mode,
    preferences: () => prefs, save: (patch) => Object.assign(prefs, patch), notify, busy, prepareInstall,
  })
  return { controller, engine, prefs, notify, busy, prepareInstall }
}

describe('desktop app updates', () => {
  beforeEach(() => vi.useRealTimers())

  it('pins the public release source and requires explicit download and installation', async () => {
    const { controller, engine } = setup()
    expect(engine.setFeedURL).toHaveBeenCalledWith(expect.objectContaining({ provider: 'github', owner: 'by-guci', repo: 'Pi-CodeLoom', private: false }))
    expect(engine).toMatchObject({ autoDownload: false, autoInstallOnAppQuit: false, allowDowngrade: false, allowPrerelease: false, disableWebInstaller: true })
    await controller.check(true)
    expect(controller.state).toMatchObject({ phase: 'available', version: '1.0.8', notes: 'Fix conversation navigation', notify: true })
    expect(engine.downloadUpdate).not.toHaveBeenCalled()
  })

  it('deduplicates concurrent checks and does not replace a downloaded update', async () => {
    const { controller, engine } = setup()
    let resolve!: () => void
    engine.checkForUpdates.mockImplementationOnce(() => new Promise((done) => { resolve = () => done({}) }))
    const first = controller.check(true)
    await controller.check(true)
    expect(engine.checkForUpdates).toHaveBeenCalledTimes(1)
    engine.emit('update-available', info)
    resolve()
    await first
    await controller.download()
    await controller.check(true)
    expect(controller.state.phase).toBe('downloaded')
    expect(engine.checkForUpdates).toHaveBeenCalledTimes(1)
  })

  it('keeps ignored versions quiet automatically, but manual checks can find them', async () => {
    const { controller, prefs } = setup()
    await controller.check(true)
    controller.ignore()
    expect(prefs.ignoredVersion).toBe('1.0.8')
    prefs.lastCheckedAt = null
    await controller.check(false)
    expect(controller.state.notify).toBe(false)
    await controller.check(true)
    expect(controller.state.notify).toBe(true)
  })

  it('honors disabled automatic checks, cooldown, and development mode', async () => {
    const { controller, engine, prefs } = setup()
    prefs.autoCheck = false
    await controller.check(false)
    expect(engine.checkForUpdates).not.toHaveBeenCalled()
    prefs.autoCheck = true
    prefs.lastCheckedAt = Date.now()
    await controller.check(false)
    expect(engine.checkForUpdates).not.toHaveBeenCalled()
    await controller.check(true)
    expect(engine.checkForUpdates).toHaveBeenCalledOnce()
    const dev = setup('development')
    await dev.controller.check(true)
    expect(dev.engine.checkForUpdates).not.toHaveBeenCalled()
  })

  it('reports an actual no-update result separately from failed checks and missing releases', async () => {
    const { controller, engine } = setup()
    engine.checkForUpdates.mockImplementationOnce(async () => { engine.emit('update-not-available', info); return {} })
    await controller.check(true)
    expect(controller.state.phase).toBe('up-to-date')
    engine.checkForUpdates.mockRejectedValueOnce(new Error('network unavailable'))
    await controller.check(true)
    expect(controller.state).toMatchObject({ phase: 'error', error: 'check-failed' })
    engine.checkForUpdates.mockRejectedValueOnce(Object.assign(new Error('no release'), { code: 'ERR_UPDATER_LATEST_VERSION_NOT_FOUND' }))
    await controller.check(true)
    expect(controller.state).toMatchObject({ phase: 'error', error: 'no-release' })
  })

  it.each(['https://evil.example/update.exe', 'https://github.com/other/app/releases/download/v1/app.exe', '../update.exe', '//evil.example/update.exe', 'file:///tmp/update.exe'])(
    'rejects an untrusted artifact %s', async (url) => {
      const { controller, engine } = setup()
      engine.checkForUpdates.mockImplementationOnce(async () => { engine.emit('update-available', { ...info, files: [{ url }] }); return {} })
      await controller.check(true)
      await controller.download()
      expect(controller.state.error).toBe('invalid-update')
      expect(engine.downloadUpdate).not.toHaveBeenCalled()
    },
  )

  it('reports progress and keeps a failed download retryable', async () => {
    const { controller, engine } = setup()
    await controller.check(true)
    engine.downloadUpdate.mockImplementationOnce(async () => {
      engine.emit('download-progress', { percent: 42, transferred: 42, total: 100, bytesPerSecond: 20 })
      expect(controller.state).toMatchObject({ phase: 'downloading', percent: 42 })
      throw new Error('connection lost')
    })
    await controller.download()
    expect(controller.state).toMatchObject({ phase: 'available', error: 'download-failed', percent: null })
    await controller.download()
    expect(controller.state.phase).toBe('downloaded')
  })

  it('blocks installation during an active turn and waits for shutdown before launching the installer', async () => {
    const { controller, engine, busy, prepareInstall } = setup()
    await controller.check(true)
    await controller.download()
    busy.mockReturnValue(true)
    await controller.install()
    expect(controller.state).toMatchObject({ phase: 'downloaded', error: 'busy' })
    expect(prepareInstall).not.toHaveBeenCalled()
    busy.mockReturnValue(false)
    prepareInstall.mockImplementation(async () => { expect(engine.quitAndInstall).not.toHaveBeenCalled() })
    await controller.install()
    expect(prepareInstall).toHaveBeenCalledOnce()
    expect(engine.quitAndInstall).toHaveBeenCalledWith(false, true)
    expect(controller.state.phase).toBe('installing')
  })

  it('never downloads or installs a portable/manual build', async () => {
    const { controller, engine } = setup('manual')
    await controller.check(true)
    expect(controller.state.phase).toBe('available')
    await controller.download()
    await controller.install()
    expect(engine.downloadUpdate).not.toHaveBeenCalled()
    expect(engine.quitAndInstall).not.toHaveBeenCalled()
  })
})

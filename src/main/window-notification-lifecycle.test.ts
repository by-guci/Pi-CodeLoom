import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CompletionCard } from './completion-notification-controller'

const updates = vi.hoisted(() => ({ installing: false, initialize: vi.fn(), stop: vi.fn() }))
vi.mock('./app-updater', () => ({
  initializeAppUpdater: updates.initialize,
  isAppUpdateInstalling: () => updates.installing,
  stopAppUpdateChecks: updates.stop,
}))

const electron = await vi.hoisted(async () => {
  const { EventEmitter } = await import('node:events')
  const windows: FakeWindow[] = []
  const trays: FakeTray[] = []
  const state = { active: false, allClosed: false, nextHostLoad: null as Promise<void> | null }
  const stop = vi.fn(async () => { state.active = false })
  const setMainWindow = vi.fn()
  const event = () => ({ prevented: false, preventDefault() { this.prevented = true } })
  const app = Object.assign(new EventEmitter(), {
    whenReady: () => Promise.resolve(),
    requestSingleInstanceLock: () => true,
    getPath: () => 'test-user-data',
    quit: vi.fn(() => {
      const request = event()
      app.emit('before-quit', request)
      if (!request.prevented) for (const win of [...windows]) if (!win.destroyed) win.close()
    }),
    exit: vi.fn(() => {
      for (const win of [...windows]) if (!win.destroyed) win.destroy()
    }),
  })
  const ipcMain = new EventEmitter()

  class FakeWindow extends EventEmitter {
    destroyed = false
    visible = false
    minimized = false
    bounds = { x: 0, y: 0, width: 1200, height: 800 }
    webContents = Object.assign(new EventEmitter(), { send: vi.fn(), reload: vi.fn(), setWindowOpenHandler: vi.fn() })
    show = vi.fn(() => { this.visible = true })
    showInactive = vi.fn(() => { this.visible = true })
    hide = vi.fn(() => { this.visible = false })
    focus = vi.fn()
    restore = vi.fn(() => { this.minimized = false })
    setMenu = vi.fn()
    isDestroyed = () => this.destroyed
    isVisible = () => this.visible
    isMinimized = () => this.minimized
    isMaximized = () => false
    isFullScreen = () => false
    getBounds = () => this.bounds
    getNormalBounds = () => this.bounds
    setBounds = (bounds: typeof this.bounds) => { this.bounds = bounds }
    loadFile = vi.fn(async () => { if (!this.destroyed) this.emit('ready-to-show') })
    loadURL = vi.fn(async () => {
      const pending = state.nextHostLoad
      state.nextHostLoad = null
      if (pending) await pending
      if (!this.destroyed) ipcMain.emit('notification:ready', { sender: this.webContents })
    })
    close = vi.fn(() => {
      if (this.destroyed) return
      const request = event()
      this.emit('close', request)
      if (!request.prevented && !this.destroyed) this.destroy()
    })
    destroy = vi.fn(() => {
      if (this.destroyed) return
      this.destroyed = true
      this.visible = false
      this.emit('closed')
      if (!windows.some((win) => !win.destroyed) && !state.allClosed) {
        state.allClosed = true
        app.emit('window-all-closed')
      }
    })
    constructor(readonly options: { title?: string } = {}) {
      super()
      windows.push(this)
      state.allClosed = false
    }
    static getAllWindows() { return windows.filter((win) => !win.destroyed) }
  }

  class FakeTray extends EventEmitter {
    setToolTip = vi.fn()
    destroy = vi.fn()
    constructor() { super(); trays.push(this) }
  }

  class FakeNotification extends EventEmitter {
    static instances: FakeNotification[] = []
    constructor(readonly options: unknown) { super(); FakeNotification.instances.push(this) }
    static isSupported() { return true }
    show = vi.fn()
  }

  return { app, ipcMain, FakeWindow, FakeTray, FakeNotification, windows, trays, state, stop, setMainWindow }
})

vi.mock('electron', () => ({
  nativeTheme: { shouldUseDarkColors: false, on: vi.fn() },
  app: electron.app,
  BrowserWindow: electron.FakeWindow,
  Tray: electron.FakeTray,
  Notification: electron.FakeNotification,
  ipcMain: electron.ipcMain,
  shell: { openExternal: vi.fn() },
  dialog: { showMessageBox: vi.fn() },
  session: { defaultSession: { webRequest: { onHeadersReceived: vi.fn() } } },
  Menu: { setApplicationMenu: vi.fn(), buildFromTemplate: () => ({ popup: vi.fn() }) },
  screen: {
    getCursorScreenPoint: () => ({ x: 0, y: 0 }),
    getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
  },
}))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))
vi.mock('./bootstrap-path', () => ({}))
vi.mock('./ipc', () => ({ registerAllHandlers: vi.fn() }))
vi.mock('./worker-manager', () => ({ workerManager: {
  get hasActiveTurns() { return electron.state.active },
  stop: electron.stop,
  setMainWindow: electron.setMainWindow,
} }))
vi.mock('./config-store', () => ({ configStore: { get: (key: string) => key === 'language' ? 'en' : null, set: vi.fn() } }))
vi.mock('./app-icon', () => ({ resolveAppIcon: () => 'fixture-icon' }))
vi.mock('./git-workspace-watch', () => ({ refreshGitWorkspaceWatch: vi.fn() }))
vi.mock('./session-preview-process', () => ({ sessionPreviewProcess: { stop: vi.fn() } }))
vi.mock('./clipboard-temp-images', () => ({ pruneStaleClipboardImages: vi.fn() }))
vi.mock('./ipc/sdk-session', () => ({ warmSdkModules: vi.fn() }))
vi.mock('./audio-trace', () => ({ traceAudio: vi.fn(), getAudioTraceLogHint: () => 'fixture' }))
vi.mock('./session-file-meta', () => ({ readSessionMetaFromFile: () => ({ sessionId: 'session' }) }))
vi.mock('./completion-notification-settings', () => ({ readCompletionNotificationSettings: vi.fn(), setCompletionDndUntil: vi.fn() }))

const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')!
type ErrorListener = (error: Error) => void
let disposeNotifications: (() => void) | undefined
let initialProcessListeners: NodeJS.UncaughtExceptionListener[]
let initialStdoutListeners: ErrorListener[]
let initialStderrListeners: ErrorListener[]

beforeEach(() => {
  updates.installing = false
  updates.initialize.mockClear()
  updates.stop.mockClear()
  vi.resetModules()
  vi.useFakeTimers()
  vi.stubEnv('PI_E2E', '1')
  electron.app.removeAllListeners()
  electron.ipcMain.removeAllListeners()
  electron.windows.length = 0
  electron.trays.length = 0
  electron.FakeNotification.instances.length = 0
  electron.state.active = false
  electron.state.allClosed = false
  electron.state.nextHostLoad = null
  electron.stop.mockClear()
  electron.setMainWindow.mockClear()
  electron.app.quit.mockClear()
  electron.app.exit.mockClear()
  initialProcessListeners = process.listeners('uncaughtException')
  initialStdoutListeners = process.stdout.listeners('error') as unknown as ErrorListener[]
  initialStderrListeners = process.stderr.listeners('error') as unknown as ErrorListener[]
})

afterEach(() => {
  electron.app.removeAllListeners()
  disposeNotifications?.()
  for (const win of electron.windows) win.destroy()
  for (const listener of process.listeners('uncaughtException')) if (!initialProcessListeners.includes(listener)) process.removeListener('uncaughtException', listener)
  for (const listener of process.stdout.listeners('error') as ErrorListener[]) if (!initialStdoutListeners.includes(listener)) process.stdout.removeListener('error', listener)
  for (const listener of process.stderr.listeners('error') as ErrorListener[]) if (!initialStderrListeners.includes(listener)) process.stderr.removeListener('error', listener)
  Object.defineProperty(process, 'platform', platformDescriptor)
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

async function flushLifecycle() {
  for (let i = 0; i < 12; i++) await Promise.resolve()
}

async function start(platform: 'win32' | 'darwin') {
  Object.defineProperty(process, 'platform', { ...platformDescriptor, value: platform })
  const windowModule = await import('./window')
  const delivery = await import('./completion-notification-delivery')
  const guard = await import('./window-close-guard')
  disposeNotifications = (await import('./completion-notification')).disposeCompletionNotifications
  await import('./index')
  await flushLifecycle()
  const main = windowModule.getMainWindow() as unknown as InstanceType<typeof electron.FakeWindow>
  expect(main).toBeTruthy()
  return { ...windowModule, ...delivery, ...guard, main }
}

function card(notificationId = 'notification-1'): CompletionCard {
  return {
    notificationId,
    workspaceId: '/project',
    sessionId: 'session',
    outcome: 'success',
    copy: {
      projectLabel: 'project',
      title: 'Done',
      body: 'Finished',
      meta: 'Done',
      openLabel: 'Open',
      dismissLabel: 'Dismiss',
      muteLabel: 'Mute',
    },
    sound: false,
    timeoutMs: 1000,
  }
}

describe('main window and notification lifecycle', () => {
  it('uses a system notification when explicitly selected and restores the session on click', async () => {
    const runtime = await start('win32')
    runtime.main.hide()
    await runtime.presentCompletionCard({ ...card(), sessionFile: 'C:/sessions/example.jsonl' }, 'system')
    expect(electron.windows).toHaveLength(1)
    const notification = electron.FakeNotification.instances[0]
    expect(notification.options).toMatchObject({ title: 'Done', body: 'Finished' })
    expect(notification.show).toHaveBeenCalledOnce()
    notification.emit('click')
    await flushLifecycle()
    expect(runtime.main.isVisible()).toBe(true)
    expect(runtime.main.webContents.send).toHaveBeenCalledWith('ipc:notification-open-session', expect.objectContaining({ ok: true, sessionId: 'session', sessionFile: 'C:/sessions/example.jsonl' }))
  })
  it('lets an explicit update quit complete without replacing it with app.exit', async () => {
    const runtime = await start('win32')
    updates.installing = true
    const event = { preventDefault: vi.fn() }
    electron.app.emit('before-quit', event)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(electron.app.exit).not.toHaveBeenCalled()
    expect(updates.stop).toHaveBeenCalledOnce()
    expect(runtime.main.isDestroyed()).toBe(false)
  })
  it('destroys an expired hidden notification host when the main window closes on Windows', async () => {
    const runtime = await start('win32')
    await runtime.presentCompletionCard(card(), 'custom')
    const host = electron.windows.find((win) => win !== runtime.main)!
    vi.advanceTimersByTime(1100)
    expect(host.visible).toBe(false)
    expect(host.destroyed).toBe(false)
    runtime.main.close()
    await flushLifecycle()
    expect(host.destroyed).toBe(true)
    expect(runtime.getMainWindow()).toBeNull()
    expect(electron.FakeWindow.getAllWindows()).toHaveLength(0)
    expect(electron.stop).toHaveBeenCalledOnce()
    expect(electron.app.quit).toHaveBeenCalled()
  })

  it('keeps the main window and notification alive when a running close is cancelled', async () => {
    const runtime = await start('win32')
    await runtime.presentCompletionCard(card(), 'custom')
    const host = electron.windows.find((win) => win !== runtime.main)!
    electron.windows.reverse()
    electron.state.active = true
    runtime.destroyWindow()
    expect(runtime.main.webContents.send).toHaveBeenCalledWith('ipc:close-requested', { isStreaming: true })
    expect(host.webContents.send).not.toHaveBeenCalledWith('ipc:close-requested', expect.anything())
    runtime.handleCloseDecision('cancel')
    expect(runtime.getMainWindow()).toBe(runtime.main)
    expect(runtime.main.destroyed).toBe(false)
    expect(host.destroyed).toBe(false)
    expect(electron.stop).not.toHaveBeenCalled()
  })

  it.each(['now', 'wait'] as const)('cleans up the notification only after the approved %s close', async (decision) => {
    const runtime = await start('win32')
    await runtime.presentCompletionCard(card(), 'custom')
    const host = electron.windows.find((win) => win !== runtime.main)!
    electron.state.active = true
    runtime.main.close()
    expect(host.destroyed).toBe(false)
    runtime.handleCloseDecision(decision)
    if (decision === 'wait') {
      expect(runtime.main.destroyed).toBe(false)
      electron.state.active = false
      vi.advanceTimersByTime(500)
    }
    await flushLifecycle()
    expect(runtime.main.destroyed).toBe(true)
    expect(host.destroyed).toBe(true)
    expect(electron.stop).toHaveBeenCalledOnce()
  })

  it('reopens the main window on macOS and shuts down workers again on a later close', async () => {
    const runtime = await start('darwin')
    await runtime.presentCompletionCard(card(), 'custom')
    runtime.main.close()
    await flushLifecycle()
    expect(electron.app.quit).not.toHaveBeenCalled()
    electron.app.emit('activate')
    await flushLifecycle()
    const reopened = runtime.getMainWindow() as unknown as InstanceType<typeof electron.FakeWindow>
    expect(reopened).not.toBe(runtime.main)
    expect(reopened.isDestroyed()).toBe(false)
    expect(electron.setMainWindow).toHaveBeenLastCalledWith(reopened)
    await runtime.presentCompletionCard(card('notification-2'), 'custom')
    reopened.close()
    await flushLifecycle()
    expect(electron.stop).toHaveBeenCalledTimes(2)
    expect(electron.FakeWindow.getAllWindows()).toHaveLength(0)
  })

  it.each(['activate', 'second-instance', 'tray'] as const)('restores a missing main window via %s while an auxiliary window exists', async (source) => {
    const runtime = await start(source === 'activate' ? 'darwin' : 'win32')
    const auxiliary = new electron.FakeWindow()
    runtime.main.close()
    await flushLifecycle()
    if (source === 'tray') electron.trays[0].emit('click')
    else electron.app.emit(source)
    await flushLifecycle()
    const reopened = runtime.getMainWindow() as unknown as InstanceType<typeof electron.FakeWindow>
    expect(reopened).not.toBe(runtime.main)
    expect(reopened.isDestroyed()).toBe(false)
    expect(reopened.focus).toHaveBeenCalled()
    expect(auxiliary.focus).not.toHaveBeenCalled()
  })

  it('waits for the previous worker shutdown before reopening on macOS', async () => {
    const runtime = await start('darwin')
    let finish!: () => void
    electron.stop.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve }))
    runtime.main.close()
    electron.app.emit('activate')
    await flushLifecycle()
    expect(runtime.getMainWindow()).toBeNull()
    finish()
    await flushLifecycle()
    expect(runtime.getMainWindow()).not.toBeNull()
    expect(runtime.getMainWindow()).not.toBe(runtime.main)
  })

  it('ignores an old notification load that completes after closing and reopening the main window', async () => {
    const runtime = await start('darwin')
    let finish!: () => void
    electron.state.nextHostLoad = new Promise<void>((resolve) => { finish = resolve })
    const pending = runtime.presentCompletionCard(card('old-notification'), 'custom')
    runtime.main.close()
    await flushLifecycle()
    electron.app.emit('activate')
    await flushLifecycle()
    await runtime.presentCompletionCard(card('new-notification'), 'custom')
    const host = electron.FakeWindow.getAllWindows().find((win) => win.options.title !== 'Pi-CodeLoom')!
    finish()
    await pending
    expect(host.isDestroyed()).toBe(false)
    const update = host.webContents.send.mock.calls.filter(([channel]) => channel === 'notification:update').at(-1)!
    expect(update[1]).toEqual([expect.objectContaining({ notificationId: 'new-notification' })])
  })
})

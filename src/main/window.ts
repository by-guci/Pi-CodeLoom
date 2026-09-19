import { APP_DISPLAY_NAME } from '@shared/app-brand'
import { BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { resolveAppIcon } from './app-icon'

const isMac = process.platform === 'darwin'
const isLinux = process.platform === 'linux'
const isWin = process.platform === 'win32'
const useFrameless = isWin || isMac || isLinux
import { configStore } from './config-store'
import { customThemeRendererArgument } from './custom-theme-startup'
import { workerManager } from './worker-manager'
import { installWindowCloseGuard } from './window-close-guard'

const MIN_W = 900
const MIN_H = 600
const DEFAULT_W = 1200
const DEFAULT_H = 800

function readSavedWindowBounds(): { width: number; height: number; x?: number; y?: number } | null {
  const b = configStore.get('windowBounds')
  if (!b?.width || !b?.height) return null
  if (b.width < MIN_W || b.height < MIN_H) return null
  return {
    width: Math.round(b.width),
    height: Math.round(b.height),
    x: b.x != null ? Math.round(b.x) : undefined,
    y: b.y != null ? Math.round(b.y) : undefined,
  }
}

export function persistWindowBounds(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  const bounds = win.isMaximized() || win.isFullScreen() ? win.getNormalBounds() : win.getBounds()
  if (bounds.width < MIN_W || bounds.height < MIN_H) return
  configStore.set('windowBounds', {
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
  })
}

function attachWindowBoundsPersistence(win: BrowserWindow): void {
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null
      persistWindowBounds(win)
    }, 400)
  }
  win.on('resize', scheduleSave)
  win.on('move', scheduleSave)
  win.on('close', () => {
    if (saveTimer) clearTimeout(saveTimer)
    persistWindowBounds(win)
  })
}

let mainWindow: BrowserWindow | null = null
let rendererReloadAfterCrash = false

/** Renderer sandbox on by default (FMSM iter14). Set `PI_RENDERER_SANDBOX=0` to disable for local debug. */
export function readRendererSandboxEnabled(): boolean {
  const v = process.env.PI_RENDERER_SANDBOX
  if (v === '0' || v === 'false' || v === 'no') return false
  return true
}

/** Playwright / CI smoke: show window immediately, skip slow startup side effects in main. */
export function isE2eTestMode(): boolean {
  const v = process.env.PI_E2E
  return v === '1' || v === 'true' || v === 'yes'
}

export function createWindow(): BrowserWindow {
  const saved = readSavedWindowBounds()
  mainWindow = new BrowserWindow({
    width: saved?.width ?? DEFAULT_W,
    height: saved?.height ?? DEFAULT_H,
    ...(saved?.x != null && saved?.y != null ? { x: saved.x, y: saved.y } : {}),
    minWidth: MIN_W,
    minHeight: MIN_H,
    show: false,
    autoHideMenuBar: true,
    frame: !useFrameless,
    ...(isMac && useFrameless
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 12, y: 10 } }
      : {}),
    title: APP_DISPLAY_NAME,
    icon: resolveAppIcon(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      additionalArguments: [customThemeRendererArgument()],
      sandbox: readRendererSandboxEnabled(),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  const createdWindow = mainWindow

  createdWindow.on('closed', () => {
    if (mainWindow === createdWindow) mainWindow = null
  })

  installWindowCloseGuard(createdWindow)

  createdWindow.on('ready-to-show', () => {
    if (isE2eTestMode()) {
      mainWindow?.show()
    } else if (is.dev) {
      mainWindow?.showInactive()
    } else {
      mainWindow?.show()
    }
  })

  // Production: skip per-line renderer console forwarding (idle/poll noise).
  // Dev and e2e keep full forwarding for diagnostics.
  if (is.dev || isE2eTestMode()) {
    createdWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
      console.log(`[Renderer:${level}] ${message} (${sourceId}:${line})`)
    })
  }

  createdWindow.webContents.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL) => {
    console.error(`[Renderer] Failed to load: ${errorCode} ${errorDescription} URL: ${validatedURL}`)
  })

  createdWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error(`[Renderer] Process gone: ${details.reason} exitCode=${details.exitCode}`)
    if (details.reason === 'crashed' || details.reason === 'killed' || details.reason === 'oom') {
      void workerManager.stop()
      if (!rendererReloadAfterCrash && !createdWindow.isDestroyed()) {
        rendererReloadAfterCrash = true
        console.error('[Renderer] Reloading once after crash')
        createdWindow.webContents.reload()
      }
    }
  })

  createdWindow.webContents.on('unresponsive', () => {
    console.error('[Renderer] Unresponsive')
  })

  createdWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  attachWindowBoundsPersistence(createdWindow)

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    createdWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    createdWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return createdWindow
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

export function destroyWindow(): void {
  const window = mainWindow
  if (window && !window.isDestroyed()) {
    window.close()
  }
  if (mainWindow === window && window?.isDestroyed()) mainWindow = null
}

import { app, shell } from 'electron'
import electronUpdater from 'electron-updater'
import { APP_RELEASES_URL, type AppUpdatePreferences } from '@shared/app-update'
import { AppUpdateController } from './app-update-controller'
import { configStore } from './config-store'
import { getMainWindow } from './window'
import { sendEvent } from './ipc/registry'

let controller: AppUpdateController | null = null
let startupTimer: ReturnType<typeof setTimeout> | null = null
let checkTimer: ReturnType<typeof setInterval> | null = null

export function initializeAppUpdater(options: { busy: () => boolean; prepareInstall: () => Promise<void> }): void {
  if (controller) return
  const mode = !app.isPackaged ? 'development'
    : process.env.PORTABLE_EXECUTABLE_DIR || (process.platform === 'linux' && !process.env.APPIMAGE) ? 'manual' : 'automatic'
  const preferences = (): AppUpdatePreferences => ({
    autoCheck: configStore.get('appUpdateAutoCheck'),
    ignoredVersion: configStore.get('appUpdateIgnoredVersion'),
    lastCheckedAt: configStore.get('appUpdateLastCheckedAt'),
  })
  controller = new AppUpdateController({
    engine: electronUpdater.autoUpdater, currentVersion: app.getVersion(), mode, ...options, preferences,
    save: (patch) => {
      if (patch.autoCheck !== undefined) configStore.set('appUpdateAutoCheck', patch.autoCheck)
      if (patch.ignoredVersion !== undefined) configStore.set('appUpdateIgnoredVersion', patch.ignoredVersion)
      if (patch.lastCheckedAt !== undefined) configStore.set('appUpdateLastCheckedAt', patch.lastCheckedAt)
    },
    notify: (state) => {
      const win = getMainWindow()
      if (win) sendEvent(win, { type: 'app-update', state })
    },
  })
  if (mode !== 'development') {
    startupTimer = setTimeout(() => { void controller?.check(false) }, 10_000)
    checkTimer = setInterval(() => { void controller?.check(false) }, 6 * 60 * 60 * 1000)
    startupTimer.unref()
    checkTimer.unref()
  }
}

export function appUpdateController(): AppUpdateController {
  if (!controller) throw new Error('App updater is not initialized')
  return controller
}

export function isAppUpdateInstalling(): boolean { return controller?.state.phase === 'installing' }

export function stopAppUpdateChecks(): void {
  if (startupTimer) clearTimeout(startupTimer)
  if (checkTimer) clearInterval(checkTimer)
  startupTimer = null
  checkTimer = null
}

export async function openAppReleasePage(): Promise<{ ok: true }> {
  await shell.openExternal(APP_RELEASES_URL)
  return { ok: true }
}

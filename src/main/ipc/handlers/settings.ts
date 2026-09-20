import { APP_DISPLAY_NAME } from '@shared/app-brand'
import { BrowserWindow } from 'electron'
import { configStore, type StoreSchema } from '../../config-store'
import { getMainWindow } from '../../window'
import { invalidateAdapterCatalog } from '../../../extension-compat/adapter-loader'
import { workerManager } from '../../worker-manager'
import { invalidateSdkManagerCaches } from '../../sdk-manager'
import { sessionPreviewProcess } from '../../session-preview-process'
import { registerHandler, registerHandlerWithSchema, sendEvent } from '../registry'
import { settingsSetSchema } from '../schemas'

export function registerSettingsHandlers(): void {
  registerHandler('ipc:settings.get', async (req) => {
    if (req.key) {
      const key = req.key as keyof StoreSchema
      return { settings: { [req.key]: configStore.get(key) } }
    }
    return { settings: configStore.getAll() }
  })

  registerHandlerWithSchema('ipc:settings.set', settingsSetSchema, async (req) => {
    const key = req.key as keyof StoreSchema
    if (key === 'agentRuntime') {
      const current = configStore.get('agentRuntime')
      const next = req.value as StoreSchema['agentRuntime']
      const changed = current?.mode !== next.mode || current?.distro !== next.distro
      if (changed) {
        if (workerManager.hasActiveTurns) throw new Error('AGENT_RUNTIME_BUSY')
        await workerManager.stop()
        sessionPreviewProcess.stop()
      }
      configStore.set(key, next)
      if (changed) {
        invalidateAdapterCatalog()
        invalidateSdkManagerCaches()
        for (const win of BrowserWindow.getAllWindows()) {
          sendEvent(win, { type: 'sdk-runtime-changed' })
        }
      }
      return { key: req.key, value: next }
    }
    configStore.set(key, req.value as StoreSchema[typeof key])
    if (key === 'theme' || key === 'customTheme') {
      const { refreshCompletionNotificationTheme } = await import('../../completion-notification-delivery')
      refreshCompletionNotificationTheme()
    }
    return { key: req.key, value: req.value }
  })

  registerHandler('ipc:alerts.signal', async (req) => {
    const { traceAudio } = await import('../../audio-trace')
    traceAudio('ipc.alerts.signal', {
      kind: req.kind,
      title: req.title,
      body: String(req.body || '').slice(0, 80),
    })
    const { deliverDesktopAlert } = await import('../../desktop-alerts')
    const win = getMainWindow()
    const kind = req.kind === 'run_idle' ? 'run_idle' : 'extension_ui'
    deliverDesktopAlert(win, {
      kind,
      title: String(req.title || APP_DISPLAY_NAME),
      body: String(req.body || ''),
      background: req.background === true,
    })
    return { ok: true }
  })

  registerHandler('ipc:alerts.test', async () => {
    const { deliverTestCompletionNotification } = await import('../../completion-notification')
    deliverTestCompletionNotification()
    return { ok: true }
  })
}

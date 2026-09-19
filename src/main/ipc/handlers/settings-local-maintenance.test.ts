import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isAllowedIpcChannel } from '@shared/ipc-channels'

const handlers = vi.hoisted(() => new Map<string, (request: Record<string, unknown>) => Promise<unknown>>())
vi.mock('../registry', () => ({
  registerHandler: (channel: string, handler: (request: Record<string, unknown>) => Promise<unknown>) => handlers.set(channel, handler),
  registerHandlerWithSchema: (channel: string, _schema: unknown, handler: (request: Record<string, unknown>) => Promise<unknown>) => handlers.set(channel, handler),
}))
vi.mock('../../config-store', () => ({
  configStore: { get: vi.fn(), getAll: () => ({ language: 'zh' }), set: vi.fn() },
}))
vi.mock('../../../extension-compat/adapter-loader', () => ({ invalidateAdapterCatalog: vi.fn() }))
vi.mock('../../worker-manager', () => ({ workerManager: { hasActiveTurns: false, stop: vi.fn() } }))
vi.mock('../../sdk-manager', () => ({ invalidateSdkManagerCaches: vi.fn() }))
vi.mock('../../session-preview-process', () => ({ sessionPreviewProcess: { stop: vi.fn() } }))
vi.mock('../../window', () => ({ getMainWindow: vi.fn() }))
vi.mock('electron', () => ({ shell: {}, BrowserWindow: { getAllWindows: () => [] } }))

import { registerSettingsHandlers } from './settings'

beforeEach(() => {
  handlers.clear()
  registerSettingsHandlers()
})

describe('local application maintenance', () => {
  it.each([
    'ipc:app.checkUpdate',
    'ipc:app.getPendingUpdate',
    'ipc:app.dismissUpdatePrompt',
    'ipc:app.ignoreUpdateVersion',
    'ipc:app.openRelease',
    'ipc:app.downloadUpdate',
  ])('does not expose the retired remote update action %s', (channel) => {
    expect(handlers.has(channel)).toBe(false)
    expect(isAllowedIpcChannel(channel)).toBe(false)
  })

  it.each([
    'ipc:asr.transcribe',
    'ipc:asr.testConnection',
    'ipc:asr.probeCodexAuth',
    'ipc:asr.importCodexAccessToken',
    'ipc:asr.builtinStatus',
    'ipc:asr.detectBinary',
  ])('rejects the retired voice capability %s', (channel) => {
    expect(isAllowedIpcChannel(channel)).toBe(false)
  })

  it('continues to serve settings and desktop notifications', async () => {
    expect(handlers.has('ipc:settings.set')).toBe(true)
    expect(handlers.has('ipc:alerts.test')).toBe(true)
    expect(handlers.has('ipc:alerts.signal')).toBe(true)
    const response = await handlers.get('ipc:settings.get')!({})
    expect(response).toMatchObject({ settings: { language: 'zh' } })
  })
})


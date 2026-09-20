import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (request: Record<string, unknown>) => Promise<unknown>>(),
  readModelsConfig: vi.fn(),
  writeModelsConfig: vi.fn(),
  reloadModels: vi.fn(),
  sendEvent: vi.fn(),
  getAllWindows: vi.fn(() => [] as Array<{ id: number }>),
  readSdkStatusCached: vi.fn(),
  listRegistryVersionsCached: vi.fn(),
  listRegistryVersions: vi.fn(),
  installVersion: vi.fn(),
  installGlobalVersion: vi.fn(),
  finalizeVersionInstall: vi.fn(),
  readSdkSelection: vi.fn(),
  getFocusedWindow: vi.fn(() => undefined as { id: number } | undefined),
  switchTo: vi.fn(),
  isAllowedSdkVersion: vi.fn(),
  confirmSdkSelection: vi.fn(),
  stopPreview: vi.fn(),
  lookupModelCapabilities: vi.fn(),
  workerRunning: true,
  activeTurns: false,
  installing: false,
  runtime: { mode: 'host', distro: null } as { mode: 'host' | 'wsl'; distro: string | null },
}))

vi.mock('./registry', () => ({
  registerHandler: (channel: string, handler: (request: Record<string, unknown>) => Promise<unknown>) => {
    mocks.handlers.set(channel, handler)
  },
  registerHandlerWithSchema: (
    channel: string,
    _schema: unknown,
    handler: (request: Record<string, unknown>) => Promise<unknown>,
  ) => {
    mocks.handlers.set(channel, handler)
  },
  sendEvent: mocks.sendEvent,
}))

vi.mock('../pi-models-json', () => ({
  readModelsConfig: mocks.readModelsConfig,
  writeModelsConfig: mocks.writeModelsConfig,
  fetchRemoteModelIds: vi.fn(),
}))

vi.mock('../models-dev-thinking', () => ({
  lookupModelCapabilitiesWithThinking: mocks.lookupModelCapabilities,
}))

vi.mock('../worker-manager', () => ({
  workerManager: {
    get isRunning() {
      return mocks.workerRunning
    },
    reloadModels: mocks.reloadModels,
    get hasActiveTurns() { return mocks.activeTurns },
    cwd: '',
    lastSdkFallback: false,
  },
}))

vi.mock('../config-store', () => ({ configStore: { get: vi.fn(() => '') } }))
vi.mock('../pi-info', () => ({ readPiInfo: vi.fn(), readResourceList: vi.fn() }))
vi.mock('../sdk-loader', () => ({
  clearGlobalSdkPathCache: vi.fn(),
  readSdkSelection: mocks.readSdkSelection,
}))
vi.mock('../sdk-manager', () => ({
  readSdkStatusCached: mocks.readSdkStatusCached,
  listRegistryVersionsCached: mocks.listRegistryVersionsCached,
  listRegistryVersions: mocks.listRegistryVersions,
  installVersion: mocks.installVersion,
  installGlobalVersion: mocks.installGlobalVersion,
  finalizeVersionInstall: mocks.finalizeVersionInstall,
  switchTo: mocks.switchTo,
  isAllowedSdkVersion: mocks.isAllowedSdkVersion,
  invalidateSdkManagerCaches: vi.fn(),
  isInstalling: () => mocks.installing,
  readWslSdkStatusCached: vi.fn(async () => ({ globalVersion: '0.84.0', active: { kind: 'global', version: '0.84.0' } })),
}))
vi.mock('./sdk-session', () => ({ probeSelectedSdk: vi.fn() }))
vi.mock('../sdk-selection-transaction', () => ({ confirmSdkSelection: mocks.confirmSdkSelection }))
vi.mock('../session-preview-process', () => ({
  sessionPreviewProcess: { stop: mocks.stopPreview },
}))
vi.mock('../wsl/runtime-config', () => ({
  getAgentRuntimeConfig: vi.fn(() => mocks.runtime),
}))
vi.mock('../wsl/sdk-resolve', () => ({ assertWslSdkAvailable: vi.fn() }))
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '') },
  BrowserWindow: { getFocusedWindow: mocks.getFocusedWindow, getAllWindows: mocks.getAllWindows },
}))

import { registerPiSdkHandlers } from './handlers/pi-sdk'

const config = {
  providers: {
    custom: {
      name: 'Custom provider',
      baseUrl: 'https://example.invalid/v1',
      models: [{ id: 'model-a' }],
    },
  },
}

beforeEach(() => {
  mocks.handlers.clear()
  mocks.readModelsConfig.mockReset()
  mocks.writeModelsConfig.mockReset()
  mocks.reloadModels.mockReset()
  mocks.sendEvent.mockReset()
  mocks.getAllWindows.mockReset().mockReturnValue([])
  mocks.readSdkStatusCached.mockReset().mockReturnValue({ active: { kind: 'builtin' } })
  mocks.listRegistryVersionsCached.mockReset()
  mocks.listRegistryVersions.mockReset().mockResolvedValue(['0.83.0'])
  mocks.installVersion.mockReset().mockResolvedValue({ userDir: 'user-new' })
  mocks.installGlobalVersion.mockReset().mockResolvedValue({ version: '0.84.0' })
  mocks.lookupModelCapabilities.mockReset().mockResolvedValue({ ok: true, models: {} })
  mocks.finalizeVersionInstall.mockReset()
  mocks.readSdkSelection.mockReset().mockReturnValue({ kind: 'builtin' })
  mocks.getFocusedWindow.mockReset().mockReturnValue(undefined)
  mocks.switchTo.mockReset().mockResolvedValue(undefined)
  mocks.isAllowedSdkVersion.mockReset().mockReturnValue(true)
  mocks.confirmSdkSelection.mockReset().mockResolvedValue({ kind: 'builtin', version: '0.83.0' })
  mocks.stopPreview.mockReset()
  mocks.workerRunning = true
  mocks.activeTurns = false
  mocks.installing = false
  mocks.runtime = { mode: 'host', distro: null }
  registerPiSdkHandlers()
})

describe('pi.models IPC handlers', () => {
  it('registers the global SDK upgrade action', () => {
    expect(mocks.handlers.get('ipc:sdk.upgradeGlobal')).toBeTypeOf('function')
  })

  it('looks up model capabilities from models.dev', async () => {
    mocks.lookupModelCapabilities.mockResolvedValue({
      ok: true,
      models: { 'glm-5.3': { name: 'GLM-5.3', reasoning: true, input: ['text'], contextWindow: 1_000_000, maxTokens: 131_072 } },
    })
    const result = await mocks.handlers.get('ipc:pi.models.lookup')!({ ids: ['glm-5.3'], provider: '自建', baseUrl: 'https://relay.example/v1' })
    expect(mocks.lookupModelCapabilities).toHaveBeenCalledWith(['glm-5.3'], '自建', 'https://relay.example/v1')
    expect(result).toMatchObject({ ok: true, models: { 'glm-5.3': { contextWindow: 1_000_000 } } })
  })
  it('upgrades host global Pi without switching SDK selection or stopping workers', async () => {
    mocks.readSdkSelection.mockReturnValue({ kind: 'user', userDir: 'user-old' })

    const result = await mocks.handlers.get('ipc:sdk.upgradeGlobal')!({ version: '0.84.0' })

    expect(result).toEqual({ ok: true, version: '0.84.0', restartRequired: true })
    expect(mocks.installGlobalVersion).toHaveBeenCalledWith(expect.any(Function), { version: '0.84.0' })
    expect(mocks.switchTo).not.toHaveBeenCalled()
    expect(mocks.confirmSdkSelection).not.toHaveBeenCalled()
    expect(mocks.stopPreview).not.toHaveBeenCalled()
  })

  it('upgrades only the saved WSL runtime distribution', async () => {
    mocks.runtime = { mode: 'wsl', distro: 'Ubuntu-24.04' }

    await mocks.handlers.get('ipc:sdk.upgradeGlobal')!({ version: '0.84.0' })

    expect(mocks.installGlobalVersion).toHaveBeenCalledWith(expect.any(Function), { distro: 'Ubuntu-24.04', version: '0.84.0' })
    expect(mocks.switchTo).not.toHaveBeenCalled()
  })

  it('rejects global upgrades while any session is running', async () => {
    mocks.activeTurns = true
    const result = await mocks.handlers.get('ipc:sdk.upgradeGlobal')!({ version: '0.84.0' })
    expect(result).toMatchObject({ ok: false, error: expect.any(String) })
    expect(mocks.installGlobalVersion).not.toHaveBeenCalled()
  })

  it.each(['ipc:sdk.install', 'ipc:sdk.switch', 'ipc:sdk.upgradeGlobal'])('blocks %s during another SDK installation', async (channel) => {
    mocks.installing = true
    const result = await mocks.handlers.get(channel)!({ version: '0.84.0', target: 'global' })
    expect(result).toEqual({ ok: false, error: 'SDK_INSTALL_BUSY' })
    expect(mocks.installGlobalVersion).not.toHaveBeenCalled()
    expect(mocks.installVersion).not.toHaveBeenCalled()
    expect(mocks.switchTo).not.toHaveBeenCalled()
  })

  it('forwards global installation logs and reports a real failure', async () => {
    const win = { id: 1 }
    mocks.getFocusedWindow.mockReturnValue(win)
    mocks.installGlobalVersion.mockImplementation(async (onProgress) => {
      onProgress('npm error EACCES')
      throw new Error('npm 退出码 1')
    })

    const result = await mocks.handlers.get('ipc:sdk.upgradeGlobal')!({ version: '0.84.0' })

    expect(result).toEqual({ ok: false, error: 'npm 退出码 1' })
    expect(mocks.sendEvent.mock.calls).toEqual([
      [win, { type: 'sdk-install-progress', version: '0.84.0', line: 'npm error EACCES' }],
      [win, { type: 'sdk-install-progress', version: '0.84.0', done: true, error: 'npm 退出码 1' }],
    ])
  })

  it('reports the saved runtime with SDK status so the upgrade target is explicit', async () => {
    mocks.runtime = { mode: 'wsl', distro: 'Ubuntu-24.04' }
    await expect(mocks.handlers.get('ipc:sdk.status')!({})).resolves.toMatchObject({
      runtime: { mode: 'wsl', distro: 'Ubuntu-24.04' },
      globalVersion: '0.84.0',
    })
  })

  it.each([
    ['ipc:sdk.install', { version: '0.83.0' }],
    ['ipc:sdk.switch', { target: 'builtin' }],
  ])('stops preview before %s changes the selected SDK', async (channel, request) => {
    const order: string[] = []
    mocks.stopPreview.mockImplementation(() => order.push('preview-stop'))
    mocks.installVersion.mockImplementation(async () => {
      order.push('install')
      return { userDir: 'user-new' }
    })
    mocks.switchTo.mockImplementation(async () => {
      order.push('switch')
    })

    await expect(mocks.handlers.get(channel)!(request)).resolves.toMatchObject({ ok: true })

    expect(order[0]).toBe('preview-stop')
    expect(order).toContain(channel === 'ipc:sdk.install' ? 'install' : 'switch')
  })

  it('writes through the production owner and reloads the running Worker before success', async () => {
    mocks.writeModelsConfig.mockResolvedValue({ ok: true, path: 'active-agent/models.json' })
    mocks.reloadModels.mockResolvedValue(undefined)

    const response = await mocks.handlers.get('ipc:pi.models.set')!({ config })

    expect(mocks.writeModelsConfig).toHaveBeenCalledWith(config)
    expect(mocks.reloadModels).toHaveBeenCalledOnce()
    expect(response).toEqual({ ok: true, path: 'active-agent/models.json' })
  })

  it('returns an explicit failure when the file was written but Worker reload fails', async () => {
    mocks.writeModelsConfig.mockResolvedValue({ ok: true, path: 'active-agent/models.json' })
    mocks.reloadModels.mockRejectedValue(new Error('reload failed'))

    const response = await mocks.handlers.get('ipc:pi.models.set')!({ config })

    expect(response).toEqual({
      ok: false,
      path: 'active-agent/models.json',
      error: '模型配置已写入，但重载失败: reload failed',
    })
  })

  it('returns the same active configuration owner used by the get handler', async () => {
    mocks.readModelsConfig.mockResolvedValue({
      path: 'active-agent/models.json',
      config,
      warnings: ['normalized'],
    })

    const response = await mocks.handlers.get('ipc:pi.models.get')!({})

    expect(mocks.readModelsConfig).toHaveBeenCalledOnce()
    expect(response).toEqual({
      path: 'active-agent/models.json',
      config,
      parseError: undefined,
      schemaError: undefined,
      warnings: ['normalized'],
    })
  })

  it('notifies every renderer only after an SDK install succeeds', async () => {
    const windows = [{ id: 1 }, { id: 2 }]
    mocks.getAllWindows.mockReturnValue(windows)
    mocks.getFocusedWindow.mockReturnValue(windows[0])
    mocks.installVersion.mockResolvedValue({ userDir: 'user-new' })
    mocks.confirmSdkSelection.mockResolvedValue({ kind: 'user', version: '0.83.0' })

    const response = await mocks.handlers.get('ipc:sdk.install')!({ version: '0.83.0' })

    expect(response).toEqual({ ok: true, active: { kind: 'user', version: '0.83.0' } })
    expect(mocks.finalizeVersionInstall).toHaveBeenCalledWith('user-new', true)
    expect(mocks.sendEvent.mock.calls.slice(-2)).toEqual([
      [windows[0], { type: 'sdk-runtime-changed' }],
      [windows[1], { type: 'sdk-runtime-changed' }],
    ])
  })

  it('passes the exact previous user generation into install rollback', async () => {
    mocks.readSdkSelection.mockReturnValue({ kind: 'user', userDir: 'user-old' })
    mocks.installVersion.mockResolvedValue({ userDir: 'user-new' })
    mocks.confirmSdkSelection.mockRejectedValue(new Error('Worker validation failed'))

    const response = await mocks.handlers.get('ipc:sdk.install')!({ version: '0.83.0' })

    expect(response).toEqual({ ok: false, error: 'Worker validation failed' })
    expect(mocks.confirmSdkSelection).toHaveBeenCalledWith(
      expect.objectContaining({
        target: 'user',
        rollbackTarget: { kind: 'user', userDir: 'user-old' },
      }),
    )
    expect(mocks.finalizeVersionInstall).toHaveBeenCalledWith('user-new', false)
  })

  it('notifies every renderer only after an SDK switch succeeds', async () => {
    const windows = [{ id: 1 }, { id: 2 }]
    mocks.getAllWindows.mockReturnValue(windows)
    mocks.confirmSdkSelection.mockResolvedValue({ kind: 'global', version: '0.83.0' })

    const response = await mocks.handlers.get('ipc:sdk.switch')!({ target: 'global' })

    expect(response).toEqual({ ok: true, active: { kind: 'global', version: '0.83.0' } })
    expect(mocks.sendEvent.mock.calls).toEqual([
      [windows[0], { type: 'sdk-runtime-changed' }],
      [windows[1], { type: 'sdk-runtime-changed' }],
    ])
  })

  it('does not notify renderers when an SDK switch fails', async () => {
    mocks.switchTo.mockRejectedValue(new Error('switch failed'))

    const response = await mocks.handlers.get('ipc:sdk.switch')!({ target: 'global' })

    expect(response).toEqual({ ok: false, error: 'switch failed' })
    expect(mocks.sendEvent).not.toHaveBeenCalled()
  })
})

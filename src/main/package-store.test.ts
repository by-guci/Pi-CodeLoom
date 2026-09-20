import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ configured: [] as Array<{ source: string; scope: string }>, install: vi.fn(), remove: vi.fn(), update: vi.fn(), verify: vi.fn(), flush: vi.fn(), checks: vi.fn(), invalidate: vi.fn(), active: false, running: false, wsl: false, stop: vi.fn() }))
vi.mock('node:fs', async (importOriginal) => ({ ...await importOriginal<typeof import('node:fs')>(), mkdirSync: vi.fn() }))
vi.mock('electron', () => ({ app: { getPath: () => '/profile' } }))
vi.mock('./agent-dir', () => ({ resolveActiveAgentDir: () => '/agent' }))
vi.mock('./wsl/runtime-config', () => ({ isWslRuntimeActive: () => mocks.wsl }))
vi.mock('./worker-manager', () => ({ workerManager: { get hasActiveTurns() { return mocks.active }, get isRunning() { return mocks.running }, stop: mocks.stop } }))
vi.mock('../extension-compat/adapter-loader', () => ({ invalidateAdapterCatalog: mocks.invalidate }))
vi.mock('./package-store-catalog', () => ({ verifyCatalogPackage: mocks.verify }))
vi.mock('./ipc/sdk-session', () => ({ getActiveSdkModule: async () => ({
  SettingsManager: { create: () => ({ flush: mocks.flush }) },
  DefaultPackageManager: class {
    listConfiguredPackages() { return mocks.configured }
    installAndPersist = mocks.install
    removeAndPersist = mocks.remove
    update = mocks.update
    checkForAvailableUpdates = mocks.checks
    setProgressCallback() {}
  },
}) }))
beforeEach(() => {
  vi.resetModules()
  mocks.configured = []
  mocks.active = false; mocks.running = false; mocks.wsl = false
  for (const value of Object.values(mocks)) if (typeof value === 'function') value.mockReset().mockResolvedValue(undefined)
  mocks.checks.mockResolvedValue([])
})
describe('Pi package management', () => {
  it('updates only eligible user npm packages and continues after a failed package', async () => {
    mocks.configured = ['first', 'broken', 'last', 'fixed@1.0.0'].map((name) => ({ source: `npm:${name}`, scope: 'user' }))
    mocks.configured.push({ source: 'npm:project-only', scope: 'project' })
    mocks.checks.mockResolvedValue([
      ...['first', 'broken', 'last'].map((name) => ({ source: `npm:${name}`, scope: 'user' })),
      { source: 'npm:project-only', scope: 'project' }, { source: 'git:example/repo', scope: 'user' },
    ])
    mocks.update.mockImplementation(async (source) => { if (source === 'npm:broken') throw new Error('failure') })
    const api = await import('./package-store')
    const result = await api.updateAllStorePackages()
    expect(mocks.update.mock.calls.map(([source]) => source)).toEqual(['npm:first', 'npm:broken', 'npm:last'])
    expect(result.batch).toEqual({ total: 3, completed: 3, results: [{ name: 'first', status: 'updated' }, { name: 'broken', status: 'failed' }, { name: 'last', status: 'updated' }] })
    expect(result.busy).toBe(false)
    expect(result.needsRestart).toBe(true)
  })

  it('does not touch files when no update is available or a task is running', async () => {
    const api = await import('./package-store')
    expect((await api.updateAllStorePackages()).batch?.total).toBe(0)
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.stop).not.toHaveBeenCalled()
    mocks.active = true
    await expect(api.updateAllStorePackages()).rejects.toThrow('PACKAGE_AGENT_BUSY')
  })

  it('holds the operation lock for the entire batch and releases it after a check failure', async () => {
    const api = await import('./package-store')
    let finish!: (value: unknown[]) => void
    mocks.checks.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const batch = api.updateAllStorePackages()
    await vi.waitFor(() => expect(mocks.checks).toHaveBeenCalled())
    await expect(api.mutateStorePackage('install', 'another')).rejects.toThrow('PACKAGE_OPERATION_BUSY')
    finish([])
    await batch
    mocks.checks.mockRejectedValueOnce(new Error('offline'))
    await expect(api.updateAllStorePackages()).rejects.toThrow('PACKAGE_UPDATE_CHECK_FAILED')
    expect((await api.packageStoreState()).busy).toBe(false)
  })
  it('verifies official catalog membership before installing and persists through the SDK', async () => {
    const api = await import('./package-store')
    await api.mutateStorePackage('install', '@test/plugin')
    expect(mocks.verify).toHaveBeenCalledWith('@test/plugin')
    expect(mocks.install).toHaveBeenCalledWith('npm:@test/plugin')
    expect(mocks.flush).toHaveBeenCalled()
    expect((await api.packageStoreState()).needsRestart).toBe(true)
  })
  it('updates the configured pinned source without replacing it with latest', async () => {
    mocks.configured = [{ source: 'npm:@test/plugin@1.2.3', scope: 'user' }]
    mocks.running = true
    const api = await import('./package-store')
    await api.mutateStorePackage('update', '@test/plugin')
    expect(mocks.update).toHaveBeenCalledWith('npm:@test/plugin@1.2.3')
    expect(mocks.stop).toHaveBeenCalledOnce()
    expect((await api.packageStoreState()).installed[0].pinned).toBe(true)
  })
  it('removes only a configured user package', async () => {
    mocks.configured = [{ source: 'npm:example', scope: 'project' }]
    const api = await import('./package-store')
    await expect(api.mutateStorePackage('remove', 'example')).rejects.toThrow('PACKAGE_NOT_INSTALLED')
    expect(mocks.remove).not.toHaveBeenCalled()
    mocks.configured.push({ source: 'npm:example', scope: 'user' })
    await api.mutateStorePackage('remove', 'example')
    expect(mocks.remove).toHaveBeenCalledWith('npm:example')
  })
  it('blocks active tasks and concurrent mutations', async () => {
    const api = await import('./package-store')
    mocks.active = true
    await expect(api.mutateStorePackage('install', 'example')).rejects.toThrow('PACKAGE_AGENT_BUSY')
    mocks.active = false
    let finish!: () => void
    mocks.verify.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve }))
    const pending = api.mutateStorePackage('install', 'example')
    await vi.waitFor(() => expect(mocks.verify).toHaveBeenCalled())
    await expect(api.mutateStorePackage('install', 'second')).rejects.toThrow('PACKAGE_OPERATION_BUSY')
    finish()
    await pending
  })
  it('does not expose npm secret-bearing failures and allows retry', async () => {
    const api = await import('./package-store')
    mocks.install.mockRejectedValueOnce(new Error('token=secret'))
    await expect(api.mutateStorePackage('install', 'example')).rejects.toThrow('PACKAGE_OPERATION_FAILED')
    expect(JSON.stringify(await api.packageStoreState())).not.toContain('secret')
    await expect(api.mutateStorePackage('install', 'example')).resolves.toMatchObject({ busy: false, error: null })
  })
  it('does not modify host packages when WSL is selected', async () => {
    mocks.wsl = true
    const api = await import('./package-store')
    expect(await api.packageStoreState()).toMatchObject({ writable: false, installed: [] })
    await expect(api.mutateStorePackage('install', 'example')).rejects.toThrow()
    expect(mocks.install).not.toHaveBeenCalled()
  })
})

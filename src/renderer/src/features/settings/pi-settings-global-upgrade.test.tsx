import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PiSettingsPanel } from './pi-settings-panel'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  onEvent: null as ((event: Record<string, unknown>) => void) | null,
  runtime: { mode: 'host', distro: null } as { mode: 'host' | 'wsl'; distro: string | null },
  globalVersion: '0.83.0',
  npmAvailable: true,
}))

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: mocks.invoke },
  onAppEvent: (handler: (event: Record<string, unknown>) => void) => {
    mocks.onEvent = handler
    return () => { mocks.onEvent = null }
  },
}))
vi.mock('sonner', () => ({ toast: { success: mocks.success, error: mocks.error } }))
vi.mock('react-i18next', () => {
  const t = (key: string) => key
  return { useTranslation: () => ({ t }) }
})
vi.mock('@renderer/stores/ui-store', () => ({
  useUIStore: (selector: (state: { currentWorkspace: null }) => unknown) => selector({ currentWorkspace: null }),
}))
vi.mock('@renderer/lib/available-models-cache', () => ({
  peekAvailableModels: () => [], ensureAvailableModels: async () => {},
  subscribeAvailableModels: () => () => {}, refreshAvailableModels: async () => [],
}))
vi.mock('@renderer/features/settings/use-settings-dirty-slice', () => ({ useSettingsDirtySlice: vi.fn() }))
vi.mock('@renderer/features/settings/settings-dirty-registry', () => ({ notifySettingsDirtyChanged: vi.fn() }))
vi.mock('@renderer/features/settings/settings-draft-context', () => ({
  useSettingsDraft: () => ({ draft: { agentRuntime: { mode: 'wsl', distro: 'Unsaved-Distro' } } }),
}))
vi.mock('@renderer/lib/composer-run-display', () => ({ refreshComposerRunDisplay: vi.fn() }))
vi.mock('./pi-settings-form-sections', () => ({ PiSettingsFormSections: () => null }))
vi.mock('./pi-settings-env-auth-rows', () => ({ PiSettingsEnvAuthRows: () => null }))
vi.mock('./settings-shell', () => ({ SettingsPageHeader: () => null }))
vi.mock('./settings-page-shared', () => ({
  SettingsSection: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
}))

beforeEach(() => {
  mocks.invoke.mockReset()
  mocks.success.mockReset()
  mocks.error.mockReset()
  mocks.runtime = { mode: 'host', distro: null }
  mocks.globalVersion = '0.83.0'
  mocks.npmAvailable = true
  mocks.invoke.mockImplementation(async (method: string) => {
    if (method === 'pi.getInfo') return {}
    if (method === 'pi.settings.get') return { settings: {} }
    if (method === 'sdk.status') return {
      builtinVersion: '0.83.0', globalVersion: mocks.globalVersion,
      active: { kind: 'builtin', version: '0.83.0' }, npmAvailable: mocks.npmAvailable,
      runtime: mocks.runtime,
    }
    if (method === 'sdk.listAvailable') return { versions: ['0.84.0'], latest: '0.84.0' }
    return {}
  })
})

describe('global Pi upgrade controls', () => {
  it('shows the saved host target and upgrades with progress, refreshed version, and restart guidance', async () => {
    let finish!: (result: unknown) => void
    const existing = mocks.invoke.getMockImplementation()!
    mocks.invoke.mockImplementation((method, request) => method === 'sdk.upgradeGlobal'
      ? new Promise((resolve) => { finish = resolve })
      : existing(method, request))
    render(<PiSettingsPanel />)
    const upgrade = await screen.findByRole('button', { name: 'settings:pi.upgradeGlobalAction' })
    await waitFor(() => expect(upgrade).toBeEnabled())
    expect(screen.getByText('settings:pi.upgradeGlobal')).toBeInTheDocument()

    fireEvent.click(upgrade)

    expect(screen.getByRole('button', { name: 'settings:pi.upgradingGlobal' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'settings:pi.upgradeSwitch' })).toBeDisabled()
    act(() => mocks.onEvent?.({ type: 'sdk-install-progress', version: 'latest', line: 'npm installing local fixture' }))
    expect(screen.getByRole('log')).toHaveTextContent('npm installing local fixture')
    await act(async () => {
      mocks.globalVersion = '0.84.0'
      finish({ ok: true, version: '0.84.0', restartRequired: true })
    })

    await waitFor(() => expect(mocks.success).toHaveBeenCalled())
    expect(screen.getByRole('status')).toHaveTextContent('settings:pi.globalUpgradeRestartRequired')
    expect(screen.getByText('settings:pi.globalVersion').nextElementSibling).toHaveTextContent('0.84.0')
    expect(mocks.invoke).toHaveBeenCalledWith('sdk.upgradeGlobal', { version: '0.84.0' })
    expect(mocks.invoke).toHaveBeenCalledWith('sdk.status', { refresh: true })
    expect(mocks.invoke.mock.calls.some(([method]) => method === 'sdk.switch' || method === 'sdk.install')).toBe(false)
  })

  it('shows installation failure and makes the upgrade button usable again', async () => {
    const existing = mocks.invoke.getMockImplementation()!
    mocks.invoke.mockImplementation((method, request) => method === 'sdk.upgradeGlobal'
      ? Promise.resolve({ ok: false, error: 'npm EACCES' })
      : existing(method, request))
    render(<PiSettingsPanel />)
    const upgrade = await screen.findByRole('button', { name: 'settings:pi.upgradeGlobalAction' })
    await waitFor(() => expect(upgrade).toBeEnabled())
    fireEvent.click(upgrade)

    expect(await screen.findByRole('alert')).toHaveTextContent('npm EACCES')
    expect(mocks.success).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'settings:pi.upgradeGlobalAction' })).toBeEnabled()
  })

  it('does not call an empty IPC response a successful upgrade', async () => {
    render(<PiSettingsPanel />)
    const upgrade = await screen.findByRole('button', { name: 'settings:pi.upgradeGlobalAction' })
    await waitFor(() => expect(upgrade).toBeEnabled())
    fireEvent.click(upgrade)
    expect(await screen.findByRole('alert')).toHaveTextContent('settings:pi.globalUpgradeFailed')
    expect(mocks.success).not.toHaveBeenCalled()
  })

  it('allows a WSL upgrade without depending on host npm availability', async () => {
    mocks.runtime = { mode: 'wsl', distro: 'Ubuntu-24.04' }
    mocks.npmAvailable = false
    render(<PiSettingsPanel />)
    const upgrade = await screen.findByRole('button', { name: 'settings:pi.upgradeGlobalAction' })
    await waitFor(() => expect(upgrade).toBeEnabled())
  })
})

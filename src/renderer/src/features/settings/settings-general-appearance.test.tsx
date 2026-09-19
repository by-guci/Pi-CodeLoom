import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GeneralSettings } from './settings-general-appearance'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  translate: vi.fn((key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
  ),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mocks.translate }),
}))

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: mocks.invoke },
}))

vi.mock('@renderer/features/settings/settings-draft-context', () => ({
  useSettingsDraft: () => ({
    draft: {
      autoOpenLastProject: false,
      alertSoundEnabled: false,
      alertNotificationEnabled: false,
      alertOnExtensionUi: false,
      alertOnRunIdle: false,
      alertOnBackgroundRunIdle: false,
      alertOnRunFailed: true,
      completionNotificationTimeoutSeconds: 15,
      completionNotificationPreview: 'response',
      completionNotificationOnlyWhenUnfocused: true,
      completionNotificationDndUntil: null,
      completionNotificationDelivery: 'auto',
      maxSessionWorkers: 2,
      sessionWorkerIdleTimeoutMinutes: 10,
      language: 'en',
    },
    setAutoOpenLastProject: vi.fn(),
    setLanguage: vi.fn(),
    setAlertSoundEnabled: vi.fn(),
    setAlertNotificationEnabled: vi.fn(),
    setAlertOnExtensionUi: vi.fn(),
    setAlertOnRunIdle: vi.fn(),
    setAlertOnBackgroundRunIdle: vi.fn(),
    setAlertOnRunFailed: vi.fn(),
    setCompletionNotificationTimeoutSeconds: vi.fn(),
    setCompletionNotificationPreview: vi.fn(),
    setCompletionNotificationOnlyWhenUnfocused: vi.fn(),
    setCompletionNotificationDndMinutes: vi.fn(),
    setCompletionNotificationDelivery: vi.fn(),
    setMaxSessionWorkers: vi.fn(),
    setSessionWorkerIdleTimeoutMinutes: vi.fn(),
  }),
}))

vi.mock('@renderer/features/settings/pi-settings-panel', () => ({ PiSettingsPanel: () => null }))
vi.mock('@renderer/features/settings/appearance-theme-editor', () => ({ AppearanceThemeEditor: () => null }))
vi.mock('@renderer/features/settings/runtime-settings-panel', () => ({ RuntimeSettingsPanel: () => null }))

beforeEach(() => {
  mocks.invoke.mockReset()
  mocks.translate.mockClear()
  mocks.invoke.mockImplementation((method: string) => {
    if (method === 'settings.get') return Promise.resolve({ settings: {} })
    return Promise.resolve({ status: 'error' })
  })
})

describe('GeneralSettings notifications and maintenance', () => {
  it('exposes selected semantics for completion notification segments', () => {
    render(<GeneralSettings />)

    expect(screen.getByRole('button', { name: 'settings:general.alertPreview.response' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: 'settings:general.alertPreview.fixed' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    expect(screen.getByRole('button', { name: 'settings:general.alertDelivery.auto' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: 'settings:general.alertDnd.off' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('shows feedback for a test completion notification', async () => {
    mocks.invoke.mockImplementation((method: string) => {
      if (method === 'settings.get') return Promise.resolve({ settings: {} })
      if (method === 'alerts.test') return Promise.resolve({ ok: true })
      return Promise.resolve({ status: 'error' })
    })
    render(<GeneralSettings />)

    fireEvent.click(screen.getByRole('button', { name: 'settings:general.alertTestAction' }))

    expect(await screen.findByRole('status')).toHaveTextContent('settings:general.alertTestSent')
  })

  it('keeps application maintenance local', () => {
    render(<GeneralSettings />)
    expect(screen.getByText('settings:general.localMaintenance')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'settings:general.checkUpdate' })).toBeNull()
  })
})

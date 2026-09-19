import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const ipcMock = vi.hoisted(() => ({ invoke: vi.fn().mockResolvedValue({}) }))
vi.mock('@renderer/lib/ipc-client', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    ipcClient: { invoke: (...args: unknown[]) => ipcMock.invoke(...args) },
    onAppEvent: () => () => {},
  }
})

import i18n from '@renderer/lib/i18n'
import { useUIStore } from '@renderer/stores/ui-store'
import { SettingsPage } from './settings-page'
import { getDirtySettingsSlices } from './settings-dirty-registry'

beforeEach(async () => {
  let config = { providers: { custom: {
    name: 'Original provider', baseUrl: 'https://example.invalid/v1', models: [{ id: 'test-model' }],
  } } }
  ipcMock.invoke.mockReset().mockImplementation(async (method: string, request?: { config?: typeof config }) => {
    if (method === 'settings.get') return { settings: { theme: 'light', language: 'en' } }
    if (method === 'rightPanels.catalog') return { catalog: [], prefs: {} }
    if (method === 'pi.models.get') return { path: '/test/models.json', config }
    if (method === 'pi.models.set') {
      config = request!.config!
      return { ok: true }
    }
    if (method === 'model.list') return { models: [] }
    return {}
  })
  useUIStore.setState({ pendingExtensionConfig: null })
  await i18n.changeLanguage('en')
})

afterEach(() => cleanup())

async function editProvider(): Promise<void> {
  fireEvent.click(await screen.findByRole('button', { name: i18n.t('settings:nav.models') }))
  fireEvent.change(await screen.findByDisplayValue('Original provider'), { target: { value: 'Draft provider' } })
  await waitFor(() => expect(getDirtySettingsSlices().some((slice) => slice.id === 'pi-models')).toBe(true))
}

describe('settings page model drafts', () => {
  it('keeps provider edits across tabs and lets the global save bar save them from another tab', async () => {
    render(<SettingsPage />)
    await editProvider()

    fireEvent.click(screen.getByRole('button', { name: i18n.t('settings:nav.general') }))
    fireEvent.click(screen.getByRole('button', { name: i18n.t('settings:nav.models') }))
    expect(await screen.findByDisplayValue('Draft provider')).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: i18n.t('settings:nav.general') }))
    const save = screen.getByRole('button', { name: i18n.t('common:save') })
    expect(save).toBeEnabled()
    fireEvent.click(save)

    await waitFor(() => expect(ipcMock.invoke).toHaveBeenCalledWith('pi.models.set', {
      config: { providers: { custom: {
        name: 'Draft provider', baseUrl: 'https://example.invalid/v1', models: [{ id: 'test-model' }],
      } } },
    }))
    await waitFor(() => expect(getDirtySettingsSlices()).toHaveLength(0))
  })

  it('keeps provider edits when search temporarily hides every settings page', async () => {
    render(<SettingsPage />)
    await editProvider()

    const search = screen.getByRole('searchbox', { name: i18n.t('settings:search') })
    fireEvent.change(search, { target: { value: 'no-matching-setting-12345' } })
    fireEvent.change(search, { target: { value: '' } })

    expect(await screen.findByDisplayValue('Draft provider')).toBeVisible()
    expect(getDirtySettingsSlices().some((slice) => slice.id === 'pi-models')).toBe(true)
  })
})

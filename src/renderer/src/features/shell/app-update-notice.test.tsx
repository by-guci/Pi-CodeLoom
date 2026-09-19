import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import i18n from '@renderer/lib/i18n'
import { useAppUpdateStore } from '@renderer/lib/app-update-store'
import { AppUpdateNotice } from './app-update-notice'

const mocks = vi.hoisted(() => ({ toast: Object.assign(vi.fn(), { dismiss: vi.fn() }), invoke: vi.fn(async () => ({})) }))
vi.mock('sonner', () => ({ toast: mocks.toast }))
vi.mock('@renderer/lib/ipc-client', () => ({ ipcClient: { invoke: mocks.invoke }, onAppEvent: () => () => {} }))
afterEach(cleanup)

describe('update notification', () => {
  it('offers details without interrupting the user, supports Escape, and removes an ignored notification', async () => {
    await i18n.changeLanguage('zh')
    const state = {
      revision: 1, currentVersion: '1.0.7', version: '1.0.8', phase: 'available' as const, mode: 'automatic' as const,
      notes: 'Release notes', percent: null, transferred: null, total: null, error: null, autoCheck: true, lastCheckedAt: null, notify: true,
    }
    useAppUpdateStore.setState({ state, open: false, actionError: null })
    render(<AppUpdateNotice />)
    expect(screen.queryByRole('dialog')).toBeNull()
    act(() => mocks.toast.mock.calls.at(-1)![1].action.onClick())
    expect(screen.getByRole('dialog')).toBeVisible()
    expect(screen.getByRole('button', { name: '关闭' })).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    act(() => useAppUpdateStore.setState({ state: { ...state, revision: 2, notify: false } }))
    expect(mocks.toast.dismiss).toHaveBeenCalledWith('app-update')
  })
})

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@renderer/lib/i18n'
import { AboutSettings } from './about-settings'

const ipcMock = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: (...args: unknown[]) => ipcMock.invoke(...args) },
}))

beforeEach(async () => {
  ipcMock.invoke.mockReset().mockResolvedValue({
    name: 'Pi-CodeLoom',
    version: '1.0.3',
    electron: '43.0.0',
    chrome: '130.0.0',
    node: '22.19.0',
    platform: 'win32',
    arch: 'x64',
  })
  await i18n.changeLanguage('zh')
})

afterEach(() => cleanup())

describe('AboutSettings', () => {
  it('shows app version from desktop.appName', async () => {
    render(<AboutSettings />)
    await waitFor(() => expect(screen.getByText('1.0.3')).toBeInTheDocument())
    expect(ipcMock.invoke).toHaveBeenCalledWith('desktop.appName')
    expect(screen.getByText('Pi-CodeLoom')).toBeInTheDocument()
    expect(screen.getByText('win32 / x64')).toBeInTheDocument()
  })
})

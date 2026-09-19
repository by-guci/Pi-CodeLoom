import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@renderer/lib/i18n'
import { useUIStore } from '@renderer/stores/ui-store'
import { ThinkingPicker } from './thinking-picker'
import type { ModelThinkingOptions } from '@shared/model-thinking'

const mocks = vi.hoisted(() => ({ invoke: vi.fn().mockResolvedValue({}), success: vi.fn(), error: vi.fn() }))
vi.mock('@renderer/lib/ipc-client', () => ({ ipcClient: { invoke: mocks.invoke } }))
vi.mock('sonner', () => ({ toast: { success: mocks.success, error: mocks.error } }))
const grok: ModelThinkingOptions = { model: 'xai/grok-4.6', kind: 'effort', source: 'models.dev', options: ['low', 'medium', 'high', 'xhigh'].map((level) => ({ level: level as 'low' })) }

beforeEach(async () => {
  mocks.invoke.mockReset().mockImplementation(async (method: string) => method === 'thinkingLevel.options' ? grok : { level: 'low' })
  mocks.success.mockReset()
  mocks.error.mockReset()
  useUIStore.setState({ thinkingPickerOpen: true, historySessionFile: '/project/chat.jsonl', runState: { status: 'idle', model: grok.model, thinkingLevel: 'high' } as never })
  await i18n.changeLanguage('zh')
})
afterEach(cleanup)

describe('ThinkingPicker', () => {
  it('shows only the selected model options after loading', async () => {
    render(<ThinkingPicker />)
    expect(screen.getByRole('status')).toHaveTextContent('正在查询')
    await screen.findByRole('button', { name: /XHIGH/ })
    for (const level of ['OFF', 'MINIMAL', 'MAX', 'ULTRA']) expect(screen.queryByRole('button', { name: new RegExp(`^${level}\\b`) })).toBeNull()
    expect(screen.getByRole('button', { name: /^HIGH\b/ })).toHaveAttribute('aria-pressed', 'true')
  })

  it('uses the confirmed level and includes the target model and session', async () => {
    render(<ThinkingPicker />)
    fireEvent.click(await screen.findByRole('button', { name: /^LOW\b/ }))
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('thinkingLevel.set', { model: grok.model, sessionFile: '/project/chat.jsonl', sessionId: '', level: 'low' }))
    await waitFor(() => expect(useUIStore.getState().runState.thinkingLevel).toBe('low'))
    expect(useUIStore.getState().thinkingPickerOpen).toBe(false)
  })

  it('discards capabilities from a previous model after switching models', async () => {
    let resolveOld!: (value: ModelThinkingOptions) => void
    mocks.invoke.mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve }))
    render(<ThinkingPicker />)
    const glm: ModelThinkingOptions = { ...grok, model: 'zhipuai/glm-5.3', options: [{ level: 'low' }, { level: 'high' }, { level: 'max' }] }
    mocks.invoke.mockResolvedValueOnce(glm)
    act(() => useUIStore.getState().setRunState({ model: glm.model }))
    await screen.findByRole('button', { name: /^MAX\b/ })
    await act(async () => resolveOld(grok))
    expect(screen.queryByRole('button', { name: /XHIGH/ })).toBeNull()
    expect(screen.getByText(glm.model)).toBeInTheDocument()
  })

  it('does not overwrite another session when a pending selection resolves late', async () => {
    let resolveSet!: (value: { level: string }) => void
    mocks.invoke.mockImplementation(async (method: string) => method === 'thinkingLevel.options' ? grok : new Promise((resolve) => { resolveSet = resolve }))
    render(<ThinkingPicker />)
    fireEvent.click(await screen.findByRole('button', { name: /^LOW\b/ }))
    act(() => useUIStore.setState({ historySessionFile: '/project/other.jsonl', runState: { status: 'idle', model: 'other/model', thinkingLevel: 'max' } as never }))
    await act(async () => resolveSet({ level: 'low' }))
    expect(useUIStore.getState().runState.thinkingLevel).toBe('max')
    expect(mocks.success).not.toHaveBeenCalled()
  })

  it('does not fabricate options when lookup fails and allows retry', async () => {
    mocks.invoke.mockRejectedValueOnce(new Error('offline'))
    render(<ThinkingPicker />)
    await screen.findByRole('alert')
    expect(screen.queryByRole('button', { name: /^HIGH\b/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /重试|retry/i }))
    await screen.findByRole('button', { name: /XHIGH/ })
  })

  it('keeps a pre-session choice local for session creation to apply', async () => {
    useUIStore.setState({ historySessionFile: null })
    render(<ThinkingPicker />)
    fireEvent.click(await screen.findByRole('button', { name: /^LOW\b/ }))
    expect(useUIStore.getState().runState.thinkingLevel).toBe('low')
    expect(mocks.invoke).not.toHaveBeenCalledWith('thinkingLevel.set', expect.anything())
  })

  it('marks a toggle as enabled for any existing non-off thinking level', async () => {
    mocks.invoke.mockResolvedValueOnce({ ...grok, kind: 'toggle', options: [{ level: 'off' }, { level: 'high', enabled: true }] })
    useUIStore.getState().setRunState({ thinkingLevel: 'medium' })
    render(<ThinkingPicker />)
    expect(await screen.findByRole('button', { name: /^ON\b/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /^OFF\b/ })).toHaveAttribute('aria-pressed', 'false')
  })
})

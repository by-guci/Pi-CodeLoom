import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const ipcMock = vi.hoisted(() => ({ invoke: vi.fn().mockResolvedValue({}) }))
vi.mock('@renderer/lib/ipc-client', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, ipcClient: { invoke: (...args: unknown[]) => ipcMock.invoke(...args) } }
})

import i18n from '@renderer/lib/i18n'
import { useUIStore } from '@renderer/stores/ui-store'
import { Composer } from './composer'
import { clearTransientComposerDraft } from './composer-transient-draft'

const sessionFile = '/workspace/session.jsonl'

beforeEach(async () => {
  ipcMock.invoke.mockReset().mockImplementation(async (method: string) => {
    if (method === 'settings.get' || method === 'pi.settings.get') return { settings: {} }
    if (method === 'model.list') return { models: [] }
    if (method === 'commands.list') return { commands: [] }
    if (method === 'runtime.getState' || method === 'ipc:runtime.getState') {
      return { state: { sessionFile, sessionId: 'session-1', isStreaming: false, model: 'test/model', thinkingLevel: 'low' } }
    }
    return {}
  })
  clearTransientComposerDraft(`session:${sessionFile}`)
  useUIStore.setState({
    currentWorkspace: '/workspace', currentSessionId: 'session-1', historySessionFile: sessionFile,
    ephemeralSandboxDraft: false, pendingNewSessionPlaceholder: false,
    timelineItems: [], streamingAssistantId: null,
    optimisticPendingUserText: null, agentTurnBootstrapping: false,
    composerPrefill: null, subagentSessionGroup: null,
    pendingSteering: [], pendingFollowUp: [], sessionRuntimeRunning: {},
    sessionWaitingUi: {}, sessionSettledUnseen: {}, sessionAttention: {},
    workerLiveSnapshot: { sessionId: 'session-1', sessionFile, status: 'idle' },
    runState: { status: 'idle', model: 'test/model', thinkingLevel: 'low', toolCount: 0, errorCount: 0 },
  })
  await i18n.changeLanguage('en')
})

afterEach(() => {
  cleanup()
  clearTransientComposerDraft(`session:${sessionFile}`)
})

it('keeps the send button available and sends entered text to the selected session', async () => {
  const view = render(<Composer />)
  const send = screen.getByTitle(i18n.t('composer:send'))
  expect(send).toBeDisabled()

  const editor = view.container.querySelector('[contenteditable="true"]') as HTMLElement
  editor.textContent = 'hello from text input'
  fireEvent.input(editor)
  expect(send).toBeEnabled()
  fireEvent.click(send)

  await waitFor(() => expect(ipcMock.invoke).toHaveBeenCalledWith('prompt.send', {
    sessionId: '', sessionFile, text: 'hello from text input',
  }))
  expect(editor.textContent).toBe('')
})

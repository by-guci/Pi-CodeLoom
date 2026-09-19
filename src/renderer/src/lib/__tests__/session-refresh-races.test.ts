import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TimelineItem } from '@renderer/stores/ui-store-types'

const ipcMock = vi.hoisted(() => ({ invoke: vi.fn().mockResolvedValue({}) }))
vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: (...args: unknown[]) => ipcMock.invoke(...args) },
  onAppEvent: () => () => {},
}))

import { useUIStore } from '@renderer/stores/ui-store'
import { clearStreamPending, flushStreamPendingSync } from '@renderer/stores/ui-store-stream'
import { clearLiveSessionTimeline } from '@renderer/lib/live-session-timeline-cache'
import { clearSessionTimelineView } from '@renderer/lib/session-timeline-views'
import { clearSessionShellForTests, focusSessionSync } from '@renderer/lib/session-shell'
import { clearSessionHistoryCache } from '@renderer/lib/session-history'
import { __resetRefreshWorkspaceSessionListsForTests } from '@renderer/lib/refresh-workspace-session-lists'
import { reloadCurrentSessionData } from '@renderer/lib/reload-current-session-data'
import { appendOptimisticOutgoingMessage } from '@renderer/lib/optimistic-send'
import { openSessionIntoWorker } from '@renderer/lib/open-session'
import { beginSessionNavigation } from '@renderer/lib/session-navigation'
import { sendComposerPrompt } from '@renderer/lib/send-composer-prompt'
import { applyComposerDisplayMeta } from '@renderer/lib/session-display-meta'

const sessionA = '/workspace/session-a.jsonl'
const sessionB = '/workspace/session-b.jsonl'

function historyRows(file: string): TimelineItem[] {
  const label = file === sessionA ? 'A' : 'B'
  return [
    { id: `disk-user-${label}`, type: 'user-message', text: `${label} question`, sessionEntryId: `user-${label}`, timestamp: 1 },
    { id: `disk-assistant-${label}`, type: 'assistant-message', text: `${label} answer`, sessionEntryId: `assistant-${label}`, timestamp: 2 },
  ]
}

function historyPage(file: string) {
  return {
    items: historyRows(file),
    sourceCount: 2,
    totalCount: 2,
    sessionMeta: { model: file === sessionA ? 'test/model-a' : 'test/model-b', thinkingLevel: file === sessionA ? 'high' : 'low' },
  }
}

async function defaultInvoke(method: string, request?: Record<string, unknown>) {
  if (method === 'session.list') return { sessions: [] }
  if (method === 'session.getMessages') return historyPage(String(request?.sessionFile))
  if (method === 'session.reloadFromDisk') return { ok: true, sessionFile: request?.sessionFile }
  if (method === 'ipc:runtime.getState' || method === 'runtime.getState') {
    const file = useUIStore.getState().historySessionFile
    return { state: { sessionFile: file, ...historyPage(file || sessionA).sessionMeta } }
  }
  if (method === 'session.tree') return { nodes: [], leafId: null }
  if (method === 'pi.settings.get' || method === 'settings.get') return { settings: {} }
  return {}
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function emitDelta(text: string, contentKind: 'text' | 'thinking' = 'text'): void {
  useUIStore.getState().processEvent({
    type: 'message', phase: 'delta', role: 'assistant', contentKind, text,
    workspaceId: '/workspace', sessionId: 'session-a', sessionFile: sessionA,
    runId: 'run-a', turnId: 'turn-a', seq: 3, timestamp: 3,
  })
}

beforeEach(() => {
  ipcMock.invoke.mockReset().mockImplementation(defaultInvoke)
  vi.stubGlobal('requestAnimationFrame', () => 1)
  clearStreamPending()
  clearLiveSessionTimeline()
  clearSessionTimelineView()
  clearSessionShellForTests()
  clearSessionHistoryCache()
  __resetRefreshWorkspaceSessionListsForTests()
  useUIStore.setState({
    currentWorkspace: '/workspace', currentSessionId: 'session-a', historySessionFile: sessionA,
    pendingNewSessionPlaceholder: false, ephemeralSandboxDraft: false,
    historyLoading: false, historyLoadedCount: 2, historyTotalCount: 2,
    timelineItems: historyRows(sessionA), streamingAssistantId: null,
    optimisticPendingUserText: null, agentTurnBootstrapping: false,
    pendingSteering: [], pendingFollowUp: [], sessionRuntimeRunning: {},
    runState: { status: 'idle', model: 'test/model-a', thinkingLevel: 'high', toolCount: 0, errorCount: 0 },
    lastModel: 'test/model-a', lastThinking: 'high',
    workerLiveSnapshot: { sessionId: 'session-a', sessionFile: sessionA, status: 'idle' },
    sessions: [], subagentSessionGroup: null,
  })
  focusSessionSync('session-a', sessionA)
})

afterEach(() => {
  clearStreamPending()
  vi.unstubAllGlobals()
})

describe('session refresh races', () => {
  it('preserves active text and thinking while reloading disk history', async () => {
    appendOptimisticOutgoingMessage('new question')
    const base = { workspaceId: '/workspace', sessionId: 'session-a', sessionFile: sessionA, runId: 'run-a', turnId: 'turn-a', seq: 1, timestamp: 3 }
    useUIStore.getState().processEvent({ ...base, type: 'run', phase: 'started' })
    useUIStore.getState().processEvent({ ...base, type: 'message', role: 'user', phase: 'start', text: 'new question', sessionEntryId: 'new-user' })
    useUIStore.getState().processEvent({ ...base, type: 'message', role: 'assistant', phase: 'start' })
    emitDelta('before ')
    emitDelta('thinking before ', 'thinking')
    ipcMock.invoke.mockImplementation((method: string, request?: Record<string, unknown>) => {
      if (method === 'session.getMessages') return Promise.resolve({
        items: [...historyRows(sessionA), { id: 'disk-new-user', type: 'user-message', text: 'new question', sessionEntryId: 'new-user', timestamp: 3 }],
        sourceCount: 3, totalCount: 3,
      })
      return defaultInvoke(method, request)
    })

    expect(await reloadCurrentSessionData()).toEqual({ ok: true })
    emitDelta('after')
    emitDelta('after', 'thinking')
    flushStreamPendingSync(useUIStore.getState, useUIStore.setState)

    const state = useUIStore.getState()
    const assistant = state.timelineItems.find((item) => item.id === state.streamingAssistantId)
    expect(assistant?.text).toBe('before after')
    expect(assistant?.thinkingText).toBe('thinking before after')
    expect(state.timelineItems.filter((item) => item.type === 'user-message').map((item) => item.text))
      .toEqual(['A question', 'new question'])
  })

  it('keeps the new session and prompt target when the previous refresh finishes late', async () => {
    const delayedA = deferred<ReturnType<typeof historyPage>>()
    ipcMock.invoke.mockImplementation((method: string, request?: Record<string, unknown>) => {
      if (method === 'session.getMessages' && request?.sessionFile === sessionA) return delayedA.promise
      return defaultInvoke(method, request)
    })
    const reloading = reloadCurrentSessionData()
    await vi.waitFor(() => expect(ipcMock.invoke.mock.calls.some(([method]) => method === 'session.getMessages')).toBe(true))
    await openSessionIntoWorker('session-b', sessionB, beginSessionNavigation())

    delayedA.resolve(historyPage(sessionA))
    await reloading
    await sendComposerPrompt('intended for B')

    const prompt = ipcMock.invoke.mock.calls.filter(([method]) => method === 'prompt.send').at(-1)?.[1]
    expect(prompt).toMatchObject({ sessionId: 'session-b', sessionFile: sessionB })
    expect(useUIStore.getState().timelineItems.map((item) => item.text)).toEqual(['B question', 'B answer'])
    expect(useUIStore.getState().historySessionFile).toBe(sessionB)
  })

  it('does not clear a new session loading flag when a cancelled refresh settles', async () => {
    const delayedA = deferred<ReturnType<typeof historyPage>>()
    ipcMock.invoke.mockImplementation((method: string, request?: Record<string, unknown>) => {
      if (method === 'session.getMessages') return delayedA.promise
      return defaultInvoke(method, request)
    })
    const reloading = reloadCurrentSessionData()
    await vi.waitFor(() => expect(ipcMock.invoke.mock.calls.some(([method]) => method === 'session.getMessages')).toBe(true))
    beginSessionNavigation()
    focusSessionSync('session-b', sessionB)
    expect(useUIStore.getState().historyLoading).toBe(true)

    delayedA.resolve(historyPage(sessionA))
    await reloading

    expect(useUIStore.getState().historyLoading).toBe(true)
    expect(useUIStore.getState().historySessionFile).toBe(sessionB)
  })

  it('keeps the current model and preferences when an older session query resolves late', async () => {
    const delayedMeta = deferred<Record<string, unknown>>()
    let holdFirst = true
    ipcMock.invoke.mockImplementation((method: string, request?: Record<string, unknown>) => {
      if (method === 'ipc:runtime.getState' && holdFirst) {
        holdFirst = false
        return delayedMeta.promise
      }
      return defaultInvoke(method, request)
    })
    const oldMeta = applyComposerDisplayMeta()
    await openSessionIntoWorker('session-b', sessionB, beginSessionNavigation())
    await vi.waitFor(() => expect(useUIStore.getState().runState.model).toBe('test/model-b'))

    delayedMeta.resolve({ state: { sessionFile: sessionA, model: 'test/model-a', thinkingLevel: 'high' } })
    await oldMeta

    expect(useUIStore.getState().runState.model).toBe('test/model-b')
    expect(useUIStore.getState().runState.thinkingLevel).toBe('low')
    expect(useUIStore.getState().lastModel).toBe('test/model-b')
  })

  it('keeps the latest model query when two requests for the same session finish out of order', async () => {
    const delayedMeta = deferred<Record<string, unknown>>()
    ipcMock.invoke.mockReturnValueOnce(delayedMeta.promise)
    const oldMeta = applyComposerDisplayMeta()
    ipcMock.invoke.mockResolvedValueOnce({ state: { sessionFile: sessionA, model: 'test/new-model', thinkingLevel: 'low' } })
    await applyComposerDisplayMeta()

    delayedMeta.resolve({ state: { sessionFile: sessionA, model: 'test/old-model', thinkingLevel: 'high' } })
    await oldMeta

    expect(useUIStore.getState().runState.model).toBe('test/new-model')
    expect(useUIStore.getState().runState.thinkingLevel).toBe('low')
  })
})

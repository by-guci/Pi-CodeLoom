import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TimelineItem } from '@renderer/stores/ui-store-types'

const ipcMock = vi.hoisted(() => ({ invoke: vi.fn().mockResolvedValue({}) }))
vi.mock('@renderer/lib/ipc-client', () => ({ ipcClient: { invoke: ipcMock.invoke } }))

import { appendOptimisticOutgoingMessage } from '@renderer/lib/optimistic-send'
import { clearLiveSessionTimeline } from '@renderer/lib/live-session-timeline-cache'
import { clearSessionTimelineView } from '@renderer/lib/session-timeline-views'
import { prependOlderTimelinePage } from '@renderer/lib/timeline-history-prepend'
import { useUIStore } from '@renderer/stores/ui-store'
import { clearStreamPending, flushStreamPendingSync } from '@renderer/stores/ui-store-stream'

const sessionFile = '/workspace/session-a.jsonl'
const historyUser: TimelineItem = {
  id: 'history-user',
  type: 'user-message',
  text: 'previous question',
  sessionEntryId: 'history-user-entry',
  timestamp: 1,
}
const eventBase = {
  seq: 1,
  workspaceId: '/workspace',
  sessionId: 'session-a',
  sessionFile,
  runId: 'run-a',
  turnId: 'turn-a',
  timestamp: 2,
}

function delta(text: string, contentKind: 'text' | 'thinking' = 'text'): void {
  useUIStore.getState().processEvent({
    ...eventBase,
    type: 'message',
    role: 'assistant',
    phase: 'delta',
    contentKind,
    text,
  })
}

describe('prependOlderTimelinePage', () => {
  beforeEach(() => {
    ipcMock.invoke.mockReset().mockResolvedValue({
      items: [
        { id: 'older-user', type: 'user-message', text: 'older question', timestamp: 0 },
        { ...historyUser, id: 'disk-history-user' },
      ],
      sourceCount: 2,
      totalCount: 4,
    })
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    clearStreamPending()
    clearLiveSessionTimeline()
    clearSessionTimelineView()
    useUIStore.setState({
      currentWorkspace: '/workspace',
      currentSessionId: 'session-a',
      historySessionFile: sessionFile,
      historyTotalCount: 4,
      historyLoadedCount: 2,
      historyLoading: false,
      timelineItems: [{ ...historyUser }],
      streamingAssistantId: null,
      optimisticPendingUserText: null,
      agentTurnBootstrapping: false,
      pendingSteering: [],
      pendingFollowUp: [],
      sessionRuntimeRunning: { [sessionFile]: true },
      workerLiveSnapshot: { sessionId: 'session-a', sessionFile, status: 'running' },
      runState: { status: 'running', activeRunId: 'run-a', toolCount: 0, errorCount: 0 },
    })
  })

  afterEach(() => {
    clearStreamPending()
    clearLiveSessionTimeline()
    clearSessionTimelineView()
    vi.unstubAllGlobals()
  })

  it('keeps optimistic messages and pending deltas writable while deduplicating older history', async () => {
    const token = appendOptimisticOutgoingMessage('new question')!
    useUIStore.getState().processEvent({
      ...eventBase,
      type: 'message',
      role: 'user',
      phase: 'start',
      text: 'new question',
      sessionEntryId: 'current-user-entry',
    })
    useUIStore.getState().processEvent({
      ...eventBase,
      type: 'message',
      role: 'assistant',
      phase: 'start',
    })
    delta('before ')
    delta('thinking before ', 'thinking')

    await prependOlderTimelinePage(sessionFile, 2)
    delta('after')
    delta('after', 'thinking')
    flushStreamPendingSync(useUIStore.getState, useUIStore.setState)

    const state = useUIStore.getState()
    const assistant = state.timelineItems.find((item) => item.id === token.assistantId)
    expect(assistant?.text).toBe('before after')
    expect(assistant?.thinkingText).toBe('thinking before after')
    expect(state.streamingAssistantId).toBe(assistant?.id)
    expect(state.timelineItems.filter((item) => item.type === 'user-message').map((item) => item.text))
      .toEqual(['older question', 'previous question', 'new question'])
    expect(state.historyLoadedCount).toBe(4)
  })

  it('remaps the active assistant when projecting adjacent fragments into one row', async () => {
    useUIStore.setState({
      timelineItems: [
        { ...historyUser },
        { id: 'assistant-first', type: 'assistant-message', text: 'first ', turnId: 'turn-a', timestamp: 2 },
        { id: 'assistant-live', type: 'assistant-message', text: 'second', turnId: 'turn-a', timestamp: 3 },
      ],
      streamingAssistantId: 'assistant-live',
    })
    delta('-pending')

    await prependOlderTimelinePage(sessionFile, 2)
    delta('-latest')
    flushStreamPendingSync(useUIStore.getState, useUIStore.setState)

    const state = useUIStore.getState()
    const assistants = state.timelineItems.filter((item) => item.type === 'assistant-message')
    expect(assistants).toHaveLength(1)
    expect(assistants[0].text).toBe('first second-pending-latest')
    expect(state.streamingAssistantId).toBe(assistants[0].id)
  })

  it('does not apply an older page after the visible session changes', async () => {
    let resolvePage!: (value: { items: TimelineItem[]; sourceCount: number; totalCount: number }) => void
    ipcMock.invoke.mockReturnValueOnce(new Promise((resolve) => { resolvePage = resolve }))
    const loading = prependOlderTimelinePage(sessionFile, 2)
    const otherItems: TimelineItem[] = [
      { id: 'other-user', type: 'user-message', text: 'other session', timestamp: 1 },
    ]
    useUIStore.setState({
      currentSessionId: 'session-b',
      historySessionFile: '/workspace/session-b.jsonl',
      timelineItems: otherItems,
      historyLoadedCount: 1,
      historyTotalCount: 1,
    })
    resolvePage({ items: [{ ...historyUser }], sourceCount: 1, totalCount: 4 })
    await loading

    expect(useUIStore.getState().timelineItems).toEqual(otherItems)
    expect(useUIStore.getState().historyLoadedCount).toBe(1)
    expect(useUIStore.getState().historyTotalCount).toBe(1)
  })

  it('leaves the visible history untouched when fetching an older page fails', async () => {
    ipcMock.invoke.mockResolvedValueOnce({ error: 'read failed' })
    const before = useUIStore.getState()

    const result = await prependOlderTimelinePage(sessionFile, 2)

    expect(result.error).toBe('read failed')
    expect(useUIStore.getState().timelineItems).toBe(before.timelineItems)
    expect(useUIStore.getState().historyLoadedCount).toBe(2)
  })
})

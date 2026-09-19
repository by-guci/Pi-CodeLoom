import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Timeline } from './timeline'
import { useUIStore } from '@renderer/stores/ui-store'
import type { TimelineItem } from '@renderer/stores/ui-store-types'
import { ipcClient } from '@renderer/lib/ipc-client'
import { openSessionIntoWorker } from '@renderer/lib/open-session'
import { clearSessionShellForTests } from '@renderer/lib/session-shell'
import { clearSessionHistoryCache } from '@renderer/lib/session-history'

vi.mock('@renderer/lib/ipc-client', () => ({ ipcClient: { invoke: vi.fn(async () => ({ items: [], totalCount: 0 })) } }))
vi.mock('@renderer/lib/session-rewind', () => ({ navigateSessionToEntry: vi.fn() }))
vi.mock('@renderer/lib/session-fork', () => ({ forkSessionFromEntry: vi.fn() }))
vi.mock('@renderer/lib/session-chrome', () => ({ useSessionChrome: () => ({ canStop: false, showSpinner: false }) }))

const rows: TimelineItem[] = Array.from({ length: 80 }, (_, index) => ({
  id: `row-${index}`, sessionEntryId: `entry-${index}`, timestamp: index,
  type: index % 2 === 0 ? 'user-message' : 'assistant-message', text: `Message ${index}`,
}))

let scrollIntoView: ReturnType<typeof vi.fn>
beforeEach(() => {
  useUIStore.setState({
    currentWorkspace: '/tmp/project', historySessionFile: '/tmp/project/session.jsonl',
    timelineItems: rows, historyTotalCount: 80, historyLoadedCount: 80, historyLoading: false,
    streamingAssistantId: null, optimisticPendingUserText: null, agentTurnBootstrapping: false,
    rewindKey: '', rewindTreeNodes: [], rewindLoadingTree: false, runState: { status: 'idle' } as never,
  })
  scrollIntoView = vi.fn()
  const original = Element.prototype.scrollIntoView
  Element.prototype.scrollIntoView = scrollIntoView as (arg?: boolean | ScrollIntoViewOptions) => void
  vi.mocked(ipcClient.invoke).mockReset().mockResolvedValue({ items: [], totalCount: 0 })
  return () => { Element.prototype.scrollIntoView = original }
})

describe('outline navigation in the timeline', () => {
  it('opens the full outline before scrolling while only the latest eight turns are loaded', async () => {
    clearSessionShellForTests()
    clearSessionHistoryCache()
    useUIStore.setState({ currentWorkspace: 'C:/outline-project', timelineItems: [], historySessionFile: null })
    const nodes = rows.map((row, index) => ({
      id: row.sessionEntryId, depth: index, isLeaf: index === rows.length - 1,
      entryType: 'message', role: row.type === 'user-message' ? 'user' : 'assistant', preview: row.text,
    }))
    vi.mocked(ipcClient.invoke).mockImplementation(async (method: string) => {
      if (method === 'session.tree') return { nodes, leafId: 'entry-79' }
      if (method === 'session.getMessages') return { items: rows.slice(-16), sourceCount: 16, totalCount: rows.length }
      return {}
    })
    await act(async () => openSessionIntoWorker('outline-session', 'c:\\outline-project\\session.jsonl'))
    expect(useUIStore.getState().historySessionFile).toBe('C:/outline-project/session.jsonl')
    expect(useUIStore.getState().timelineItems).toHaveLength(16)
    render(<Timeline />)
    await waitFor(() => expect(within(screen.getByRole('navigation')).getAllByRole('button')).toHaveLength(40))
    expect(document.querySelector('[data-outline-turn-id="entry-0"]')).toBeNull()
  })

  it('reveals an older unmounted turn without changing the composer or session', async () => {
    useUIStore.setState({ composerPrefill: 'keep my draft' })
    render(<Timeline />)
    expect(document.querySelector('[data-outline-turn-id="entry-0"]')).toBeNull()
    fireEvent.click(within(screen.getByRole('navigation')).getAllByRole('button')[0])
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled())
    expect((scrollIntoView.mock.contexts.at(-1) as HTMLElement).dataset.sessionEntryId).toBe('entry-0')
    expect(useUIStore.getState().composerPrefill).toBe('keep my draft')
    expect(useUIStore.getState().historySessionFile).toBe('/tmp/project/session.jsonl')
    expect(ipcClient.invoke).not.toHaveBeenCalled()
  })

  it('jumps to an optimistic message before its session file or entry id has arrived', async () => {
    useUIStore.setState({ historySessionFile: null, timelineItems: [{ ...rows[0], sessionEntryId: undefined }] })
    render(<Timeline />)
    fireEvent.click(within(screen.getByRole('navigation')).getByRole('button'))
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled())
    expect((scrollIntoView.mock.contexts.at(-1) as HTMLElement).dataset.itemId).toBe('row-0')
  })

  it('does not follow new stream text after jumping back to an older turn', async () => {
    useUIStore.setState({ streamingAssistantId: 'row-79' })
    render(<Timeline />)
    const pane = document.querySelector('.timeline-scroll-with-dock-pane') as HTMLElement
    Object.defineProperties(pane, { scrollHeight: { configurable: true, value: 10000 }, clientHeight: { value: 700 } })
    await act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)) })
    fireEvent.click(within(screen.getByRole('navigation')).getAllByRole('button')[0])
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled())
    pane.scrollTop = 450
    act(() => useUIStore.getState().updateTimelineItem('row-79', { text: 'More streamed content' }))
    await act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)) })
    expect(pane.scrollTop).toBe(450)
  })
})

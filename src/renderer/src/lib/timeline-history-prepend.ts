import type { TimelineItem } from '@renderer/stores/ui-store-types'
import { projectTimelineItems } from '@shared/timeline-projection'
import { dedupeAdjacentUserMessages } from '@renderer/lib/timeline-dedupe'
import { fetchTimelineHistoryPage } from '@renderer/lib/session-timeline-sync'
import { getSessionTimelineView, patchSessionTimelineView } from '@renderer/lib/session-timeline-views'
import { useUIStore } from '@renderer/stores/ui-store'
import { SESSION_HISTORY_PAGE } from '@renderer/lib/session-history'
import { sessionFilesEqual } from '@renderer/lib/session-file-key'
import { resolveMergedStreamingAssistantId } from '@renderer/lib/streaming-timeline-preserve'
import { flushStreamPendingSync } from '@renderer/stores/ui-store-stream'

/** Older JSONL page → SessionTimelineView.head + ui-store (offset = historyLoadedCount). */
export async function prependOlderTimelinePage(
  sessionFile: string,
  offset: number,
  limit = SESSION_HISTORY_PAGE,
): Promise<{ items: TimelineItem[]; sourceCount: number; totalCount: number; error?: string }> {
  const page = await fetchTimelineHistoryPage(sessionFile, offset, limit)
  if (page.error) {
    return {
      items: [],
      sourceCount: 0,
      totalCount: page.totalCount,
      error: page.error,
    }
  }

  if (!sessionFilesEqual(useUIStore.getState().historySessionFile, sessionFile)) return page
  if (page.items.length > 0) flushStreamPendingSync(useUIStore.getState, useUIStore.setState)
  const store = useUIStore.getState()
  if (page.items.length > 0) {
    const view = getSessionTimelineView(sessionFile)
    const previousHead = view?.head ?? []
    patchSessionTimelineView(sessionFile, { head: [...page.items, ...previousHead] })

    // The fetched page is already sanitized; live optimistic rows must survive pagination.
    const merged = dedupeAdjacentUserMessages([...page.items, ...store.timelineItems])
    const displayed = projectTimelineItems(merged) as TimelineItem[]
    const streamingAssistantId = resolveMergedStreamingAssistantId(
      displayed,
      store.timelineItems,
      store.streamingAssistantId,
    )
    useUIStore.setState({ timelineItems: displayed, streamingAssistantId })
  }

  useUIStore.setState({
    historyLoadedCount: Math.min(
      Math.max(store.historyTotalCount, page.totalCount),
      store.historyLoadedCount + page.sourceCount,
    ),
    historyTotalCount: Math.max(store.historyTotalCount, page.totalCount),
  })

  return {
    items: page.items,
    sourceCount: page.sourceCount,
    totalCount: page.totalCount,
  }
}

import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { loadSessionHistoryWithRetry } from '@renderer/lib/load-session-history'
import { applyComposerDisplayMeta } from '@renderer/lib/session-display-meta'
import { requestTimelineBottomAnchor } from '@renderer/features/timeline/timeline-bottom-anchor'
import { refreshSessionTree } from '@renderer/lib/rewind-metadata'
import { refreshWorkspaceSessionLists } from '@renderer/lib/refresh-workspace-session-lists'
import type { TimelineItem } from '@renderer/stores/ui-store-types'
import { assertSessionNavigation, beginSessionNavigation } from '@renderer/lib/session-navigation'
import { sessionFilesEqual } from '@renderer/lib/session-file-key'

export async function reloadCurrentSessionData(): Promise<{ ok: boolean; error?: string }> {
  const store = useUIStore.getState()
  const sessionFile = store.historySessionFile
  const sessionId = store.currentSessionId

  if (!sessionFile || !sessionId) {
    await refreshWorkspaceSessionLists()
    return { ok: true }
  }

  const navToken = beginSessionNavigation()
  const isCurrent = () =>
    assertSessionNavigation(navToken) &&
    sessionFilesEqual(useUIStore.getState().historySessionFile, sessionFile)
  await refreshWorkspaceSessionLists()
  if (!isCurrent()) return { ok: true }

  store.setHistoryLoading(true)
  try {
    const reloadRes = await ipcClient.invoke('session.reloadFromDisk', { sessionFile }).catch(() => ({ ok: false }))
    if (!isCurrent()) return { ok: true }
    if (!reloadRes?.ok) {
      console.warn('[reloadCurrentSessionData] Worker reload:', reloadRes?.error)
    }
    const hist = await loadSessionHistoryWithRetry(sessionFile, { navToken, bindPending: false, alignWorkerOnRetry: false })
    if (!isCurrent()) return { ok: true }
    if (hist.error) return { ok: false, error: hist.error }
    const { items, totalCount, sourceCount, sessionMeta } = hist
    store.loadHistoryItems(items as TimelineItem[])
    store.setHistoryMeta(totalCount, sourceCount, sessionFile)
    await applyComposerDisplayMeta(sessionMeta)
    if (!isCurrent()) return { ok: true }
    void refreshSessionTree(sessionFile)
    // 重载确认的是磁盘最新内容：把视口钉回最新（用户可能在检查历史位置时触发重载）
    requestTimelineBottomAnchor('session-reloaded')
    return { ok: true }
  } catch (e: unknown) {
    if (!isCurrent()) return { ok: true }
    console.error('[reloadCurrentSessionData]', e)
    return { ok: false, error: (e instanceof Error ? e.message : String(e)) || '刷新失败' }
  } finally {
    if (isCurrent()) store.setHistoryLoading(false)
  }
}

import type { TimelineItem } from '@renderer/stores/ui-store-types'
import type { SessionTreeNode } from '../rewind/session-tree-list'

export type TimelineOutlineEntry = { id: string; title: string; preview: string }

export function outlineText(text: string): string {
  const plain = text.slice(0, 4000)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s*(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+\.\s+)/gm, '')
    .replace(/[*`~]/g, '')
    .replace(/\s+/g, ' ').trim()
  return plain.length > 240 ? `${plain.slice(0, 240)}…` : plain
}

/** Tree previews cover unloaded history; only the current leaf's ancestry belongs in the outline. */
export function buildTimelineOutline(items: TimelineItem[], nodes: SessionTreeNode[] = []): TimelineOutlineEntry[] {
  const path: SessionTreeNode[] = []
  let foundLeaf = false
  for (const node of nodes) {
    while (path.length && path[path.length - 1].depth >= node.depth) path.pop()
    path.push(node)
    if (node.isLeaf) { foundLeaf = true; break }
  }
  const entries: TimelineOutlineEntry[] = []
  const byId = new Map<string, TimelineOutlineEntry>()
  let current: TimelineOutlineEntry | undefined
  for (const node of foundLeaf ? path : []) {
    if (node.entryType !== 'message') continue
    if (node.role === 'user') {
      current = { id: node.id, title: outlineText(node.preview || node.label || ''), preview: '' }
      entries.push(current)
      byId.set(current.id, current)
    } else if (node.role === 'assistant' && current && node.preview?.trim()) {
      current.preview = outlineText(node.preview)
    }
  }

  current = undefined
  for (const item of items) {
    if (item.type === 'user-message') {
      const id = item.sessionEntryId || item.id
      const segments = item.segments?.map((segment) => segment.type === 'text'
        ? segment.text
        : segment.type === 'file' ? segment.attachment.name : segment.name).join(' ')
      const title = outlineText(item.text?.trim() || segments || item.attachments?.map((file) => file.name).join(' ') || '')
      current = byId.get(id)
      if (current) current.title = title || current.title
      else {
        current = { id, title, preview: '' }
        entries.push(current)
        byId.set(id, current)
      }
    } else if (item.type === 'assistant-message' && current && item.text?.trim()) {
      current.preview = outlineText(item.text)
    }
  }
  return entries
}

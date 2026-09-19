import { describe, expect, it } from 'vitest'
import type { TimelineItem } from '@renderer/stores/ui-store-types'
import type { SessionTreeNode } from '../rewind/session-tree-list'
import { buildTimelineOutline, outlineText } from './timeline-outline'

const message = (id: string, type: TimelineItem['type'], text = ''): TimelineItem => ({
  id, sessionEntryId: id, type, text, timestamp: 0,
})
const node = (id: string, depth: number, role: string, preview: string, isLeaf = false): SessionTreeNode => ({
  id, depth, role, preview, isLeaf, entryType: 'message',
})

describe('conversation outline', () => {
  it('creates one stop per question and uses the final prose reply, excluding tools and thinking', () => {
    const entries = buildTimelineOutline([
      message('orphan', 'assistant-message', 'prior answer'),
      message('u1', 'user-message', 'first question'),
      message('a1', 'assistant-message', 'looking into it'),
      { ...message('think', 'assistant-message'), thinkingText: 'private reasoning' },
      { ...message('tool', 'tool-call'), toolOutput: 'long output' },
      message('a2', 'assistant-message', 'final answer'),
      message('u2', 'user-message', 'next question'),
    ])
    expect(entries).toEqual([
      { id: 'u1', title: 'first question', preview: 'final answer' },
      { id: 'u2', title: 'next question', preview: '' },
    ])
  })

  it('includes unloaded ancestors of the current leaf but excludes sibling and future branches', () => {
    const nodes = [
      node('root', 0, 'user', 'old question'),
      node('reply', 1, 'assistant', 'old answer'),
      node('discarded', 2, 'user', 'other branch'),
      node('current', 2, 'user', 'current question', true),
      node('future', 3, 'user', 'after the leaf'),
    ]
    expect(buildTimelineOutline([], nodes).map((entry) => entry.id)).toEqual(['root', 'current'])
    expect(buildTimelineOutline([], nodes)[0].preview).toBe('old answer')
    expect(buildTimelineOutline([], nodes.map((n) => ({ ...n, isLeaf: false })))).toEqual([])
  })

  it('merges live replies by entry id without duplicate stops and appends an optimistic question', () => {
    const nodes = [node('u', 0, 'user', 'disk preview'), node('a', 1, 'assistant', 'partial', true)]
    const entries = buildTimelineOutline([
      { ...message('optimistic-u', 'user-message', 'full question'), sessionEntryId: 'u' },
      message('a', 'assistant-message', 'streamed answer'),
      { ...message('live', 'user-message', 'new question'), sessionEntryId: undefined },
    ], nodes)
    expect(entries).toEqual([
      { id: 'u', title: 'full question', preview: 'streamed answer' },
      { id: 'live', title: 'new question', preview: '' },
    ])
  })

  it('uses attachment names for attachment-only messages without exposing file paths', () => {
    expect(buildTimelineOutline([
      { ...message('file', 'user-message'), attachments: [{ name: 'design.png', path: '/private/design.png', kind: 'image' }] },
      { ...message('segments', 'user-message'), segments: [{ type: 'text', text: 'check this' }] },
    ]).map((entry) => entry.title)).toEqual(['design.png', 'check this'])
  })

  it('keeps previews compact and removes markdown decorations without rendering HTML', () => {
    expect(outlineText('## **Result**\n- [details](https://example.com) and `code`')).toBe('Result details and code')
    expect(outlineText('x'.repeat(2000))).toHaveLength(241)
  })
})

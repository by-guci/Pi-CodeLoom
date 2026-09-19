import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useRef } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TimelineItem } from '@renderer/stores/ui-store-types'
import { useUIStore } from '@renderer/stores/ui-store'
import { TimelineOutlineRail } from './timeline-outline-rail'
import { TIMELINE_VIEW_ENTRY_EVENT } from './timeline-view-jump'

vi.mock('react-i18next', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string, args?: { index: number; title: string }) => args ? `${args.index}: ${args.title}` : key }),
}))

const items: TimelineItem[] = [
  { id: 'u1', type: 'user-message', text: 'First question', timestamp: 1 },
  { id: 'a1', type: 'assistant-message', text: 'First reply', timestamp: 2 },
  { id: 'u2', type: 'user-message', text: 'Second question', timestamp: 3 },
  { id: 'a2', type: 'assistant-message', text: 'Second reply', timestamp: 4 },
]

function Harness({ rows = items, sessionFile = 'session' }: { rows?: TimelineItem[]; sessionFile?: string }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  return (
    <>
      <div ref={scrollRef} data-testid="pane">
        <div ref={contentRef}>
          {rows.filter((row) => row.type === 'user-message').map((row) => <div key={row.id} data-outline-turn-id={row.id} />)}
        </div>
      </div>
      <TimelineOutlineRail key={sessionFile} items={rows} sessionFile={sessionFile} scrollRef={scrollRef} contentRef={contentRef} />
    </>
  )
}

beforeEach(() => useUIStore.setState({ rewindTreeNodes: [], rewindKey: '', rewindLoadingTree: false }))

describe('TimelineOutlineRail', () => {
  it('previews a turn, expands neighboring ticks, and dismisses on Escape or pointer leave', () => {
    render(<Harness />)
    const first = screen.getByRole('button', { name: '1: First question' })
    for (const button of screen.getAllByRole('button')) {
      expect(button.firstElementChild).toHaveStyle({ width: '8px' })
    }
    fireEvent.pointerEnter(first)
    expect(screen.getByRole('tooltip')).toHaveTextContent('First questionFirst reply')
    expect(first.firstElementChild).toHaveStyle({ width: '36px' })
    expect(screen.getByRole('button', { name: '2: Second question' }).firstElementChild).toHaveStyle({ width: '28px' })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('tooltip')).toBeNull()
    fireEvent.pointerEnter(first)
    fireEvent.pointerLeave(document.querySelector('.timeline-outline')!)
    expect(screen.queryByRole('tooltip')).toBeNull()
    for (const button of screen.getAllByRole('button')) {
      expect(button.firstElementChild).toHaveStyle({ width: '8px' })
    }
  })

  it('supports a single tab stop, arrow keys, Home/End, and read-only view navigation', () => {
    render(<Harness />)
    const nav = screen.getByRole('navigation')
    const buttons = within(nav).getAllByRole('button')
    expect(buttons.filter((button) => button.tabIndex === 0)).toHaveLength(1)
    act(() => buttons[1].focus())
    fireEvent.keyDown(buttons[1], { key: 'ArrowUp' })
    expect(buttons[0]).toHaveFocus()
    fireEvent.keyDown(buttons[0], { key: 'End' })
    expect(buttons[1]).toHaveFocus()
    fireEvent.keyDown(buttons[1], { key: 'Home' })
    expect(buttons[0]).toHaveFocus()
    const jump = vi.fn()
    window.addEventListener(TIMELINE_VIEW_ENTRY_EVENT, jump)
    fireEvent.click(buttons[0])
    expect((jump.mock.calls[0][0] as CustomEvent).detail).toEqual({ entryId: 'u1' })
    expect(screen.queryByRole('tooltip')).toBeNull()
    window.removeEventListener(TIMELINE_VIEW_ENTRY_EVENT, jump)
  })

  it('tracks the visible turn as the chat scrolls without moving the chat itself', async () => {
    render(<Harness />)
    const pane = screen.getByTestId('pane')
    Object.defineProperties(pane, { clientHeight: { value: 500 }, scrollHeight: { value: 2200 } })
    document.querySelectorAll<HTMLElement>('[data-outline-turn-id]').forEach((row, index) => {
      row.getBoundingClientRect = () => ({ top: index * 1000 - pane.scrollTop }) as DOMRect
    })
    await waitFor(() => expect(screen.getByRole('button', { name: '1: First question' })).toHaveAttribute('aria-current', 'location'))
    pane.scrollTop = 1100
    fireEvent.scroll(pane)
    await waitFor(() => expect(screen.getByRole('button', { name: '2: Second question' })).toHaveAttribute('aria-current', 'location'))
    expect(pane.scrollTop).toBe(1100)
  })

  it('updates a live preview and clears it when switching sessions', () => {
    const { rerender } = render(<Harness />)
    fireEvent.pointerEnter(screen.getByRole('button', { name: '2: Second question' }))
    rerender(<Harness rows={items.map((item) => item.id === 'a2' ? { ...item, text: 'Streaming update' } : item)} />)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Streaming update')
    rerender(<Harness rows={[{ ...items[0], id: 'other', text: 'Other session' }]} sessionFile="other" />)
    expect(screen.queryByRole('tooltip')).toBeNull()
    expect(screen.getAllByRole('button')).toHaveLength(1)
  })

  it('ignores a previous session tree while the new tree is still loading', () => {
    const nodes = [{ id: 'old', depth: 0, isLeaf: true, role: 'user', preview: 'Old session', entryType: 'message' }]
    useUIStore.setState({
      rewindKey: 'session', rewindLoadingTree: true,
      rewindTreeNodes: nodes,
    })
    render(<Harness />)
    expect(screen.queryByRole('button', { name: /Old session/ })).toBeNull()
  })

  it('renders nothing for an empty conversation', () => {
    render(<Harness rows={[]} />)
    expect(screen.queryByRole('navigation')).toBeNull()
  })

  it('shows unloaded turns immediately when the index uses Windows separators and the view uses a normalized path', async () => {
    render(<Harness rows={items.slice(2)} sessionFile="C:/workspace/session.jsonl" />)
    expect(screen.getAllByRole('button')).toHaveLength(1)
    const nodes = items.map((item, index) => ({
      id: item.id, depth: index, isLeaf: index === items.length - 1,
      entryType: 'message', role: item.type === 'user-message' ? 'user' : 'assistant', preview: item.text,
    }))
    act(() => useUIStore.setState({ rewindKey: 'c:\\workspace\\session.jsonl', rewindTreeNodes: nodes, rewindLoadingTree: false }))
    await waitFor(() => expect(screen.getAllByRole('button')).toHaveLength(2))
    expect(screen.getByRole('button', { name: '1: First question' })).toBeInTheDocument()
  })
})

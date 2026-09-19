import { memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { useUIStore } from '@renderer/stores/ui-store'
import type { TimelineItem } from '@renderer/stores/ui-store-types'
import { sessionFilesEqual } from '@renderer/lib/session-file-key'
import { buildTimelineOutline } from './timeline-outline'
import { requestTimelineViewEntry } from './timeline-view-jump'

interface TimelineOutlineRailProps {
  items: TimelineItem[]
  sessionFile: string | null
  scrollRef: RefObject<HTMLDivElement>
  contentRef: RefObject<HTMLDivElement>
}

export const TimelineOutlineRail = memo(function TimelineOutlineRail({ items, sessionFile, scrollRef, contentRef }: TimelineOutlineRailProps) {
  const { t } = useTranslation()
  const tree = useUIStore((s) => sessionFilesEqual(s.rewindKey, sessionFile) && !s.rewindLoadingTree ? s.rewindTreeNodes : undefined)
  const entries = useMemo(() => buildTimelineOutline(items, tree), [items, tree])
  const entryIds = entries.map((entry) => entry.id).join('\n')
  const [activeId, setActiveId] = useState<string | null>(null)
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [focusId, setFocusId] = useState<string | null>(null)
  const [previewTop, setPreviewTop] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const navRef = useRef<HTMLElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const tooltipId = useId()
  const buttonsRef = useRef(new Map<string, HTMLButtonElement>())
  const previewIndex = entries.findIndex((entry) => entry.id === previewId)
  const preview = entries[previewIndex]
  const currentId = entries.some((entry) => entry.id === activeId) ? activeId : entries.at(-1)?.id

  // Cache row offsets only when layout changes. Scroll events only search the cached positions.
  useEffect(() => {
    const pane = scrollRef.current
    const content = contentRef.current
    if (!pane || !content) return
    const ids = entryIds.split('\n')
    let offsets: { id: string; top: number }[] = []
    let precedingId: string | undefined
    let frame = 0
    let dirty = true
    const paint = () => {
      frame = 0
      if (dirty) {
        const root = rootRef.current
        if (root?.parentElement) {
          root.style.setProperty('--outline-preview-width', `${Math.max(80, Math.min(356, root.parentElement.clientWidth - 64))}px`)
        }
        const origin = pane.getBoundingClientRect().top - pane.scrollTop
        offsets = Array.from(content.querySelectorAll<HTMLElement>('[data-outline-turn-id]'))
          .map((row) => ({ id: row.dataset.outlineTurnId!, top: row.getBoundingClientRect().top - origin }))
        precedingId = ids[ids.indexOf(offsets[0]?.id) - 1]
        dirty = false
      }
      if (!offsets.length) return
      const readingLine = pane.scrollTop + Math.min(pane.clientHeight, rootRef.current?.clientHeight || pane.clientHeight) * 0.3
      let lo = 0
      let hi = offsets.length - 1
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2)
        if (offsets[mid].top <= readingLine) lo = mid
        else hi = mid - 1
      }
      const atBottom = pane.scrollHeight - pane.clientHeight - pane.scrollTop <= 4
      const aboveFirst = readingLine < offsets[0].top && precedingId
      setActiveId(aboveFirst && !atBottom ? precedingId! : offsets[atBottom ? offsets.length - 1 : lo].id)
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(paint) }
    const resize = new ResizeObserver(() => { dirty = true; schedule() })
    resize.observe(content)
    resize.observe(pane)
    if (rootRef.current) resize.observe(rootRef.current)
    pane.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('timeline-scroll', schedule)
    schedule()
    return () => {
      cancelAnimationFrame(frame)
      resize.disconnect()
      pane.removeEventListener('scroll', schedule)
      window.removeEventListener('timeline-scroll', schedule)
    }
  }, [entryIds, sessionFile, scrollRef, contentRef])

  useEffect(() => {
    if (previewId || focusId || !currentId) return
    const nav = navRef.current
    const button = buttonsRef.current.get(currentId)
    if (!nav || !button) return
    if (button.offsetTop < nav.scrollTop) nav.scrollTop = button.offsetTop
    else if (button.offsetTop + button.offsetHeight > nav.scrollTop + nav.clientHeight) {
      nav.scrollTop = button.offsetTop + button.offsetHeight - nav.clientHeight
    }
  }, [currentId, previewId, focusId])

  useLayoutEffect(() => {
    if (!previewId) return
    const root = rootRef.current
    const button = buttonsRef.current.get(previewId)
    if (!root || !button) return
    const center = button.getBoundingClientRect().top - root.getBoundingClientRect().top + button.offsetHeight / 2
    const height = previewRef.current?.offsetHeight || 0
    setPreviewTop(Math.max(0, Math.min(root.clientHeight - height, center - height / 2)))
  }, [previewId, preview?.preview, preview?.title])

  useEffect(() => {
    if (!previewId) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setPreviewId(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [previewId])

  if (!entries.length) return null

  return (
    <div ref={rootRef} className="timeline-outline electron-no-drag" onPointerLeave={() => setPreviewId(null)}>
      <nav
        ref={navRef}
        className="timeline-outline-track"
        aria-label={t('timeline:outline.label')}
        data-independent-scroll
        onScroll={() => setPreviewId(null)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) { setFocusId(null); setPreviewId(null) }
        }}
      >
        {entries.map((entry, index) => {
          const distance = previewIndex < 0 ? 5 : Math.abs(index - previewIndex)
          const title = entry.title || t('timeline:outline.attachment')
          return (
            <button
              key={entry.id}
              ref={(node) => { if (node) buttonsRef.current.set(entry.id, node); else buttonsRef.current.delete(entry.id) }}
              type="button"
              className="timeline-outline-stop"
              aria-label={t('timeline:outline.jump', { index: index + 1, title })}
              aria-current={entry.id === currentId ? 'location' : undefined}
              aria-describedby={entry.id === previewId ? tooltipId : undefined}
              tabIndex={entry.id === (focusId || currentId) ? 0 : -1}
              data-outline-entry={entry.id}
              onPointerEnter={() => setPreviewId(entry.id)}
              onFocus={() => { setFocusId(entry.id); setPreviewId(entry.id) }}
              onClick={() => { requestTimelineViewEntry(entry.id); setPreviewId(null) }}
              onKeyDown={(event) => {
                const next = event.key === 'ArrowDown' ? Math.min(entries.length - 1, index + 1)
                  : event.key === 'ArrowUp' ? Math.max(0, index - 1)
                    : event.key === 'Home' ? 0 : event.key === 'End' ? entries.length - 1 : null
                if (next == null) return
                event.preventDefault()
                const nav = navRef.current
                const target = buttonsRef.current.get(entries[next].id)
                if (nav && target) {
                  nav.scrollTop = Math.max(0, target.offsetTop - nav.clientHeight / 2)
                  target.focus({ preventScroll: true })
                }
              }}
            >
              <span
                className="timeline-outline-tick"
                data-emphasized={distance === 0 || entry.id === currentId ? '' : undefined}
                style={{ width: distance < 4 ? 36 - distance * 8 : 8 }}
                aria-hidden="true"
              />
            </button>
          )
        })}
      </nav>
      {preview ? (
        <div ref={previewRef} className="timeline-outline-preview" style={{ top: previewTop }}>
          <div id={tooltipId} role="tooltip" className="timeline-outline-preview-card">
            <p className="timeline-outline-preview-title">{preview.title || t('timeline:outline.attachment')}</p>
            {preview.preview ? <p className="timeline-outline-preview-text">{preview.preview}</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  )
})

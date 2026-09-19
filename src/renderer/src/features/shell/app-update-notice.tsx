import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { X } from '@renderer/components/icons'
import { connectAppUpdates, useAppUpdateStore } from '@renderer/lib/app-update-store'
import { AppUpdatePanel } from '@renderer/features/settings/app-update-panel'
import { btnCompact } from '@renderer/features/settings/settings-controls'

export function AppUpdateNotice() {
  const { t } = useTranslation()
  const state = useAppUpdateStore((store) => store.state)
  const open = useAppUpdateStore((store) => store.open)
  const announced = useRef('')
  const dialogRef = useRef<HTMLDivElement>(null)
  const titleId = useId()

  useEffect(() => connectAppUpdates(), [])

  useEffect(() => {
    if (!state?.notify || !['available', 'downloaded'].includes(state.phase)) {
      toast.dismiss('app-update')
      return
    }
    const key = `${state.phase}:${state.version}`
    if (announced.current === key) return
    announced.current = key
    toast(t(`settings:updates.status.${state.phase}`, { version: state.version }), {
      id: 'app-update', duration: Infinity,
      action: { label: t('settings:updates.details'), onClick: () => useAppUpdateStore.setState({ open: true }) },
    })
  }, [state, t])

  useEffect(() => {
    if (!open) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialogRef.current?.querySelector<HTMLElement>('button')?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); useAppUpdateStore.setState({ open: false }); return }
      if (event.key !== 'Tab') return
      const elements = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [tabindex="0"]') || [])
      const first = elements[0]
      const last = elements.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); previous?.focus() }
  }, [open])

  if (!open) return null
  return createPortal(
    <div className="electron-no-drag fixed inset-0 z-[600] flex items-center justify-center bg-black/45 p-4" onPointerDown={(event) => {
      if (event.target === event.currentTarget) useAppUpdateStore.setState({ open: false })
    }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} className="max-h-[calc(100vh-2rem)] w-full max-w-lg overflow-auto rounded-lg border border-border bg-popover p-5 text-popover-foreground shadow-xl">
        <div className="flex items-center justify-between gap-3">
          <h2 id={titleId} className="text-lg font-semibold">{t('settings:updates.title')}</h2>
          <button type="button" className={btnCompact} aria-label={t('common:close')} onClick={() => useAppUpdateStore.setState({ open: false })}><X className="h-4 w-4" aria-hidden="true" /></button>
        </div>
        <AppUpdatePanel />
      </div>
    </div>, document.body,
  )
}

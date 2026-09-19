import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { cn } from '@renderer/lib/utils'
import { X, Brain, Check, Loader2 } from '@renderer/components/icons'
import { toast } from 'sonner'
import { normalizeModelKey, normalizeThinkingLevel } from '@renderer/lib/format-run-display'
import { sessionFilesEqual } from '@renderer/lib/session-file-key'
import type { ModelThinkingOptions, ThinkingLevel } from '@shared/model-thinking'

export function ThinkingPicker() {
  const { t } = useTranslation()
  const titleId = useId()
  const open = useUIStore((s) => s.thinkingPickerOpen)
  const setOpen = useUIStore((s) => s.setThinkingPickerOpen)
  const current = normalizeThinkingLevel(useUIStore((s) => s.runState.thinkingLevel))
  const model = normalizeModelKey(useUIStore((s) => s.runState.model))
  const sessionFile = useUIStore((s) => s.historySessionFile)
  const [request, setRequest] = useState<{ model: string; sessionFile: string | null; data?: ModelThinkingOptions; error?: boolean } | null>(null)
  const [retry, setRetry] = useState(0)
  const [pending, setPending] = useState<string | null>(null)
  const requestSeq = useRef(0)
  const panelRef = useRef<HTMLDivElement>(null)
  const capabilities = request && request.model === model && request.sessionFile === sessionFile ? request.data : undefined
  const failed = request && request.model === model && request.sessionFile === sessionFile && request.error

  useEffect(() => {
    const seq = ++requestSeq.current
    setPending(null)
    if (!open || !model) return
    let active = true
    setRequest(null)
    void ipcClient.invoke('thinkingLevel.options', { model, sessionFile: sessionFile ?? undefined }).then((data: ModelThinkingOptions) => {
      if (!active || seq !== requestSeq.current) return
      if (data?.model !== model || !Array.isArray(data.options)) throw new Error('Invalid model capabilities')
      setRequest({ model, sessionFile, data })
    }).catch(() => { if (active && seq === requestSeq.current) setRequest({ model, sessionFile, error: true }) })
    return () => { active = false; requestSeq.current++ }
  }, [open, model, sessionFile, retry])

  useEffect(() => {
    if (!open) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    panelRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false) }
      if (event.key !== 'Tab') return
      const buttons = Array.from(panelRef.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') || [])
      const first = buttons[0]
      const last = buttons.at(-1)
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); previous?.focus() }
  }, [open, setOpen])

  if (!open) return null

  const label = (level: string, enabled?: boolean) => enabled ? t('composer:thinkingPicker.enabled') : level.toUpperCase()
  const isSelected = (option: ModelThinkingOptions['options'][number]) => option.enabled ? !!current && current !== 'off' : current === option.level
  const pick = async (level: ThinkingLevel, enabled?: boolean) => {
    if (!model || pending || !capabilities?.options.some((option) => option.level === level)) return
    if (!sessionFile) {
      useUIStore.getState().setRunState({ thinkingLevel: level })
      setOpen(false)
      return
    }
    const targetModel = model
    const targetFile = sessionFile
    const seq = ++requestSeq.current
    setPending(level)
    try {
      const response = await ipcClient.invoke('thinkingLevel.set', { sessionId: '', sessionFile: targetFile, model: targetModel, level })
      const now = useUIStore.getState()
      if (seq !== requestSeq.current || !sessionFilesEqual(now.historySessionFile, targetFile) || normalizeModelKey(now.runState.model) !== targetModel) return
      const actual = normalizeThinkingLevel(response?.level)
      if (!actual) throw new Error('THINKING_LEVEL_NOT_CONFIRMED')
      now.setRunState({ thinkingLevel: actual })
      setOpen(false)
      toast.success(t('composer:thinkingPicker.selected', { level: label(actual, actual === level && enabled) }))
    } catch {
      const now = useUIStore.getState()
      if (seq === requestSeq.current && sessionFilesEqual(now.historySessionFile, targetFile) && normalizeModelKey(now.runState.model) === targetModel) {
        toast.error(t('composer:thinkingPicker.switchFailed'))
      }
    } finally {
      if (seq === requestSeq.current) setPending(null)
    }
  }

  return (
    <div className="picker-backdrop backdrop-motion fixed inset-0 z-[110] flex items-end justify-center bg-black/40 p-4 pb-28 sm:items-start sm:pt-20" onClick={() => setOpen(false)}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
        className="picker-panel w-full max-w-md overflow-hidden rounded-xl border border-border/80 bg-background shadow-2xl outline-none"
        style={{ boxShadow: '0 16px 48px color-mix(in srgb, var(--foreground) 12%, transparent)' }} onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <Brain className="h-4 w-4 shrink-0 text-muted-foreground/70" aria-hidden="true" />
            <div className="min-w-0">
              <h2 id={titleId} className="text-[14px] font-medium">{t('composer:thinkingPicker.title')}</h2>
              <p className="truncate font-mono text-[11px] text-muted-foreground" title={model}>{model || t('composer:noModelSelected')}</p>
            </div>
          </div>
          <button type="button" onClick={() => setOpen(false)} aria-label={t('common:close')} className="row-hover rounded-lg p-1.5 text-foreground-secondary hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <div className="py-1">
          {!model ? <p className="px-4 py-4 text-sm text-muted-foreground">{t('composer:thinkingPicker.selectModel')}</p>
            : failed ? <div className="space-y-2 px-4 py-4"><p role="alert" className="text-sm text-muted-foreground">{t('composer:thinkingPicker.loadFailed')}</p><button type="button" className="text-sm text-foreground underline" onClick={() => setRetry((value) => value + 1)}>{t('common:retry')}</button></div>
              : !capabilities ? <p role="status" className="flex items-center gap-2 px-4 py-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />{t('composer:thinkingPicker.loading')}</p>
                : capabilities.options.length === 0 ? <p className="px-4 py-4 text-sm text-muted-foreground">{t(`composer:thinkingPicker.${capabilities.kind === 'fixed' ? 'fixed' : 'unknown'}`)}</p>
                  : capabilities.options.map((option) => (
                    <button type="button" key={option.level} disabled={pending !== null} aria-pressed={isSelected(option)}
                      onClick={() => void pick(option.level, option.enabled)}
                      className={cn('picker-row flex w-full items-center gap-3 px-4 py-2.5 text-left disabled:opacity-50', isSelected(option) && 'bg-[var(--bg-active)]')}>
                      <div className="min-w-0 flex-1">
                        <div className="font-mono text-[12px] uppercase">{label(option.level, option.enabled)}</div>
                        <div className="text-[11px] text-muted-foreground">{t(`composer:thinkingPicker.descriptions.${option.enabled ? 'enabled' : option.level}`)}</div>
                      </div>
                      {pending === option.level ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : isSelected(option) ? <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" /> : null}
                    </button>
                  ))}
        </div>
        {capabilities?.kind === 'budget' ? <p className="border-t px-4 py-3 text-xs text-muted-foreground">{t('composer:thinkingPicker.budget')}</p> : null}
        {capabilities?.limitedByRuntime ? <p className="border-t px-4 py-3 text-xs text-muted-foreground">{t('composer:thinkingPicker.limited')}</p> : null}
        {capabilities?.source === 'runtime' ? <p className="border-t px-4 py-3 text-xs text-muted-foreground">{t('composer:thinkingPicker.runtime')}</p> : null}
      </div>
    </div>
  )
}

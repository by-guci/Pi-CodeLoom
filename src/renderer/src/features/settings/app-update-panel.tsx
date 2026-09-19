import { useTranslation } from 'react-i18next'
import { Switch } from '@renderer/components/ui/switch'
import { appUpdateAction, useAppUpdateStore } from '@renderer/lib/app-update-store'
import { btnCompact, btnOutline, btnPrimary } from './settings-controls'

export function AppUpdatePanel() {
  const { t } = useTranslation()
  const state = useAppUpdateStore((store) => store.state)
  const actionError = useAppUpdateStore((store) => store.actionError)
  const busy = !state || ['checking', 'downloading', 'installing'].includes(state.phase)
  const unavailable = !state || state.mode === 'development'
  const error = actionError || state?.error

  return (
    <div className="space-y-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-foreground" role="status">
          {t(`settings:updates.status.${state?.phase || 'loading'}`, { version: state?.version || '', current: state?.currentVersion || '' })}
        </p>
        <button type="button" className={btnOutline} disabled={busy || unavailable || state?.phase === 'downloaded'} onClick={() => void appUpdateAction('check')}>
          {t('settings:updates.check')}
        </button>
      </div>
      {state?.mode !== 'automatic' && state ? <p className="text-xs text-muted-foreground">{t(`settings:updates.mode.${state.mode}`)}</p> : null}
      {state?.phase === 'downloading' ? (
        <div className="space-y-1.5">
          <progress className="h-2 w-full accent-[var(--brand)]" aria-label={t('settings:updates.progress')} max={100} value={state.percent ?? undefined} />
          <p className="text-xs tabular-nums text-muted-foreground">{state.percent == null ? t('settings:updates.preparing') : `${Math.floor(state.percent)}%`}</p>
        </div>
      ) : null}
      {error ? <p role="alert" className="text-sm text-destructive">{t(`settings:updates.errors.${error}`)}</p> : null}
      {state?.notes && state.version ? (
        <div className="space-y-2">
          <p className="text-xs font-medium text-foreground">{t('settings:updates.releaseNotes')}</p>
          <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted/30 p-3 font-sans text-sm leading-relaxed text-foreground-secondary">{state.notes}</pre>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {state?.phase === 'available' && state.mode === 'automatic' ? (
          <button type="button" className={btnPrimary} onClick={() => void appUpdateAction('download')}>{t('settings:updates.download')}</button>
        ) : null}
        {state?.phase === 'downloaded' ? (
          <button type="button" className={btnPrimary} onClick={() => void appUpdateAction('install')}>{t('settings:updates.install')}</button>
        ) : null}
        <button type="button" className={btnCompact} onClick={() => void appUpdateAction('openRelease')}>{t('settings:updates.openRelease')}</button>
        {state?.phase === 'available' ? (
          <button type="button" className={btnCompact} onClick={() => {
            void appUpdateAction('ignore')
            useAppUpdateStore.setState({ open: false })
          }}>{t('settings:updates.ignore')}</button>
        ) : null}
      </div>
      <div className="flex items-center justify-between gap-4 border-t border-border/50 pt-3">
        <div>
          <p className="text-sm text-foreground">{t('settings:updates.autoCheck')}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t('settings:updates.autoCheckHint')}</p>
        </div>
        <Switch aria-label={t('settings:updates.autoCheck')} checked={state?.autoCheck ?? true} disabled={!state} onCheckedChange={(enabled) => void appUpdateAction('autoCheck', { enabled })} />
      </div>
    </div>
  )
}

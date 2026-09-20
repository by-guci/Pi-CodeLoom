import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ipcClient } from '@renderer/lib/ipc-client'
import { PACKAGE_SUMMARIES_ZH, type PackageCatalog, type PackageStoreState } from '@shared/package-store'
import { SettingsPageHeader } from './settings-shell'
import { ConfirmDialog } from './confirm-dialog'
import { btnOutline, btnPrimary, inputCls, selectCls } from './settings-controls'

export function PackageStorePanel() {
  const { t, i18n } = useTranslation()
  const tr = (key: string, options?: Record<string, unknown>) => t(`settings:packageStore.${key}`, options)
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [type, setType] = useState('')
  const [sort, setSort] = useState('downloads')
  const [page, setPage] = useState(1)
  const [tab, setTab] = useState<'browse' | 'installed'>('browse')
  const [catalog, setCatalog] = useState<PackageCatalog | null>(null)
  const [state, setState] = useState<PackageStoreState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [pending, setPending] = useState(false)
  const [confirmAll, setConfirmAll] = useState(false)
  const [confirmation, setConfirmation] = useState<{ name: string; action: 'install' | 'update' | 'remove' } | null>(null)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    let active = true
    setLoading(true)
    void Promise.all([
      tab === 'browse' ? ipcClient.invoke('packages.browse', { search: query, type, sort, page }) : Promise.resolve(null),
      ipcClient.invoke('packages.state', { latest: tab === 'installed' }),
    ]).then(([catalog, state]) => {
      if (!active) return
      setCatalog(catalog)
      setState(state)
    }).catch(() => { if (active) setError(tr('loadFailed')) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [query, type, sort, page, tab, revision])

  const busy = pending || !!state?.busy
  useEffect(() => {
    if (!busy) return
    let active = true
    const timer = setInterval(() => {
      void ipcClient.invoke('packages.state', {}).then((next: PackageStoreState) => { if (active) setState(next) }).catch(() => {})
    }, 1500)
    return () => { active = false; clearInterval(timer) }
  }, [busy])

  const perform = async (method: string, request: object) => {
    setPending(true)
    setError('')
    try {
      const next = await ipcClient.invoke(method, request)
      if (mounted.current) setState(next)
    } catch (error) {
      if (mounted.current) setError(String(error).includes('PACKAGE_AGENT_BUSY') ? tr('agentBusy') : tr('operationFailed'))
    } finally {
      if (mounted.current) { setPending(false); setRevision((value) => value + 1) }
    }
  }
  const openOfficial = (name?: string) => {
    void ipcClient.invoke('packages.open', { name }).catch(() => setError(tr('openFailed')))
  }
  const installed = state?.installed || []
  const rows = tab === 'browse' ? catalog?.packages || [] : installed.map((pkg) => ({ ...pkg, description: '', author: '', types: [], downloads: 0, version: pkg.version || '' }))

  return <div className="space-y-5">
    <SettingsPageHeader title={tr('title')} description={tr('description')} />
    <div className="flex flex-wrap items-center gap-2">
      {(['browse', 'installed'] as const).map((value) => <button key={value} className={tab === value ? btnPrimary : btnOutline} aria-pressed={tab === value} onClick={() => { setTab(value); setPage(1) }}>{tr(value)}</button>)}
      <button className={btnOutline} onClick={() => openOfficial()}>{tr('official')}</button>
      <button className={btnOutline} disabled={busy || !state?.writable} onClick={() => void perform('packages.checkUpdates', {})}>{tr('checkUpdates')}</button>
      {tab === 'installed' && <button className={btnPrimary} disabled={busy || !state?.writable || !installed.length} onClick={() => setConfirmAll(true)}>{tr('updateAll')}</button>}
      <button className={btnOutline} disabled={busy} onClick={() => { setError(''); setRevision((value) => value + 1) }}>{tr('refresh')}</button>
    </div>
    {tab === 'browse' && <form className="flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); setQuery(search); setPage(1) }}>
      <input type="search" className={`${inputCls} min-w-48 flex-1`} aria-label={tr('search')} placeholder={tr('search')} value={search} onChange={(event) => setSearch(event.target.value)} />
      <select className={selectCls} aria-label={tr('type')} value={type} onChange={(event) => { setType(event.target.value); setPage(1) }}>
        {['', 'extension', 'skill', 'prompt', 'theme'].map((value) => <option key={value} value={value}>{tr(value || 'allTypes')}</option>)}
      </select>
      <select className={selectCls} aria-label={tr('sort')} value={sort} onChange={(event) => { setSort(event.target.value); setPage(1) }}>
        {['downloads', 'recent', 'name'].map((value) => <option key={value} value={value}>{tr(value)}</option>)}
      </select>
      <button className={btnPrimary} type="submit">{tr('searchButton')}</button>
    </form>}
    <p className="text-xs leading-relaxed text-muted-foreground">{tr('translationNote')}</p>
    {state && !state.writable && <p className="rounded-md border border-border p-3 text-sm text-muted-foreground">{tr('wsl')}</p>}
    {state?.needsRestart && <p role="status" className="rounded-md border border-border bg-muted/40 p-3 text-sm">{tr('restart')}</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {state?.batch && <div className="space-y-2 rounded-md border border-border p-3 text-sm">
      <p role="status">{state.busy ? tr('batchProgress', { completed: state.batch.completed, total: state.batch.total }) : state.batch.total === 0 ? tr('batchEmpty') : tr('batchDone', { success: state.batch.results.filter((item) => item.status === 'updated').length, failed: state.batch.results.filter((item) => item.status !== 'updated').length })}</p>
      <ul className="max-h-40 space-y-1 overflow-auto">{state.batch.results.map((item, index) => <li key={`${item.name}-${index}`} className="break-all text-xs text-muted-foreground">{item.name} · {tr(`batchStatus.${item.status}`)}</li>)}</ul>
    </div>}
    {busy && <div role="status" className="rounded-md border border-border bg-muted/30 p-3 text-sm"><p>{tr('working')}</p><p className="mt-1 break-all font-mono text-xs text-muted-foreground">{state?.operation}</p><pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap text-xs">{state?.log.join('\n')}</pre></div>}
    {loading ? <p role="status" className="py-8 text-sm text-muted-foreground">{tr('loading')}</p> : <>
      {!rows.length && !error && <p className="rounded-xl border border-dashed border-border py-12 text-center text-muted-foreground">{tr('empty')}</p>}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {rows.map((pkg) => {
          const local = installed.find((item) => item.name === pkg.name)
          const summary = i18n.language.startsWith('zh') ? PACKAGE_SUMMARIES_ZH[pkg.name] : undefined
          return <article key={pkg.name} className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-card p-4 text-card-foreground">
            <div className="flex flex-wrap items-start justify-between gap-2"><h3 className="break-all text-sm font-semibold">{pkg.name}</h3>{local && <span className="rounded bg-muted px-2 py-0.5 text-xs">{tr('installed')}</span>}</div>
            {summary ? <div><p className="text-sm leading-relaxed">{summary}</p><details className="mt-2 text-xs text-muted-foreground"><summary className="cursor-pointer">{tr('original')}</summary><p className="mt-1 break-words">{pkg.description || tr('noDescription')}</p></details></div>
              : <p className="break-words text-sm leading-relaxed text-muted-foreground">{pkg.description || tr('noDescription')}</p>}
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">{pkg.types.map((kind) => <span key={kind} className="rounded bg-muted px-2 py-1">{['extension', 'skill', 'prompt', 'theme'].includes(kind) ? tr(kind) : kind}</span>)}{pkg.author && <span>{pkg.author}</span>}{pkg.downloads > 0 && <span>{tr('downloadsCount', { count: pkg.downloads })}</span>}</div>
            <p className="text-xs text-muted-foreground">{local ? tr('installedVersion', { version: local.version || tr('missing') }) : pkg.version ? `v${pkg.version}` : ''}{local?.pinned ? ` · ${tr('pinned')}` : ''}{local?.updateAvailable ? ` · ${tr('updateAvailable')}` : ''}</p>
            {local && <p className="text-xs text-muted-foreground">{tr('latestVersion', { version: local.latestVersionError ? tr('versionQueryFailed') : local.latestVersion || tr('versionNotChecked') })}{local.latestVersion && local.latestVersion === local.version ? ` · ${tr('upToDate')}` : ''}</p>}
            <div className="mt-auto flex flex-wrap gap-2">
              <button className={btnOutline} onClick={() => openOfficial(pkg.name)}>{tr('details')}</button>
              {local ? <>
                <button className={btnPrimary} disabled={busy || !state?.writable} onClick={() => setConfirmation({ name: pkg.name, action: 'update' })}>{tr('update')}</button>
                <button className={btnOutline} disabled={busy || !state?.writable} onClick={() => setConfirmation({ name: pkg.name, action: 'remove' })}>{tr('remove')}</button>
              </> : <button className={btnPrimary} disabled={busy || !state?.writable} onClick={() => setConfirmation({ name: pkg.name, action: 'install' })}>{tr('install')}</button>}
            </div>
          </article>
        })}
      </div>
      {tab === 'browse' && catalog && <div className="flex items-center justify-between gap-3 text-sm"><button className={btnOutline} disabled={page <= 1 || busy} onClick={() => setPage(page - 1)}>{tr('previous')}</button><span className="text-muted-foreground">{tr('pagination', { page, total: catalog.total })}</span><button className={btnOutline} disabled={!catalog.hasNext || busy} onClick={() => setPage(page + 1)}>{tr('next')}</button></div>}
    </>}
    <ConfirmDialog open={!!confirmation} title={confirmation ? tr(confirmation.action) : ''} message={confirmation ? tr(confirmation.action === 'remove' ? 'removeConfirm' : 'installConfirm', { name: confirmation.name }) : ''} destructive={confirmation?.action === 'remove'} confirmLabel={confirmation ? tr(confirmation.action) : ''} onCancel={() => setConfirmation(null)} onConfirm={() => {
      if (!confirmation || busy) return
      const request = confirmation
      setConfirmation(null)
      void perform('packages.mutate', request)
    }} />
    <ConfirmDialog open={confirmAll} title={tr('updateAll')} message={tr('updateAllConfirm', { count: installed.length })} confirmLabel={tr('updateAll')} onCancel={() => setConfirmAll(false)} onConfirm={() => {
      if (busy) return
      setConfirmAll(false)
      void perform('packages.updateAll', {})
    }} />
  </div>
}

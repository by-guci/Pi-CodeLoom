import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ipcClient } from '@renderer/lib/ipc-client'
import { SettingsPageHeader } from '@renderer/features/settings/settings-shell'
import { SettingRow, SettingsSection } from '@renderer/features/settings/settings-page-shared'
import { AppUpdatePanel } from './app-update-panel'

type AppInfo = {
  name?: string
  version?: string
  electron?: string
  chrome?: string
  node?: string
  platform?: string
  arch?: string
}

function dash(value?: string): string {
  return value?.trim() || '—'
}

export function AboutSettings() {
  const { t } = useTranslation()
  const [info, setInfo] = useState<AppInfo | null>(null)

  useEffect(() => {
    void ipcClient.invoke('desktop.appName').then((res) => setInfo(res ?? null)).catch(() => setInfo(null))
  }, [])

  return (
    <div className="space-y-8">
      <SettingsPageHeader title={t('settings:about.title')} description={t('settings:about.description')} />
      <SettingsSection title={t('settings:about.sectionApp')}>
        <SettingRow label={t('settings:about.appName')}>
          <span className="font-mono text-xs">{dash(info?.name)}</span>
        </SettingRow>
        <SettingRow label={t('settings:about.version')}>
          <span className="font-mono text-xs">{dash(info?.version)}</span>
        </SettingRow>
        <SettingRow label={t('settings:about.platform')}>
          <span className="font-mono text-xs">{[info?.platform, info?.arch].filter(Boolean).join(' / ') || '—'}</span>
        </SettingRow>
      </SettingsSection>
      <SettingsSection title={t('settings:updates.title')}>
        <AppUpdatePanel />
      </SettingsSection>
      <SettingsSection title={t('settings:about.sectionRuntime')}>
        <SettingRow label="Electron">
          <span className="font-mono text-xs">{dash(info?.electron)}</span>
        </SettingRow>
        <SettingRow label="Chrome">
          <span className="font-mono text-xs">{dash(info?.chrome)}</span>
        </SettingRow>
        <SettingRow label="Node">
          <span className="font-mono text-xs">{dash(info?.node)}</span>
        </SettingRow>
      </SettingsSection>
    </div>
  )
}

export const APP_RELEASES_URL = 'https://github.com/by-guci/Pi-CodeLoom/releases'

export type AppUpdateMode = 'automatic' | 'manual' | 'development'
export type AppUpdatePhase = 'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'verifying' | 'downloaded' | 'installing' | 'error'
export type AppUpdateError = 'check-failed' | 'no-release' | 'invalid-update' | 'download-failed' | 'download-verification-failed' | 'install-failed' | 'busy'
export type AppUpdatePreferences = { lastCheckedAt: number | null }

export type AppUpdateState = {
  revision: number
  currentVersion: string
  mode: AppUpdateMode
  phase: AppUpdatePhase
  version: string | null
  notes: string
  percent: number | null
  transferred: number | null
  total: number | null
  error: AppUpdateError | null
  lastCheckedAt: number | null
  notify: boolean
}

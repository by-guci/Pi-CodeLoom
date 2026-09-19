export const APP_RELEASES_URL = 'https://github.com/by-guci/Pi-CodeLoom/releases'

export type AppUpdateMode = 'automatic' | 'manual' | 'development'
export type AppUpdatePhase = 'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'downloaded' | 'installing' | 'error'
export type AppUpdateError = 'check-failed' | 'no-release' | 'invalid-update' | 'download-failed' | 'install-failed' | 'busy'
export type AppUpdatePreferences = { autoCheck: boolean; ignoredVersion: string | null; lastCheckedAt: number | null }

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
  autoCheck: boolean
  lastCheckedAt: number | null
  notify: boolean
}

import type { AppUpdater, UpdateInfo } from 'electron-updater'
import type { AppUpdateMode, AppUpdatePreferences, AppUpdateState } from '@shared/app-update'

export type UpdateEngine = Pick<AppUpdater,
  'on' | 'setFeedURL' | 'checkForUpdates' | 'downloadUpdate' | 'quitAndInstall' |
  'autoDownload' | 'autoInstallOnAppQuit' | 'allowDowngrade' | 'allowPrerelease' | 'disableWebInstaller' | 'disableDifferentialDownload'
>

interface UpdateDependencies {
  engine: UpdateEngine
  currentVersion: string
  mode: AppUpdateMode
  preferences: () => AppUpdatePreferences
  save: (patch: Partial<AppUpdatePreferences>) => void
  notify: (state: AppUpdateState) => void
  busy: () => boolean
  prepareInstall: () => Promise<void>
}

export function isTrustedUpdate(info: UpdateInfo): boolean {
  if (!/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(info.version) || !info.files?.length) return false
  return info.files.every(({ url }) => {
    if (typeof url !== 'string' || !url || /[\\?#]/.test(url)) return false
    if (!url.includes('/')) return !url.includes('..') && !url.includes(':')
    try {
      const parsed = new URL(url)
      return parsed.protocol === 'https:' && parsed.hostname === 'github.com' && !parsed.port &&
        !parsed.username && !parsed.password &&
        /^\/by-guci\/Pi-CodeLoom\/releases\/download\/[^/]+\/[^/]+$/.test(parsed.pathname)
    } catch { return false }
  })
}

export class AppUpdateController {
  state: AppUpdateState
  private checkedThisLaunch = false
  private checking = false
  private downloading = false
  private downloadError: Error | null = null
  private downloadConfirmed = false

  constructor(private readonly deps: UpdateDependencies) {
    const prefs = deps.preferences()
    this.state = {
      revision: 0, currentVersion: deps.currentVersion, mode: deps.mode, phase: 'idle',
      version: null, notes: '', percent: null, transferred: null, total: null, error: null,
      lastCheckedAt: prefs.lastCheckedAt, notify: false,
    }
    const engine = deps.engine
    engine.autoDownload = false
    engine.autoInstallOnAppQuit = false
    engine.allowDowngrade = false
    engine.allowPrerelease = false
    engine.disableWebInstaller = true
    // A failed differential reconstruction otherwise restarts a full download after 100%.
    engine.disableDifferentialDownload = true
    engine.setFeedURL({ provider: 'github', owner: 'by-guci', repo: 'Pi-CodeLoom', private: false })
    engine.on('update-available', (info: UpdateInfo) => {
      if (this.state.phase !== 'checking') return
      if (!isTrustedUpdate(info)) { this.patch({ phase: 'error', error: 'invalid-update', notify: false }); return }
      const notes = typeof info.releaseNotes === 'string' ? info.releaseNotes
        : info.releaseNotes?.map((note) => note.note).join('\n\n') || ''
      this.deps.save({ lastCheckedAt: Date.now() })
      this.patch({
        phase: 'available', version: info.version, notes: notes.slice(0, 20000), error: null,
        notify: true,
      })
    })
    engine.on('update-not-available', () => {
      if (this.state.phase !== 'checking') return
      this.deps.save({ lastCheckedAt: Date.now() })
      this.patch({ phase: 'up-to-date', version: null, notes: '', error: null, notify: false })
    })
    engine.on('download-progress', (progress) => {
      if (this.state.phase !== 'downloading' && this.state.phase !== 'verifying') return
      this.patch({
        phase: progress.percent >= 100 || this.state.phase === 'verifying' ? 'verifying' : 'downloading',
        percent: Number.isFinite(progress.percent) ? Math.max(0, Math.min(100, progress.percent)) : null,
        transferred: Number.isFinite(progress.transferred) ? progress.transferred : null,
        total: Number.isFinite(progress.total) ? progress.total : null,
      })
    })
    engine.on('update-downloaded', (info: UpdateInfo) => {
      if (!this.downloading || !['downloading', 'verifying'].includes(this.state.phase) || info.version !== this.state.version) return
      this.downloadConfirmed = true
    })
    engine.on('error', (error: Error) => {
      // Keep the download locked until the SDK promise finishes handling the error.
      if (this.downloading) this.downloadError = error
      else if (this.checking || this.state.phase === 'installing') this.fail(error)
    })
  }

  private patch(patch: Partial<AppUpdateState>): void {
    const prefs = this.deps.preferences()
    this.state = { ...this.state, ...patch, lastCheckedAt: prefs.lastCheckedAt, revision: this.state.revision + 1 }
    this.deps.notify(this.state)
  }

  private fail(error: unknown): void {
    if (this.state.error === 'invalid-update') return
    if (this.downloading || ['downloading', 'verifying'].includes(this.state.phase)) {
      const code = (error as { code?: string })?.code
      const verification = code === 'ERR_CHECKSUM_MISMATCH' || code === 'ERR_UPDATER_INVALID_SIGNATURE'
      this.patch({ phase: 'available', error: verification ? 'download-verification-failed' : 'download-failed', percent: null, transferred: null, total: null, notify: false })
    } else if (this.state.phase === 'installing' || this.state.error === 'install-failed') {
      this.patch({ phase: 'downloaded', error: 'install-failed', notify: false })
    } else {
      const code = (error as { code?: string })?.code
      const noRelease = code === 'ERR_UPDATER_LATEST_VERSION_NOT_FOUND' || code === 'ERR_UPDATER_NO_PUBLISHED_VERSIONS'
      this.patch({ phase: 'error', error: noRelease ? 'no-release' : 'check-failed', notify: false })
    }
  }

  async check(manual: boolean): Promise<AppUpdateState> {
    if (this.state.mode === 'development' || this.checking || this.downloading || ['downloading', 'verifying', 'downloaded', 'installing'].includes(this.state.phase)) return this.state
    if (!manual && this.checkedThisLaunch) return this.state
    this.checkedThisLaunch = true
    this.checking = true
    this.patch({ phase: 'checking', error: null, percent: null, notify: false })
    try {
      const result = await this.deps.engine.checkForUpdates()
      if (!result || this.state.phase === 'checking') this.patch({ phase: 'error', error: 'check-failed' })
    } catch (error) { this.fail(error) }
    finally { this.checking = false }
    return this.state
  }

  async download(): Promise<AppUpdateState> {
    if (this.state.mode !== 'automatic' || this.downloading || this.checking || this.state.phase !== 'available') return this.state
    this.downloading = true
    this.downloadError = null
    this.downloadConfirmed = false
    this.patch({ phase: 'downloading', percent: null, transferred: null, total: null, error: null, notify: false })
    try {
      await this.deps.engine.downloadUpdate()
      if (this.downloadError) throw this.downloadError
      if (!this.downloadConfirmed) throw new Error('UPDATE_DOWNLOAD_NOT_CONFIRMED')
      this.patch({ phase: 'downloaded', percent: 100, error: null, notify: true })
    }
    catch (error) { this.fail(error) }
    finally { this.downloading = false; this.downloadError = null }
    return this.state
  }

  async install(): Promise<AppUpdateState> {
    if (this.state.mode !== 'automatic' || this.downloading || this.state.phase !== 'downloaded') return this.state
    if (this.deps.busy()) { this.patch({ error: 'busy' }); return this.state }
    this.patch({ phase: 'installing', error: null, notify: false })
    try {
      await this.deps.prepareInstall()
      this.deps.engine.quitAndInstall(false, true)
    } catch (error) { this.fail(error) }
    return this.state
  }

  ignore(): AppUpdateState {
    if (this.state.phase === 'available' && this.state.version) {
      this.patch({ notify: false })
    }
    return this.state
  }

}

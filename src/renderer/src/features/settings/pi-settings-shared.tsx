export type PiSettingsSnapshot = Record<string, unknown>

export type PiInfo = {
  sdkVersion?: string
  agentDir?: string
  authStatus?: string
  authProviders?: Array<{ provider?: string }>
}

export type SdkStatus = {
  builtinVersion?: string
  globalVersion?: string
  userVersion?: string
  npmAvailable?: boolean
  runtime?: { mode: 'host' | 'wsl'; distro?: string | null }
  workerFallback?: boolean
  active?: { version?: string; kind?: 'builtin' | 'global' | 'user'; fallbackReason?: string }
}

export function settingsEqual(a: PiSettingsSnapshot | null, b: PiSettingsSnapshot | null): boolean {
  if (!a || !b) return a === b
  return JSON.stringify(a) === JSON.stringify(b)
}

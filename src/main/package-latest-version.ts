import { PACKAGE_NAME_PATTERN } from '@shared/package-store'

type Latest = { latestVersion: string | null; latestVersionError: boolean }
const cache = new Map<string, { at: number; value: Latest }>()
const pending = new Map<string, Promise<Latest>>()

export function cachedPackageVersion(name: string): Latest | undefined { return cache.get(name)?.value }

export async function fetchLatestPackageVersion(name: string, refresh = false): Promise<Latest> {
  if (!PACKAGE_NAME_PATTERN.test(name)) throw new Error('INVALID_PACKAGE_NAME')
  const hit = cache.get(name)
  if (!refresh && hit && Date.now() - hit.at < (hit.value.latestVersionError ? 30_000 : 300_000)) return hit.value
  const running = pending.get(name)
  if (running) return running
  const task = (async () => {
    let value: Latest
    try {
      const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}/latest`, { signal: AbortSignal.timeout(12_000) })
      if (!response.ok) throw new Error('REGISTRY_FAILED')
      const data = await response.json() as { version?: unknown }
      if (typeof data.version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][\w.+-]+)?$/.test(data.version)) throw new Error('INVALID_VERSION')
      value = { latestVersion: data.version, latestVersionError: false }
    } catch { value = { latestVersion: null, latestVersionError: true } }
    cache.set(name, { at: Date.now(), value })
    return value
  })().finally(() => pending.delete(name))
  pending.set(name, task)
  return task
}

export async function loadLatestPackageVersions(names: string[], refresh = false): Promise<void> {
  const queue = [...new Set(names)]
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
    while (queue.length) await fetchLatestPackageVersion(queue.shift()!, refresh)
  }))
}

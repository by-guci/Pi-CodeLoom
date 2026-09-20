import { readFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { getActiveSdkModule } from './ipc/sdk-session'
import { resolveActiveAgentDir } from './agent-dir'
import { isWslRuntimeActive } from './wsl/runtime-config'
import { workerManager } from './worker-manager'
import { invalidateAdapterCatalog } from '../extension-compat/adapter-loader'
import { verifyCatalogPackage } from './package-store-catalog'
import { cachedPackageVersion, loadLatestPackageVersions } from './package-latest-version'
import { PACKAGE_NAME_PATTERN, type PackageStoreState, type InstalledStorePackage } from '@shared/package-store'

const operation: Pick<PackageStoreState, 'busy' | 'operation' | 'log' | 'error' | 'needsRestart' | 'batch'> = { busy: false, operation: null, log: [], error: null, needsRestart: false }
let updates: Set<string> | undefined

export function npmSourceName(source: string): string | undefined {
  if (!source.startsWith('npm:')) return undefined
  const match = source.slice(4).match(/^((?:@[^/]+\/)?[^@]+)(?:@.+)?$/)
  return match && PACKAGE_NAME_PATTERN.test(match[1]) ? match[1] : undefined
}

async function manager() {
  if (isWslRuntimeActive()) throw new Error('WSL_PACKAGE_MANAGEMENT_UNAVAILABLE')
  const sdk = await getActiveSdkModule(app.getPath('userData'))
  const agentDir = resolveActiveAgentDir()
  // Use an agent-owned cwd so user-wide actions cannot update project-local packages.
  const cwd = join(agentDir, 'package-store')
  mkdirSync(cwd, { recursive: true })
  const settings = sdk.SettingsManager.create(cwd, agentDir)
  const packages = new sdk.DefaultPackageManager({ cwd, agentDir, settingsManager: settings })
  return { packages, settings }
}

export async function packageStoreState(options: { latest?: boolean; refresh?: boolean } = {}): Promise<PackageStoreState> {
  if (isWslRuntimeActive()) return { ...operation, log: [...operation.log], installed: [], writable: false }
  const { packages } = await manager()
  const installed: InstalledStorePackage[] = []
  for (const pkg of packages.listConfiguredPackages()) {
    const name = npmSourceName(pkg.source)
    if (pkg.scope !== 'user' || !name) continue
    let version: string | null = null
    try {
      if (pkg.installedPath) version = JSON.parse(readFileSync(join(pkg.installedPath, 'package.json'), 'utf8')).version || null
    } catch { /* Missing package stays visible so it can be repaired or removed. */ }
    installed.push({ name, source: pkg.source, version, pinned: pkg.source !== `npm:${name}`, updateAvailable: updates?.has(pkg.source) })
  }
  if (options.latest) await loadLatestPackageVersions(installed.map((pkg) => pkg.name), options.refresh)
  for (const pkg of installed) Object.assign(pkg, cachedPackageVersion(pkg.name))
  return { ...operation, log: [...operation.log], installed, writable: true }
}

export async function checkPackageUpdates(): Promise<PackageStoreState> {
  if (operation.busy) throw new Error('PACKAGE_OPERATION_BUSY')
  operation.busy = true
  operation.operation = 'check'
  operation.error = null
  try {
    const { packages } = await manager()
    updates = new Set((await packages.checkForAvailableUpdates()).filter((pkg) => pkg.scope === 'user').map((pkg) => pkg.source))
  } catch {
    operation.error = 'PACKAGE_UPDATE_CHECK_FAILED'
    throw new Error(operation.error)
  } finally { operation.busy = false }
  return packageStoreState({ latest: true, refresh: true })
}

export async function mutateStorePackage(action: 'install' | 'update' | 'remove', name: string): Promise<PackageStoreState> {
  if (!PACKAGE_NAME_PATTERN.test(name)) throw new Error('INVALID_PACKAGE_NAME')
  if (operation.busy) throw new Error('PACKAGE_OPERATION_BUSY')
  if (workerManager.hasActiveTurns) throw new Error('PACKAGE_AGENT_BUSY')
  operation.busy = true
  operation.operation = `${action}: ${name}`
  operation.batch = undefined
  operation.log = []
  operation.error = null
  try {
    const { packages, settings } = await manager()
    const configured = packages.listConfiguredPackages().filter((pkg) => pkg.scope === 'user' && npmSourceName(pkg.source) === name)
    if (configured.length > 1) throw new Error('PACKAGE_AMBIGUOUS_SOURCE')
    if (action === 'install') {
      if (configured.length) throw new Error('PACKAGE_ALREADY_CONFIGURED')
      await verifyCatalogPackage(name)
    } else if (!configured.length) throw new Error('PACKAGE_NOT_INSTALLED')
    if (workerManager.hasActiveTurns) throw new Error('PACKAGE_AGENT_BUSY')
    // Release native modules held by idle workers before npm replaces files on Windows.
    if (workerManager.isRunning) await workerManager.stop()
    const source = configured[0]?.source || `npm:${name}`
    packages.setProgressCallback((event) => {
      operation.log = [...operation.log, `${event.type}: ${event.action} ${name}`].slice(-50)
    })
    if (action === 'install') await packages.installAndPersist(source)
    else if (action === 'remove') await packages.removeAndPersist(source)
    else await packages.update(source)
    await settings.flush()
    invalidateAdapterCatalog()
    updates = undefined
    operation.needsRestart = true
  } catch (error) {
    // Package lifecycle output can contain credentials from npm configuration. Do not relay it.
    const code = error instanceof Error && /^PACKAGE_[A-Z_]+$/.test(error.message) ? error.message : 'PACKAGE_OPERATION_FAILED'
    operation.error = code
    throw new Error(code)
  } finally { operation.busy = false }
  return packageStoreState()
}

export async function updateAllStorePackages(): Promise<PackageStoreState> {
  if (operation.busy) throw new Error('PACKAGE_OPERATION_BUSY')
  if (workerManager.hasActiveTurns) throw new Error('PACKAGE_AGENT_BUSY')
  operation.busy = true
  operation.operation = 'check'
  operation.error = null
  operation.log = []
  operation.batch = { total: 0, completed: 0, results: [] }
  try {
    const { packages, settings } = await manager()
    const configured = packages.listConfiguredPackages().filter((pkg) => pkg.scope === 'user' && npmSourceName(pkg.source))
    updates = new Set((await packages.checkForAvailableUpdates()).filter((pkg) => pkg.scope === 'user' && npmSourceName(pkg.source)).map((pkg) => pkg.source))
    const candidates = configured.filter((pkg) => updates!.has(pkg.source))
    const batch = operation.batch
    batch.total = candidates.length
    if (workerManager.hasActiveTurns) throw new Error('PACKAGE_AGENT_BUSY')
    if (candidates.length && workerManager.isRunning) await workerManager.stop()
    for (const pkg of candidates) {
      const name = npmSourceName(pkg.source)!
      operation.operation = `update: ${name}`
      if (workerManager.hasActiveTurns) {
        batch.results.push({ name, status: 'skipped' })
        batch.completed++
        continue
      }
      try {
        // Preserve source constraints; the SDK excludes exact version pins from update checks.
        if (configured.filter((item) => npmSourceName(item.source) === name).length !== 1) throw new Error('PACKAGE_AMBIGUOUS_SOURCE')
        await packages.update(pkg.source)
        await settings.flush()
        batch.results.push({ name, status: 'updated' })
        updates.delete(pkg.source)
        operation.needsRestart = true
        invalidateAdapterCatalog()
      } catch { batch.results.push({ name, status: 'failed' }) }
      batch.completed++
      operation.log = [...operation.log, `${batch.results.at(-1)!.status}: ${name}`].slice(-50)
    }
    if (batch.results.some((item) => item.status !== 'updated')) operation.error = 'PACKAGE_BATCH_INCOMPLETE'
  } catch (error) {
    operation.batch = undefined
    operation.error = error instanceof Error && error.message === 'PACKAGE_AGENT_BUSY' ? error.message : 'PACKAGE_UPDATE_CHECK_FAILED'
    throw new Error(operation.error)
  } finally { operation.busy = false }
  return packageStoreState()
}

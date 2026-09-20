import { readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { app } from 'electron'
import { resolveActiveAgentDir } from './agent-dir'
import { getActiveSdkModule } from './ipc/sdk-session'
import { readModelsConfigRaw, stripJsonComments } from './pi-models-json'
import { validateModelsConfigWithSdk } from './active-sdk-models'
import { lookupThinkingRecord } from './models-dev-thinking'
import { thinkingMapFromOptions } from '@shared/model-thinking'
import { workerManager } from './worker-manager'

/** Fill only absent map keys. No persistent "done" flag: offline/unknown models can retry. */
export async function migrateThinkingConfig(agentDir: string, sdk: unknown, canWrite = () => true): Promise<number> {
  const snapshot = readModelsConfigRaw(`${agentDir}/models.json`)
  if (!snapshot.raw || snapshot.parseError) return 0
  const config = JSON.parse(stripJsonComments(snapshot.raw))
  let count = 0
  await Promise.all(Object.entries(config.providers || {}).map(async ([provider, value]) => {
    const entry = value as { baseUrl?: string; models?: Array<{ id: string; reasoning?: boolean; baseUrl?: string; thinkingLevelMap?: Record<string, string | null> }> }
    await Promise.all((entry.models || []).map(async (model) => {
      if (!model.id || model.reasoning === false) return
      const record = await lookupThinkingRecord(provider, model.id, model.baseUrl || entry.baseUrl).catch(() => undefined)
      if (!record || record.reasoning === false) return
      const map = thinkingMapFromOptions(record.reasoning_options)
      if (!map) return
      const missing = Object.entries(map).filter(([key]) => !Object.hasOwn(model.thinkingLevelMap || {}, key))
      if (!missing.length) return
      model.thinkingLevelMap = { ...Object.fromEntries(missing), ...model.thinkingLevelMap }
      count++
    }))
  }))
  if (!count || !canWrite()) return 0
  const error = await validateModelsConfigWithSdk(sdk, agentDir, config)
  if (error) return 0
  // The user may have saved model settings while metadata or SDK validation was pending.
  if (!canWrite() || readFileSync(snapshot.path, 'utf8') !== snapshot.raw) return 0
  const temporary = `${snapshot.path}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
    renameSync(temporary, snapshot.path)
  } finally { rmSync(temporary, { force: true }) }
  return count
}

let pending: Promise<number> | undefined
let lastAttempt = 0
let lastDir = ''

export function migrateLegacyModelThinking(): Promise<number> {
  const dir = resolveActiveAgentDir()
  if (pending) return pending
  if (workerManager.isRunning || (dir === lastDir && Date.now() - lastAttempt < 60_000)) return Promise.resolve(0)
  lastDir = dir
  lastAttempt = Date.now()
  pending = (async () => {
    const sdk = await getActiveSdkModule(app.getPath('userData'))
    return migrateThinkingConfig(dir, sdk, () => !workerManager.isRunning && resolveActiveAgentDir() === dir)
  })().catch(() => 0).finally(() => { pending = undefined })
  return pending
}

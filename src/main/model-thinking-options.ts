import { app } from 'electron'
import { getActiveSdkModule } from './ipc/sdk-session'
import { getThinkingModelWithSdk } from './active-sdk-models'
import { lookupThinkingRecord } from './models-dev-thinking'
import { workerManager } from './worker-manager'
import { resolveThinkingOptions, type ThinkingModel, type ModelThinkingOptions } from '@shared/model-thinking'

export async function getModelThinkingOptions(modelKey: string, sessionFile?: string): Promise<ModelThinkingOptions> {
  const separator = modelKey.indexOf('/')
  const unknown: ModelThinkingOptions = { model: modelKey, kind: 'unknown', options: [], source: 'unknown' }
  if (separator <= 0 || separator === modelKey.length - 1) return unknown
  const provider = modelKey.slice(0, separator)
  const id = modelKey.slice(separator + 1)
  const state = sessionFile ? await workerManager.getState(sessionFile).catch(() => null) : null
  let model: ThinkingModel | undefined
  let levels: string[] | undefined
  if (state?.model === modelKey && state.thinkingModel) {
    const live = state.thinkingModel as Omit<ThinkingModel, 'provider' | 'id'>
    model = { ...live, id, provider }
    if (Array.isArray(state.availableThinkingLevels)) levels = state.availableThinkingLevels as string[]
  } else {
    model = await getThinkingModelWithSdk(await getActiveSdkModule(app.getPath('userData')), provider, id).catch(() => undefined)
  }
  if (!model) return unknown
  const record = await lookupThinkingRecord(provider, id, model.baseUrl).catch(() => undefined)
  return resolveThinkingOptions(model, record, levels)
}

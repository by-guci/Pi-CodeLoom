import { loadModelsDevCatalog, lookupModelCapabilities } from './models-dev-lookup'
import { z } from 'zod'
import { thinkingMapFromOptions, type ReasoningOption } from '@shared/model-thinking'

export type ThinkingRecord = { reasoning?: boolean; reasoning_options?: ReasoningOption[] }
export type ProviderCatalog = Record<string, { api?: string; models?: Record<string, ThinkingRecord> }>
let cache: { at: number; value: ProviderCatalog } | undefined
let inflight: Promise<ProviderCatalog> | undefined

const thinkingRecordSchema = z.object({
  reasoning: z.boolean().optional(),
  reasoning_options: z.array(z.discriminatedUnion('type', [
    z.object({ type: z.literal('effort'), values: z.array(z.string()) }),
    z.object({ type: z.literal('toggle') }),
    z.object({ type: z.literal('budget_tokens'), min: z.number().optional(), max: z.number().optional() }),
  ])).optional(),
})

function validRecord(value: unknown): ThinkingRecord | undefined {
  const parsed = thinkingRecordSchema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

function origin(url?: string): string | undefined {
  try { return url ? new URL(url).origin : undefined } catch { return undefined }
}

export function matchProviderThinking(catalog: ProviderCatalog, provider: string, id: string, baseUrl?: string): ThinkingRecord | undefined {
  const direct = catalog[provider.toLowerCase()]
  if (direct) return validRecord(direct.models?.[id])
  const endpoint = origin(baseUrl)
  if (!endpoint) return undefined
  const matches = Object.values(catalog).filter((entry) => origin(entry.api) === endpoint && entry.models?.[id])
  return matches.length === 1 ? validRecord(matches[0].models?.[id]) : undefined
}

async function providerCatalog(): Promise<ProviderCatalog> {
  if (cache && Date.now() - cache.at < 24 * 60 * 60 * 1000) return cache.value
  if (inflight) return inflight
  inflight = (async () => {
    const response = await fetch('https://models.dev/api.json', { signal: AbortSignal.timeout(15_000), headers: { accept: 'application/json' } })
    if (!response.ok) throw new Error(`models.dev HTTP ${response.status}`)
    const value = await response.json() as ProviderCatalog
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid provider catalog')
    cache = { at: Date.now(), value }
    return value
  })().catch((error) => { if (cache) return cache.value; throw error }).finally(() => { inflight = undefined })
  return inflight
}

async function lookupExactThinkingRecord(catalog: ProviderCatalog, provider: string, id: string, baseUrl?: string): Promise<ThinkingRecord | undefined> {
  const direct = matchProviderThinking(catalog, provider, id, baseUrl)
  if (direct || catalog[provider.toLowerCase()]) return direct
  // Custom relay names may use an original provider/model ID. Never guess among relays.
  const parts = id.split('/')
  if (parts.length > 1) return validRecord(catalog[parts[0]]?.models?.[parts.slice(1).join('/')])
  const models = await loadModelsDevCatalog()
  const matches = Object.values(models).filter((entry) => entry.id?.split('/').at(-1) === id)
  if (matches.length !== 1 || !matches[0].id) return undefined
  const [lab, ...name] = matches[0].id.split('/')
  return validRecord(catalog[lab]?.models?.[name.join('/')])
}

function withoutDateSuffix(id: string): string | undefined {
  // Only dated snapshots: -MMDD, -YYYYMMDD or -YYYY-MM-DD. Preserve variant names.
  const match = id.match(/^(.+?)-(?:((?:19|20)\d{2})-?)?(\d{2})-?(\d{2})$/)
  if (!match) return undefined
  const [, base, year, month, day] = match
  const date = new Date(Date.UTC(Number(year || 2000), Number(month) - 1, Number(day)))
  return date.getUTCMonth() === Number(month) - 1 && date.getUTCDate() === Number(day) ? base : undefined
}

export async function lookupThinkingRecord(provider: string, id: string, baseUrl?: string): Promise<ThinkingRecord | undefined> {
  const catalog = await providerCatalog()
  const exact = await lookupExactThinkingRecord(catalog, provider, id, baseUrl)
  if (exact) return exact
  const base = withoutDateSuffix(id)
  return base ? lookupExactThinkingRecord(catalog, provider, base, baseUrl) : undefined
}

export async function lookupModelCapabilitiesWithThinking(ids: string[], provider = '', baseUrl?: string) {
  const result = await lookupModelCapabilities(ids)
  if (!result.ok || !result.models) return result
  const models = result.models
  await Promise.all(Object.keys(models).map(async (id) => {
    const record = await lookupThinkingRecord(provider, id, baseUrl).catch(() => undefined)
    if (record?.reasoning === false) { models[id].reasoning = false; return }
    const map = thinkingMapFromOptions(record?.reasoning_options)
    if (map) { models[id].reasoning = true; models[id].thinkingLevelMap = map }
  }))
  return result
}

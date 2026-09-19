import { loadModelsDevCatalog } from './models-dev-lookup'
import { z } from 'zod'
import type { ReasoningOption } from '@shared/model-thinking'

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

export async function lookupThinkingRecord(provider: string, id: string, baseUrl?: string): Promise<ThinkingRecord | undefined> {
  const catalog = await providerCatalog()
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

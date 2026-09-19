import { errorMessage } from '@shared/error-message'
import type { PiModelsModelConfig } from '@shared/ipc-contract'

const MODELS_DEV_URL = 'https://models.dev/models.json'
const TTL_MS = 24 * 60 * 60 * 1000
const FETCH_MS = 15_000

export type ModelsDevEntry = {
  id?: string
  name?: string
  reasoning?: boolean
  attachment?: boolean
  last_updated?: string
  modalities?: { input?: string[] }
  limit?: { context?: number; output?: number }
}

export type ModelCapabilitySpec = Pick<
  PiModelsModelConfig,
  'name' | 'reasoning' | 'input' | 'contextWindow' | 'maxTokens'
>

type Catalog = Record<string, ModelsDevEntry>

let cache: { at: number; catalog: Catalog } | null = null
let inflight: Promise<Catalog> | null = null

function normalizeId(raw: string): string {
  return raw.trim().toLowerCase().replace(/_/g, '-')
}

function lastSegment(id: string): string {
  const n = normalizeId(id)
  const i = n.lastIndexOf('/')
  return i >= 0 ? n.slice(i + 1) : n
}

function finiteTokens(n: unknown): number | undefined {
  const v = typeof n === 'number' ? n : Number(n)
  if (!Number.isFinite(v) || v <= 0) return undefined
  return Math.floor(v)
}

export function specFromModelsDev(entry: ModelsDevEntry): ModelCapabilitySpec {
  const inputs = Array.isArray(entry.modalities?.input) ? entry.modalities.input : []
  const hasImage = inputs.includes('image')
  const spec: ModelCapabilitySpec = {
    input: hasImage ? ['text', 'image'] : ['text'],
  }
  if (entry.name?.trim()) spec.name = entry.name.trim()
  if (entry.reasoning) spec.reasoning = true
  const contextWindow = finiteTokens(entry.limit?.context)
  if (contextWindow) spec.contextWindow = contextWindow
  const maxTokens = finiteTokens(entry.limit?.output)
  if (maxTokens) spec.maxTokens = maxTokens
  return spec
}

export function matchModelsDev(catalog: Catalog, query: string): ModelsDevEntry | undefined {
  const q = normalizeId(query)
  if (!q) return undefined
  const keyed = catalog[q] || catalog[query.trim()]
  if (keyed) return keyed

  const entries = Object.values(catalog)
  const exactId = entries.find((e) => normalizeId(String(e.id || '')) === q)
  if (exactId) return exactId

  const suffix = `/${q}`
  const bySuffix = entries.filter((e) => {
    const id = normalizeId(String(e.id || ''))
    return id === q || id.endsWith(suffix)
  })
  if (bySuffix.length === 1) return bySuffix[0]

  const last = lastSegment(q)
  const byLast = (bySuffix.length ? bySuffix : entries).filter((e) => lastSegment(String(e.id || '')) === last)
  if (!byLast.length) return undefined
  return byLast.sort((a, b) => String(b.last_updated || '').localeCompare(String(a.last_updated || '')))[0]
}

export function lookupModelSpecs(catalog: Catalog, ids: string[]): Record<string, ModelCapabilitySpec> {
  const out: Record<string, ModelCapabilitySpec> = {}
  for (const id of ids) {
    const hit = matchModelsDev(catalog, id)
    if (!hit) continue
    out[id] = specFromModelsDev(hit)
  }
  return out
}

export function applyCapabilitySpec(
  entry: PiModelsModelConfig,
  spec: ModelCapabilitySpec,
): PiModelsModelConfig {
  const next: PiModelsModelConfig = {
    ...entry,
    input: spec.input?.length ? spec.input : entry.input,
    reasoning: spec.reasoning || undefined,
    contextWindow: spec.contextWindow ?? entry.contextWindow,
    maxTokens: spec.maxTokens ?? entry.maxTokens,
  }
  if (spec.name && (!entry.name || entry.name === entry.id)) next.name = spec.name
  if (spec.reasoning && !entry.thinkingLevelMap) next.thinkingLevelMap = { high: 'high' }
  if (!spec.reasoning) next.thinkingLevelMap = undefined
  return next
}

async function fetchCatalog(): Promise<Catalog> {
  const res = await fetch(MODELS_DEV_URL, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_MS),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = (await res.json()) as unknown
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('invalid models.dev catalog')
  return data as Catalog
}

export async function loadModelsDevCatalog(opts?: { refresh?: boolean }): Promise<Catalog> {
  const now = Date.now()
  if (!opts?.refresh && cache && now - cache.at < TTL_MS) return cache.catalog
  if (inflight) return inflight
  inflight = fetchCatalog()
    .then((catalog) => {
      cache = { at: Date.now(), catalog }
      return catalog
    })
    .finally(() => {
      inflight = null
    })
  try {
    return await inflight
  } catch (error) {
    if (cache) return cache.catalog
    throw error
  }
}

export async function lookupModelCapabilities(ids: string[]): Promise<{
  ok: boolean
  models?: Record<string, ModelCapabilitySpec>
  error?: string
}> {
  const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))].slice(0, 50)
  if (!unique.length) return { ok: false, error: 'missing model id' }
  try {
    const catalog = await loadModelsDevCatalog()
    return { ok: true, models: lookupModelSpecs(catalog, unique) }
  } catch (error) {
    return { ok: false, error: errorMessage(error) }
  }
}

export function resetModelsDevLookupCache(): void {
  cache = null
  inflight = null
}

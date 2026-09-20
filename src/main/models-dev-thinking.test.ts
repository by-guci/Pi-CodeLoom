import { afterEach, describe, expect, it, vi } from 'vitest'
import { matchProviderThinking } from './models-dev-thinking'

const native = { reasoning: true, reasoning_options: [{ type: 'effort' as const, values: ['low', 'high', 'xhigh'] }] }
const relay = { reasoning: true, reasoning_options: [{ type: 'effort' as const, values: ['low', 'high'] }] }
const catalog = {
  xai: { api: 'https://api.x.ai/v1', models: { 'grok-4.6': native } },
  relay: { api: 'https://relay.example/v1', models: { 'grok-4.6': relay } },
}

afterEach(() => vi.unstubAllGlobals())

describe('provider-specific reasoning metadata', () => {
  it('uses the selected provider instead of borrowing levels from another provider', () => {
    expect(matchProviderThinking(catalog, 'relay', 'grok-4.6')).toEqual(relay)
    expect(matchProviderThinking(catalog, 'xai', 'grok-4.6')).toEqual(native)
    expect(matchProviderThinking(catalog, 'relay', 'missing')).toBeUndefined()
  })
  it('recognizes an exact provider origin under a custom provider label', () => {
    expect(matchProviderThinking(catalog, 'my-xai', 'grok-4.6', 'https://api.x.ai/v1/')).toEqual(native)
    expect(matchProviderThinking(catalog, 'my-relay', 'grok-4.6', 'https://unlisted.example')).toBeUndefined()
  })
  it('does not guess across ambiguous endpoints or different model ids', () => {
    expect(matchProviderThinking({ ...catalog, duplicate: catalog.xai }, 'custom', 'grok-4.6', 'https://api.x.ai')).toBeUndefined()
    expect(matchProviderThinking(catalog, 'custom', 'grok-4.6-extra', 'https://api.x.ai')).toBeUndefined()
  })
  it('ignores malformed capability records', () => {
    expect(matchProviderThinking({ xai: { models: { broken: { reasoning_options: [{ type: 'effort', values: null }] } } } } as never, 'xai', 'broken')).toBeUndefined()
  })
})

describe('complete capability lookup for model import', () => {
  const luna = { reasoning: true, reasoning_options: [{ type: 'effort', values: ['none', 'low', 'medium', 'high', 'xhigh', 'max'] }] }
  const flat = { 'openai/gpt-5.6-luna': { id: 'openai/gpt-5.6-luna', reasoning: true, limit: { context: 400000, output: 32000 } } }

  it('uses the original model for an unlisted custom provider and carries the full mapping to settings', async () => {
    vi.resetModules()
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, json: async () => url.endsWith('/api.json') ? { openai: { models: { 'gpt-5.6-luna': luna } } } : flat })))
    const { lookupModelCapabilitiesWithThinking } = await import('./models-dev-thinking')
    const result = await lookupModelCapabilitiesWithThinking(['gpt-5.6-luna'], '自建', 'https://custom.example/v1')
    expect(result.models?.['gpt-5.6-luna']).toMatchObject({ contextWindow: 400000, thinkingLevelMap: { off: 'none', minimal: null, xhigh: 'xhigh', max: 'max' } })
  })

  it('respects a relay-specific restriction instead of copying the original provider map', async () => {
    vi.resetModules()
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, json: async () => url.endsWith('/api.json') ? {
      openai: { models: { 'gpt-5.6-luna': luna } }, relay: { models: { 'gpt-5.6-luna': { reasoning: true, reasoning_options: [{ type: 'effort', values: ['low', 'high'] }] } } },
    } : flat })))
    const { lookupModelCapabilitiesWithThinking } = await import('./models-dev-thinking')
    const result = await lookupModelCapabilitiesWithThinking(['gpt-5.6-luna'], 'relay')
    expect(result.models?.['gpt-5.6-luna'].thinkingLevelMap).toMatchObject({ off: null, medium: null, low: 'low', high: 'high', xhigh: null, max: null })
  })

  it('keeps context metadata available when the reasoning catalog cannot be fetched', async () => {
    vi.resetModules()
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/api.json')) throw new Error('offline')
      return { ok: true, json: async () => flat }
    }))
    const { lookupModelCapabilitiesWithThinking } = await import('./models-dev-thinking')
    const result = await lookupModelCapabilitiesWithThinking(['gpt-5.6-luna'], '自建')
    expect(result).toMatchObject({ ok: true, models: { 'gpt-5.6-luna': { contextWindow: 400000 } } })
    expect(result.models?.['gpt-5.6-luna'].thinkingLevelMap).toBeUndefined()
  })
})

describe('dated model thinking fallback', () => {
  const base = { reasoning: true, reasoning_options: [{ type: 'toggle' }, { type: 'effort', values: ['high', 'max'] }] }
  const dated = { reasoning: true, reasoning_options: [{ type: 'effort', values: ['high'] }] }

  async function lookup(providers: unknown, flat = {
    'deepseek/deepseek-v4-pro-0813': { id: 'deepseek/deepseek-v4-pro-0813', reasoning: true },
    'deepseek/deepseek-v4-pro': { id: 'deepseek/deepseek-v4-pro', reasoning: true },
  }) {
    vi.resetModules()
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, json: async () => url.endsWith('/api.json') ? providers : flat })))
    return import('./models-dev-thinking')
  }

  it.each(['deepseek-v4-pro-0813', 'deepseek-v4-pro-20260813', 'deepseek-v4-pro-2026-08-13', 'deepseek/deepseek-v4-pro-0813'])(
    'resolves %s to original provider base capabilities when exact metadata is absent', async (id) => {
      const api = await lookup({ deepseek: { models: { 'deepseek-v4-pro': base } } })
      expect(await api.lookupThinkingRecord('中转', id)).toEqual(base)
    },
  )

  it('preserves an exact dated provider record including explicitly fixed reasoning', async () => {
    const api = await lookup({ relay: { models: { 'deepseek-v4-pro-0813': { reasoning_options: [] }, 'deepseek-v4-pro': base } } })
    expect(await api.lookupThinkingRecord('relay', 'deepseek-v4-pro-0813')).toEqual({ reasoning_options: [] })
  })

  it('prefers the exact original model over a relay base fallback', async () => {
    const api = await lookup({ deepseek: { models: { 'deepseek-v4-pro-0813': dated, 'deepseek-v4-pro': base } } })
    expect(await api.lookupThinkingRecord('中转', 'deepseek-v4-pro-0813')).toEqual(dated)
  })

  it('keeps base fallback within a known provider instead of borrowing another provider', async () => {
    const api = await lookup({ relay: { models: { 'deepseek-v4-pro': dated } }, deepseek: { models: { 'deepseek-v4-pro': base } } })
    expect(await api.lookupThinkingRecord('relay', 'deepseek-v4-pro-0813')).toEqual(dated)
    expect(await api.lookupThinkingRecord('relay', 'unknown-0813')).toBeUndefined()
  })

  it.each(['deepseek-v4-pro-fast', 'deepseek-v4-pro-1234', 'deepseek-v4-pro-0813-thinking', 'deepseek-v4-pro-2026-99-99'])(
    'does not strip a variant or invalid date: %s', async (id) => {
      const api = await lookup({ deepseek: { models: { 'deepseek-v4-pro': base } } })
      expect(await api.lookupThinkingRecord('中转', id)).toBeUndefined()
    },
  )

  it('fills thinking mappings under the original dated ID without renaming the requested model', async () => {
    const api = await lookup({ deepseek: { models: { 'deepseek-v4-pro': base } } })
    const result = await api.lookupModelCapabilitiesWithThinking(['deepseek-v4-pro-0813'], '中转')
    expect(Object.keys(result.models!)).toEqual(['deepseek-v4-pro-0813'])
    expect(result.models?.['deepseek-v4-pro-0813'].thinkingLevelMap).toMatchObject({ minimal: null, low: null, medium: null, high: 'high', max: 'max' })
  })
})

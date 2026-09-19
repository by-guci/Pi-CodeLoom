import { describe, expect, it } from 'vitest'
import { matchProviderThinking } from './models-dev-thinking'

const native = { reasoning: true, reasoning_options: [{ type: 'effort' as const, values: ['low', 'high', 'xhigh'] }] }
const relay = { reasoning: true, reasoning_options: [{ type: 'effort' as const, values: ['low', 'high'] }] }
const catalog = {
  xai: { api: 'https://api.x.ai/v1', models: { 'grok-4.6': native } },
  relay: { api: 'https://relay.example/v1', models: { 'grok-4.6': relay } },
}

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

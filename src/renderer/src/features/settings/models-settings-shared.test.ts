import { describe, expect, it } from 'vitest'
import { applyLookupSpec } from './models-settings-shared'

const spec = { reasoning: true, thinkingLevelMap: { off: 'none', minimal: null, low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' } }

describe('model capability import thinking levels', () => {
  it.each([undefined, { high: 'high' }])('fills missing Luna mappings including legacy HIGH-only imports', (thinkingLevelMap) => {
    const result = applyLookupSpec({ id: 'gpt-5.6-luna', thinkingLevelMap }, spec)
    expect(result.thinkingLevelMap).toEqual(spec.thinkingLevelMap)
  })

  it('preserves explicit user mappings and disabled levels', () => {
    const result = applyLookupSpec({ id: 'gpt-5.6-luna', thinkingLevelMap: { high: 'medium', xhigh: null } }, spec)
    expect(result.thinkingLevelMap).toEqual({ ...spec.thinkingLevelMap, high: 'medium', xhigh: null })
  })
})

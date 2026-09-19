import { describe, expect, it } from 'vitest'
import { resolveThinkingOptions, runtimeThinkingLevels, type ThinkingModel } from './model-thinking'

const grok: ThinkingModel = { provider: 'xai', id: 'grok-4.6', reasoning: true, thinkingLevelMap: { xhigh: 'xhigh', max: 'max' } }
const levels = (result: ReturnType<typeof resolveThinkingOptions>) => result.options.map((option) => option.level)

describe('model-specific thinking choices', () => {
  it('only shows the documented Grok levels', () => {
    expect(levels(resolveThinkingOptions(grok, { reasoning: true, reasoning_options: [{ type: 'effort', values: ['low', 'medium', 'high', 'xhigh'] }] }))).toEqual(['low', 'medium', 'high', 'xhigh'])
  })
  it('maps none to off and respects SDK restrictions', () => {
    const result = resolveThinkingOptions(grok, { reasoning_options: [{ type: 'effort', values: ['none', 'low', 'high', 'xhigh'] }] }, ['off', 'low', 'high'])
    expect(levels(result)).toEqual(['off', 'low', 'high'])
    expect(result.limitedByRuntime).toBe(true)
  })
  it('keeps GLM high/max choices distinct', () => {
    expect(levels(resolveThinkingOptions({ ...grok, id: 'glm-5.3' }, { reasoning_options: [{ type: 'effort', values: ['low', 'high', 'max'] }] }))).toEqual(['low', 'high', 'max'])
  })
  it('shows only off for a non-reasoning model', () => {
    expect(levels(resolveThinkingOptions({ ...grok, reasoning: false }))).toEqual(['off'])
  })
  it('offers a single enabled choice for toggle-only models', () => {
    const result = resolveThinkingOptions(grok, { reasoning_options: [{ type: 'toggle' }] })
    expect(result.options).toEqual([{ level: 'off' }, { level: 'high', enabled: true }])
  })
  it('marks budget-based controls as SDK presets and does not invent a toggle', () => {
    const result = resolveThinkingOptions(grok, { reasoning_options: [{ type: 'budget_tokens', min: 128, max: 32768 }] }, ['off', 'low', 'medium', 'high'])
    expect(result.kind).toBe('budget')
    expect(levels(result)).toEqual(['low', 'medium', 'high'])
  })
  it('distinguishes fixed reasoning from missing capability data', () => {
    expect(resolveThinkingOptions(grok, { reasoning_options: [] })).toMatchObject({ kind: 'fixed', options: [] })
    expect(resolveThinkingOptions({ provider: 'custom', id: 'unknown' })).toMatchObject({ kind: 'unknown', options: [] })
    expect(runtimeThinkingLevels({ ...grok, thinkingLevelMap: { off: null, minimal: null, xhigh: null, max: 'high' } })).toEqual(['low', 'medium', 'high', 'max'])
  })
  it('preserves an explicit toggle alongside effort or budget controls', () => {
    expect(levels(resolveThinkingOptions(grok, { reasoning_options: [{ type: 'effort', values: ['high', 'max'] }, { type: 'toggle' }] }))).toEqual(['off', 'high', 'max'])
    const result = resolveThinkingOptions(grok, { reasoning_options: [{ type: 'toggle' }, { type: 'budget_tokens', min: 128 }] }, ['off', 'low', 'high'])
    expect(result.kind).toBe('budget')
    expect(levels(result)).toEqual(['off', 'low', 'high'])
  })
})

import { describe, expect, it, vi } from 'vitest'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { thinkingMapFromOptions } from '@shared/model-thinking'

describe('Pi SDK request effort for imported custom models', () => {
  it.each(['xhigh', 'max'])('sends %s without silently downgrading it to high', async (level) => {
    const { streamSimple } = await import(pathToFileURL(resolve('node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js')).href)
    const request = vi.fn(async () => { throw new Error('fixture: network disabled') })
    const payload = vi.fn()
    const result = await streamSimple({
      id: 'gpt-5.6-luna', name: 'Luna', provider: '自建', api: 'openai-completions', baseUrl: 'https://unused.invalid/v1',
      reasoning: true, input: ['text'], contextWindow: 400000, maxTokens: 32000,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      thinkingLevelMap: thinkingMapFromOptions([{ type: 'effort', values: ['none', 'low', 'medium', 'high', 'xhigh', 'max'] }]),
    }, { messages: [{ role: 'user', content: 'fixture', timestamp: 0 }] }, {
      reasoning: level, apiKey: 'fixture-key', fetch: request, onPayload: payload, maxRetries: 0,
    }).result()
    expect(payload.mock.calls[0][0].reasoning_effort).toBe(level)
    expect(request).toHaveBeenCalledOnce()
    expect(result.stopReason).toBe('error')
  })
})

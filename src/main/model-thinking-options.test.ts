import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getModelThinkingOptions } from './model-thinking-options'
vi.mock('./model-thinking-migration', () => ({ migrateLegacyModelThinking: vi.fn().mockResolvedValue(0) }))

const mocks = vi.hoisted(() => ({ state: vi.fn(), sdk: vi.fn(), model: vi.fn(), record: vi.fn() }))
vi.mock('electron', () => ({ app: { getPath: () => '/profile' } }))
vi.mock('./worker-manager', () => ({ workerManager: { getState: mocks.state } }))
vi.mock('./ipc/sdk-session', () => ({ getActiveSdkModule: mocks.sdk }))
vi.mock('./active-sdk-models', () => ({ getThinkingModelWithSdk: mocks.model }))
vi.mock('./models-dev-thinking', () => ({ lookupThinkingRecord: mocks.record }))

beforeEach(() => {
  vi.resetAllMocks()
  mocks.state.mockResolvedValue({ bound: false })
  mocks.sdk.mockResolvedValue({})
  mocks.model.mockResolvedValue({ provider: 'relay', id: 'grok-4.6', reasoning: true, baseUrl: 'https://relay.example/v1' })
  mocks.record.mockResolvedValue({ reasoning_options: [{ type: 'effort', values: ['low', 'medium', 'high', 'xhigh'] }] })
})

describe('thinking options from the selected model and runtime', () => {
  it('intersects provider metadata with the exact live session capabilities', async () => {
    mocks.state.mockResolvedValue({ model: 'relay/grok-4.6', thinkingModel: { reasoning: true, baseUrl: 'https://relay.example/v1' }, availableThinkingLevels: ['off', 'high', 'xhigh'] })
    const result = await getModelThinkingOptions('relay/grok-4.6', '/session')
    expect(result.options).toEqual([{ level: 'high' }, { level: 'xhigh' }])
    expect(mocks.record).toHaveBeenCalledWith('relay', 'grok-4.6', 'https://relay.example/v1')
    expect(mocks.sdk).not.toHaveBeenCalled()
  })

  it('uses active SDK configuration before a session starts and ignores another live model', async () => {
    mocks.state.mockResolvedValue({ model: 'other/model', thinkingModel: { reasoning: false }, availableThinkingLevels: ['off'] })
    const result = await getModelThinkingOptions('relay/grok-4.6', '/session')
    expect(result.options.map((option) => option.level)).toEqual(['low', 'medium', 'high'])
    expect(result.limitedByRuntime).toBe(true)
    expect(mocks.model).toHaveBeenCalledWith({}, 'relay', 'grok-4.6')
  })

  it('uses the runtime with a distinct source when the catalog is offline', async () => {
    mocks.record.mockRejectedValue(new Error('offline'))
    expect(await getModelThinkingOptions('relay/grok-4.6')).toMatchObject({ source: 'runtime', options: [{ level: 'off' }, { level: 'minimal' }, { level: 'low' }, { level: 'medium' }, { level: 'high' }] })
  })

  it('does not fabricate choices for a missing model or malformed model key', async () => {
    mocks.model.mockResolvedValue(undefined)
    for (const key of ['relay/missing', 'missing-provider', 'relay/']) {
      expect(await getModelThinkingOptions(key)).toMatchObject({ kind: 'unknown', options: [] })
    }
  })
})

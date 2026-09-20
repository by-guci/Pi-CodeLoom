import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ lookup: vi.fn(), validate: vi.fn() }))
vi.mock('electron', () => ({ app: { getPath: () => '/profile' } }))
vi.mock('./config-store', () => ({ configStore: { get: () => undefined } }))
vi.mock('./worker-manager', () => ({ workerManager: { isRunning: false } }))
vi.mock('./ipc/sdk-session', () => ({ getActiveSdkModule: vi.fn() }))
vi.mock('./models-dev-thinking', () => ({ lookupThinkingRecord: mocks.lookup }))
vi.mock('./active-sdk-models', () => ({ validateModelsConfigWithSdk: mocks.validate }))
import { migrateThinkingConfig } from './model-thinking-migration'

let dir: string
let path: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'thinking-migration-'))
  path = join(dir, 'models.json')
  mocks.validate.mockReset().mockResolvedValue(undefined)
  mocks.lookup.mockReset().mockResolvedValue({ reasoning: true, reasoning_options: [{ type: 'effort', values: ['low', 'high', 'max'] }] })
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('legacy thinking configuration migration', () => {
  const config = { extra: { retained: true }, providers: { relay: { apiKey: 'fixture-secret', models: [
    { id: 'old', reasoning: true }, { id: 'custom', thinkingLevelMap: { high: 'medium', max: null } },
    { id: 'plain', reasoning: false },
  ] } } }
  it('migrates all legacy models, preserves explicit choices and unrelated fields, and is idempotent', async () => {
    writeFileSync(path, JSON.stringify(config))
    expect(await migrateThinkingConfig(dir, {})).toBe(2)
    const result = JSON.parse(readFileSync(path, 'utf8'))
    expect(result.extra).toEqual(config.extra)
    expect(result.providers.relay.apiKey).toBe('fixture-secret')
    expect(result.providers.relay.models[0].thinkingLevelMap).toMatchObject({ low: 'low', high: 'high', max: 'max' })
    expect(result.providers.relay.models[1].thinkingLevelMap).toMatchObject({ high: 'medium', max: null })
    expect(result.providers.relay.models[2]).toEqual(config.providers.relay.models[2])
    const saved = readFileSync(path, 'utf8')
    expect(await migrateThinkingConfig(dir, {})).toBe(0)
    expect(readFileSync(path, 'utf8')).toBe(saved)
  })
  it('leaves files intact offline and retries successfully later', async () => {
    const raw = JSON.stringify(config)
    writeFileSync(path, raw)
    mocks.lookup.mockRejectedValue(new Error('offline'))
    expect(await migrateThinkingConfig(dir, {})).toBe(0)
    expect(readFileSync(path, 'utf8')).toBe(raw)
    mocks.lookup.mockResolvedValue({ reasoning_options: [{ type: 'effort', values: ['high', 'max'] }] })
    expect(await migrateThinkingConfig(dir, {})).toBe(2)
  })
  it('does not overwrite concurrent edits or write while a worker starts', async () => {
    writeFileSync(path, JSON.stringify(config))
    mocks.validate.mockImplementation(async () => { writeFileSync(path, '{"providers":{}}') })
    expect(await migrateThinkingConfig(dir, {})).toBe(0)
    expect(readFileSync(path, 'utf8')).toBe('{"providers":{}}')
    writeFileSync(path, JSON.stringify(config))
    expect(await migrateThinkingConfig(dir, {}, () => false)).toBe(0)
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(config)
  })
  it('preserves invalid JSON and rejects mappings that fail SDK validation', async () => {
    writeFileSync(path, '{broken')
    expect(await migrateThinkingConfig(dir, {})).toBe(0)
    expect(readFileSync(path, 'utf8')).toBe('{broken')
    writeFileSync(path, JSON.stringify(config))
    mocks.validate.mockResolvedValue('invalid mapping')
    expect(await migrateThinkingConfig(dir, {})).toBe(0)
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(config)
  })
})

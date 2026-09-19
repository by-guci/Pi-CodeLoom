import { describe, expect, it } from 'vitest'
import {
  applyCapabilitySpec,
  lookupModelSpecs,
  matchModelsDev,
  specFromModelsDev,
  type ModelsDevEntry,
} from './models-dev-lookup'

const glm: ModelsDevEntry = {
  id: 'zhipuai/glm-5.3',
  name: 'GLM-5.3',
  reasoning: true,
  last_updated: '2026-08-14',
  modalities: { input: ['text'] },
  limit: { context: 1_000_000, output: 131_072 },
}

const glmFlash: ModelsDevEntry = {
  id: 'zhipuai/glm-5.3-flash',
  name: 'GLM-5.3-Flash',
  reasoning: true,
  last_updated: '2026-08-26',
  modalities: { input: ['text', 'image', 'video', 'pdf'] },
  limit: { context: 1_000_000, output: 131_072 },
}

const catalog = {
  'zhipuai/glm-5.3': glm,
  'zhipuai/glm-5.3-flash': glmFlash,
}

describe('models.dev lookup', () => {
  it('maps glm-5.3 capabilities onto the models.json fields', () => {
    expect(specFromModelsDev(glm)).toEqual({
      name: 'GLM-5.3',
      reasoning: true,
      input: ['text'],
      contextWindow: 1_000_000,
      maxTokens: 131_072,
    })
  })

  it('treats image in modalities as multimodal input', () => {
    expect(specFromModelsDev(glmFlash).input).toEqual(['text', 'image'])
  })

  it('matches a provider-less id to the latest same-name model', () => {
    expect(matchModelsDev(catalog, 'glm-5.3')?.id).toBe('zhipuai/glm-5.3')
    expect(matchModelsDev(catalog, 'GLM_5.3')?.id).toBe('zhipuai/glm-5.3')
  })

  it('fills an empty model entry from the catalog', () => {
    const specs = lookupModelSpecs(catalog, ['glm-5.3'])
    expect(applyCapabilitySpec({ id: 'glm-5.3', name: 'glm-5.3' }, specs['glm-5.3'])).toMatchObject({
      id: 'glm-5.3',
      name: 'GLM-5.3',
      reasoning: true,
      input: ['text'],
      contextWindow: 1_000_000,
      maxTokens: 131_072,
      thinkingLevelMap: { high: 'high' },
    })
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type DiskSkillRow = {
  name: string
  description: string
  path: string
  source: string
  fileKind: string
}

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (request: Record<string, unknown>) => Promise<unknown>>(),
  getSystemPrompt: vi.fn(),
  getContextPrompts: vi.fn(),
  getPromptTemplatesList: vi.fn(),
  reloadResources: vi.fn(),
  getSkillsList: vi.fn(),
  applySkillOverrides: vi.fn(),
  writeSkillDescription: vi.fn(),
  transferSkill: vi.fn(),
  applyDiskSkillChanges: vi.fn(() => 1),
  start: vi.fn(),
  listSkillsOnDisk: vi.fn<() => DiskSkillRow[]>(() => []),
  listAgentsContextFiles: vi.fn(() => []),
  listPiBuiltinPromptFiles: vi.fn(() => []),
  listPluginInjectedPromptFiles: vi.fn(() => []),
  listPromptsOnDisk: vi.fn(() => []),
  workerManager: {
    isRunning: false,
    cwd: '',
  },
  currentProject: 'C:/repo' as string | null,
}))

vi.mock('../registry', () => ({
  registerHandler: (channel: string, handler: (request: Record<string, unknown>) => Promise<unknown>) => {
    mocks.handlers.set(channel, handler)
  },
}))
vi.mock('../../worker-manager', () => ({
  workerManager: Object.assign(mocks.workerManager, {
    getContextPrompts: mocks.getContextPrompts,
    getPromptTemplatesList: mocks.getPromptTemplatesList,
    reloadResources: mocks.reloadResources,
    getSkillsList: mocks.getSkillsList,
    applySkillOverrides: mocks.applySkillOverrides,
    writeSkillDescription: mocks.writeSkillDescription,
    transferSkill: mocks.transferSkill,
    start: mocks.start,
  }),
}))
vi.mock('../../config-store', () => ({
  configStore: {
    get: vi.fn((key: string) => {
      if (key === 'currentProject') return mocks.currentProject
      if (key === 'skillPresentation') return {}
      return undefined
    }),
    getSkillOverrides: vi.fn(() => ({})),
    set: vi.fn(),
  },
}))
vi.mock('../../session-preview-process', () => ({
  sessionPreviewProcess: { getSystemPrompt: mocks.getSystemPrompt },
}))
vi.mock('../../pi-agent-settings-read', () => ({
  readPiAgentGlobalSettingsFromDisk: vi.fn(() => ({ defaultProvider: 'openai' })),
  readPiProjectSettingsFromDisk: vi.fn(() => ({ skills: ['.pi/skills/project-skill'] })),
}))
vi.mock('../../pi-resources-editor', () => ({
  listSkillsOnDisk: mocks.listSkillsOnDisk,
  listPromptsOnDisk: mocks.listPromptsOnDisk,
  readTextFileSafe: vi.fn(),
  writeTextFileSafe: vi.fn(),
  skillStorageKey: vi.fn(() => 'skill'),
}))
vi.mock('../../pi-skill-overrides', () => ({
  getDesktopSkillOverrides: vi.fn(() => ({})),
  isSkillEnabled: vi.fn(() => true),
  setSkillEnabledInGlobal: vi.fn(() => ({})),
  applySkillOverridesBatch: vi.fn(),
  applyDiskSkillChanges: mocks.applyDiskSkillChanges,
  migrateElectronSkillOverrides: vi.fn(),
}))
vi.mock('../../pi-prompt-catalog', () => ({
  listAgentsContextFiles: mocks.listAgentsContextFiles,
  listPiBuiltinPromptFiles: mocks.listPiBuiltinPromptFiles,
  listPluginInjectedPromptFiles: mocks.listPluginInjectedPromptFiles,
  groupPromptCatalog: vi.fn(() => ({})),
  getGlobalSystemMd: vi.fn(() => 'C:/agent/SYSTEM.md'),
}))
vi.mock('../../resource-revisions', () => ({
  listRevisions: vi.fn(() => []),
  pushRevision: vi.fn(),
  restoreRevision: vi.fn(),
  readRevision: vi.fn(),
}))

import { registerSkillsResourceHandlers } from './skills-resources'

describe('system prompt resource preview', () => {
  beforeEach(() => {
    mocks.handlers.clear()
    mocks.getSystemPrompt.mockReset().mockResolvedValue('assembled prompt')
    mocks.getContextPrompts.mockReset()
    mocks.getPromptTemplatesList.mockReset().mockResolvedValue([])
    mocks.reloadResources.mockReset().mockResolvedValue(undefined)
    mocks.getSkillsList.mockReset()
    mocks.applySkillOverrides.mockReset()
    mocks.writeSkillDescription.mockReset()
    mocks.transferSkill.mockReset()
    mocks.applyDiskSkillChanges.mockReset().mockReturnValue(1)
    mocks.start.mockReset()
    mocks.listAgentsContextFiles.mockClear()
    mocks.listPiBuiltinPromptFiles.mockClear()
    mocks.listPluginInjectedPromptFiles.mockClear()
    mocks.listPromptsOnDisk.mockClear()
    mocks.workerManager.isRunning = false
    mocks.workerManager.cwd = ''
    mocks.currentProject = 'C:/repo'
    mocks.listSkillsOnDisk.mockClear().mockReturnValue([])
    registerSkillsResourceHandlers()
  })

  it('uses the isolated preview process while the session worker is idle', async () => {
    const handler = mocks.handlers.get('ipc:resource.read')
    await expect(handler?.({ path: 'pi-desktop://system-prompt-preview' })).resolves.toEqual({
      content: 'assembled prompt',
      path: 'pi-desktop://system-prompt-preview',
      revisions: [],
    })

    expect(mocks.getSystemPrompt).toHaveBeenCalledWith({
      cwd: 'C:/repo',
      globalSettings: { defaultProvider: 'openai' },
      projectSettings: { skills: ['.pi/skills/project-skill'] },
    })
    expect(mocks.start).not.toHaveBeenCalled()
    expect(mocks.getContextPrompts).not.toHaveBeenCalled()
  })

  it('does not reuse a live worker from another project', async () => {
    mocks.workerManager.isRunning = true
    mocks.workerManager.cwd = 'C:/project-a'
    const handler = mocks.handlers.get('ipc:resource.read')

    await expect(handler?.({ path: 'pi-desktop://system-prompt-preview' })).resolves.toEqual({
      content: 'assembled prompt',
      path: 'pi-desktop://system-prompt-preview',
      revisions: [],
    })

    expect(mocks.getSystemPrompt).toHaveBeenCalledWith(expect.objectContaining({ cwd: 'C:/repo' }))
    expect(mocks.getContextPrompts).not.toHaveBeenCalled()
  })

  it('does not build the prompt catalog from another project worker', async () => {
    mocks.workerManager.isRunning = true
    mocks.workerManager.cwd = 'C:/project-a'
    const handler = mocks.handlers.get('ipc:prompts.list')

    await handler?.({})

    expect(mocks.listAgentsContextFiles).toHaveBeenCalledWith('C:/repo')
    expect(mocks.listPiBuiltinPromptFiles).toHaveBeenCalledWith('C:/repo', true)
    expect(mocks.listPluginInjectedPromptFiles).toHaveBeenCalledWith('C:/repo')
    expect(mocks.listPromptsOnDisk).toHaveBeenCalledWith('C:/repo')
    expect(mocks.getContextPrompts).not.toHaveBeenCalled()
    expect(mocks.getPromptTemplatesList).not.toHaveBeenCalled()
  })

  it('lazily starts the current project worker before listing skills', async () => {
    mocks.start.mockImplementation(async (cwd: string) => {
      mocks.workerManager.isRunning = true
      mocks.workerManager.cwd = cwd
      return { sessionId: 'sid' }
    })
    mocks.getSkillsList.mockResolvedValue({
      complete: true,
      projectTrusted: true,
      effectiveSkills: [],
      candidates: [{
        key: 'host|C:/repo/.pi/skills/review/SKILL.md|local',
        runtimeId: 'host',
        name: 'review',
        description: 'Review code',
        filePath: 'C:/repo/.pi/skills/review/SKILL.md',
        source: 'local',
        scope: 'project',
        origin: 'top-level',
        enabled: true,
        effective: true,
        shadowed: false,
        command: '/skill:review',
        editable: true,
        movable: true,
        canCopyToUser: true,
        canCopyToProject: false,
      }],
    })
    const handler = mocks.handlers.get('ipc:skills.list')

    const result = await handler?.({}) as { skills?: Array<{ name?: string }> }

    expect(mocks.start).toHaveBeenCalledWith('C:/repo')
    expect(mocks.getSkillsList).toHaveBeenCalled()
    expect(result.skills?.[0]?.name).toBe('review')
  })

  it('lists global user skills from disk even when no project is open', async () => {
    mocks.currentProject = null
    mocks.listSkillsOnDisk.mockReturnValue([{
      name: 'review',
      description: 'Review code',
      path: 'C:/Users/u/.pi/agent/skills/review/SKILL.md',
      source: 'global',
      fileKind: 'skill-md',
    }])
    const handler = mocks.handlers.get('ipc:skills.list')

    const result = await handler?.({}) as { complete?: boolean; skills?: Array<{ name?: string; enabled?: boolean }> }

    expect(result.complete).toBe(true)
    expect(result.skills?.[0]?.name).toBe('review')
    expect(result.skills?.[0]?.enabled).toBe(true)
    expect(mocks.start).not.toHaveBeenCalled()
  })

  it('applies disk skill changes from the main process when no worker is running', async () => {
    mocks.workerManager.isRunning = false
    mocks.listSkillsOnDisk.mockReturnValue([{
      name: 'review',
      description: 'Review code',
      path: 'C:/Users/u/.pi/agent/skills/review/SKILL.md',
      source: 'global',
      fileKind: 'skill-md',
    }])
    const handler = mocks.handlers.get('ipc:skills.applyOverrides')

    const result = await handler?.({
      changes: [{ key: 'host|C:/Users/u/.pi/agent/skills/review/SKILL.md|local', enabled: false }],
    }) as { ok?: boolean; count?: number }

    expect(result).toEqual({ ok: true, count: 1 })
    expect(mocks.applyDiskSkillChanges).toHaveBeenCalledWith([
      { name: 'review', path: 'C:/Users/u/.pi/agent/skills/review/SKILL.md', enabled: false },
    ])
  })

  it('waits for the worker skill catalog to become complete before answering', async () => {
    vi.useFakeTimers()
    try {
      mocks.workerManager.isRunning = true
      mocks.getSkillsList
        .mockResolvedValueOnce({
          complete: false,
          projectTrusted: false,
          effectiveSkills: [],
          candidates: [],
        })
        .mockResolvedValueOnce({
          complete: true,
          projectTrusted: true,
          effectiveSkills: [],
          candidates: [{
            key: 'host|/skills/review/SKILL.md|local',
            runtimeId: 'host',
            name: 'review',
            description: 'Review',
            filePath: 'C:/repo/.pi/skills/review/SKILL.md',
            source: 'local',
            scope: 'project',
            origin: 'top-level',
            enabled: true,
            effective: true,
            shadowed: false,
            command: '/skill:review',
            editable: true,
            movable: true,
            canCopyToUser: true,
            canCopyToProject: false,
          }],
        })
      const handler = mocks.handlers.get('ipc:skills.list')
      const promise = handler?.({}) as Promise<{ complete?: boolean; skills?: Array<{ name?: string }> }>

      await vi.advanceTimersByTimeAsync(110)
      const result = await promise

      expect(mocks.getSkillsList).toHaveBeenCalledTimes(2)
      expect(result.complete).toBe(true)
      expect(result.skills?.[0]?.name).toBe('review')
    } finally {
      vi.useRealTimers()
    }
  })

  it('returns the last incomplete catalog after the readiness wait expires', async () => {
    vi.useFakeTimers()
    try {
      mocks.workerManager.isRunning = true
      mocks.getSkillsList.mockResolvedValue({
        complete: false,
        projectTrusted: false,
        effectiveSkills: [],
        candidates: [],
      })
      const handler = mocks.handlers.get('ipc:skills.list')
      const promise = handler?.({}) as Promise<{ complete?: boolean }>

      await vi.advanceTimersByTimeAsync(3000)
      const result = await promise

      expect(result.complete).toBe(false)
      expect(mocks.getSkillsList.mock.calls.length).toBeGreaterThan(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('retries a rejecting skill list RPC while the worker boots', async () => {
    vi.useFakeTimers()
    try {
      mocks.workerManager.isRunning = true
      mocks.getSkillsList
        .mockRejectedValueOnce(new Error('worker not ready'))
        .mockResolvedValueOnce({
          complete: true,
          projectTrusted: true,
          effectiveSkills: [],
          candidates: [],
        })
      const handler = mocks.handlers.get('ipc:skills.list')
      const promise = handler?.({}) as Promise<{ complete?: boolean }>

      await vi.advanceTimersByTimeAsync(110)
      const result = await promise

      expect(mocks.getSkillsList).toHaveBeenCalledTimes(2)
      expect(result.complete).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('authorizes skill mutations by opaque catalog key and reports reload failures', async () => {
    mocks.workerManager.isRunning = true
    mocks.applySkillOverrides.mockResolvedValue(1)
    mocks.reloadResources.mockRejectedValue(new Error('reload failed'))
    const handler = mocks.handlers.get('ipc:skills.applyOverrides')

    await expect(handler?.({
      changes: [{ key: 'host|/skills/review/SKILL.md|local', enabled: false, path: 'C:/forged' }],
    })).resolves.toEqual({ ok: false, error: 'reload failed' })

    expect(mocks.applySkillOverrides).toHaveBeenCalledWith([
      { key: 'host|/skills/review/SKILL.md|local', enabled: false },
    ])
  })

  it('does not accept a renderer path for skill description writes', async () => {
    mocks.workerManager.isRunning = true
    mocks.writeSkillDescription.mockResolvedValue('Updated')
    const handler = mocks.handlers.get('ipc:skills.description.write')

    await expect(handler?.({
      key: 'host|/skills/review/SKILL.md|local',
      path: 'C:/forged',
      description: 'Updated',
    })).resolves.toEqual({ ok: true, description: 'Updated' })

    expect(mocks.writeSkillDescription).toHaveBeenCalledWith(
      'host|/skills/review/SKILL.md|local',
      'Updated',
    )
  })
})

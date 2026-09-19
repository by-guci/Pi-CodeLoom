import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  applySkillOverrideChanges,
  getLiveWorkerSkillCatalog,
  syncWorkerDiskSkillSettings,
} from './worker-skill-resources'
import { resetSkillBaseSnapshot } from './skill-override'
import { st } from './worker-runtime'

let root: string

function writeSkill(parent: string, name: string, description = 'Skill description'): string {
  const dir = join(parent, name)
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'SKILL.md')
  writeFileSync(file, `---\nname: ${name}\ndescription: ${description}\n---\nBody`, 'utf-8')
  return file
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pi-worker-skill-'))
  resetSkillBaseSnapshot()
})

afterEach(() => {
  st.session = null
  st.currentCwd = ''
  st.currentSessionId = ''
  st.sdk = undefined as never
  resetSkillBaseSnapshot()
  rmSync(root, { recursive: true, force: true })
})

describe('worker skill disk fallback', () => {
  it('lists user skills from the pi agent skills dir and enables them by default', () => {
    const agent = join(root, 'agent')
    const file = writeSkill(join(agent, 'skills'), 'review', 'Review code')
    st.currentCwd = join(root, 'proj')
    st.sdk = { getAgentDir: () => agent } as never

    expect(syncWorkerDiskSkillSettings()).toBe(true)
    const catalog = getLiveWorkerSkillCatalog()

    expect(catalog.complete).toBe(true)
    expect(catalog.candidates).toHaveLength(1)
    expect(catalog.candidates[0]).toMatchObject({
      name: 'review',
      description: 'Review code',
      filePath: file,
      scope: 'user',
      source: 'local',
      enabled: true,
    })
    expect(JSON.parse(readFileSync(join(agent, 'settings.json'), 'utf-8')).skills).toContain(file)
  })

  it('lists project skills from .pi/skills and .agents/skills', () => {
    const proj = join(root, 'proj')
    const file = writeSkill(join(proj, '.pi', 'skills'), 'proj-skill')
    st.currentCwd = proj
    st.sdk = undefined as never

    const catalog = getLiveWorkerSkillCatalog()

    expect(catalog.candidates).toEqual([
      expect.objectContaining({
        name: 'proj-skill',
        filePath: file,
        scope: 'project',
        canCopyToProject: false,
      }),
    ])
  })

  it('also lists nested skills inside a directory skill', () => {
    const agent = join(root, 'agent')
    writeSkill(join(agent, 'skills'), 'wechatide-skill')
    const nested = writeSkill(join(agent, 'skills', 'wechatide-skill', 'skills'), 'automator')
    st.currentCwd = join(root, 'proj')
    st.sdk = { getAgentDir: () => agent } as never

    syncWorkerDiskSkillSettings()
    const catalog = getLiveWorkerSkillCatalog()

    expect(catalog.candidates.map((candidate) => candidate.name)).toEqual(
      expect.arrayContaining(['wechatide-skill', 'automator']),
    )
    expect(catalog.candidates.find((candidate) => candidate.filePath === nested)?.scope).toBe('user')
  })

  it('disabling a disk skill removes it from settings.json and re-enabling restores it', () => {
    const agent = join(root, 'agent')
    const file = writeSkill(join(agent, 'skills'), 'review')
    st.currentCwd = join(root, 'proj')
    st.sdk = { getAgentDir: () => agent } as never

    syncWorkerDiskSkillSettings()
    const catalog = getLiveWorkerSkillCatalog()
    expect(catalog.candidates[0].enabled).toBe(true)
    expect(JSON.parse(readFileSync(join(agent, 'settings.json'), 'utf-8')).skills).toContain(file)

    applySkillOverrideChanges([{ key: catalog.candidates[0].key, enabled: false }])
    expect(JSON.parse(readFileSync(join(agent, 'settings.json'), 'utf-8')).skills).toBeUndefined()
    expect(getLiveWorkerSkillCatalog().candidates[0].enabled).toBe(false)

    applySkillOverrideChanges([{ key: catalog.candidates[0].key, enabled: true }])
    syncWorkerDiskSkillSettings()
    expect(JSON.parse(readFileSync(join(agent, 'settings.json'), 'utf-8')).skills).toContain(file)
    expect(getLiveWorkerSkillCatalog().candidates[0].enabled).toBe(true)
  })
})

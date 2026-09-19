import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { canonicalSkillPath, isSkillPathEnabled } from '@shared/skill-catalog'
import { skillStorageKey } from './pi-resources-editor'
import { resolveActiveAgentDir, resolveActiveAgentSettingsFile } from './agent-dir'

function globalSettingsFile(): string {
  return resolveActiveAgentSettingsFile()
}

export type DesktopSkillOverrides = Record<string, boolean>

export function readGlobalSettingsJson(): Record<string, unknown> {
  if (!existsSync(globalSettingsFile())) return {}
  try {
    return JSON.parse(readFileSync(globalSettingsFile(), 'utf-8'))
  } catch (e) {
    return {}
  }
}

export function getDesktopSkillOverrides(): DesktopSkillOverrides {
  const raw = readGlobalSettingsJson().desktopSkillOverrides
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: DesktopSkillOverrides = {}
  for (const [k, v] of Object.entries(raw)) {
    if (v === false) out[k] = false
    if (v === true) out[k] = true
  }
  return out
}

/** 未写入或 true → 启用；仅 false 为禁用 */
export function isSkillEnabled(name: string, path: string | undefined, overrides: DesktopSkillOverrides): boolean {
  if (path && !isSkillPathEnabled(path, overrides)) return false
  if (!path && overrides[skillStorageKey(name)] === false) return false
  return true
}

export function setSkillEnabledInGlobal(name: string, path: string | undefined, enabled: boolean): DesktopSkillOverrides {
  const key = skillStorageKey(name, path || undefined)
  const settings = readGlobalSettingsJson()
  const overrides: DesktopSkillOverrides = { ...getDesktopSkillOverrides() }
  if (enabled) {
    delete overrides[key]
    delete overrides[skillStorageKey(name)]
  } else {
    overrides[key] = false
  }
  settings.desktopSkillOverrides = overrides
  const dir = resolveActiveAgentDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(globalSettingsFile(), JSON.stringify(settings, null, 2), 'utf-8')
  return overrides
}

/** 批量写入 desktopSkillOverrides，只落盘一次 */
export function applySkillOverridesBatch(
  changes: Array<{ name: string; path?: string; enabled: boolean }>,
): DesktopSkillOverrides {
  if (changes.length === 0) return getDesktopSkillOverrides()
  const settings = readGlobalSettingsJson()
  const overrides: DesktopSkillOverrides = { ...getDesktopSkillOverrides() }
  for (const { name, path, enabled } of changes) {
    const key = skillStorageKey(name, path || undefined)
    if (enabled) {
      delete overrides[key]
      delete overrides[skillStorageKey(name)]
    } else {
      overrides[key] = false
    }
  }
  settings.desktopSkillOverrides = overrides
  const dir = resolveActiveAgentDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(globalSettingsFile(), JSON.stringify(settings, null, 2), 'utf-8')
  return overrides
}

/** 批量写入全局 settings：skills 列表（真实启用）与 desktopSkillOverrides（显式禁用），只落盘一次 */
export function applyDiskSkillChanges(
  changes: Array<{ name: string; path: string; enabled: boolean }>,
): number {
  if (changes.length === 0) return 0
  const settings = readGlobalSettingsJson()
  const overrides: DesktopSkillOverrides = { ...getDesktopSkillOverrides() }
  const nextSkills = Array.isArray(settings.skills) ? settings.skills.map(String) : []
  for (const { name, path, enabled } of changes) {
    const canonical = canonicalSkillPath(path)
    const key = skillStorageKey(name, path)
    if (enabled) {
      delete overrides[key]
      delete overrides[skillStorageKey(name)]
      if (!nextSkills.some((entry) => canonicalSkillPath(entry) === canonical)) nextSkills.push(path)
    } else {
      overrides[key] = false
      const index = nextSkills.findIndex((entry) => canonicalSkillPath(entry) === canonical)
      if (index >= 0) nextSkills.splice(index, 1)
    }
  }
  settings.desktopSkillOverrides = overrides
  if (nextSkills.length > 0) settings.skills = nextSkills
  else delete settings.skills
  const dir = resolveActiveAgentDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(globalSettingsFile(), JSON.stringify(settings, null, 2), 'utf-8')
  return changes.length
}

/** 一次性：把旧版 electron-store skillOverrides 迁到全局 settings */
export function migrateElectronSkillOverrides(
  legacy: Record<string, boolean> | undefined,
): DesktopSkillOverrides {
  if (!legacy || Object.keys(legacy).length === 0) return getDesktopSkillOverrides()
  const current = getDesktopSkillOverrides()
  const merged = { ...current }
  for (const [k, v] of Object.entries(legacy)) {
    if (v === false) merged[k] = false
  }
  const settings = readGlobalSettingsJson()
  settings.desktopSkillOverrides = merged
  const dir = resolveActiveAgentDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(globalSettingsFile(), JSON.stringify(settings, null, 2), 'utf-8')
  return merged
}

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs'
import { basename, dirname, join } from 'path'
import { canonicalSkillPath, isSkillPathEnabled, skillCatalogKey } from '@shared/skill-catalog'
import { replaceSkillDescription } from '@shared/skill-description-edit'
import {
  buildWorkerSkillCatalog,
  type RuntimeSkill,
  type WorkerSkillCandidate,
  type WorkerSkillCatalog,
} from './skill-catalog-runtime.js'
import { getSkillBaseSnapshot } from './skill-override.js'
import { isWslWorker, workerDistro } from './worker-path-bridge.js'
import { st } from './worker-runtime.js'
import {
  readSettings,
  readWorkerSkillOverrides,
  settingsPath,
  writeWorkerSkillOverrides,
} from './worker-skill-settings.js'

type SourceInfo = NonNullable<RuntimeSkill['sourceInfo']>
type LoaderInternals = {
  getSkills?: () => { skills?: RuntimeSkill[]; diagnostics?: Array<Record<string, unknown>> }
  findSourceInfoForPath?: (
    path: string,
    extensionInfos?: Map<string, SourceInfo>,
    metadata?: Map<string, unknown>,
  ) => SourceInfo | undefined
  getDefaultSourceInfoForPath?: (path: string) => SourceInfo
  extensionSkillSourceInfos?: Map<string, SourceInfo>
  resourceMetadataByPath?: Map<string, unknown>
}

type DiskSkillRow = {
  name: string
  description: string
  filePath: string
  scope: 'user' | 'project'
  baseDir: string
}

function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!m) return { meta: {}, body: raw }
  const meta: Record<string, string> = {}
  for (const line of m[1].split('\n')) {
    const idx = line.indexOf(':')
    if (idx < 0) continue
    const key = line.slice(0, idx).trim()
    let value = line.slice(idx + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    meta[key] = value
  }
  return { meta, body: m[2] }
}

function scanSkillMdFiles(
  dir: string,
  scope: DiskSkillRow['scope'],
  baseDir: string,
  out: DiskSkillRow[],
): void {
  if (!existsSync(dir)) return
  const walk = (d: string) => {
    let entries: string[]
    try {
      entries = readdirSync(d)
    } catch {
      return
    }
    for (const name of entries) {
      if (name.startsWith('.')) continue
      const full = join(d, name)
      let stats
      try {
        stats = statSync(full)
      } catch {
        continue
      }
      if (stats.isDirectory()) {
        const skillMd = join(full, 'SKILL.md')
        if (existsSync(skillMd)) {
          const raw = readFileSync(skillMd, 'utf-8')
          const { meta, body } = parseFrontmatter(raw)
          out.push({
            name: meta.name || name,
            description:
              meta.description || body.trim().split('\n').find((line) => line.trim())?.slice(0, 200) || '',
            filePath: skillMd,
            scope,
            baseDir,
          })
        }
        walk(full)
      } else if (name.endsWith('.md') && d === dir) {
        const raw = readFileSync(full, 'utf-8')
        const { meta, body } = parseFrontmatter(raw)
        out.push({
          name: meta.name || basename(name, '.md'),
          description:
            meta.description || body.trim().split('\n').find((line) => line.trim())?.slice(0, 200) || '',
          filePath: full,
          scope,
          baseDir,
        })
      }
    }
  }
  walk(dir)
}

export function scanWorkerSkillDirectories(cwd: string, agentDir: string | undefined): DiskSkillRow[] {
  const out: DiskSkillRow[] = []
  if (agentDir) {
    scanSkillMdFiles(join(agentDir, 'skills'), 'user', join(agentDir, 'skills'), out)
    scanSkillMdFiles(join(agentDir, '..', 'skills'), 'user', join(agentDir, '..', 'skills'), out)
  }
  scanSkillMdFiles(join(cwd, '.pi', 'skills'), 'project', join(cwd, '.pi', 'skills'), out)
  scanSkillMdFiles(join(cwd, '.agents', 'skills'), 'project', join(cwd, '.agents', 'skills'), out)
  const seen = new Set<string>()
  return out.filter((row) => {
    const key = canonicalSkillPath(row.filePath)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function runtimeId(): string {
  return isWslWorker() ? `wsl:${workerDistro}` : 'host'
}

function loader(): LoaderInternals | null {
  return (st.session?.resourceLoader as unknown as LoaderInternals | undefined) ?? null
}

function sourceInfoForPath(path: string, fallback?: SourceInfo): SourceInfo | undefined {
  const resourceLoader = loader()
  if (!resourceLoader) return fallback
  return resourceLoader.findSourceInfoForPath?.call(
    resourceLoader,
    path,
    resourceLoader.extensionSkillSourceInfos,
    resourceLoader.resourceMetadataByPath,
  ) ?? fallback ?? resourceLoader.getDefaultSourceInfoForPath?.call(resourceLoader, path)
}

function loadSkill(path: string): RuntimeSkill | null {
  if (!st.sdk) return null
  const result = st.sdk.loadSkills({
    cwd: st.currentCwd || process.cwd(),
    agentDir: st.sdk.getAgentDir(),
    skillPaths: [path],
    includeDefaults: false,
  })
  const wanted = canonicalSkillPath(path)
  const skill = result.skills.find((row) => canonicalSkillPath(row.filePath) === wanted)
  if (!skill) return null
  return { ...skill, sourceInfo: sourceInfoForPath(skill.filePath, skill.sourceInfo) }
}

export function getLiveWorkerSkillCatalog(): WorkerSkillCatalog {
  const snapshot = getSkillBaseSnapshot()
  const current = loader()?.getSkills?.()
  const cwd = st.currentCwd || process.cwd()
  const agentDir = st.sdk?.getAgentDir?.()
  const diskSkills = scanWorkerSkillDirectories(cwd, agentDir)
  const overrides = readWorkerSkillOverrides()
  const rid = runtimeId()

  const buildFallback = (livePaths: Set<string>): WorkerSkillCandidate[] => {
    const rows: WorkerSkillCandidate[] = []
    for (const row of diskSkills) {
      const pathKey = canonicalSkillPath(row.filePath)
      if (livePaths.has(pathKey)) continue
      rows.push({
        runtimeId: rid,
        name: row.name,
        filePath: row.filePath,
        source: 'local',
        scope: row.scope,
        origin: 'top-level',
        baseDir: row.baseDir,
        key: skillCatalogKey({ runtimeId: rid, filePath: row.filePath, source: 'local' }),
        nativeFilePath: row.filePath,
        description: row.description,
        enabled: isSkillPathEnabled(row.filePath, overrides),
        effective: false,
        shadowed: false,
        command: `/skill:${row.name}`,
        editable: true,
        movable: true,
        canCopyToUser: row.scope !== 'user',
        canCopyToProject: row.scope !== 'project',
        diagnostics: [],
      })
    }
    return rows
  }

  if (!snapshot || !current) {
    return {
      complete: true,
      projectTrusted: st.session?.settingsManager?.isProjectTrusted?.() ?? true,
      effectiveSkills: [],
      candidates: buildFallback(new Set()),
    }
  }
  const baseSkills = snapshot.skills
    .map((row) => {
      const filePath = String(row.filePath || row.path || '')
      if (!filePath) return null
      const loaded = loadSkill(filePath)
      return loaded || {
        name: String(row.name || basename(dirname(filePath)) || 'skill'),
        description: String(row.description || ''),
        filePath,
        baseDir: row.baseDir,
        sourceInfo: sourceInfoForPath(filePath, row.sourceInfo as SourceInfo | undefined),
      }
    })
    .filter((row): row is RuntimeSkill => row !== null)
  const currentSkills = (current.skills || []).map((skill) => ({
    ...skill,
    sourceInfo: sourceInfoForPath(skill.filePath, skill.sourceInfo),
  }))
  const live = buildWorkerSkillCatalog({
    runtimeId: rid,
    currentSkills,
    baseSkills,
    diagnostics: snapshot.diagnostics as never,
    overrides: readWorkerSkillOverrides(),
    projectTrusted: st.session?.settingsManager?.isProjectTrusted?.() ?? true,
    loadSkill,
  })
  const livePaths = new Set(live.candidates.map((candidate) => canonicalSkillPath(candidate.nativeFilePath)))
  return {
    ...live,
    complete: true,
    candidates: [...live.candidates, ...buildFallback(livePaths)],
  }
}

function isDiskFallbackCandidate(candidate: WorkerSkillCandidate): boolean {
  const snapshot = getSkillBaseSnapshot()
  const current = loader()?.getSkills?.()
  const basePaths = new Set(
    (snapshot?.skills ?? []).map((row) =>
      canonicalSkillPath(String((row as { filePath?: string; path?: string }).filePath || (row as { filePath?: string; path?: string }).path || '')),
    ),
  )
  const currentPaths = new Set(
    (current?.skills ?? []).map((row) => canonicalSkillPath(String((row as { filePath?: string }).filePath || ''))),
  )
  const pathKey = canonicalSkillPath(candidate.nativeFilePath)
  return !basePaths.has(pathKey) && !currentPaths.has(pathKey)
}

export function setWorkerSkillEnabledInSettings(changes: Array<{ filePath: string; enabled: boolean }>): void {
  if (!st.sdk) throw new Error('SDK_NOT_READY')
  const settings = readSettings()
  const current = Array.isArray(settings.skills) ? settings.skills.map(String) : []
  const next = [...current]
  for (const change of changes) {
    const key = canonicalSkillPath(change.filePath)
    const index = next.findIndex((entry) => canonicalSkillPath(entry) === key)
    if (change.enabled) {
      if (index < 0) next.push(change.filePath)
    } else if (index >= 0) {
      next.splice(index, 1)
    }
  }
  if (next.length > 0) settings.skills = next
  else delete settings.skills
  const path = settingsPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(settings, null, 2), 'utf-8')
}

export function syncWorkerDiskSkillSettings(): boolean {
  if (!st.sdk) return false
  const rows = scanWorkerSkillDirectories(st.currentCwd || process.cwd(), st.sdk.getAgentDir())
  if (rows.length === 0) return false
  const settings = readSettings()
  const overrides = readWorkerSkillOverrides()
  const next = Array.isArray(settings.skills) ? settings.skills.map(String) : []
  let changed = false
  for (const row of rows) {
    const key = canonicalSkillPath(row.filePath)
    if (overrides[`path:${key}`] === false || overrides[`path:${row.filePath}`] === false) continue
    if (!next.some((entry) => canonicalSkillPath(entry) === key)) {
      next.push(row.filePath)
      changed = true
    }
  }
  if (!changed) return false
  if (next.length > 0) settings.skills = next
  else delete settings.skills
  const path = settingsPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(settings, null, 2), 'utf-8')
  return true
}

function authorizedCandidate(key: string) {
  const catalog = getLiveWorkerSkillCatalog()
  if (!catalog.complete) throw new Error('SKILL_CATALOG_INCOMPLETE')
  const candidate = catalog.candidates.find((row) => row.key === key)
  if (!candidate) throw new Error('SKILL_NOT_FOUND')
  return { catalog, candidate }
}

export function applySkillOverrideChanges(changes: Array<{ key: string; enabled: boolean }>): number {
  const resolved = changes.map((change) => {
    const { candidate } = authorizedCandidate(change.key)
    if (candidate.shadowed) throw new Error('SHADOWED_SKILL_CANNOT_BE_TOGGLED')
    return {
      filePath: candidate.nativeFilePath,
      enabled: change.enabled,
      fallback: isDiskFallbackCandidate(candidate),
    }
  })
  const fallbackChanges = resolved.filter((row) => row.fallback)
  const liveChanges = resolved.filter((row) => !row.fallback)
  if (fallbackChanges.length > 0) {
    setWorkerSkillEnabledInSettings(fallbackChanges.map(({ filePath, enabled }) => ({ filePath, enabled })))
    writeWorkerSkillOverrides(fallbackChanges.map(({ filePath, enabled }) => ({ filePath, enabled })))
  }
  if (liveChanges.length > 0) {
    writeWorkerSkillOverrides(liveChanges.map(({ filePath, enabled }) => ({ filePath, enabled })))
  }
  return resolved.length
}

export function writeSkillDescription(key: string, description: string): string {
  const { candidate } = authorizedCandidate(key)
  if (!candidate.editable) throw new Error('SKILL_READ_ONLY')
  const current = readFileSync(candidate.nativeFilePath, 'utf-8')
  const replaced = replaceSkillDescription(current, description)
  if (!replaced.ok) throw new Error(`SKILL_DESCRIPTION_${replaced.reason.toUpperCase().replace(/-/g, '_')}`)
  writeFileSync(candidate.nativeFilePath, replaced.content, 'utf-8')
  return description.trim()
}

export function transferSkill(key: string, target: 'user' | 'project', mode: 'copy' | 'move') {
  const { catalog, candidate } = authorizedCandidate(key)
  if (target === 'project' && !catalog.projectTrusted) throw new Error('PROJECT_NOT_TRUSTED')
  if (mode === 'move' && !candidate.movable) throw new Error('SKILL_READ_ONLY')
  const destRoot = target === 'user'
    ? join(st.sdk!.getAgentDir(), 'skills')
    : join(st.currentCwd, '.pi', 'skills')
  const sourceFile = candidate.nativeFilePath
  const sourceDir = dirname(sourceFile)
  const directorySkill = basename(sourceFile).toLowerCase() === 'skill.md'
  const dest = directorySkill
    ? join(destRoot, basename(sourceDir))
    : join(destRoot, basename(sourceFile))
  if (!existsSync(sourceFile)) throw new Error('SKILL_SOURCE_MISSING')
  if (existsSync(dest)) throw new Error('SKILL_TARGET_EXISTS')
  mkdirSync(destRoot, { recursive: true })
  const temp = `${dest}.tmp-${process.pid}`
  try {
    cpSync(directorySkill ? sourceDir : sourceFile, temp, { recursive: directorySkill })
    renameSync(temp, dest)
    if (mode === 'move') rmSync(directorySkill ? sourceDir : sourceFile, { recursive: directorySkill, force: true })
    return { ok: true, target, name: candidate.name }
  } catch (error) {
    rmSync(temp, { recursive: true, force: true })
    throw error
  }
}

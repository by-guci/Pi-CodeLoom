export type StorePackage = {
  name: string
  description: string
  author: string
  types: string[]
  downloads: number
  version: string
}
export type PackageCatalog = { packages: StorePackage[]; total: number; page: number; hasNext: boolean }
export type InstalledStorePackage = { name: string; source: string; version: string | null; pinned: boolean; updateAvailable?: boolean; latestVersion?: string | null; latestVersionError?: boolean }
export type PackageStoreState = {
  batch?: { total: number; completed: number; results: { name: string; status: 'updated' | 'failed' | 'skipped' }[] }
  installed: InstalledStorePackage[]
  busy: boolean
  operation: string | null
  log: string[]
  error: string | null
  needsRestart: boolean
  writable: boolean
}
export const PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/

/** Editorial summaries, not author-provided translations. */
export const PACKAGE_SUMMARIES_ZH: Record<string, string> = {
  'pi-mcp-adapter': '为 Pi 接入 MCP 工具和服务，让编码助手使用外部能力。',
  'pi-subagents': '提供子代理委派和多代理协作流程，帮助拆分并处理任务。',
  'pi-mcp-extension': '为 Pi 提供 MCP 集成，连接外部工具服务。',
  'pi-web-ui': '通过网页界面使用 Pi，提供浏览器端交互入口。',
  'pi-interview': '通过交互式访谈澄清需求，帮助形成更明确的任务说明。',
  'pi-fabric': '将 Fabric 提示词工作流接入 Pi，复用常见任务模板。',
  'pi-prompt-template-model': '为提示词模板配置对应模型，按任务选用模型。',
  '@narumitw/pi-goal': '为 Pi 增加目标管理能力，围绕目标持续推进任务。',
  '@narumitw/pi-btw': '在主任务之外提出旁支问题，减少对当前工作流的打断。',
  '@narumitw/pi-plan-mode': '为 Pi 增加规划模式，在执行前整理方案。',
}

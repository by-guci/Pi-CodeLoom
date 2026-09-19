import { existsSync, realpathSync } from 'fs'
import { dirname, join } from 'path'

export type NpmCommand = { command: string; args: string[] }

/** Windows npm.cmd needs a shell; run its JavaScript entry with Node instead. */
export function resolveNpmCommand(opts: {
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
} = {}): NpmCommand {
  if ((opts.platform ?? process.platform) !== 'win32') return { command: 'npm', args: [] }
  const env = opts.env ?? process.env
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path')
  const directories = String(pathKey ? env[pathKey] : '')
    .split(';')
    .map((directory) => directory.trim().replace(/^"|"$/g, ''))
    .filter(Boolean)

  for (const directory of directories) {
    const executable = join(directory, 'npm.exe')
    if (existsSync(executable)) return { command: executable, args: [] }
    const shim = join(directory, 'npm.cmd')
    if (!existsSync(shim)) continue
    const npmDirectory = dirname(realpathSync(shim))
    const cli = join(npmDirectory, 'node_modules', 'npm', 'bin', 'npm-cli.js')
    if (!existsSync(cli)) throw new Error('找不到 npm-cli.js，请检查 Node.js/npm 安装')
    const node = [npmDirectory, ...directories]
      .map((bin) => join(bin, 'node.exe'))
      .find((candidate) => existsSync(candidate))
    if (!node) throw new Error('找不到 node.exe，请检查 Node.js/npm 安装')
    return { command: node, args: [cli] }
  }
  throw new Error('找不到 npm，请安装 Node.js 并重新启动应用')
}

import { test, expect, _electron as electron } from '@playwright/test'
import { createServer } from 'node:http'
import { gzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const require = createRequire(import.meta.url)
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const name = 'pi-codeloom-store-fixture'

// A no-code, no-dependency npm fixture, served only by the local test registry.
function archive(version: string) {
  const contents = Buffer.from(JSON.stringify({ name, version, description: 'Store integration fixture', keywords: ['pi-package'], pi: { extensions: [] } }))
  const header = Buffer.alloc(512)
  header.write('package/package.json')
  for (const [offset, value, width] of [[100, 0o644, 8], [108, 0, 8], [116, 0, 8], [124, contents.length, 12], [136, 0, 12]]) {
    header.write(value.toString(8).padStart(width - 1, '0') + '\0', offset)
  }
  header.fill(' ', 148, 156)
  header.write('0', 156)
  header.write('ustar\0', 257)
  header.write('00', 263)
  header.write([...header].reduce((sum, value) => sum + value, 0).toString(8).padStart(6, '0') + '\0 ', 148)
  return gzipSync(Buffer.concat([header, contents, Buffer.alloc((512 - contents.length % 512) % 512 + 1024)]))
}

test('real Pi SDK installs, checks, updates and removes an isolated npm fixture', async ({}, info) => {
  test.setTimeout(120000)
  const profile = info.outputPath('profile')
  const agent = info.outputPath('agent')
  await mkdir(profile, { recursive: true }); await mkdir(agent, { recursive: true })
  const files = { '1.0.0': archive('1.0.0'), '1.1.0': archive('1.1.0') }
  let latest = '1.0.0'
  let registry = ''
  const server = createServer((req, res) => {
    const version = req.url?.match(/fixture-(1\.[01]\.0)\.tgz/)?.[1] as keyof typeof files
    if (version && files[version]) { res.writeHead(200, { 'Content-Type': 'application/octet-stream' }); res.end(files[version]); return }
    if (req.url?.split('?')[0] === `/${name}` || req.url?.split('?')[0] === `/${name}/latest`) {
      const versions = Object.fromEntries(Object.entries(files).map(([version, bytes]) => [version, {
        name, version, dist: { tarball: `${registry}/fixture-${version}.tgz`, shasum: createHash('sha1').update(bytes).digest('hex') },
      }]))
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(req.url?.includes('/latest') ? versions[latest] : { name, 'dist-tags': { latest }, versions }))
      return
    }
    res.writeHead(404).end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  registry = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const npmrc = info.outputPath('npmrc')
  await writeFile(npmrc, `registry=${registry}\naudit=false\nfund=false\nignore-scripts=true\n`)
  await writeFile(path.join(profile, 'pi-desktop.json'), JSON.stringify({ language: 'zh', appUpdateAutoCheck: false }))
  const html = `<span class="packages-count">1 / 1</span><article data-package-card="true" data-package-name="${name}"><p class="packages-desc">Fixture</p></article>`
  const bootstrap = info.outputPath('launch.mjs')
  await writeFile(bootstrap, `import { app } from 'electron'\napp.setPath('userData', ${JSON.stringify(profile)})\nconst originalFetch = globalThis.fetch\nglobalThis.fetch = (url, ...args) => String(url).startsWith('https://pi.dev/packages') ? Promise.resolve(new Response(${JSON.stringify(html)})) : originalFetch(url, ...args)\nawait import(${JSON.stringify(pathToFileURL(path.join(root, 'out/main/index.js')).href)})`)
  const env = { ...process.env, PI_E2E: '1', PI_CODING_AGENT_DIR: agent, npm_config_registry: registry, npm_config_userconfig: npmrc, npm_config_cache: info.outputPath('npm-cache'), npm_config_audit: 'false', npm_config_fund: 'false', npm_config_ignore_scripts: 'true' }
  delete env.ELECTRON_RUN_AS_NODE
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    app = await electron.launch({ executablePath: require('electron') as string, args: [bootstrap], env })
    const page = await app.firstWindow()
    await page.getByRole('button', { name: '设置', exact: true }).waitFor()
    const mutate = (action: string) => page.evaluate(({ action, name }) => window.piDesktop!.invoke('ipc:packages.mutate', { action, name }), { action, name })
    let state = await mutate('install')
    expect(state.installed).toContainEqual(expect.objectContaining({ name, version: '1.0.0' }))
    expect(JSON.parse(await readFile(path.join(agent, 'settings.json'), 'utf8')).packages).toContain(`npm:${name}`)
    latest = '1.1.0'
    state = await page.evaluate(() => window.piDesktop!.invoke('ipc:packages.checkUpdates', {}))
    expect(state.installed[0].updateAvailable).toBe(true)
    state = await page.evaluate(() => window.piDesktop!.invoke('ipc:packages.updateAll', {}))
    expect(state.installed[0].version).toBe('1.1.0')
    expect(state.batch).toMatchObject({ total: 1, completed: 1, results: [{ name, status: 'updated' }] })
    state = await mutate('remove')
    expect(state.installed).toEqual([])
    expect(JSON.parse(await readFile(path.join(agent, 'settings.json'), 'utf8')).packages || []).not.toContain(`npm:${name}`)
  } finally {
    if (app) await app.close()
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

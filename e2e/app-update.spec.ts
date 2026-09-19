import { test, expect, _electron as electron } from '@playwright/test'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const require = createRequire(import.meta.url)
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

test('real electron-updater checks metadata, rejects a corrupt download, retries and requests installation', async ({}, testInfo) => {
  test.skip(process.platform !== 'win32', 'Exercises the Windows NSIS updater; no installer is executed.')
  const artifact = Buffer.alloc(2 * 1024 * 1024, 42)
  const sha512 = createHash('sha512').update(artifact).digest('base64')
  let corrupt = true
  let downloadRequests = 0
  const server = createServer((request, response) => {
    if (request.url?.startsWith('/latest.yml')) {
      response.writeHead(200, { 'Content-Type': 'text/yaml' })
      response.end(`version: 1.0.8\nfiles:\n  - url: Pi-CodeLoom-Setup-1.0.8-x64.exe\n    sha512: ${sha512}\n    size: ${artifact.length}\npath: Pi-CodeLoom-Setup-1.0.8-x64.exe\nsha512: ${sha512}\nreleaseDate: '2026-09-19T00:00:00.000Z'\nreleaseNotes: '更新测试：支持版本提醒、下载进度与安全重启。'\n`)
      return
    }
    if (request.url?.startsWith('/Pi-CodeLoom-Setup-1.0.8-x64.exe')) {
      downloadRequests++
      const data = corrupt ? Buffer.alloc(artifact.length, 43) : artifact
      response.writeHead(200, { 'Content-Length': data.length, 'Content-Type': 'application/octet-stream' })
      let position = 0
      const timer = setInterval(() => {
        const end = Math.min(data.length, position + 65536)
        response.write(data.subarray(position, end))
        position = end
        if (end === data.length) { clearInterval(timer); response.end() }
      }, 40)
      response.on('close', () => clearInterval(timer))
      return
    }
    response.writeHead(404).end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const feed = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const profile = testInfo.outputPath('profile')
  await mkdir(profile, { recursive: true })
  await writeFile(path.join(profile, 'pi-desktop.json'), JSON.stringify({ language: 'zh', appUpdateAutoCheck: false }))
  const config = testInfo.outputPath('update.yml')
  await writeFile(config, `provider: generic\nurl: ${feed}\nupdaterCacheDirName: update-test\n`)
  const installRequest = testInfo.outputPath('install-request.json')
  const bootstrap = testInfo.outputPath('launch.mjs')
  await writeFile(bootstrap, [
    "import { app } from 'electron'",
    "import updater from 'electron-updater'",
    "import { writeFileSync } from 'node:fs'",
    `app.setPath('userData', ${JSON.stringify(profile)})`,
    "app.getVersion = () => '1.0.7'",
    "Object.defineProperty(app, 'isPackaged', { get: () => true })",
    'const engine = updater.autoUpdater',
    `engine.updateConfigPath = ${JSON.stringify(config)}`,
    `Object.defineProperty(engine.app, 'baseCachePath', { get: () => ${JSON.stringify(path.join(profile, 'cache'))} })`,
    'engine.disableDifferentialDownload = true',
    // Only this isolated test substitutes the feed and installer. Production IPC exposes neither.
    'const setFeedURL = engine.setFeedURL.bind(engine)',
    `engine.setFeedURL = () => setFeedURL({ provider: 'generic', url: ${JSON.stringify(feed)} })`,
    `engine.quitAndInstall = (...args) => writeFileSync(${JSON.stringify(installRequest)}, JSON.stringify(args))`,
    `await import(${JSON.stringify(pathToFileURL(path.join(root, 'out/main/index.js')).href)})`,
  ].join('\n'))
  const env = { ...process.env, PI_E2E: '1' }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.PORTABLE_EXECUTABLE_DIR
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    app = await electron.launch({ executablePath: require('electron') as string, args: [bootstrap], env })
    const page = await app.firstWindow()
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await page.getByRole('button', { name: '关于', exact: true }).click()
    await expect(page.getByRole('button', { name: '检查更新' })).toBeEnabled()
    await page.getByRole('button', { name: '检查更新' }).click()
    await expect(page.getByRole('status').filter({ hasText: '发现新版本 1.0.8' })).toBeVisible()
    expect(downloadRequests).toBe(0)
    await page.getByRole('button', { name: '下载更新' }).click()
    await expect(page.getByRole('progressbar')).toBeVisible()
    await expect(page.getByRole('alert')).toContainText('下载失败')
    corrupt = false
    await page.getByRole('button', { name: '下载更新' }).click()
    await expect(page.getByRole('button', { name: '重启并安装' })).toBeVisible()
    expect(downloadRequests).toBe(2)
    const downloaded = path.join(profile, 'cache', 'update-test', 'pending', 'Pi-CodeLoom-Setup-1.0.8-x64.exe')
    expect(createHash('sha512').update(await readFile(downloaded)).digest('base64')).toBe(sha512)
    const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].capturePage()).toPNG().toString('base64'))
    await writeFile(testInfo.outputPath('update-ready.png'), Buffer.from(png, 'base64'))
    await page.getByRole('button', { name: '重启并安装' }).click()
    await expect.poll(async () => JSON.parse(await readFile(installRequest, 'utf8').catch(() => 'null'))).toEqual([false, true])
  } finally {
    if (app) await app.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

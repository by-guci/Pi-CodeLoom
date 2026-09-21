import { test, expect, _electron as electron } from '@playwright/test'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const require = createRequire(import.meta.url)
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

test('startup checks once, opens a dialog, validates full downloads and reuses the verified cache', async ({}, testInfo) => {
  test.skip(process.platform !== 'win32', 'Exercises the Windows NSIS updater; no installer is executed.')
  const artifact = Buffer.alloc(2 * 1024 * 1024, 42)
  const sha512 = createHash('sha512').update(artifact).digest('base64')
  const releaseNotes = '<h2>Pi-CodeLoom v1.0.8</h2><p>本次更新重点优化 Thinking（思考等级）选择，让不同模型展示各自支持的选项。</p><h3>✨ 新增</h3><ul><li>根据当前模型、供应商及 Pi 运行环境，自动筛选可用的思考等级。</li><li>仅支持思考开关的模型显示 ON／OFF。</li></ul><h3>🐛 修复</h3><ul><li>修复选择的思考等级与实际生效等级不一致的问题。</li><li>修复快速切换模型或会话时，旧请求覆盖当前菜单和选择的问题。</li></ul><h3>⚡ 优化</h3><ul><li>增加能力查询加载提示、失败重试和能力来源说明。</li></ul><script>window.releaseNotesExecuted = true</script><img src="https://example.invalid/pixel" onerror="window.releaseNotesExecuted = true">'
  let corrupt = true
  let downloadRequests = 0
  let metadataRequests = 0
  let blockmapRequests = 0
  const server = createServer((request, response) => {
    if (request.url?.startsWith('/latest.yml')) {
      metadataRequests++
      response.writeHead(200, { 'Content-Type': 'text/yaml' })
      response.end(`version: 1.0.8\nfiles:\n  - url: Pi-CodeLoom-Setup-1.0.8-x64.exe\n    sha512: ${sha512}\n    size: ${artifact.length}\npath: Pi-CodeLoom-Setup-1.0.8-x64.exe\nsha512: ${sha512}\nreleaseDate: '2026-09-19T00:00:00.000Z'\nreleaseNotes: ${JSON.stringify(releaseNotes)}\n`)
      return
    }
    if (request.url?.includes('.blockmap')) { blockmapRequests++; response.writeHead(404).end(); return }
    if (request.url?.split('?')[0] === '/Pi-CodeLoom-Setup-1.0.8-x64.exe') {
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
  // Previous versions could disable or postpone checks. These settings must no longer suppress startup.
  await writeFile(path.join(profile, 'pi-desktop.json'), JSON.stringify({ language: 'zh', appUpdateAutoCheck: false, appUpdateIgnoredVersion: '1.0.8', appUpdateLastCheckedAt: Date.now() }))
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
    let page = await app.firstWindow()
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await expect(page.getByRole('dialog', { name: '应用更新' })).toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: '发现新版本 1.0.8' })).toBeVisible()
    expect(metadataRequests).toBe(1)
    expect(downloadRequests).toBe(0)
    await expect(page.getByRole('switch', { name: '自动检查更新' })).toHaveCount(0)
    const notes = page.getByRole('region', { name: '更新说明' })
    await expect(notes.getByRole('heading', { name: 'Pi-CodeLoom v1.0.8' })).toBeVisible()
    await expect(notes.getByRole('listitem')).toHaveCount(5)
    await expect(notes).not.toContainText('<h2>')
    await expect(notes.locator('script, img, [onerror]')).toHaveCount(0)
    expect(await page.evaluate(() => 'releaseNotesExecuted' in window)).toBe(false)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].showInactive())
    await page.bringToFront()
    for (const mode of ['light', 'dark']) {
      await page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), mode === 'dark')
      await notes.screenshot({ path: testInfo.outputPath(`release-notes-${mode}.png`), animations: 'disabled' })
    }
    expect(downloadRequests).toBe(0)
    await page.getByRole('button', { name: '下载更新' }).click()
    await expect(page.getByRole('progressbar')).toBeVisible()
    await expect(page.getByRole('alert')).toContainText('安装包校验失败')
    expect(downloadRequests).toBe(1)
    expect(blockmapRequests).toBe(0)
    corrupt = false
    await page.getByRole('button', { name: '下载更新' }).click()
    await expect(page.getByRole('button', { name: '重启并安装' })).toBeVisible()
    expect(downloadRequests).toBe(2)
    expect(blockmapRequests).toBe(0)
    await page.evaluate(async () => {
      await window.piDesktop!.invoke('ipc:app.update.download', {})
      await window.piDesktop!.invoke('ipc:app.update.check', {})
    })
    expect(downloadRequests).toBe(2)
    expect(metadataRequests).toBe(1)
    const downloaded = path.join(profile, 'cache', 'update-test', 'pending', 'Pi-CodeLoom-Setup-1.0.8-x64.exe')
    expect(createHash('sha512').update(await readFile(downloaded)).digest('base64')).toBe(sha512)
    await app.close()
    expect(await readFile(installRequest, 'utf8').catch(() => null)).toBeNull()
    app = await electron.launch({ executablePath: require('electron') as string, args: [bootstrap], env })
    page = await app.firstWindow()
    await expect(page.getByRole('dialog', { name: '应用更新' })).toBeVisible()
    expect(metadataRequests).toBe(2)
    await page.getByRole('button', { name: '下载更新' }).click()
    await expect(page.getByRole('button', { name: '重启并安装' })).toBeVisible()
    // The SDK validates the existing cache rather than transferring the full installer again.
    expect(downloadRequests).toBe(2)
    const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].capturePage()).toPNG().toString('base64'))
    await writeFile(testInfo.outputPath('update-ready.png'), Buffer.from(png, 'base64'))
    await page.getByRole('button', { name: '重启并安装' }).click()
    await expect.poll(async () => JSON.parse(await readFile(installRequest, 'utf8').catch(() => 'null'))).toEqual([false, true])
  } finally {
    if (app) await app.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

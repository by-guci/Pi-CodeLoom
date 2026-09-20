import { test, expect, _electron as electron } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const require = createRequire(import.meta.url)
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
test('plugin store browses the live catalog and confirms package actions in Chinese', async ({}, info) => {
  const profile = info.outputPath('profile')
  const agent = info.outputPath('agent')
  await mkdir(profile, { recursive: true })
  await mkdir(agent, { recursive: true })
  await writeFile(path.join(profile, 'pi-desktop.json'), JSON.stringify({ language: 'zh', theme: 'light', appUpdateAutoCheck: false }))
  const bootstrap = info.outputPath('launch.mjs')
  await writeFile(bootstrap, `import { app } from 'electron'\napp.setPath('userData', ${JSON.stringify(profile)})\nawait import(${JSON.stringify(pathToFileURL(path.join(root, 'out/main/index.js')).href)})`)
  const env = { ...process.env, PI_E2E: '1', PI_CODING_AGENT_DIR: agent }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({ executablePath: require('electron') as string, args: [bootstrap], env })
  try {
    const page = await app.firstWindow()
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(1280, 900); BrowserWindow.getAllWindows()[0].showInactive() })
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await page.getByRole('button', { name: '插件商店', exact: true }).click()
    await expect(page.getByRole('heading', { name: '插件商店', exact: true })).toBeVisible()
    await expect(page.locator('article').first()).toBeVisible({ timeout: 45000 })
    expect(await page.locator('article').count()).toBeGreaterThan(10)
    await expect(page.getByText(/为 Pi 接入 MCP/)).toBeVisible()
    await page.bringToFront()
    await page.screenshot({ path: info.outputPath('store-light.png') })
    await page.evaluate(() => document.documentElement.classList.add('dark'))
    await page.screenshot({ path: info.outputPath('store-dark.png') })
    await page.getByRole('searchbox', { name: /搜索插件名称/ }).fill('pi-mcp-adapter')
    await page.getByRole('button', { name: '搜索', exact: true }).click()
    await expect(page.locator('article').filter({ has: page.getByRole('heading', { name: 'pi-mcp-adapter', exact: true }) })).toBeVisible()
    // Use deterministic operation responses: never install a third-party package in an E2E run.
    await app.evaluate(({ ipcMain }) => {
      const state = { installed: [] as Array<{ name: string; source: string; version: string; pinned: boolean; updateAvailable?: boolean; latestVersion?: string }>, busy: false, operation: null, log: [], error: null, needsRestart: false, writable: true }
      for (const channel of ['ipc:packages.state', 'ipc:packages.mutate', 'ipc:packages.checkUpdates', 'ipc:packages.updateAll']) ipcMain.removeHandler(channel)
      ipcMain.handle('ipc:packages.state', () => state)
      ipcMain.handle('ipc:packages.checkUpdates', () => { state.installed.forEach((item) => { item.updateAvailable = true }); return state })
      ipcMain.handle('ipc:packages.updateAll', () => {
        state.installed.forEach((item) => { item.version = '1.1.0'; item.updateAvailable = false })
        Object.assign(state, { batch: { total: 1, completed: 1, results: [{ name: 'pi-mcp-adapter', status: 'updated' }] } })
        return state
      })
      ipcMain.handle('ipc:packages.mutate', (_event, req) => {
        if (req.name !== 'pi-mcp-adapter') throw new Error('Wrong operation target')
        if (req.action === 'install') state.installed = [{ name: req.name, source: `npm:${req.name}`, version: '1.0.0', pinned: false, latestVersion: '1.1.0' }]
        if (req.action === 'update') state.installed[0] = { ...state.installed[0], version: '1.1.0', updateAvailable: false }
        if (req.action === 'remove') state.installed = []
        state.needsRestart = true
        return state
      })
    })
    const row = page.locator('article').filter({ has: page.getByRole('heading', { name: 'pi-mcp-adapter', exact: true }) })
    await row.getByRole('button', { name: '安装', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click()
    await expect(row.getByRole('button', { name: '安装', exact: true })).toBeVisible()
    await row.getByRole('button', { name: '安装', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: '安装', exact: true }).click()
    await page.getByRole('button', { name: '已安装', exact: true }).click()
    await expect(page.getByText('已安装 1.0.0')).toBeVisible()
    await expect(page.getByText('npm 最新版本：1.1.0', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '检查插件更新' }).click()
    await expect(page.getByText(/有可用更新/)).toBeVisible()
    await page.getByRole('button', { name: '一键更新已安装插件', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: '一键更新已安装插件', exact: true }).click()
    await expect(page.getByText('批量更新结束：成功 1 个，失败或跳过 0 个。')).toBeVisible()
    await expect(page.getByText('已安装 1.1.0')).toBeVisible()
    await expect(page.getByText(/npm 最新版本：1.1.0.*已是最新版本/)).toBeVisible()
    await page.getByRole('button', { name: '卸载', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: '卸载', exact: true }).click()
    await expect(page.getByText('没有找到插件')).toBeVisible()
  } finally { await app.close() }
})

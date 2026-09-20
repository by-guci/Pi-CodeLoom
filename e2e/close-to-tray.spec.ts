import { test, expect, _electron as electron } from '@playwright/test'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const require = createRequire(import.meta.url)
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

test('general close preference saves, survives restart, and hides the live window', async ({}, testInfo) => {
  test.skip(process.platform !== 'win32', 'System tray preference is Windows-only')
  const profile = testInfo.outputPath('profile')
  const agentDir = testInfo.outputPath('agent')
  await mkdir(profile, { recursive: true })
  await mkdir(agentDir, { recursive: true })
  await writeFile(path.join(profile, 'pi-desktop.json'), JSON.stringify({ language: 'zh', appUpdateAutoCheck: false }))
  const bootstrap = testInfo.outputPath('launch.mjs')
  await writeFile(bootstrap, `import { app } from 'electron'\napp.setPath('userData', ${JSON.stringify(profile)})\nawait import(${JSON.stringify(pathToFileURL(path.join(root, 'out/main/index.js')).href)})`)
  const env = { ...process.env, PI_E2E: '1', PI_CODING_AGENT_DIR: agentDir }
  delete env.ELECTRON_RUN_AS_NODE
  const launch = () => electron.launch({ executablePath: require('electron') as string, args: [bootstrap], env })
  let app = await launch()
  try {
    let page = await app.firstWindow()
    await page.getByRole('button', { name: '设置', exact: true }).click()
    const choice = page.getByRole('combobox', { name: '关闭主窗口时' })
    await expect(choice).toHaveValue('quit')
    await choice.selectOption('tray')
    await page.getByRole('button', { name: '放弃更改', exact: true }).click()
    await expect(choice).toHaveValue('quit')
    await choice.selectOption('tray')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.getByRole('button', { name: '保存', exact: true })).toBeDisabled()
    expect(JSON.parse(await readFile(path.join(profile, 'pi-desktop.json'), 'utf8')).closeWindowAction).toBe('tray')
    await page.getByRole('combobox', { name: '关闭主窗口时' }).screenshot({ path: testInfo.outputPath('close-preference.png') })
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
    expect(await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      return !!win && !win.isDestroyed() && !win.isVisible()
    })).toBe(true)
    await app.evaluate(({ app }) => app.emit('activate'))
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(true)
    await app.close()
    app = await launch()
    page = await app.firstWindow()
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await expect(page.getByRole('combobox', { name: '关闭主窗口时' })).toHaveValue('tray')
    await page.getByRole('combobox', { name: '关闭主窗口时' }).selectOption('quit')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.getByRole('button', { name: '保存', exact: true })).toBeDisabled()
    expect(JSON.parse(await readFile(path.join(profile, 'pi-desktop.json'), 'utf8')).closeWindowAction).toBe('quit')
  } finally { await app.close() }
})

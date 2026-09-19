import { test, expect, _electron as electron } from '@playwright/test'
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import type { useUIStore } from '../src/renderer/src/stores/ui-store'
import type { UIState } from '../src/renderer/src/stores/ui-store-types'

const require = createRequire(import.meta.url)
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

test('thinking picker queries active SDK models through real IPC and displays only their supported controls', async ({}, testInfo) => {
  const profile = testInfo.outputPath('profile')
  const agentDir = testInfo.outputPath('agent')
  await mkdir(profile, { recursive: true })
  await mkdir(agentDir, { recursive: true })
  await writeFile(path.join(profile, 'pi-desktop.json'), JSON.stringify({ theme: 'dark', language: 'zh', autoOpenLastProject: false, appUpdateAutoCheck: false }))
  const model = (id: string, reasoning = true) => ({ id, name: id, reasoning, input: ['text'], contextWindow: 128000, maxTokens: 8192, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, thinkingLevelMap: { xhigh: 'xhigh', max: 'max' } })
  const provider = (models: ReturnType<typeof model>[]) => ({ api: 'openai-completions', baseUrl: 'https://unused.invalid/v1', models })
  await writeFile(path.join(agentDir, 'models.json'), JSON.stringify({ providers: {
    xai: provider([model('grok-4.6')]),
    zhipuai: provider([model('glm-5.3'), model('glm-5')]),
    'test-fixed': provider([model('fixed'), model('plain', false)]),
  } }))
  const catalog = {
    xai: { models: { 'grok-4.6': { reasoning: true, reasoning_options: [{ type: 'effort', values: ['low', 'medium', 'high', 'xhigh'] }] } } },
    zhipuai: { models: {
      'glm-5.3': { reasoning: true, reasoning_options: [{ type: 'effort', values: ['low', 'high', 'max'] }] },
      'glm-5': { reasoning: true, reasoning_options: [{ type: 'toggle' }] },
    } },
    'test-fixed': { models: { fixed: { reasoning: true, reasoning_options: [] }, plain: { reasoning: false } } },
  }
  const bootstrap = testInfo.outputPath('launch.mjs')
  await writeFile(bootstrap, [
    "import { app } from 'electron'",
    `app.setPath('userData', ${JSON.stringify(profile)})`,
    'const originalFetch = globalThis.fetch',
    `globalThis.fetch = (url, ...args) => String(url) === 'https://models.dev/api.json' ? Promise.resolve(Response.json(${JSON.stringify(catalog)})) : originalFetch(url, ...args)`,
    `await import(${JSON.stringify(pathToFileURL(path.join(root, 'out/main/index.js')).href)})`,
  ].join('\n'))
  const env = { ...process.env, PI_E2E: '1', PI_CODING_AGENT_DIR: agentDir }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({ executablePath: require('electron') as string, args: [bootstrap], env })
  try {
    const page = await app.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.getByRole('button', { name: '设置', exact: true }).waitFor()
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      window.setSize(1100, 800)
      window.webContents.setBackgroundThrottling(false)
      window.showInactive()
    })
    const storeAsset = (await readdir(path.join(root, 'out/renderer/assets'))).find((file) => /^ui-store-.*\.js$/.test(file))!
    const storeUrl = pathToFileURL(path.join(root, 'out/renderer/assets', storeAsset)).href
    const patch = (state: Partial<UIState>) => page.evaluate(async ({ url, state }) => {
      const module = await import(url)
      const store = Object.values(module).find((value) => typeof value === 'function' && 'getState' in value) as typeof useUIStore
      store.setState(state)
    }, { url: storeUrl, state })
    const selectModel = (model: string) => patch({ historySessionFile: null, thinkingPickerOpen: true, runState: { status: 'idle', model, thinkingLevel: 'high' } as UIState['runState'] })
    const dialog = page.getByRole('dialog', { name: 'Thinking 等级' })
    const choices = dialog.locator('button[aria-pressed]')
    await selectModel('xai/grok-4.6')
    await expect(choices).toHaveCount(4)
    expect(await choices.locator('.font-mono').allTextContents()).toEqual(['LOW', 'MEDIUM', 'HIGH', 'XHIGH'])
    const capture = async (name: string) => {
      await page.bringToFront()
      await dialog.screenshot({ path: testInfo.outputPath(name), animations: 'disabled' })
    }
    await capture('thinking-grok-dark.png')
    await selectModel('zhipuai/glm-5.3')
    await expect(choices).toHaveCount(3)
    await expect(dialog.getByRole('button', { name: /^MAX/ })).toBeVisible()
    await expect(dialog.getByRole('button', { name: /^MEDIUM/ })).toHaveCount(0)
    await page.evaluate(() => document.documentElement.classList.remove('dark'))
    await expect(page.locator('html')).not.toHaveClass(/dark/)
    await capture('thinking-glm-light.png')
    await selectModel('zhipuai/glm-5')
    await expect(choices).toHaveCount(2)
    await expect(dialog.getByRole('button', { name: /^ON/ })).toBeVisible()
    await expect(dialog.getByRole('button', { name: /^OFF/ })).toBeVisible()
    await selectModel('test-fixed/plain')
    await expect(choices).toHaveCount(1)
    await expect(dialog.getByRole('button', { name: /^OFF/ })).toBeVisible()
    await selectModel('test-fixed/fixed')
    await expect(dialog).toContainText('此模型未提供可调的思考选项')
    await expect(choices).toHaveCount(0)
    await selectModel('missing/model')
    await expect(dialog).toContainText('未找到可用的思考等级')
    await expect(choices).toHaveCount(0)
    await selectModel('xai/grok-4.6')
    // Selection acknowledgement is controlled; model capability lookup above is the real backend path.
    const sessionFile = path.join(agentDir, 'selection.jsonl')
    await app.evaluate(({ ipcMain }, sessionFile) => {
      ipcMain.removeHandler('ipc:thinkingLevel.set')
      ipcMain.handle('ipc:thinkingLevel.set', (_event, request) => {
        if (request.model !== 'xai/grok-4.6' || request.sessionFile !== sessionFile || request.level !== 'low') throw new Error('Unexpected selection target')
        return { level: 'medium' }
      })
    }, sessionFile)
    await patch({ historySessionFile: sessionFile })
    await dialog.getByRole('button', { name: /^LOW/ }).click()
    await expect(dialog).toHaveCount(0)
    const actual = await page.evaluate(async (url) => {
      const module = await import(url)
      const store = Object.values(module).find((value) => typeof value === 'function' && 'getState' in value) as typeof useUIStore
      return store.getState().runState.thinkingLevel
    }, storeUrl)
    expect(actual).toBe('medium')
    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})

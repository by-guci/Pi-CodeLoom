import { test, expect, _electron as electron } from '@playwright/test'
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import type { useUIStore } from '../src/renderer/src/stores/ui-store'
import type { UIState, TimelineItem } from '../src/renderer/src/stores/ui-store-types'

const require = createRequire(import.meta.url)
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const items: TimelineItem[] = Array.from({ length: 36 }, (_, turn) => [
  {
    id: `u-${turn}`, sessionEntryId: `u-${turn}`, type: 'user-message' as const,
    text: turn === 12 ? '现在的启用/关闭逻辑是什么样子的？？' : `第 ${turn + 1} 轮：帮我看看这部分的实现`,
    timestamp: 1_700_000_000_000 + turn * 60_000,
  },
  {
    id: `a-${turn}`, sessionEntryId: `a-${turn}`, type: 'assistant-message' as const,
    text: `## 展示与切换\n\n现在的逻辑可以概括成一句话：只要技能被发现，就默认启用并自动注册。只有你明确点“关闭”才会停用。\n\n- **发现即启用**：目录里扫描到的技能会出现在列表中。\n- **首次打开技能页**：自动同步启用状态。\n- **点击关闭**：从配置中移除，下次打开不会自动加回来。\n- **点击启用**：把路径加回配置，更新后立即生效。\n\n### 一个需要知道的边界\n\n这是一段用于验证对话大纲的示例回复，第 ${turn + 1} 轮。\n\n\`settings.skills\` 保存显式选择，目录扫描负责发现可用内容。`,
    timestamp: 1_700_000_030_000 + turn * 60_000,
  },
]).flat()

test('outline previews, reveals old turns, follows scroll, and stays detached during streaming', async ({}, testInfo) => {
  const profile = testInfo.outputPath('profile')
  const workspace = testInfo.outputPath('workspace')
  const sessionFile = path.join(workspace, 'outline.jsonl')
  await mkdir(profile, { recursive: true })
  await mkdir(workspace, { recursive: true })
  await writeFile(path.join(profile, 'pi-desktop.json'), JSON.stringify({ theme: 'dark', language: 'zh' }))
  const bootstrap = testInfo.outputPath('launch.mjs')
  await writeFile(bootstrap, [
    "import { app } from 'electron'",
    `app.setPath('userData', ${JSON.stringify(profile)})`,
    `await import(${JSON.stringify(pathToFileURL(path.join(root, 'out/main/index.js')).href)})`,
  ].join('\n'))
  const env = { ...process.env, PI_E2E: '1' }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({ executablePath: require('electron') as string, args: [bootstrap], env })
  try {
    const page = await app.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.getByRole('button', { name: '设置', exact: true }).waitFor()
    await app.evaluate(({ BrowserWindow, ipcMain }, rows) => {
      const window = BrowserWindow.getAllWindows()[0]
      window.setSize(1280, 900)
      window.webContents.setBackgroundThrottling(false)
      window.hide()
      // Deterministic history fixture; no worker or model is needed to exercise the real renderer.
      ipcMain.removeHandler('ipc:session.getMessages')
      ipcMain.handle('ipc:session.getMessages', (_event, request) => {
        const end = request.leafId ? rows.findIndex((row) => row.sessionEntryId === request.leafId) + 1 : rows.length
        const pageEnd = Math.max(0, end - (request.offset || 0))
        const chunk = rows.slice(Math.max(0, pageEnd - (request.limit || 80)), pageEnd)
        return { items: chunk, sourceCount: chunk.length, totalCount: end }
      })
    }, items)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const assets = await readdir(path.join(root, 'out/renderer/assets'))
    const storeAsset = assets.find((file) => /^ui-store-.*\.js$/.test(file))!
    const storeUrl = pathToFileURL(path.join(root, 'out/renderer/assets', storeAsset)).href
    // Seed the public Zustand store in the built app, with only the last eight turns loaded.
    const patch = (state: Partial<UIState>) => page.evaluate(async ({ url, state }) => {
      const module = await import(url)
      const store = Object.values(module).find((value) => typeof value === 'function' && 'getState' in value) as typeof useUIStore
      store.setState(state)
    }, { url: storeUrl, state })
    const tree = items.map((item, index) => ({
      id: item.id, depth: index, isLeaf: index === items.length - 1,
      entryType: 'message', role: item.type === 'user-message' ? 'user' : 'assistant', preview: item.text,
    }))
    await patch({
      currentWorkspace: workspace, historySessionFile: sessionFile.replace(/\\/g, '/'), currentSessionId: 'outline',
      ephemeralSandboxDraft: false, timelineItems: items.slice(-16), historyLoading: false,
      historyTotalCount: items.length, historyLoadedCount: 16,
      rewindKey: sessionFile, rewindTreeNodes: tree, rewindLoadingTree: false,
      streamingAssistantId: null, agentTurnBootstrapping: false, composerPrefill: '保留这段未发送的草稿',
    })
    const nav = page.getByRole('navigation', { name: '对话大纲' })
    await expect(nav.getByRole('button')).toHaveCount(36)
    await expect(page.locator('[data-outline-turn-id]')).toHaveCount(8)
    await expect(nav.getByRole('button').first()).toHaveCSS('height', '10px')
    const turn = nav.locator('[data-outline-entry="u-12"]')
    await turn.hover()
    await expect(page.getByRole('tooltip')).toContainText('现在的启用/关闭逻辑是什么样子的？？')
    await expect(page.getByRole('tooltip')).toContainText('默认启用')
    await expect(page.locator('[data-outline-turn-id="u-12"]')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('tooltip')).toHaveCount(0)
    await turn.click()
    await expect(page.locator('[data-outline-turn-id="u-12"]')).toBeInViewport()
    await expect(turn).toHaveAttribute('aria-current', 'location')
    const pane = page.locator('.timeline-scroll-with-dock-pane')
    await patch({ streamingAssistantId: 'a-35' })
    const before = await pane.evaluate((element) => element.scrollTop)
    await patch({ timelineItems: items.map((item) => item.id === 'a-35' ? { ...item, text: `${item.text}\n\n${'持续生成的新内容。'.repeat(100)}` } : item) })
    await expect.poll(() => pane.evaluate((element) => element.scrollTop)).toBe(before)
    await turn.hover()
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].showInactive())
    await page.mouse.move(0, 0)
    await turn.hover()
    await expect(page.getByRole('tooltip')).toBeVisible()
    const capture = async (name: string) => {
      const png = await app.evaluate(async ({ BrowserWindow }) =>
        (await BrowserWindow.getAllWindows()[0].capturePage()).toPNG().toString('base64'),
      )
      await writeFile(testInfo.outputPath(name), Buffer.from(png, 'base64'))
    }
    await capture('outline-dark.png')
    await page.evaluate(() => document.documentElement.classList.remove('dark'))
    await turn.focus()
    await expect(page.getByRole('tooltip')).toBeVisible()
    await capture('outline-light.png')
    await page.keyboard.press('Escape')
    await turn.focus()
    await page.keyboard.press('Home')
    await expect(nav.getByRole('button').first()).toBeFocused()
    await page.keyboard.press('End')
    await expect(nav.getByRole('button').last()).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.locator('[data-outline-turn-id="u-35"]')).toBeInViewport()
    await pane.evaluate((element) => { element.scrollTop = element.scrollHeight })
    await expect(nav.getByRole('button').last()).toHaveAttribute('aria-current', 'location')
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 700))
    await nav.getByRole('button').last().hover()
    const tooltip = await page.getByRole('tooltip').boundingBox()
    const column = await page.locator('.main-chat-column').boundingBox()
    expect(tooltip!.x + tooltip!.width).toBeLessThanOrEqual(column!.x + column!.width)
    await page.screenshot({ path: testInfo.outputPath('outline-compact.png'), animations: 'disabled' })
    await patch({ historySessionFile: path.join(workspace, 'other.jsonl'), timelineItems: [{ ...items[0], id: 'other', sessionEntryId: 'other' }], streamingAssistantId: null })
    await expect(nav.getByRole('button')).toHaveCount(1)
    await expect(page.getByRole('tooltip')).toHaveCount(0)
    // Short outlines stay centered as new turns grow equally upwards and downwards.
    await page.mouse.move(0, 0)
    for (const count of [5, 10]) {
      await patch({ timelineItems: items.slice(0, count * 2), historyTotalCount: count * 2, historyLoadedCount: count * 2 })
      await expect(nav.getByRole('button')).toHaveCount(count)
      await expect.poll(async () => {
        const bounds = await nav.boundingBox()
        const host = await page.locator('.timeline-with-outline').boundingBox()
        return Math.abs(bounds!.y + bounds!.height / 2 - host!.y - host!.height / 2)
      }).toBeLessThanOrEqual(1)
      expect(await nav.locator('.timeline-outline-tick').evaluateAll((ticks) => ticks.every((tick) => getComputedStyle(tick).width === '8px'))).toBe(true)
    }
    await nav.getByRole('button').nth(4).hover()
    await expect(nav.getByRole('button').nth(4).locator('span')).toHaveCSS('width', '36px')
    await page.mouse.move(0, 0)
    await expect(page.getByRole('tooltip')).toHaveCount(0)
    expect(await nav.locator('.timeline-outline-tick').evaluateAll((ticks) => ticks.every((tick) => getComputedStyle(tick).width === '8px'))).toBe(true)
    await capture('outline-centered.png')
    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})

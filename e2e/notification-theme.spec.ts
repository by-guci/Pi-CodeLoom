import { test, expect, _electron as electron } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import { BUILTIN_THEMES } from '../src/renderer/src/lib/theme/builtin-themes'

const require = createRequire(import.meta.url)
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
test('custom notifications follow all sixteen saved palettes in light and dark modes', async ({}, info) => {
  const profile = info.outputPath('profile')
  const agent = info.outputPath('agent')
  await mkdir(profile, { recursive: true })
  await mkdir(agent, { recursive: true })
  await writeFile(path.join(profile, 'pi-desktop.json'), JSON.stringify({ language: 'zh', completionNotificationDelivery: 'auto', alertSoundEnabled: false, completionNotificationTimeoutSeconds: 60, appUpdateAutoCheck: false }))
  const bootstrap = info.outputPath('launch.mjs')
  await writeFile(bootstrap, `import { app } from 'electron'\napp.setPath('userData', ${JSON.stringify(profile)})\nawait import(${JSON.stringify(pathToFileURL(path.join(root, 'out/main/index.js')).href)})`)
  const env = { ...process.env, PI_E2E: '1', PI_CODING_AGENT_DIR: agent }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({ executablePath: require('electron') as string, args: [bootstrap], env })
  try {
    const main = await app.firstWindow()
    await main.getByRole('button', { name: '设置', exact: true }).waitFor()
    const opened = app.waitForEvent('window')
    await main.evaluate(() => window.piDesktop!.invoke('ipc:alerts.test', {}))
    const card = await opened
    await card.locator('.card').waitFor()
    await card.emulateMedia({ reducedMotion: 'reduce' })
    expect(await card.getByRole('button').count()).toBe(2)
    await card.locator('.card').hover()
    for (const palette of BUILTIN_THEMES) {
      for (const mode of ['light', 'dark'] as const) {
        await main.evaluate(async ({ palette, mode }) => {
          await window.piDesktop!.invoke('ipc:settings.set', { key: 'customTheme', value: { light: palette.light, dark: palette.dark } })
          await window.piDesktop!.invoke('ipc:settings.set', { key: 'theme', value: mode })
        }, { palette, mode })
        await expect.poll(() => card.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--surface').trim())).toBe(palette[mode].surface)
        await expect.poll(() => card.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim())).toBe(palette[mode].accent)
        await expect(card.locator('.card')).toBeVisible()
        expect(await card.locator('.card').evaluate((el) => el.scrollHeight <= el.clientHeight)).toBe(true)
        if (palette.id === 'clay-hearth') await card.screenshot({ path: info.outputPath(`clay-${mode}.png`) })
      }
    }
    await card.getByRole('button').first().click()
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => w.webContents.getURL().startsWith('data:')).every((w) => !w.isVisible()))).toBe(true)
  } finally { await app.close() }
})

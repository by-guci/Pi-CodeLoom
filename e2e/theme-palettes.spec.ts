import { test, expect, _electron as electron } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

test('built-in palettes switch modes, save, reload, and discard in the desktop app', async ({}, testInfo) => {
  const profile = testInfo.outputPath('profile')
  await mkdir(profile, { recursive: true })
  const bootstrap = testInfo.outputPath('launch.mjs')
  await writeFile(bootstrap, [
    "import { app } from 'electron'",
    `app.setPath('userData', ${JSON.stringify(profile)})`,
    `await import(${JSON.stringify(pathToFileURL(path.join(root, 'out/main/index.js')).href)})`,
  ].join('\n'))

  const env = { ...process.env }
  env.PI_E2E = '1'
  env.ELECTRON_DISABLE_SECURITY_WARNINGS = '1'
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({
    executablePath: require('electron') as string,
    args: [bootstrap],
    env,
    timeout: 60_000,
  })
  try {
    expect(await app.evaluate(({ app }) => app.getPath('userData'))).toBe(profile)
    const page = await app.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      window.setSize(1200, 900)
      window.hide()
    })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const openAppearance = async () => {
      await page.getByRole('button', { name: '设置', exact: true }).click()
      await page.getByRole('button', { name: '外观', exact: true }).click()
      await expect(page.getByRole('group', { name: '内置配色' })).toBeVisible()
    }
    await openAppearance()
    const palettes = page.getByRole('group', { name: '内置配色' }).getByRole('button')
    await expect(palettes).toHaveCount(16)
    await expect(page.getByRole('heading', { name: '浅色主题', exact: true })).toHaveCount(0)
    const surface = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg-base').trim())

    for (let index = 0; index < 16; index++) {
      const palette = palettes.nth(index)
      await palette.click()
      await expect(palette).toHaveAttribute('aria-pressed', 'true')
      await page.getByRole('button', { name: '浅色', exact: true }).click()
      await expect(page.locator('html')).not.toHaveClass(/dark/)
      const light = await surface()
      await page.getByRole('button', { name: '深色', exact: true }).click()
      await expect(page.locator('html')).toHaveClass(/dark/)
      expect(await surface()).not.toBe(light)
      await expect(palette).toHaveAttribute('aria-pressed', 'true')
    }
    await page.getByRole('group', { name: '内置配色' }).screenshot({ path: testInfo.outputPath('all-palettes.png'), animations: 'disabled' })

    await page.getByRole('button', { name: 'Claude · 陶土', exact: true }).click()
    await page.getByRole('button', { name: '跟随系统', exact: true }).click()
    for (const mode of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: mode, reducedMotion: 'reduce' })
      await expect.poll(surface).toBe(mode === 'light' ? '#faf9f5' : '#262624')
      await expect(page.getByRole('button', { name: '跟随系统', exact: true })).toHaveAttribute('aria-pressed', 'true')
      await page.screenshot({ path: testInfo.outputPath(`claude-${mode}.png`), animations: 'disabled' })
    }

    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.getByRole('button', { name: '保存', exact: true })).toBeDisabled()
    const saved = JSON.parse(await readFile(path.join(profile, 'pi-desktop.json'), 'utf8'))
    expect(saved.theme).toBe('system')
    expect(saved.customTheme.light.preset).toBe('clay-hearth')
    expect(saved.customTheme.dark.preset).toBe('clay-hearth')
    await page.reload()
    await expect.poll(surface).toBe('#262624')
    await openAppearance()
    await expect(page.getByRole('button', { name: 'Claude · 陶土', exact: true })).toHaveAttribute('aria-pressed', 'true')

    await page.getByRole('button', { name: '北境极光', exact: true }).click()
    expect(await surface()).not.toBe('#262624')
    await page.getByRole('button', { name: '放弃更改', exact: true }).click()
    await expect.poll(surface).toBe('#262624')
    await expect(page.getByRole('button', { name: 'Claude · 陶土', exact: true })).toHaveAttribute('aria-pressed', 'true')

    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 700))
    await page.screenshot({ path: testInfo.outputPath('compact.png'), animations: 'disabled' })
    const overflows = await page.getByRole('group', { name: '内置配色' }).evaluate((element) => element.scrollWidth > element.clientWidth)
    expect(overflows).toBe(false)
    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})

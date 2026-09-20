import { describe, expect, it } from 'vitest'
import { notificationThemeCss } from '@shared/notification-theme'
import { BUILTIN_THEMES } from '../builtin-themes'

describe('notification palettes', () => {
  for (const palette of BUILTIN_THEMES) {
    it.each(['light', 'dark'] as const)(`${palette.id} uses its %s colors independently of the OS`, (mode) => {
      const css = notificationThemeCss(mode, palette, mode === 'light')
      expect(css).toContain(`--surface: ${palette[mode].surface}`)
      expect(css).toContain(`--fg: ${palette[mode].ink}`)
      expect(css).toContain(`--accent: ${palette[mode].accent}`)
      expect(css).toContain(`color-scheme: ${mode}`)
    })
  }
  it('follows the OS only in system mode and sanitizes custom values', () => {
    expect(notificationThemeCss('system', null, true)).toContain('color-scheme: dark')
    expect(notificationThemeCss('system', null, false)).toContain('color-scheme: light')
    expect(notificationThemeCss('light', { light: { surface: '</style><script>bad</script>' } }, false)).not.toContain('<script>')
  })
})

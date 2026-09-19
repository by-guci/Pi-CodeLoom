import { describe, expect, it } from 'vitest'
import { normalizeCustomTheme } from '@shared/custom-theme'
import { BUILTIN_THEMES } from '../builtin-themes'
import { deriveThemeVariables } from '../derive-theme'
import { generateThemeCss } from '../generate-theme-css'

function luminance(hex: string): number {
  expect(hex).toMatch(/^#[0-9a-f]{6}$/)
  const [r, g, b] = [1, 3, 5].map((offset) => {
    const channel = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrastRatio(a: string, b: string): number {
  const first = luminance(a)
  const second = luminance(b)
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
}

describe('builtin theme catalog', () => {
  it('contains sixteen unique ids in display order', () => {
    const ids = BUILTIN_THEMES.map(({ id }) => id)
    expect(ids).toEqual([
      'clay-hearth',
      'codex',
      'nord',
      'rose-pine',
      'catppuccin',
      'tokyo-night',
      'gruvbox',
      'ledger-paper',
      'mosswood',
      'ocean',
      'jade-mist',
      'sakura-ink',
      'amber-noir',
      'violet-dusk',
      'moonstone',
      'citrus-terminal',
    ])
    expect(new Set(ids).size).toBe(16)
  })

  describe.each(BUILTIN_THEMES)('$id', ({ id, light, dark }) => {
    it('normalizes both variants without changing them', () => {
      expect(normalizeCustomTheme({ light, dark })).toStrictEqual({ light, dark })
    })

    it('has light and dark surfaces with opposite ink luminance', () => {
      expect(luminance(light.surface)).toBeGreaterThan(0.5)
      expect(luminance(dark.surface)).toBeLessThan(0.5)
      expect(luminance(light.ink)).toBeLessThan(luminance(light.surface))
      expect(luminance(dark.ink)).toBeGreaterThan(luminance(dark.surface))
    })

    it('generates populated CSS for both exclusive selectors', () => {
      const css = generateThemeCss(normalizeCustomTheme({ light, dark }))
      const lightBlock = css.match(/:root:not\(\.dark\) \{([^}]*)\}/)?.[1]
      const darkBlock = css.match(/:root\.dark \{([^}]*)\}/)?.[1]

      expect(lightBlock).toContain(`--bg-base: ${light.surface};`)
      expect(lightBlock).toContain(`--text-primary: ${light.ink};`)
      expect(darkBlock).toContain(`--bg-base: ${dark.surface};`)
      expect(darkBlock).toContain(`--text-primary: ${dark.ink};`)
      expect(css).not.toMatch(/(?:^|\n):root\s*\{|NaN|Infinity|undefined/)
    })

    describe.each(['light', 'dark'] as const)('%s variant', (key) => {
      const variant = key === 'light' ? light : dark

      it('uses the catalog id, default fonts, an opaque sidebar and valid diff colors', () => {
        expect(variant).toMatchObject({
          preset: id,
          fontUi: null,
          fontCode: null,
          translucentSidebar: false,
          diffAdded: expect.stringMatching(/^#[0-9a-f]{6}$/),
          diffRemoved: expect.stringMatching(/^#[0-9a-f]{6}$/),
        })
        expect(Number.isFinite(variant.contrast)).toBe(true)
        expect(variant.contrast).toBeGreaterThanOrEqual(0)
        expect(variant.contrast).toBeLessThanOrEqual(100)
      })

      it('derives valid colors and readable primary and secondary text on every surface', () => {
        const variables = deriveThemeVariables(variant)
        const values = Object.fromEntries(variables.map(({ name, value }) => [name, value]))

        for (const { name, value, format } of variables) {
          expect(value, name).not.toMatch(/NaN|Infinity|undefined/)
          if (format === 'hex') expect(value, name).toMatch(/^#[0-9a-f]{6}$/)
          if (format === 'hsl-triplet') {
            expect(value, name).toMatch(/^\d+(?:\.\d+)? \d+(?:\.\d+)?% \d+(?:\.\d+)?%$/)
          }
        }
        for (const text of ['--text-primary', '--text-secondary', '--brand']) {
          for (const background of ['--bg-base', '--bg-2', '--surface-sidebar']) {
            const ratio = contrastRatio(values[text], values[background])
            expect(Number.isFinite(ratio)).toBe(true)
            expect(ratio, `${id} ${key}: ${text} on ${background}`).toBeGreaterThanOrEqual(4.5)
          }
        }
      })
    })
  })
})

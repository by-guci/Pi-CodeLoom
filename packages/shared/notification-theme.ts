import { normalizeCustomTheme } from './custom-theme'

export function notificationThemeCss(theme: unknown, customTheme: unknown, systemDark: boolean): string {
  const dark = theme === 'dark' || (theme !== 'light' && systemDark)
  const variant = normalizeCustomTheme(customTheme)[dark ? 'dark' : 'light']
  const surface = variant?.surface ?? (dark ? '#181818' : '#ffffff')
  const ink = variant?.ink ?? (dark ? '#ffffff' : '#0d0d0d')
  const accent = variant?.accent ?? (dark ? '#339cff' : '#006ace')
  const channels = [1, 3, 5].map((offset) => parseInt(accent.slice(offset, offset + 2), 16) / 255)
    .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
  const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
  const foreground = luminance > 0.179 ? '#000000' : '#ffffff'
  return `:root {
    color-scheme: ${dark ? 'dark' : 'light'};
    --surface: ${surface}; --fg: ${ink}; --accent: ${accent}; --accent-fg: ${foreground};
    --surface-hover: color-mix(in srgb, ${surface} 96%, ${ink});
    --muted: color-mix(in srgb, ${ink} 76%, ${surface});
    --subtle: color-mix(in srgb, ${ink} 64%, ${surface});
    --line: color-mix(in srgb, ${ink} 18%, ${surface});
    --accent-hover: color-mix(in srgb, ${accent} 90%, ${foreground});
    --danger: ${variant?.diffRemoved ?? (dark ? '#ff8190' : '#b4233b')};
    --shadow: 0 6px 18px rgb(0 0 0 / ${dark ? '32%' : '12%'});
  }`
}

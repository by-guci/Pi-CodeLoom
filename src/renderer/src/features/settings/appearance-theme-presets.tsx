import { useTranslation } from 'react-i18next'
import { Check, RotateCcw } from '@renderer/components/icons'
import { useSettingsDraft } from './settings-draft-context'
import { btnCompact } from './settings-controls'
import { BUILTIN_THEMES } from '@renderer/lib/theme/builtin-themes'
import { mixColors } from '@renderer/lib/theme/derive-theme'
import { cn } from '@renderer/lib/utils'
import type { ThemeVariant } from '@shared/custom-theme'

function PalettePreview({ theme }: { theme: ThemeVariant }) {
  return (
    <span className="flex h-16 min-w-0 flex-1 overflow-hidden" style={{ backgroundColor: theme.surface }}>
      <span className="flex w-[28%] flex-col gap-1.5 p-2" style={{ backgroundColor: mixColors(theme.surface, '#000000', 0.045) }}>
        <span className="h-1.5 w-2.5 rounded-sm" style={{ backgroundColor: theme.accent }} />
        <span className="h-1 w-full rounded-sm" style={{ backgroundColor: theme.ink, opacity: 0.3 }} />
        <span className="h-1 w-2/3 rounded-sm" style={{ backgroundColor: theme.ink, opacity: 0.16 }} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col justify-center gap-1.5 p-2">
        <span className="h-1 w-3/4 rounded-sm" style={{ backgroundColor: theme.ink, opacity: 0.75 }} />
        <span className="h-1 w-full rounded-sm" style={{ backgroundColor: theme.ink, opacity: 0.2 }} />
        <span className="mt-0.5 flex h-4 items-center justify-end rounded-sm px-1" style={{ backgroundColor: mixColors(theme.surface, theme.ink, 0.08) }}>
          <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: theme.accent }} />
        </span>
      </span>
    </span>
  )
}

export function AppearanceThemePresets() {
  const { t } = useTranslation()
  const { draft, setCustomTheme } = useSettingsDraft()
  const selected = BUILTIN_THEMES.find((preset) =>
    (['light', 'dark'] as const).every((variant) =>
      Object.entries(preset[variant]).every(([field, value]) =>
        draft.customTheme[variant]?.[field as keyof ThemeVariant] === value,
      ),
    ),
  )
  const customized = Boolean(draft.customTheme.light || draft.customTheme.dark)

  return (
    <div className="space-y-3 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[13px] font-medium text-foreground">{t('settings:appearance.builtinPalettes')}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t('settings:appearance.builtinPalettesDesc')}</p>
        </div>
        <button type="button" className={btnCompact} disabled={!customized} onClick={() => setCustomTheme({})}>
          <RotateCcw className="h-3 w-3" aria-hidden="true" />
          {t('settings:appearance.resetPalette')}
        </button>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-3" role="group" aria-label={t('settings:appearance.builtinPalettes')}>
        {BUILTIN_THEMES.map((preset) => {
          const active = selected?.id === preset.id
          return (
            <button
              key={preset.id}
              type="button"
              aria-label={t(`settings:appearance.palettes.${preset.id}.name`)}
              aria-pressed={active}
              className={cn(
                'min-w-0 overflow-hidden rounded-lg border bg-background text-left transition-colors duration-motion-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--brand)] motion-reduce:transition-none',
                active ? 'border-[var(--brand)] ring-1 ring-[var(--brand)]' : 'border-border hover:border-[var(--brand)]',
              )}
              onClick={() => setCustomTheme({ light: { ...preset.light }, dark: { ...preset.dark } })}
            >
              <span className="flex overflow-hidden border-b border-border/50" aria-hidden="true">
                <PalettePreview theme={preset.light} />
                <PalettePreview theme={preset.dark} />
              </span>
              <span className="flex items-center justify-between gap-1 px-2.5 pt-2.5 text-xs font-medium text-foreground">
                {t(`settings:appearance.palettes.${preset.id}.name`)}
                <Check className={cn('h-3.5 w-3.5 shrink-0', !active && 'invisible')} aria-hidden="true" />
              </span>
              <span className="block px-2.5 pb-2.5 pt-1 text-[11px] text-muted-foreground">
                {t(`settings:appearance.palettes.${preset.id}.description`)}
              </span>
            </button>
          )
        })}
      </div>
      <p className="text-xs text-muted-foreground" role="status">
        {t('settings:appearance.currentPalette', {
          name: selected
            ? t(`settings:appearance.palettes.${selected.id}.name`)
            : t(`settings:appearance.${customized ? 'presetCustom' : 'presetDefault'}`),
        })}
      </p>
    </div>
  )
}

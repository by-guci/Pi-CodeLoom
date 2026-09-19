import { useState } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CustomCssOverride, CustomTheme } from '@shared/custom-theme'
import type { SettingsDraft } from './settings-draft'
import { AppearanceThemeEditor } from './appearance-theme-editor'
import { AppearanceThemePresets } from './appearance-theme-presets'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      if (key.endsWith('unsupportedFields')) return `${values?.count} unsupported`
      if (key.endsWith('importError')) return `error: ${values?.error}`
      if (key.endsWith('contrastWarning')) return `contrast ${values?.ratio}`
      return key.replace('settings:appearance.', '')
    },
  }),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))

interface DraftActions {
  setCustomTheme: (theme: CustomTheme) => void
  setCustomCssOverride: (override: CustomCssOverride) => void
}

let currentDraft: SettingsDraft
let currentActions: DraftActions

vi.mock('./settings-draft-context', () => ({
  useSettingsDraft: () => ({ draft: currentDraft, ...currentActions }),
}))

function baseDraft(): SettingsDraft {
  return {
    theme: 'system',
    iconTheme: 'phosphor',
    customTheme: {},
    customCssOverride: { enabled: false, css: '' },
    language: 'en',
    autoOpenLastProject: true,
    alertSoundEnabled: true,
    alertNotificationEnabled: true,
    alertOnExtensionUi: true,
    alertOnRunIdle: true,
    alertOnBackgroundRunIdle: false,
    alertOnRunFailed: true,
    completionNotificationTimeoutSeconds: 15,
    completionNotificationPreview: 'response',
    completionNotificationOnlyWhenUnfocused: true,
    completionNotificationDndUntil: null,
    completionNotificationDelivery: 'auto',
    maxSessionWorkers: 4,
    sessionWorkerIdleTimeoutMinutes: 15,
    timelineMaxAutoExpandedTools: 0,
    extensionOverrides: {},
    rightPanelCatalog: [],
    rightPanelPrefs: {},
    rightPanelOrder: [],
    agentRuntime: { mode: 'host', distro: null },
  }
}

function Harness() {
  const [draft, setDraft] = useState(baseDraft)
  currentDraft = draft
  currentActions = {
    setCustomTheme: (customTheme) => setDraft((value) => ({ ...value, customTheme })),
    setCustomCssOverride: (customCssOverride) =>
      setDraft((value) => ({ ...value, customCssOverride })),
  }
  return <><AppearanceThemePresets /><AppearanceThemeEditor /></>
}

function lightSection(): HTMLElement {
  return screen.getByRole('heading', { name: 'colorDetails' }).closest('section') as HTMLElement
}

async function chooseLightPreset(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'palettes.clay-hearth.name' }))
  await user.click(screen.getByRole('button', { name: 'customize' }))
  await user.click(screen.getByRole('button', { name: 'themeLight' }))
}

afterEach(() => cleanup())

describe('AppearanceThemeEditor', () => {
  it('sets both variants together, marks manual edits custom, and restores default', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await chooseLightPreset(user)
    expect(currentDraft.customTheme.light).toMatchObject({
      preset: 'clay-hearth',
      accent: '#a44c2f',
      surface: '#faf9f5',
    })
    expect(currentDraft.customTheme.dark?.preset).toBe('clay-hearth')
    expect(screen.getByRole('button', { name: 'palettes.clay-hearth.name' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.change(within(lightSection()).getByRole('slider', { name: 'contrast' }), {
      target: { value: '52' },
    })
    expect(currentDraft.customTheme.light).toMatchObject({ preset: null, contrast: 52 })
    expect(screen.getByRole('button', { name: 'palettes.clay-hearth.name' })).toHaveAttribute('aria-pressed', 'false')

    await user.click(within(lightSection()).getByRole('button', { name: 'restoreDefault' }))
    expect(currentDraft.customTheme.light).toBeUndefined()
  })

  it('imports atomically into the payload variant and leaves the draft unchanged on errors', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByRole('button', { name: 'customize' }))
    await user.click(within(lightSection()).getByRole('button', { name: 'importTheme' }))
    const dialog = screen.getByRole('dialog')
    const textarea = within(dialog).getByRole('textbox', { name: 'importValueLabel' })
    const invalid = 'codex-theme-v1:{bad json}'
    fireEvent.change(textarea, { target: { value: invalid } })
    await user.click(within(dialog).getByRole('button', { name: 'previewImport' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('error:')
    expect(currentDraft.customTheme).toEqual({})

    fireEvent.change(textarea, {
      target: {
        value: `codex-theme-v1:${JSON.stringify({
          codeThemeId: 'vscode-plus',
          theme: {
            accent: '#339cff',
            contrast: 60,
            fonts: { code: null, ui: null },
            ink: '#ffffff',
            opaqueWindows: true,
            semanticColors: { skill: '#0000ff' },
            variant: 'dark',
            surface: '#181818',
          },
        })}`,
      },
    })
    await user.click(within(dialog).getByRole('button', { name: 'previewImport' }))
    expect(within(dialog).getByText('variantDark')).toBeInTheDocument()
    expect(within(dialog).getByText('2')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'confirmImport' }))

    expect(currentDraft.customTheme.light).toBeUndefined()
    expect(currentDraft.customTheme.dark).toMatchObject({
      accent: '#339cff',
      surface: '#181818',
      ink: '#ffffff',
      contrast: 60,
    })
  })

  it('keeps the old light/dark blocks collapsed and normalizes fonts on commit', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    expect(screen.queryByRole('heading', { name: 'variantLight' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'variantDark' })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'fontUi' })).not.toBeInTheDocument()
    expect(within(screen.getByRole('group', { name: 'builtinPalettes' })).getAllByRole('button')).toHaveLength(16)

    await chooseLightPreset(user)
    const fontInput = within(lightSection()).getByRole('textbox', { name: 'fontUi' })
    await user.type(fontInput, "Bad';  Font")
    await user.tab()
    expect(currentDraft.customTheme.light?.fontUi).toBe('Bad Font')
  })

  it('replaces both variants when changing palettes and exposes extra color pickers', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await chooseLightPreset(user)
    expect(currentDraft.customTheme.light).toMatchObject({
      preset: 'clay-hearth',
      accent: '#a44c2f',
      surface: '#faf9f5',
    })

    await user.click(screen.getByRole('button', { name: 'palettes.mosswood.name' }))
    expect(currentDraft.customTheme.light?.preset).toBe('mosswood')
    expect(currentDraft.customTheme.dark?.preset).toBe('mosswood')
    expect(currentDraft.theme).toBe('system')

    fireEvent.change(within(lightSection()).getByRole('textbox', { name: 'diffAddedHex' }), {
      target: { value: '#112233' },
    })
    fireEvent.blur(within(lightSection()).getByRole('textbox', { name: 'diffAddedHex' }))
    expect(currentDraft.customTheme.light).toMatchObject({ preset: null, diffAdded: '#112233' })
  })

  it('enables, preserves, and clears the advanced CSS draft', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByRole('button', { name: /expand/ }))
    const css = screen.getByRole('textbox', { name: 'customCss' })
    fireEvent.change(css, { target: { value: ':root { --brand: #007acc; }' } })
    await user.click(screen.getByRole('switch', { name: 'customCssEnabled' }))

    expect(currentDraft.customCssOverride).toEqual({
      enabled: true,
      css: ':root { --brand: #007acc; }',
    })

    await user.click(screen.getByRole('button', { name: 'clearCustomCss' }))
    expect(currentDraft.customCssOverride).toEqual({ enabled: false, css: '' })
  })

  it('keeps the copy action disabled while a slot uses the real Pi default', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'customize' }))
    expect(within(lightSection()).getByRole('button', { name: 'copyTheme' })).toBeDisabled()
  })

  it('restores both variants without changing the display mode or custom CSS', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'palettes.nord.name' }))
    await user.click(screen.getByRole('button', { name: 'resetPalette' }))
    expect(currentDraft.customTheme).toEqual({})
    expect(currentDraft.theme).toBe('system')
    expect(currentDraft.customCssOverride).toEqual({ enabled: false, css: '' })
  })
})

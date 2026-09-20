import i18n from '@renderer/lib/i18n'
import { cn } from '@renderer/lib/utils'
import type { PiModelsConfigPayload } from '@shared/ipc-contract'
import type { ProviderPreset } from '@renderer/features/settings/model-provider-presets'
import type { LocalModelEntry } from '@renderer/features/settings/model-entry-editor'

export const API_OPTS = [
  { v: 'openai-completions', l: 'OpenAI Chat Completions' },
  { v: 'openai-responses', l: 'OpenAI Responses' },
  { v: 'anthropic-messages', l: 'Anthropic Messages' },
  { v: 'google-generative-ai', l: 'Google Generative AI' },
] as const

export { btnDanger, btnOutline, btnPrimary, inputCls, selectCls } from './settings-controls'

export function cloneConfig(c: PiModelsConfigPayload): PiModelsConfigPayload {
  return JSON.parse(JSON.stringify(c)) as PiModelsConfigPayload
}

export function configEqual(a: PiModelsConfigPayload | null, b: PiModelsConfigPayload | null): boolean {
  if (!a || !b) return a === b
  return JSON.stringify(a) === JSON.stringify(b)
}

export function maskApiKey(key?: string): string {
  if (!key) return i18n.t('settings:models.notConfigured')
  if (key.startsWith('$')) return key
  if (key.startsWith('!')) return '!command'
  if (key.length <= 8) return '••••••••'
  return `${key.slice(0, 4)}…${key.slice(-2)}`
}

export function ProviderAvatar({ preset, label }: { preset?: ProviderPreset; label: string }) {
  return (
    <span
      className={cn(
        'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white shadow-sm transition-transform duration-motion-fast ease-motion-ease',
        preset?.accentClass ?? 'bg-muted-foreground/40',
      )}
      title={label}
    >
      {label.slice(0, 2).toUpperCase()}
    </span>
  )
}

export function defaultModelEntry(id: string): LocalModelEntry {
  return { id, name: id, input: ['text'] }
}

export function applyLookupSpec(entry: LocalModelEntry, spec: {
  name?: string
  reasoning?: boolean
  input?: ('text' | 'image')[]
  contextWindow?: number
  maxTokens?: number
  thinkingLevelMap?: Record<string, string | null>
}): LocalModelEntry {
  const next: LocalModelEntry = {
    ...entry,
    input: spec.input?.length ? spec.input : entry.input || ['text'],
    reasoning: spec.reasoning || undefined,
    contextWindow: spec.contextWindow ?? entry.contextWindow,
    maxTokens: spec.maxTokens ?? entry.maxTokens,
  }
  if (spec.name && (!entry.name || entry.name === entry.id)) next.name = spec.name
  if (spec.reasoning) next.thinkingLevelMap = { ...(spec.thinkingLevelMap ?? { high: 'high' }), ...entry.thinkingLevelMap }
  if (!spec.reasoning) next.thinkingLevelMap = undefined
  return next
}

export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
export type ThinkingLevel = typeof THINKING_LEVELS[number]
export type ReasoningOption =
  | { type: 'effort'; values: string[] }
  | { type: 'toggle' }
  | { type: 'budget_tokens'; min?: number; max?: number }

export type ThinkingModel = {
  id: string
  provider: string
  reasoning?: boolean
  thinkingLevelMap?: Record<string, string | null>
  baseUrl?: string
}

export type ModelThinkingOptions = {
  model: string
  kind: 'effort' | 'toggle' | 'budget' | 'disabled' | 'fixed' | 'unknown'
  options: { level: ThinkingLevel; enabled?: boolean }[]
  source: 'models.dev' | 'runtime' | 'unknown'
  limitedByRuntime?: boolean
}

/** Translate documented effort values into the SDK's explicit capability map. */
export function thinkingMapFromOptions(options?: ReasoningOption[]): Record<string, string | null> | undefined {
  const effort = options?.find((option) => option.type === 'effort')
  if (effort?.type !== 'effort') return undefined
  const values = new Set(effort.values)
  const map = Object.fromEntries(THINKING_LEVELS.map((level) => [
    level, level === 'off' && values.has('none') ? 'none' : values.has(level) ? level : null,
  ]))
  if (!Object.values(map).some((value) => value !== null)) return undefined
  // A separate toggle uses the provider's existing off behavior, not an invented effort value.
  if (map.off === null && options?.some((option) => option.type === 'toggle')) delete map.off
  return map
}

/** Mirrors the Pi SDK defaults for a model before its session has been started. */
export function runtimeThinkingLevels(model: ThinkingModel): ThinkingLevel[] {
  if (model.reasoning === false) return ['off']
  if (model.reasoning !== true) return []
  return THINKING_LEVELS.filter((level) => {
    const mapped = model.thinkingLevelMap?.[level]
    if (mapped === null) return false
    return level !== 'xhigh' && level !== 'max' || typeof mapped === 'string'
  })
}

export function resolveThinkingOptions(
  model: ThinkingModel,
  record?: { reasoning?: boolean; reasoning_options?: ReasoningOption[] },
  runtimeLevels: readonly string[] = runtimeThinkingLevels(model),
): ModelThinkingOptions {
  const result: ModelThinkingOptions = { model: `${model.provider}/${model.id}`, kind: 'unknown', options: [], source: 'unknown' }
  const supported = THINKING_LEVELS.filter((level) => runtimeLevels.includes(level))
  if (model.reasoning === false || record?.reasoning === false) {
    return { ...result, kind: 'disabled', source: record ? 'models.dev' : 'runtime', options: supported.includes('off') ? [{ level: 'off' }] : [] }
  }
  if (!record?.reasoning_options) {
    return { ...result, kind: supported.length ? 'effort' : 'unknown', source: supported.length ? 'runtime' : 'unknown', options: supported.map((level) => ({ level })) }
  }
  const toggle = record.reasoning_options.some((option) => option.type === 'toggle')
  const effort = record.reasoning_options.find((option) => option.type === 'effort')
  if (effort?.type === 'effort') {
    const values = new Set(effort.values.map((value) => value === 'none' ? 'off' : value))
    if (toggle) values.add('off')
    const levels = THINKING_LEVELS.filter((level) => values.has(level) && supported.includes(level))
    return { ...result, kind: 'effort', source: 'models.dev', options: levels.map((level) => ({ level })), limitedByRuntime: levels.length < values.size }
  }
  const budget = record.reasoning_options.find((option) => option.type === 'budget_tokens')
  if (budget?.type === 'budget_tokens') {
    const levels = supported.filter((level) => level !== 'off' || toggle || budget.min === 0 || budget.min === -1)
    return { ...result, kind: 'budget', source: 'models.dev', options: levels.map((level) => ({ level })) }
  }
  if (toggle) {
    const enabled = supported.includes('high') ? 'high' : supported.find((level) => level !== 'off')
    return { ...result, kind: 'toggle', source: 'models.dev', options: [
      ...(supported.includes('off') ? [{ level: 'off' as const }] : []),
      ...(enabled ? [{ level: enabled, enabled: true }] : []),
    ] }
  }
  return { ...result, kind: 'fixed', source: 'models.dev' }
}

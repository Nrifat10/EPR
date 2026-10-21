// Server-only AI settings helpers — single-row provider configuration.
import 'server-only'
import { db } from '@/lib/db'
import { decryptSecret } from './crypto'

export type AiProvider = 'builtin' | 'zhipu' | 'anthropic' | 'openai'

export type AiProviderConfig = {
  provider: AiProvider
  model: string
  apiKey: string | null // decrypted, server-side only
  baseUrl: string | null
  maxTokens: number
  monthlyLimitSar: number
  inCostPer1k: number
  outCostPer1k: number
}

/** Suggested models per provider (editable free-text in the UI). */
export const PROVIDER_MODELS: Record<AiProvider, string[]> = {
  builtin: ['GLM-4.5 (sandbox default)'],
  zhipu: ['glm-4.5', 'glm-4.5-air', 'glm-4-plus'],
  anthropic: ['claude-sonnet-4-5', 'claude-opus-4-1', 'claude-haiku-4-5'],
  openai: ['gpt-4.1', 'gpt-4o', 'gpt-4o-mini'],
}

export const PROVIDER_LABELS: Record<AiProvider, string> = {
  builtin: 'Built-in GLM (sandbox)',
  zhipu: 'Zhipu GLM API',
  anthropic: 'Anthropic Claude',
  openai: 'OpenAI',
}

export function isAiProvider(v: string): v is AiProvider {
  return v === 'builtin' || v === 'zhipu' || v === 'anthropic' || v === 'openai'
}

const DEFAULTS = {
  provider: 'builtin' as AiProvider,
  model: '',
  maxTokens: 4000,
  monthlyLimitSar: 0,
  inCostPer1k: 0,
  outCostPer1k: 0,
}

/** Read the single AiSettings row (creating it on first use). */
export async function getAiSettingsRow() {
  let row = await db.aiSettings.findFirst()
  if (!row) {
    row = await db.aiSettings.create({ data: DEFAULTS })
  }
  return row
}

/** Full config WITH the decrypted API key — server-side use only. */
export async function getAiProviderConfig(): Promise<AiProviderConfig> {
  const row = await getAiSettingsRow()
  const provider = isAiProvider(row.provider) ? row.provider : 'builtin'
  return {
    provider,
    model: row.model || '',
    apiKey: await decryptSecret(row.apiKeyEnc),
    baseUrl: row.baseUrl || null,
    maxTokens: Math.min(16000, Math.max(256, row.maxTokens || 4000)),
    monthlyLimitSar: Math.max(0, row.monthlyLimitSar || 0),
    inCostPer1k: Math.max(0, row.inCostPer1k || 0),
    outCostPer1k: Math.max(0, row.outCostPer1k || 0),
  }
}

/** Effective model label for logs (builtin → "GLM-4.5"). */
export function effectiveModel(cfg: AiProviderConfig): string {
  if (cfg.model.trim()) return cfg.model.trim()
  switch (cfg.provider) {
    case 'zhipu':
      return 'glm-4.5'
    case 'anthropic':
      return 'claude-sonnet-4-5'
    case 'openai':
      return 'gpt-4.1'
    default:
      return 'GLM-4.5'
  }
}

/** Month-to-date usage totals (for the monthly limit gate + usage page). */
export async function getMonthUsage(year: number, month: number) {
  const from = new Date(Date.UTC(year, month - 1, 1))
  const to = new Date(Date.UTC(year, month, 1))
  const rows = await db.aiUsageLog.findMany({
    where: { createdAt: { gte: from, lt: to } },
    select: {
      promptTokens: true,
      completionTokens: true,
      totalTokens: true,
      costSar: true,
      success: true,
    },
  })
  return {
    requests: rows.length,
    promptTokens: rows.reduce((s, r) => s + r.promptTokens, 0),
    completionTokens: rows.reduce((s, r) => s + r.completionTokens, 0),
    totalTokens: rows.reduce((s, r) => s + r.totalTokens, 0),
    costSar: rows.reduce((s, r) => s + r.costSar, 0),
  }
}

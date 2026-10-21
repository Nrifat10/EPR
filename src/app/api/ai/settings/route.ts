// AI settings API — GET returns the config with a MASKED key hint (the
// decrypted key NEVER leaves the server). PUT (ai.managesettings) accepts a
// new key in plaintext only over this request and stores it encrypted.
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { ok, badRequest, serverError, requirePermission, isResponse, logActivity } from '@/lib/api-helpers'
import { getAiSettingsRow } from '@/lib/ai/settings'
import { decryptSecret, encryptSecret, maskKey } from '@/lib/ai/crypto'

export const dynamic = 'force-dynamic'

const schema = z.object({
  provider: z.enum(['builtin', 'zhipu', 'anthropic', 'openai']).optional(),
  model: z.string().max(120).optional(),
  apiKey: z.string().max(400).optional(), // write-only; '' clears, undefined keeps
  baseUrl: z.string().max(300).nullable().optional(),
  maxTokens: z.coerce.number().int().min(256).max(16000).optional(),
  monthlyLimitSar: z.coerce.number().min(0).max(1_000_000).optional(),
  inCostPer1k: z.coerce.number().min(0).max(1000).optional(),
  outCostPer1k: z.coerce.number().min(0).max(1000).optional(),
})

export async function GET() {
  const auth = await requirePermission('ai.managesettings')
  if (isResponse(auth)) return auth
  try {
    const row = await getAiSettingsRow()
    const plain = await decryptSecret(row.apiKeyEnc)
    return ok({
      settings: {
        provider: row.provider,
        model: row.model,
        apiKeyHint: maskKey(plain),
        hasKey: Boolean(plain),
        baseUrl: row.baseUrl ?? '',
        maxTokens: row.maxTokens,
        monthlyLimitSar: row.monthlyLimitSar,
        inCostPer1k: row.inCostPer1k,
        outCostPer1k: row.outCostPer1k,
        updatedAt: row.updatedAt,
      },
    })
  } catch {
    return serverError()
  }
}

export async function PUT(req: NextRequest) {
  const auth = await requirePermission('ai.managesettings')
  if (isResponse(auth)) return auth
  try {
    const parsed = schema.safeParse(await req.json())
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? 'Invalid request body')
    }
    const b = parsed.data
    const row = await getAiSettingsRow()
    const data: Record<string, unknown> = {}
    if (b.provider !== undefined) data.provider = b.provider
    if (b.model !== undefined) data.model = b.model.trim()
    if (b.baseUrl !== undefined) data.baseUrl = b.baseUrl?.trim() || null
    if (b.maxTokens !== undefined) data.maxTokens = b.maxTokens
    if (b.monthlyLimitSar !== undefined) data.monthlyLimitSar = b.monthlyLimitSar
    if (b.inCostPer1k !== undefined) data.inCostPer1k = b.inCostPer1k
    if (b.outCostPer1k !== undefined) data.outCostPer1k = b.outCostPer1k
    if (b.apiKey !== undefined) {
      data.apiKeyEnc = b.apiKey.trim() === '' ? null : await encryptSecret(b.apiKey.trim())
    }
    await db.aiSettings.update({ where: { id: row.id }, data })
    await logActivity({
      user: auth,
      action: 'updated',
      module: 'settings',
      description: `AI Assistant provider settings updated (${b.provider ?? row.provider})`,
    })
    const fresh = await db.aiSettings.findUnique({ where: { id: row.id } })
    const plain = await decryptSecret(fresh?.apiKeyEnc)
    return ok({
      settings: {
        provider: fresh?.provider ?? 'builtin',
        model: fresh?.model ?? '',
        apiKeyHint: maskKey(plain),
        hasKey: Boolean(plain),
        baseUrl: fresh?.baseUrl ?? '',
        maxTokens: fresh?.maxTokens ?? 4000,
        monthlyLimitSar: fresh?.monthlyLimitSar ?? 0,
        inCostPer1k: fresh?.inCostPer1k ?? 0,
        outCostPer1k: fresh?.outCostPer1k ?? 0,
        updatedAt: fresh?.updatedAt ?? new Date(),
      },
    })
  } catch {
    return serverError()
  }
}

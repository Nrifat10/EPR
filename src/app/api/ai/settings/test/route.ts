// AI provider connection test — runs a tiny completion through the CURRENT
// saved config (or a draft config passed in the body, without saving it).
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { ok, badRequest, serverError, requirePermission, isResponse } from '@/lib/api-helpers'
import { getAiProviderConfig } from '@/lib/ai/settings'
import { testProvider } from '@/lib/ai/provider'
import { decryptSecret } from '@/lib/ai/crypto'

export const dynamic = 'force-dynamic'

const schema = z.object({
  provider: z.enum(['builtin', 'zhipu', 'anthropic', 'openai']).optional(),
  model: z.string().max(120).optional(),
  apiKey: z.string().max(400).optional(), // draft key (not saved)
  baseUrl: z.string().max(300).optional(),
})

export async function POST(req: NextRequest) {
  const auth = await requirePermission('ai.managesettings')
  if (isResponse(auth)) return auth
  try {
    const parsed = schema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) return badRequest('Invalid body')
    const b = parsed.data

    const saved = await getAiProviderConfig()
    // Draft overrides let the admin test BEFORE saving (e.g. a just-typed key)
    const cfg = {
      ...saved,
      provider: b.provider ?? saved.provider,
      model: b.model ?? saved.model,
      baseUrl: b.baseUrl ?? saved.baseUrl,
      apiKey: b.apiKey !== undefined && b.apiKey !== '' ? b.apiKey : saved.apiKey,
    }
    const result = await testProvider(cfg)
    return ok(result)
  } catch (e) {
    return serverError()
  }
}

// E-Invoice translation API — POST /api/e-invoices/translate
// Batched English→Arabic translation for the drafting form (permission:
// einvoices.create OR einvoices.edit). Never 500s on translation failure —
// per-entry 'failed' results + a single top-level providerError warning.
import { NextRequest } from 'next/server'
import { z } from 'zod'
import {
  ok,
  badRequest,
  forbidden,
  serverError,
  requireAuth,
  isResponse,
} from '@/lib/api-helpers'
import { hasPermission } from '@/lib/auth'
import { translateEntries } from '@/lib/translate'

const bodySchema = z.object({
  entries: z
    .array(
      z.object({
        key: z.string().min(1, 'Entry key is required').max(100, 'Entry key is too long'),
        text: z.string().max(2000, 'Text is too long (max 2000 characters)'),
        context: z.string().max(40, 'Context is too long').optional(),
      })
    )
    .min(1, 'At least one entry is required')
    .max(60, 'Too many entries (max 60 per request)'),
})

export async function POST(req: NextRequest) {
  try {
    // Translating is part of drafting — accept create OR edit permission
    const auth = await requireAuth()
    if (isResponse(auth)) return auth
    if (!hasPermission(auth, 'einvoices.create') && !hasPermission(auth, 'einvoices.edit')) {
      return forbidden('You do not have permission to translate e-invoice content')
    }

    let raw: unknown
    try {
      raw = await req.json()
    } catch {
      return badRequest('Invalid JSON body')
    }
    const parsed = bodySchema.safeParse(raw)
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? 'Invalid request body')
    }

    const { results, providerError } = await translateEntries(parsed.data.entries)
    return ok({ results, ...(providerError ? { providerError } : {}) })
  } catch (err) {
    console.error('[api/e-invoices/translate POST]', err)
    return serverError()
  }
}

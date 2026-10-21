// Default Terms & Conditions API — GET (read) / PUT (save).
// Single-row default T&C text that auto-fills the Terms box of NEW
// quotations (each quotation keeps its own editable copy).
// GET requires quotations.view; PUT requires quotations.edit.
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import {
  ok,
  badRequest,
  serverError,
  requirePermission,
  isResponse,
  logActivity,
} from '@/lib/api-helpers'

const schema = z.object({
  content: z
    .string()
    .min(1, 'Terms text cannot be empty')
    .max(8000, 'Terms text is too long (max 8000 characters)'),
})

export async function GET() {
  try {
    const auth = await requirePermission('quotations.view')
    if (isResponse(auth)) return auth
    const row = await db.defaultTerms.findFirst()
    return ok({ content: row?.content ?? null })
  } catch (err) {
    console.error('[api/default-terms GET]', err)
    return serverError()
  }
}

export async function PUT(req: NextRequest) {
  try {
    const auth = await requirePermission('quotations.edit')
    if (isResponse(auth)) return auth

    let raw: unknown
    try {
      raw = await req.json()
    } catch {
      return badRequest('Invalid JSON body')
    }
    const parsed = schema.safeParse(raw)
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? 'Invalid request body')
    }

    const row = await db.defaultTerms.findFirst()
    if (row) {
      await db.defaultTerms.update({ where: { id: row.id }, data: { content: parsed.data.content } })
    } else {
      await db.defaultTerms.create({ data: { content: parsed.data.content } })
    }

    await logActivity({
      user: auth,
      action: 'updated',
      module: 'quotation',
      description: 'Default quotation terms & conditions updated',
    })
    return ok({ content: parsed.data.content })
  } catch (err) {
    console.error('[api/default-terms PUT]', err)
    return serverError()
  }
}

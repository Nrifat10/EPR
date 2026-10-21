// Glossary term API — PUT / DELETE /api/glossary/[id]
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import {
  ok,
  badRequest,
  notFound,
  conflict,
  serverError,
  requirePermission,
  isResponse,
  logActivity,
} from '@/lib/api-helpers'

type Ctx = { params: Promise<{ id: string }> }

const termSchema = z.object({
  termEn: z.string().trim().min(1, 'English term is required').max(160, 'English term is too long').optional(),
  termAr: z.string().trim().min(1, 'Arabic translation is required').max(160, 'Arabic translation is too long').optional(),
  notes: z.string().max(500, 'Notes are too long').nullable().optional(),
})

/** Case-insensitive duplicate check (SQLite unique is case-sensitive). */
async function termEnExists(termEn: string, excludeId: string): Promise<boolean> {
  const lower = termEn.toLowerCase()
  const rows = await db.glossaryTerm.findMany({ select: { id: true, termEn: true } })
  return rows.some((r) => r.termEn.trim().toLowerCase() === lower && r.id !== excludeId)
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  try {
    const auth = await requirePermission('settings.edit')
    if (isResponse(auth)) return auth

    const { id } = await ctx.params
    const existing = await db.glossaryTerm.findUnique({ where: { id } })
    if (!existing) return notFound('Glossary term not found')

    let raw: unknown
    try {
      raw = await req.json()
    } catch {
      return badRequest('Invalid JSON body')
    }
    const parsed = termSchema.safeParse(raw)
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? 'Invalid request body')
    }
    const body = parsed.data

    const termEn = body.termEn ?? existing.termEn
    if (termEn !== existing.termEn && (await termEnExists(termEn, id))) {
      return conflict('This English term already exists in the glossary')
    }

    const updated = await db.glossaryTerm.update({
      where: { id },
      data: {
        termEn,
        termAr: body.termAr ?? existing.termAr,
        notes: body.notes === undefined ? existing.notes : body.notes?.trim() || null,
      },
    })

    await logActivity({
      user: auth,
      action: 'updated',
      module: 'glossary',
      description: `Glossary term "${updated.termEn}" updated`,
    })
    return ok({
      id: updated.id,
      termEn: updated.termEn,
      termAr: updated.termAr,
      notes: updated.notes,
      createdAt: updated.createdAt.toISOString(),
    })
  } catch (err) {
    console.error('[api/glossary/[id] PUT]', err)
    return serverError()
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  try {
    const auth = await requirePermission('settings.edit')
    if (isResponse(auth)) return auth

    const { id } = await ctx.params
    const existing = await db.glossaryTerm.findUnique({ where: { id } })
    if (!existing) return notFound('Glossary term not found')

    await db.glossaryTerm.delete({ where: { id } })

    await logActivity({
      user: auth,
      action: 'deleted',
      module: 'glossary',
      description: `Glossary term "${existing.termEn}" deleted`,
    })
    return ok({ deleted: true, id })
  } catch (err) {
    console.error('[api/glossary/[id] DELETE]', err)
    return serverError()
  }
}

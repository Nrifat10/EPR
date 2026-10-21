// Glossary API — GET (list) / POST (create). Fixed EN→AR translations that
// always win over machine translation. Permissions ride the settings module
// (settings.view / settings.edit).
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import {
  ok,
  badRequest,
  conflict,
  serverError,
  requirePermission,
  isResponse,
  logActivity,
} from '@/lib/api-helpers'

export async function GET() {
  try {
    const auth = await requirePermission('settings.view')
    if (isResponse(auth)) return auth

    const rows = await db.glossaryTerm.findMany({ orderBy: { termEn: 'asc' } })
    return ok({
      data: rows.map((r) => ({
        id: r.id,
        termEn: r.termEn,
        termAr: r.termAr,
        notes: r.notes,
        createdAt: r.createdAt.toISOString(),
      })),
    })
  } catch (err) {
    console.error('[api/glossary GET]', err)
    return serverError()
  }
}

const termSchema = z.object({
  termEn: z.string().trim().min(1, 'English term is required').max(160, 'English term is too long'),
  termAr: z.string().trim().min(1, 'Arabic translation is required').max(160, 'Arabic translation is too long'),
  notes: z.string().max(500, 'Notes are too long').nullable().optional(),
})

/** Case-insensitive duplicate check (SQLite unique is case-sensitive). */
async function termEnExists(termEn: string, excludeId?: string): Promise<boolean> {
  const lower = termEn.toLowerCase()
  const rows = await db.glossaryTerm.findMany({ select: { id: true, termEn: true } })
  return rows.some((r) => r.termEn.trim().toLowerCase() === lower && r.id !== excludeId)
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requirePermission('settings.edit')
    if (isResponse(auth)) return auth

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

    if (await termEnExists(body.termEn)) {
      return conflict('This English term already exists in the glossary')
    }

    const created = await db.glossaryTerm.create({
      data: { termEn: body.termEn, termAr: body.termAr, notes: body.notes?.trim() || null },
    })

    await logActivity({
      user: auth,
      action: 'created',
      module: 'glossary',
      description: `Glossary term "${body.termEn}" → "${body.termAr}"`,
    })
    return ok(
      {
        id: created.id,
        termEn: created.termEn,
        termAr: created.termAr,
        notes: created.notes,
        createdAt: created.createdAt.toISOString(),
      },
      201
    )
  } catch (err) {
    console.error('[api/glossary POST]', err)
    return serverError()
  }
}

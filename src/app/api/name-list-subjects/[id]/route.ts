// Name List subject [id] API — PUT (edit custom subject, admin) / DELETE
// (custom subjects only — the 5 system subjects cannot be removed).
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import {
  ok,
  badRequest,
  conflict,
  notFound,
  serverError,
  requirePermission,
  isResponse,
  logActivity,
} from '@/lib/api-helpers'
import { isAdminUser, mapSubject } from '../route'

const updateSchema = z.object({
  name: z.string().min(1).max(40).optional(),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, 'Colour must be a hex value like #2F6FB0')
    .optional(),
  kind: z.enum(['interview', 'mobilization']).optional(),
  sortOrder: z.number().int().min(0).max(999).optional(),
})

type Params = { params: Promise<{ id: string }> }

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const auth = await requirePermission('namelist.view')
    if (isResponse(auth)) return auth
    if (!isAdminUser(auth)) return badRequest('Only Admin can edit Name List subjects.')

    const { id } = await params
    const subject = await db.nameListSubject.findUnique({ where: { id } })
    if (!subject) return notFound('Subject not found')

    let raw: unknown
    try {
      raw = await req.json()
    } catch {
      return badRequest('Invalid JSON body')
    }
    const parsed = updateSchema.safeParse(raw)
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? 'Invalid request body')
    }
    const body = parsed.data

    // Kind drives the workflow + print template — never change it once lists exist.
    const listCount = await db.nameList.count({ where: { subjectId: id } })
    if (body.kind && body.kind !== subject.kind && listCount > 0) {
      return badRequest(
        'This subject already has lists — its template kind cannot be changed. Create a new subject instead.'
      )
    }

    if (body.name && body.name.trim() !== subject.name) {
      const dup = await db.nameListSubject.findUnique({ where: { name: body.name.trim() } })
      if (dup) return conflict(`Subject "${body.name.trim()}" already exists.`)
    }

    const updated = await db.nameListSubject.update({
      where: { id },
      data: {
        ...(body.name ? { name: body.name.trim() } : {}),
        ...(body.color ? { color: body.color.trim() } : {}),
        ...(body.kind ? { kind: body.kind } : {}),
        ...(body.sortOrder != null ? { sortOrder: body.sortOrder } : {}),
      },
    })

    await logActivity({
      user: auth,
      action: 'updated',
      module: 'namelist',
      description: `Name List subject — ${updated.name}`,
    })
    return ok(mapSubject(updated))
  } catch {
    return serverError()
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const auth = await requirePermission('namelist.view')
    if (isResponse(auth)) return auth
    if (!isAdminUser(auth)) return badRequest('Only Admin can delete Name List subjects.')

    const { id } = await params
    const subject = await db.nameListSubject.findUnique({ where: { id } })
    if (!subject) return notFound('Subject not found')
    if (subject.isSystem) {
      return badRequest(`"${subject.name}" is a system subject and cannot be deleted.`)
    }
    const listCount = await db.nameList.count({ where: { subjectId: id } })
    if (listCount > 0) {
      return conflict(`"${subject.name}" is used by ${listCount} list(s) and cannot be deleted.`)
    }

    await db.nameListSubject.delete({ where: { id } })
    await logActivity({
      user: auth,
      action: 'deleted',
      module: 'namelist',
      description: `Name List subject — ${subject.name}`,
    })
    return ok({ deleted: true })
  } catch {
    return serverError()
  }
}

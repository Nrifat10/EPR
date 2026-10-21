// PUT / DELETE /api/staff-categories/[id]
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

const categorySchema = z.object({
  name: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim() : ''),
    z.string().min(1, 'Category name is required')
  ),
  description: z.preprocess(
    (v) => (typeof v === 'string' ? (v.trim() === '' ? null : v.trim()) : v === undefined ? null : v),
    z.string().nullable()
  ),
})

async function findDuplicateName(name: string, excludeId: string): Promise<boolean> {
  const all = await db.staffCategory.findMany({ select: { id: true, name: true } })
  const lower = name.toLowerCase()
  return all.some((c) => c.name.toLowerCase() === lower && c.id !== excludeId)
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requirePermission('staff.edit')
    if (isResponse(auth)) return auth
    const { id } = await params

    const existing = await db.staffCategory.findUnique({ where: { id } })
    if (!existing) return notFound('Category not found')

    let json: unknown = null
    try {
      json = await req.json()
    } catch {
      json = null
    }
    const parsed = categorySchema.safeParse(json)
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? 'Invalid request data')
    }
    const { name, description } = parsed.data

    if (await findDuplicateName(name, id)) {
      return conflict('A category with this name already exists')
    }

    const updated = await db.staffCategory.update({ where: { id }, data: { name, description } })

    await logActivity({
      user: auth,
      action: 'updated',
      module: 'staff_category',
      description: `Updated staff category: ${updated.name}`,
    })

    return ok({ id: updated.id, name: updated.name, description: updated.description })
  } catch (err) {
    console.error('[api/staff-categories/[id] PUT]', err)
    return serverError()
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requirePermission('staff.delete')
    if (isResponse(auth)) return auth
    const { id } = await params

    const existing = await db.staffCategory.findUnique({ where: { id } })
    if (!existing) return notFound('Category not found')

    const staffCount = await db.staff.count({ where: { staffCategoryId: id, deletedAt: null } })
    if (staffCount > 0) {
      return conflict(
        `Cannot delete: category is assigned to ${staffCount} staff members. Reassign them first.`
      )
    }

    await db.staffCategory.delete({ where: { id } })

    await logActivity({
      user: auth,
      action: 'deleted',
      module: 'staff_category',
      description: `Deleted staff category: ${existing.name}`,
    })

    return ok({ success: true })
  } catch (err) {
    console.error('[api/staff-categories/[id] DELETE]', err)
    return serverError()
  }
}

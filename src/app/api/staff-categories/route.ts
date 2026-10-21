// GET /api/staff-categories (all, no pagination) + POST (create)
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import {
  ok,
  badRequest,
  conflict,
  serverError,
  requireAuth,
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

async function findDuplicateName(name: string, excludeId?: string): Promise<boolean> {
  const all = await db.staffCategory.findMany({ select: { id: true, name: true } })
  const lower = name.toLowerCase()
  return all.some((c) => c.name.toLowerCase() === lower && c.id !== excludeId)
}

export async function GET() {
  try {
    const auth = await requireAuth()
    if (isResponse(auth)) return auth

    // staffCount must only count non-deleted staff → groupBy with where (Prisma _count can't filter)
    const [categories, grouped] = await Promise.all([
      db.staffCategory.findMany({ orderBy: { name: 'asc' } }),
      db.staff.groupBy({
        by: ['staffCategoryId'],
        where: { deletedAt: null },
        _count: { _all: true },
      }),
    ])
    const counts = new Map(grouped.map((g) => [g.staffCategoryId, g._count._all]))

    const data = categories.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      staffCount: counts.get(c.id) ?? 0,
    }))
    return ok({ data })
  } catch (err) {
    console.error('[api/staff-categories GET]', err)
    return serverError()
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requirePermission('staff.create')
    if (isResponse(auth)) return auth

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

    if (await findDuplicateName(name)) {
      return conflict('A category with this name already exists')
    }

    const category = await db.staffCategory.create({ data: { name, description } })

    await logActivity({
      user: auth,
      action: 'created',
      module: 'staff_category',
      description: `Created staff category: ${category.name}`,
    })

    return ok({ id: category.id, name: category.name, description: category.description, staffCount: 0 }, 201)
  } catch (err) {
    console.error('[api/staff-categories POST]', err)
    return serverError()
  }
}

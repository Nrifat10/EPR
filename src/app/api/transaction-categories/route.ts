// Transaction categories API — GET (full list + usage counts) / POST (create)
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import type { TransactionCategoryRow, TransactionType } from '@/lib/types'
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
  name: z.string().min(1, 'Name is required'),
  type: z.enum(['income', 'expense']),
})

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth()
    if (isResponse(auth)) return auth

    const type = req.nextUrl.searchParams.get('type')
    const where =
      type === 'income' || type === 'expense' ? { type } : {}

    const [categories, grouped] = await Promise.all([
      db.transactionCategory.findMany({
        where,
        orderBy: [{ type: 'asc' }, { name: 'asc' }],
      }),
      db.transaction.groupBy({
        by: ['transactionCategoryId'],
        _count: { _all: true },
      }),
    ])

    const counts = new Map(
      grouped.map((g) => [g.transactionCategoryId, g._count._all])
    )
    const data: TransactionCategoryRow[] = categories.map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type as TransactionType,
      transactionCount: counts.get(c.id) ?? 0,
    }))
    return ok({ data })
  } catch {
    return serverError()
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requirePermission('accounts.create')
    if (isResponse(auth)) return auth

    let raw: unknown
    try {
      raw = await req.json()
    } catch {
      return badRequest('Invalid JSON body')
    }
    const parsed = categorySchema.safeParse(raw)
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? 'Invalid request body')
    }

    const name = parsed.data.name.trim()
    if (!name) return badRequest('Name is required')

    const sameType = await db.transactionCategory.findMany({
      where: { type: parsed.data.type },
      select: { name: true },
    })
    if (sameType.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      return conflict('Category already exists')
    }

    const created = await db.transactionCategory.create({
      data: { name, type: parsed.data.type },
    })
    await logActivity({
      user: auth,
      action: 'created',
      module: 'transaction_category',
      description: `Category created: ${name}`,
    })
    return ok(
      {
        id: created.id,
        name: created.name,
        type: created.type as TransactionType,
        transactionCount: 0,
      },
      201
    )
  } catch {
    return serverError()
  }
}

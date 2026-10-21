// Transaction category [id] API — PUT / DELETE
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

const categorySchema = z.object({
  name: z.string().min(1, 'Name is required'),
  type: z.enum(['income', 'expense']),
})

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requirePermission('accounts.edit')
    if (isResponse(auth)) return auth

    const { id } = await params
    const existing = await db.transactionCategory.findUnique({ where: { id } })
    if (!existing) return notFound('Category not found')

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
      select: { id: true, name: true },
    })
    if (
      sameType.some(
        (c) => c.id !== id && c.name.toLowerCase() === name.toLowerCase()
      )
    ) {
      return conflict('Category already exists')
    }

    const updated = await db.transactionCategory.update({
      where: { id },
      data: { name, type: parsed.data.type },
    })
    await logActivity({
      user: auth,
      action: 'updated',
      module: 'transaction_category',
      description: `Category updated: ${name}`,
    })
    return ok({
      id: updated.id,
      name: updated.name,
      type: updated.type,
      transactionCount: await db.transaction.count({
        where: { transactionCategoryId: id },
      }),
    })
  } catch {
    return serverError()
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requirePermission('accounts.delete')
    if (isResponse(auth)) return auth

    const { id } = await params
    const existing = await db.transactionCategory.findUnique({ where: { id } })
    if (!existing) return notFound('Category not found')

    const usage = await db.transaction.count({
      where: { transactionCategoryId: id },
    })
    if (usage > 0) {
      return conflict(`Cannot delete: category is used by ${usage} transactions.`)
    }

    await db.transactionCategory.delete({ where: { id } })
    await logActivity({
      user: auth,
      action: 'deleted',
      module: 'transaction_category',
      description: `Category deleted: ${existing.name}`,
    })
    return ok({ success: true })
  } catch {
    return serverError()
  }
}

// Supplier P.O. API — GET / PUT / DELETE a single purchase order.
// GET returns the full document (items sorted by sr) for the edit dialog and
// the A4 print preview. PUT replaces ALL items in a transaction and recomputes
// every money figure server-side.
import { NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { db } from '@/lib/db'
import { round2 } from '@/lib/format'
import {
  ok,
  badRequest,
  conflict,
  notFound,
  serverError,
  requirePermission,
  isResponse,
  parseDate,
  logActivity,
} from '@/lib/api-helpers'
import { mapPo, poInclude } from '../mappers'

const PO_STATUSES = ['draft', 'ordered', 'received', 'cancelled'] as const

const itemSchema = z.object({
  description: z.string().min(1, 'Item description is required').max(500, 'Item description is too long'),
  unit: z.string().nullable().optional(),
  quantity: z.coerce
    .number()
    .positive('Quantity must be greater than 0')
    .max(1_000_000, 'Quantity is too large'),
  unitPrice: z.coerce
    .number()
    .min(0, 'Unit price cannot be negative')
    .max(1_000_000_000, 'Unit price is too large'),
})

const poUpdateSchema = z.object({
  poNumber: z.string().min(1).max(40).optional(), // normally not edited (auto-generated)
  supplierName: z.string().min(1, 'Supplier name is required').max(160, 'Supplier name is too long'),
  supplierPhone: z.string().nullable().optional(),
  attention: z.string().nullable().optional(),
  issueDate: z.string().min(1, 'Issue date is required'),
  expectedDate: z.string().nullable().optional(),
  status: z.enum(PO_STATUSES),
  vatRate: z.coerce
    .number()
    .min(0, 'VAT rate cannot be negative')
    .max(1, 'VAT rate must be a fraction (e.g. 0.15 for 15%)')
    .optional(),
  notes: z.string().nullable().optional(),
  items: z.array(itemSchema).min(1, 'At least one line item is required').max(200, 'Too many line items'),
})

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const auth = await requirePermission('supplierpo.view')
    if (isResponse(auth)) return auth
    const { id } = await params

    const po = await db.supplierPo.findUnique({
      where: { id },
      include: { ...poInclude, items: true },
    })
    if (!po) return notFound('Supplier P.O. not found')
    return ok(mapPo(po, true))
  } catch (err) {
    console.error('[api/supplier-pos/[id] GET]', err)
    return serverError()
  }
}

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const auth = await requirePermission('supplierpo.edit')
    if (isResponse(auth)) return auth
    const { id } = await params

    const existing = await db.supplierPo.findUnique({ where: { id } })
    if (!existing) return notFound('Supplier P.O. not found')

    let raw: unknown
    try {
      raw = await req.json()
    } catch {
      return badRequest('Invalid JSON body')
    }
    const parsed = poUpdateSchema.safeParse(raw)
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? 'Invalid request body')
    }
    const body = parsed.data

    const issueDate = parseDate(body.issueDate)
    if (!issueDate) return badRequest('Invalid issue date')

    const expectedDate = parseDate(body.expectedDate)
    if (body.expectedDate && !expectedDate) return badRequest('Invalid expected date')

    const supplierName = body.supplierName.trim()
    if (!supplierName) return badRequest('Supplier name is required')

    // Server-side math — line totals, subtotal, VAT, total
    const items = body.items.map((it, i) => {
      const quantity = round2(it.quantity)
      const unitPrice = round2(it.unitPrice)
      return {
        sr: i + 1,
        description: it.description.trim(),
        unit: it.unit?.trim() || null,
        quantity,
        unitPrice,
        lineTotal: round2(quantity * unitPrice),
      }
    })
    const vatRate = body.vatRate ?? 0.15
    const subtotal = round2(items.reduce((sum, it) => sum + it.lineTotal, 0))
    const vatAmount = round2(subtotal * vatRate)
    const total = round2(subtotal + vatAmount)

    // Optional manual PO-number override — uniqueness checked excluding self
    const poNumber = body.poNumber?.trim()
    if (poNumber && poNumber !== existing.poNumber) {
      const duplicate = await db.supplierPo.findUnique({
        where: { poNumber },
        select: { id: true },
      })
      if (duplicate && duplicate.id !== id) {
        return conflict(`P.O. number "${poNumber}" is already used by another purchase order — P.O. numbers must be unique.`)
      }
    }

    // Full replace: items are deleted and recreated in the same transaction
    const updated = await db.$transaction(async (tx) => {
      await tx.supplierPoItem.deleteMany({ where: { poId: id } })
      return tx.supplierPo.update({
        where: { id },
        data: {
          ...(poNumber ? { poNumber } : {}),
          supplierName,
          supplierPhone: body.supplierPhone?.trim() || null,
          attention: body.attention?.trim() || null,
          issueDate,
          expectedDate,
          status: body.status,
          subtotal,
          vatRate,
          vatAmount,
          total,
          notes: body.notes?.trim() || null,
          items: { create: items },
        },
        include: { ...poInclude, items: true },
      })
    })

    await logActivity({
      user: auth,
      action: 'updated',
      module: 'supplier_po',
      description: `Supplier P.O. ${updated.poNumber} — ${supplierName}`,
      amount: total,
    })
    return ok(mapPo(updated, true))
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return conflict('P.O. number already exists — P.O. numbers must be unique')
    }
    console.error('[api/supplier-pos/[id] PUT]', e)
    return serverError()
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const auth = await requirePermission('supplierpo.delete')
    if (isResponse(auth)) return auth
    const { id } = await params

    const existing = await db.supplierPo.findUnique({ where: { id } })
    if (!existing) return notFound('Supplier P.O. not found')

    // Items cascade via FK onDelete: Cascade
    await db.supplierPo.delete({ where: { id } })

    await logActivity({
      user: auth,
      action: 'deleted',
      module: 'supplier_po',
      description: `Supplier P.O. ${existing.poNumber} — ${existing.supplierName}`,
      amount: round2(existing.total),
    })
    return ok({ deleted: true })
  } catch (err) {
    console.error('[api/supplier-pos/[id] DELETE]', err)
    return serverError()
  }
}

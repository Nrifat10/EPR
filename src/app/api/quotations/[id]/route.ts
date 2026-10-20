// Quotation API — GET / PUT / DELETE a single quotation.
// GET returns the full document (items sorted by sr + linked client details)
// for the edit dialog and the A4 print preview. PUT replaces ALL items in a
// transaction and recomputes every money figure server-side.
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
import { mapQuotation, quoteInclude } from '../mappers'

const QUOTE_STATUSES = ['draft', 'sent', 'accepted', 'rejected', 'expired'] as const

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

const quotationUpdateSchema = z.object({
  quoteNumber: z.string().min(1).max(40).optional(), // normally not edited (auto-generated)
  clientId: z.string().trim().nullable().optional(),
  clientName: z.string().min(1, 'Client name is required').max(160, 'Client name is too long'),
  subject: z.string().nullable().optional(),
  issueDate: z.string().min(1, 'Issue date is required'),
  validityDate: z.string().nullable().optional(),
  status: z.enum(QUOTE_STATUSES),
  discount: z.coerce
    .number()
    .min(0, 'Discount cannot be negative')
    .max(1_000_000_000, 'Discount is too large')
    .optional(),
  vatRate: z.coerce
    .number()
    .min(0, 'VAT rate cannot be negative')
    .max(1, 'VAT rate must be a fraction (e.g. 0.15 for 15%)')
    .optional(),
  notes: z.string().nullable().optional(),
  terms: z.string().nullable().optional(),
  items: z.array(itemSchema).min(1, 'At least one line item is required').max(200, 'Too many line items'),
})

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const auth = await requirePermission('quotations.view')
    if (isResponse(auth)) return auth
    const { id } = await params

    const quotation = await db.quotation.findUnique({
      where: { id },
      include: { ...quoteInclude, items: true },
    })
    if (!quotation) return notFound('Quotation not found')
    return ok(mapQuotation(quotation, true))
  } catch (err) {
    console.error('[api/quotations/[id] GET]', err)
    return serverError()
  }
}

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const auth = await requirePermission('quotations.edit')
    if (isResponse(auth)) return auth
    const { id } = await params

    const existing = await db.quotation.findUnique({ where: { id } })
    if (!existing) return notFound('Quotation not found')

    let raw: unknown
    try {
      raw = await req.json()
    } catch {
      return badRequest('Invalid JSON body')
    }
    const parsed = quotationUpdateSchema.safeParse(raw)
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? 'Invalid request body')
    }
    const body = parsed.data

    const issueDate = parseDate(body.issueDate)
    if (!issueDate) return badRequest('Invalid issue date')

    const validityDate = parseDate(body.validityDate)
    if (body.validityDate && !validityDate) return badRequest('Invalid validity date')

    // Linked client (optional) — keeps the clientName snapshot in sync
    let clientId: string | null = null
    let clientName = body.clientName.trim()
    if (body.clientId) {
      const client = await db.client.findUnique({
        where: { id: body.clientId },
        select: { id: true, name: true },
      })
      if (!client) return badRequest('Selected client was not found')
      clientId = client.id
      clientName = client.name
    }
    if (!clientName) return badRequest('Client name is required')

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
    const discount = round2(body.discount ?? 0)
    const vatRate = body.vatRate ?? 0.15
    const subtotal = round2(items.reduce((sum, it) => sum + it.lineTotal, 0))
    if (discount > subtotal) {
      return badRequest('Discount cannot be greater than the subtotal')
    }
    const vatAmount = round2((subtotal - discount) * vatRate)
    const total = round2(subtotal - discount + vatAmount)

    // Optional manual quote-number override — uniqueness checked excluding self
    const quoteNumber = body.quoteNumber?.trim()
    if (quoteNumber && quoteNumber !== existing.quoteNumber) {
      const duplicate = await db.quotation.findUnique({
        where: { quoteNumber },
        select: { id: true },
      })
      if (duplicate && duplicate.id !== id) {
        return conflict(`Quote number "${quoteNumber}" is already used by another quotation — quote numbers must be unique.`)
      }
    }

    // Full replace: items are deleted and recreated in the same transaction
    const updated = await db.$transaction(async (tx) => {
      await tx.quotationItem.deleteMany({ where: { quotationId: id } })
      return tx.quotation.update({
        where: { id },
        data: {
          ...(quoteNumber ? { quoteNumber } : {}),
          clientId,
          clientName,
          subject: body.subject?.trim() || null,
          issueDate,
          validityDate,
          status: body.status,
          subtotal,
          discount,
          vatRate,
          vatAmount,
          total,
          notes: body.notes?.trim() || null,
          terms: body.terms?.trim() || null,
          items: { create: items },
        },
        include: { ...quoteInclude, items: true },
      })
    })

    await logActivity({
      user: auth,
      action: 'updated',
      module: 'quotation',
      description: `Quotation ${updated.quoteNumber} — ${clientName}`,
      amount: total,
    })
    return ok(mapQuotation(updated, true))
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return conflict('Quote number already exists — quote numbers must be unique')
    }
    console.error('[api/quotations/[id] PUT]', e)
    return serverError()
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const auth = await requirePermission('quotations.delete')
    if (isResponse(auth)) return auth
    const { id } = await params

    const existing = await db.quotation.findUnique({ where: { id } })
    if (!existing) return notFound('Quotation not found')

    // Items cascade via FK onDelete: Cascade
    await db.quotation.delete({ where: { id } })

    await logActivity({
      user: auth,
      action: 'deleted',
      module: 'quotation',
      description: `Quotation ${existing.quoteNumber} — ${existing.clientName}`,
      amount: round2(existing.total),
    })
    return ok({ deleted: true })
  } catch (err) {
    console.error('[api/quotations/[id] DELETE]', err)
    return serverError()
  }
}

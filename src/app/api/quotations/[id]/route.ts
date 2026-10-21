// Quotation API — GET / PUT / DELETE a single quotation.
// GET returns the full document (items sorted by sr, assets, linked client
// details) for the edit dialog and the A4 print preview. PUT replaces ALL
// items and assets in a transaction and recomputes every money figure
// server-side.
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
import {
  mapQuotation,
  quoteInclude,
  QUOTE_STATUSES,
  itemSchema,
  assetSchema,
  normalizeAssets,
  normalizeItems,
  computeTotals,
} from '../mappers'

const quotationUpdateSchema = z.object({
  quoteNumber: z.string().min(1).max(40).optional(), // normally not edited (auto-generated)
  clientId: z.string().trim().nullable().optional(),
  clientName: z.string().min(1, 'Client name is required').max(160, 'Client name is too long'),
  subject: z.string().nullable().optional(),
  referenceNo: z.string().max(80, 'Reference number is too long').nullable().optional(),
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
  // ---- quotation template fields (boss's design) ----
  projectName: z.string().max(200, 'Project name is too long').nullable().optional(),
  projectLocation: z.string().max(200, 'Project location is too long').nullable().optional(),
  contractPeriod: z.string().max(60, 'Contract period text is too long').nullable().optional(),
  contractMonths: z.coerce.number().int().min(0).max(600, 'Contract months cannot exceed 600').nullable().optional(),
  mobilization: z.string().max(120, 'Mobilization text is too long').nullable().optional(),
  inclusions: z.string().max(4000, 'Inclusions text is too long').nullable().optional(),
  exclusions: z.string().max(4000, 'Exclusions text is too long').nullable().optional(),
  items: z.array(itemSchema).min(1, 'At least one line item is required').max(200, 'Too many line items'),
  assets: z.array(assetSchema).max(4, 'Too many assets').optional(),
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

    const { items, error: itemError } = normalizeItems(body.items)
    if (itemError || !items) return badRequest(itemError ?? 'Invalid line items')

    const { assets, error: assetError } = normalizeAssets(body.assets ?? [])
    if (assetError || !assets) return badRequest(assetError ?? 'Invalid signature/stamp assets')

    const discount = round2(body.discount ?? 0)
    const vatRate = body.vatRate ?? 0.15
    const { subtotal, vatAmount, total } = computeTotals(items, discount, vatRate)
    if (discount > subtotal) {
      return badRequest('Discount cannot be greater than the subtotal')
    }

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

    // Full replace: items and assets are deleted and recreated in the same transaction
    const updated = await db.$transaction(async (tx) => {
      await tx.quotationItem.deleteMany({ where: { quotationId: id } })
      await tx.quotationAsset.deleteMany({ where: { quotationId: id } })
      return tx.quotation.update({
        where: { id },
        data: {
          ...(quoteNumber ? { quoteNumber } : {}),
          clientId,
          clientName,
          subject: body.subject?.trim() || null,
          referenceNo: body.referenceNo?.trim() || null,
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
          projectName: body.projectName?.trim() || null,
          projectLocation: body.projectLocation?.trim() || null,
          contractPeriod: body.contractPeriod?.trim() || null,
          contractMonths: body.contractMonths ?? null,
          mobilization: body.mobilization?.trim() || null,
          inclusions: body.inclusions?.trim() || null,
          exclusions: body.exclusions?.trim() || null,
          items: { create: items },
          assets: assets.length ? { create: assets } : undefined,
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

    // Items + assets cascade via FK onDelete: Cascade
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

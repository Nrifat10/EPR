// Quotations API — GET (paginated list + totals + year options) / POST (create).
// Business document: quote numbers are auto-generated (QTN-YYYY-NNNN) and every
// money figure (line totals, subtotal, VAT, total) is recomputed SERVER-side
// from the items — the client's math is only a live preview, never trusted.
// Filters: ?search (quote no / client / subject) ?status ?year ?page ?pageSize
import { NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { db } from '@/lib/db'
import { round2 } from '@/lib/format'
import {
  ok,
  badRequest,
  conflict,
  serverError,
  requirePermission,
  isResponse,
  parsePagination,
  parseDate,
  logActivity,
} from '@/lib/api-helpers'
import { mapQuotation, quoteInclude } from './mappers'

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

const quotationSchema = z.object({
  clientId: z.string().trim().nullable().optional(),
  clientName: z.string().min(1, 'Client name is required').max(160, 'Client name is too long'),
  subject: z.string().nullable().optional(),
  issueDate: z.string().min(1, 'Issue date is required'),
  validityDate: z.string().nullable().optional(),
  status: z.enum(QUOTE_STATUSES).optional(),
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

/** Server-side math — single source of truth for every money figure. */
function computeTotals(
  items: { lineTotal: number }[],
  discount: number,
  vatRate: number
) {
  const subtotal = round2(items.reduce((sum, it) => sum + it.lineTotal, 0))
  const vatAmount = round2((subtotal - discount) * vatRate)
  const total = round2(subtotal - discount + vatAmount)
  return { subtotal, vatAmount, total }
}

function normalizeItems(raw: z.infer<typeof itemSchema>[]) {
  return raw.map((it, i) => {
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
}

/** Next quote number for a year: QTN-YYYY-NNNN (max existing + 1). */
async function nextQuoteNumber(tx: Prisma.TransactionClient, year: number): Promise<string> {
  const prefix = `QTN-${year}-`
  const existing = await tx.quotation.findMany({
    where: { quoteNumber: { startsWith: prefix } },
    select: { quoteNumber: true },
  })
  let max = 0
  for (const row of existing) {
    const n = parseInt(row.quoteNumber.slice(prefix.length), 10)
    if (Number.isInteger(n) && n > max) max = n
  }
  return `${prefix}${String(max + 1).padStart(4, '0')}`
}

/** Distinct issue-date years present in the table (for the year filter). */
async function quotationYears(): Promise<number[]> {
  const rows = await db.$queryRaw<{ y: string }[]>(
    Prisma.sql`SELECT DISTINCT strftime('%Y', issueDate) AS y FROM Quotation ORDER BY y DESC`
  )
  return rows.map((r) => Number(r.y)).filter((y) => Number.isInteger(y) && y >= 1900 && y <= 2200)
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requirePermission('quotations.view')
    if (isResponse(auth)) return auth

    const sp = req.nextUrl.searchParams
    const p = parsePagination(sp)
    const where: Prisma.QuotationWhereInput = {}

    // Free-text search across quote number, client name and subject
    const search = sp.get('search')?.trim()
    if (search) {
      where.OR = [
        { quoteNumber: { contains: search } },
        { clientName: { contains: search } },
        { subject: { contains: search } },
      ]
    }

    // Status filter
    const status = sp.get('status')?.trim()
    if (status && (QUOTE_STATUSES as readonly string[]).includes(status)) {
      where.status = status
    }

    // Year filter (issue date within the calendar year)
    const year = parseInt(sp.get('year') ?? '', 10)
    if (Number.isInteger(year) && year >= 1900 && year <= 2200) {
      where.issueDate = {
        gte: new Date(year, 0, 1, 0, 0, 0, 0),
        lte: new Date(year, 11, 31, 23, 59, 59, 999),
      }
    }

    const [rows, total, statusRows, years] = await Promise.all([
      db.quotation.findMany({
        where,
        orderBy: [{ issueDate: 'desc' }, { createdAt: 'desc' }],
        skip: p.skip,
        take: p.take,
        include: quoteInclude,
      }),
      db.quotation.count({ where }),
      db.quotation.groupBy({ by: ['status'], where, _count: true, _sum: { total: true } }),
      quotationYears(),
    ])

    // Totals for the stat cards (respect the active filters)
    let count = 0
    let totalValue = 0
    let acceptedValue = 0
    let acceptedCount = 0
    let pendingCount = 0
    let pendingValue = 0
    for (const row of statusRows) {
      const c = row._count
      const v = round2(row._sum.total ?? 0)
      count += c
      totalValue = round2(totalValue + v)
      if (row.status === 'accepted') {
        acceptedCount += c
        acceptedValue = round2(acceptedValue + v)
      } else if (row.status === 'draft' || row.status === 'sent') {
        pendingCount += c
        pendingValue = round2(pendingValue + v)
      }
    }

    return ok({
      data: rows.map((q) => mapQuotation(q)),
      page: p.page,
      pageSize: p.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / p.pageSize)),
      totals: { count, totalValue, acceptedValue, acceptedCount, pendingCount, pendingValue },
      years,
    })
  } catch (err) {
    console.error('[api/quotations GET]', err)
    return serverError()
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requirePermission('quotations.create')
    if (isResponse(auth)) return auth

    let raw: unknown
    try {
      raw = await req.json()
    } catch {
      return badRequest('Invalid JSON body')
    }
    const parsed = quotationSchema.safeParse(raw)
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

    const items = normalizeItems(body.items)
    const discount = round2(body.discount ?? 0)
    const vatRate = body.vatRate ?? 0.15
    const { subtotal, vatAmount, total } = computeTotals(items, discount, vatRate)
    if (discount > subtotal) {
      return badRequest('Discount cannot be greater than the subtotal')
    }

    const year = issueDate.getFullYear()
    const created = await db.$transaction(async (tx) => {
      const quoteNumber = await nextQuoteNumber(tx, year)
      return tx.quotation.create({
        data: {
          quoteNumber,
          clientId,
          clientName,
          subject: body.subject?.trim() || null,
          issueDate,
          validityDate,
          status: body.status ?? 'draft',
          subtotal,
          discount,
          vatRate,
          vatAmount,
          total,
          notes: body.notes?.trim() || null,
          terms: body.terms?.trim() || null,
          createdByName: auth.name,
          items: { create: items },
        },
        include: { ...quoteInclude, items: true },
      })
    })

    await logActivity({
      user: auth,
      action: 'created',
      module: 'quotation',
      description: `Quotation ${created.quoteNumber} — ${clientName}`,
      amount: total,
    })
    return ok(mapQuotation(created, true), 201)
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return conflict('Quote number already exists — quote numbers must be unique')
    }
    console.error('[api/quotations POST]', e)
    return serverError()
  }
}

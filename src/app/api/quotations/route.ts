// Quotations API — GET (paginated list + totals + year options) / POST (create).
// Business document: quote numbers are auto-generated ({PREFIX}-YYYY-NNNN,
// prefix editable per request, default QTN) and every money figure (line
// totals, subtotal, VAT, total) is recomputed SERVER-side from the items —
// the client's math is only a live preview, never trusted.
// Signature/stamp assets are validated (PNG/JPEG ≤ 2 MB) and stored with
// percent-of-A4 positions so print/PDF match the on-screen placement exactly.
// Filters: ?search (quote no / client / subject / reference) ?status ?year ?page ?pageSize
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
import {
  mapQuotation,
  quoteInclude,
  QUOTE_STATUSES,
  itemSchema,
  assetSchema,
  normalizeAssets,
  normalizeItems,
  computeTotals,
  nextQuoteNumber,
} from './mappers'

const quotationSchema = z.object({
  clientId: z.string().trim().nullable().optional(),
  clientName: z.string().min(1, 'Client name is required').max(160, 'Client name is too long'),
  subject: z.string().nullable().optional(),
  referenceNo: z.string().max(80, 'Reference number is too long').nullable().optional(),
  issueDate: z.string().min(1, 'Issue date is required'),
  validityDate: z.string().nullable().optional(),
  status: z.enum(QUOTE_STATUSES).optional(),
  // Editable quote-number prefix (e.g. QTN, QT, EST) — 1–8 letters/digits
  numberPrefix: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9]{1,8}$/, 'Prefix must be 1–8 letters or digits')
    .optional(),
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

    // Free-text search across quote number, client name, subject and reference
    const search = sp.get('search')?.trim()
    if (search) {
      where.OR = [
        { quoteNumber: { contains: search } },
        { clientName: { contains: search } },
        { subject: { contains: search } },
        { referenceNo: { contains: search } },
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

    const year = issueDate.getFullYear()
    const prefix = (body.numberPrefix ?? 'QTN').toUpperCase()
    const created = await db.$transaction(async (tx) => {
      const quoteNumber = await nextQuoteNumber(tx, year, prefix)
      return tx.quotation.create({
        data: {
          quoteNumber,
          clientId,
          clientName,
          subject: body.subject?.trim() || null,
          referenceNo: body.referenceNo?.trim() || null,
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
          projectName: body.projectName?.trim() || null,
          projectLocation: body.projectLocation?.trim() || null,
          contractPeriod: body.contractPeriod?.trim() || null,
          contractMonths: body.contractMonths ?? null,
          mobilization: body.mobilization?.trim() || null,
          inclusions: body.inclusions?.trim() || null,
          exclusions: body.exclusions?.trim() || null,
          createdByName: auth.name,
          items: { create: items },
          assets: assets.length ? { create: assets } : undefined,
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

// Supplier P.O. API — GET (paginated list + totals + year options) / POST (create).
// Manpower purchase orders sent TO suppliers: po numbers auto-generated
// (MPO-YYYY-NNNN) and every money figure (line totals, subtotal, VAT, total)
// is recomputed SERVER-side from the items — the client's math is only a
// live preview.
//   • manpower mode (hoursPerMonth set, e.g. 260):
//       AMOUNT = No. of Workers × Hourly Rate × hours/month
//   • direct mode (hoursPerMonth null): AMOUNT = Qty × Unit Price
// Filters: ?search (po no / supplier / attention) ?status ?year ?page ?pageSize
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
import { mapPo, poInclude, resolveSupplierLink } from './mappers'

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

const poSchema = z.object({
  supplierName: z.string().min(1, 'Supplier name is required').max(160, 'Supplier name is too long'),
  supplierId: z.string().nullable().optional(), // link to the saved suppliers directory
  saveSupplier: z.boolean().optional(), // "save this supplier for future P.O.s"
  supplierPhone: z.string().nullable().optional(),
  attention: z.string().nullable().optional(),
  issueDate: z.string().min(1, 'Issue date is required'),
  expectedDate: z.string().nullable().optional(),
  status: z.enum(PO_STATUSES).optional(),
  quotationRef: z.string().nullable().optional(),
  paymentTerms: z.string().nullable().optional(),
  workSite: z.string().nullable().optional(),
  startDate: z.string().nullable().optional(),
  durationMonths: z.coerce.number().int().min(1).max(600).nullable().optional(),
  workingHours: z.string().nullable().optional(),
  hoursPerMonth: z.coerce.number().int().min(1).max(744).nullable().optional(),
  supplierAddress: z.string().nullable().optional(),
  supplierVat: z.string().nullable().optional(),
  supplierCr: z.string().nullable().optional(),
  vatRate: z.coerce
    .number()
    .min(0, 'VAT rate cannot be negative')
    .max(1, 'VAT rate must be a fraction (e.g. 0.15 for 15%)')
    .optional(),
  notes: z.string().nullable().optional(),
  items: z.array(itemSchema).min(1, 'At least one line item is required').max(200, 'Too many line items'),
})

/** Next PO number for a year: MPO-YYYY-NNNN (max existing + 1). */
async function nextPoNumber(tx: Prisma.TransactionClient, year: number): Promise<string> {
  const prefix = `MPO-${year}-`
  const existing = await tx.supplierPo.findMany({
    where: { poNumber: { startsWith: prefix } },
    select: { poNumber: true },
  })
  let max = 0
  for (const row of existing) {
    const n = parseInt(row.poNumber.slice(prefix.length), 10)
    if (Number.isInteger(n) && n > max) max = n
  }
  return `${prefix}${String(max + 1).padStart(4, '0')}`
}

/** Distinct issue-date years present in the table (for the year filter). */
async function poYears(): Promise<number[]> {
  const rows = await db.$queryRaw<{ y: string }[]>(
    Prisma.sql`SELECT DISTINCT strftime('%Y', issueDate) AS y FROM SupplierPo ORDER BY y DESC`
  )
  return rows.map((r) => Number(r.y)).filter((y) => Number.isInteger(y) && y >= 1900 && y <= 2200)
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requirePermission('supplierpo.view')
    if (isResponse(auth)) return auth

    const sp = req.nextUrl.searchParams
    const p = parsePagination(sp)
    const where: Prisma.SupplierPoWhereInput = {}

    // Free-text search across PO number, supplier name and attention
    const search = sp.get('search')?.trim()
    if (search) {
      where.OR = [
        { poNumber: { contains: search } },
        { supplierName: { contains: search } },
        { attention: { contains: search } },
      ]
    }

    // Status filter
    const status = sp.get('status')?.trim()
    if (status && (PO_STATUSES as readonly string[]).includes(status)) {
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
      db.supplierPo.findMany({
        where,
        orderBy: [{ issueDate: 'desc' }, { createdAt: 'desc' }],
        skip: p.skip,
        take: p.take,
        include: poInclude,
      }),
      db.supplierPo.count({ where }),
      db.supplierPo.groupBy({ by: ['status'], where, _count: true, _sum: { total: true } }),
      poYears(),
    ])

    // Totals for the stat cards (respect the active filters)
    let count = 0
    let totalValue = 0
    let receivedValue = 0
    let receivedCount = 0
    let openCount = 0
    let openValue = 0
    for (const row of statusRows) {
      const c = row._count
      const v = round2(row._sum.total ?? 0)
      count += c
      totalValue = round2(totalValue + v)
      if (row.status === 'received') {
        receivedCount += c
        receivedValue = round2(receivedValue + v)
      } else if (row.status === 'draft' || row.status === 'ordered') {
        openCount += c
        openValue = round2(openValue + v)
      }
    }

    return ok({
      data: rows.map((p) => mapPo(p)),
      page: p.page,
      pageSize: p.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / p.pageSize)),
      totals: { count, totalValue, receivedValue, receivedCount, openCount, openValue },
      years,
    })
  } catch (err) {
    console.error('[api/supplier-pos GET]', err)
    return serverError()
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requirePermission('supplierpo.create')
    if (isResponse(auth)) return auth

    let raw: unknown
    try {
      raw = await req.json()
    } catch {
      return badRequest('Invalid JSON body')
    }
    const parsed = poSchema.safeParse(raw)
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? 'Invalid request body')
    }
    const body = parsed.data

    const issueDate = parseDate(body.issueDate)
    if (!issueDate) return badRequest('Invalid issue date')

    const expectedDate = parseDate(body.expectedDate)
    if (body.expectedDate && !expectedDate) return badRequest('Invalid expected date')

    const startDate = parseDate(body.startDate)
    if (body.startDate && !startDate) return badRequest('Invalid start date')

    const supplierName = body.supplierName.trim()
    if (!supplierName) return badRequest('Supplier name is required')

    // Server-side math — line totals, subtotal, VAT, total.
    // Manpower mode: AMOUNT = workers × hourly rate × hours/month.
    const hoursPerMonth = body.hoursPerMonth ?? null
    const items = body.items.map((it, i) => {
      const quantity = round2(it.quantity)
      const unitPrice = round2(it.unitPrice)
      return {
        sr: i + 1,
        description: it.description.trim(),
        unit: it.unit?.trim() || null,
        quantity,
        unitPrice,
        lineTotal: round2(quantity * unitPrice * (hoursPerMonth ?? 1)),
      }
    })
    const vatRate = body.vatRate ?? 0.15
    const subtotal = round2(items.reduce((sum, it) => sum + it.lineTotal, 0))
    const vatAmount = round2(subtotal * vatRate)
    const total = round2(subtotal + vatAmount)

    const year = issueDate.getFullYear()
    const created = await db.$transaction(async (tx) => {
      const poNumber = await nextPoNumber(tx, year)
      // saved-supplier directory link (explicit pick or find-or-create)
      const supplierId = await resolveSupplierLink(tx, {
        supplierId: body.supplierId ?? null,
        saveSupplier: body.saveSupplier,
        name: supplierName,
        phone: body.supplierPhone?.trim() || null,
        attention: body.attention?.trim() || null,
        address: body.supplierAddress?.trim() || null,
        vat: body.supplierVat?.trim() || null,
        cr: body.supplierCr?.trim() || null,
        createdByName: auth.name,
      })
      return tx.supplierPo.create({
        data: {
          poNumber,
          supplierId,
          supplierName,
          supplierPhone: body.supplierPhone?.trim() || null,
          attention: body.attention?.trim() || null,
          issueDate,
          expectedDate,
          status: body.status ?? 'draft',
          quotationRef: body.quotationRef?.trim() || null,
          paymentTerms: body.paymentTerms?.trim() || null,
          workSite: body.workSite?.trim() || null,
          startDate,
          durationMonths: body.durationMonths ?? null,
          workingHours: body.workingHours?.trim() || null,
          hoursPerMonth,
          supplierAddress: body.supplierAddress?.trim() || null,
          supplierVat: body.supplierVat?.trim() || null,
          supplierCr: body.supplierCr?.trim() || null,
          subtotal,
          vatRate,
          vatAmount,
          total,
          notes: body.notes?.trim() || null,
          createdByName: auth.name,
          items: { create: items },
        },
        include: { ...poInclude, items: true },
      })
    })

    await logActivity({
      user: auth,
      action: 'created',
      module: 'supplier_po',
      description: `Supplier P.O. ${created.poNumber} — ${supplierName}`,
      amount: total,
    })
    return ok(mapPo(created, true), 201)
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return conflict('P.O. number already exists — P.O. numbers must be unique')
    }
    console.error('[api/supplier-pos POST]', e)
    return serverError()
  }
}

// VAT Return Expense bills API — GET (paginated list + totals) / POST (create).
// Records every supplier bill that carries VAT so the input VAT can be claimed
// in the quarterly VAT return. The user types ONLY amountWithVat — the
// withoutVat/vatAmount breakdown is computed here, never trusted from a client.
// Filters: ?search (bill no / supplier / description) ?month ?year ?quarter
//          ?from ?to (yyyy-mm-dd date range)
import { NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { db } from '@/lib/db'
import { round2 } from '@/lib/format'
import { getVatRate, splitVat } from '@/lib/vat'
import type { VatBillRow } from '@/lib/types'
import {
  ok,
  badRequest,
  conflict,
  serverError,
  requirePermission,
  isResponse,
  parsePagination,
  paginatedResponse,
  parseDate,
  toInt,
  logActivity,
} from '@/lib/api-helpers'

const billInclude = {
  createdBy: { select: { id: true, name: true } },
} satisfies Prisma.VatExpenseBillInclude

type BillWithRelations = Prisma.VatExpenseBillGetPayload<{ include: typeof billInclude }>

function mapBill(b: BillWithRelations): VatBillRow {
  return {
    id: b.id,
    billDate: b.billDate.toISOString(),
    billNumber: b.billNumber,
    supplierName: b.supplierName,
    supplierVatNumber: b.supplierVatNumber,
    description: b.description,
    amountWithVat: round2(b.amountWithVat),
    amountWithoutVat: round2(b.amountWithoutVat),
    vatAmount: round2(b.vatAmount),
    vatRateSnapshot: b.vatRateSnapshot,
    createdBy: b.createdBy ? { id: b.createdBy.id, name: b.createdBy.name } : null,
    createdAt: b.createdAt.toISOString(),
  }
}

function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999)
}

/** Month range covered by a quarter (1-4) of a year. */
function quarterRange(year: number, quarter: number): { start: Date; end: Date } {
  const startMonth = (quarter - 1) * 3 // 0-based
  return {
    start: new Date(year, startMonth, 1, 0, 0, 0, 0),
    end: endOfDay(new Date(year, startMonth + 2, 1)),
  }
}

const billSchema = z.object({
  billDate: z.string().min(1, 'Bill date is required'),
  billNumber: z.string().min(1, 'Bill number is required'),
  supplierName: z.string().nullable().optional(),
  supplierVatNumber: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  amountWithVat: z.coerce
    .number()
    .positive('Amount must be greater than 0')
    .max(1_000_000_000, 'Amount is too large'),
})

export async function GET(req: NextRequest) {
  try {
    const auth = await requirePermission('vat.view')
    if (isResponse(auth)) return auth

    const sp = req.nextUrl.searchParams
    const p = parsePagination(sp)
    const where: Prisma.VatExpenseBillWhereInput = {}

    // Free-text search across bill number, supplier and description
    const search = sp.get('search')?.trim()
    if (search) {
      where.OR = [
        { billNumber: { contains: search } },
        { supplierName: { contains: search } },
        { supplierVatNumber: { contains: search } },
        { description: { contains: search } },
      ]
    }

    // Period filters: explicit month+year, or a quarter of a year, or a date range
    const month = toInt(sp.get('month'))
    const year = toInt(sp.get('year'))
    const quarter = toInt(sp.get('quarter'))
    const from = parseDate(sp.get('from'))
    const to = parseDate(sp.get('to'))
    const hasMonth = Number.isInteger(month) && month >= 1 && month <= 12
    const hasYear = Number.isInteger(year) && year >= 1900 && year <= 2200
    const hasQuarter = Number.isInteger(quarter) && quarter >= 1 && quarter <= 4

    if (from || to) {
      where.billDate = {
        ...(from ? { gte: from } : {}),
        ...(to ? { lte: endOfDay(to) } : {}),
      }
    } else if (hasQuarter && hasYear) {
      const q = quarterRange(year, quarter)
      where.billDate = { gte: q.start, lte: q.end }
    } else if (hasMonth && hasYear) {
      where.billDate = {
        gte: new Date(year, month - 1, 1, 0, 0, 0, 0),
        lte: endOfDay(new Date(year, month, 1)),
      }
    } else if (hasYear) {
      where.billDate = {
        gte: new Date(year, 0, 1, 0, 0, 0, 0),
        lte: endOfDay(new Date(year, 11, 31)),
      }
    }
    // month without year is ambiguous — ignored

    const [rows, total, agg] = await Promise.all([
      db.vatExpenseBill.findMany({
        where,
        orderBy: [{ billDate: 'desc' }, { createdAt: 'desc' }],
        skip: p.skip,
        take: p.take,
        include: billInclude,
      }),
      db.vatExpenseBill.count({ where }),
      db.vatExpenseBill.aggregate({
        where,
        _count: { _all: true },
        _sum: {
          amountWithVat: true,
          amountWithoutVat: true,
          vatAmount: true,
        },
      }),
    ])

    return paginatedResponse(rows.map(mapBill), total, p, {
      count: agg._count._all,
      withVat: round2(agg._sum.amountWithVat ?? 0),
      withoutVat: round2(agg._sum.amountWithoutVat ?? 0),
      vat: round2(agg._sum.vatAmount ?? 0),
    })
  } catch {
    return serverError()
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requirePermission('vat.create')
    if (isResponse(auth)) return auth

    let raw: unknown
    try {
      raw = await req.json()
    } catch {
      return badRequest('Invalid JSON body')
    }
    const parsed = billSchema.safeParse(raw)
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? 'Invalid request body')
    }
    const body = parsed.data

    const billDate = parseDate(body.billDate)
    if (!billDate) return badRequest('Invalid bill date')

    const billNumber = body.billNumber.trim()
    if (!billNumber) return badRequest('Bill number is required')

    // Uniqueness check with a friendly, field-level error message
    const duplicate = await db.vatExpenseBill.findUnique({
      where: { billNumber },
      select: { id: true, billDate: true },
    })
    if (duplicate) {
      return conflict(
        `Bill number "${billNumber}" already exists (dated ${duplicate.billDate.toISOString().slice(0, 10)}) — bill numbers must be unique.`
      )
    }

    // Server-side auto-calculation from the configured VAT rate
    const vatRate = await getVatRate()
    const amountWithVat = round2(body.amountWithVat)
    const { amountWithoutVat, vatAmount } = splitVat(amountWithVat, vatRate)

    const created = await db.vatExpenseBill.create({
      data: {
        billDate,
        billNumber,
        supplierName: body.supplierName?.trim() || null,
        supplierVatNumber: body.supplierVatNumber?.trim() || null,
        description: body.description?.trim() || null,
        amountWithVat,
        amountWithoutVat,
        vatAmount,
        vatRateSnapshot: vatRate,
        createdById: auth.id,
      },
      include: billInclude,
    })

    await logActivity({
      user: auth,
      action: 'created',
      module: 'vat_return',
      description: `VAT bill ${billNumber}${body.supplierName ? ` — ${body.supplierName.trim()}` : ''}`,
      amount: vatAmount,
    })
    return ok(mapBill(created), 201)
  } catch (e) {
    // Prisma unique-constraint race → same friendly 409
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return conflict('Bill number already exists — bill numbers must be unique')
    }
    return serverError()
  }
}

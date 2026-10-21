// E-Invoices API — GET (paginated list + totals + year options) / POST (create).
// Bilingual ZATCA-style tax invoices / credit notes / debit notes.
// Conventions mirror /api/quotations: numbers auto-generated server-side
// (INV/CRN/DBN-YYYY-00001), ALL money recomputed server-side, status starts
// as 'draft', overdue is DERIVED (dueDate < today AND issued/partially_paid
// AND paid < total). Linked-client Arabic fields are auto-copied both ways.
// Filters: ?search ?status (incl. overdue) ?clientId ?dateFrom ?dateTo ?year
//          ?page ?pageSize
import { NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'
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
import { nextEInvoiceNumber, computeInvoiceTotals } from '@/lib/e-invoice'
import {
  mapEInvoice,
  eInvoiceListInclude,
  eInvoiceSchema,
  normalizeEItems,
  overdueWhere,
  backfillClientArabic,
  EINVOICE_FILTER_STATUSES,
} from './mappers'

/**
 * Distinct issue-date years present in the table (for the year filter).
 * Uses Prisma (not strftime — this database stores DateTime as ms-epoch
 * integers, which SQLite date functions cannot read directly).
 */
async function eInvoiceYears(): Promise<number[]> {
  const rows = await db.eInvoice.findMany({
    distinct: ['issueDate'],
    select: { issueDate: true },
  })
  const years = new Set<number>()
  for (const r of rows) {
    const y = r.issueDate.getFullYear()
    if (y >= 1900 && y <= 2200) years.add(y)
  }
  return [...years].sort((a, b) => b - a)
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requirePermission('einvoices.view')
    if (isResponse(auth)) return auth

    const sp = req.nextUrl.searchParams
    const p = parsePagination(sp)
    const where: Prisma.EInvoiceWhereInput = {}

    // Free-text search across number, client name (EN/AR), project (EN/AR), P.O.
    const search = sp.get('search')?.trim()
    if (search) {
      where.OR = [
        { invoiceNumber: { contains: search } },
        { clientNameEn: { contains: search } },
        { clientNameAr: { contains: search } },
        { projectEn: { contains: search } },
        { projectAr: { contains: search } },
        { poRef: { contains: search } },
      ]
    }

    // Status filter — 'overdue' is DERIVED (past due + open + underpaid)
    const status = sp.get('status')?.trim()
    if (status && (EINVOICE_FILTER_STATUSES as readonly string[]).includes(status)) {
      if (status === 'overdue') {
        Object.assign(where, overdueWhere())
      } else {
        where.status = status
      }
    }

    const clientId = sp.get('clientId')?.trim()
    if (clientId) where.clientId = clientId

    // ZATCA phase filter: 1 = Generation, 2 = Integration (per-invoice designation)
    const phase = parseInt(sp.get('zatcaPhase') ?? '', 10)
    if (phase === 1 || phase === 2) where.zatcaPhase = phase

    // Issue-date range filters (dateFrom/dateTo) or calendar-year filter
    const dateFrom = parseDate(sp.get('dateFrom'))
    const dateTo = parseDate(sp.get('dateTo'))
    const year = parseInt(sp.get('year') ?? '', 10)
    if (dateFrom || dateTo) {
      where.issueDate = {
        ...(dateFrom ? { gte: dateFrom } : {}),
        ...(dateTo ? { lte: new Date(dateTo.getFullYear(), dateTo.getMonth(), dateTo.getDate(), 23, 59, 59, 999) } : {}),
      }
    } else if (Number.isInteger(year) && year >= 1900 && year <= 2200) {
      where.issueDate = {
        gte: new Date(year, 0, 1, 0, 0, 0, 0),
        lte: new Date(year, 11, 31, 23, 59, 59, 999),
      }
    }

    const [rows, totalCount, agg, overdueAgg, years] = await Promise.all([
      db.eInvoice.findMany({
        where,
        orderBy: [{ issueDate: 'desc' }, { createdAt: 'desc' }],
        skip: p.skip,
        take: p.take,
        include: eInvoiceListInclude,
      }),
      db.eInvoice.count({ where }),
      db.eInvoice.aggregate({
        where,
        _count: true,
        _sum: { totalDue: true, paidAmount: true },
      }),
      db.eInvoice.aggregate({
        where: { ...where, ...overdueWhere() },
        _count: true,
        _sum: { totalDue: true, paidAmount: true },
      }),
      eInvoiceYears(),
    ])

    const totalDue = round2(agg._sum.totalDue ?? 0)
    const paid = round2(agg._sum.paidAmount ?? 0)
    const overdueTotalDue = round2(overdueAgg._sum.totalDue ?? 0)
    const overduePaid = round2(overdueAgg._sum.paidAmount ?? 0)

    return ok({
      rows: rows.map((r) => mapEInvoice(r)),
      totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / p.pageSize)),
      page: p.page,
      pageSize: p.pageSize,
      totals: {
        count: agg._count,
        totalDue,
        paid,
        outstanding: round2(totalDue - paid),
        overdueCount: overdueAgg._count,
        overdueAmount: round2(overdueTotalDue - overduePaid),
      },
      years,
    })
  } catch (err) {
    console.error('[api/e-invoices GET]', err)
    return serverError()
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requirePermission('einvoices.create')
    if (isResponse(auth)) return auth

    let raw: unknown
    try {
      raw = await req.json()
    } catch {
      return badRequest('Invalid JSON body')
    }
    const parsed = eInvoiceSchema.safeParse(raw)
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? 'Invalid request body')
    }
    const body = parsed.data

    const issueDate = parseDate(body.issueDate)
    if (!issueDate) return badRequest('Invalid issue date')
    const supplyDate = parseDate(body.supplyDate)
    if (body.supplyDate && !supplyDate) return badRequest('Invalid supply date')
    const dueDate = parseDate(body.dueDate)
    if (body.dueDate && !dueDate) return badRequest('Invalid due date')

    const docType = body.docType ?? 'invoice'

    // Linked client (optional) — copy the client's Arabic fields into the
    // invoice when the request did not provide Arabic values itself.
    let clientId: string | null = null
    let clientNameAr = body.clientNameAr ?? ''
    let clientAddressAr = body.clientAddressAr ?? null
    if (body.clientId) {
      const client = await db.client.findUnique({
        where: { id: body.clientId },
        select: { id: true, nameAr: true, addressAr: true },
      })
      if (!client) return badRequest('Selected client was not found')
      clientId = client.id
      if (!clientNameAr.trim() && client.nameAr) clientNameAr = client.nameAr
      if (!clientAddressAr?.trim() && client.addressAr) clientAddressAr = client.addressAr
    }

    // Credit/Debit notes reference an ISSUED invoice
    let relatedInvoiceId: string | null = null
    if (docType !== 'invoice' && body.relatedInvoiceId) {
      const related = await db.eInvoice.findUnique({
        where: { id: body.relatedInvoiceId },
        select: { id: true, status: true, invoiceNumber: true },
      })
      if (!related) return badRequest('Related invoice was not found')
      if (related.status === 'draft') {
        return badRequest('Related invoice must be issued before it can be corrected by a note')
      }
      relatedInvoiceId = related.id
    }

    const { items, error: itemError } = normalizeEItems(body.items)
    if (itemError || !items) return badRequest(itemError ?? 'Invalid line items')

    // Server-side math — single source of truth for every money figure
    const totals = computeInvoiceTotals(items)

    const created = await db.$transaction(async (tx) => {
      const invoiceNumber = await nextEInvoiceNumber(docType, issueDate, tx)
      return tx.eInvoice.create({
        data: {
          invoiceNumber,
          docType,
          clientId,
          clientNameEn: body.clientNameEn.trim(),
          clientNameAr: clientNameAr.trim(),
          clientVatNumber: body.clientVatNumber?.trim() || null,
          clientCrNumber: body.clientCrNumber?.trim() || null,
          clientAddressEn: body.clientAddressEn?.trim() || null,
          clientAddressAr: clientAddressAr?.trim() || null,
          poRef: body.poRef?.trim() || null,
          contractRef: body.contractRef?.trim() || null,
          projectEn: body.projectEn?.trim() || null,
          projectAr: body.projectAr?.trim() || null,
          paymentTermsEn: body.paymentTermsEn?.trim() || null,
          paymentTermsAr: body.paymentTermsAr?.trim() || null,
          paymentMethodEn: body.paymentMethodEn?.trim() || null,
          paymentMethodAr: body.paymentMethodAr?.trim() || null,
          issueDate,
          supplyDate,
          dueDate,
          status: 'draft',
          subtotal: totals.subtotal,
          totalDiscount: totals.totalDiscount,
          taxableAmount: totals.taxableAmount,
          vatAmount: totals.vatAmount,
          totalDue: totals.totalDue,
          notesEn: body.notesEn?.trim() || null,
          notesAr: body.notesAr?.trim() || null,
          arManualFlags: JSON.stringify(body.arManualFlags ?? []),
          showReceiverSignature: body.showReceiverSignature ?? true,
          zatcaPhase: body.zatcaPhase ?? 1,
          relatedInvoiceId,
          items: { create: items },
        },
        include: { items: { orderBy: { sr: 'asc' } } },
      })
    })

    // Persist invoice Arabic onto the client record for future reuse
    if (clientId) {
      await backfillClientArabic(clientId, created.clientNameAr, created.clientAddressAr)
    }

    await logActivity({
      user: auth,
      action: 'created',
      module: 'einvoice',
      description: `E-Invoice ${created.invoiceNumber} — ${created.clientNameEn}`,
      amount: totals.totalDue,
    })
    // surface the related invoice number for note types in the response row
    const relatedNumber = relatedInvoiceId ? (await db.eInvoice.findUnique({
      where: { id: relatedInvoiceId },
      select: { invoiceNumber: true },
    }))?.invoiceNumber ?? null : null
    return ok(mapEInvoice({ ...created, relatedInvoice: relatedNumber ? { invoiceNumber: relatedNumber } : null }), 201)
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return conflict('Invoice number already exists — invoice numbers must be unique')
    }
    console.error('[api/e-invoices POST]', e)
    return serverError()
  }
}

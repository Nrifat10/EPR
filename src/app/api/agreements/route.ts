// Agreements API — GET (paginated list + totals) / POST (create).
// A contract/agreement manager with two layout styles:
//   • detailed — priced line items; the contract value is ALWAYS recomputed
//     server-side as Σ round2(quantity × unitPrice),
//   • simple   — a single "price as per Purchase Order" value entered by the
//     user (items are ignored / stored empty).
// Children (items, installments, clauses) are created inside one transaction
// with deterministic `sr` ordering. refNumber is auto-generated AGR-YYYY-NNNN
// from the agreement's start-date year.
// Filters: ?search (ref / title / client) ?status ?type ?year (start-date year)
import { NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { round2 } from '@/lib/format'
import {
  ok,
  badRequest,
  serverError,
  requirePermission,
  isResponse,
  parsePagination,
  paginatedResponse,
  parseDate,
  toInt,
  logActivity,
} from '@/lib/api-helpers'
import {
  agreementBodySchema,
  agreementFullInclude,
  mapAgreement,
  normalizeAgreementChildren,
  validateAgreementBody,
  nextRefNumber,
  type AgreementFull,
} from '@/lib/agreement-server'

// ---------------------------------------------------------------------------
// GET — list with filters + totals
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  try {
    const auth = await requirePermission('agreements.view')
    if (isResponse(auth)) return auth

    const sp = req.nextUrl.searchParams
    const p = parsePagination(sp)
    const where: Prisma.AgreementWhereInput = {}

    // Free-text search across ref number, title and client (party B)
    const search = sp.get('search')?.trim()
    if (search) {
      where.OR = [
        { refNumber: { contains: search } },
        { title: { contains: search } },
        { clientName: { contains: search } },
      ]
    }

    const status = sp.get('status')?.trim()
    if (status) where.status = status

    const type = sp.get('type')?.trim()
    if (type) where.type = type

    // Year filter — the agreement's START date falls within that year
    const year = toInt(sp.get('year'))
    if (Number.isInteger(year) && year >= 1900 && year <= 2200) {
      where.startDate = {
        gte: new Date(year, 0, 1, 0, 0, 0, 0),
        lte: new Date(year, 11, 31, 23, 59, 59, 999),
      }
    }

    const now = new Date()
    // KPI wheres are composed with AND so the base filters (incl. the search
    // OR) are never clobbered by the spread keys below.
    const signedWhere: Prisma.AgreementWhereInput = { AND: [where, { status: 'signed' }] }
    const activeWhere: Prisma.AgreementWhereInput = {
      AND: [where, { status: 'signed' }, { OR: [{ endDate: null }, { endDate: { gte: now } }] }],
    }
    const [rows, total, agg, signedAgg, signedCount, activeCount] = await Promise.all([
      db.agreement.findMany({
        where,
        orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
        skip: p.skip,
        take: p.take,
      }),
      db.agreement.count({ where }),
      db.agreement.aggregate({ where, _count: { _all: true }, _sum: { value: true } }),
      db.agreement.aggregate({ where: signedWhere, _sum: { value: true } }),
      db.agreement.count({ where: signedWhere }),
      db.agreement.count({ where: activeWhere }),
    ])

    return paginatedResponse(rows.map(mapAgreement), total, p, {
      count: agg._count._all,
      totalValue: round2(agg._sum.value ?? 0),
      signedValue: round2(signedAgg._sum.value ?? 0),
      signedCount,
      active: activeCount,
    })
  } catch {
    return serverError()
  }
}

// ---------------------------------------------------------------------------
// POST — create with children in one transaction
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  try {
    const auth = await requirePermission('agreements.create')
    if (isResponse(auth)) return auth

    let raw: unknown
    try {
      raw = await req.json()
    } catch {
      return badRequest('Invalid JSON body')
    }
    const parsed = agreementBodySchema.safeParse(raw)
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? 'Invalid request body')
    }
    const body = parsed.data

    const startDate = parseDate(body.startDate)
    if (!startDate) return badRequest('Invalid start date')
    const endDate = parseDate(body.endDate ?? undefined)

    const validationError = validateAgreementBody(body, startDate, endDate)
    if (validationError) return badRequest(validationError)

    let clientId: string | null = null
    if (body.clientId) {
      const client = await db.client.findUnique({
        where: { id: body.clientId },
        select: { id: true },
      })
      if (!client) return badRequest('Selected client no longer exists')
      clientId = client.id
    }

    const normalized = normalizeAgreementChildren(body)

    // The AGR-YYYY-NNNN sequence is allocated inside the transaction; retry a
    // couple of times if a concurrent insert wins the same reference (P2002).
    let created: AgreementFull | null = null
    for (let attempt = 0; attempt < 3 && !created; attempt++) {
      try {
        created = await db.$transaction(async (tx) => {
          const refNumber = await nextRefNumber(tx, startDate.getFullYear())
          return tx.agreement.create({
            data: {
              refNumber,
              title: body.title.trim(),
              partyA: 'Landmark Inter Gulf LLC',
              clientId,
              clientName: body.clientName.trim(),
              type: body.type ?? 'labor_supply',
              layoutStyle: body.layoutStyle ?? 'detailed',
              startDate,
              endDate,
              status: body.status ?? 'draft',
              value: normalized.value,
              currency: 'SAR',
              notes: body.notes?.trim() || null,
              createdByName: auth.name,
              items: { create: normalized.items },
              installments: { create: normalized.installments },
              clauses: { create: normalized.clauses },
            },
            include: agreementFullInclude,
          })
        })
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') continue
        throw e
      }
    }
    if (!created) return serverError('Could not allocate an agreement reference — try again')

    await logActivity({
      user: auth,
      action: 'created',
      module: 'agreement',
      description: `Agreement ${created.refNumber} — ${created.title} (${created.clientName})`,
      amount: created.value,
    })
    return ok(mapAgreement(created), 201)
  } catch {
    return serverError()
  }
}

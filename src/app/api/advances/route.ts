// Worker advances API — list (filters + totals) & create (with linked expense entry)
import { NextRequest } from 'next/server'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
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
  logActivity,
  parseDate,
  toInt,
} from '@/lib/api-helpers'
import { serializeAdvance, getOrCreateAdvanceExpenseCategory } from '@/lib/advance-service'
import { advanceStatusOf } from '@/lib/advances'

const STAFF_INCLUDE = {
  id: true,
  fullName: true,
  iqamaId: true,
  position: true,
} as const

/** Shared filter builder: search (name/IQAMA/reference), staff, month+year, status, project. */
function buildWhere(searchParams: URLSearchParams): Prisma.WorkerAdvanceWhereInput {
  const search = searchParams.get('search')?.trim() ?? ''
  const staffId = searchParams.get('staffId')?.trim() ?? ''
  const month = toInt(searchParams.get('month'), 0)
  const year = toInt(searchParams.get('year'), 0)
  const status = searchParams.get('status')?.trim() ?? ''
  const projectId = searchParams.get('projectId')?.trim() ?? ''

  const conditions: Prisma.WorkerAdvanceWhereInput[] = []
  if (staffId) conditions.push({ staff: { id: staffId } })
  if (projectId) conditions.push({ staff: { projects: { some: { projectId } } } })
  if (search) {
    // search matches worker name, IQAMA or the advance reference
    conditions.push({
      OR: [
        { staff: { OR: [{ fullName: { contains: search } }, { iqamaId: { contains: search } }] } },
        { reference: { contains: search } },
      ],
    })
  }
  if (month >= 1 && month <= 12) conditions.push({ deductionMonth: month })
  if (year > 0) conditions.push({ deductionYear: year })
  if (['pending', 'partially_deducted', 'deducted'].includes(status)) {
    conditions.push({ status })
  }

  return conditions.length ? { AND: conditions } : {}
}

// GET /api/advances?search&staffId&month&year&status&projectId&page&pageSize
export async function GET(req: NextRequest) {
  try {
    const user = await requirePermission('advances.view')
    if (isResponse(user)) return user

    const { searchParams } = new URL(req.url)
    const where = buildWhere(searchParams)
    const p = parsePagination(searchParams)

    const [total, rows, aggRows, lockedRows] = await Promise.all([
      db.workerAdvance.count({ where }),
      db.workerAdvance.findMany({
        where,
        include: { staff: { select: STAFF_INCLUDE } },
        orderBy: [{ deductionYear: 'desc' }, { deductionMonth: 'desc' }, { createdAt: 'desc' }],
        skip: p.skip,
        take: p.take,
      }),
      db.workerAdvance.findMany({ where, select: { amount: true, deductedAmount: true } }),
      db.payrollAdvanceDeduction.findMany({
        where: { payroll: { status: 'paid' } },
        select: { advanceId: true },
      }),
    ])

    const given = round2(aggRows.reduce((s, a) => s + a.amount, 0))
    const deducted = round2(aggRows.reduce((s, a) => s + a.deductedAmount, 0))
    const lockedIds = new Set(lockedRows.map((r) => r.advanceId))

    return paginatedResponse(
      rows.map((r) => ({ ...serializeAdvance(r), locked: lockedIds.has(r.id) })),
      total,
      p,
      {
        count: total,
        given,
        deducted,
        outstanding: round2(given - deducted),
      }
    )
  } catch {
    return serverError()
  }
}

const advanceBodySchema = z.object({
  staffId: z.string().min(1, 'Worker is required'),
  amount: z.coerce.number().positive('Amount must be greater than zero'),
  givenDate: z.string().min(1, 'Advance date is required'),
  paymentMethod: z.enum(['cash', 'bank_transfer']).default('cash'),
  reference: z.string().nullable().optional(),
  deductionMonth: z.coerce.number().int().min(1, 'Month must be between 1 and 12').max(12, 'Month must be between 1 and 12'),
  deductionYear: z.coerce.number().int().min(1900, 'Year is out of range').max(2200, 'Year is out of range'),
  installments: z.coerce.number().int().min(1, 'Installments must be at least 1').max(60, 'Installments cannot exceed 60 months').default(1),
})

// POST /api/advances — creates the advance + its "Advance to Workers" expense entry
export async function POST(req: NextRequest) {
  try {
    const user = await requirePermission('advances.create')
    if (isResponse(user)) return user

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return badRequest('Invalid JSON body')
    }

    const parsed = advanceBodySchema.safeParse(body)
    if (!parsed.success) {
      const first = parsed.error.issues[0]
      return badRequest(first ? `${first.path.join('.') || 'body'}: ${first.message}` : 'Invalid request body')
    }
    const input = parsed.data

    const staff = await db.staff.findFirst({
      where: { id: input.staffId, deletedAt: null },
      select: { id: true, fullName: true },
    })
    if (!staff) return badRequest('Worker not found')

    const givenDate = parseDate(input.givenDate)
    if (!givenDate) return badRequest('A valid advance date is required')

    const reference = input.reference?.trim() ? input.reference.trim() : null

    const created = await db.$transaction(async (tx) => {
      // Accounting: advance payout = expense under "Advance to Workers"
      const category = await getOrCreateAdvanceExpenseCategory(tx)
      const transaction = await tx.transaction.create({
        data: {
          type: 'expense',
          title: `Advance Payment: ${staff.fullName}`,
          amount: round2(input.amount),
          transactionCategoryId: category.id,
          operatorUserId: user.id,
          transactionDate: givenDate,
          description: `Worker advance — deduction starts ${input.deductionMonth}/${input.deductionYear}${
            reference ? ` — ${reference}` : ''
          }`,
        },
      })

      return tx.workerAdvance.create({
        data: {
          staffId: input.staffId,
          amount: round2(input.amount),
          givenDate,
          paymentMethod: input.paymentMethod,
          reference,
          deductionMonth: input.deductionMonth,
          deductionYear: input.deductionYear,
          installments: input.installments,
          deductedAmount: 0,
          status: advanceStatusOf(input.amount, 0),
          transactionId: transaction.id,
          createdById: user.id,
        },
        include: { staff: { select: STAFF_INCLUDE } },
      })
    })

    await logActivity({
      user,
      module: 'advance',
      action: 'created',
      description: `Advance given: ${staff.fullName} — SAR ${round2(input.amount).toLocaleString('en-US')} (deduction ${input.deductionMonth}/${input.deductionYear})`,
      amount: round2(input.amount),
    })

    return ok(serializeAdvance(created), 201)
  } catch {
    return serverError()
  }
}

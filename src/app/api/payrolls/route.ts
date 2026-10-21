// Payrolls API — list (with filter totals) + create (server-side recalc, linked expense on paid)
import { NextRequest } from 'next/server'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { calcPayroll } from '@/lib/payroll'
import { round2 } from '@/lib/format'
import {
  ok,
  badRequest,
  conflict,
  serverError,
  requirePermission,
  isResponse,
  parsePagination,
  paginatedResponse,
  logActivity,
  toInt,
  parseDate,
} from '@/lib/api-helpers'
import {
  syncPayrollAdvanceDeductions,
  otherDeductionsOf,
} from '@/lib/advance-service'

const PAYROLL_INCLUDE = {
  staff: {
    select: {
      id: true,
      fullName: true,
      iqamaId: true,
      staffCategory: { select: { id: true, name: true } },
    },
  },
  project: { select: { id: true, name: true, client: { select: { name: true } } } },
} satisfies Prisma.PayrollInclude

/** Flatten the nested client relation to `project.clientName` for the client side. */
function serializePayroll<T extends { project: { id: string; name: string; client: { name: string } | null } | null }>(row: T) {
  return {
    ...row,
    project: row.project ? { ...row.project, clientName: row.project.client?.name ?? null } : null,
  }
}

const DUPLICATE_MESSAGE =
  'A payroll record already exists for this staff member, project and month.'

const payrollBodySchema = z.object({
  staffId: z.string().min(1, 'Staff member is required'),
  projectId: z.string().min(1, 'Project not found').nullable().optional(),
  month: z.coerce.number().int('Month must be a whole number').min(1, 'Month must be between 1 and 12').max(12, 'Month must be between 1 and 12'),
  year: z.coerce.number().int('Year must be a whole number').min(1900, 'Year is out of range').max(2200, 'Year is out of range'),
  totalHours: z.coerce.number().min(0, 'Total hours cannot be negative'),
  hourlyRate: z.coerce.number().min(0, 'Hourly rate cannot be negative'),
  overtimeHours: z.coerce.number().min(0, 'Overtime hours cannot be negative').default(0),
  overtimeRate: z.coerce.number().min(0, 'Overtime rate cannot be negative').default(0),
  otherEarnings: z.coerce.number().min(0, 'Other earnings cannot be negative').default(0),
  advance: z.coerce.number().min(0, 'Advance cannot be negative').default(0),
  absentPenalty: z.coerce.number().min(0, 'Absent penalty cannot be negative').default(0),
  ptAmount: z.coerce.number().min(0, 'PT amount cannot be negative').default(0),
  unionFees: z.coerce.number().min(0, 'Union fees cannot be negative').default(0),
  otherDeductionValue: z.coerce.number().min(0, 'Other deduction cannot be negative').default(0),
  otherDeductionType: z.enum(['fixed', 'percent']).default('fixed'),
  // Client billing rates (optional — the Client Salary Summary owns these;
  // when omitted, POST prefills clientRate from the project's default rate)
  clientRate: z.coerce.number().min(0).max(100000).optional(),
  clientOtRate: z.coerce.number().min(0).max(100000).optional(),
  status: z.enum(['pending', 'paid']).default('pending'),
  payDate: z.string().nullable().optional(),
  payType: z.enum(['bank_transfer', 'cash', 'cheque']).default('bank_transfer'),
  taxCode: z.string().nullable().optional(),
})

/** Shared filter builder for the payroll list (search/client/project/category/month/year/status). */
function buildWhere(searchParams: URLSearchParams): Prisma.PayrollWhereInput {
  const search = searchParams.get('search')?.trim() ?? ''
  const clientId = searchParams.get('clientId')?.trim() ?? ''
  const projectId = searchParams.get('projectId')?.trim() ?? ''
  const categoryId = searchParams.get('categoryId')?.trim() ?? ''
  const month = toInt(searchParams.get('month'), 0)
  const year = toInt(searchParams.get('year'), 0)
  const status = searchParams.get('status')?.trim() ?? ''

  const staffConditions: Prisma.StaffWhereInput[] = []
  if (search) {
    staffConditions.push({
      OR: [{ fullName: { contains: search } }, { iqamaId: { contains: search } }],
    })
  }
  if (categoryId) staffConditions.push({ staffCategoryId: categoryId })

  // Project conditions — a client filter narrows to that client's projects;
  // when both are given, clientId wins the scoping and projectId refines it.
  const projectConditions: Prisma.ProjectWhereInput[] = []
  if (clientId) projectConditions.push({ clientId })
  if (projectId) projectConditions.push({ id: projectId })

  return {
    ...(staffConditions.length ? { staff: { AND: staffConditions } } : {}),
    ...(projectConditions.length ? { project: { AND: projectConditions } } : {}),
    ...(month >= 1 && month <= 12 ? { month } : {}),
    ...(year > 0 ? { year } : {}),
    ...(status === 'pending' || status === 'paid' ? { status } : {}),
  }
}

// GET /api/payrolls?search&clientId&projectId&categoryId&month&year&status&page&pageSize
export async function GET(req: NextRequest) {
  try {
    const user = await requirePermission('payroll.view')
    if (isResponse(user)) return user

    const { searchParams } = new URL(req.url)
    const where = buildWhere(searchParams)
    const p = parsePagination(searchParams)

    const [total, agg, rows] = await Promise.all([
      db.payroll.count({ where }),
      db.payroll.aggregate({
        where,
        _sum: { grossPay: true, totalDeductions: true, netPay: true },
      }),
      db.payroll.findMany({
        where,
        include: PAYROLL_INCLUDE,
        orderBy: [{ year: 'desc' }, { month: 'desc' }, { staff: { fullName: 'asc' } }],
        skip: p.skip,
        take: p.take,
      }),
    ])

    return paginatedResponse(rows.map(serializePayroll), total, p, {
      gross: round2(agg._sum.grossPay ?? 0),
      deductions: round2(agg._sum.totalDeductions ?? 0),
      net: round2(agg._sum.netPay ?? 0),
    })
  } catch {
    return serverError()
  }
}

// POST /api/payrolls — server ALWAYS recalculates via calcPayroll (client totals never trusted)
export async function POST(req: NextRequest) {
  try {
    const user = await requirePermission('payroll.create')
    if (isResponse(user)) return user

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return badRequest('Invalid JSON body')
    }

    const parsed = payrollBodySchema.safeParse(body)
    if (!parsed.success) {
      const first = parsed.error.issues[0]
      return badRequest(first ? `${first.path.join('.') || 'body'}: ${first.message}` : 'Invalid request body')
    }
    const input = parsed.data

    const staff = await db.staff.findFirst({
      where: { id: input.staffId, deletedAt: null },
      select: { id: true, fullName: true },
    })
    if (!staff) return badRequest('Staff member not found')

    const projectId = input.projectId?.trim() ? input.projectId.trim() : null
    let projectRate = 0
    if (projectId) {
      const project = await db.project.findUnique({
        where: { id: projectId },
        select: { id: true, clientRatePerHour: true },
      })
      if (!project) return badRequest('Project not found')
      projectRate = project.clientRatePerHour
    }

    // Code-level duplicate check (SQLite treats NULL projectId as distinct in the unique index)
    const duplicate = await db.payroll.findFirst({
      where: { staffId: input.staffId, projectId: projectId ?? null, month: input.month, year: input.year },
      select: { id: true },
    })
    if (duplicate) return conflict(DUPLICATE_MESSAGE)

    const calc = calcPayroll({
      totalHours: input.totalHours,
      hourlyRate: input.hourlyRate,
      overtimeHours: input.overtimeHours,
      overtimeRate: input.overtimeRate,
      otherEarnings: input.otherEarnings,
      advance: input.advance,
      absentPenalty: input.absentPenalty,
      ptAmount: input.ptAmount,
      unionFees: input.unionFees,
      otherDeductionValue: input.otherDeductionValue,
      otherDeductionType: input.otherDeductionType,
    })

    let payDate = parseDate(input.payDate)
    if (input.status === 'paid' && !payDate) payDate = new Date()
    const taxCode = input.taxCode?.trim() ? input.taxCode.trim() : 'N/A'

    const created = await db.$transaction(async (tx) => {
      const payroll = await tx.payroll.create({
        data: {
          staffId: input.staffId,
          projectId,
          month: input.month,
          year: input.year,
          totalHours: input.totalHours,
          hourlyRateSnapshot: input.hourlyRate,
          overtimeHours: input.overtimeHours,
          overtimeRateSnapshot: input.overtimeRate,
          otherEarnings: input.otherEarnings,
          advance: 0, // placeholder — set below from the advance module
          absentPenalty: input.absentPenalty,
          ptAmount: input.ptAmount,
          unionFees: input.unionFees,
          otherDeductionValue: input.otherDeductionValue,
          otherDeductionType: input.otherDeductionType,
          // Client billing snapshot: explicit value wins, else the project default
          clientRate: input.clientRate ?? projectRate,
          clientOtRate: input.clientOtRate ?? 0,
          grossPay: round2(calc.grossPay),
          totalDeductions: round2(calc.totalDeductions),
          netPay: round2(calc.netPay),
          status: input.status,
          payDate,
          payType: input.payType,
          taxCode,
          createdBy: user.id,
        },
        include: PAYROLL_INCLUDE,
      })

      // AUTOMATIC ADVANCE DEDUCTION — match advances whose deduction month
      // equals this payroll month, cap to the available salary room, link them.
      const otherDeductions = otherDeductionsOf({
        absentPenalty: input.absentPenalty,
        ptAmount: input.ptAmount,
        unionFees: input.unionFees,
        otherDeductionValue: input.otherDeductionValue,
        otherDeductionType: input.otherDeductionType,
        grossPay: calc.grossPay,
      })
      const sync = await syncPayrollAdvanceDeductions({
        tx,
        payrollId: payroll.id,
        staffId: input.staffId,
        month: input.month,
        year: input.year,
        grossPay: calc.grossPay,
        otherDeductions,
        isPaid: input.status === 'paid',
        payDate,
        operatorUserId: user.id,
        staffName: staff.fullName,
      })
      // matching advances exist → their capped total REPLACES the manual value
      const finalAdvance = sync.items.length ? sync.advanceTotal : input.advance
      const finalCalc = calcPayroll({
        totalHours: input.totalHours,
        hourlyRate: input.hourlyRate,
        overtimeHours: input.overtimeHours,
        overtimeRate: input.overtimeRate,
        otherEarnings: input.otherEarnings,
        advance: finalAdvance,
        absentPenalty: input.absentPenalty,
        ptAmount: input.ptAmount,
        unionFees: input.unionFees,
        otherDeductionValue: input.otherDeductionValue,
        otherDeductionType: input.otherDeductionType,
      })

      const finalPayroll = await tx.payroll.update({
        where: { id: payroll.id },
        data: {
          advance: finalAdvance,
          grossPay: round2(finalCalc.grossPay),
          totalDeductions: round2(finalCalc.totalDeductions),
          netPay: round2(finalCalc.netPay),
        },
        include: PAYROLL_INCLUDE,
      })

      // status=paid ⇒ a linked "Salary" expense transaction MUST exist
      if (input.status === 'paid') {
        let salaryCategory = await tx.transactionCategory.findFirst({
          where: { name: 'Salary', type: 'expense' },
        })
        if (!salaryCategory) {
          salaryCategory = await tx.transactionCategory.create({
            data: { name: 'Salary', type: 'expense' },
          })
        }
        await tx.transaction.create({
          data: {
            type: 'expense',
            title: `Salary Payment: ${staff.fullName}`,
            amount: round2(finalCalc.netPay),
            transactionCategoryId: salaryCategory.id,
            projectId,
            operatorUserId: user.id,
            transactionDate: payDate ?? new Date(),
            description: `Monthly salary disbursement — ${input.month}/${input.year}`,
            payrollId: payroll.id,
          },
        })
      }

      return { payroll: finalPayroll, sync }
    })

    await logActivity({
      user,
      module: 'payroll',
      action: input.status === 'paid' ? 'paid' : 'created',
      description:
        input.status === 'paid'
          ? `Salary Payment: ${staff.fullName} — ${input.month}/${input.year}`
          : `Payroll created: ${staff.fullName} — ${input.month}/${input.year}`,
      amount: input.status === 'paid' ? round2(created.payroll.netPay) : null,
    })

    const advanceCapped = created.sync.items.some((i) => i.applied < i.scheduled - 0.005)

    return ok({
      ...serializePayroll(created.payroll),
      ...(created.sync.items.length
        ? {
            advanceApplied: {
              count: created.sync.items.filter((i) => i.applied > 0).length,
              total: round2(created.sync.advanceTotal),
            },
          }
        : {}),
      ...(advanceCapped
        ? { warning: 'Advance deduction was capped to the available salary — the remaining balance carries to the next month' }
        : calc.negativeWarning
          ? { warning: 'Net pay computed as negative and was clamped to 0' }
          : {}),
    })
  } catch {
    return serverError()
  }
}

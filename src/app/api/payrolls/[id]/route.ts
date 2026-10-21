// Payroll API — single record: get (with computed otherDeductionAmount), update (recalc + linked
// expense sync), delete (also removes the linked expense transaction)
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
  notFound,
  serverError,
  requireAuth,
  requirePermission,
  isResponse,
  logActivity,
  parseDate,
} from '@/lib/api-helpers'
import {
  syncPayrollAdvanceDeductions,
  revertPayrollAdvanceDeductions,
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
  // Client billing rates (optional — preserved as-is when the payroll form
  // omits them; the Client Salary Summary edits them via its own endpoint)
  clientRate: z.coerce.number().min(0).max(100000).optional(),
  clientOtRate: z.coerce.number().min(0).max(100000).optional(),
  status: z.enum(['pending', 'paid']).default('pending'),
  payDate: z.string().nullable().optional(),
  payType: z.enum(['bank_transfer', 'cash', 'cheque']).default('bank_transfer'),
  taxCode: z.string().nullable().optional(),
})

type Params = { params: Promise<{ id: string }> }

// GET /api/payrolls/[id]
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth()
    if (isResponse(user)) return user

    const { id } = await params
    const payroll = await db.payroll.findUnique({
      where: { id },
      include: PAYROLL_INCLUDE,
    })
    if (!payroll) return notFound('Payroll record not found')

    const otherDeductionAmount =
      payroll.otherDeductionType === 'percent'
        ? round2((payroll.grossPay * payroll.otherDeductionValue) / 100)
        : round2(payroll.otherDeductionValue)

    return ok({ ...serializePayroll(payroll), otherDeductionAmount })
  } catch {
    return serverError()
  }
}

// PUT /api/payrolls/[id] — always recalculates from inputs and syncs the linked expense
export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const user = await requirePermission('payroll.edit')
    if (isResponse(user)) return user

    const { id } = await params
    const existing = await db.payroll.findUnique({
      where: { id },
      include: { staff: { select: { id: true, fullName: true } } },
    })
    if (!existing) return notFound('Payroll record not found')

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
    if (projectId) {
      const project = await db.project.findUnique({ where: { id: projectId }, select: { id: true } })
      if (!project) return badRequest('Project not found')
    }

    // Duplicate check excluding this record (SQLite NULL-projectId unique gap)
    const duplicate = await db.payroll.findFirst({
      where: {
        staffId: input.staffId,
        projectId: projectId ?? null,
        month: input.month,
        year: input.year,
        id: { not: id },
      },
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
    if (input.status === 'paid' && !payDate) payDate = existing.payDate ?? new Date()
    const taxCode = input.taxCode?.trim() ? input.taxCode.trim() : 'N/A'

    const updated = await db.$transaction(async (tx) => {
      const payroll = await tx.payroll.update({
        where: { id },
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
          advance: 0, // placeholder — re-synced from the advance module below
          absentPenalty: input.absentPenalty,
          ptAmount: input.ptAmount,
          unionFees: input.unionFees,
          otherDeductionValue: input.otherDeductionValue,
          otherDeductionType: input.otherDeductionType,
          // Client billing rates ride along unchanged unless explicitly provided
          clientRate: input.clientRate ?? existing.clientRate,
          clientOtRate: input.clientOtRate ?? existing.clientOtRate,
          grossPay: round2(calc.grossPay),
          totalDeductions: round2(calc.totalDeductions),
          netPay: round2(calc.netPay),
          status: input.status,
          payDate,
          payType: input.payType,
          taxCode,
        },
        include: PAYROLL_INCLUDE,
      })

      // AUTOMATIC ADVANCE DEDUCTION — reverts this payroll's old deductions
      // and re-applies from the current advance module state (capped to room).
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
        payrollId: id,
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
        where: { id },
        data: {
          advance: finalAdvance,
          grossPay: round2(finalCalc.grossPay),
          totalDeductions: round2(finalCalc.totalDeductions),
          netPay: round2(finalCalc.netPay),
        },
        include: PAYROLL_INCLUDE,
      })

      const linked = await tx.transaction.findUnique({ where: { payrollId: id } })
      if (input.status === 'paid') {
        if (!linked) {
          // transitioned to paid (or link missing) ⇒ create the linked expense
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
              payrollId: id,
            },
          })
        } else {
          // stays paid ⇒ keep the linked expense amount in sync
          await tx.transaction.update({
            where: { id: linked.id },
            data: { amount: round2(finalCalc.netPay) },
          })
        }
      } else if (linked) {
        // no longer paid ⇒ remove the linked expense (advance recovery entries
        // were already removed by the sync above)
        await tx.transaction.delete({ where: { id: linked.id } })
      }

      return { payroll: finalPayroll, sync }
    })

    await logActivity({
      user,
      module: 'payroll',
      action: 'updated',
      description: `Payroll updated: ${staff.fullName} — ${input.month}/${input.year}`,
    })

    const advanceCapped = updated.sync.items.some((i) => i.applied < i.scheduled - 0.005)

    return ok({
      ...serializePayroll(updated.payroll),
      ...(updated.sync.items.length
        ? {
            advanceApplied: {
              count: updated.sync.items.filter((i) => i.applied > 0).length,
              total: round2(updated.sync.advanceTotal),
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

// DELETE /api/payrolls/[id] — removes the linked expense transaction as well
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const user = await requirePermission('payroll.delete')
    if (isResponse(user)) return user

    const { id } = await params
    const existing = await db.payroll.findUnique({
      where: { id },
      include: { staff: { select: { id: true, fullName: true } } },
    })
    if (!existing) return notFound('Payroll record not found')

    const staffName = existing.staff?.fullName ?? null

    await db.$transaction(async (tx) => {
      // revert advance balances + recovery income entries first, then the rows
      await revertPayrollAdvanceDeductions(tx, id)
      // explicit delete of the linked expense (Transaction.payroll cascades, but be safe)
      await tx.transaction.deleteMany({ where: { payrollId: id } })
      await tx.payroll.delete({ where: { id } })
    })

    await logActivity({
      user,
      module: 'payroll',
      action: 'deleted',
      description: staffName
        ? `Payroll deleted: ${staffName} — ${existing.month}/${existing.year}`
        : `Payroll deleted: ${existing.month}/${existing.year}`,
    })

    return ok({ success: true })
  } catch {
    return serverError()
  }
}

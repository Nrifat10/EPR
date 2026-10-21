// Payroll advance recalculation — re-syncs the Advance Deduction column of
// every payroll in a month after advances were added, edited or deleted.
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { round2 } from '@/lib/format'
import { ok, badRequest, serverError, requirePermission, isResponse, logActivity } from '@/lib/api-helpers'
import {
  syncPayrollAdvanceDeductions,
  expectedAdvanceForPayroll,
  otherDeductionsOf,
} from '@/lib/advance-service'

const bodySchema = z.object({
  month: z.coerce.number().int().min(1, 'Month must be between 1 and 12').max(12, 'Month must be between 1 and 12'),
  year: z.coerce.number().int().min(1900, 'Year is out of range').max(2200, 'Year is out of range'),
})

// POST /api/advances/recalculate { month, year }
export async function POST(req: NextRequest) {
  try {
    const user = await requirePermission('payroll.edit')
    if (isResponse(user)) return user

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return badRequest('Invalid JSON body')
    }

    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) {
      const first = parsed.error.issues[0]
      return badRequest(first ? `${first.path.join('.') || 'body'}: ${first.message}` : 'Invalid request body')
    }
    const { month, year } = parsed.data

    const payrolls = await db.payroll.findMany({
      where: { month, year },
      include: { staff: { select: { id: true, fullName: true } } },
      orderBy: { createdAt: 'asc' },
    })

    // Same guard as stale detection: only payrolls where the module has a
    // scheduled deduction (expected > 0) are touched — legacy manual advance
    // values are preserved untouched.
    const targets: typeof payrolls = []
    for (const p of payrolls) {
      const staffAdvances = await db.workerAdvance.findMany({ where: { staffId: p.staffId } })
      const rows = await db.payrollAdvanceDeduction.findMany({
        where: { advance: { staffId: p.staffId } },
        include: { payroll: { select: { month: true, year: true } } },
      })
      const expected = expectedAdvanceForPayroll(
        p,
        rows.map((r) => ({
          advanceId: r.advanceId,
          amount: r.amount,
          payrollId: r.payrollId,
          month: r.payroll.month,
          year: r.payroll.year,
        })),
        staffAdvances.map((a) => ({
          id: a.id,
          amount: a.amount,
          deductedAmount: a.deductedAmount,
          installments: a.installments,
          deductionMonth: a.deductionMonth,
          deductionYear: a.deductionYear,
        }))
      )
      if (expected > 0 && Math.abs(expected - round2(p.advance)) > 0.005) targets.push(p)
    }

    let changed = 0
    let advanceTotalAll = 0

    await db.$transaction(async (tx) => {
      for (const p of targets) {
        const other = otherDeductionsOf(p)
        const result = await syncPayrollAdvanceDeductions({
          tx,
          payrollId: p.id,
          staffId: p.staffId,
          month,
          year,
          grossPay: p.grossPay,
          otherDeductions: other,
          isPaid: p.status === 'paid',
          payDate: p.payDate,
          operatorUserId: user.id,
          staffName: p.staff.fullName,
        })

        advanceTotalAll += result.advanceTotal
        if (Math.abs(result.advanceTotal - round2(p.advance)) > 0.005) {
          changed += 1
          const totalDeductions = round2(other + result.advanceTotal)
          const netPay = Math.max(0, round2(p.grossPay - totalDeductions))
          await tx.payroll.update({
            where: { id: p.id },
            data: { advance: result.advanceTotal, totalDeductions, netPay },
          })
          // keep the linked salary expense in sync for finalized payrolls
          if (p.status === 'paid') {
            await tx.transaction
              .updateMany({ where: { payrollId: p.id }, data: { amount: netPay } })
              .catch(() => {})
          }
        }
      }
    })

    await logActivity({
      user,
      module: 'advance',
      action: 'updated',
      description: `Advance deductions recalculated for ${month}/${year} — ${changed} payroll record(s) updated`,
    })

    return ok({ recalculated: targets.length, changed, advanceTotal: round2(advanceTotalAll) })
  } catch {
    return serverError()
  }
}

// Stale payroll detection — payrolls whose stored Advance Deduction column no
// longer matches what the advance module would apply (advances added/edited/
// deleted after the payroll was generated).
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { round2 } from '@/lib/format'
import { ok, badRequest, serverError, requirePermission, isResponse, toInt } from '@/lib/api-helpers'
import { expectedAdvanceForPayroll } from '@/lib/advance-service'

// GET /api/advances/stale-payrolls?month&year
export async function GET(req: NextRequest) {
  try {
    const user = await requirePermission('payroll.view')
    if (isResponse(user)) return user

    const { searchParams } = new URL(req.url)
    const month = toInt(searchParams.get('month'), 0)
    const year = toInt(searchParams.get('year'), 0)
    if (month < 1 || month > 12 || year <= 0) return badRequest('Valid month and year are required')

    const payrolls = await db.payroll.findMany({
      where: { month, year },
      include: {
        staff: { select: { id: true, fullName: true } },
      },
    })
    if (payrolls.length === 0) return ok([])

    const staffIds = Array.from(new Set(payrolls.map((p) => p.staffId)))
    const [advances, deductionRows] = await Promise.all([
      db.workerAdvance.findMany({ where: { staffId: { in: staffIds } } }),
      db.payrollAdvanceDeduction.findMany({
        where: { advance: { staffId: { in: staffIds } } },
        include: { payroll: { select: { month: true, year: true } } },
      }),
    ])
    const allRows = deductionRows.map((r) => ({
      advanceId: r.advanceId,
      amount: r.amount,
      payrollId: r.payrollId,
      month: r.payroll.month,
      year: r.payroll.year,
    }))

    const stale: {
      payrollId: string
      staffName: string
      month: number
      year: number
      stored: number
      expected: number
    }[] = []
    for (const p of payrolls) {
      const staffAdvances = advances
        .filter((a) => a.staffId === p.staffId)
        .map((a) => ({
          id: a.id,
          amount: a.amount,
          deductedAmount: a.deductedAmount,
          installments: a.installments,
          deductionMonth: a.deductionMonth,
          deductionYear: a.deductionYear,
        }))
      const expected = expectedAdvanceForPayroll(p, allRows, staffAdvances)
      // Only flag when the advance module has something scheduled for this
      // staff + month (expected > 0). Legacy payrolls with purely manual
      // advance values (entered before the module existed) are left alone.
      if (expected > 0 && Math.abs(expected - round2(p.advance)) > 0.01) {
        stale.push({
          payrollId: p.id,
          staffName: p.staff.fullName,
          month: p.month,
          year: p.year,
          stored: round2(p.advance),
          expected,
        })
      }
    }

    return ok(stale)
  } catch {
    return serverError()
  }
}

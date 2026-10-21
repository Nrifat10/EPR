// Payroll form preview API — what the automatic advance deduction would apply
// for a given staff member + payroll month (excludes the payroll's own rows
// when editing, so the preview equals what a save would recompute).
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { round2 } from '@/lib/format'
import { ok, badRequest, serverError, requirePermission, isResponse, toInt } from '@/lib/api-helpers'
import { scheduledForAdvance, advanceRef } from '@/lib/advances'
import { deductedUpToMonth } from '@/lib/advance-service'

// GET /api/advances/payroll-preview?staffId&month&year[&excludePayrollId]
export async function GET(req: NextRequest) {
  try {
    const user = await requirePermission('payroll.view')
    if (isResponse(user)) return user

    const { searchParams } = new URL(req.url)
    const staffId = searchParams.get('staffId')?.trim() ?? ''
    const month = toInt(searchParams.get('month'), 0)
    const year = toInt(searchParams.get('year'), 0)
    const excludePayrollId = searchParams.get('excludePayrollId')?.trim() ?? ''

    if (!staffId) return ok({ items: [], total: 0 })
    if (month < 1 || month > 12 || year <= 0) return badRequest('Valid month and year are required')

    const advances = await db.workerAdvance.findMany({ where: { staffId } })

    // Month-aware: only money recovered via payrolls up to (month, year) counts;
    // the edited payroll's own rows are excluded (a save reverts them first).
    const deductedMap = await deductedUpToMonth(db, staffId, month, year, excludePayrollId || undefined)

    const items = advances
      .map((a) => {
        const deducted = deductedMap.get(a.id) ?? 0
        const scheduled = scheduledForAdvance(
          { ...a, deductedAmount: deducted },
          month,
          year
        )
        const monthsElapsed = (year - a.deductionYear) * 12 + (month - a.deductionMonth) + 1
        return {
          advanceId: a.id,
          reference: advanceRef(a.id),
          scheduled: round2(scheduled),
          remaining: round2(a.amount - a.deductedAmount),
          installmentNo: Math.min(Math.max(1, monthsElapsed), Math.max(1, a.installments)),
          installments: Math.max(1, a.installments),
        }
      })
      .filter((i) => i.scheduled > 0)
      .sort((a, b) => a.installmentNo - b.installmentNo)

    return ok({ items, total: round2(items.reduce((s, i) => s + i.scheduled, 0)) })
  } catch {
    return serverError()
  }
}

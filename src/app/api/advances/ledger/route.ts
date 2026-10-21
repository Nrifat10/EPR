// Per-worker advance ledger API — all advances, payroll deductions and balance
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { round2 } from '@/lib/format'
import { ok, badRequest, notFound, serverError, requirePermission, isResponse } from '@/lib/api-helpers'
import { serializeAdvance } from '@/lib/advance-service'

// GET /api/advances/ledger?staffId=
export async function GET(req: NextRequest) {
  try {
    const user = await requirePermission('advances.view')
    if (isResponse(user)) return user

    const staffId = new URL(req.url).searchParams.get('staffId')?.trim() ?? ''
    if (!staffId) return badRequest('staffId is required')

    const staff = await db.staff.findFirst({
      where: { id: staffId, deletedAt: null },
      select: {
        id: true,
        fullName: true,
        iqamaId: true,
        position: true,
        monthlySalary: true,
        status: true,
      },
    })
    if (!staff) return notFound('Worker not found')

    const [advances, deductionRows] = await Promise.all([
      db.workerAdvance.findMany({
        where: { staffId },
        orderBy: [{ deductionYear: 'asc' }, { deductionMonth: 'asc' }, { createdAt: 'asc' }],
      }),
      db.payrollAdvanceDeduction.findMany({
        where: { advance: { staffId } },
        include: { payroll: { select: { month: true, year: true, status: true } } },
        orderBy: [{ createdAt: 'asc' }],
      }),
    ])

    const given = round2(advances.reduce((s, a) => s + a.amount, 0))
    const deducted = round2(advances.reduce((s, a) => s + a.deductedAmount, 0))
    const lockedIds = new Set(
      deductionRows.filter((d) => d.payroll.status === 'paid').map((d) => d.advanceId)
    )

    return ok({
      staff: {
        id: staff.id,
        fullName: staff.fullName,
        iqamaId: staff.iqamaId,
        position: staff.position,
        monthlySalary: staff.monthlySalary,
        status: staff.status === 'inactive' ? 'inactive' : 'active',
      },
      advances: advances.map((a) => ({ ...serializeAdvance(a), locked: lockedIds.has(a.id) })),
      deductions: deductionRows.map((d) => ({
        id: d.id,
        advanceId: d.advanceId,
        amount: round2(d.amount),
        month: d.payroll.month,
        year: d.payroll.year,
        payrollStatus: d.payroll.status === 'paid' ? 'paid' : 'pending',
        recovered: Boolean(d.recoveryTransactionId),
        createdAt: d.createdAt.toISOString(),
      })),
      totals: { given, deducted, outstanding: round2(given - deducted) },
    })
  } catch {
    return serverError()
  }
}

// POST /api/payrolls/[id]/mark-paid — quick action: flips a pending payroll to
// paid (server-side snapshot, no full body needed) and syncs the linked Salary
// expense. Used by the payroll list quick action and the dashboard pending list.
import { NextRequest } from 'next/server'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { round2 } from '@/lib/format'
import {
  ok,
  conflict,
  notFound,
  serverError,
  requirePermission,
  isResponse,
  logActivity,
} from '@/lib/api-helpers'
import { ensureRecoveryTransactions } from '@/lib/advance-service'

const PAYROLL_INCLUDE = {
  staff: {
    select: {
      id: true,
      fullName: true,
      iqamaId: true,
      staffCategory: { select: { id: true, name: true } },
    },
  },
  project: { select: { id: true, name: true } },
} satisfies Prisma.PayrollInclude

type Params = { params: Promise<{ id: string }> }

export async function POST(_req: NextRequest, { params }: Params) {
  try {
    const user = await requirePermission('payroll.edit')
    if (isResponse(user)) return user

    const { id } = await params
    const existing = await db.payroll.findUnique({ where: { id } })
    if (!existing) return notFound('Payroll record not found')
    if (existing.status === 'paid') return conflict('Payroll is already marked as paid')

    const payDate = existing.payDate ?? new Date()

    const updated = await db.$transaction(async (tx) => {
      const payroll = await tx.payroll.update({
        where: { id },
        data: { status: 'paid', payDate },
        include: PAYROLL_INCLUDE,
      })

      // Finalizing the payroll recovers the worker advances it deducted —
      // write the "Advance Recovery" income entries (and lock the advances).
      await ensureRecoveryTransactions(
        tx,
        id,
        payDate,
        user.id,
        payroll.staff.fullName,
        payroll.month,
        payroll.year
      )

      const linked = await tx.transaction.findUnique({ where: { payrollId: id } })
      if (!linked) {
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
            title: `Salary Payment: ${payroll.staff.fullName}`,
            amount: round2(payroll.netPay),
            transactionCategoryId: salaryCategory.id,
            projectId: payroll.projectId,
            operatorUserId: user.id,
            transactionDate: payDate,
            description: `Monthly salary disbursement — ${payroll.month}/${payroll.year}`,
            payrollId: id,
          },
        })
      } else {
        await tx.transaction.update({
          where: { id: linked.id },
          data: { amount: round2(payroll.netPay) },
        })
      }

      return payroll
    })

    await logActivity({
      user,
      module: 'payroll',
      action: 'updated',
      description: `Marked payroll paid: ${updated.staff.fullName} — ${updated.month}/${updated.year}`,
    })

    return ok(updated)
  } catch {
    return serverError()
  }
}

// Worker advance API — edit & delete.
// Locked (409) once any of its deductions sits in a PAID (finalized) payroll.
// Pending-payroll deductions never block edits — the affected payrolls simply
// become "stale" and the payroll view offers a Recalculate button.
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { round2 } from '@/lib/format'
import {
  ok,
  badRequest,
  conflict,
  notFound,
  serverError,
  requirePermission,
  isResponse,
  logActivity,
  parseDate,
} from '@/lib/api-helpers'
import {
  serializeAdvance,
  isAdvanceLocked,
  getOrCreateAdvanceExpenseCategory,
  syncPayrollAdvanceDeductions,
  otherDeductionsOf,
} from '@/lib/advance-service'
import { advanceStatusOf } from '@/lib/advances'

const STAFF_INCLUDE = {
  id: true,
  fullName: true,
  iqamaId: true,
  position: true,
} as const

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

type Params = { params: Promise<{ id: string }> }

const LOCKED_MESSAGE =
  'This advance is locked: it was already deducted in a finalized (paid) payroll. Reopen that payroll first, then edit.'

// PUT /api/advances/[id]
export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const user = await requirePermission('advances.edit')
    if (isResponse(user)) return user

    const { id } = await params
    const existing = await db.workerAdvance.findUnique({
      where: { id },
      include: { staff: { select: { id: true, fullName: true } } },
    })
    if (!existing) return notFound('Advance record not found')

    if (await isAdvanceLocked(id)) return conflict(LOCKED_MESSAGE)

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

    if (input.staffId !== existing.staffId) {
      return badRequest('Worker cannot be changed on an existing advance')
    }

    const givenDate = parseDate(input.givenDate)
    if (!givenDate) return badRequest('A valid advance date is required')

    const reference = input.reference?.trim() ? input.reference.trim() : null

    const updated = await db.$transaction(async (tx) => {
      const row = await tx.workerAdvance.update({
        where: { id },
        data: {
          amount: round2(input.amount),
          givenDate,
          paymentMethod: input.paymentMethod,
          reference,
          deductionMonth: input.deductionMonth,
          deductionYear: input.deductionYear,
          installments: input.installments,
          status: advanceStatusOf(input.amount, existing.deductedAmount),
        },
        include: { staff: { select: STAFF_INCLUDE } },
      })

      // Keep the linked expense entry in sync
      if (existing.transactionId) {
        await tx.transaction
          .update({
            where: { id: existing.transactionId },
            data: {
              amount: round2(input.amount),
              transactionDate: givenDate,
              description: `Worker advance — deduction starts ${input.deductionMonth}/${input.deductionYear}${
                reference ? ` — ${reference}` : ''
              }`,
            },
          })
          .catch(() => {})
      } else {
        const category = await getOrCreateAdvanceExpenseCategory(tx)
        const t = await tx.transaction.create({
          data: {
            type: 'expense',
            title: `Advance Payment: ${existing.staff.fullName}`,
            amount: round2(input.amount),
            transactionCategoryId: category.id,
            operatorUserId: user.id,
            transactionDate: givenDate,
            description: `Worker advance — deduction starts ${input.deductionMonth}/${input.deductionYear}`,
          },
        })
        await tx.workerAdvance.update({ where: { id }, data: { transactionId: t.id } })
      }

      return tx.workerAdvance.findUniqueOrThrow({
        where: { id },
        include: { staff: { select: STAFF_INCLUDE } },
      })
    })

    await logActivity({
      user,
      module: 'advance',
      action: 'updated',
      description: `Advance updated: ${existing.staff.fullName} — SAR ${round2(input.amount).toLocaleString('en-US')} (deduction ${input.deductionMonth}/${input.deductionYear})`,
      amount: round2(input.amount),
    })

    return ok(serializeAdvance(updated))
  } catch {
    return serverError()
  }
}

// DELETE /api/advances/[id] — removes the advance + its linked expense entry.
// Pending payrolls that deducted from it are automatically re-synced so their
// Advance Deduction column never goes stale (paid payrolls block deletion).
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const user = await requirePermission('advances.delete')
    if (isResponse(user)) return user

    const { id } = await params
    const existing = await db.workerAdvance.findUnique({
      where: { id },
      include: { staff: { select: { id: true, fullName: true } } },
    })
    if (!existing) return notFound('Advance record not found')

    if (await isAdvanceLocked(id)) return conflict(LOCKED_MESSAGE)

    await db.$transaction(async (tx) => {
      // which payrolls referenced this advance (rows cascade on delete)
      const affected = await tx.payrollAdvanceDeduction.findMany({
        where: { advanceId: id },
        select: { payrollId: true },
      })
      const payrollIds = Array.from(new Set(affected.map((a) => a.payrollId)))

      if (existing.transactionId) {
        await tx.transaction.deleteMany({ where: { id: existing.transactionId } })
      }
      await tx.workerAdvance.delete({ where: { id } })

      // re-sync each affected payroll from the remaining advances
      for (const pid of payrollIds) {
        const p = await tx.payroll.findUnique({
          where: { id: pid },
          include: { staff: { select: { id: true, fullName: true } } },
        })
        if (!p) continue
        const other = otherDeductionsOf(p)
        const result = await syncPayrollAdvanceDeductions({
          tx,
          payrollId: pid,
          staffId: p.staffId,
          month: p.month,
          year: p.year,
          grossPay: p.grossPay,
          otherDeductions: other,
          isPaid: p.status === 'paid',
          payDate: p.payDate,
          operatorUserId: user.id,
          staffName: p.staff.fullName,
        })
        const totalDeductions = round2(other + result.advanceTotal)
        const netPay = Math.max(0, round2(p.grossPay - totalDeductions))
        await tx.payroll.update({
          where: { id: pid },
          data: { advance: result.advanceTotal, totalDeductions, netPay },
        })
        if (p.status === 'paid') {
          await tx.transaction
            .updateMany({ where: { payrollId: pid }, data: { amount: netPay } })
            .catch(() => {})
        }
      }
    })

    await logActivity({
      user,
      module: 'advance',
      action: 'deleted',
      description: `Advance deleted: ${existing.staff.fullName} — SAR ${round2(existing.amount).toLocaleString('en-US')} (deduction ${existing.deductionMonth}/${existing.deductionYear})`,
      amount: round2(existing.amount),
    })

    return ok({ success: true })
  } catch {
    return serverError()
  }
}

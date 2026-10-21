// Server-side worker-advance service — the single engine that keeps payroll
// rows, PayrollAdvanceDeduction links, WorkerAdvance balances and the
// accounting (expense on payout, income on recovery) in sync.
// Imported only from API routes (uses the Prisma client directly).
import type { Prisma, Payroll, WorkerAdvance } from '@prisma/client'
import { db } from '@/lib/db'
import { round2 } from '@/lib/format'
import {
  advanceStatusOf,
  capAdvanceDeductions,
  scheduledForAdvance,
  type SchedulableAdvance,
} from '@/lib/advances'

type Tx = Prisma.TransactionClient

/** Anything that can query payrollAdvanceDeduction (tx or the root client). */
type DeductionDb = Pick<Prisma.TransactionClient, 'payrollAdvanceDeduction'>

async function getOrCreateCategory(tx: Tx, name: string, type: 'income' | 'expense') {
  const found = await tx.transactionCategory.findFirst({ where: { name, type } })
  if (found) return found
  return tx.transactionCategory.create({ data: { name, type } })
}

export const ADVANCE_EXPENSE_CATEGORY = 'Advance to Workers'
export const ADVANCE_RECOVERY_CATEGORY = 'Advance Recovery'

/** The "Advance to Workers" expense category (auto-created on first use). */
export function getOrCreateAdvanceExpenseCategory(tx: Tx) {
  return getOrCreateCategory(tx, ADVANCE_EXPENSE_CATEGORY, 'expense')
}

/** The "Advance Recovery" income category (auto-created on first use). */
export function getOrCreateAdvanceRecoveryCategory(tx: Tx) {
  return getOrCreateCategory(tx, ADVANCE_RECOVERY_CATEGORY, 'income')
}

/**
 * Create the "Advance Recovery" income entries for a payroll's deduction
 * rows (idempotent — rows that already have one are skipped). Called when a
 * payroll transitions to paid (finalize) so the books balance: the advance
 * expense on payout is reversed by the recovery income on deduction.
 */
export async function ensureRecoveryTransactions(
  tx: Tx,
  payrollId: string,
  payDate: Date | null,
  operatorUserId: string | null,
  staffName: string,
  month: number,
  year: number
): Promise<void> {
  const rows = await tx.payrollAdvanceDeduction.findMany({ where: { payrollId } })
  if (rows.length === 0) return
  const category = await getOrCreateCategory(tx, ADVANCE_RECOVERY_CATEGORY, 'income')
  for (const row of rows) {
    if (row.recoveryTransactionId) continue
    if (row.amount <= 0) continue
    const t = await tx.transaction.create({
      data: {
        type: 'income',
        title: `Advance Recovery: ${staffName}`,
        amount: row.amount,
        transactionCategoryId: category.id,
        operatorUserId,
        transactionDate: payDate ?? new Date(),
        description: `Recovered via payroll — ${month}/${year}`,
      },
    })
    await tx.payrollAdvanceDeduction.update({
      where: { id: row.id },
      data: { recoveryTransactionId: t.id },
    })
  }
}

/** Serialized advance row shape returned by the APIs (see types.ts AdvanceRow). */
export function serializeAdvance(
  row: WorkerAdvance & {
    staff?: { id: string; fullName: string; iqamaId: string; position?: string | null } | null
  }
) {
  return {
    id: row.id,
    amount: row.amount,
    givenDate: row.givenDate.toISOString(),
    paymentMethod: row.paymentMethod === 'bank_transfer' ? 'bank_transfer' : 'cash',
    reference: row.reference,
    deductionMonth: row.deductionMonth,
    deductionYear: row.deductionYear,
    installments: row.installments,
    deductedAmount: round2(row.deductedAmount),
    status: advanceStatusOf(row.amount, row.deductedAmount),
    createdAt: row.createdAt.toISOString(),
    ...(row.staff
      ? {
          staff: {
            id: row.staff.id,
            fullName: row.staff.fullName,
            iqamaId: row.staff.iqamaId,
            ...(row.staff.position !== undefined ? { position: row.staff.position } : {}),
          },
        }
      : {}),
  }
}

/** Other deductions stored on a payroll row (everything except the advance). */
export function otherDeductionsOf(p: {
  absentPenalty: number
  ptAmount: number
  unionFees: number
  otherDeductionValue: number
  otherDeductionType: string
  grossPay: number
}): number {
  const other =
    p.otherDeductionType === 'percent'
      ? (p.grossPay * p.otherDeductionValue) / 100
      : p.otherDeductionValue
  return round2(
    Math.max(0, p.absentPenalty) + Math.max(0, p.ptAmount) + Math.max(0, p.unionFees) + Math.max(0, other)
  )
}

/** Room available for an advance deduction without pushing net pay below zero. */
export function advanceRoom(grossPay: number, otherDeductions: number): number {
  return Math.max(0, round2(grossPay - otherDeductions))
}

export type SyncPayrollAdvancesOpts = {
  /** Prisma transaction client (all writes happen inside it). */
  tx: Tx
  payrollId: string
  staffId: string
  month: number
  year: number
  /** Final gross pay (advance does not affect it). */
  grossPay: number
  /** absentPenalty + ptAmount + unionFees + otherDeductionAmount. */
  otherDeductions: number
  /** payroll.status === 'paid' → recovery income entries are (re)created. */
  isPaid: boolean
  payDate: Date | null
  operatorUserId: string | null
  staffName: string
}

export type SyncPayrollAdvancesResult = {
  /** Total advance deduction applied to this payroll (replaces payroll.advance). */
  advanceTotal: number
  items: { advanceId: string; scheduled: number; applied: number }[]
}

/**
 * Sum of this staff's advance deductions recovered via payrolls whose period
 * is BEFORE or EQUAL to (month, year). Deductions from LATER payrolls do not
 * count: editing a past month's payroll must not see the future's money.
 * `excludePayrollId` rows are ignored (they were reverted / belong to the
 * payroll being recomputed).
 */
export async function deductedUpToMonth(
  tx: DeductionDb,
  staffId: string,
  month: number,
  year: number,
  excludePayrollId?: string
): Promise<Map<string, number>> {
  const rows = await tx.payrollAdvanceDeduction.findMany({
    where: {
      advance: { staffId },
      ...(excludePayrollId ? { payrollId: { not: excludePayrollId } } : {}),
      payroll: {
        OR: [{ year: { lt: year } }, { year, month: { lte: month } }],
      },
    },
    select: { advanceId: true, amount: true },
  })
  const map = new Map<string, number>()
  for (const r of rows) {
    map.set(r.advanceId, round2((map.get(r.advanceId) ?? 0) + r.amount))
  }
  return map
}

/**
 * Make the advance deduction state of one payroll match the advance module:
 * 1. revert this payroll's existing deduction rows (and their recovery income)
 * 2. find advances of the staff with a scheduled deduction for month/year
 * 3. cap them to the available salary room (never a negative net)
 * 4. write fresh deduction rows, bump the advances' deductedAmount/status
 * 5. when the payroll is paid, write the "Advance Recovery" income entries
 *    so the books balance (expense on payout ↔ income on recovery).
 */
export async function syncPayrollAdvanceDeductions(
  opts: SyncPayrollAdvancesOpts
): Promise<SyncPayrollAdvancesResult> {
  const { tx, payrollId, staffId, month, year, grossPay, otherDeductions, isPaid, payDate, operatorUserId, staffName } = opts

  // 1. Revert whatever this payroll previously deducted
  const oldRows = await tx.payrollAdvanceDeduction.findMany({
    where: { payrollId },
    include: { advance: true },
  })
  for (const row of oldRows) {
    if (row.recoveryTransactionId) {
      await tx.transaction.deleteMany({ where: { id: row.recoveryTransactionId } })
    }
    const nextDeducted = round2(row.advance.deductedAmount - row.amount)
    await tx.workerAdvance.update({
      where: { id: row.advanceId },
      data: {
        deductedAmount: nextDeducted,
        status: advanceStatusOf(row.advance.amount, nextDeducted),
      },
    })
  }
  if (oldRows.length) {
    await tx.payrollAdvanceDeduction.deleteMany({ where: { payrollId } })
  }

  // 2-3. Candidates + capping — deductedAmount is MONTH-AWARE: only money
  // recovered via payrolls up to and including this month counts toward the
  // installment schedule (future payrolls must not block a past-month edit).
  const candidates = await tx.workerAdvance.findMany({
    where: { staffId },
  })
  const deductedMap = await deductedUpToMonth(tx, staffId, month, year, payrollId)
  const schedulable: (SchedulableAdvance & { id: string })[] = candidates
    .map((a) => ({
      id: a.id,
      amount: a.amount,
      deductedAmount: deductedMap.get(a.id) ?? 0,
      installments: a.installments,
      deductionMonth: a.deductionMonth,
      deductionYear: a.deductionYear,
    }))
    .filter((a) => scheduledForAdvance(a, month, year) > 0)
  const room = advanceRoom(grossPay, otherDeductions)
  const applied = capAdvanceDeductions(schedulable, room, month, year)
  const advanceTotal = round2(applied.reduce((s, a) => s + a.applied, 0))

  // 4. Fresh deduction rows + balance updates
  for (const item of applied) {
    if (item.applied <= 0) continue
    const adv = candidates.find((a) => a.id === item.advanceId)!
    const nextDeducted = round2(adv.deductedAmount + item.applied)
    await tx.workerAdvance.update({
      where: { id: item.advanceId },
      data: {
        deductedAmount: nextDeducted,
        status: advanceStatusOf(adv.amount, nextDeducted),
      },
    })
    await tx.payrollAdvanceDeduction.create({
      data: { payrollId, advanceId: item.advanceId, amount: item.applied },
    })
  }

  // 5. Recovery income entries for finalized (paid) payrolls
  if (isPaid && applied.length) {
    await ensureRecoveryTransactions(tx, payrollId, payDate, operatorUserId, staffName, month, year)
  }

  return { advanceTotal, items: applied }
}

/**
 * Remove a payroll's advance deductions entirely (payroll deletion):
 * deletes recovery income entries, restores the advances' balances.
 */
export async function revertPayrollAdvanceDeductions(tx: Tx, payrollId: string): Promise<void> {
  const rows = await tx.payrollAdvanceDeduction.findMany({
    where: { payrollId },
    include: { advance: true },
  })
  for (const row of rows) {
    if (row.recoveryTransactionId) {
      await tx.transaction.deleteMany({ where: { id: row.recoveryTransactionId } })
    }
    const nextDeducted = round2(row.advance.deductedAmount - row.amount)
    await tx.workerAdvance.update({
      where: { id: row.advanceId },
      data: {
        deductedAmount: nextDeducted,
        status: advanceStatusOf(row.advance.amount, nextDeducted),
      },
    })
  }
  if (rows.length) {
    await tx.payrollAdvanceDeduction.deleteMany({ where: { payrollId } })
  }
}

/**
 * Simulate what syncPayrollAdvanceDeductions WOULD apply to a stored payroll
 * row right now (without writing anything) — used to detect stale payrolls
 * after advances were added/edited/deleted post-generation.
 * Month-aware: only deductions from payrolls up to this month count.
 */
export function expectedAdvanceForPayroll(
  payroll: Pick<Payroll, 'id' | 'staffId' | 'month' | 'year' | 'grossPay' | 'advance'> &
    SchedulableAdvanceFields,
  allRows: { advanceId: string; amount: number; payrollId: string; month: number; year: number }[],
  advances: (SchedulableAdvance & { id: string })[]
): number {
  const deductedMap = new Map<string, number>()
  for (const r of allRows) {
    if (r.payrollId === payroll.id) continue // this payroll's own rows are reverted first
    const isAfter = r.year > payroll.year || (r.year === payroll.year && r.month > payroll.month)
    if (isAfter) continue // future payroll months don't count
    deductedMap.set(r.advanceId, round2((deductedMap.get(r.advanceId) ?? 0) + r.amount))
  }
  const simulated = advances
    .map((a) => ({ ...a, deductedAmount: deductedMap.get(a.id) ?? 0 }))
    .filter((a) => scheduledForAdvance(a, payroll.month, payroll.year) > 0)
  const room = advanceRoom(payroll.grossPay, otherDeductionsOf(payroll))
  const applied = capAdvanceDeductions(simulated, room, payroll.month, payroll.year)
  return round2(applied.reduce((s, a) => s + a.applied, 0))
}

type SchedulableAdvanceFields = {
  absentPenalty: number
  ptAmount: number
  unionFees: number
  otherDeductionValue: number
  otherDeductionType: string
}

/** True when the advance is referenced by a PAID payroll (finalized → locked). */
export async function isAdvanceLocked(advanceId: string): Promise<boolean> {
  const n = await db.payrollAdvanceDeduction.count({
    where: { advanceId, payroll: { status: 'paid' } },
  })
  return n > 0
}

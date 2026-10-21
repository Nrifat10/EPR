// Worker-advance scheduling — pure functions shared by the client (live preview)
// and the server (authoritative payroll sync). No DB access here.
import { round2 } from './format'

export type AdvanceStatus = 'pending' | 'partially_deducted' | 'deducted'
export type AdvancePaymentMethod = 'cash' | 'bank_transfer'

export const ADVANCE_STATUS_LABELS: Record<AdvanceStatus, string> = {
  pending: 'Pending',
  partially_deducted: 'Partially Deducted',
  deducted: 'Deducted',
}

export const ADVANCE_PAYMENT_METHOD_LABELS: Record<AdvancePaymentMethod, string> = {
  cash: 'Cash',
  bank_transfer: 'Bank Transfer',
}

/** Minimal shape needed for scheduling math (subset of the Prisma row). */
export type SchedulableAdvance = {
  amount: number
  deductedAmount: number
  installments: number
  deductionMonth: number
  deductionYear: number
}

/** Human-friendly auto reference for an advance row: "ADV-K3P9XQ". */
export function advanceRef(id: string): string {
  return `ADV-${id.slice(-6).toUpperCase()}`
}

/** Derive the status from amounts (single source of truth — the DB column mirrors it). */
export function advanceStatusOf(amount: number, deductedAmount: number): AdvanceStatus {
  const a = Math.max(0, amount)
  const d = Math.max(0, deductedAmount)
  if (d <= 0.005) return 'pending'
  if (d >= a - 0.005) return 'deducted'
  return 'partially_deducted'
}

/** Fixed monthly share of an installment plan: round2(amount / installments). */
export function monthlyInstallment(adv: Pick<SchedulableAdvance, 'amount' | 'installments'>): number {
  const n = Math.max(1, Math.round(adv.installments || 1))
  return round2(adv.amount / n)
}

/**
 * Amount that should be deducted from this advance in the payroll for (month, year).
 *
 * Installment plan with automatic catch-up:
 * - monthsElapsed = how many installment months have passed (incl. the payroll month)
 * - target = min(amount, share × min(monthsElapsed, installments))
 *   → if an earlier month could not deduct fully (salary too small), the target
 *     catches up in later months; past the installment window the whole remaining
 *     balance keeps carrying until fully recovered.
 * - scheduled = clamp(target − alreadyDeducted, 0, remaining)
 *
 * Month matching is by month AND year: October 2026 ≠ October 2025.
 * A payroll BEFORE the first deduction month gets 0.
 */
export function scheduledForAdvance(
  adv: SchedulableAdvance,
  month: number,
  year: number
): number {
  const remaining = round2(adv.amount - adv.deductedAmount)
  if (remaining <= 0.005) return 0

  const monthsElapsed = (year - adv.deductionYear) * 12 + (month - adv.deductionMonth) + 1
  if (monthsElapsed <= 0) return 0 // payroll month is before the deduction month

  const installments = Math.max(1, Math.round(adv.installments || 1))
  const share = round2(adv.amount / installments)
  const target = round2(Math.min(adv.amount, share * Math.min(monthsElapsed, installments)))
  return Math.max(0, Math.min(remaining, round2(target - adv.deductedAmount)))
}

/**
 * Allocate a capped deduction amount to each advance, oldest deduction month
 * first, never exceeding `room` in total (so the advance can never push net
 * salary below zero). Returns the applied amount per advance (0 entries dropped).
 */
export function capAdvanceDeductions(
  advances: (SchedulableAdvance & { id: string })[],
  room: number,
  month: number,
  year: number
): { advanceId: string; scheduled: number; applied: number }[] {
  const ordered = [...advances].sort((a, b) =>
    a.deductionYear !== b.deductionYear
      ? a.deductionYear - b.deductionYear
      : a.deductionMonth - b.deductionMonth
  )
  let left = Math.max(0, round2(room))
  const out: { advanceId: string; scheduled: number; applied: number }[] = []
  for (const adv of ordered) {
    const scheduled = scheduledForAdvance(adv, month, year)
    if (scheduled <= 0) continue
    const applied = round2(Math.min(scheduled, left))
    left = round2(left - applied)
    out.push({ advanceId: adv.id, scheduled, applied })
    if (left <= 0) break
  }
  return out
}

/** Last installment month/year (for display: "Oct–Dec 2026"). */
export function lastInstallmentMonth(adv: {
  deductionMonth: number
  deductionYear: number
  installments: number
}): { month: number; year: number } {
  const n = Math.max(1, Math.round(adv.installments || 1))
  const idx = (adv.deductionYear * 12 + (adv.deductionMonth - 1)) + (n - 1)
  return { month: (idx % 12) + 1, year: Math.floor(idx / 12) }
}

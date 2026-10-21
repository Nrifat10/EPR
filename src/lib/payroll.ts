// Payroll calculation — single source of truth, used by the client form (live calc)
// AND by the server (re-calculated; client values are never trusted).
import { round2 } from './format'
import type { DeductionType } from './types'

export type PayrollCalcInput = {
  totalHours: number
  hourlyRate: number
  overtimeHours: number
  overtimeRate: number
  otherEarnings: number
  advance: number
  absentPenalty: number
  ptAmount: number
  unionFees: number
  otherDeductionValue: number
  otherDeductionType: DeductionType
}

export type PayrollCalcResult = {
  regularPay: number
  overtimePay: number
  grossPay: number
  otherDeductionAmount: number
  totalDeductions: number
  netPay: number
  negativeWarning: boolean
}

/**
 * regular_pay   = total_hours_worked × hourly_rate
 * overtime_pay  = overtime_hours × overtime_rate
 * gross_pay     = regular_pay + overtime_pay + other_earnings
 * other_deduction_amount = (type == percent) ? gross_pay × value / 100 : value
 * total_deductions = advance + absent_penalty + pt_amount + union_fees + other_deduction_amount
 * net_pay       = gross_pay − total_deductions (never below 0; warning if negative)
 *
 * Verification example (must match exactly):
 *   200 hrs × 75 = 15,000; other earnings 100 → gross 15,100;
 *   union fees 200; other deductions 10% = 1,510 → total deductions 1,710
 *   → net pay SAR 13,390.00
 */
export function calcPayroll(input: PayrollCalcInput): PayrollCalcResult {
  const num = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v : 0)
  const totalHours = Math.max(0, num(input.totalHours))
  const hourlyRate = Math.max(0, num(input.hourlyRate))
  const overtimeHours = Math.max(0, num(input.overtimeHours))
  const overtimeRate = Math.max(0, num(input.overtimeRate))
  const otherEarnings = Math.max(0, num(input.otherEarnings))
  const advance = Math.max(0, num(input.advance))
  const absentPenalty = Math.max(0, num(input.absentPenalty))
  const ptAmount = Math.max(0, num(input.ptAmount))
  const unionFees = Math.max(0, num(input.unionFees))
  const otherDeductionValue = Math.max(0, num(input.otherDeductionValue))
  const otherDeductionType = input.otherDeductionType === 'percent' ? 'percent' : 'fixed'

  const regularPay = round2(totalHours * hourlyRate)
  const overtimePay = round2(overtimeHours * overtimeRate)
  const grossPay = round2(regularPay + overtimePay + otherEarnings)
  const otherDeductionAmount = round2(
    otherDeductionType === 'percent' ? (grossPay * otherDeductionValue) / 100 : otherDeductionValue
  )
  const totalDeductions = round2(advance + absentPenalty + ptAmount + unionFees + otherDeductionAmount)
  const rawNet = round2(grossPay - totalDeductions)
  const negativeWarning = rawNet < 0
  const netPay = Math.max(0, rawNet)

  return { regularPay, overtimePay, grossPay, otherDeductionAmount, totalDeductions, netPay, negativeWarning }
}

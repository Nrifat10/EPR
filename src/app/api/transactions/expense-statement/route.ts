// Worker expense statement API — GET /api/transactions/expense-statement?year=YYYY[&spenderId]
// Answers "who spent how much every month": groups all expense transactions of a
// year by spender (worker) and month, with counts, receipt counts and totals.
// Rows whose expenseMonth/Year are null (system-created legacy rows) are grouped
// by their transaction date month/year instead, so nothing is silently dropped.
// Permission: accounts.view.
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { round2 } from '@/lib/format'
import type {
  ExpenseStatement,
  ExpenseStatementMonth,
  ExpenseStatementSpender,
} from '@/lib/types'
import {
  ok,
  badRequest,
  serverError,
  requirePermission,
  isResponse,
  toInt,
} from '@/lib/api-helpers'

type MonthAgg = { count: number; total: number; receipts: number }

function emptyAgg(): MonthAgg {
  return { count: 0, total: 0, receipts: 0 }
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requirePermission('accounts.view')
    if (isResponse(auth)) return auth

    const sp = req.nextUrl.searchParams
    const year = toInt(sp.get('year'), 0)
    if (year < 1900 || year > 2200) return badRequest('A valid year is required')
    const spenderId = sp.get('spenderId')?.trim() ?? ''

    const rows = await db.transaction.findMany({
      where: {
        type: 'expense',
        ...(spenderId ? { spenderStaffId: spenderId } : {}),
      },
      select: {
        amount: true,
        spenderStaffId: true,
        expenseMonth: true,
        expenseYear: true,
        transactionDate: true,
        receiptExt: true,
        spender: {
          select: { id: true, fullName: true, iqamaId: true, position: true },
        },
      },
    })

    // spenderKey -> month -> aggregate
    const bySpender = new Map<string, { spender: ExpenseStatementSpender['spender'] | null; months: Map<number, MonthAgg> }>()
    const unassignedMonths = new Map<number, MonthAgg>()

    for (const r of rows) {
      const month = r.expenseMonth ?? r.transactionDate.getMonth() + 1
      const rowYear = r.expenseYear ?? r.transactionDate.getFullYear()
      if (rowYear !== year) continue

      const key = r.spenderStaffId ?? '__none'
      let bucket = bySpender.get(key)
      if (!bucket) {
        bucket = { spender: r.spender ?? null, months: new Map() }
        bySpender.set(key, bucket)
      }
      const agg = bucket.months.get(month) ?? emptyAgg()
      agg.count += 1
      agg.total = round2(agg.total + r.amount)
      if (r.receiptExt) agg.receipts += 1
      bucket.months.set(month, agg)

      if (key === '__none') {
        const u = unassignedMonths.get(month) ?? emptyAgg()
        u.count += 1
        u.total = round2(u.total + r.amount)
        if (r.receiptExt) u.receipts += 1
        unassignedMonths.set(month, u)
      }
    }

    function toMonths(map: Map<number, MonthAgg>): ExpenseStatementMonth[] {
      return Array.from(map.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([month, a]) => ({ month, count: a.count, total: round2(a.total), receipts: a.receipts }))
    }

    let grandTotal = 0
    const spenders: ExpenseStatementSpender[] = []
    for (const [key, bucket] of bySpender) {
      if (key === '__none') continue // company/unassigned bucket reported separately
      const months = toMonths(bucket.months)
      const totalCount = months.reduce((s, m) => s + m.count, 0)
      const total = round2(months.reduce((s, m) => s + m.total, 0))
      const receipts = Array.from(bucket.months.values()).reduce((s, a) => s + a.receipts, 0)
      grandTotal = round2(grandTotal + total)
      if (bucket.spender) {
        spenders.push({ spender: bucket.spender, months, totalCount, total, receipts })
      } else {
        // spender row vanished (staff deleted) — count into the unassigned bucket
        for (const m of months) {
          const u = unassignedMonths.get(m.month) ?? emptyAgg()
          u.count += m.count
          u.total = round2(u.total + m.total)
          unassignedMonths.set(m.month, u)
        }
      }
    }
    spenders.sort((a, b) => b.total - a.total)

    const unassignedMonthsList = toMonths(unassignedMonths)
    const unassignedTotal = round2(unassignedMonthsList.reduce((s, m) => s + m.total, 0))
    const unassignedCount = unassignedMonthsList.reduce((s, m) => s + m.count, 0)

    const statement: ExpenseStatement = {
      year,
      grandTotal: round2(grandTotal + unassignedTotal),
      spenders,
      unassigned: {
        months: unassignedMonthsList,
        totalCount: unassignedCount,
        total: unassignedTotal,
      },
    }
    return ok(statement)
  } catch (err) {
    console.error('[api/transactions/expense-statement GET]', err)
    return serverError()
  }
}

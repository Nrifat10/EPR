// Accounts summary API — totals, per-month breakdown and per-category breakdown
// for a date range (defaults: first day of the month 6 months ago → today).
import { NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { round2 } from '@/lib/format'
import type { TransactionType } from '@/lib/types'
import {
  badRequest,
  ok,
  serverError,
  requirePermission,
  isResponse,
  parseDate,
} from '@/lib/api-helpers'

const SHORT_MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999)
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requirePermission('accounts.view')
    if (isResponse(auth)) return auth

    const sp = req.nextUrl.searchParams
    const now = new Date()

    let from: Date
    let to: Date
    const fromRaw = sp.get('from')
    const toRaw = sp.get('to')
    if (fromRaw) {
      const d = parseDate(fromRaw)
      if (!d) return badRequest('Invalid from date')
      from = d
    } else {
      from = new Date(now.getFullYear(), now.getMonth() - 6, 1)
    }
    if (toRaw) {
      const d = parseDate(toRaw)
      if (!d) return badRequest('Invalid to date')
      to = endOfDay(d)
    } else {
      to = endOfDay(now)
    }
    if (from.getTime() > to.getTime()) {
      return badRequest('from date must be before to date')
    }

    const projectId = sp.get('projectId')
    const where: Prisma.TransactionWhereInput = {
      transactionDate: { gte: from, lte: to },
      ...(projectId ? { projectId } : {}),
    }

    const txs = await db.transaction.findMany({
      where,
      select: {
        type: true,
        amount: true,
        transactionDate: true,
        transactionCategory: { select: { name: true, type: true } },
      },
    })

    // Month buckets for every month in the range (ascending, zeros included)
    const monthBuckets = new Map<
      string,
      { month: string; label: string; income: number; expense: number }
    >()
    const endYear = to.getFullYear()
    const endMonth = to.getMonth()
    let y = from.getFullYear()
    let m = from.getMonth()
    while (y < endYear || (y === endYear && m <= endMonth)) {
      const key = `${y}-${String(m + 1).padStart(2, '0')}`
      monthBuckets.set(key, {
        month: key,
        label: `${SHORT_MONTHS[m]} ${y}`,
        income: 0,
        expense: 0,
      })
      m += 1
      if (m > 11) {
        m = 0
        y += 1
      }
    }

    let income = 0
    let expense = 0
    const catBuckets = new Map<string, { name: string; type: string; amount: number }>()

    for (const t of txs) {
      const amt = t.amount
      if (t.type === 'income') income += amt
      else expense += amt

      const d = t.transactionDate
      const bucket = monthBuckets.get(
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      )
      if (bucket) {
        if (t.type === 'income') bucket.income += amt
        else bucket.expense += amt
      }

      const cat = t.transactionCategory
      const catKey = `${cat.type}:${cat.name}`
      const existing = catBuckets.get(catKey)
      if (existing) existing.amount += amt
      else catBuckets.set(catKey, { name: cat.name, type: cat.type, amount: amt })
    }

    const byMonth = Array.from(monthBuckets.values()).map((b) => ({
      month: b.month,
      label: b.label,
      income: round2(b.income),
      expense: round2(b.expense),
      net: round2(b.income - b.expense),
    }))

    // incomes first (desc), then expenses (desc)
    const byCategory = Array.from(catBuckets.values())
      .map((c) => ({
        name: c.name,
        type: c.type as TransactionType,
        amount: round2(c.amount),
      }))
      .sort((a, b) =>
        a.type === b.type ? b.amount - a.amount : a.type === 'income' ? -1 : 1
      )

    const incomeR = round2(income)
    const expenseR = round2(expense)
    return ok({
      totals: { income: incomeR, expense: expenseR, net: round2(incomeR - expenseR) },
      byMonth,
      byCategory,
      range: { from: from.toISOString(), to: to.toISOString() },
    })
  } catch {
    return serverError()
  }
}

// GET /api/projects/[id]/financials — profitability breakdown for one project
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import {
  ok,
  notFound,
  serverError,
  requirePermission,
  isResponse,
} from '@/lib/api-helpers'
import type { ProjectFinancials, TransactionType } from '@/lib/types'

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const round2 = (n: number) => Math.round(n * 100) / 100

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requirePermission('projects.view')
    if (isResponse(auth)) return auth
    const { id } = await params

    const project = await db.project.findUnique({ where: { id }, select: { id: true, name: true } })
    if (!project) return notFound('Project not found')

    const [incomeAgg, expenseAgg, txCount, payrollAgg, transactions] = await Promise.all([
      db.transaction.aggregate({
        where: { projectId: id, type: 'income' },
        _sum: { amount: true },
      }),
      db.transaction.aggregate({
        where: { projectId: id, type: 'expense' },
        _sum: { amount: true },
      }),
      db.transaction.count({ where: { projectId: id } }),
      db.transaction.aggregate({
        where: { projectId: id, type: 'expense', payrollId: { not: null } },
        _sum: { amount: true },
      }),
      // Recent transactions (also used for monthly series + category totals)
      db.transaction.findMany({
        where: { projectId: id },
        orderBy: { transactionDate: 'desc' },
        include: { transactionCategory: { select: { name: true } } },
        take: 400,
      }),
    ])

    const income = incomeAgg._sum.amount ?? 0
    const expense = expenseAgg._sum.amount ?? 0

    // Monthly series: last 6 calendar months (oldest → newest)
    const now = new Date()
    const months: { key: string; label: string; income: number; expense: number }[] = []
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      months.push({
        key,
        label: `${MONTH_LABELS[d.getMonth()]} '${String(d.getFullYear()).slice(2)}`,
        income: 0,
        expense: 0,
      })
    }
    const monthByKey = new Map(months.map((m) => [m.key, m]))
    for (const t of transactions) {
      const key = `${t.transactionDate.getFullYear()}-${String(t.transactionDate.getMonth() + 1).padStart(2, '0')}`
      const m = monthByKey.get(key)
      if (!m) continue
      if (t.type === 'income') m.income += t.amount
      else m.expense += t.amount
    }

    // Top expense categories (max 5)
    const catTotals = new Map<string, number>()
    for (const t of transactions) {
      if (t.type !== 'expense') continue
      const name = t.transactionCategory?.name ?? 'Uncategorized'
      catTotals.set(name, (catTotals.get(name) ?? 0) + t.amount)
    }
    const topExpenseCategories = [...catTotals.entries()]
      .map(([name, amount]) => ({ name, amount: round2(amount) }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5)

    const data: ProjectFinancials = {
      projectId: project.id,
      income: round2(income),
      expense: round2(expense),
      netProfit: round2(income - expense),
      margin: income > 0 ? round2(((income - expense) / income) * 100) : null,
      transactionCount: txCount,
      payrollExpense: round2(payrollAgg._sum.amount ?? 0),
      monthly: months.map(({ label, income: i, expense: e }) => ({
        month: label,
        income: round2(i),
        expense: round2(e),
      })),
      topExpenseCategories,
      recentTransactions: transactions.slice(0, 8).map((t) => ({
        id: t.id,
        title: t.title,
        type: t.type as TransactionType,
        amount: round2(t.amount),
        date: t.transactionDate.toISOString(),
        category: t.transactionCategory?.name ?? null,
        linkedPayroll: t.payrollId !== null,
      })),
    }

    return ok(data)
  } catch (err) {
    console.error('[api/projects/[id]/financials GET]', err)
    return serverError()
  }
}

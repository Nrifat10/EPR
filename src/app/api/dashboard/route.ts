// Dashboard API — headline stats, 6-month income/expense chart, payroll status,
// pending payouts, IQAMA document alerts and recent activity feed
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { round2 } from '@/lib/format'
import { daysUntil, EXPIRY_WINDOW_DAYS } from '@/lib/expiry'
import {
  ok,
  serverError,
  requirePermission,
  isResponse,
} from '@/lib/api-helpers'
import { hasPermission } from '@/lib/auth'

const SHORT_MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

const LONG_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/** Latest payroll month (by year, then month) that actually has records — null when no payroll exists. */
async function latestPayrollMonth(): Promise<{ month: number; year: number } | null> {
  const grouped = await db.payroll.groupBy({ by: ['month', 'year'] })
  if (grouped.length === 0) return null
  return grouped.reduce((best, g) => {
    if (g.year > best.year || (g.year === best.year && g.month > best.month)) {
      return { month: g.month, year: g.year }
    }
    return best
  })
}

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const auth = await requirePermission('dashboard.view')
    if (isResponse(auth)) return auth

    const now = new Date()

    const [totalStaff, totalUsers, incomeAgg, expenseAgg, salaryAgg, advanceRows] =
      await Promise.all([
        db.staff.count({ where: { deletedAt: null, status: 'active' } }),
        db.user.count(),
        db.transaction.aggregate({
          where: { type: 'income' },
          _sum: { amount: true },
        }),
        db.transaction.aggregate({
          where: { type: 'expense' },
          _sum: { amount: true },
        }),
        db.payroll.aggregate({
          where: { status: 'paid' },
          _sum: { netPay: true },
        }),
        db.workerAdvance.findMany({
          select: { amount: true, deductedAmount: true },
        }),
      ])

    // Last 6 months INCLUDING the current month (ascending)
    const chartStart = new Date(now.getFullYear(), now.getMonth() - 5, 1)
    const chartEnd = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
      23,
      59,
      59,
      999
    )
    const chartTxs = await db.transaction.findMany({
      where: { transactionDate: { gte: chartStart, lte: chartEnd } },
      select: { type: true, amount: true, transactionDate: true },
    })

    const buckets = new Map<string, { month: string; income: number; expense: number }>()
    for (let i = -5; i <= 0; i += 1) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
      buckets.set(`${d.getFullYear()}-${d.getMonth()}`, {
        month: `${SHORT_MONTHS[d.getMonth()]} ${d.getFullYear()}`,
        income: 0,
        expense: 0,
      })
    }
    for (const t of chartTxs) {
      const bucket = buckets.get(
        `${t.transactionDate.getFullYear()}-${t.transactionDate.getMonth()}`
      )
      if (!bucket) continue
      if (t.type === 'income') bucket.income += t.amount
      else bucket.expense += t.amount
    }
    const chart = Array.from(buckets.values()).map((b) => ({
      month: b.month,
      income: round2(b.income),
      expense: round2(b.expense),
    }))

    const recentActivityRows = await db.activityLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 8,
    })
    const recentActivity = recentActivityRows.map((a) => ({
      id: a.id,
      userName: a.userName,
      action: a.action,
      module: a.module,
      description: a.description,
      amount: a.amount === null ? null : round2(a.amount),
      createdAt: a.createdAt.toISOString(),
    }))

    const totalIncome = round2(incomeAgg._sum.amount ?? 0)
    const totalExpense = round2(expenseAgg._sum.amount ?? 0)

    // ---- IQAMA document alerts (staff.view gated) ----
    let documentAlerts: {
      expired: { staffId: string; fullName: string; iqamaId: string; iqamaExpiry: string; daysLeft: number }[]
      expiring: { staffId: string; fullName: string; iqamaId: string; iqamaExpiry: string; daysLeft: number }[]
    } | null = null
    if (hasPermission(auth, 'staff.view')) {
      const windowEnd = new Date(now.getTime() + EXPIRY_WINDOW_DAYS * 86_400_000)
      const docRows = await db.staff.findMany({
        where: {
          deletedAt: null,
          status: 'active',
          OR: [{ iqamaExpiry: { lt: now } }, { iqamaExpiry: { gte: now, lte: windowEnd } }],
        },
        select: { id: true, fullName: true, iqamaId: true, iqamaExpiry: true },
        orderBy: { iqamaExpiry: 'asc' },
      })
      const toAlert = (r: (typeof docRows)[number]) => ({
        staffId: r.id,
        fullName: r.fullName,
        iqamaId: r.iqamaId,
        iqamaExpiry: (r.iqamaExpiry as Date).toISOString(),
        daysLeft: daysUntil(r.iqamaExpiry) ?? 0,
      })
      documentAlerts = {
        expired: docRows.filter((r) => (daysUntil(r.iqamaExpiry) ?? 0) < 0).map(toAlert),
        expiring: docRows.filter((r) => (daysUntil(r.iqamaExpiry) ?? 0) >= 0).map(toAlert),
      }
    }

    // ---- Payroll status for the latest month that has payroll records ----
    let payrollStatus: {
      month: string
      pendingCount: number
      paidCount: number
      pendingAmount: number
      paidAmount: number
      pending: { id: string; staffId: string; staffName: string; netPay: number }[]
    } | null = null

    const latest = await latestPayrollMonth()
    if (latest) {
      const { searchParams } = new URL(req.url)
      // "Show all pending" toggle fetches a longer list (clamped)
      const pendingLimit = Math.min(
        Math.max(Number(searchParams.get('pendingLimit')) || 6, 1),
        200
      )
      const periodRows = await db.payroll.findMany({
        where: { month: latest.month, year: latest.year },
        include: { staff: { select: { id: true, fullName: true } } },
        orderBy: { netPay: 'desc' },
      })
      const pendingRows = periodRows.filter((p) => p.status === 'pending')
      const paidRows = periodRows.filter((p) => p.status === 'paid')
      payrollStatus = {
        month: `${LONG_MONTHS[latest.month - 1]} ${latest.year}`,
        pendingCount: pendingRows.length,
        paidCount: paidRows.length,
        pendingAmount: round2(pendingRows.reduce((s, p) => s + p.netPay, 0)),
        paidAmount: round2(paidRows.reduce((s, p) => s + p.netPay, 0)),
        pending: pendingRows.slice(0, pendingLimit).map((p) => ({
          id: p.id,
          staffId: p.staff.id,
          staffName: p.staff.fullName,
          netPay: round2(p.netPay),
        })),
      }
    }

    // ---- Client deployment overview (clients.view gated) ----
    let clientDeployment: {
      clientCount: number
      activeClients: number
      deployedWorkers: number
      topClients: { id: string; name: string; city: string | null; workers: number }[]
    } | null = null
    if (hasPermission(auth, 'clients.view')) {
      const [clientTotal, activeTotal, psRows] = await Promise.all([
        db.client.count(),
        db.client.count({ where: { status: 'active' } }),
        db.projectStaff.findMany({
          where: { project: { clientId: { not: null } } },
          select: {
            staffId: true,
            project: { select: { client: { select: { id: true, name: true, city: true } } } },
          },
          take: 5000,
        }),
      ])
      // Distinct deployed workers per client (a worker on 2 projects counts once)
      const perClient = new Map<string, { name: string; city: string | null; staff: Set<string> }>()
      for (const ps of psRows) {
        const c = ps.project.client
        if (!c) continue
        let entry = perClient.get(c.id)
        if (!entry) {
          entry = { name: c.name, city: c.city, staff: new Set() }
          perClient.set(c.id, entry)
        }
        entry.staff.add(ps.staffId)
      }
      const topClients = Array.from(perClient.entries())
        .map(([id, e]) => ({ id, name: e.name, city: e.city, workers: e.staff.size }))
        .sort((a, b) => b.workers - a.workers)
        .slice(0, 5)
      clientDeployment = {
        clientCount: clientTotal,
        activeClients: activeTotal,
        deployedWorkers: new Set(psRows.map((ps) => ps.staffId)).size,
        topClients,
      }
    }

    // ---- Advance outstanding (advances.view gated) ----
    let advanceOutstanding: number | null = null
    if (hasPermission(auth, 'advances.view')) {
      advanceOutstanding = round2(
        advanceRows.reduce((s, a) => s + a.amount - a.deductedAmount, 0)
      )
    }

    return ok({
      stats: {
        totalStaff,
        totalUsers,
        totalIncome,
        totalExpense,
        netBalance: round2(totalIncome - totalExpense),
        salaryPaid: round2(salaryAgg._sum.netPay ?? 0),
        advanceOutstanding,
      },
      payrollStatus,
      chart,
      recentActivity,
      documentAlerts,
      clientDeployment,
    })
  } catch {
    return serverError()
  }
}

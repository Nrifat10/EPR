// AI usage API — month-to-date totals + per-user breakdown + 6-month trend.
// Requires ai.viewlogs (admins).
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, serverError, requirePermission, isResponse } from '@/lib/api-helpers'
import { getMonthUsage } from '@/lib/ai/settings'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const auth = await requirePermission('ai.viewlogs')
  if (isResponse(auth)) return auth
  try {
    const now = new Date()
    const month = Number(req.nextUrl.searchParams.get('month') ?? now.getUTCMonth() + 1)
    const year = Number(req.nextUrl.searchParams.get('year') ?? now.getUTCFullYear())

    const from = new Date(Date.UTC(year, month - 1, 1))
    const to = new Date(Date.UTC(year, month, 1))

    const [monthTotals, perUser, trendStart] = await Promise.all([
      getMonthUsage(year, month),
      db.aiUsageLog.groupBy({
        by: ['userName'],
        where: { createdAt: { gte: from, lt: to } },
        _count: { _all: true },
        _sum: {
          promptTokens: true,
          completionTokens: true,
          totalTokens: true,
          costSar: true,
        },
      }),
      db.aiUsageLog.aggregate({
        where: { createdAt: { gte: new Date(Date.UTC(year, month - 6, 1)) } },
        _sum: { costSar: true },
      }),
    ])

    const trendFrom = new Date(Date.UTC(year, month - 5, 1))
    const trendRows = await db.aiUsageLog.findMany({
      where: { createdAt: { gte: trendFrom, lt: to } },
      select: { createdAt: true, totalTokens: true, costSar: true },
    })
    const trend: { label: string; tokens: number; costSar: number }[] = []
    for (let i = 0; i < 6; i++) {
      const f = new Date(Date.UTC(year, month - 5 + i, 1))
      const t = new Date(Date.UTC(year, month - 4 + i, 1))
      const rows = trendRows.filter((r) => r.createdAt >= f && r.createdAt < t)
      trend.push({
        label: f.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }),
        tokens: rows.reduce((s, r) => s + r.totalTokens, 0),
        costSar: Math.round(rows.reduce((s, r) => s + r.costSar, 0) * 10000) / 10000,
      })
    }

    return ok({
      month: { label: `${year}-${String(month).padStart(2, '0')}`, ...monthTotals },
      perUser: perUser
        .map((u) => ({
          userName: u.userName ?? 'Unknown',
          requests: u._count._all,
          promptTokens: u._sum.promptTokens ?? 0,
          completionTokens: u._sum.completionTokens ?? 0,
          totalTokens: u._sum.totalTokens ?? 0,
          costSar: Math.round((u._sum.costSar ?? 0) * 10000) / 10000,
        }))
        .sort((a, b) => b.requests - a.requests),
      trend,
      sixMonthCost: Math.round((trendStart._sum.costSar ?? 0) * 10000) / 10000,
    })
  } catch {
    return serverError()
  }
}

// Activity log API — paginated, filterable audit trail (Activity Log view)
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import {
  ok,
  serverError,
  requirePermission,
  isResponse,
  parsePagination,
  paginatedResponse,
} from '@/lib/api-helpers'

// GET /api/activity
// Query: search, module, action, from, to, page, pageSize
export async function GET(req: NextRequest) {
  try {
    const auth = await requirePermission('activity.view')
    if (isResponse(auth)) return auth

    const { searchParams } = new URL(req.url)
    const p = parsePagination(searchParams)
    const search = searchParams.get('search')?.trim() ?? ''
    const moduleFilter = searchParams.get('module') ?? 'all'
    const action = searchParams.get('action') ?? 'all'
    const from = searchParams.get('from') ?? ''
    const to = searchParams.get('to') ?? ''

    const where: Record<string, unknown> = {}
    if (moduleFilter !== 'all') where.module = moduleFilter
    if (action !== 'all') where.action = action
    if (search) {
      where.OR = [
        { description: { contains: search } },
        { userName: { contains: search } },
      ]
    }
    if (from || to) {
      const createdAt: Record<string, Date> = {}
      if (from) createdAt.gte = new Date(`${from}T00:00:00.000`)
      if (to) createdAt.lte = new Date(`${to}T23:59:59.999`)
      where.createdAt = createdAt
    }

    const [total, rows] = await Promise.all([
      db.activityLog.count({ where }),
      db.activityLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: p.skip,
        take: p.take,
        select: {
          id: true,
          userName: true,
          action: true,
          module: true,
          description: true,
          amount: true,
          createdAt: true,
        },
      }),
    ])

    // Chips alongside the list (same filter scope, no pagination)
    const baseCreated = where.createdAt as { gte?: Date; lte?: Date } | undefined
    const later = (a?: Date, b?: Date) => (!a ? b : !b ? a : a > b ? a : b)
    const earlier = (a?: Date, b?: Date) => (!a ? b : !b ? a : a < b ? a : b)
    const todayStart = new Date(new Date().setHours(0, 0, 0, 0))
    const weekStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

    const todayWhere = { ...where, createdAt: {} as Record<string, Date> }
    const todayGte = later(todayStart, baseCreated?.gte)
    if (todayGte) todayWhere.createdAt.gte = todayGte
    const todayLte = earlier(baseCreated?.lte, undefined)
    if (todayLte) todayWhere.createdAt.lte = todayLte

    const weekWhere = { ...where, createdAt: {} as Record<string, Date> }
    const weekGte = later(weekStart, baseCreated?.gte)
    if (weekGte) weekWhere.createdAt.gte = weekGte
    const weekLte = earlier(baseCreated?.lte, undefined)
    if (weekLte) weekWhere.createdAt.lte = weekLte

    const [today, week, moneyEvents] = await Promise.all([
      db.activityLog.count({ where: todayWhere }),
      db.activityLog.count({ where: weekWhere }),
      db.activityLog.count({ where: { ...where, amount: { not: null } } }),
    ])

    return paginatedResponse(rows, total, p, {
      today,
      week,
      moneyEvents,
    })
  } catch {
    return serverError()
  }
}

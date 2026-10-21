// Today's Lists board — every list on the selected day (default today),
// grouped by client company. Each card: subject badge, list no., time,
// location/site, worker count and results so far.
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, serverError, requirePermission, isResponse } from '@/lib/api-helpers'
import { LIST_INCLUDE, mapListRow } from '@/lib/name-list-server'

export async function GET(req: NextRequest) {
  try {
    const auth = await requirePermission('namelist.view')
    if (isResponse(auth)) return auth

    const dateParam = req.nextUrl.searchParams.get('date')?.trim()
    const d = dateParam ? new Date(dateParam) : new Date()
    if (Number.isNaN(d.getTime())) return ok({ date: dateParam ?? '', groups: [] })

    const dayStart = new Date(d)
    dayStart.setHours(0, 0, 0, 0)
    const dayEnd = new Date(d)
    dayEnd.setHours(23, 59, 59, 999)

    const lists = await db.nameList.findMany({
      where: { date: { gte: dayStart, lte: dayEnd } },
      include: LIST_INCLUDE,
      orderBy: [{ clientId: 'asc' }, { time: 'asc' }, { seq: 'asc' }],
    })

    const grouped = new Map<
      string,
      { clientId: string; clientName: string; lists: ReturnType<typeof mapListRow>[] }
    >()
    for (const l of lists) {
      const row = mapListRow(l)
      if (!grouped.has(l.clientId)) {
        grouped.set(l.clientId, { clientId: l.clientId, clientName: row.clientName, lists: [] })
      }
      grouped.get(l.clientId)!.lists.push(row)
    }

    return ok({
      date: dayStart.toISOString(),
      groups: [...grouped.values()],
    })
  } catch {
    return serverError()
  }
}

// GET /api/attendance/stats?month=&year= — monthly KPI header for the attendance view.
// Without params it targets the LATEST month that has any attendance record
// (falls back to the current calendar month when there is no data at all).
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, serverError, requireAuth, isResponse, toInt } from '@/lib/api-helpers'
import { MONTHS } from '@/lib/types'

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth()
    if (isResponse(user)) return user

    const { searchParams } = new URL(req.url)
    let month = toInt(searchParams.get('month'), 0)
    let year = toInt(searchParams.get('year'), 0)

    // Default to the latest month holding attendance records
    if (month < 1 || month > 12 || year < 2000 || year > 2100) {
      const latest = await db.attendance.findFirst({
        orderBy: { checkIn: 'desc' },
        select: { checkIn: true },
      })
      const ref = latest?.checkIn ?? new Date()
      month = ref.getMonth() + 1
      year = ref.getFullYear()
    }

    const start = new Date(year, month - 1, 1)
    const end = new Date(year, month, 1) // rolls over to the 1st of the next month
    const where = { checkIn: { gte: start, lt: end } }

    const [sessions, openSessions, agg, distinctStaff] = await Promise.all([
      db.attendance.count({ where }),
      db.attendance.count({ where: { ...where, checkOut: null } }),
      db.attendance.aggregate({ where, _sum: { durationMinutes: true } }),
      db.attendance.findMany({ where, select: { staffId: true }, distinct: ['staffId'] }),
    ])

    const totalMinutes = agg._sum.durationMinutes ?? 0
    const closedSessions = sessions - openSessions

    return ok({
      month,
      year,
      label: `${MONTHS[month - 1]} ${year}`,
      totalSessions: sessions,
      openSessions,
      totalMinutes,
      totalHours: Math.round((totalMinutes / 60) * 100) / 100,
      distinctStaff: distinctStaff.length,
      avgSessionMinutes:
        closedSessions > 0 ? Math.round(totalMinutes / closedSessions) : 0,
    })
  } catch (err) {
    console.error('[api/attendance/stats GET]', err)
    return serverError()
  }
}

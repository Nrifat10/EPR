// GET /api/attendance/hours?staffId=&month=&year= → { totalMinutes, totalHours }
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import {
  badRequest,
  ok,
  serverError,
  requireAuth,
  isResponse,
  toInt,
} from '@/lib/api-helpers'
import { round2 } from '@/lib/format'

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth()
    if (isResponse(auth)) return auth

    const { searchParams } = new URL(req.url)
    const staffId = (searchParams.get('staffId') ?? '').trim()
    const month = toInt(searchParams.get('month'), 0)
    const year = toInt(searchParams.get('year'), 0)

    if (!staffId) return badRequest('Staff member is required')
    if (month < 1 || month > 12) return badRequest('Invalid month')
    if (year < 2000 || year > 2100) return badRequest('Invalid year')

    const staff = await db.staff.findUnique({ where: { id: staffId }, select: { id: true } })
    if (!staff) return badRequest('Staff member not found')

    const start = new Date(year, month - 1, 1)
    const end = new Date(year, month, 1) // rolls over to the 1st of the next month

    const agg = await db.attendance.aggregate({
      where: { staffId, checkIn: { gte: start, lt: end } },
      _sum: { durationMinutes: true },
    })

    const totalMinutes = agg._sum.durationMinutes ?? 0
    return ok({ totalMinutes, totalHours: round2(totalMinutes / 60) })
  } catch (err) {
    console.error('[api/attendance/hours GET]', err)
    return serverError()
  }
}

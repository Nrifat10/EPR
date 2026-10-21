// GET /api/staff/[id]/profile — employment & pay summary for the staff dialog.
// Sections are omitted (null) when the caller lacks the matching module permission.
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import {
  ok,
  notFound,
  serverError,
  requireAuth,
  isResponse,
} from '@/lib/api-helpers'
import { hasPermission } from '@/lib/auth'
import type { StaffProfileStats } from '@/lib/types'

const round2 = (n: number) => Math.round(n * 100) / 100

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth()
    if (isResponse(auth)) return auth
    const { id } = await params

    const staff = await db.staff.findUnique({
      where: { id },
      select: { id: true, joiningDate: true, deletedAt: true },
    })
    if (!staff || staff.deletedAt) return notFound('Staff member not found')

    const canPayroll = hasPermission(auth, 'payroll.view')
    const canAttendance = hasPermission(auth, 'attendance.view')

    const [payrollRecent, paidAgg, pendingCount, totalEntries, monthAgg, totalAgg] =
      await Promise.all([
        canPayroll
          ? db.payroll.findMany({
              where: { staffId: id },
              orderBy: [{ year: 'desc' }, { month: 'desc' }],
              take: 6,
              include: { project: { select: { name: true } } },
            })
          : Promise.resolve([]),
        canPayroll
          ? db.payroll.aggregate({ where: { staffId: id, status: 'paid' }, _sum: { netPay: true } })
          : Promise.resolve(null),
        canPayroll
          ? db.payroll.count({ where: { staffId: id, status: 'pending' } })
          : Promise.resolve(0),
        canPayroll ? db.payroll.count({ where: { staffId: id } }) : Promise.resolve(0),
        canAttendance
          ? db.attendance.aggregate({
              where: {
                staffId: id,
                durationMinutes: { not: null },
                checkIn: {
                  gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
                },
              },
              _sum: { durationMinutes: true },
            })
          : Promise.resolve(null),
        canAttendance
          ? db.attendance.aggregate({
              where: { staffId: id, durationMinutes: { not: null } },
              _count: { _all: true },
              _avg: { durationMinutes: true },
            })
          : Promise.resolve(null),
      ])

    // Months employed (approx, calendar difference)
    let monthsEmployed: number | null = null
    if (staff.joiningDate) {
      const start = new Date(staff.joiningDate)
      const now = new Date()
      monthsEmployed =
        (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth())
      if (now.getDate() < start.getDate()) monthsEmployed -= 1
      if (monthsEmployed < 0) monthsEmployed = 0
    }

    const data: StaffProfileStats = {
      staffId: staff.id,
      payroll: canPayroll
        ? {
            totalNetPaid: round2(paidAgg?._sum.netPay ?? 0),
            pendingCount,
            totalEntries,
            recent: payrollRecent.map((p) => ({
              id: p.id,
              month: p.month,
              year: p.year,
              netPay: round2(p.netPay),
              status: p.status as 'pending' | 'paid',
              project: p.project?.name ?? null,
            })),
          }
        : null,
      attendance: canAttendance
        ? {
            monthMinutes: monthAgg?._sum.durationMinutes ?? 0,
            totalSessions: totalAgg?._count._all ?? 0,
            avgHoursPerSession:
              totalAgg?._avg.durationMinutes != null
                ? round2((totalAgg._avg.durationMinutes ?? 0) / 60)
                : null,
          }
        : null,
      monthsEmployed,
    }

    return ok(data)
  } catch (err) {
    console.error('[api/staff/[id]/profile GET]', err)
    return serverError()
  }
}

// POST /api/attendance/[id]/checkout — quick action: closes an open attendance
// session. Check-out timestamp defaults to server "now" (optional `at` override
// for back-filling), duration is recomputed server-side.
import { NextRequest } from 'next/server'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { formatDuration } from '@/lib/format'
import {
  ok,
  badRequest,
  conflict,
  notFound,
  serverError,
  requirePermission,
  isResponse,
  logActivity,
  parseDate,
} from '@/lib/api-helpers'

const attendanceInclude = {
  staff: { select: { id: true, fullName: true, iqamaId: true } },
  project: { select: { id: true, name: true } },
} satisfies Prisma.AttendanceInclude

type AttendanceWithRelations = Prisma.AttendanceGetPayload<{ include: typeof attendanceInclude }>

type Params = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const auth = await requirePermission('attendance.edit')
    if (isResponse(auth)) return auth

    const { id } = await params
    const existing = await db.attendance.findUnique({ where: { id } })
    if (!existing) return notFound('Attendance record not found')
    if (existing.checkOut) {
      return conflict('This session is already checked out')
    }

    // Optional explicit timestamp (back-fill); defaults to server time
    let at: Date | null = null
    try {
      const body = (await req.json()) as { at?: string } | null
      if (body && typeof body.at === 'string' && body.at.trim() !== '') {
        at = parseDate(body.at)
        if (!at) return badRequest('Invalid check-out date & time')
      }
    } catch {
      // empty body is fine — use server time
    }
    const checkOut = at ?? new Date()
    if (checkOut.getTime() <= existing.checkIn.getTime()) {
      return badRequest('Check-out must be after check-in')
    }

    const durationMinutes = Math.round((checkOut.getTime() - existing.checkIn.getTime()) / 60000)

    const updated: AttendanceWithRelations = await db.attendance.update({
      where: { id },
      data: { checkOut, durationMinutes },
      include: attendanceInclude,
    })

    await logActivity({
      user: auth,
      action: 'updated',
      module: 'attendance',
      description: `Checked out ${updated.staff.fullName} after ${formatDuration(durationMinutes)}`,
    })

    return ok({
      id: updated.id,
      staff: updated.staff,
      project: updated.project,
      checkIn: updated.checkIn.toISOString(),
      checkOut: updated.checkOut ? updated.checkOut.toISOString() : null,
      durationMinutes: updated.durationMinutes,
    })
  } catch {
    return serverError()
  }
}

// PUT / DELETE /api/attendance/[id]
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import {
  ok,
  badRequest,
  notFound,
  serverError,
  requirePermission,
  isResponse,
  logActivity,
  parseDate,
} from '@/lib/api-helpers'
import type { AttendanceRow } from '@/lib/types'

const optionalId = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? null : v === undefined ? null : v),
  z.string().nullable()
)

const attendanceSchema = z.object({
  staffId: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim() : ''),
    z.string().min(1, 'Staff member is required')
  ),
  projectId: optionalId,
  checkIn: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim() : ''),
    z.string().min(1, 'Check-in date & time is required')
  ),
  checkOut: z.preprocess(
    (v) => (typeof v === 'string' ? (v.trim() === '' ? null : v.trim()) : v === undefined ? null : v),
    z.string().nullable()
  ),
})

const attendanceInclude = {
  staff: { select: { id: true, fullName: true, iqamaId: true } },
  project: { select: { id: true, name: true } },
} satisfies Prisma.AttendanceInclude

type AttendanceWithRelations = Prisma.AttendanceGetPayload<{ include: typeof attendanceInclude }>

function toAttendanceRow(a: AttendanceWithRelations): AttendanceRow {
  return {
    id: a.id,
    staff: a.staff,
    project: a.project,
    checkIn: a.checkIn.toISOString(),
    checkOut: a.checkOut ? a.checkOut.toISOString() : null,
    durationMinutes: a.durationMinutes,
  }
}

function resolveTimes(
  checkInRaw: string,
  checkOutRaw: string | null
): { checkIn: Date; checkOut: Date | null; durationMinutes: number | null } | { error: string } {
  const checkIn = parseDate(checkInRaw)
  if (!checkIn) return { error: 'Invalid check-in date & time' }

  let checkOut: Date | null = null
  if (checkOutRaw) {
    checkOut = parseDate(checkOutRaw)
    if (!checkOut) return { error: 'Invalid check-out date & time' }
    if (checkOut.getTime() <= checkIn.getTime()) {
      return { error: 'Check-out must be after check-in' }
    }
  }
  const durationMinutes = checkOut
    ? Math.round((checkOut.getTime() - checkIn.getTime()) / 60000)
    : null
  return { checkIn, checkOut, durationMinutes }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requirePermission('attendance.edit')
    if (isResponse(auth)) return auth
    const { id } = await params

    const existing = await db.attendance.findUnique({ where: { id } })
    if (!existing) return notFound('Attendance record not found')

    let json: unknown = null
    try {
      json = await req.json()
    } catch {
      json = null
    }
    const parsed = attendanceSchema.safeParse(json)
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? 'Invalid request data')
    }
    const data = parsed.data

    const staff = await db.staff.findFirst({ where: { id: data.staffId, deletedAt: null } })
    if (!staff) return badRequest('Staff member not found')

    if (data.projectId) {
      const project = await db.project.findUnique({ where: { id: data.projectId } })
      if (!project) return badRequest('Project not found')
    }

    const times = resolveTimes(data.checkIn, data.checkOut)
    if ('error' in times) return badRequest(times.error)

    const updated = await db.attendance.update({
      where: { id },
      data: {
        staffId: data.staffId,
        projectId: data.projectId,
        checkIn: times.checkIn,
        checkOut: times.checkOut,
        durationMinutes: times.durationMinutes,
      },
      include: attendanceInclude,
    })

    await logActivity({
      user: auth,
      action: 'updated',
      module: 'attendance',
      description: `Updated attendance for ${updated.staff.fullName}`,
    })

    return ok(toAttendanceRow(updated))
  } catch (err) {
    console.error('[api/attendance/[id] PUT]', err)
    return serverError()
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requirePermission('attendance.delete')
    if (isResponse(auth)) return auth
    const { id } = await params

    const existing = await db.attendance.findUnique({
      where: { id },
      include: { staff: { select: { fullName: true } } },
    })
    if (!existing) return notFound('Attendance record not found')

    await db.attendance.delete({ where: { id } })

    await logActivity({
      user: auth,
      action: 'deleted',
      module: 'attendance',
      description: `Deleted attendance record for ${existing.staff.fullName}`,
    })

    return ok({ success: true })
  } catch (err) {
    console.error('[api/attendance/[id] DELETE]', err)
    return serverError()
  }
}

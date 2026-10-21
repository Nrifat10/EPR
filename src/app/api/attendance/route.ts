// GET /api/attendance (list, paginated) + POST /api/attendance (create)
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import {
  ok,
  badRequest,
  serverError,
  requireAuth,
  requirePermission,
  isResponse,
  parsePagination,
  paginatedResponse,
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

/** Validate shared fields; returns { data } ready for prisma or an error string. */
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

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth()
    if (isResponse(auth)) return auth

    const { searchParams } = new URL(req.url)
    const p = parsePagination(searchParams)
    const staffId = (searchParams.get('staffId') ?? '').trim()
    const projectId = (searchParams.get('projectId') ?? '').trim()
    const search = (searchParams.get('search') ?? '').trim()
    const from = parseDate(searchParams.get('from'))
    const to = parseDate(searchParams.get('to'))
    if (to) to.setHours(23, 59, 59, 999) // include the whole "to" day

    const where: Prisma.AttendanceWhereInput = {}
    if (staffId) where.staffId = staffId
    if (projectId) where.projectId = projectId
    if (search) {
      where.staff = {
        OR: [{ fullName: { contains: search } }, { iqamaId: { contains: search } }],
      }
    }
    const checkIn: { gte?: Date; lte?: Date } = {}
    if (from) checkIn.gte = from
    if (to) checkIn.lte = to
    if (checkIn.gte || checkIn.lte) where.checkIn = checkIn

    const [total, rows] = await Promise.all([
      db.attendance.count({ where }),
      db.attendance.findMany({
        where,
        orderBy: { checkIn: 'desc' },
        skip: p.skip,
        take: p.take,
        include: attendanceInclude,
      }),
    ])

    return paginatedResponse(rows.map(toAttendanceRow), total, p)
  } catch (err) {
    console.error('[api/attendance GET]', err)
    return serverError()
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requirePermission('attendance.create')
    if (isResponse(auth)) return auth

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

    const attendance = await db.attendance.create({
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
      action: 'created',
      module: 'attendance',
      description: `Recorded attendance for ${staff.fullName}`,
    })

    return ok(toAttendanceRow(attendance), 201)
  } catch (err) {
    console.error('[api/attendance POST]', err)
    return serverError()
  }
}

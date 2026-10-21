// GET / PUT / DELETE /api/staff/[id] (DELETE = soft delete)
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import {
  ok,
  badRequest,
  notFound,
  conflict,
  serverError,
  requireAuth,
  requirePermission,
  isResponse,
  logActivity,
  toFloat,
  parseDate,
} from '@/lib/api-helpers'
import type { StaffRow, StaffStatus } from '@/lib/types'

const optionalText = z.preprocess(
  (v) => (typeof v === 'string' ? (v.trim() === '' ? null : v.trim()) : v === undefined ? null : v),
  z.string().nullable()
)

const optionalId = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? null : v === undefined ? null : v),
  z.string().nullable()
)

const money = (label: string) =>
  z.preprocess(
    (v) => toFloat(v, 0),
    z.number().min(0, `${label} cannot be negative`)
  )

const profilePhoto = z.preprocess(
  (v) => (typeof v === 'string' ? (v.trim() === '' ? null : v) : v === undefined ? null : v),
  z
    .string()
    .refine((v) => v.startsWith('data:image/'), 'Invalid photo format')
    .refine((v) => v.length < 3_000_000, 'Photo too large')
    .nullable()
)

const staffSchema = z.object({
  fullName: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim() : ''),
    z.string().min(1, 'Full name is required')
  ),
  phone: optionalText,
  position: optionalText,
  staffCategoryId: optionalId,
  iqamaId: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim() : ''),
    z.string().min(1, 'IQAMA ID is required')
  ),
  joiningDate: optionalText,
  iqamaExpiry: optionalText,
  passportExpiry: optionalText,
  // ---- Name List additions ----
  passportNo: optionalText,
  nationality: optionalText,
  bloodGroup: optionalText,
  experienceYears: z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? null : Number(v)),
    z
      .number()
      .int('Experience must be a whole number of years')
      .min(0, 'Experience cannot be negative')
      .max(60, 'Experience looks too high')
      .nullable()
  ),
  ratePerHour: money('Rate per hour'),
  overtimeRate: money('Overtime rate'),
  monthlySalary: money('Monthly salary'),
  profilePhoto,
  residentialAddress: optionalText,
  status: z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? undefined : v),
    z.enum(['active', 'inactive'], { error: 'Status must be active or inactive' }).optional()
  ),
  projectIds: z.preprocess(
    (v) =>
      Array.isArray(v)
        ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '')
        : [],
    z.array(z.string())
  ),
})

const staffInclude = {
  staffCategory: { select: { id: true, name: true } },
  projects: { include: { project: { select: { id: true, name: true } } } },
} satisfies Prisma.StaffInclude

type StaffWithRelations = Prisma.StaffGetPayload<{ include: typeof staffInclude }>

function toStaffRow(s: StaffWithRelations): StaffRow {
  return {
    id: s.id,
    fullName: s.fullName,
    phone: s.phone,
    position: s.position,
    iqamaId: s.iqamaId,
    iqamaExpiry: s.iqamaExpiry ? s.iqamaExpiry.toISOString() : null,
    passportExpiry: s.passportExpiry ? s.passportExpiry.toISOString() : null,
    joiningDate: s.joiningDate ? s.joiningDate.toISOString() : null,
    ratePerHour: s.ratePerHour,
    overtimeRate: s.overtimeRate,
    monthlySalary: s.monthlySalary,
    profilePhoto: s.profilePhoto,
    residentialAddress: s.residentialAddress,
    status: s.status as StaffStatus,
    staffCategory: s.staffCategory,
    projects: s.projects.map((ps) => ps.project),
    passportNo: s.passportNo,
    nationality: s.nationality,
    bloodGroup: s.bloodGroup,
    experienceYears: s.experienceYears,
    deploymentStatus: s.deploymentStatus,
  }
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth()
    if (isResponse(auth)) return auth
    const { id } = await params

    const staff = await db.staff.findFirst({ where: { id, deletedAt: null }, include: staffInclude })
    if (!staff) return notFound('Staff member not found')

    return ok(toStaffRow(staff))
  } catch (err) {
    console.error('[api/staff/[id] GET]', err)
    return serverError()
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requirePermission('staff.edit')
    if (isResponse(auth)) return auth
    const { id } = await params

    const existing = await db.staff.findFirst({ where: { id, deletedAt: null } })
    if (!existing) return notFound('Staff member not found')

    let json: unknown = null
    try {
      json = await req.json()
    } catch {
      json = null
    }
    const parsed = staffSchema.safeParse(json)
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? 'Invalid request data')
    }
    const data = parsed.data

    if (data.staffCategoryId) {
      const category = await db.staffCategory.findUnique({ where: { id: data.staffCategoryId } })
      if (!category) return badRequest('Category not found')
    }

    const duplicate = await db.staff.findFirst({
      where: { iqamaId: data.iqamaId, id: { not: id } },
    })
    if (duplicate) return conflict('A staff member with this IQAMA ID already exists')

    let joiningDate: Date | null = null
    if (data.joiningDate) {
      joiningDate = parseDate(data.joiningDate)
      if (!joiningDate) return badRequest('Invalid joining date')
    }
    let iqamaExpiry: Date | null = null
    if (data.iqamaExpiry) {
      iqamaExpiry = parseDate(data.iqamaExpiry)
      if (!iqamaExpiry) return badRequest('Invalid IQAMA expiry date')
    }
    let passportExpiry: Date | null = null
    if (data.passportExpiry) {
      passportExpiry = parseDate(data.passportExpiry)
      if (!passportExpiry) return badRequest('Invalid passport expiry date')
    }

    const projectIds = Array.from(new Set(data.projectIds))
    if (projectIds.length > 0) {
      const found = await db.project.findMany({
        where: { id: { in: projectIds } },
        select: { id: true },
      })
      if (found.length !== projectIds.length) {
        return badRequest('One or more selected projects were not found')
      }
    }

    try {
      const updated = await db.$transaction(async (tx) => {
        // sync project assignments FIRST so the returned staff row is fresh
        // (skipDuplicates is unsupported on SQLite → dedupe above)
        await tx.projectStaff.deleteMany({ where: { staffId: id } })
        if (projectIds.length > 0) {
          await tx.projectStaff.createMany({
            data: projectIds.map((projectId) => ({ projectId, staffId: id })),
          })
        }
        return await tx.staff.update({
          where: { id },
          data: {
            fullName: data.fullName,
            phone: data.phone,
            position: data.position,
            staffCategoryId: data.staffCategoryId,
            iqamaId: data.iqamaId,
            joiningDate,
            iqamaExpiry,
            passportExpiry,
            passportNo: data.passportNo,
            nationality: data.nationality,
            bloodGroup: data.bloodGroup,
            experienceYears: data.experienceYears,
            ratePerHour: data.ratePerHour,
            overtimeRate: data.overtimeRate,
            monthlySalary: data.monthlySalary,
            profilePhoto: data.profilePhoto,
            residentialAddress: data.residentialAddress,
            status: data.status ?? 'active',
          },
          include: staffInclude,
        })
      })

      await logActivity({
        user: auth,
        action: 'updated',
        module: 'staff',
        description: `Updated staff: ${updated.fullName}`,
      })

      return ok(toStaffRow(updated))
    } catch (err) {
      if (isUniqueViolation(err)) {
        return conflict('A staff member with this IQAMA ID already exists')
      }
      throw err
    }
  } catch (err) {
    console.error('[api/staff/[id] PUT]', err)
    return serverError()
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requirePermission('staff.delete')
    if (isResponse(auth)) return auth
    const { id } = await params

    const existing = await db.staff.findFirst({ where: { id, deletedAt: null } })
    if (!existing) return notFound('Staff member not found')

    // soft delete — keep history (attendance, payrolls) intact
    await db.staff.update({ where: { id }, data: { deletedAt: new Date() } })

    await logActivity({
      user: auth,
      action: 'deleted',
      module: 'staff',
      description: `Removed staff: ${existing.fullName}`,
    })

    return ok({ success: true })
  } catch (err) {
    console.error('[api/staff/[id] DELETE]', err)
    return serverError()
  }
}

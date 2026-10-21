// GET /api/staff (list, paginated) + POST /api/staff (create with project links)
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import {
  ok,
  badRequest,
  conflict,
  serverError,
  requireAuth,
  requirePermission,
  isResponse,
  parsePagination,
  paginatedResponse,
  logActivity,
  toFloat,
  parseDate,
} from '@/lib/api-helpers'
import type { StaffRow, StaffStatus } from '@/lib/types'
import { EXPIRY_WINDOW_DAYS } from '@/lib/expiry'

const STAFF_STATUSES = ['active', 'inactive']
const EXPIRY_FILTERS = ['expired', 'expiring', 'valid']

/** '' / undefined / whitespace → null, otherwise trimmed string */
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
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
  )
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth()
    if (isResponse(auth)) return auth

    const { searchParams } = new URL(req.url)
    const p = parsePagination(searchParams)
    const search = (searchParams.get('search') ?? '').trim()
    const projectId = (searchParams.get('projectId') ?? '').trim()
    const categoryId = (searchParams.get('categoryId') ?? '').trim()
    const status = (searchParams.get('status') ?? '').trim()
    const expiry = (searchParams.get('expiry') ?? '').trim()
    // Name List picker extras
    const nationality = (searchParams.get('nationality') ?? '').trim()
    const deployment = (searchParams.get('deploymentStatus') ?? '').trim()

    const now = new Date()
    const windowEnd = new Date(now.getTime() + EXPIRY_WINDOW_DAYS * 86_400_000)

    const where: Prisma.StaffWhereInput = { deletedAt: null }
    if (search) {
      where.OR = [
        { fullName: { contains: search } },
        { iqamaId: { contains: search } },
        { passportNo: { contains: search } },
        { phone: { contains: search } },
        { id: { contains: search } },
      ]
    }
    if (projectId) where.projects = { some: { projectId } }
    if (categoryId) where.staffCategoryId = categoryId
    if (status && STAFF_STATUSES.includes(status)) where.status = status
    if (nationality) where.nationality = { contains: nationality }
    if (deployment) where.deploymentStatus = deployment
    if (expiry && EXPIRY_FILTERS.includes(expiry)) {
      if (expiry === 'expired') where.iqamaExpiry = { lt: now }
      else if (expiry === 'expiring') where.iqamaExpiry = { gte: now, lte: windowEnd }
      else where.iqamaExpiry = { gt: windowEnd }
    }

    // Chips aggregate the SAME filtered scope as the list (Total = Active + Inactive always holds)
    const [total, staff, activeCount, inactiveCount, unassignedCount, salaryAgg, expiredCount, expiringCount] = await Promise.all([
      db.staff.count({ where }),
      db.staff.findMany({
        where,
        orderBy: { fullName: 'asc' },
        skip: p.skip,
        take: p.take,
        include: staffInclude,
      }),
      db.staff.count({ where: { AND: [where, { status: 'active' }] } }),
      db.staff.count({ where: { AND: [where, { status: 'inactive' }] } }),
      db.staff.count({ where: { AND: [where, { projects: { none: {} } }] } }),
      db.staff.aggregate({ where, _avg: { monthlySalary: true } }),
      db.staff.count({ where: { AND: [where, { iqamaExpiry: { lt: now } }] } }),
      db.staff.count({ where: { AND: [where, { iqamaExpiry: { gte: now, lte: windowEnd } }] } }),
    ])

    return paginatedResponse(staff.map(toStaffRow), total, p, {
      active: activeCount,
      inactive: inactiveCount,
      unassigned: unassignedCount,
      avgSalary: Math.round(salaryAgg._avg.monthlySalary ?? 0),
      expiredDocs: expiredCount,
      expiringDocs: expiringCount,
    })
  } catch (err) {
    console.error('[api/staff GET]', err)
    return serverError()
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requirePermission('staff.create')
    if (isResponse(auth)) return auth

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

    // unique check across ALL staff (incl. soft-deleted — DB constraint applies to them too)
    const duplicate = await db.staff.findFirst({ where: { iqamaId: data.iqamaId } })
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
      const staff = await db.staff.create({
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
          ...(projectIds.length > 0
            ? {
                projects: {
                  createMany: { data: projectIds.map((projectId) => ({ projectId })) },
                },
              }
            : {}),
        },
        include: staffInclude,
      })

      await logActivity({
        user: auth,
        action: 'created',
        module: 'staff',
        description: `Added new staff: ${staff.fullName}`,
      })

      return ok(toStaffRow(staff), 201)
    } catch (err) {
      if (isUniqueViolation(err)) {
        return conflict('A staff member with this IQAMA ID already exists')
      }
      throw err
    }
  } catch (err) {
    console.error('[api/staff POST]', err)
    return serverError()
  }
}

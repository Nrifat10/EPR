// GET / PUT / DELETE /api/projects/[id]
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
} from '@/lib/api-helpers'
import type { ProjectRow, ProjectStatus, StaffRow, StaffStatus } from '@/lib/types'

const projectSchema = z.object({
  name: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim() : ''),
    z.string().min(1, 'Project name is required')
  ),
  managerName: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim() : ''),
    z.string().min(1, 'Manager name is required')
  ),
  location: z.preprocess(
    (v) => (typeof v === 'string' ? (v.trim() === '' ? null : v.trim()) : v === undefined ? null : v),
    z.string().nullable()
  ),
  status: z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? undefined : v),
    z.enum(['active', 'inactive', 'completed'], {
      error: 'Status must be active, inactive, or completed',
    }).optional()
  ),
  clientId: z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? null : v),
    z.string().nullable()
  ),
  clientRatePerHour: z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? 0 : Number(v)),
    z
      .number({ error: 'Client rate must be a number' })
      .min(0, 'Client rate cannot be negative')
      .max(100000, 'Client rate is out of range')
  ).default(0),
})

const projectInclude = {
  _count: { select: { staff: true } },
  client: { select: { id: true, name: true } },
  staff: {
    include: {
      staff: {
        include: {
          staffCategory: { select: { id: true, name: true } },
          projects: { include: { project: { select: { id: true, name: true } } } },
        },
      },
    },
  },
} satisfies Prisma.ProjectInclude

type ProjectDetail = Prisma.ProjectGetPayload<{ include: typeof projectInclude }>

function toProjectRow(
  p: ProjectDetail,
  financials: { income: number; expense: number }
): ProjectRow {
  return {
    id: p.id,
    name: p.name,
    managerName: p.managerName,
    location: p.location,
    status: p.status as ProjectStatus,
    clientId: p.client?.id ?? null,
    clientName: p.client?.name ?? null,
    clientRatePerHour: p.clientRatePerHour,
    createdAt: p.createdAt.toISOString(),
    staffCount: p._count.staff,
    income: Math.round(financials.income * 100) / 100,
    expense: Math.round(financials.expense * 100) / 100,
    netProfit: Math.round((financials.income - financials.expense) * 100) / 100,
  }
}

function toStaffRow(s: Prisma.StaffGetPayload<{
  include: {
    staffCategory: { select: { id: true; name: true } }
    projects: { include: { project: { select: { id: true; name: true } } } }
  }
}>): StaffRow {
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

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth()
    if (isResponse(auth)) return auth
    const { id } = await params

    const project = await db.project.findUnique({ where: { id }, include: projectInclude })
    if (!project) return notFound('Project not found')

    const [incomeAgg, expenseAgg] = await Promise.all([
      db.transaction.aggregate({
        where: { projectId: id, type: 'income' },
        _sum: { amount: true },
      }),
      db.transaction.aggregate({
        where: { projectId: id, type: 'expense' },
        _sum: { amount: true },
      }),
    ])

    return ok({
      ...toProjectRow(project, {
        income: incomeAgg._sum.amount ?? 0,
        expense: expenseAgg._sum.amount ?? 0,
      }),
      staff: project.staff.map((ps) => toStaffRow(ps.staff)),
    })
  } catch (err) {
    console.error('[api/projects/[id] GET]', err)
    return serverError()
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requirePermission('projects.edit')
    if (isResponse(auth)) return auth
    const { id } = await params

    const existing = await db.project.findUnique({ where: { id } })
    if (!existing) return notFound('Project not found')

    let json: unknown = null
    try {
      json = await req.json()
    } catch {
      json = null
    }
    const parsed = projectSchema.safeParse(json)
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? 'Invalid request data')
    }
    const { name, managerName, location, clientId, clientRatePerHour } = parsed.data
    const status = parsed.data.status ?? 'active'

    if (clientId) {
      const client = await db.client.findUnique({ where: { id: clientId } })
      if (!client) return badRequest('Linked client not found')
    }

    const updated = await db.project.update({
      where: { id },
      data: { name, managerName, location, status, clientId, clientRatePerHour },
      include: { _count: { select: { staff: true } }, client: { select: { id: true, name: true } } },
    })

    await logActivity({
      user: auth,
      action: 'updated',
      module: 'project',
      description: `Updated project: ${updated.name}`,
    })

    const [incomeAgg, expenseAgg] = await Promise.all([
      db.transaction.aggregate({
        where: { projectId: id, type: 'income' },
        _sum: { amount: true },
      }),
      db.transaction.aggregate({
        where: { projectId: id, type: 'expense' },
        _sum: { amount: true },
      }),
    ])

    return ok({
      id: updated.id,
      name: updated.name,
      managerName: updated.managerName,
      location: updated.location,
      status: updated.status as ProjectStatus,
      clientId: updated.client?.id ?? null,
      clientName: updated.client?.name ?? null,
      clientRatePerHour: updated.clientRatePerHour,
      createdAt: updated.createdAt.toISOString(),
      staffCount: updated._count.staff,
      income: Math.round((incomeAgg._sum.amount ?? 0) * 100) / 100,
      expense: Math.round((expenseAgg._sum.amount ?? 0) * 100) / 100,
      netProfit:
        Math.round(((incomeAgg._sum.amount ?? 0) - (expenseAgg._sum.amount ?? 0)) * 100) / 100,
    })
  } catch (err) {
    console.error('[api/projects/[id] PUT]', err)
    return serverError()
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requirePermission('projects.delete')
    if (isResponse(auth)) return auth
    const { id } = await params

    const project = await db.project.findUnique({
      where: { id },
      include: {
        _count: {
          select: { staff: true, payrolls: true, attendances: true, transactions: true },
        },
      },
    })
    if (!project) return notFound('Project not found')

    const inUse =
      project._count.staff +
        project._count.payrolls +
        project._count.attendances +
        project._count.transactions >
      0
    if (inUse) {
      return conflict(
        'Cannot delete: project has assigned staff/records. Reassign or deactivate it instead.'
      )
    }

    await db.project.delete({ where: { id } })

    await logActivity({
      user: auth,
      action: 'deleted',
      module: 'project',
      description: `Deleted project: ${project.name}`,
    })

    return ok({ success: true })
  } catch (err) {
    console.error('[api/projects/[id] DELETE]', err)
    return serverError()
  }
}

// GET / PUT / DELETE /api/clients/[id] — detail incl. projects + deployed workers
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
import { clientSchema } from '../route'
import type { Client, DeployedWorker, ProjectStatus } from '@/lib/types'

type ClientDetail = Prisma.ClientGetPayload<{
  include: {
    projects: {
      include: {
        _count: { select: { staff: true } }
        staff: {
          include: {
            staff: {
              include: { staffCategory: { select: { name: true } } }
            }
          }
        }
      }
    }
  }
}>

function toWorker(
  ps: Prisma.ProjectStaffGetPayload<{
    include: {
      staff: { include: { staffCategory: { select: { name: true } } } }
      project: { include: { client: { select: { id: true; name: true } } } }
    }
  }>
): DeployedWorker {
  return {
    id: ps.staff.id,
    fullName: ps.staff.fullName,
    position: ps.staff.position,
    iqamaId: ps.staff.iqamaId,
    status: ps.staff.status as 'active' | 'inactive',
    profilePhoto: ps.staff.profilePhoto,
    ratePerHour: ps.staff.ratePerHour,
    monthlySalary: ps.staff.monthlySalary,
    categoryName: ps.staff.staffCategory?.name ?? null,
    projectId: ps.project?.id ?? null,
    projectName: ps.project?.name ?? null,
    clientId: ps.project?.client?.id ?? null,
    clientName: ps.project?.client?.name ?? null,
  }
}

function toClientDetail(c: ClientDetail, financials: Map<string, { income: number; expense: number }>): Client {
  const workers: DeployedWorker[] = []
  const seen = new Set<string>()
  for (const project of c.projects) {
    for (const ps of project.staff) {
      // A worker on two projects of the same client shows once (per-project view keeps both)
      if (seen.has(ps.staff.id)) continue
      seen.add(ps.staff.id)
      workers.push(
        toWorker({
          ...ps,
          project: {
            ...project,
            client: { id: c.id, name: c.name },
          },
        })
      )
    }
  }
  return {
    id: c.id,
    name: c.name,
    nameAr: c.nameAr,
    contactPerson: c.contactPerson,
    phone: c.phone,
    email: c.email,
    address: c.address,
    addressAr: c.addressAr,
    city: c.city,
    crNumber: c.crNumber,
    vatNumber: c.vatNumber,
    bankName: c.bankName,
    iban: c.iban,
    accountNumber: c.accountNumber,
    swiftCode: c.swiftCode,
    status: c.status as 'active' | 'inactive',
    notes: c.notes,
    createdAt: c.createdAt.toISOString(),
    projectCount: c.projects.length,
    deployedWorkers: workers.length,
    projects: c.projects.map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status as ProjectStatus,
      location: p.location,
      managerName: p.managerName,
      staffCount: p._count.staff,
      income: Math.round((financials.get(p.id)?.income ?? 0) * 100) / 100,
      expense: Math.round((financials.get(p.id)?.expense ?? 0) * 100) / 100,
    })),
    workers,
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth()
    if (isResponse(auth)) return auth
    const { id } = await params

    const client = await db.client.findUnique({
      where: { id },
      include: {
        projects: {
          orderBy: { createdAt: 'desc' },
          include: {
            _count: { select: { staff: true } },
            staff: { include: { staff: { include: { staffCategory: { select: { name: true } } } } } },
          },
        },
      },
    })
    if (!client) return notFound('Client not found')

    // Financial totals per project for viewers with accounts permission
    const [incomeRows, expenseRows] = await Promise.all([
      db.transaction.groupBy({
        by: ['projectId'],
        where: { type: 'income', projectId: { in: client.projects.map((p) => p.id) } },
        _sum: { amount: true },
      }),
      db.transaction.groupBy({
        by: ['projectId'],
        where: { type: 'expense', projectId: { in: client.projects.map((p) => p.id) } },
        _sum: { amount: true },
      }),
    ])
    const financials = new Map<string, { income: number; expense: number }>()
    for (const r of incomeRows) {
      if (!r.projectId) continue
      financials.set(r.projectId, { income: r._sum.amount ?? 0, expense: 0 })
    }
    for (const r of expenseRows) {
      if (!r.projectId) continue
      const cur = financials.get(r.projectId) ?? { income: 0, expense: 0 }
      cur.expense = r._sum.amount ?? 0
      financials.set(r.projectId, cur)
    }

    return ok(toClientDetail(client, financials))
  } catch (err) {
    console.error('[api/clients/[id] GET]', err)
    return serverError()
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requirePermission('clients.edit')
    if (isResponse(auth)) return auth
    const { id } = await params

    const existing = await db.client.findUnique({ where: { id } })
    if (!existing) return notFound('Client not found')

    let json: unknown = null
    try {
      json = await req.json()
    } catch {
      json = null
    }
    const parsed = clientSchema.safeParse(json)
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? 'Invalid request data')
    }
    const data = parsed.data

    if (data.name !== existing.name) {
      const duplicate = await db.client.findUnique({ where: { name: data.name } })
      if (duplicate) return badRequest('A client with this name already exists')
    }

    const updated = await db.client.update({ where: { id }, data })

    await logActivity({
      user: auth,
      action: 'updated',
      module: 'client',
      description: `Updated client: ${updated.name}`,
    })

    return ok({ success: true })
  } catch (err) {
    console.error('[api/clients/[id] PUT]', err)
    return serverError()
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requirePermission('clients.delete')
    if (isResponse(auth)) return auth
    const { id } = await params

    const client = await db.client.findUnique({
      where: { id },
      include: { _count: { select: { projects: true } } },
    })
    if (!client) return notFound('Client not found')

    if (client._count.projects > 0) {
      return conflict(
        'Cannot delete: projects are linked to this client. Unlink or reassign them first.'
      )
    }

    await db.client.delete({ where: { id } })

    await logActivity({
      user: auth,
      action: 'deleted',
      module: 'client',
      description: `Deleted client: ${client.name}`,
    })

    return ok({ success: true })
  } catch (err) {
    console.error('[api/clients/[id] DELETE]', err)
    return serverError()
  }
}

// Re-export schema type for lint happiness (zod schema shared with collection route)
export type ClientSchema = z.infer<typeof clientSchema>

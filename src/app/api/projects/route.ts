// GET /api/projects (list, paginated) + POST /api/projects (create)
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
} from '@/lib/api-helpers'
import type { ProjectRow, ProjectStatus } from '@/lib/types'

const PROJECT_STATUSES = ['active', 'inactive', 'completed']

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

type ProjectWithCount = Prisma.ProjectGetPayload<{
  include: {
    _count: { select: { staff: true } }
    client: { select: { id: true; name: true } }
  }
}>

/** Per-project income/expense totals keyed by projectId (from Transaction groupBy) */
async function projectFinancialTotals(
  projectIds: string[]
): Promise<Map<string, { income: number; expense: number }>> {
  const map = new Map<string, { income: number; expense: number }>()
  if (projectIds.length === 0) return map
  const [incomeRows, expenseRows] = await Promise.all([
    db.transaction.groupBy({
      by: ['projectId'],
      where: { type: 'income', projectId: { in: projectIds } },
      _sum: { amount: true },
    }),
    db.transaction.groupBy({
      by: ['projectId'],
      where: { type: 'expense', projectId: { in: projectIds } },
      _sum: { amount: true },
    }),
  ])
  for (const r of incomeRows) {
    if (!r.projectId) continue
    map.set(r.projectId, { income: r._sum.amount ?? 0, expense: 0 })
  }
  for (const r of expenseRows) {
    if (!r.projectId) continue
    const cur = map.get(r.projectId) ?? { income: 0, expense: 0 }
    cur.expense = r._sum.amount ?? 0
    map.set(r.projectId, cur)
  }
  return map
}

function toProjectRow(
  p: ProjectWithCount,
  staffCount: number,
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
    staffCount,
    income: Math.round(financials.income * 100) / 100,
    expense: Math.round(financials.expense * 100) / 100,
    netProfit: Math.round((financials.income - financials.expense) * 100) / 100,
  }
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth()
    if (isResponse(auth)) return auth

    const { searchParams } = new URL(req.url)
    const p = parsePagination(searchParams)
    const search = (searchParams.get('search') ?? '').trim()
    const status = (searchParams.get('status') ?? '').trim()
    // Name List site selector: only this client's projects
    const clientId = (searchParams.get('clientId') ?? '').trim()

    const where: Prisma.ProjectWhereInput = {}
    if (search) where.name = { contains: search }
    if (status && PROJECT_STATUSES.includes(status)) where.status = status
    if (clientId) where.clientId = clientId

    // KPI header: status counts + staff allocations + global income/expense
    const [total, projects, statusRows, staffAllocated, incomeAgg, expenseAgg] = await Promise.all([
      db.project.count({ where }),
      db.project.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: p.skip,
        take: p.take,
        include: {
          _count: { select: { staff: true } },
          client: { select: { id: true, name: true } },
        },
      }),
      db.project.groupBy({ by: ['status'], _count: true }),
      db.projectStaff.count(),
      db.transaction.aggregate({ where: { type: 'income', projectId: { not: null } }, _sum: { amount: true } }),
      db.transaction.aggregate({ where: { type: 'expense', projectId: { not: null } }, _sum: { amount: true } }),
    ])

    // Financial aggregates for the current page only (two grouped sums)
    const fin = await projectFinancialTotals(projects.map((pr) => pr.id))
    const data = projects.map((pr) =>
      toProjectRow(pr, pr._count.staff, fin.get(pr.id) ?? { income: 0, expense: 0 })
    )
    const totals: Record<string, number> = {
      active: 0,
      inactive: 0,
      completed: 0,
      staffAllocated,
      income: Math.round((incomeAgg._sum.amount ?? 0) * 100) / 100,
      expense: Math.round((expenseAgg._sum.amount ?? 0) * 100) / 100,
    }
    for (const row of statusRows) {
      totals[row.status] = row._count
    }
    return paginatedResponse(data, total, p, totals)
  } catch (err) {
    console.error('[api/projects GET]', err)
    return serverError()
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requirePermission('projects.create')
    if (isResponse(auth)) return auth

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

    // Validate the client link when provided
    if (clientId) {
      const client = await db.client.findUnique({ where: { id: clientId } })
      if (!client) return badRequest('Linked client not found')
    }

    const project = await db.project.create({
      data: { name, managerName, location, status, clientId, clientRatePerHour },
      include: {
        _count: { select: { staff: true } },
        client: { select: { id: true, name: true } },
      },
    })

    await logActivity({
      user: auth,
      action: 'created',
      module: 'project',
      description: `Created project: ${project.name}`,
    })

    return ok(toProjectRow(project, project._count.staff, { income: 0, expense: 0 }), 201)
  } catch (err) {
    console.error('[api/projects POST]', err)
    return serverError()
  }
}

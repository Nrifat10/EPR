// GET /api/deployments — the worker ↔ client-company deployment map.
//   ?mode=flat (default): paginated rows, one per ProjectStaff assignment
//     (or per unassigned worker when assignment=unassigned), with filters:
//     search, clientId, projectId, categoryId, status, assignment.
//   ?mode=grouped: per-client groups with projects and their workers
//     (not paginated — bounded dataset, capped for safety).
// Permission: clients.view (granted to all seeded roles; configurable).
import { NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import {
  ok,
  serverError,
  requirePermission,
  isResponse,
  parsePagination,
  paginatedResponse,
} from '@/lib/api-helpers'
import type {
  ClientDeploymentGroup,
  DeployedWorker,
  DeploymentTotals,
  ProjectStatus,
} from '@/lib/types'

const staffInclude = {
  staffCategory: { select: { name: true } },
} satisfies Prisma.StaffInclude

type StaffForWorker = Prisma.StaffGetPayload<{ include: typeof staffInclude }>

function toWorker(
  s: StaffForWorker,
  project?: { id: string; name: string; client?: { id: string; name: string } | null } | null
): DeployedWorker {
  return {
    id: s.id,
    fullName: s.fullName,
    position: s.position,
    iqamaId: s.iqamaId,
    status: s.status as 'active' | 'inactive',
    profilePhoto: s.profilePhoto,
    ratePerHour: s.ratePerHour,
    monthlySalary: s.monthlySalary,
    categoryName: s.staffCategory?.name ?? null,
    projectId: project?.id ?? null,
    projectName: project?.name ?? null,
    clientId: project?.client?.id ?? null,
    clientName: project?.client?.name ?? null,
  }
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requirePermission('clients.view')
    if (isResponse(auth)) return auth

    const { searchParams } = new URL(req.url)
    const mode = searchParams.get('mode') === 'grouped' ? 'grouped' : 'flat'
    const search = (searchParams.get('search') ?? '').trim()
    const clientId = (searchParams.get('clientId') ?? '').trim()
    const projectId = (searchParams.get('projectId') ?? '').trim()
    const categoryId = (searchParams.get('categoryId') ?? '').trim()
    const status = (searchParams.get('status') ?? '').trim()
    const assignment = (searchParams.get('assignment') ?? 'all').trim() // all | assigned | unassigned

    // --- Company-wide KPI totals (filter-independent, same pattern as other lists) ---
    const [assignmentsTotal, distinctWorkers, unassignedActive, clientCount] = await Promise.all([
      db.projectStaff.count({ where: { project: { clientId: { not: null } } } }),
      db.projectStaff
        .groupBy({ by: ['staffId'], where: { project: { clientId: { not: null } } } })
        .then((rows) => rows.length),
      db.staff.count({
        where: { deletedAt: null, status: 'active', projects: { none: {} } },
      }),
      db.client.count(),
    ])
    const totals: DeploymentTotals = {
      assignments: assignmentsTotal,
      distinctWorkers,
      unassignedActive,
      clientCount,
    }

    // ---------- GROUPED MODE ----------
    if (mode === 'grouped') {
      const clients = await db.client.findMany({
        orderBy: [{ status: 'asc' }, { name: 'asc' }],
        where: clientId ? { id: clientId } : search ? { name: { contains: search } } : undefined,
        include: {
          projects: {
            orderBy: { createdAt: 'desc' },
            include: {
              staff: {
                where: { staff: { deletedAt: null } },
                include: { staff: { include: staffInclude } },
                orderBy: { staff: { fullName: 'asc' } },
              },
            },
          },
        },
      })
      const groups: ClientDeploymentGroup[] = clients.map((c) => {
        const projects = c.projects.map((p) => ({
          id: p.id,
          name: p.name,
          status: p.status as ProjectStatus,
          location: p.location,
          workers: p.staff.map((ps) => toWorker(ps.staff, { id: p.id, name: p.name, client: { id: c.id, name: c.name } })),
        }))
        const distinct = new Set(projects.flatMap((p) => p.workers.map((w) => w.id)))
        return {
          client: {
            id: c.id,
            name: c.name,
            city: c.city,
            status: c.status as 'active' | 'inactive',
            contactPerson: c.contactPerson,
            phone: c.phone,
          },
          totalWorkers: distinct.size,
          activeProjects: projects.filter((p) => p.status === 'active').length,
          projects,
        }
      })
      return ok({ groups, totals })
    }

    // ---------- FLAT MODE ----------
    const p = parsePagination(searchParams)

    const staffWhere: Prisma.StaffWhereInput = {
      deletedAt: null,
      ...(search
        ? {
            OR: [
              { fullName: { contains: search } },
              { iqamaId: { contains: search } },
              { position: { contains: search } },
            ],
          }
        : {}),
      ...(status === 'active' || status === 'inactive' ? { status } : {}),
      ...(categoryId ? { staffCategoryId: categoryId } : {}),
    }

    if (assignment === 'unassigned') {
      // Workers with NO project assignment at all (the bench)
      const where: Prisma.StaffWhereInput = { ...staffWhere, projects: { none: {} } }
      const [total, staffRows] = await Promise.all([
        db.staff.count({ where }),
        db.staff.findMany({
          where,
          orderBy: { fullName: 'asc' },
          skip: p.skip,
          take: p.take,
          include: staffInclude,
        }),
      ])
      return paginatedResponse(
        staffRows.map((s) => toWorker(s, null)),
        total,
        p,
        totals
      )
    }

    // Assigned rows: one row per ProjectStaff entry (rows on projects without
    // a client are included — they render with an em-dash client)
    const where: Prisma.ProjectStaffWhereInput = {
      staff: staffWhere,
      project: {
        ...(projectId ? { id: projectId } : {}),
        ...(clientId ? { clientId } : {}),
      },
      ...(search
        ? {
            OR: [
              { staff: { fullName: { contains: search } } },
              { staff: { iqamaId: { contains: search } } },
              { staff: { position: { contains: search } } },
              { project: { name: { contains: search } } },
              { project: { client: { name: { contains: search } } } },
            ],
          }
        : {}),
    }

    const [total, rows] = await Promise.all([
      db.projectStaff.count({ where }),
      db.projectStaff.findMany({
        where,
        orderBy: [{ staff: { fullName: 'asc' } }],
        skip: p.skip,
        take: p.take,
        include: {
          staff: { include: staffInclude },
          project: { include: { client: { select: { id: true, name: true } } } },
        },
      }),
    ])

    return paginatedResponse(
      rows.map((r) => toWorker(r.staff, r.project)),
      total,
      p,
      totals
    )
  } catch (err) {
    console.error('[api/deployments GET]', err)
    return serverError()
  }
}

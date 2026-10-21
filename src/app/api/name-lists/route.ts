// Name List (worker deployment lists) API — GET (paginated + filters) / POST.
// Filters: ?search (list no / client / location) ?subjectId ?kind ?clientId
//          ?status ?date (exact) ?dateFrom ?dateTo ?staffId (lists containing
//          the worker — used by the employee history tab).
import { NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { db } from '@/lib/db'
import {
  ok,
  badRequest,
  serverError,
  requirePermission,
  isResponse,
  parsePagination,
  paginatedResponse,
  logActivity,
} from '@/lib/api-helpers'
import { LIST_INCLUDE, mapListRow, nextListNo, findWorkerConflicts } from '@/lib/name-list-server'

const createSchema = z.object({
  date: z.string().min(1, 'Date is required'),
  time: z.string().max(10).nullable().optional(),
  clientId: z.string().min(1, 'Client company is required'),
  location: z.string().max(200).nullable().optional(),
  projectId: z.string().nullable().optional(),
  subjectId: z.string().min(1, 'Subject is required'),
  positions: z.array(z.string().max(60)).max(20).optional(),
  clientContact: z.string().max(120).nullable().optional(),
  clientPhone: z.string().max(40).nullable().optional(),
  transport: z.string().max(200).nullable().optional(),
  refPoNo: z.string().max(60).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  columns: z.record(z.string(), z.boolean()).nullable().optional(),
  workers: z.array(z.string()).max(500).optional(),
})

export async function GET(req: NextRequest) {
  try {
    const auth = await requirePermission('namelist.view')
    if (isResponse(auth)) return auth

    const sp = req.nextUrl.searchParams
    const p = parsePagination(sp)

    const where: Prisma.NameListWhereInput = {}
    const search = sp.get('search')?.trim()
    if (search) {
      where.OR = [
        { listNo: { contains: search } },
        { client: { is: { name: { contains: search } } } },
        { location: { contains: search } },
      ]
    }
    const subjectId = sp.get('subjectId')?.trim()
    if (subjectId) where.subjectId = subjectId
    const kind = sp.get('kind')?.trim()
    if (kind === 'interview' || kind === 'mobilization') where.subject = { is: { kind } }
    const clientId = sp.get('clientId')?.trim()
    if (clientId) where.clientId = clientId
    const status = sp.get('status')?.trim()
    if (status === 'draft' || status === 'sent' || status === 'completed' || status === 'cancelled') {
      where.status = status
    }
    const date = sp.get('date')?.trim()
    if (date) {
      const d = new Date(date)
      if (!Number.isNaN(d.getTime())) {
        const dayStart = new Date(d)
        dayStart.setHours(0, 0, 0, 0)
        const dayEnd = new Date(d)
        dayEnd.setHours(23, 59, 59, 999)
        where.date = { gte: dayStart, lte: dayEnd }
      }
    } else {
      const dateFrom = sp.get('dateFrom')?.trim()
      const dateTo = sp.get('dateTo')?.trim()
      const range: Prisma.DateTimeFilter | undefined =
        dateFrom && dateTo
          ? { gte: new Date(dateFrom), lte: new Date(new Date(dateTo).getTime() + 86399000) }
          : dateFrom
            ? { gte: new Date(dateFrom) }
            : dateTo
              ? { lte: new Date(new Date(dateTo).getTime() + 86399000) }
              : undefined
      if (range) where.date = range
    }
    const staffId = sp.get('staffId')?.trim()
    if (staffId) where.workers = { some: { staffId } }

    const [rows, total, statusGroups] = await Promise.all([
      db.nameList.findMany({
        where,
        include: LIST_INCLUDE,
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        skip: p.skip,
        take: p.take,
      }),
      db.nameList.count({ where }),
      db.nameList.groupBy({ by: ['status'], where, _count: { _all: true } }),
    ])

    const totals: Record<string, number> = { draft: 0, sent: 0, completed: 0, cancelled: 0 }
    for (const g of statusGroups) totals[g.status] = g._count._all

    let mapped = rows.map(mapListRow)
    // employee history tab — attach this worker's own result + remarks per list
    if (staffId && mapped.length > 0) {
      const mine = await db.nameListWorker.findMany({
        where: { staffId, nameListId: { in: mapped.map((m) => m.id) } },
        select: { nameListId: true, result: true, remarks: true },
      })
      const byList = new Map(mine.map((m) => [m.nameListId, m]))
      mapped = mapped.map((m) => {
        const w = byList.get(m.id)
        return {
          ...m,
          staffResult: w?.result ?? null,
          staffRemarks: w?.remarks ?? null,
        }
      })
    }

    return paginatedResponse(mapped, total, p, totals)
  } catch {
    return serverError()
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requirePermission('namelist.create')
    if (isResponse(auth)) return auth

    let raw: unknown
    try {
      raw = await req.json()
    } catch {
      return badRequest('Invalid JSON body')
    }
    const parsed = createSchema.safeParse(raw)
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? 'Invalid request body')
    }
    const body = parsed.data

    const date = new Date(body.date)
    if (Number.isNaN(date.getTime())) return badRequest('Invalid date')

    const [client, subject] = await Promise.all([
      db.client.findUnique({ where: { id: body.clientId } }),
      db.nameListSubject.findUnique({ where: { id: body.subjectId } }),
    ])
    if (!client) return badRequest('Client company not found')
    if (!subject) return badRequest('Subject not found')

    // workers must exist and not be duplicates within the list
    const staffIds = [...new Set(body.workers ?? [])]
    if (staffIds.length > 0) {
      const found = await db.staff.findMany({ where: { id: { in: staffIds } }, select: { id: true } })
      if (found.length !== staffIds.length) return badRequest('One or more workers were not found')
    }

    const created = await db.$transaction(async (tx) => {
      const no = await nextListNo(tx, date)
      const list = await tx.nameList.create({
        data: {
          ...no,
          date,
          time: body.time?.trim() || null,
          clientId: body.clientId,
          location: body.location?.trim() || null,
          projectId: body.projectId?.trim() || null,
          subjectId: body.subjectId,
          positions: body.positions?.length ? JSON.stringify(body.positions) : null,
          clientContact: body.clientContact?.trim() || null,
          clientPhone: body.clientPhone?.trim() || null,
          transport: body.transport?.trim() || null,
          refPoNo: body.refPoNo?.trim() || null,
          notes: body.notes?.trim() || null,
          columns: body.columns ? JSON.stringify(body.columns) : null,
          createdById: auth.id,
          createdByName: auth.name,
          workers: {
            create: staffIds.map((staffId, i) => ({ staffId, sortOrder: i })),
          },
        },
      })
      // interview-kind lists move added workers to "In Interview"
      if (subject.kind === 'interview' && staffIds.length > 0) {
        await tx.staff.updateMany({
          where: { id: { in: staffIds }, deploymentStatus: 'available' },
          data: { deploymentStatus: 'in_interview' },
        })
      }
      return list
    })

    // warnings (never blocking): same day+time on another list / already deployed
    const warnings: { staffId: string; type: string; message: string }[] = []
    if (staffIds.length > 0) {
      const staff = await db.staff.findMany({
        where: { id: { in: staffIds } },
        select: { id: true, fullName: true, deploymentStatus: true },
      })
      for (const s of staff) {
        const conflicts = await findWorkerConflicts(s.id, date, body.time?.trim() || null, created.id)
        if (conflicts.length > 0) {
          warnings.push({
            staffId: s.id,
            type: 'conflict',
            message: `${s.fullName} is also on ${conflicts.map((c) => c.listNo).join(', ')} on the same date & time.`,
          })
        } else if (s.deploymentStatus === 'deployed') {
          warnings.push({
            staffId: s.id,
            type: 'deployed',
            message: `${s.fullName} is already Deployed on a site.`,
          })
        }
      }
    }

    await logActivity({
      user: auth,
      action: 'created',
      module: 'namelist',
      description: `Name List ${created.listNo} — ${subject.name} · ${client.name} · ${staffIds.length} worker(s)`,
    })
    return ok({ id: created.id, listNo: created.listNo, warnings }, 201)
  } catch {
    return serverError()
  }
}

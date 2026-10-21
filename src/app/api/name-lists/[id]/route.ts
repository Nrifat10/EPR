// Name List [id] API — GET (detail with workers) / PUT (header + workers sync,
// draft/sent only) / DELETE (completed lists are Admin-only).
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import {
  ok,
  badRequest,
  notFound,
  serverError,
  requirePermission,
  isResponse,
  logActivity,
} from '@/lib/api-helpers'
import {
  getListDetail,
  findWorkerConflicts,
  recomputeWorkerStatus,
  applyResultStatus,
} from '@/lib/name-list-server'

type Params = { params: Promise<{ id: string }> }

const workerSchema = z.object({
  staffId: z.string().min(1),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  result: z.enum(['selected', 'rejected', 'absent', 'onhold']).nullable().optional(),
  remarks: z.string().max(500).nullable().optional(),
})

const updateSchema = z.object({
  date: z.string().min(1).optional(),
  time: z.string().max(10).nullable().optional(),
  clientId: z.string().min(1).optional(),
  location: z.string().max(200).nullable().optional(),
  projectId: z.string().nullable().optional(),
  subjectId: z.string().min(1).optional(),
  positions: z.array(z.string().max(60)).max(20).optional(),
  clientContact: z.string().max(120).nullable().optional(),
  clientPhone: z.string().max(40).nullable().optional(),
  transport: z.string().max(200).nullable().optional(),
  refPoNo: z.string().max(60).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  columns: z.record(z.string(), z.boolean()).nullable().optional(),
  workers: z.array(workerSchema).max(500).optional(),
})

function isAdmin(user: { role: { name: string } | null }): boolean {
  const n = user.role?.name?.toLowerCase() ?? ''
  return n === 'admin' || n === 'super admin' || n === 'administrator'
}

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const auth = await requirePermission('namelist.view')
    if (isResponse(auth)) return auth

    const { id } = await params
    const detail = await getListDetail(id)
    if (!detail) return notFound('Name list not found')

    // add-worker warnings for the editor (conflicts / deployed / missing data)
    const warnings: {
      staffId: string
      type: 'conflict' | 'deployed' | 'missing'
      message: string
    }[] = []
    for (const w of detail.workers) {
      const conflicts = await findWorkerConflicts(
        w.staffId,
        new Date(detail.date),
        detail.time,
        detail.id
      )
      if (conflicts.length > 0) {
        warnings.push({
          staffId: w.staffId,
          type: 'conflict',
          message: `Also on ${conflicts.map((c) => c.listNo).join(', ')} at the same date & time.`,
        })
      } else if (w.staff.deploymentStatus === 'deployed') {
        warnings.push({
          staffId: w.staffId,
          type: 'deployed',
          message: 'Already deployed on a site.',
        })
      }
      if (!w.staff.phone || !w.staff.passportNo || !w.staff.bloodGroup) {
        const missing: string[] = []
        if (!w.staff.phone) missing.push('Mobile No.')
        if (!w.staff.passportNo) missing.push('Passport No.')
        if (!w.staff.bloodGroup) missing.push('Blood Group')
        warnings.push({
          staffId: w.staffId,
          type: 'missing',
          message: `Missing in employee record: ${missing.join(', ')}.`,
        })
      }
    }
    return ok({ ...detail, warnings })
  } catch {
    return serverError()
  }
}

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const auth = await requirePermission('namelist.edit')
    if (isResponse(auth)) return auth

    const { id } = await params
    const list = await db.nameList.findUnique({
      where: { id },
      include: { subject: true, workers: { select: { staffId: true, result: true } } },
    })
    if (!list) return notFound('Name list not found')

    let raw: unknown
    try {
      raw = await req.json()
    } catch {
      return badRequest('Invalid JSON body')
    }
    // Columns-only updates (print preference from the print dialog) stay
    // allowed on read-only lists — hiding data for client copies must always
    // work, including reprints of completed lists.
    const rawKeys = Object.keys((raw ?? {}) as Record<string, unknown>)
    const columnsOnly = rawKeys.length === 1 && rawKeys[0] === 'columns'
    if ((list.status === 'completed' || list.status === 'cancelled') && !columnsOnly) {
      return badRequest(`A ${list.status} list is read-only.`)
    }
    const parsed = updateSchema.safeParse(raw)
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? 'Invalid request body')
    }
    const body = parsed.data

    if (body.date) {
      const d = new Date(body.date)
      if (Number.isNaN(d.getTime())) return badRequest('Invalid date')
    }
    if (body.clientId) {
      const client = await db.client.findUnique({ where: { id: body.clientId } })
      if (!client) return badRequest('Client company not found')
    }
    let newSubject = list.subject
    if (body.subjectId && body.subjectId !== list.subjectId) {
      const found = await db.nameListSubject.findUnique({ where: { id: body.subjectId } })
      if (!found) return badRequest('Subject not found')
      newSubject = found
    }

    const hadResults = list.workers.some((w) => w.result)

    await db.$transaction(async (tx) => {
      await tx.nameList.update({
        where: { id },
        data: {
          ...(body.date ? { date: new Date(body.date) } : {}),
          ...(body.time !== undefined ? { time: body.time?.trim() || null } : {}),
          ...(body.clientId ? { clientId: body.clientId } : {}),
          ...(body.location !== undefined ? { location: body.location?.trim() || null } : {}),
          ...(body.projectId !== undefined ? { projectId: body.projectId?.trim() || null } : {}),
          ...(body.subjectId ? { subjectId: body.subjectId } : {}),
          ...(body.positions
            ? { positions: body.positions.length ? JSON.stringify(body.positions) : null }
            : {}),
          ...(body.clientContact !== undefined
            ? { clientContact: body.clientContact?.trim() || null }
            : {}),
          ...(body.clientPhone !== undefined ? { clientPhone: body.clientPhone?.trim() || null } : {}),
          ...(body.transport !== undefined ? { transport: body.transport?.trim() || null } : {}),
          ...(body.refPoNo !== undefined ? { refPoNo: body.refPoNo?.trim() || null } : {}),
          ...(body.notes !== undefined ? { notes: body.notes?.trim() || null } : {}),
          ...(body.columns !== undefined
            ? { columns: body.columns ? JSON.stringify(body.columns) : null }
            : {}),
        },
      })

      if (body.workers) {
        const next = body.workers
        const prevIds = new Set(list.workers.map((w) => w.staffId))
        const nextIds = new Set(next.map((w) => w.staffId))
        if (next.length !== nextIds.size) return badRequest('Duplicate workers in the list')

        // verify all staff exist
        if (nextIds.size > 0) {
          const found = await tx.staff.findMany({
            where: { id: { in: [...nextIds] } },
            select: { id: true },
          })
          if (found.length !== nextIds.size) throw new Error('WORKER_NOT_FOUND')
        }

        // remove rows that disappeared
        const removed = [...prevIds].filter((sid) => !nextIds.has(sid))
        if (removed.length > 0) {
          await tx.nameListWorker.deleteMany({
            where: { nameListId: id, staffId: { in: removed } },
          })
        }
        // upsert everything else with fresh order/results
        for (let i = 0; i < next.length; i++) {
          const w = next[i]
          await tx.nameListWorker.upsert({
            where: { nameListId_staffId: { nameListId: id, staffId: w.staffId } },
            update: {
              sortOrder: w.sortOrder ?? i,
              ...(w.result !== undefined ? { result: w.result } : {}),
              ...(w.remarks !== undefined ? { remarks: w.remarks?.trim() || null } : {}),
            },
            create: {
              nameListId: id,
              staffId: w.staffId,
              sortOrder: w.sortOrder ?? i,
              result: w.result ?? null,
              remarks: w.remarks?.trim() || null,
            },
          })
        }
      }
    })

    // ── automations after the write ──
    if (body.workers) {
      const prevIds = new Set(list.workers.map((w) => w.staffId))
      const nextIds = new Set(body.workers.map((w) => w.staffId))
      const kind = newSubject.kind

      // removed workers → recompute (Available unless kept by another list)
      for (const sid of prevIds) {
        if (!nextIds.has(sid)) await recomputeWorkerStatus(sid)
      }
      // newly added on interview-kind lists → In Interview
      if (kind === 'interview') {
        const added = [...nextIds].filter((sid) => !prevIds.has(sid))
        if (added.length > 0) {
          await db.staff.updateMany({
            where: { id: { in: added }, deploymentStatus: 'available' },
            data: { deploymentStatus: 'in_interview' },
          })
        }
      }
      // result transitions
      if (hadResults || body.workers.some((w) => w.result)) {
        const prevResults = new Map(list.workers.map((w) => [w.staffId, w.result]))
        for (const w of body.workers) {
          if (w.result !== undefined && w.result !== prevResults.get(w.staffId)) {
            await applyResultStatus(w.staffId, w.result)
          }
        }
      }
      if (list.subject.kind === 'interview' && newSubject.kind === 'mobilization') {
        // subject changed interview → mobilization: workers are no longer "in interview"
        for (const sid of nextIds) await recomputeWorkerStatus(sid)
      }
    }

    // warnings for the updated worker set
    const warnings: { staffId: string; type: string; message: string }[] = []
    if (body.workers) {
      const fresh = await db.nameList.findUnique({
        where: { id },
        select: { date: true, time: true },
      })
      for (const w of body.workers) {
        const conflicts = await findWorkerConflicts(
          w.staffId,
          fresh?.date ?? list.date,
          fresh?.time ?? list.time,
          id
        )
        if (conflicts.length > 0) {
          warnings.push({
            staffId: w.staffId,
            type: 'conflict',
            message: `Also on ${conflicts.map((c) => c.listNo).join(', ')} at the same date & time.`,
          })
        }
      }
    }

    await logActivity({
      user: auth,
      action: 'updated',
      module: 'namelist',
      description: `Name List ${list.listNo} — details updated${body.workers ? ` · ${body.workers.length} worker(s)` : ''}`,
    })
    return ok({ updated: true, warnings })
  } catch (e) {
    if (e instanceof Error && e.message === 'WORKER_NOT_FOUND') {
      return badRequest('One or more workers were not found')
    }
    return serverError()
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const auth = await requirePermission('namelist.delete')
    if (isResponse(auth)) return auth

    const { id } = await params
    const list = await db.nameList.findUnique({
      where: { id },
      include: { subject: true, workers: { select: { staffId: true } } },
    })
    if (!list) return notFound('Name list not found')

    // Only Admin can delete a Completed list.
    if (list.status === 'completed' && !isAdmin(auth)) {
      return badRequest('Only Admin can delete a Completed list.')
    }

    await db.$transaction(async (tx) => {
      await tx.nameList.delete({ where: { id } })
    })

    // deleting a list frees its workers (recompute, non-blocking)
    for (const w of list.workers) await recomputeWorkerStatus(w.staffId)

    await logActivity({
      user: auth,
      action: 'deleted',
      module: 'namelist',
      description: `Name List ${list.listNo} — ${list.subject.name} · ${list.clientId} · deleted`,
    })
    return ok({ deleted: true })
  } catch {
    return serverError()
  }
}

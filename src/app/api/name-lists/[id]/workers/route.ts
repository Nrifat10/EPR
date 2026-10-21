// Name List workers API — POST (bulk add with warnings), PATCH
// (reorder | remove | per-worker result/remarks updates | resultAll quick action).
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
import { applyResultStatus, findWorkerConflicts, recomputeWorkerStatus } from '@/lib/name-list-server'

type Params = { params: Promise<{ id: string }> }

const addSchema = z.object({
  staffIds: z.array(z.string().min(1)).min(1, 'Select at least one worker').max(500),
})

const patchSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('reorder'), order: z.array(z.string().min(1)).min(1) }),
  z.object({ op: z.literal('remove'), staffId: z.string().min(1) }),
  z.object({
    op: z.literal('result'),
    updates: z
      .array(
        z.object({
          workerId: z.string().min(1),
          result: z.enum(['selected', 'rejected', 'absent', 'onhold']).nullable(),
          remarks: z.string().max(500).nullable().optional(),
        })
      )
      .min(1)
      .max(500),
  }),
  z.object({
    op: z.literal('resultAll'),
    result: z.enum(['selected', 'rejected', 'absent', 'onhold']),
  }),
])

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const auth = await requirePermission('namelist.edit')
    if (isResponse(auth)) return auth

    const { id } = await params
    const list = await db.nameList.findUnique({
      where: { id },
      include: { subject: true, workers: { select: { staffId: true } } },
    })
    if (!list) return notFound('Name list not found')
    if (list.status === 'completed' || list.status === 'cancelled') {
      return badRequest(`A ${list.status} list is read-only.`)
    }

    let raw: unknown
    try {
      raw = await req.json()
    } catch {
      return badRequest('Invalid JSON body')
    }
    const parsed = addSchema.safeParse(raw)
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? 'Invalid request body')
    }
    const staffIds = [...new Set(parsed.data.staffIds)]

    const existing = new Set(list.workers.map((w) => w.staffId))
    const toAdd = staffIds.filter((sid) => !existing.has(sid))
    if (toAdd.length === 0) {
      return ok({ added: 0, warnings: [], message: 'All selected workers are already in this list.' })
    }

    const found = await db.staff.findMany({
      where: { id: { in: toAdd }, deletedAt: null },
      select: { id: true, fullName: true, deploymentStatus: true },
    })
    if (found.length !== toAdd.length) return badRequest('One or more workers were not found')

    const baseOrder = list.workers.length
    // (no skipDuplicates — SQLite doesn't support it; `existing` already deduped)
    await db.nameListWorker.createMany({
      data: toAdd.map((staffId, i) => ({
        nameListId: id,
        staffId,
        sortOrder: baseOrder + i,
      })),
    })

    // interview-kind → workers move to "In Interview"
    if (list.subject.kind === 'interview') {
      await db.staff.updateMany({
        where: { id: { in: toAdd }, deploymentStatus: 'available' },
        data: { deploymentStatus: 'in_interview' },
      })
    }

    // warnings — never blocking
    const warnings: { staffId: string; type: string; message: string }[] = []
    for (const s of found) {
      const conflicts = await findWorkerConflicts(s.id, list.date, list.time, id)
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

    await logActivity({
      user: auth,
      action: 'updated',
      module: 'namelist',
      description: `Name List ${list.listNo} — ${toAdd.length} worker(s) added`,
    })
    return ok({ added: toAdd.length, warnings })
  } catch {
    return serverError()
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const auth = await requirePermission('namelist.edit')
    if (isResponse(auth)) return auth

    const { id } = await params
    const list = await db.nameList.findUnique({
      where: { id },
      include: { subject: true, workers: { select: { id: true, staffId: true, result: true } } },
    })
    if (!list) return notFound('Name list not found')
    if (list.status === 'completed' || list.status === 'cancelled') {
      return badRequest(`A ${list.status} list is read-only.`)
    }

    let raw: unknown
    try {
      raw = await req.json()
    } catch {
      return badRequest('Invalid JSON body')
    }
    const parsed = patchSchema.safeParse(raw)
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? 'Invalid request body')
    }
    const body = parsed.data

    if (body.op === 'reorder') {
      const idSet = new Set(list.workers.map((w) => w.staffId))
      if (body.order.length !== idSet.size || body.order.some((sid) => !idSet.has(sid))) {
        return badRequest('Reorder payload must contain every worker exactly once')
      }
      await db.$transaction(
        body.order.map((staffId, i) =>
          db.nameListWorker.update({
            where: { nameListId_staffId: { nameListId: id, staffId } },
            data: { sortOrder: i },
          })
        )
      )
      return ok({ reordered: true })
    }

    if (body.op === 'remove') {
      const row = list.workers.find((w) => w.staffId === body.staffId)
      if (!row) return notFound('Worker is not in this list')
      await db.nameListWorker.delete({ where: { id: row.id } })
      await recomputeWorkerStatus(body.staffId)
      await logActivity({
        user: auth,
        action: 'updated',
        module: 'namelist',
        description: `Name List ${list.listNo} — worker removed`,
      })
      return ok({ removed: true })
    }

    if (body.op === 'result') {
      const byId = new Map(list.workers.map((w) => [w.id, w]))
      const prevByStaff = new Map(list.workers.map((w) => [w.staffId, w.result]))
      for (const u of body.updates) {
        const row = byId.get(u.workerId)
        if (!row) return badRequest('One of the workers is not in this list')
        await db.nameListWorker.update({
          where: { id: u.workerId },
          data: {
            result: u.result,
            ...(u.remarks !== undefined ? { remarks: u.remarks?.trim() || null } : {}),
          },
        })
        // deployment automation on every changed result
        if (u.result !== prevByStaff.get(row.staffId)) {
          await applyResultStatus(row.staffId, u.result)
          await logActivity({
            user: auth,
            action: 'updated',
            module: 'namelist',
            description: `Name List ${list.listNo} — result ${u.result ?? 'cleared'}`,
          })
        }
      }
      return ok({ updated: body.updates.length })
    }

    // resultAll — "Mark all Selected" / "Mark all Absent" quick buttons
    await db.nameListWorker.updateMany({
      where: { nameListId: id },
      data: { result: body.result },
    })
    for (const w of list.workers) await applyResultStatus(w.staffId, body.result)
    await logActivity({
      user: auth,
      action: 'updated',
      module: 'namelist',
      description: `Name List ${list.listNo} — all workers marked ${body.result}`,
    })
    return ok({ updated: list.workers.length })
  } catch {
    return serverError()
  }
}

// Name List status API — PUT { status }: draft → sent → completed,
// draft/sent → cancelled. Completion drives the deployment automations:
//   • Mobilization completed  → every worker Deployed + assigned to the site
//     (start date = list date);
//   • Demobilization completed → every worker Available + site assignment
//     ends (the ProjectStaff row is removed so every dashboard/query that
//     counts deployed workers stays correct without touching them).
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

type Params = { params: Promise<{ id: string }> }

const schema = z.object({
  status: z.enum(['draft', 'sent', 'completed', 'cancelled']),
})

const TRANSITIONS: Record<string, string[]> = {
  draft: ['sent', 'cancelled'],
  sent: ['completed', 'cancelled', 'draft'],
  completed: [],
  cancelled: [],
}

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const auth = await requirePermission('namelist.edit')
    if (isResponse(auth)) return auth

    const { id } = await params
    const list = await db.nameList.findUnique({
      where: { id },
      include: {
        subject: true,
        client: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } },
        workers: { select: { staffId: true, result: true } },
      },
    })
    if (!list) return notFound('Name list not found')

    let raw: unknown
    try {
      raw = await req.json()
    } catch {
      return badRequest('Invalid JSON body')
    }
    const parsed = schema.safeParse(raw)
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? 'Invalid request body')
    }
    const next = parsed.data.status

    if (!TRANSITIONS[list.status]?.includes(next)) {
      return badRequest(`Cannot move a ${list.status} list to ${next}.`)
    }

    const staffIds = list.workers.map((w) => w.staffId)

    // ── Mobilization completed → Deployed + site assignment ──
    if (next === 'completed' && list.subject.kind === 'mobilization') {
      const isDemob = list.subject.name.toLowerCase().startsWith('demob')

      if (isDemob) {
        // Demobilization: site assignment ends, worker back to Available.
        await db.$transaction(async (tx) => {
          if (list.projectId) {
            await tx.projectStaff.deleteMany({
              where: { projectId: list.projectId as string, staffId: { in: staffIds } },
            })
          } else {
            // no site chosen → free the worker from every project of this client
            await tx.projectStaff.deleteMany({
              where: { staffId: { in: staffIds }, project: { clientId: list.clientId } },
            })
          }
          await tx.staff.updateMany({
            where: { id: { in: staffIds } },
            data: { deploymentStatus: 'available' },
          })
          await tx.nameList.update({ where: { id }, data: { status: next } })
        })
      } else {
        // Mobilization: assign to the list's site (or the client's only project).
        let projectId = list.projectId
        if (!projectId) {
          const clientProjects = await db.project.findMany({
            where: { clientId: list.clientId },
            select: { id: true },
          })
          if (clientProjects.length === 1) projectId = clientProjects[0].id
        }
        await db.$transaction(async (tx) => {
          if (projectId) {
            for (const staffId of staffIds) {
              await tx.projectStaff.upsert({
                where: { projectId_staffId: { projectId, staffId } },
                update: { assignedAt: list.date },
                create: { projectId, staffId, assignedAt: list.date },
              })
            }
          }
          await tx.staff.updateMany({
            where: { id: { in: staffIds } },
            data: { deploymentStatus: 'deployed' },
          })
          await tx.nameList.update({ where: { id }, data: { status: next } })
        })
      }
    } else {
      await db.nameList.update({ where: { id }, data: { status: next } })
      // cancelling an interview list frees its pending workers
      if (next === 'cancelled' && list.subject.kind === 'interview') {
        for (const w of list.workers) {
          if (!w.result) {
            const stillOpen = await db.nameListWorker.findFirst({
              where: {
                staffId: w.staffId,
                result: null,
                nameList: { status: { in: ['draft', 'sent'] }, subject: { kind: 'interview' } },
              },
              select: { id: true },
            })
            const anySelected = await db.nameListWorker.findFirst({
              where: { staffId: w.staffId, result: 'selected' },
              select: { id: true },
            })
            const deployed = await db.staff.findUnique({
              where: { id: w.staffId },
              select: { deploymentStatus: true },
            })
            if (!stillOpen && !anySelected && deployed?.deploymentStatus !== 'deployed') {
              await db.staff.update({
                where: { id: w.staffId },
                data: { deploymentStatus: 'available' },
              })
            }
          }
        }
      }
    }

    await logActivity({
      user: auth,
      action: 'updated',
      module: 'namelist',
      description: `Name List ${list.listNo} — status ${list.status} → ${next}`,
    })

    const label =
      next === 'completed' && list.subject.kind === 'mobilization'
        ? list.subject.name.toLowerCase().startsWith('demob')
          ? 'workers released (Available)'
          : 'workers deployed & assigned to the site'
        : undefined
    return ok({ updated: true, note: label })
  } catch {
    return serverError()
  }
}

// Duplicate a list — new number, same company and workers (results cleared),
// date = today, status = draft.
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import {
  ok,
  notFound,
  serverError,
  requirePermission,
  isResponse,
  logActivity,
} from '@/lib/api-helpers'
import { nextListNo } from '@/lib/name-list-server'

type Params = { params: Promise<{ id: string }> }

export async function POST(_req: NextRequest, { params }: Params) {
  try {
    const auth = await requirePermission('namelist.create')
    if (isResponse(auth)) return auth

    const { id } = await params
    const list = await db.nameList.findUnique({
      where: { id },
      include: { workers: { orderBy: { sortOrder: 'asc' }, select: { staffId: true } } },
    })
    if (!list) return notFound('Name list not found')

    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const created = await db.$transaction(async (tx) => {
      const no = await nextListNo(tx, today)
      return tx.nameList.create({
        data: {
          ...no,
          date: today,
          time: list.time,
          clientId: list.clientId,
          location: list.location,
          projectId: list.projectId,
          subjectId: list.subjectId,
          positions: list.positions,
          clientContact: list.clientContact,
          clientPhone: list.clientPhone,
          transport: list.transport,
          refPoNo: list.refPoNo,
          notes: list.notes,
          columns: list.columns,
          createdById: auth.id,
          createdByName: auth.name,
          workers: {
            create: list.workers.map((w, i) => ({ staffId: w.staffId, sortOrder: i })),
          },
        },
      })
    })

    await logActivity({
      user: auth,
      action: 'created',
      module: 'namelist',
      description: `Name List ${created.listNo} — duplicated from ${list.listNo}`,
    })
    return ok({ id: created.id, listNo: created.listNo }, 201)
  } catch {
    return serverError()
  }
}

// "Create Mobilization List from Selected" — makes a NEW draft Mobilization
// list for the same company with ONLY the Selected workers, linked back to
// this interview list (shown as "Created from interview list NL-xxxx").
import { NextRequest } from 'next/server'
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
import { nextListNo } from '@/lib/name-list-server'

type Params = { params: Promise<{ id: string }> }

export async function POST(_req: NextRequest, { params }: Params) {
  try {
    const auth = await requirePermission('namelist.create')
    if (isResponse(auth)) return auth

    const { id } = await params
    const list = await db.nameList.findUnique({
      where: { id },
      include: {
        subject: true,
        workers: {
          where: { result: 'selected' },
          orderBy: { sortOrder: 'asc' },
          select: { staffId: true, remarks: true },
        },
      },
    })
    if (!list) return notFound('Name list not found')
    if (list.subject.kind !== 'interview') {
      return badRequest('Mobilization lists can only be created from Interview-type lists.')
    }
    if (list.workers.length === 0) {
      return badRequest('No Selected workers on this list — mark results first.')
    }

    const mobSubject = await db.nameListSubject.findFirst({
      where: { name: 'Mobilization' },
    })
    if (!mobSubject) return badRequest('The Mobilization subject is missing. Re-seed subjects in Settings.')

    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const created = await db.$transaction(async (tx) => {
      const no = await nextListNo(tx, today)
      return tx.nameList.create({
        data: {
          ...no,
          date: today,
          clientId: list.clientId,
          subjectId: mobSubject.id,
          positions: list.positions,
          clientContact: list.clientContact,
          clientPhone: list.clientPhone,
          refInterviewListId: list.id,
          refPoNo: list.refPoNo,
          notes: list.notes,
          createdById: auth.id,
          createdByName: auth.name,
          workers: {
            create: list.workers.map((w, i) => ({
              staffId: w.staffId,
              sortOrder: i,
              remarks: w.remarks,
            })),
          },
        },
      })
    })

    await logActivity({
      user: auth,
      action: 'created',
      module: 'namelist',
      description: `Name List ${created.listNo} — mobilization from ${list.listNo} (${list.workers.length} selected workers)`,
    })
    return ok({ id: created.id, listNo: created.listNo, workerCount: list.workers.length }, 201)
  } catch {
    return serverError()
  }
}

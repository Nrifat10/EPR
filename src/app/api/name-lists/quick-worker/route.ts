// Quick-add worker — the boss types a worker straight into a Name List
// without opening the Employees module first.
//
//   POST /api/name-lists/quick-worker
//   Body: { ...worker fields, listId?: string }
//     • listId given   → create the employee AND add it to that list in one
//       shot (interview-kind lists move the worker to "In Interview").
//     • listId omitted → just create the employee (used when the list itself
//       has not been saved yet — the caller keeps the id in its draft
//       selection).
//
//   Iqama No. is optional here: when blank we store a TEMP-###### placeholder
//   (the column is NOT NULL + UNIQUE) and tell the caller so the UI can nudge
//   the boss to update the real number later from the Employees module.
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import {
  ok,
  badRequest,
  conflict,
  notFound,
  serverError,
  requirePermission,
  isResponse,
  logActivity,
} from '@/lib/api-helpers'

const optionalText = z.preprocess(
  (v) => (typeof v === 'string' ? (v.trim() === '' ? null : v.trim()) : v === undefined ? null : v),
  z.string().max(120).nullable()
)

const quickSchema = z.object({
  fullName: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim() : ''),
    z.string().min(1, 'Worker name is required').max(120)
  ),
  staffCategoryId: optionalText,
  position: optionalText,
  iqamaId: optionalText,
  passportNo: optionalText,
  phone: optionalText,
  nationality: optionalText,
  bloodGroup: optionalText,
  experienceYears: z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? null : Number(v)),
    z
      .number()
      .int('Experience must be a whole number of years')
      .min(0, 'Experience cannot be negative')
      .max(60, 'Experience looks too high')
      .nullable()
  ),
  listId: optionalText,
})

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']

/** TEMP-###### placeholder when the boss has no Iqama number at hand yet. */
async function generateTempIqama(): Promise<string> {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  for (let attempt = 0; attempt < 6; attempt++) {
    let code = ''
    for (let i = 0; i < 6; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)]
    const candidate = `TEMP-${code}`
    const clash = await db.staff.findFirst({ where: { iqamaId: candidate }, select: { id: true } })
    if (!clash) return candidate
  }
  return `TEMP-${Date.now().toString(36).toUpperCase()}`
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requirePermission('namelist.edit')
    if (isResponse(auth)) return auth

    let raw: unknown
    try {
      raw = await req.json()
    } catch {
      return badRequest('Invalid JSON body')
    }
    const parsed = quickSchema.safeParse(raw)
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? 'Invalid request body')
    }
    const data = parsed.data

    if (data.bloodGroup && !BLOOD_GROUPS.includes(data.bloodGroup)) data.bloodGroup = null

    // optional list — when given it must exist and still be editable
    let list: { id: string; listNo: string; kind: string; workerCount: number } | null = null
    if (data.listId) {
      const found = await db.nameList.findUnique({
        where: { id: data.listId },
        select: {
          id: true,
          listNo: true,
          status: true,
          subject: { select: { kind: true } },
          workers: { select: { staffId: true } },
        },
      })
      if (!found) return notFound('Name list not found')
      if (found.status === 'completed' || found.status === 'cancelled') {
        return badRequest(`A ${found.status} list is read-only.`)
      }
      list = { id: found.id, listNo: found.listNo, kind: found.subject.kind, workerCount: found.workers.length }
    }

    if (data.staffCategoryId) {
      const category = await db.staffCategory.findUnique({ where: { id: data.staffCategoryId } })
      if (!category) return badRequest('Trade not found')
      if (!data.position) data.position = category.name
    }

    // Iqama — required + unique in the DB; blank → TEMP placeholder
    let tempIqama = false
    let iqamaId = data.iqamaId ?? null
    if (!iqamaId) {
      iqamaId = await generateTempIqama()
      tempIqama = true
    }
    const duplicate = await db.staff.findFirst({
      where: { iqamaId },
      select: { fullName: true, deletedAt: true },
    })
    if (duplicate) {
      return conflict(
        `A worker with this Iqama No. already exists (${duplicate.fullName}${
          duplicate.deletedAt ? ' — deleted record' : ''
        })`
      )
    }

    const staff = await db.staff.create({
      data: {
        fullName: data.fullName,
        phone: data.phone,
        position: data.position,
        staffCategoryId: data.staffCategoryId,
        iqamaId,
        passportNo: data.passportNo,
        nationality: data.nationality,
        bloodGroup: data.bloodGroup,
        experienceYears: data.experienceYears,
        status: 'active',
        // interview-kind list → straight to "In Interview", like the picker flow
        deploymentStatus: list && list.kind === 'interview' ? 'in_interview' : 'available',
        ...(list
          ? { nameListWorkers: { create: { nameListId: list.id, sortOrder: list.workerCount } } }
          : {}),
      },
      select: {
        id: true,
        fullName: true,
        iqamaId: true,
        phone: true,
        passportNo: true,
        nationality: true,
        bloodGroup: true,
        experienceYears: true,
        deploymentStatus: true,
        staffCategory: { select: { id: true, name: true } },
      },
    })

    await logActivity({
      user: auth,
      action: 'created',
      module: 'staff',
      description: `Added new staff: ${staff.fullName}${list ? ` (quick-add from Name List ${list.listNo})` : ' (quick-add)'}`,
    })
    if (list) {
      await logActivity({
        user: auth,
        action: 'updated',
        module: 'namelist',
        description: `Name List ${list.listNo} — new worker added: ${staff.fullName}`,
      })
    }

    return ok(
      {
        staff,
        addedToList: !!list,
        listNo: list?.listNo ?? null,
        tempIqama,
      },
      201
    )
  } catch (err) {
    console.error('[api/name-lists/quick-worker POST]', err)
    return serverError()
  }
}

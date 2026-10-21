// Name List server helpers — shared by every /api/name-lists/* route.
// 'server-only' guards accidental client import.
import 'server-only'
import { db } from '@/lib/db'
import type { Prisma } from '@prisma/client'
import type {
  NameListDetail,
  NameListRow,
  NameListStatus,
  NameListWorkerResult,
  NameListWorkerRow,
} from '@/lib/types'
import { parseListColumns } from '@/lib/name-list-utils'

type Tx = Prisma.TransactionClient | typeof db

// ── List number ──────────────────────────────────────────────────────────────

/** Next NL-YYYY-0001 — continues from the highest number stored for the year. */
export async function nextListNo(tx: Tx, date: Date): Promise<{ listNo: string; year: number; seq: number }> {
  const year = date.getFullYear()
  const max = await tx.nameList.aggregate({
    where: { year },
    _max: { seq: true },
  })
  const seq = (max._max.seq ?? 0) + 1
  return { listNo: `NL-${year}-${String(seq).padStart(4, '0')}`, year, seq }
}

// ── Row mapping ──────────────────────────────────────────────────────────────

type ListWithMeta = {
  id: string
  listNo: string
  date: Date
  time: string | null
  clientId: string
  location: string | null
  projectId: string | null
  positions: string | null
  clientContact: string | null
  clientPhone: string | null
  transport: string | null
  refInterviewListId: string | null
  refPoNo: string | null
  notes: string | null
  status: string
  columns: string | null
  signedCopyName: string | null
  createdByName: string | null
  createdAt: Date
  client: { id: string; name: string } | null
  project: { id: string; name: string } | null
  subject: { id: string; name: string; color: string; kind: string }
  refInterviewList: { id: string; listNo: string } | null
  workers?: {
    sortOrder: number
    result: string | null
    staffId: string
  }[]
  _count?: { workers: number }
}

const EMPTY_COUNTS = { selected: 0, rejected: 0, absent: 0, onhold: 0, pending: 0 }

export function mapListRow(l: ListWithMeta): NameListRow {
  const counts = { ...EMPTY_COUNTS }
  if (l.workers) {
    for (const w of l.workers) {
      if (w.result === 'selected') counts.selected++
      else if (w.result === 'rejected') counts.rejected++
      else if (w.result === 'absent') counts.absent++
      else if (w.result === 'onhold') counts.onhold++
      else counts.pending++
    }
  }
  let positions: string[] = []
  try {
    const v = l.positions ? JSON.parse(l.positions) : []
    if (Array.isArray(v)) positions = v.map(String)
  } catch {
    positions = []
  }
  return {
    id: l.id,
    listNo: l.listNo,
    date: l.date.toISOString(),
    time: l.time,
    clientId: l.clientId,
    clientName: l.client?.name ?? '—',
    location: l.location,
    projectId: l.projectId,
    projectName: l.project?.name ?? null,
    subjectId: l.subject.id,
    subjectName: l.subject.name,
    subjectColor: l.subject.color,
    subjectKind: l.subject.kind === 'mobilization' ? 'mobilization' : 'interview',
    positions,
    clientContact: l.clientContact,
    clientPhone: l.clientPhone,
    transport: l.transport,
    refInterviewListId: l.refInterviewListId,
    refInterviewListNo: l.refInterviewList?.listNo ?? null,
    refPoNo: l.refPoNo,
    notes: l.notes,
    status: l.status as NameListStatus,
    workerCount: l.workers ? l.workers.length : (l._count?.workers ?? 0),
    resultCounts: counts,
    signedCopyName: l.signedCopyName,
    createdByName: l.createdByName,
    createdAt: l.createdAt.toISOString(),
  }
}

/** Prisma include that carries everything mapListRow needs. */
export const LIST_INCLUDE = {
  client: { select: { id: true, name: true } },
  project: { select: { id: true, name: true } },
  subject: true,
  refInterviewList: { select: { id: true, listNo: true } },
  workers: { select: { sortOrder: true, result: true, staffId: true } },
} as const

// ── Detail mapping (editor + print) ──────────────────────────────────────────

const WORKER_INCLUDE = {
  staff: {
    select: {
      id: true,
      fullName: true,
      phone: true,
      position: true,
      iqamaId: true,
      iqamaExpiry: true,
      passportNo: true,
      nationality: true,
      bloodGroup: true,
      experienceYears: true,
      deploymentStatus: true,
      status: true,
      staffCategory: { select: { name: true } },
    },
  },
}

type WorkerWithStaff = {
  id: string
  staffId: string
  sortOrder: number
  result: string | null
  remarks: string | null
  staff: {
    id: string
    fullName: string
    phone: string | null
    position: string | null
    iqamaId: string
    iqamaExpiry: Date | null
    passportNo: string | null
    nationality: string | null
    bloodGroup: string | null
    experienceYears: number | null
    deploymentStatus: string
    status: string
    staffCategory: { name: string } | null
  }
}

export function mapWorkerRow(w: WorkerWithStaff): NameListWorkerRow {
  return {
    id: w.id,
    staffId: w.staffId,
    sortOrder: w.sortOrder,
    result: (w.result as NameListWorkerResult) ?? null,
    remarks: w.remarks,
    staff: {
      id: w.staff.id,
      fullName: w.staff.fullName,
      phone: w.staff.phone,
      position: w.staff.position,
      iqamaId: w.staff.iqamaId,
      iqamaExpiry: w.staff.iqamaExpiry ? w.staff.iqamaExpiry.toISOString() : null,
      passportNo: w.staff.passportNo,
      nationality: w.staff.nationality,
      bloodGroup: w.staff.bloodGroup,
      experienceYears: w.staff.experienceYears,
      deploymentStatus: w.staff.deploymentStatus,
      status: w.staff.status,
      categoryName: w.staff.staffCategory?.name ?? null,
    },
  }
}

/** Full detail for one list (editor + print + excel). */
export async function getListDetail(id: string): Promise<NameListDetail | null> {
  const l = await db.nameList.findUnique({
    where: { id },
    include: {
      ...LIST_INCLUDE,
      client: {
        select: { id: true, name: true, contactPerson: true, phone: true, city: true },
      },
      workers: { include: WORKER_INCLUDE, orderBy: { sortOrder: 'asc' } },
    },
  })
  if (!l) return null
  const base = mapListRow(l as unknown as ListWithMeta)
  return {
    ...base,
    client: l.client
      ? {
          id: l.client.id,
          name: l.client.name,
          contactPerson: l.client.contactPerson,
          phone: l.client.phone,
          city: l.client.city,
        }
      : null,
    workers: (l.workers as unknown as WorkerWithStaff[]).map(mapWorkerRow),
    columns: parseListColumns(l.columns),
  }
}

// ── Deployment status automation (spec §6) ───────────────────────────────────
//
// available → in_interview (added to an interview-kind list)
// in_interview → selected (result Selected) / available (Rejected | Absent)
// selected → deployed (mobilization list completed; assigned to the site)
// deployed → available (demobilization list completed; site assignment ends)

/** Apply a worker-result transition (interview-kind lists). */
export async function applyResultStatus(staffId: string, result: string | null): Promise<void> {
  if (result === 'selected') {
    await db.staff.update({ where: { id: staffId }, data: { deploymentStatus: 'selected' } })
  } else if (result === 'rejected' || result === 'absent') {
    // back to Available only when the worker is not Selected in another list
    const other = await db.nameListWorker.findFirst({
      where: { staffId, result: 'selected' },
      select: { id: true },
    })
    if (!other) {
      await db.staff.update({ where: { id: staffId }, data: { deploymentStatus: 'available' } })
    }
  }
  // onhold / clearing a result → recompute below
  await recomputeWorkerStatus(staffId)
}

/**
 * Recompute a worker's deployment status from the live data:
 *   1. deployed (has an active site assignment) stays deployed unless a
 *      demobilization explicitly freed them (handled by the status route);
 *   2. any 'selected' result → selected;
 *   3. any open interview-kind list (no terminal result) → in_interview;
 *   4. otherwise available.
 */
export async function recomputeWorkerStatus(staffId: string): Promise<void> {
  const staff = await db.staff.findUnique({
    where: { id: staffId },
    select: { deploymentStatus: true, projects: { select: { projectId: true } } },
  })
  if (!staff) return

  if (staff.deploymentStatus === 'deployed') return // site assignment rules

  const anySelected = await db.nameListWorker.findFirst({
    where: { staffId, result: 'selected' },
    select: { id: true },
  })
  if (anySelected) {
    if (staff.deploymentStatus !== 'selected') {
      await db.staff.update({ where: { id: staffId }, data: { deploymentStatus: 'selected' } })
    }
    return
  }

  const openInterview = await db.nameListWorker.findFirst({
    where: {
      staffId,
      result: null,
      nameList: {
        status: { in: ['draft', 'sent'] },
        subject: { kind: 'interview' },
      },
    },
    select: { id: true },
  })
  const target = openInterview ? 'in_interview' : 'available'
  if (staff.deploymentStatus !== target) {
    await db.staff.update({ where: { id: staffId }, data: { deploymentStatus: target } })
  }
}

/** Date+time clash check for the add-worker warning (never a hard block). */
export async function findWorkerConflicts(
  staffId: string,
  listDate: Date,
  listTime: string | null,
  excludeListId: string
): Promise<{ listNo: string; subject: string; time: string | null }[]> {
  const dayStart = new Date(listDate)
  dayStart.setHours(0, 0, 0, 0)
  const dayEnd = new Date(listDate)
  dayEnd.setHours(23, 59, 59, 999)

  const rows = await db.nameListWorker.findMany({
    where: {
      staffId,
      nameList: {
        id: { not: excludeListId },
        status: { not: 'cancelled' },
        date: { gte: dayStart, lte: dayEnd },
        ...(listTime ? { time: listTime } : {}),
      },
    },
    select: {
      nameList: {
        select: { listNo: true, time: true, subject: { select: { name: true } } },
      },
    },
    take: 5,
  })
  return rows.map((r) => ({
    listNo: r.nameList.listNo,
    subject: r.nameList.subject.name,
    time: r.nameList.time,
  }))
}

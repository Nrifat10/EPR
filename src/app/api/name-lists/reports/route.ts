// Name List reports — ?type=success-rate | volume | problem-workers
//   success-rate   : Selected ÷ interviewed by company / trade / month
//   volume         : lists + workers sent per company per day/week/month
//   problem-workers: workers with the most Rejected / Absent results
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, badRequest, serverError, requirePermission, isResponse } from '@/lib/api-helpers'

function parseFromTo(sp: URLSearchParams): { from: Date; to: Date } {
  const now = new Date()
  const defaultFrom = new Date(now.getFullYear(), now.getMonth() - 5, 1)
  const defaultTo = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)
  const f = sp.get('from') ? new Date(sp.get('from') as string) : defaultFrom
  const t = sp.get('to') ? new Date(sp.get('to') as string) : defaultTo
  return { from: Number.isNaN(f.getTime()) ? defaultFrom : f, to: Number.isNaN(t.getTime()) ? defaultTo : t }
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requirePermission('namelist.view')
    if (isResponse(auth)) return auth

    const sp = req.nextUrl.searchParams
    const type = sp.get('type') ?? 'success-rate'
    const { from, to } = parseFromTo(sp)
    const toEnd = new Date(to)
    toEnd.setHours(23, 59, 59, 999)

    if (type === 'success-rate') {
      // interview-kind lists only; interviewed = terminal results, selected = numerator
      const rows = await db.nameListWorker.findMany({
        where: {
          result: { in: ['selected', 'rejected', 'absent'] },
          nameList: {
            date: { gte: from, lte: toEnd },
            status: { not: 'cancelled' },
            subject: { kind: 'interview' },
          },
        },
        select: {
          result: true,
          nameList: { select: { date: true, client: { select: { name: true } } } },
          staff: { select: { staffCategory: { select: { name: true } }, position: true } },
        },
      })
      const bucket = (
        key: string
      ): { key: string; interviewed: number; selected: number; rejected: number; absent: number } => {
        const b = { key, interviewed: 0, selected: 0, rejected: 0, absent: 0 }
        return b
      }
      const byCompany = new Map<string, ReturnType<typeof bucket>>()
      const byTrade = new Map<string, ReturnType<typeof bucket>>()
      const byMonth = new Map<string, ReturnType<typeof bucket>>()
      const bump = (
        m: Map<string, ReturnType<typeof bucket>>,
        key: string,
        r: string | null
      ) => {
        if (!m.has(key)) m.set(key, bucket(key))
        const b = m.get(key)!
        if (r === 'selected') b.selected++
        else if (r === 'rejected') b.rejected++
        else b.absent++
        b.interviewed++
      }
      for (const w of rows) {
        const trade = w.staff.staffCategory?.name ?? w.staff.position ?? 'Uncategorized'
        const month = `${w.nameList.date.getFullYear()}-${String(w.nameList.date.getMonth() + 1).padStart(2, '0')}`
        bump(byCompany, w.nameList.client?.name ?? '—', w.result)
        bump(byTrade, trade, w.result)
        bump(byMonth, month, w.result)
      }
      const serialize = (m: Map<string, ReturnType<typeof bucket>>) =>
        [...m.values()]
          .map((b) => ({
            ...b,
            rate: b.interviewed > 0 ? Math.round((b.selected / b.interviewed) * 100) : 0,
          }))
          .sort((a, b) => b.interviewed - a.interviewed)
      return ok({ type, from: from.toISOString(), to: toEnd.toISOString(), byCompany: serialize(byCompany), byTrade: serialize(byTrade), byMonth: serialize(byMonth) })
    }

    if (type === 'volume') {
      const group = sp.get('group') ?? 'month' // day | week | month
      const lists = await db.nameList.findMany({
        where: { date: { gte: from, lte: toEnd }, status: { not: 'cancelled' } },
        select: {
          date: true,
          clientId: true,
          client: { select: { name: true } },
          subject: { select: { name: true } },
          workers: { select: { staffId: true } },
        },
        orderBy: { date: 'asc' },
      })
      const periodKey = (d: Date): string => {
        const p = (n: number) => String(n).padStart(2, '0')
        if (group === 'day') return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
        if (group === 'week') {
          const t = new Date(d)
          const day = (t.getDay() + 6) % 7 // Monday = 0
          t.setDate(t.getDate() - day)
          return `W ${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`
        }
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}`
      }
      const byClient = new Map<string, { clientName: string; periods: Map<string, { period: string; lists: number; workers: number }> }>()
      for (const l of lists) {
        const name = l.client?.name ?? '—'
        if (!byClient.has(l.clientId)) byClient.set(l.clientId, { clientName: name, periods: new Map() })
        const entry = byClient.get(l.clientId)!
        const pk = periodKey(l.date)
        if (!entry.periods.has(pk)) entry.periods.set(pk, { period: pk, lists: 0, workers: 0 })
        const p = entry.periods.get(pk)!
        p.lists++
        p.workers += l.workers.length
      }
      return ok({
        type,
        group,
        from: from.toISOString(),
        to: toEnd.toISOString(),
        rows: [...byClient.values()].map((c) => ({
          clientName: c.clientName,
          periods: [...c.periods.values()].sort((a, b) => a.period.localeCompare(b.period)),
          totalLists: [...c.periods.values()].reduce((s, p) => s + p.lists, 0),
          totalWorkers: [...c.periods.values()].reduce((s, p) => s + p.workers, 0),
        })).sort((a, b) => b.totalWorkers - a.totalWorkers),
      })
    }

    if (type === 'problem-workers') {
      const rows = await db.nameListWorker.findMany({
        where: {
          result: { in: ['rejected', 'absent'] },
          nameList: { date: { gte: from, lte: toEnd }, status: { not: 'cancelled' } },
        },
        select: {
          result: true,
          remarks: true,
          staff: { select: { id: true, fullName: true, staffCategory: { select: { name: true } }, position: true } },
          nameList: { select: { listNo: true, date: true, client: { select: { name: true } }, subject: { select: { name: true } } } },
        },
        orderBy: { nameList: { date: 'asc' } },
      })
      const byStaff = new Map<
        string,
        {
          staffId: string
          name: string
          trade: string
          rejected: number
          absent: number
          events: {
          listNo: string
          date: string
          client: string
          subject: string
          result: string | null
          remarks: string | null
        }[]
        }
      >()
      for (const w of rows) {
        const id = w.staff.id
        if (!byStaff.has(id)) {
          byStaff.set(id, {
            staffId: id,
            name: w.staff.fullName,
            trade: w.staff.staffCategory?.name ?? w.staff.position ?? '—',
            rejected: 0,
            absent: 0,
            events: [],
          })
        }
        const e = byStaff.get(id)!
        if (w.result === 'rejected') e.rejected++
        else e.absent++
        e.events.push({
          listNo: w.nameList.listNo,
          date: w.nameList.date.toISOString(),
          client: w.nameList.client?.name ?? '—',
          subject: w.nameList.subject.name,
          result: w.result,
          remarks: w.remarks,
        })
      }
      const out = [...byStaff.values()]
        .map((w) => ({ ...w, total: w.rejected + w.absent }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 50)
      return ok({ type, from: from.toISOString(), to: toEnd.toISOString(), workers: out })
    }

    return badRequest('Unknown report type')
  } catch {
    return serverError()
  }
}

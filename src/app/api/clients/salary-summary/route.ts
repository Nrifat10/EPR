// Client Salary Summary API — monthly MANPOWER BILLING per client company.
// HOURS MIRROR PAYROLL: for the selected month, every payroll record becomes
// one billing line — regular hours + overtime hours are exactly the same
// numbers the worker's own salary sheet shows for that month.
// The RATE billed to the client company is a separate, manually-entered value
// (e.g. we charge the client 20 SAR/hour while paying the worker 15 SAR/hour):
//   payroll.clientRate  — typed in this summary, per worker, per month
//   fallback when 0     — the project's negotiated default client rate
//   final fallback      — the worker's own pay rate (clearly flagged ⚠)
// Each group carries subtotal + 15% VAT + grand total and a per-worker line
// list (hours, OT, rates, amount) so every company's summary can be printed /
// downloaded separately.
//   ?month=&year=      — billing month (default: current)
//   ?search            — filter by client / worker / iqama / project / position / category
//   ?includeInactive=true — also count inactive staff (default: active only)
// Permission: payroll.view (salary figures are exposed).
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { round2 } from '@/lib/format'
import { ok, serverError, requirePermission, isResponse, toInt } from '@/lib/api-helpers'
import type {
  ClientBillingLine,
  ClientSalaryGroup,
  ClientSalarySummaryData,
} from '@/lib/types'

const NO_CLIENT = 'No Client (Unlinked Payroll)'
/** Saudi standard VAT */
export const VAT_RATE = 0.15

export async function GET(req: NextRequest) {
  try {
    const auth = await requirePermission('payroll.view')
    if (isResponse(auth)) return auth

    const { searchParams } = new URL(req.url)
    const search = (searchParams.get('search') ?? '').trim().toLowerCase()
    const includeInactive = searchParams.get('includeInactive') === 'true'

    const now = new Date()
    const month = Math.min(12, Math.max(1, toInt(searchParams.get('month'), now.getMonth() + 1)))
    const year = Math.min(2200, Math.max(2000, toInt(searchParams.get('year'), now.getFullYear())))

    // Every payroll record of the month — the SINGLE source of truth for hours
    const payrolls = await db.payroll.findMany({
      where: {
        month,
        year,
        staff: {
          deletedAt: null,
          ...(includeInactive ? {} : { status: 'active' }),
        },
      },
      include: {
        staff: {
          select: {
            id: true,
            fullName: true,
            position: true,
            iqamaId: true,
            status: true,
            monthlySalary: true,
            staffCategory: { select: { name: true } },
          },
        },
        project: {
          select: {
            id: true,
            name: true,
            clientRatePerHour: true,
            client: {
              select: {
                id: true,
                name: true,
                city: true,
                contactPerson: true,
                phone: true,
                email: true,
                address: true,
                crNumber: true,
                status: true,
              },
            },
          },
        },
      },
      orderBy: [{ project: { name: 'asc' } }, { staff: { fullName: 'asc' } }],
    })

    // Bench staff — active, not deleted, zero project assignments (context card only)
    const bench = await db.staff.findMany({
      where: { deletedAt: null, status: 'active', projects: { none: {} } },
      select: { monthlySalary: true },
    })

    // ---- Group by client; one billing line per payroll record ----
    const groups = new Map<
      string,
      {
        clientId: string | null
        clientName: string
        city: string | null
        contactPerson: string | null
        phone: string | null
        email: string | null
        crNumber: string | null
        address: string | null
        clientStatus: string
        projectIds: Set<string>
        rows: ClientBillingLine[]
      }
    >()
    // staffId → set of client keys (for distinct totals + multi-client count)
    const staffClients = new Map<string, { salary: number; clients: Set<string> }>()

    for (const p of payrolls) {
      const c = p.project?.client ?? null
      const key = c?.id ?? '_none'
      let g = groups.get(key)
      if (!g) {
        g = {
          clientId: c?.id ?? null,
          clientName: c?.name ?? NO_CLIENT,
          city: c?.city ?? null,
          contactPerson: c?.contactPerson ?? null,
          phone: c?.phone ?? null,
          email: c?.email ?? null,
          crNumber: c?.crNumber ?? null,
          address: c?.address ?? null,
          clientStatus: c?.status ?? 'active',
          projectIds: new Set<string>(),
          rows: [],
        }
        groups.set(key, g)
      }
      if (p.project) g.projectIds.add(p.project.id)

      const projectRate = p.project?.clientRatePerHour ?? 0
      const workerRate = p.hourlyRateSnapshot
      const workerOtRate = p.overtimeRateSnapshot

      // Rate resolution: manual entry → project default → worker's own rate
      let rateSource: ClientBillingLine['rateSource']
      let clientRate: number
      if (p.clientRate > 0) {
        clientRate = p.clientRate
        rateSource = 'manual'
      } else if (projectRate > 0) {
        clientRate = projectRate
        rateSource = 'project'
      } else {
        clientRate = workerRate
        rateSource = 'worker'
      }
      // OT rate: manual entry, else the same effective regular rate
      const clientOtRate = p.clientOtRate > 0 ? p.clientOtRate : clientRate

      const hours = p.totalHours
      const otHours = p.overtimeHours
      g.rows.push({
        payrollId: p.id,
        projectId: p.project?.id ?? '_unassigned',
        projectName: p.project?.name ?? 'Unassigned (no project)',
        staffId: p.staff.id,
        fullName: p.staff.fullName,
        iqamaId: p.staff.iqamaId,
        position: p.staff.position,
        categoryName: p.staff.staffCategory?.name ?? null,
        hours,
        otHours,
        clientRate,
        clientOtRate,
        manualRate: p.clientRate,
        manualOtRate: p.clientOtRate,
        projectRate,
        rateSource,
        amount: round2(hours * clientRate + otHours * clientOtRate),
        workerRate,
        workerCost: round2(hours * workerRate + otHours * workerOtRate),
        monthlySalary: p.staff.monthlySalary,
        status: p.staff.status as 'active' | 'inactive',
      })

      let sc = staffClients.get(p.staff.id)
      if (!sc) {
        sc = { salary: p.staff.monthlySalary, clients: new Set<string>() }
        staffClients.set(p.staff.id, sc)
      }
      sc.clients.add(key)
    }

    // ---- Distinct-worker cards (a worker on 2 clients counts ONCE) ----
    let totalWorkers = 0
    let totalMonthlySalary = 0
    let multiClientWorkers = 0
    for (const sc of staffClients.values()) {
      totalWorkers += 1
      totalMonthlySalary += sc.salary
      if (sc.clients.size > 1) multiClientWorkers += 1
    }

    // ---- Build response groups with billing aggregates ----
    const built = Array.from(groups.values()).map((g) => {
      g.rows.sort(
        (a, b) =>
          a.projectName.localeCompare(b.projectName) || a.fullName.localeCompare(b.fullName)
      )
      const hours = round2(g.rows.reduce((s, r) => s + r.hours, 0))
      const otHours = round2(g.rows.reduce((s, r) => s + r.otHours, 0))
      const billedAmount = round2(g.rows.reduce((s, r) => s + r.amount, 0))
      const vatAmount = round2(billedAmount * VAT_RATE)
      const workerCost = round2(g.rows.reduce((s, r) => s + r.workerCost, 0))
      const salaryByStaff = new Map<string, number>()
      for (const r of g.rows) salaryByStaff.set(r.staffId, r.monthlySalary)
      const workerCount = salaryByStaff.size
      const groupSalary = round2(Array.from(salaryByStaff.values()).reduce((s, v) => s + v, 0))
      return {
        clientId: g.clientId,
        clientName: g.clientName,
        city: g.city,
        contactPerson: g.contactPerson,
        phone: g.phone,
        email: g.email,
        crNumber: g.crNumber,
        address: g.address,
        clientStatus: g.clientStatus as 'active' | 'inactive',
        projectCount: g.projectIds.size,
        workerCount,
        workersWithHours: new Set(g.rows.filter((r) => r.hours > 0 || r.otHours > 0).map((r) => r.staffId)).size,
        rows: g.rows,
        hours,
        otHours,
        billedAmount,
        vatAmount,
        grandTotal: round2(billedAmount + vatAmount),
        workerCost,
        margin: round2(billedAmount - workerCost),
        totalMonthlySalary: groupSalary,
        avgMonthlySalary: workerCount > 0 ? round2(groupSalary / workerCount) : 0,
        share: 0, // filled after the denominator is known
      }
    })

    const denominator = built.reduce((s, g) => s + g.grandTotal, 0)
    for (const g of built) {
      g.share = denominator > 0 ? round2((100 * g.grandTotal) / denominator) : 0
    }

    // Sort: biggest billing first; the "No Client" bucket always last
    built.sort((a, b) => {
      const aNone = a.clientId === null ? 1 : 0
      const bNone = b.clientId === null ? 1 : 0
      if (aNone !== bNone) return aNone - bNone
      if (aNone === 1) return a.workerCount - b.workerCount
      if (b.grandTotal !== a.grandTotal) return b.grandTotal - a.grandTotal
      return a.clientName.localeCompare(b.clientName)
    })

    // ---- Search filter (applied to groups/rows; cards stay global) ----
    let filtered = built
    if (search) {
      filtered = built
        .map((g) => {
          const clientHit = [g.clientName, g.city, g.contactPerson]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(search))
          if (clientHit) return g
          const rows = g.rows.filter((r) =>
            [r.fullName, r.iqamaId, r.position, r.categoryName, r.projectName]
              .filter(Boolean)
              .some((v) => String(v).toLowerCase().includes(search))
          )
          if (rows.length === 0) return null
          return { ...g, rows }
        })
        .filter((g): g is ClientSalaryGroup => g !== null)
    }

    // ---- Billing cards over ALL groups (not the search-filtered subset) ----
    const cardsBilling = built.reduce(
      (acc, g) => ({
        billedHours: round2(acc.billedHours + g.hours),
        billedOtHours: round2(acc.billedOtHours + g.otHours),
        billedAmount: round2(acc.billedAmount + g.billedAmount),
        vatAmount: round2(acc.vatAmount + g.vatAmount),
        grandTotal: round2(acc.grandTotal + g.grandTotal),
        workerCost: round2(acc.workerCost + g.workerCost),
        margin: round2(acc.margin + g.margin),
      }),
      { billedHours: 0, billedOtHours: 0, billedAmount: 0, vatAmount: 0, grandTotal: 0, workerCost: 0, margin: 0 }
    )

    const data: ClientSalarySummaryData = {
      month,
      year,
      vatRate: VAT_RATE,
      cards: {
        totalClients: built.filter((g) => g.clientId !== null).length,
        totalWorkers,
        totalMonthlySalary: round2(totalMonthlySalary),
        avgMonthlySalary: totalWorkers > 0 ? round2(totalMonthlySalary / totalWorkers) : 0,
        benchWorkers: bench.length,
        benchSalary: round2(bench.reduce((s, b) => s + b.monthlySalary, 0)),
        multiClientWorkers,
        ...cardsBilling,
      },
      groups: filtered,
    }

    return ok(data)
  } catch (err) {
    console.error('[api/clients/salary-summary GET]', err)
    return serverError()
  }
}

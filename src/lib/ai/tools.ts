// Server-only READ-ONLY ERP tools for the AI Assistant.
// The AI never writes SQL — it calls these typed functions, each gated by the
// logged-in user's role/permissions, with masking + row caps + server-side
// totals. Payroll data requires ROLE-LEVEL payroll permission (stricter than
// the ERP's company-wide baseline) per the security spec.
import 'server-only'
import { db } from '@/lib/db'
import { hasPermission } from '@/lib/auth'
import { round2 } from '@/lib/format'
import type { SessionUser } from '@/lib/types'

export const MAX_ROWS = 200

export type ToolDefs = {
  name: string
  description: string
  parameters: Record<string, unknown> // JSON schema
}

export type ToolEvent = {
  name: string
  args: Record<string, unknown>
  ok: boolean
  ms: number
  rows?: number
  summary?: string
  error?: string
}

// ── permission helpers ──────────────────────────────────────────────────────

/** Screens-style permission (honours the company-wide baseline). */
function canSee(user: SessionUser, perm: string): boolean {
  return hasPermission(user, perm)
}

/**
 * Payroll/salary data is sensitive: it requires the ROLE ITSELF to carry
 * payroll.view (or '*'), NOT merely the company-wide baseline. Under the
 * current full-access baseline this restricts payroll answers to genuine
 * Admin/Accounts-style roles, as the security spec demands.
 */
function canSeePayroll(user: SessionUser): boolean {
  const perms = user.role?.permissions ?? []
  if (perms.includes('*')) return true
  if (perms.includes('payroll.view')) return true
  const roleName = (user.role?.name ?? '').toLowerCase()
  return roleName.includes('admin') || roleName.includes('account')
}

/** Full Iqama numbers only for roles explicitly granted AI ID visibility. */
function canSeeFullIds(user: SessionUser): boolean {
  const perms = user.role?.permissions ?? []
  return perms.includes('*') || perms.includes('ai.seefullids')
}

function maskId(v: string | null | undefined, full: boolean): string | null {
  if (!v) return null
  if (full) return v
  return v.length <= 4 ? v : `••••• ${v.slice(-4)}`
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined
}
function num(v: unknown): number | undefined {
  if (typeof v === 'number' && isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '') {
    const n = parseFloat(v)
    if (isFinite(n)) return n
  }
  return undefined
}
function money(n: number | null | undefined): number {
  return round2(n ?? 0)
}
function d(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null
}

// ── staff helpers ───────────────────────────────────────────────────────────

async function staffBase(user: SessionUser) {
  const fullIds = canSeeFullIds(user)
  return {
    fullIds,
    select: {
      id: true,
      fullName: true,
      position: true,
      phone: true,
      iqamaId: true,
      iqamaExpiry: true,
      passportExpiry: true,
      joiningDate: true,
      status: true,
      staffCategory: { select: { name: true } },
      projects: { select: { project: { select: { id: true, name: true, status: true } } } },
    },
    map(s: {
      id: string
      fullName: string
      position: string | null
      phone: string | null
      iqamaId: string
      iqamaExpiry: Date | null
      passportExpiry: Date | null
      joiningDate: Date | null
      status: string
      staffCategory: { name: string } | null
      projects: { project: { id: string; name: string; status: string } }[]
    }) {
      return {
        id: s.id,
        name: s.fullName,
        trade: s.staffCategory?.name ?? s.position ?? 'Uncategorized',
        position: s.position,
        phone: s.phone,
        iqama: maskId(s.iqamaId, fullIds),
        iqamaExpiry: d(s.iqamaExpiry),
        passportExpiry: d(s.passportExpiry),
        joiningDate: d(s.joiningDate),
        status: s.status,
        sites: s.projects.map((p) => p.project.name),
      }
    },
  }
}

// ── tool implementations ────────────────────────────────────────────────────

type Ctx = { user: SessionUser }

async function searchEmployees(ctx: Ctx, args: Record<string, unknown>) {
  if (!canSee(ctx.user, 'staff.view')) return { error: 'You do not have staff access.' }
  const base = await staffBase(ctx.user)
  const name = str(args.name)?.toLowerCase()
  const trade = str(args.trade)?.toLowerCase()
  const site = str(args.site)?.toLowerCase()
  const status = str(args.status) ?? 'active'
  const where: Record<string, unknown> = { deletedAt: null }
  if (status !== 'all') where.status = status
  if (name) where.fullName = { contains: name }
  if (trade) where.staffCategory = { is: { name: { contains: trade } } }
  if (site) where.projects = { some: { project: { name: { contains: site } } } }
  const rows = await db.staff.findMany({
    where,
    select: base.select,
    take: MAX_ROWS,
    orderBy: { fullName: 'asc' },
  })
  return {
    count: rows.length,
    truncated: rows.length >= MAX_ROWS,
    employees: rows.map(base.map),
  }
}

async function getEmployee(ctx: Ctx, args: Record<string, unknown>) {
  if (!canSee(ctx.user, 'staff.view')) return { error: 'You do not have staff access.' }
  const query = str(args.query) ?? str(args.name) ?? str(args.employee_id) ?? ''
  if (!query) return { error: 'Provide a name or id.' }
  const base = await staffBase(ctx.user)
  let staff = await db.staff.findUnique({
    where: { id: query },
    select: base.select,
  })
  if (!staff) {
    staff = await db.staff.findFirst({
      where: { fullName: { contains: query }, deletedAt: null },
      select: base.select,
    })
  }
  if (!staff) return { found: false, message: `No employee matching "${query}".` }
  const s = base.map(staff)
  // deployment + recent attendance (last 30 days)
  const since = new Date(Date.now() - 30 * 86_400_000)
  const [attCount, attHours] = await Promise.all([
    db.attendance.count({
      where: { staffId: s.id, checkIn: { gte: since } },
    }),
    db.attendance.aggregate({
      where: { staffId: s.id, checkIn: { gte: since } },
      _sum: { durationMinutes: true },
    }),
  ])
  return {
    found: true,
    employee: s,
    last30Days: {
      attendanceEntries: attCount,
      totalHours: round2((attHours._sum.durationMinutes ?? 0) / 60),
    },
    note: 'Salary/payroll details require a separate payroll-permitted question.',
  }
}

async function iqamaExpiring(ctx: Ctx, args: Record<string, unknown>) {
  if (!canSee(ctx.user, 'staff.view')) return { error: 'You do not have staff access.' }
  const days = Math.min(365, Math.max(1, Math.round(num(args.days) ?? 30)))
  const includeExpired = args.include_expired === true
  const now = new Date()
  const until = new Date(now.getTime() + days * 86_400_000)
  const base = await staffBase(ctx.user)
  const rows = await db.staff.findMany({
    where: {
      deletedAt: null,
      status: 'active',
      iqamaExpiry: includeExpired ? { lte: until } : { gte: now, lte: until },
    },
    select: base.select,
    orderBy: { iqamaExpiry: 'asc' },
    take: MAX_ROWS,
  })
  return {
    windowDays: days,
    includeExpired,
    count: rows.length,
    employees: rows.map((r) => {
      const m = base.map(r)
      const exp = r.iqamaExpiry ? new Date(r.iqamaExpiry) : null
      const daysLeft = exp
        ? Math.ceil((exp.getTime() - now.getTime()) / 86_400_000)
        : null
      return { ...m, daysLeft }
    }),
  }
}

async function siteManpower(ctx: Ctx, args: Record<string, unknown>) {
  if (!canSee(ctx.user, 'staff.view') && !canSee(ctx.user, 'projects.view')) {
    return { error: 'You do not have site/staff access.' }
  }
  const site = str(args.site)
  const projects = await db.project.findMany({
    where: site
      ? { name: { contains: site } }
      : { status: { in: ['active', 'completed'] } },
    select: {
      id: true,
      name: true,
      status: true,
      client: { select: { name: true } },
      clientRatePerHour: true,
      staff: { select: { staff: { select: { staffCategory: { select: { name: true } }, position: true, status: true } } } },
    },
    orderBy: { name: 'asc' },
  })
  const sites = projects.map((p) => {
    const active = p.staff.filter((s) => s.staff.status === 'active')
    const byTrade = new Map<string, number>()
    for (const s of active) {
      const trade = s.staff.staffCategory?.name ?? s.staff.position ?? 'Uncategorized'
      byTrade.set(trade, (byTrade.get(trade) ?? 0) + 1)
    }
    return {
      site: p.name,
      status: p.status,
      client: p.client?.name ?? null,
      clientRatePerHour: p.clientRatePerHour || null,
      totalWorkers: active.length,
      byTrade: [...byTrade.entries()]
        .map(([trade, count]) => ({ trade, count }))
        .sort((a, b) => b.count - a.count),
    }
  })
  return {
    sites,
    grandTotalWorkers: sites.reduce((s, x) => s + x.totalWorkers, 0),
    note: site && sites.length === 0 ? `No site matching "${site}".` : undefined,
  }
}

async function attendanceSummary(ctx: Ctx, args: Record<string, unknown>) {
  if (!canSee(ctx.user, 'attendance.view')) return { error: 'You do not have attendance access.' }
  const now = new Date()
  const month = Math.min(12, Math.max(1, Math.round(num(args.month) ?? now.getMonth() + 1)))
  const year = Math.round(num(args.year) ?? now.getFullYear())
  const from = new Date(Date.UTC(year, month - 1, 1))
  const to = new Date(Date.UTC(year, month, 1))
  const employee = str(args.employee)
  const site = str(args.site)
  const where: Record<string, unknown> = { checkIn: { gte: from, lt: to } }
  if (employee) where.staff = { fullName: { contains: employee } }
  if (site) where.project = { name: { contains: site } }
  const rows = await db.attendance.findMany({
    where,
    select: {
      durationMinutes: true,
      checkIn: true,
      checkOut: true,
      staff: { select: { id: true, fullName: true } },
      project: { select: { name: true } },
    },
    take: 5000,
  })
  const perStaff = new Map<string, { name: string; entries: number; hours: number }>()
  for (const r of rows) {
    const cur = perStaff.get(r.staff.id) ?? { name: r.staff.fullName, entries: 0, hours: 0 }
    cur.entries += 1
    cur.hours += (r.durationMinutes ?? 0) / 60
    perStaff.set(r.staff.id, cur)
  }
  const list = [...perStaff.values()]
    .map((x) => ({ ...x, hours: round2(x.hours) }))
    .sort((a, b) => b.hours - a.hours)
    .slice(0, MAX_ROWS)
  return {
    period: { month, year },
    totalEntries: rows.length,
    distinctWorkers: perStaff.size,
    totalHours: round2(rows.reduce((s, r) => s + (r.durationMinutes ?? 0) / 60, 0)),
    missingCheckout: rows.filter((r) => !r.checkOut).length,
    perWorker: list,
    truncated: perStaff.size > MAX_ROWS,
  }
}

async function payrollSummary(ctx: Ctx, args: Record<string, unknown>) {
  if (!canSeePayroll(ctx.user)) {
    return {
      error:
        'Payroll data is restricted to Admin / Accounts roles. Your current role does not have payroll permission.',
    }
  }
  const now = new Date()
  const month = Math.min(12, Math.max(1, Math.round(num(args.month) ?? now.getMonth())))
  const year = Math.round(num(args.year) ?? now.getFullYear())
  const rows = await db.payroll.findMany({
    where: { month, year },
    select: {
      grossPay: true,
      totalDeductions: true,
      netPay: true,
      advance: true,
      status: true,
      totalHours: true,
      overtimeHours: true,
      otherEarnings: true,
      absentPenalty: true,
      staff: { select: { fullName: true } },
      project: { select: { name: true } },
      advanceDeductions: { select: { amount: true } },
    },
  })
  const sum = (f: (r: (typeof rows)[number]) => number) => money(rows.reduce((s, r) => s + f(r), 0))
  const advanceLinked = rows.reduce(
    (s, r) => s + r.advanceDeductions.reduce((x, a) => x + a.amount, 0),
    0
  )
  return {
    period: { month, year },
    workers: rows.length,
    totals: {
      grossPay: sum((r) => r.grossPay),
      totalDeductions: sum((r) => r.totalDeductions),
      advancesDeducted: sum((r) => r.advance),
      advanceNotesLinked: money(advanceLinked),
      netPay: sum((r) => r.netPay),
      totalHours: round2(rows.reduce((s, r) => s + r.totalHours, 0)),
      overtimeHours: round2(rows.reduce((s, r) => s + r.overtimeHours, 0)),
    },
    byStatus: ['pending', 'paid'].map((st) => ({
      status: st,
      workers: rows.filter((r) => r.status === st).length,
      netPay: money(rows.filter((r) => r.status === st).reduce((s, r) => s + r.netPay, 0)),
    })),
    bySite: Object.entries(
      rows.reduce<Record<string, { workers: number; netPay: number }>>((acc, r) => {
        const key = r.project?.name ?? 'Unassigned'
        acc[key] = acc[key] ?? { workers: 0, netPay: 0 }
        acc[key].workers += 1
        acc[key].netPay += r.netPay
        return acc
      }, {})
    ).map(([site, v]) => ({ site, workers: v.workers, netPay: money(v.netPay) })),
  }
}

async function workerAdvances(ctx: Ctx, args: Record<string, unknown>) {
  if (!canSee(ctx.user, 'advances.view')) return { error: 'You do not have advances access.' }
  const now = new Date()
  const month = Math.min(12, Math.max(1, Math.round(num(args.month) ?? now.getMonth())))
  const year = Math.round(num(args.year) ?? now.getFullYear())
  const employee = str(args.employee)
  const from = new Date(Date.UTC(year, month - 1, 1))
  const to = new Date(Date.UTC(year, month, 1))
  const where: Record<string, unknown> = { givenDate: { gte: from, lt: to } }
  if (employee) where.staff = { fullName: { contains: employee } }
  const [rows, outstanding] = await Promise.all([
    db.workerAdvance.findMany({
      where,
      select: {
        amount: true,
        givenDate: true,
        paymentMethod: true,
        reference: true,
        installments: true,
        deductedAmount: true,
        status: true,
        staff: { select: { fullName: true } },
      },
      orderBy: { givenDate: 'desc' },
      take: MAX_ROWS,
    }),
    db.workerAdvance.aggregate({
      where: { status: { in: ['pending', 'partially_deducted'] } },
      _sum: { amount: true, deductedAmount: true },
    }),
  ])
  return {
    period: { month, year },
    count: rows.length,
    totalGiven: money(rows.reduce((s, r) => s + r.amount, 0)),
    advances: rows.map((r) => ({
      worker: r.staff.fullName,
      amount: money(r.amount),
      givenDate: d(r.givenDate),
      method: r.paymentMethod,
      installments: r.installments,
      recovered: money(r.deductedAmount),
      outstanding: money(r.amount - r.deductedAmount),
      status: r.status,
      reference: r.reference,
    })),
    companyWideOutstanding: {
      given: money(outstanding._sum.amount ?? 0),
      recovered: money(outstanding._sum.deductedAmount ?? 0),
      remaining: money((outstanding._sum.amount ?? 0) - (outstanding._sum.deductedAmount ?? 0)),
    },
  }
}

async function invoicesTool(ctx: Ctx, args: Record<string, unknown>) {
  if (!canSee(ctx.user, 'einvoices.view')) return { error: 'You do not have invoice access.' }
  const client = str(args.client)
  const status = str(args.status)
  const dateFrom = str(args.date_from)
  const dateTo = str(args.date_to)
  const where: Record<string, unknown> = {}
  if (client) {
    where.OR = [
      { clientNameEn: { contains: client } },
      { client: { is: { name: { contains: client } } } },
    ]
  }
  if (status && status !== 'all') where.status = status
  if (dateFrom || dateTo) {
    where.issueDate = {}
    if (dateFrom) (where.issueDate as { gte?: Date }).gte = new Date(dateFrom)
    if (dateTo) (where.issueDate as { lte?: Date }).lte = new Date(`${dateTo}T23:59:59`)
  }
  const rows = await db.eInvoice.findMany({
    where,
    select: {
      invoiceNumber: true,
      docType: true,
      clientNameEn: true,
      issueDate: true,
      dueDate: true,
      status: true,
      taxableAmount: true,
      vatAmount: true,
      totalDue: true,
      paidAmount: true,
      zatcaPhase: true,
    },
    orderBy: { issueDate: 'desc' },
    take: MAX_ROWS,
  })
  const list = rows.map((r) => ({
    number: r.invoiceNumber,
    type: r.docType,
    client: r.clientNameEn,
    issued: d(r.issueDate),
    due: d(r.dueDate),
    status: r.status,
    taxable: money(r.taxableAmount),
    vat: money(r.vatAmount),
    totalDue: money(r.totalDue),
    paid: money(r.paidAmount),
    outstanding: money(r.totalDue - r.paidAmount),
    zatcaPhase: r.zatcaPhase,
  }))
  return {
    count: list.length,
    truncated: list.length >= MAX_ROWS,
    totals: {
      totalDue: money(list.reduce((s, r) => s + r.totalDue, 0)),
      paid: money(list.reduce((s, r) => s + r.paid, 0)),
      outstanding: money(list.reduce((s, r) => s + r.outstanding, 0)),
      vat: money(list.reduce((s, r) => s + r.vat, 0)),
    },
    invoices: list,
  }
}

async function receivablesAging(ctx: Ctx, _args: Record<string, unknown>) {
  if (!canSee(ctx.user, 'einvoices.view')) return { error: 'You do not have invoice access.' }
  void _args
  const rows = await db.eInvoice.findMany({
    where: { status: { in: ['issued', 'partially_paid'] }, docType: 'invoice' },
    select: {
      invoiceNumber: true,
      clientNameEn: true,
      issueDate: true,
      dueDate: true,
      totalDue: true,
      paidAmount: true,
    },
    take: 1000,
  })
  const now = Date.now()
  const buckets: Record<string, { count: number; amount: number; invoices: unknown[] }> = {
    '0-30': { count: 0, amount: 0, invoices: [] },
    '31-60': { count: 0, amount: 0, invoices: [] },
    '61-90': { count: 0, amount: 0, invoices: [] },
    '90+': { count: 0, amount: 0, invoices: [] },
  }
  for (const r of rows) {
    const outstanding = r.totalDue - r.paidAmount
    if (outstanding <= 0.005) continue
    const ref = (r.dueDate ?? r.issueDate).getTime()
    const days = Math.floor((now - ref) / 86_400_000)
    const bucket = days <= 30 ? '0-30' : days <= 60 ? '31-60' : days <= 90 ? '61-90' : '90+'
    buckets[bucket].count += 1
    buckets[bucket].amount += outstanding
    buckets[bucket].invoices.push({
      number: r.invoiceNumber,
      client: r.clientNameEn,
      daysOverdue: days,
      outstanding: money(outstanding),
      dueDate: d(r.dueDate),
    })
  }
  for (const b of Object.values(buckets)) {
    b.amount = money(b.amount)
    b.invoices = (b.invoices as { daysOverdue: number }[]).sort(
      (x, y) => y.daysOverdue - x.daysOverdue
    )
  }
  const clients60 = new Map<string, { client: string; invoices: number; amount: number }>()
  for (const key of ['61-90', '90+']) {
    for (const inv of buckets[key].invoices as { client: string; outstanding: number }[]) {
      const cur = clients60.get(inv.client) ?? { client: inv.client, invoices: 0, amount: 0 }
      cur.invoices += 1
      cur.amount += inv.outstanding
      clients60.set(inv.client, cur)
    }
  }
  return {
    totalOutstanding: money(
      Object.values(buckets).reduce((s, b) => s + b.amount, 0)
    ),
    buckets,
    clientsOver60Days: [...clients60.values()]
      .map((c) => ({ ...c, amount: money(c.amount) }))
      .sort((a, b) => b.amount - a.amount),
  }
}

async function quotationsTool(ctx: Ctx, args: Record<string, unknown>) {
  if (!canSee(ctx.user, 'quotations.view')) return { error: 'You do not have quotation access.' }
  const client = str(args.client)
  const status = str(args.status)
  const dateFrom = str(args.date_from)
  const dateTo = str(args.date_to)
  const where: Record<string, unknown> = {}
  if (client) where.clientName = { contains: client }
  if (status && status !== 'all') where.status = status
  if (dateFrom || dateTo) {
    where.issueDate = {}
    if (dateFrom) (where.issueDate as { gte?: Date }).gte = new Date(dateFrom)
    if (dateTo) (where.issueDate as { lte?: Date }).lte = new Date(`${dateTo}T23:59:59`)
  }
  const rows = await db.quotation.findMany({
    where,
    select: {
      quoteNumber: true,
      clientName: true,
      subject: true,
      issueDate: true,
      validityDate: true,
      status: true,
      subtotal: true,
      vatAmount: true,
      total: true,
      contractMonths: true,
      items: { select: { sr: true } },
    },
    orderBy: { issueDate: 'desc' },
    take: MAX_ROWS,
  })
  const list = rows.map((r) => ({
    number: r.quoteNumber,
    client: r.clientName,
    subject: r.subject,
    issued: d(r.issueDate),
    validUntil: d(r.validityDate),
    status: r.status,
    items: r.items.length,
    subtotal: money(r.subtotal),
    vat: money(r.vatAmount),
    total: money(r.total),
    contractMonths: r.contractMonths,
  }))
  return {
    count: list.length,
    truncated: list.length >= MAX_ROWS,
    totals: { subtotal: money(list.reduce((s, r) => s + r.subtotal, 0)), total: money(list.reduce((s, r) => s + r.total, 0)) },
    quotations: list,
  }
}

async function purchaseOrders(ctx: Ctx, args: Record<string, unknown>) {
  if (!canSee(ctx.user, 'supplierpo.view')) return { error: 'You do not have purchase order access.' }
  const supplier = str(args.supplier)
  const status = str(args.status)
  const dateFrom = str(args.date_from)
  const dateTo = str(args.date_to)
  const where: Record<string, unknown> = {}
  if (supplier) where.supplierName = { contains: supplier }
  if (status && status !== 'all') where.status = status
  if (dateFrom || dateTo) {
    where.issueDate = {}
    if (dateFrom) (where.issueDate as { gte?: Date }).gte = new Date(dateFrom)
    if (dateTo) (where.issueDate as { lte?: Date }).lte = new Date(`${dateTo}T23:59:59`)
  }
  const rows = await db.supplierPo.findMany({
    where,
    select: {
      poNumber: true,
      supplierName: true,
      issueDate: true,
      expectedDate: true,
      status: true,
      subtotal: true,
      vatAmount: true,
      total: true,
      workSite: true,
    },
    orderBy: { issueDate: 'desc' },
    take: MAX_ROWS,
  })
  const list = rows.map((r) => ({
    number: r.poNumber,
    supplier: r.supplierName,
    issued: d(r.issueDate),
    expected: d(r.expectedDate),
    status: r.status,
    workSite: r.workSite,
    subtotal: money(r.subtotal),
    vat: money(r.vatAmount),
    total: money(r.total),
  }))
  return {
    count: list.length,
    truncated: list.length >= MAX_ROWS,
    totals: { total: money(list.reduce((s, r) => s + r.total, 0)) },
    purchaseOrders: list,
  }
}

/** Parse "2026-Q3" | "2026-10" | {month, year} into a UTC range. */
function parsePeriod(args: Record<string, unknown>): {
  label: string
  from: Date
  to: Date
  quarter: number | null
  month: number | null
  year: number
} {
  const now = new Date()
  let year = now.getFullYear()
  let month: number | null = null
  let quarter: number | null = null
  const p = str(args.period)
  if (p) {
    const qm = p.match(/^(\d{4})-?Q([1-4])$/i)
    const mm = p.match(/^(\d{4})-?(?:M)?(\d{1,2})$/i)
    if (qm) {
      year = parseInt(qm[1], 10)
      quarter = parseInt(qm[2], 10)
    } else if (mm) {
      year = parseInt(mm[1], 10)
      month = Math.min(12, Math.max(1, parseInt(mm[2], 10)))
    }
  } else {
    const m = num(args.month)
    const y = num(args.year)
    if (m) month = Math.min(12, Math.max(1, Math.round(m)))
    if (y) year = Math.round(y)
    const q = num(args.quarter)
    if (q && !month) quarter = Math.min(4, Math.max(1, Math.round(q)))
  }
  if (quarter) {
    const from = new Date(Date.UTC(year, (quarter - 1) * 3, 1))
    const to = new Date(Date.UTC(year, quarter * 3, 1))
    return { label: `${year}-Q${quarter}`, from, to, quarter, month: null, year }
  }
  const m2 = month ?? now.getMonth() + 1
  const from = new Date(Date.UTC(year, m2 - 1, 1))
  const to = new Date(Date.UTC(year, m2, 1))
  return { label: `${year}-${String(m2).padStart(2, '0')}`, from, to, quarter: null, month: m2, year }
}

async function vatSummary(ctx: Ctx, args: Record<string, unknown>) {
  const canVat = canSee(ctx.user, 'einvoices.view') || canSee(ctx.user, 'vat.view')
  if (!canVat) return { error: 'You do not have VAT/invoice access.' }
  const period = parsePeriod(args)
  // Output VAT — issued e-invoices (credit notes negative, debit notes positive)
  const invs = await db.eInvoice.findMany({
    where: {
      issueDate: { gte: period.from, lt: period.to },
      status: { in: ['issued', 'partially_paid', 'paid'] },
    },
    select: { docType: true, vatAmount: true, taxableAmount: true, totalDue: true },
  })
  let outputVat = 0
  let salesTaxable = 0
  let creditNoteVat = 0
  let debitNoteVat = 0
  for (const r of invs) {
    if (r.docType === 'credit_note') creditNoteVat += r.vatAmount
    else if (r.docType === 'debit_note') debitNoteVat += r.vatAmount
    else {
      outputVat += r.vatAmount
      salesTaxable += r.taxableAmount
    }
  }
  // Input VAT — supplier VAT expense bills
  const input = await db.vatExpenseBill.findMany({
    where: { billDate: { gte: period.from, lt: period.to } },
    select: { vatAmount: true, amountWithoutVat: true, vatRateSnapshot: true },
  })
  const inputVat = input.reduce((s, r) => s + r.vatAmount, 0)
  const inputNet = input.reduce((s, r) => s + r.amountWithoutVat, 0)
  const outputNet = outputVat - creditNoteVat + debitNoteVat
  return {
    period: { label: period.label, from: d(period.from), to: d(new Date(period.to.getTime() - 1)) },
    sales: {
      invoicesCounted: invs.filter((r) => r.docType === 'invoice').length,
      taxableSales: money(salesTaxable),
      outputVat: money(outputVat),
    },
    adjustments: {
      creditNoteVat: money(-creditNoteVat),
      debitNoteVat: money(debitNoteVat),
    },
    purchases: {
      billsCounted: input.length,
      netPurchases: money(inputNet),
      inputVat: money(inputVat),
      vatRateUsed: input.length ? input[0].vatRateSnapshot : 0.15,
    },
    net: {
      outputVatTotal: money(outputNet),
      inputVat: money(inputVat),
      netVatPayable: money(outputNet - inputVat),
    },
    note:
      input.length === 0
        ? 'No input VAT bills recorded for this period — net VAT is based on output VAT only.'
        : undefined,
  }
}

async function expensesTool(ctx: Ctx, args: Record<string, unknown>) {
  if (!canSee(ctx.user, 'accounts.view')) return { error: 'You do not have accounts access.' }
  const category = str(args.category)
  const dateFrom = str(args.date_from)
  const dateTo = str(args.date_to)
  const now = new Date()
  const from = dateFrom ? new Date(dateFrom) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const to = dateTo ? new Date(`${dateTo}T23:59:59`) : new Date()
  const where: Record<string, unknown> = {
    type: 'expense',
    transactionDate: { gte: from, lte: to },
  }
  if (category) where.transactionCategory = { name: { contains: category } }
  const [rows, agg] = await Promise.all([
    db.transaction.findMany({
      where,
      select: {
        title: true,
        amount: true,
        transactionDate: true,
        description: true,
        transactionCategory: { select: { name: true } },
        project: { select: { name: true } },
        spender: { select: { fullName: true } },
      },
      orderBy: { transactionDate: 'desc' },
      take: MAX_ROWS,
    }),
    db.transaction.findMany({
      where,
      select: { amount: true, transactionCategory: { select: { name: true } } },
    }),
  ])
  const byCat = new Map<string, number>()
  for (const r of agg) {
    const k = r.transactionCategory?.name ?? 'Uncategorized'
    byCat.set(k, (byCat.get(k) ?? 0) + r.amount)
  }
  return {
    period: { from: d(from), to: d(to) },
    count: rows.length,
    truncated: rows.length >= MAX_ROWS,
    total: money(agg.reduce((s, r) => s + r.amount, 0)),
    byCategory: [...byCat.entries()]
      .map(([name, amount]) => ({ name, amount: money(amount) }))
      .sort((a, b) => b.amount - a.amount),
    expenses: rows.map((r) => ({
      date: d(r.transactionDate),
      title: r.title,
      category: r.transactionCategory?.name ?? 'Uncategorized',
      project: r.project?.name ?? null,
      spentBy: r.spender?.fullName ?? null,
      amount: money(r.amount),
    })),
  }
}

async function clientsTool(ctx: Ctx, _args: Record<string, unknown>) {
  if (!canSee(ctx.user, 'clients.view')) return { error: 'You do not have client access.' }
  void _args
  const rows = await db.client.findMany({
    select: {
      name: true,
      nameAr: true,
      contactPerson: true,
      phone: true,
      email: true,
      city: true,
      crNumber: true,
      vatNumber: true,
      status: true,
      projects: { select: { id: true } },
    },
    orderBy: { name: 'asc' },
    take: MAX_ROWS,
  })
  return {
    count: rows.length,
    clients: rows.map((r) => ({
      name: r.name,
      nameAr: r.nameAr,
      contact: r.contactPerson,
      phone: r.phone,
      email: r.email,
      city: r.city,
      crNumber: r.crNumber,
      vatNumber: r.vatNumber,
      status: r.status,
      projects: r.projects.length,
    })),
  }
}

async function suppliersTool(ctx: Ctx, _args: Record<string, unknown>) {
  if (!canSee(ctx.user, 'suppliers.view') && !canSee(ctx.user, 'supplierpo.view')) {
    return { error: 'You do not have supplier access.' }
  }
  void _args
  const rows = await db.supplier.findMany({
    select: {
      name: true,
      contactPerson: true,
      phone: true,
      email: true,
      vatNumber: true,
      crNumber: true,
      status: true,
      purchaseOrders: { select: { total: true } },
    },
    orderBy: { name: 'asc' },
    take: MAX_ROWS,
  })
  return {
    count: rows.length,
    suppliers: rows.map((r) => ({
      name: r.name,
      contact: r.contactPerson,
      phone: r.phone,
      email: r.email,
      vatNumber: r.vatNumber,
      crNumber: r.crNumber,
      status: r.status,
      poCount: r.purchaseOrders.length,
      poTotalValue: money(r.purchaseOrders.reduce((s, p) => s + p.total, 0)),
    })),
  }
}

// ── registry ────────────────────────────────────────────────────────────────

export type Tool = {
  name: string
  description: string
  parameters: Record<string, unknown>
  /** Extra gating beyond module visibility (payroll = role-level). */
  sensitive?: boolean
  run: (ctx: Ctx, args: Record<string, unknown>) => Promise<unknown>
}

export const TOOLS: Tool[] = [
  {
    name: 'search_employees',
    description:
      'Search workers/employees by name, trade (job category), site/project name and status. Returns id, name, trade, masked Iqama, expiry dates, sites.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Partial name to match' },
        trade: { type: 'string', description: 'Trade/category e.g. Electrician, Plumber' },
        site: { type: 'string', description: 'Site/project name (partial)' },
        status: { type: 'string', enum: ['active', 'inactive', 'all'], description: 'Default active' },
      },
    },
    run: searchEmployees,
  },
  {
    name: 'get_employee',
    description:
      'Get one employee by name or id: full profile + sites + last-30-days attendance totals. Use after search_employees for details.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Employee id or full/partial name' } },
      required: ['query'],
    },
    run: getEmployee,
  },
  {
    name: 'iqama_expiring',
    description:
      'Workers whose Iqama expires within N days (default 30). Ordered by expiry date; includes daysLeft per worker.',
    parameters: {
      type: 'object',
      properties: {
        days: { type: 'number', description: 'Look-ahead window in days (1-365, default 30)' },
        include_expired: { type: 'boolean', description: 'Also include already-expired Iqamas' },
      },
    },
    run: iqamaExpiring,
  },
  {
    name: 'site_manpower',
    description:
      'Workers count by trade on each site/project (or one site when given). Includes client and grand total.',
    parameters: {
      type: 'object',
      properties: { site: { type: 'string', description: 'Optional site/project name (partial)' } },
    },
    run: siteManpower,
  },
  {
    name: 'attendance_summary',
    description:
      'Attendance totals for a month: entries, hours, missing checkouts, and per-worker hours. Filter by employee name or site.',
    parameters: {
      type: 'object',
      properties: {
        month: { type: 'number', description: '1-12 (default current month)' },
        year: { type: 'number', description: 'e.g. 2026' },
        employee: { type: 'string', description: 'Partial worker name' },
        site: { type: 'string', description: 'Site/project name (partial)' },
      },
    },
    run: attendanceSummary,
  },
  {
    name: 'payroll_summary',
    description:
      'Payroll totals for a month: gross pay, deductions, advances deducted, net pay, hours, breakdown by status and site. RESTRICTED to Admin/Accounts roles.',
    parameters: {
      type: 'object',
      properties: {
        month: { type: 'number', description: '1-12' },
        year: { type: 'number', description: 'e.g. 2026' },
      },
    },
    sensitive: true,
    run: payrollSummary,
  },
  {
    name: 'worker_advances',
    description:
      'Worker salary advances given in a month (amount, installments, recovered, outstanding) plus company-wide outstanding balance.',
    parameters: {
      type: 'object',
      properties: {
        month: { type: 'number', description: '1-12' },
        year: { type: 'number', description: 'e.g. 2026' },
        employee: { type: 'string', description: 'Partial worker name' },
      },
    },
    run: workerAdvances,
  },
  {
    name: 'invoices',
    description:
      'E-invoices with filters (client, status, date range). Totals computed server-side: totalDue, paid, outstanding, VAT.',
    parameters: {
      type: 'object',
      properties: {
        client: { type: 'string', description: 'Client name (partial)' },
        status: { type: 'string', enum: ['draft', 'issued', 'partially_paid', 'paid', 'all'] },
        date_from: { type: 'string', description: 'YYYY-MM-DD' },
        date_to: { type: 'string', description: 'YYYY-MM-DD' },
      },
    },
    run: invoicesTool,
  },
  {
    name: 'receivables_aging',
    description:
      'Unpaid issued invoices grouped by age: 0-30 / 31-60 / 61-90 / 90+ days overdue, plus clients with invoices over 60 days.',
    parameters: { type: 'object', properties: {} },
    run: receivablesAging,
  },
  {
    name: 'quotations',
    description:
      'Quotations with filters (client, status, date range) and totals: subtotal, VAT, total.',
    parameters: {
      type: 'object',
      properties: {
        client: { type: 'string', description: 'Client name (partial)' },
        status: { type: 'string', enum: ['draft', 'sent', 'accepted', 'rejected', 'expired', 'all'] },
        date_from: { type: 'string', description: 'YYYY-MM-DD' },
        date_to: { type: 'string', description: 'YYYY-MM-DD' },
      },
    },
    run: quotationsTool,
  },
  {
    name: 'purchase_orders',
    description: 'Supplier purchase orders with filters (supplier, status, date range) and totals.',
    parameters: {
      type: 'object',
      properties: {
        supplier: { type: 'string', description: 'Supplier name (partial)' },
        status: { type: 'string', enum: ['draft', 'ordered', 'received', 'cancelled', 'all'] },
        date_from: { type: 'string', description: 'YYYY-MM-DD' },
        date_to: { type: 'string', description: 'YYYY-MM-DD' },
      },
    },
    run: purchaseOrders,
  },
  {
    name: 'vat_summary',
    description:
      'VAT summary for a period (e.g. "2026-Q3" or "2026-09"): output VAT from issued e-invoices (with credit/debit note adjustments), input VAT from VAT Return Expense bills, and net VAT payable.',
    parameters: {
      type: 'object',
      properties: {
        period: { type: 'string', description: 'YYYY-Qn or YYYY-MM, e.g. 2026-Q3 or 2026-09' },
      },
    },
    run: vatSummary,
  },
  {
    name: 'expenses',
    description:
      'Company expenses for a period with optional category filter: total, by-category breakdown and recent entries.',
    parameters: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'Category name (partial)' },
        date_from: { type: 'string', description: 'YYYY-MM-DD (default: start of current month)' },
        date_to: { type: 'string', description: 'YYYY-MM-DD (default: today)' },
      },
    },
    run: expensesTool,
  },
  {
    name: 'clients',
    description: 'Client directory: names (EN/AR), contacts, city, CR/VAT numbers, project counts.',
    parameters: { type: 'object', properties: {} },
    run: clientsTool,
  },
  {
    name: 'suppliers',
    description: 'Supplier directory: contacts, VAT/CR numbers, PO counts and total PO value.',
    parameters: { type: 'object', properties: {} },
    run: suppliersTool,
  },
]

export function getTool(name: string): Tool | undefined {
  return TOOLS.find((t) => t.name === name)
}

/** Tool definitions visible to this user (payroll tools only for permitted roles). */
export function visibleTools(user: SessionUser): Tool[] {
  const payrollOk = canSeePayroll(user)
  return TOOLS.filter((t) => !t.sensitive || payrollOk)
}

export function payrollAllowed(user: SessionUser): boolean {
  return canSeePayroll(user)
}

/** OpenAI-format tool specs for the LLM request (only visible tools). */
export function toolSpecsFor(user: SessionUser) {
  return visibleTools(user).map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }))
}

// GET /api/search?q= — global record search powering the command palette.
// Permission-aware: staff results need `staff.view`, projects `projects.view`,
// clients `clients.view`, transactions `accounts.view`, payrolls `payroll.view`.
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { monthName, round2 } from '@/lib/format'
import { ok, serverError, requireAuth, isResponse } from '@/lib/api-helpers'
import { hasPermission } from '@/lib/auth'

const MIN_QUERY = 2
const PER_ENTITY_LIMIT = 5

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth()
    if (isResponse(user)) return user

    const q = (new URL(req.url).searchParams.get('q') ?? '').trim()
    if (q.length < MIN_QUERY) return ok({ staff: [], projects: [], clients: [], transactions: [], payrolls: [] })

    const canStaff = hasPermission(user, 'staff.view')
    const canProjects = hasPermission(user, 'projects.view')
    const canClients = hasPermission(user, 'clients.view')
    const canTransactions = hasPermission(user, 'accounts.view')
    const canPayrolls = hasPermission(user, 'payroll.view')

    // Payroll period matching: month names ("sep" → 9) and 4-digit years
    const qLower = q.toLowerCase()
    const monthMatches: number[] = []
    for (let m = 1; m <= 12; m++) {
      if (monthName(m).toLowerCase().includes(qLower)) monthMatches.push(m)
    }
    const yearMatch = /^\d{4}$/.test(q) ? Number(q) : 0

    const [staff, projects, clients, transactions, payrolls] = await Promise.all([
      canStaff
        ? db.staff.findMany({
            where: {
              deletedAt: null,
              OR: [{ fullName: { contains: q } }, { iqamaId: { contains: q } }],
            },
            select: { id: true, fullName: true, iqamaId: true, position: true, status: true },
            orderBy: { fullName: 'asc' },
            take: PER_ENTITY_LIMIT,
          })
        : Promise.resolve([]),
      canProjects
        ? db.project.findMany({
            where: {
              OR: [
                { name: { contains: q } },
                { managerName: { contains: q } },
                { location: { contains: q } },
              ],
            },
            select: { id: true, name: true, managerName: true, location: true, status: true },
            orderBy: { name: 'asc' },
            take: PER_ENTITY_LIMIT,
          })
        : Promise.resolve([]),
      canClients
        ? db.client.findMany({
            where: {
              OR: [
                { name: { contains: q } },
                { contactPerson: { contains: q } },
                { city: { contains: q } },
              ],
            },
            select: { id: true, name: true, city: true, contactPerson: true, status: true },
            orderBy: { name: 'asc' },
            take: PER_ENTITY_LIMIT,
          })
        : Promise.resolve([]),
      canTransactions
        ? db.transaction
            .findMany({
              where: {
                OR: [
                  { title: { contains: q } },
                  { description: { contains: q } },
                  { transactionCategory: { name: { contains: q } } },
                ],
              },
              select: {
                id: true,
                type: true,
                title: true,
                amount: true,
                transactionDate: true,
                transactionCategory: { select: { name: true } },
              },
              orderBy: { transactionDate: 'desc' },
              take: PER_ENTITY_LIMIT,
            })
            .then((rows) =>
              rows.map((t) => ({
                id: t.id,
                type: t.type as 'income' | 'expense',
                title: t.title,
                amount: round2(t.amount),
                transactionDate: t.transactionDate.toISOString(),
                categoryName: t.transactionCategory.name,
              }))
            )
        : Promise.resolve([]),
      canPayrolls
        ? db.payroll
            .findMany({
              where: {
                OR: [
                  { staff: { fullName: { contains: q } } },
                  { staff: { iqamaId: { contains: q } } },
                  ...(monthMatches.length ? [{ month: { in: monthMatches } }] : []),
                  ...(yearMatch > 0 ? [{ year: yearMatch }] : []),
                ],
              },
              select: {
                id: true,
                netPay: true,
                status: true,
                month: true,
                year: true,
                staff: { select: { id: true, fullName: true } },
              },
              orderBy: [{ year: 'desc' }, { month: 'desc' }],
              take: PER_ENTITY_LIMIT,
            })
            .then((rows) =>
              rows.map((p) => ({
                id: p.id,
                staffId: p.staff.id,
                staffName: p.staff.fullName,
                month: p.month,
                year: p.year,
                netPay: round2(p.netPay),
                status: p.status as 'pending' | 'paid',
              }))
            )
        : Promise.resolve([]),
    ])

    return ok({ staff, projects, clients, transactions, payrolls })
  } catch (err) {
    console.error('[api/search GET]', err)
    return serverError()
  }
}

// Salary Sheet API — all matching payroll rows (no pagination) with computed columns,
// grand totals and a per-staff-category breakdown (for the A4 landscape print view)
import { NextRequest } from 'next/server'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { round2 } from '@/lib/format'
import { ok, serverError, requirePermission, isResponse, toInt } from '@/lib/api-helpers'
import type { CategoryBreakdown } from '@/lib/types'

type SheetRowComputed = {
  basicPay: number
  otPay: number
  penaltyPt: number
  unionOther: number
}

// GET /api/payrolls/sheet?projectId&categoryId&month&year&search
export async function GET(req: NextRequest) {
  try {
    const user = await requirePermission('payroll.view')
    if (isResponse(user)) return user

    const { searchParams } = new URL(req.url)
    const search = searchParams.get('search')?.trim() ?? ''
    const projectId = searchParams.get('projectId')?.trim() ?? ''
    const categoryId = searchParams.get('categoryId')?.trim() ?? ''
    const month = toInt(searchParams.get('month'), 0)
    const year = toInt(searchParams.get('year'), 0)

    const staffConditions: Prisma.StaffWhereInput[] = []
    if (search) {
      staffConditions.push({
        OR: [{ fullName: { contains: search } }, { iqamaId: { contains: search } }],
      })
    }
    if (categoryId) staffConditions.push({ staffCategoryId: categoryId })

    const where: Prisma.PayrollWhereInput = {
      ...(staffConditions.length ? { staff: { AND: staffConditions } } : {}),
      ...(projectId ? { projectId } : {}),
      ...(month >= 1 && month <= 12 ? { month } : {}),
      ...(year > 0 ? { year } : {}),
    }

    const payrolls = await db.payroll.findMany({
      where,
      include: {
        staff: {
          select: {
            id: true,
            fullName: true,
            iqamaId: true,
            staffCategory: { select: { id: true, name: true } },
          },
        },
        project: { select: { id: true, name: true, client: { select: { name: true } } } },
      },
      orderBy: { staff: { fullName: 'asc' } },
    })

    const rows = payrolls.map((p) => {
      const basicPay = round2(p.totalHours * p.hourlyRateSnapshot)
      const otPay = round2(p.overtimeHours * p.overtimeRateSnapshot)
      const otherDeductionAmount =
        p.otherDeductionType === 'percent'
          ? round2((p.grossPay * p.otherDeductionValue) / 100)
          : round2(p.otherDeductionValue)
      const penaltyPt = round2(p.absentPenalty + p.ptAmount)
      const unionOther = round2(p.unionFees + otherDeductionAmount)
      const computed: SheetRowComputed = { basicPay, otPay, penaltyPt, unionOther }
      // Flatten the nested client relation for the print view
      const project = p.project
        ? { ...p.project, clientName: p.project.client?.name ?? null }
        : null
      return { ...p, project, ...computed }
    })

    const totals = {
      count: rows.length,
      gross: round2(rows.reduce((sum, r) => sum + r.grossPay, 0)),
      deductions: round2(rows.reduce((sum, r) => sum + r.totalDeductions, 0)),
      net: round2(rows.reduce((sum, r) => sum + r.netPay, 0)),
    }

    // group by staff category (null → "Uncategorized"), distinct manpower via Set
    const groups = new Map<
      string,
      CategoryBreakdown & { staffIds: Set<string> }
    >()
    for (const r of rows) {
      const category = r.staff.staffCategory
      const key = category?.id ?? '__uncategorized__'
      let group = groups.get(key)
      if (!group) {
        group = {
          categoryId: category?.id ?? null,
          name: category?.name ?? 'Uncategorized',
          manpower: 0,
          totalHours: 0,
          grossPay: 0,
          deductions: 0,
          totalAmount: 0,
          staffIds: new Set<string>(),
        }
        groups.set(key, group)
      }
      group.staffIds.add(r.staffId)
      group.totalHours += r.totalHours
      group.grossPay += r.grossPay
      group.deductions += r.totalDeductions
      group.totalAmount += r.netPay
    }

    const breakdown: CategoryBreakdown[] = Array.from(groups.values())
      .map((g) => ({
        categoryId: g.categoryId,
        name: g.name,
        manpower: g.staffIds.size,
        totalHours: round2(g.totalHours),
        grossPay: round2(g.grossPay),
        deductions: round2(g.deductions),
        totalAmount: round2(g.totalAmount),
      }))
      .sort((a, b) => b.totalAmount - a.totalAmount)

    return ok({ rows, totals, breakdown })
  } catch {
    return serverError()
  }
}

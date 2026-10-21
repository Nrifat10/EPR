// Staff Salary Summary API — cards (manpower / gross / deductions / disbursement) +
// per-staff-category rows with share of total disbursement (zero rows last)
import { NextRequest } from 'next/server'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { round2 } from '@/lib/format'
import { ok, serverError, requirePermission, isResponse, toInt } from '@/lib/api-helpers'

type SummaryRow = {
  name: string
  manpower: number
  totalHours: number
  otHours: number
  grossPay: number
  deductions: number
  totalAmount: number
  share: number
}

// GET /api/payrolls/summary?projectId&month&year
export async function GET(req: NextRequest) {
  try {
    const user = await requirePermission('payroll.view')
    if (isResponse(user)) return user

    const { searchParams } = new URL(req.url)
    const projectId = searchParams.get('projectId')?.trim() ?? ''
    const month = toInt(searchParams.get('month'), 0)
    const year = toInt(searchParams.get('year'), 0)

    const where: Prisma.PayrollWhereInput = {
      ...(projectId ? { projectId } : {}),
      ...(month >= 1 && month <= 12 ? { month } : {}),
      ...(year > 0 ? { year } : {}),
    }

    const payrolls = await db.payroll.findMany({
      where,
      select: {
        staffId: true,
        totalHours: true,
        overtimeHours: true,
        grossPay: true,
        totalDeductions: true,
        netPay: true,
        staff: { select: { staffCategory: { select: { name: true } } } },
      },
    })

    const cards = {
      totalManpower: new Set(payrolls.map((p) => p.staffId)).size,
      totalGross: round2(payrolls.reduce((sum, p) => sum + p.grossPay, 0)),
      totalDeductions: round2(payrolls.reduce((sum, p) => sum + p.totalDeductions, 0)),
      totalDisbursement: round2(payrolls.reduce((sum, p) => sum + p.netPay, 0)),
    }

    const groups = new Map<
      string,
      {
        name: string
        staffIds: Set<string>
        totalHours: number
        otHours: number
        grossPay: number
        deductions: number
        totalAmount: number
      }
    >()
    for (const p of payrolls) {
      const name = p.staff.staffCategory?.name ?? 'Uncategorized'
      let group = groups.get(name)
      if (!group) {
        group = {
          name,
          staffIds: new Set<string>(),
          totalHours: 0,
          otHours: 0,
          grossPay: 0,
          deductions: 0,
          totalAmount: 0,
        }
        groups.set(name, group)
      }
      group.staffIds.add(p.staffId)
      group.totalHours += p.totalHours
      group.otHours += p.overtimeHours
      group.grossPay += p.grossPay
      group.deductions += p.totalDeductions
      group.totalAmount += p.netPay
    }

    const rows: SummaryRow[] = Array.from(groups.values())
      .map((g) => {
        const totalAmount = round2(g.totalAmount)
        return {
          name: g.name,
          manpower: g.staffIds.size,
          totalHours: round2(g.totalHours),
          otHours: round2(g.otHours),
          grossPay: round2(g.grossPay),
          deductions: round2(g.deductions),
          totalAmount,
          share:
            totalAmount > 0 && cards.totalDisbursement > 0
              ? round2((100 * totalAmount) / cards.totalDisbursement)
              : 0,
        }
      })
      .sort((a, b) => {
        // totalAmount desc, but zero rows last (then name asc)
        const aZero = a.totalAmount === 0 ? 1 : 0
        const bZero = b.totalAmount === 0 ? 1 : 0
        if (aZero !== bZero) return aZero - bZero
        if (aZero === 1) return a.name.localeCompare(b.name)
        return b.totalAmount - a.totalAmount
      })

    return ok({ cards, rows })
  } catch {
    return serverError()
  }
}

// VAT Return Expense summary API — everything the monthly cards, the
// month-by-month table and the quarterly VAT return block need, in ONE call:
//   ?year=  (default: current year)   ?month= (default: current month)
// Returns:
//   vatRate       — configured rate FRACTION in effect right now
//   years         — distinct years that have bills (+ current year)
//   monthTotals   — totals for the SELECTED month (the 4 header cards)
//   monthly       — 12 month lines for the selected year (always all 12)
//   yearTotals    — selected year grand totals
//   quarters      — Q1..Q4 with the 3 month lines + quarter grand totals
//   currentQuarter / quarterEndDate / filingDeadline — filing countdown info:
//     ZATCA quarterly filers file within the month FOLLOWING quarter end,
//     so the deadline shown is the last day of that month.
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { round2 } from '@/lib/format'
import { getVatRate } from '@/lib/vat'
import { ok, serverError, requirePermission, isResponse, toInt } from '@/lib/api-helpers'
import type { VatMonthLine, VatQuarterLine, VatSummaryData } from '@/lib/types'

/** Last day of the month containing (or following) the given date, at 23:59. */
function endOfMonth(year: number, month0: number): Date {
  return new Date(year, month0 + 1, 0, 23, 59, 59, 999)
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requirePermission('vat.view')
    if (isResponse(auth)) return auth

    const sp = req.nextUrl.searchParams
    const now = new Date()
    const year = Math.min(2200, Math.max(2000, toInt(sp.get('year'), now.getFullYear())))
    const month = Math.min(12, Math.max(1, toInt(sp.get('month'), now.getMonth() + 1)))

    const vatRate = await getVatRate()

    // All bills of the selected year + the distinct-years list for dropdowns
    // (SQLite/Prisma cannot DISTINCT on a date part — plain rows + JS Set)
    const [yearBills, allBillDates] = await Promise.all([
      db.vatExpenseBill.findMany({
        where: {
          billDate: {
            gte: new Date(year, 0, 1, 0, 0, 0, 0),
            lte: endOfMonth(year, 11),
          },
        },
        select: { billDate: true, amountWithVat: true, amountWithoutVat: true, vatAmount: true },
      }),
      db.vatExpenseBill.findMany({ select: { billDate: true } }),
    ])

    // Distinct bill years
    const yearsSet = new Set<number>(allBillDates.map((r) => r.billDate.getFullYear()))
    yearsSet.add(now.getFullYear()) // always keep the current year selectable
    const years = Array.from(yearsSet).sort((a, b) => b - a)

    // 12 zeroed month lines
    const monthly: VatMonthLine[] = Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      count: 0,
      withVat: 0,
      withoutVat: 0,
      vat: 0,
    }))
    const yearTotals = { count: 0, withVat: 0, withoutVat: 0, vat: 0 }
    for (const b of yearBills) {
      const line = monthly[b.billDate.getMonth()]
      line.count += 1
      line.withVat += b.amountWithVat
      line.withoutVat += b.amountWithoutVat
      line.vat += b.vatAmount
      yearTotals.count += 1
      yearTotals.withVat += b.amountWithVat
      yearTotals.withoutVat += b.amountWithoutVat
      yearTotals.vat += b.vatAmount
    }
    for (const m of monthly) {
      m.withVat = round2(m.withVat)
      m.withoutVat = round2(m.withoutVat)
      m.vat = round2(m.vat)
    }
    yearTotals.withVat = round2(yearTotals.withVat)
    yearTotals.withoutVat = round2(yearTotals.withoutVat)
    yearTotals.vat = round2(yearTotals.vat)

    // Quarters: Q1 Jan–Mar · Q2 Apr–Jun · Q3 Jul–Sep · Q4 Oct–Dec
    const quarters: VatQuarterLine[] = [0, 1, 2, 3].map((q) => {
      const months = monthly.slice(q * 3, q * 3 + 3)
      return {
        quarter: q + 1,
        months,
        count: months.reduce((s, m) => s + m.count, 0),
        withVat: round2(months.reduce((s, m) => s + m.withVat, 0)),
        withoutVat: round2(months.reduce((s, m) => s + m.withoutVat, 0)),
        vat: round2(months.reduce((s, m) => s + m.vat, 0)),
      }
    })

    // Selected month totals (from the pre-aggregated lines)
    const selected = monthly[month - 1]
    const monthTotals = {
      count: selected.count,
      withVat: selected.withVat,
      withoutVat: selected.withoutVat,
      vat: selected.vat,
    }

    // Filing countdown — only meaningful for the CURRENT year
    const currentQuarter = Math.floor(now.getMonth() / 3) + 1
    const quarterEnd = endOfMonth(now.getFullYear(), currentQuarter * 3 - 1)
    // ZATCA: file by the last day of the month following the quarter end
    const filingDeadline = endOfMonth(now.getFullYear(), currentQuarter * 3)

    const data: VatSummaryData = {
      year,
      month,
      vatRate,
      years,
      monthTotals,
      monthly,
      yearTotals,
      quarters,
      currentQuarter,
      currentYear: now.getFullYear(),
      quarterEndDate:
        year === now.getFullYear() ? quarterEnd.toISOString() : null,
      filingDeadline:
        year === now.getFullYear() ? filingDeadline.toISOString() : null,
    }
    return ok(data)
  } catch {
    return serverError()
  }
}

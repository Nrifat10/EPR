'use client'

import { useEffect, useMemo, useState } from 'react'
import { Printer, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent,
  DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { usePageRule } from '@/components/app/print/print-page-rule'
import { api } from '@/lib/api-client'
import { formatDateTime, formatMoney, formatNumber, monthName } from '@/lib/format'
import { useAppStore } from '@/lib/store'
import type {
  CategoryBreakdown,
  Paginated,
  ProjectRow,
  SheetRow,
  SheetTotals,
  StaffCategory,
} from '@/lib/types'

export type SalarySheetPrintData = {
  rows: SheetRow[]
  totals: SheetTotals
  breakdown: CategoryBreakdown[]
}

export type SalarySheetPrintFilters = {
  projectId?: string
  categoryId?: string
  month?: string
  year?: string
}

/** "212" | "212.5" — integers stay clean, fractions keep 2dp */
function fmtHours(n: number): string {
  return Number.isInteger(n) ? String(n) : formatNumber(n, 2)
}

const SIGNATURES = [
  { label: 'Receiver', title: 'Staff Representative' },
  { label: 'Accountant', title: 'Accounts Department' },
  { label: 'Manager', title: 'General Manager' },
]

export function SalarySheetPrintDialog({
  open,
  onOpenChange,
  data,
  filters,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  data: SalarySheetPrintData
  filters: SalarySheetPrintFilters
}) {
  const settings = useAppStore((s) => s.settings)
  const [projectName, setProjectName] = useState<string | null>(null)
  const [clientName, setClientName] = useState<string | null>(null)
  const [categoryName, setCategoryName] = useState<string | null>(null)

  // Force A4 landscape for this printout (dynamic @page rule)
  usePageRule(open, 'size: A4 landscape; margin: 8mm;')

  // Resolve human-readable filter names (small lookups, fetched only while open)
  useEffect(() => {
    if (!open) return
    let cancelled = false
    async function resolveNames() {
      try {
        const [projectsRes, categoriesRes] = await Promise.all([
          filters.projectId
            ? api.get<Paginated<ProjectRow>>('/api/projects?pageSize=100')
            : Promise.resolve(null),
          filters.categoryId
            ? api.get<{ data: StaffCategory[] }>('/api/staff-categories')
            : Promise.resolve(null),
        ])
        if (cancelled) return
        const project = projectsRes?.data.find((p) => p.id === filters.projectId)
        setProjectName(project?.name ?? null)
        setClientName(project?.clientName ?? null)
        setCategoryName(
          categoriesRes?.data.find((c) => c.id === filters.categoryId)?.name ?? null
        )
      } catch {
        if (!cancelled) {
          setProjectName(null)
          setCategoryName(null)
        }
      }
    }
    void resolveNames()
    return () => {
      cancelled = true
    }
  }, [open, filters.projectId, filters.categoryId])

  const money = (n: number) => formatMoney(n, settings.currency)

  // Period label — prefer explicit filters, fall back to the loaded rows
  const periodLabel = useMemo(() => {
    const monthNum =
      filters.month && filters.month !== 'all'
        ? Number(filters.month)
        : (data.rows[0]?.month ?? null)
    const year =
      filters.year && filters.year !== 'all'
        ? filters.year
        : data.rows[0]
          ? String(data.rows[0].year)
          : ''
    if (monthNum) return `${monthName(monthNum)} ${year}`.trim()
    return year || 'All Periods'
  }, [filters.month, filters.year, data.rows])

  // Column sums for the main table totals row
  const sums = useMemo(() => {
    return data.rows.reduce(
      (acc, r) => ({
        basicPay: acc.basicPay + r.basicPay,
        otPay: acc.otPay + r.otPay,
        otherEarnings: acc.otherEarnings + r.otherEarnings,
        grossPay: acc.grossPay + r.grossPay,
        advance: acc.advance + r.advance,
        penaltyPt: acc.penaltyPt + r.penaltyPt,
        unionOther: acc.unionOther + r.unionOther,
        totalDeductions: acc.totalDeductions + r.totalDeductions,
        netPay: acc.netPay + r.netPay,
      }),
      {
        basicPay: 0,
        otPay: 0,
        otherEarnings: 0,
        grossPay: 0,
        advance: 0,
        penaltyPt: 0,
        unionOther: 0,
        totalDeductions: 0,
        netPay: 0,
      }
    )
  }, [data.rows])

  // Grand total for the category breakdown table
  const grand = useMemo(() => {
    return data.breakdown.reduce(
      (acc, b) => ({
        manpower: acc.manpower + b.manpower,
        totalHours: acc.totalHours + b.totalHours,
        grossPay: acc.grossPay + b.grossPay,
        deductions: acc.deductions + b.deductions,
        totalAmount: acc.totalAmount + b.totalAmount,
      }),
      { manpower: 0, totalHours: 0, grossPay: 0, deductions: 0, totalAmount: 0 }
    )
  }, [data.breakdown])

  const projectLabel = filters.projectId ? (projectName ?? '—') : 'All Projects'
  const categoryLabel = filters.categoryId ? (categoryName ?? '—') : 'All Categories'
  // Client company of the selected project filter (null when not filtered)
  const clientLabel = filters.projectId ? (clientName ?? null) : null

  const th =
    'border border-neutral-300 bg-neutral-100 px-1.5 py-1.5 text-left font-semibold text-neutral-800'
  const thR = `${th} text-right`
  const td = 'border border-neutral-300 px-1.5 py-1 align-top text-neutral-900'
  const tdR = `${td} text-right tabular-nums`

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[92vh] max-h-[92vh] w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1400px] print:static print:h-auto print:max-h-none print:w-full print:translate-x-0 print:translate-y-0 print:overflow-visible print:rounded-none print:border-0 print:p-0 print:shadow-none"
      >
        <DialogTitle className="sr-only">Salary sheet print preview</DialogTitle>
<DialogDescription className="sr-only">Printable monthly salary sheet</DialogDescription>

        {/* Toolbar (hidden when printing) */}
        <div className="print-hidden flex flex-wrap items-center justify-between gap-3 border-b bg-card px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold">Printable Salary Sheet</h2>
            <p className="text-xs text-muted-foreground">
              {periodLabel} · {data.totals.count} records · A4 landscape
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              <X className="h-4 w-4" />
              Close
            </Button>
            <Button onClick={() => window.print()}>
              <Printer className="h-4 w-4" />
              Print Sheet
            </Button>
          </div>
        </div>

        {/* Scrollable preview of the sheet */}
        <div className="nice-scrollbar flex-1 overflow-auto bg-neutral-100 p-3 sm:p-6 print:overflow-visible print:bg-white print:p-0">
          <div className="print-area print-landscape min-w-[1000px] bg-white p-6 text-neutral-900 shadow-sm print:min-w-0">
            {/* Company header + total block — brand letterhead (navy rule + gold accent) */}
            <div className="flex items-start justify-between gap-6 border-b-2 border-[#0F1F3D] pb-4">
              <div className="flex items-center gap-3">
                <img
                  src={settings.logo ?? '/logo-mark.png'}
                  alt={`${settings.companyName} logo`}
                  className="h-16 w-16 rounded object-contain"
                />
                <div>
                  <h1 className="text-xl font-bold uppercase tracking-wide text-[#0F1F3D]">
                    {settings.companyName}
                  </h1>
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#B8942C]">Monthly Payroll Sheet</p>
                  {settings.address ? (
                    <p className="text-[10px] text-neutral-500">{settings.address}</p>
                  ) : null}
                </div>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-neutral-500">
                  Total Disbursement
                </p>
                <p className="text-2xl font-bold tabular-nums">{money(data.totals.net)}</p>
                <p className="mt-1 text-[11px] font-medium text-neutral-700">
                  Total Manpower: {data.totals.count}
                </p>
                <p className="text-[11px] text-neutral-500 tabular-nums">
                  Gross: {money(data.totals.gross)} · Deductions: {money(data.totals.deductions)}
                </p>
              </div>
            </div>
            {/* gold accent segment under the navy header rule */}
            <div className="mt-[3px] h-[3px] w-28 bg-[#D4AF37]" aria-hidden />

            {/* Title + meta */}
            <div className="mt-5 flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="text-lg font-bold">Salary Sheet — {periodLabel}</h2>
                <p className="mt-1 text-[11px] text-neutral-600">
                  Project: {projectLabel}
                  {clientLabel ? <> · Client: <span className="font-medium">{clientLabel}</span></> : null}
                  {' '}· Category: {categoryLabel} · Total Manpower:{' '}
                  {data.totals.count}
                </p>
              </div>
              <p className="text-[10px] text-neutral-500">
                Generated: {formatDateTime(new Date())}
              </p>
            </div>

            {/* Main payroll table */}
            <table className="mt-4 w-full border-collapse text-[11px]">
              <thead>
                <tr>
                  <th className={`${th} text-center`}>SN</th>
                  <th className={th}>Staff Name</th>
                  <th className={th}>Category</th>
                  <th className={th}>Project / Client Company</th>
                  <th className={thR}>Hours</th>
                  <th className={thR}>Rate</th>
                  <th className={thR}>Basic</th>
                  <th className={thR}>OT Pay</th>
                  <th className={thR}>Other Earn.</th>
                  <th className={thR}>Gross</th>
                  <th className={thR}>Advance Deduction</th>
                  <th className={thR}>Penalty &amp; PT</th>
                  <th className={thR}>Union &amp; Other</th>
                  <th className={thR}>Total Ded.</th>
                  <th className={thR}>Net Payable</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r, i) => (
                  <tr key={r.id} className="break-inside-avoid">
                    <td className={`${td} text-center tabular-nums`}>{i + 1}</td>
                    <td className={td}>
                      <span className="font-semibold">{r.staff.fullName}</span>
                      <span className="block text-[9px] text-neutral-500">
                        IQAMA: {r.staff.iqamaId}
                      </span>
                    </td>
                    <td className={td}>{r.staff.staffCategory?.name ?? 'Uncategorized'}</td>
                    <td className={td}>
                      <span className="font-medium">{r.project?.name ?? '—'}</span>
                      <span className="block text-[9px] text-neutral-500">
                        {r.project?.clientName ?? 'No client company'}
                      </span>
                    </td>
                    <td className={tdR}>
                      {fmtHours(r.totalHours)}
                      {r.overtimeHours > 0 ? (
                        <span className="text-neutral-500"> (+{fmtHours(r.overtimeHours)} OT)</span>
                      ) : null}
                    </td>
                    <td className={tdR}>{formatNumber(r.hourlyRateSnapshot)}</td>
                    <td className={tdR}>{money(r.basicPay)}</td>
                    <td className={tdR}>{money(r.otPay)}</td>
                    <td className={tdR}>{money(r.otherEarnings)}</td>
                    <td className={tdR}>{money(r.grossPay)}</td>
                    <td className={tdR}>{money(r.advance)}</td>
                    <td className={tdR}>{money(r.penaltyPt)}</td>
                    <td className={tdR}>{money(r.unionOther)}</td>
                    <td className={tdR}>{money(r.totalDeductions)}</td>
                    <td className={`${tdR} font-semibold`}>{money(r.netPay)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-neutral-100 font-bold">
                  <td className={`${td} bg-neutral-100 text-center`} colSpan={6}>
                    TOTAL ({data.totals.count})
                  </td>
                  <td className={`${tdR} bg-neutral-100`}>{money(sums.basicPay)}</td>
                  <td className={`${tdR} bg-neutral-100`}>{money(sums.otPay)}</td>
                  <td className={`${tdR} bg-neutral-100`}>{money(sums.otherEarnings)}</td>
                  <td className={`${tdR} bg-neutral-100`}>{money(sums.grossPay)}</td>
                  <td className={`${tdR} bg-neutral-100`}>{money(sums.advance)}</td>
                  <td className={`${tdR} bg-neutral-100`}>{money(sums.penaltyPt)}</td>
                  <td className={`${tdR} bg-neutral-100`}>{money(sums.unionOther)}</td>
                  <td className={`${tdR} bg-neutral-100`}>{money(sums.totalDeductions)}</td>
                  <td className={`${tdR} bg-neutral-100`}>{money(sums.netPay)}</td>
                </tr>
              </tfoot>
            </table>

            {/* Category breakdown */}
            <h3 className="mt-8 text-sm font-bold uppercase tracking-wide">
              Staff Category Breakdown
            </h3>
            <table className="mt-2 w-full border-collapse text-[11px]">
              <thead>
                <tr>
                  <th className={th}>Category</th>
                  <th className={thR}>Manpower</th>
                  <th className={thR}>Total Hours</th>
                  <th className={thR}>Gross Pay</th>
                  <th className={thR}>Deductions</th>
                  <th className={thR}>Total Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.breakdown.map((b) => (
                  <tr key={b.categoryId ?? b.name} className="break-inside-avoid">
                    <td className={`${td} font-medium`}>{b.name}</td>
                    <td className={tdR}>{b.manpower}</td>
                    <td className={tdR}>{fmtHours(b.totalHours)}</td>
                    <td className={tdR}>{money(b.grossPay)}</td>
                    <td className={tdR}>{money(b.deductions)}</td>
                    <td className={`${tdR} font-semibold`}>{money(b.totalAmount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-neutral-800 font-bold">
                  <td className={td}>GRAND TOTAL</td>
                  <td className={tdR}>{grand.manpower}</td>
                  <td className={tdR}>{fmtHours(grand.totalHours)}</td>
                  <td className={tdR}>{money(grand.grossPay)}</td>
                  <td className={tdR}>{money(grand.deductions)}</td>
                  <td className={tdR}>{money(grand.totalAmount)}</td>
                </tr>
              </tfoot>
            </table>

            {/* Signature blocks */}
            <div className="mt-12 grid grid-cols-3 gap-8">
              {SIGNATURES.map((s) => (
                <div key={s.label}>
                  <div className="h-10" aria-hidden="true" />
                  <div className="border-t border-dashed border-neutral-600" />
                  <p className="mt-1.5 text-xs font-semibold">{s.label}</p>
                  <p className="text-[10px] text-neutral-500">{s.title}</p>
                </div>
              ))}
            </div>

            {/* Footer note */}
            <p className="mt-8 border-t border-neutral-200 pt-2 text-center text-[9px] text-neutral-400">
              This salary sheet is computer-generated by the {settings.companyName} Workforce,
              Payroll &amp; Accounts System · Generated on {formatDateTime(new Date())}
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

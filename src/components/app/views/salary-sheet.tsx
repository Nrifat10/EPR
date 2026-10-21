'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Download, FileText, Printer } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { PageHeader, SectionCard } from '@/components/app/shared/page-header'
import { FilterBar, FilterSelect, SearchInput } from '@/components/app/shared/filter-select'
import { AvatarInitials } from '@/components/app/shared/avatar-initials'
import { CategoryChip, StatusBadge } from '@/components/app/shared/status-badge'
import { EmptyState, TableSkeleton } from '@/components/app/shared/empty-state'
import { SalarySheetPrintDialog } from '@/components/app/print/salary-sheet-print'
import { api, qs } from '@/lib/api-client'
import { buildCsv, csvFilename, downloadCsv } from '@/lib/csv'
import { formatMoney, formatNumber, monthName, round2 } from '@/lib/format'
import { can, useAppStore } from '@/lib/store'
import { useViewIntent } from '@/hooks/use-view-intent'
import { MONTHS } from '@/lib/types'
import type {
  CategoryBreakdown,
  Paginated,
  ProjectRow,
  SheetRow,
  SheetTotals,
  StaffCategory,
} from '@/lib/types'
import { useDebounce } from '@/hooks/use-debounce'

type SheetData = {
  rows: SheetRow[]
  totals: SheetTotals
  breakdown: CategoryBreakdown[]
}

/** Default period = PREVIOUS month (handles the January wrap) */
function previousMonthDefaults(): { month: string; year: string } {
  const now = new Date()
  const m = now.getMonth() // 0-based: October (9) → previous month is September (9, 1-based)
  if (m === 0) return { month: '12', year: String(now.getFullYear() - 1) }
  return { month: String(m), year: String(now.getFullYear()) }
}

/** "212" | "212.5" — integers stay clean, fractions keep 2dp */
function fmtHours(n: number): string {
  return Number.isInteger(n) ? String(n) : formatNumber(n, 2)
}

export function SalarySheetView() {
  const user = useAppStore((s) => s.user)
  const settings = useAppStore((s) => s.settings)
  const canPrint = can(user, 'payroll.print')

  const initialPeriod = useMemo(previousMonthDefaults, [])
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 300)
  const [projectId, setProjectId] = useState('all')
  const [categoryId, setCategoryId] = useState('all')
  const [month, setMonth] = useState(initialPeriod.month)
  const [year, setYear] = useState(initialPeriod.year)

  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [categories, setCategories] = useState<StaffCategory[]>([])

  const [data, setData] = useState<SheetData | null>(null)
  const [loading, setLoading] = useState(true)
  const [printOpen, setPrintOpen] = useState(false)

  // Deep intent from the command palette: auto-open the print preview once the
  // sheet data for the current period has finished loading (or explain why not).
  const shouldPrint = useViewIntent('salary-sheet', 'print')
  const autoPrintRef = useRef(false)
  useEffect(() => {
    if (shouldPrint) autoPrintRef.current = true
  }, [shouldPrint])

  const money = useCallback((n: number) => formatMoney(n, settings.currency), [settings.currency])

  const periodLabel = useMemo(() => {
    if (month !== 'all') return `${monthName(Number(month))} ${year !== 'all' ? year : ''}`.trim()
    return year !== 'all' ? year : 'All Periods'
  }, [month, year])

  // Filter options (loaded once)
  useEffect(() => {
    let cancelled = false
    async function loadFilters() {
      try {
        const [projectsRes, categoriesRes] = await Promise.all([
          api.get<Paginated<ProjectRow>>(`/api/projects${qs({ pageSize: 100 })}`),
          api.get<{ data: StaffCategory[] }>('/api/staff-categories'),
        ])
        if (cancelled) return
        setProjects(projectsRes.data)
        setCategories(categoriesRes.data)
      } catch (e) {
        if (!cancelled) toast.error(e instanceof Error ? e.message : 'Failed to load filters')
      }
    }
    void loadFilters()
    return () => {
      cancelled = true
    }
  }, [])

  // Salary sheet data (filter-driven, no pagination — full month sheet)
  const loadSheet = useCallback(async () => {
    setLoading(true)
    try {
      const query = qs({
        search: debouncedSearch || undefined,
        projectId: projectId !== 'all' ? projectId : undefined,
        categoryId: categoryId !== 'all' ? categoryId : undefined,
        month: month !== 'all' ? month : undefined,
        year: year !== 'all' ? year : undefined,
      })
      const res = await api.get<SheetData>(`/api/payrolls/sheet${query}`)
      setData(res)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load salary sheet')
    } finally {
      setLoading(false)
    }
  }, [debouncedSearch, projectId, categoryId, month, year])

  useEffect(() => {
    void loadSheet()
  }, [loadSheet])

  // Column sums for the footer row
  const sums = useMemo(() => {
    const rows = data?.rows ?? []
    return rows.reduce(
      (acc, r) => ({
        basicPay: acc.basicPay + r.basicPay,
        otPay: acc.otPay + r.otPay,
        otherEarnings: acc.otherEarnings + r.otherEarnings,
        advance: acc.advance + r.advance,
        penaltyPt: acc.penaltyPt + r.penaltyPt,
        unionOther: acc.unionOther + r.unionOther,
      }),
      { basicPay: 0, otPay: 0, otherEarnings: 0, advance: 0, penaltyPt: 0, unionOther: 0 }
    )
  }, [data])

  // Grand total row for the breakdown card
  const grand = useMemo(() => {
    const breakdown = data?.breakdown ?? []
    return breakdown.reduce(
      (acc, b) => ({
        manpower: acc.manpower + b.manpower,
        totalHours: round2(acc.totalHours + b.totalHours),
        grossPay: round2(acc.grossPay + b.grossPay),
        deductions: round2(acc.deductions + b.deductions),
        totalAmount: round2(acc.totalAmount + b.totalAmount),
      }),
      { manpower: 0, totalHours: 0, grossPay: 0, deductions: 0, totalAmount: 0 }
    )
  }, [data])

  const rows = data?.rows ?? []

  // Fire the deferred print preview as soon as the sheet is ready
  useEffect(() => {
    if (!autoPrintRef.current || loading) return
    autoPrintRef.current = false
    if (!canPrint) return
    if (data && rows.length > 0) {
      setPrintOpen(true)
    } else {
      toast.info('Nothing to print for the selected period')
    }
  }, [loading, data, rows, canPrint])

  const totals = data?.totals
  const yearOptions = useMemo(() => {
    const y = new Date().getFullYear()
    return Array.from({ length: 5 }, (_, i) => {
      const v = String(y + 2 - i)
      return { value: v, label: v }
    })
  }, [])

  function handleExportCsv() {
    if (!data || rows.length === 0) return
    try {
      const csv = buildCsv(
        [
          'SN', 'Staff Name', 'IQAMA', 'Category', 'Project', 'Hours', 'OT Hours', 'Rate',
          'Basic Pay', 'OT Pay', 'Other Earnings', 'Gross Pay', 'Advance', 'Penalty & PT',
          'Union & Other', 'Total Deductions', 'Net Payable', 'Status',
        ],
        [
          ...rows.map((r, i) => [
            i + 1,
            r.staff.fullName,
            r.staff.iqamaId,
            r.staff.staffCategory?.name ?? 'Uncategorized',
            r.project?.name ?? '',
            fmtHours(r.totalHours),
            fmtHours(r.overtimeHours),
            formatNumber(r.hourlyRateSnapshot),
            r.basicPay.toFixed(2),
            r.otPay.toFixed(2),
            r.otherEarnings.toFixed(2),
            r.grossPay.toFixed(2),
            r.advance.toFixed(2),
            r.penaltyPt.toFixed(2),
            r.unionOther.toFixed(2),
            r.totalDeductions.toFixed(2),
            r.netPay.toFixed(2),
            r.status,
          ]),
          [
            `TOTAL (${data.totals.count})`, '', '', '', '', '', '', '',
            '', '', '', data.totals.gross.toFixed(2), '', '', '',
            data.totals.deductions.toFixed(2), data.totals.net.toFixed(2), '',
          ],
        ]
      )
      downloadCsv(csvFilename('salary-sheet', periodLabel.replace(/\s+/g, '-')), csv)
      toast.success(`Exported ${rows.length} salary records to CSV`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Export failed')
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Salary Sheet"
        description={`Consolidated monthly payroll sheet — ${periodLabel}`}
      >
        <Button
          variant="outline"
          onClick={handleExportCsv}
          disabled={!data || rows.length === 0}
        >
          <Download className="h-4 w-4" />
          Export CSV
        </Button>
        {canPrint ? (
          <Button onClick={() => setPrintOpen(true)} disabled={!data || rows.length === 0}>
            <Printer className="h-4 w-4" />
            Print
          </Button>
        ) : null}
      </PageHeader>

      {/* Filters */}
      <div className="print-hidden">
        <FilterBar
          search={
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Search staff or IQAMA..."
              className="w-full sm:w-[240px]"
            />
          }
          activeCount={
            [projectId, categoryId, month, year].filter((v) => v !== 'all').length
          }
        >
          <FilterSelect
            value={projectId}
            onChange={setProjectId}
            placeholder="Project"
            emptyLabel="All Projects"
            options={projects.map((p) => ({ value: p.id, label: p.name }))}
            className="sm:w-[200px]"
          />
          <FilterSelect
            value={categoryId}
            onChange={setCategoryId}
            placeholder="Category"
            emptyLabel="All Categories"
            options={categories.map((c) => ({ value: c.id, label: c.name }))}
            className="sm:w-[170px]"
          />
          <FilterSelect
            value={month}
            onChange={setMonth}
            placeholder="Month"
            emptyLabel="All Months"
            options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))}
            className="sm:w-[150px]"
          />
          <FilterSelect
            value={year}
            onChange={setYear}
            placeholder="Year"
            emptyLabel="All Years"
            options={yearOptions}
            className="sm:w-[120px]"
          />
        </FilterBar>
      </div>

      {/* Monthly sheet table */}
      <SectionCard>
        {loading ? (
          <TableSkeleton rows={8} cols={8} />
        ) : rows.length === 0 || !totals ? (
          <EmptyState
            icon={FileText}
            title="No payroll records for the selected filters"
            description="Try changing the month, year, project or category filters to see payroll records."
          />
        ) : (
          <div className="overflow-x-auto">
            <Table className="min-w-[1250px] text-sm">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-9 min-w-[230px] px-2">Staff Member</TableHead>
                  <TableHead className="h-9 min-w-[110px] px-2">Rate &amp; Hours</TableHead>
                  <TableHead className="h-9 px-2 text-right">Basic Pay</TableHead>
                  <TableHead className="h-9 px-2 text-right">Overtime (OT)</TableHead>
                  <TableHead className="h-9 px-2 text-right">Other Earn.</TableHead>
                  <TableHead className="h-9 px-2 text-right">Gross Pay</TableHead>
                  <TableHead className="h-9 px-2 text-right">Advance</TableHead>
                  <TableHead className="h-9 px-2 text-right">Penalty &amp; PT</TableHead>
                  <TableHead className="h-9 px-2 text-right">Union &amp; Other</TableHead>
                  <TableHead className="h-9 px-2 text-right">Total Ded.</TableHead>
                  <TableHead className="h-9 px-2 text-right">Net Payable</TableHead>
                  <TableHead className="h-9 px-2">Signature</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="px-2 py-2">
                      <div className="flex items-center gap-2">
                        <AvatarInitials name={r.staff.fullName} size="sm" />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-semibold">{r.staff.fullName}</span>
                            <StatusBadge
                              kind={r.status}
                              className="h-4 px-1.5 text-[9px] leading-none"
                            />
                          </div>
                          <p className="text-[10px] text-muted-foreground">
                            IQAMA: {r.staff.iqamaId}
                          </p>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                            <CategoryChip
                              label={r.staff.staffCategory?.name ?? 'Uncategorized'}
                              className="h-4 px-1.5 text-[9px] leading-none"
                            />
                            <span className="max-w-[160px] truncate text-[10px] text-muted-foreground">
                              {r.project?.name ?? 'No project'}
                            </span>
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="px-2 py-2">
                      <p className="tabular-nums">{formatNumber(r.hourlyRateSnapshot)}/hr</p>
                      <p className="text-xs text-muted-foreground tabular-nums">
                        {fmtHours(r.totalHours)}h
                        {r.overtimeHours > 0 ? ` (+${fmtHours(r.overtimeHours)} OT)` : ''}
                      </p>
                    </TableCell>
                    <TableCell className="px-2 py-2 text-right tabular-nums">
                      {money(r.basicPay)}
                    </TableCell>
                    <TableCell className="px-2 py-2 text-right tabular-nums">
                      {money(r.otPay)}
                    </TableCell>
                    <TableCell className="px-2 py-2 text-right tabular-nums">
                      {money(r.otherEarnings)}
                    </TableCell>
                    <TableCell className="px-2 py-2 text-right font-semibold tabular-nums">
                      {money(r.grossPay)}
                    </TableCell>
                    <TableCell className="px-2 py-2 text-right tabular-nums">
                      {money(r.advance)}
                    </TableCell>
                    <TableCell className="px-2 py-2 text-right tabular-nums">
                      {money(r.penaltyPt)}
                    </TableCell>
                    <TableCell className="px-2 py-2 text-right tabular-nums">
                      {money(r.unionOther)}
                    </TableCell>
                    <TableCell className="px-2 py-2 text-right tabular-nums text-rose-700 dark:text-rose-400">
                      {money(r.totalDeductions)}
                    </TableCell>
                    <TableCell className="px-2 py-2 text-right font-bold tabular-nums">
                      {money(r.netPay)}
                    </TableCell>
                    <TableCell className="px-2 py-2">
                      <div
                        className="h-6 w-24 border-b border-dashed border-muted-foreground/40"
                        aria-hidden="true"
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow className="bg-muted/50 font-semibold hover:bg-muted/50">
                  <TableCell colSpan={5} className="px-2 py-2.5">
                    Total — {totals.count} record{totals.count === 1 ? '' : 's'}
                  </TableCell>
                  <TableCell className="px-2 py-2.5 text-right tabular-nums">
                    {money(totals.gross)}
                  </TableCell>
                  <TableCell className="px-2 py-2.5 text-right tabular-nums">
                    {money(sums.advance)}
                  </TableCell>
                  <TableCell className="px-2 py-2.5 text-right tabular-nums">
                    {money(sums.penaltyPt)}
                  </TableCell>
                  <TableCell className="px-2 py-2.5 text-right tabular-nums">
                    {money(sums.unionOther)}
                  </TableCell>
                  <TableCell className="px-2 py-2.5 text-right tabular-nums text-rose-700 dark:text-rose-400">
                    {money(totals.deductions)}
                  </TableCell>
                  <TableCell className="px-2 py-2.5 text-right tabular-nums">
                    {money(totals.net)}
                  </TableCell>
                  <TableCell className="px-2 py-2.5" />
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        )}
      </SectionCard>

      {/* Staff category breakdown */}
      <SectionCard>
        <div className="border-b px-4 py-3 sm:px-6">
          <h2 className="text-sm font-semibold">Staff Category Breakdown</h2>
          <p className="text-xs text-muted-foreground">
            Payroll grouped by staff category — {periodLabel}
          </p>
        </div>
        {loading ? (
          <TableSkeleton rows={4} cols={6} />
        ) : (data?.breakdown.length ?? 0) === 0 ? (
          <EmptyState
            icon={FileText}
            title="No category data"
            description="There are no payroll records to group for the selected filters."
          />
        ) : (
          <div className="overflow-x-auto">
            <Table className="text-sm">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-9 px-4">Category</TableHead>
                  <TableHead className="h-9 px-4 text-right">Manpower</TableHead>
                  <TableHead className="h-9 px-4 text-right">Total Hours</TableHead>
                  <TableHead className="h-9 px-4 text-right">Gross Pay</TableHead>
                  <TableHead className="h-9 px-4 text-right">Deductions</TableHead>
                  <TableHead className="h-9 px-4 text-right">Total Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data?.breakdown ?? []).map((b) => (
                  <TableRow key={b.categoryId ?? b.name}>
                    <TableCell className="px-4 py-2.5 font-medium">{b.name}</TableCell>
                    <TableCell className="px-4 py-2.5 text-right tabular-nums">
                      {b.manpower}
                    </TableCell>
                    <TableCell className="px-4 py-2.5 text-right tabular-nums">
                      {fmtHours(b.totalHours)}
                    </TableCell>
                    <TableCell className="px-4 py-2.5 text-right tabular-nums">
                      {money(b.grossPay)}
                    </TableCell>
                    <TableCell className="px-4 py-2.5 text-right tabular-nums text-rose-700 dark:text-rose-400">
                      {money(b.deductions)}
                    </TableCell>
                    <TableCell className="px-4 py-2.5 text-right font-semibold tabular-nums">
                      {money(b.totalAmount)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow className="bg-muted/50 font-semibold hover:bg-muted/50">
                  <TableCell className="px-4 py-2.5">Grand Total</TableCell>
                  <TableCell className="px-4 py-2.5 text-right tabular-nums">
                    {grand.manpower}
                  </TableCell>
                  <TableCell className="px-4 py-2.5 text-right tabular-nums">
                    {fmtHours(grand.totalHours)}
                  </TableCell>
                  <TableCell className="px-4 py-2.5 text-right tabular-nums">
                    {money(grand.grossPay)}
                  </TableCell>
                  <TableCell className="px-4 py-2.5 text-right tabular-nums text-rose-700 dark:text-rose-400">
                    {money(grand.deductions)}
                  </TableCell>
                  <TableCell className="px-4 py-2.5 text-right tabular-nums">
                    {money(grand.totalAmount)}
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        )}
      </SectionCard>

      {/* Print dialog — receives the currently loaded sheet data */}
      {data ? (
        <SalarySheetPrintDialog
          open={printOpen}
          onOpenChange={setPrintOpen}
          data={data}
          filters={{
            projectId: projectId !== 'all' ? projectId : undefined,
            categoryId: categoryId !== 'all' ? categoryId : undefined,
            month: month !== 'all' ? month : undefined,
            year: year !== 'all' ? year : undefined,
          }}
        />
      ) : null}
    </div>
  )
}

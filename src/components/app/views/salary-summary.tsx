'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { BadgeDollarSign, FileBarChart, Printer, Receipt, Users, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
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
import { StatCard } from '@/components/app/shared/stat-card'
import { FilterBar, FilterSelect } from '@/components/app/shared/filter-select'
import { EmptyState, TableSkeleton } from '@/components/app/shared/empty-state'
import { printWithPageRule } from '@/components/app/print/print-page-rule'
import { api, qs } from '@/lib/api-client'
import { formatMoney, formatNumber, monthName, round2 } from '@/lib/format'
import { useAppStore } from '@/lib/store'
import { MONTHS } from '@/lib/types'
import type { Paginated, ProjectRow } from '@/lib/types'

type SummaryCards = {
  totalManpower: number
  totalGross: number
  totalDeductions: number
  totalDisbursement: number
}

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

type SummaryData = {
  cards: SummaryCards
  rows: SummaryRow[]
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

export function SalarySummaryView() {
  const settings = useAppStore((s) => s.settings)

  const initialPeriod = useMemo(previousMonthDefaults, [])
  const [projectId, setProjectId] = useState('all')
  const [month, setMonth] = useState(initialPeriod.month)
  const [year, setYear] = useState(initialPeriod.year)

  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [data, setData] = useState<SummaryData | null>(null)
  const [loading, setLoading] = useState(true)

  const money = useCallback((n: number) => formatMoney(n, settings.currency), [settings.currency])

  const periodLabel = useMemo(() => {
    if (month !== 'all') return `${monthName(Number(month))} ${year !== 'all' ? year : ''}`.trim()
    return year !== 'all' ? year : 'All Periods'
  }, [month, year])

  // Projects for the filter (loaded once)
  useEffect(() => {
    let cancelled = false
    async function loadProjects() {
      try {
        const res = await api.get<Paginated<ProjectRow>>(`/api/projects${qs({ pageSize: 100 })}`)
        if (!cancelled) setProjects(res.data)
      } catch (e) {
        if (!cancelled) toast.error(e instanceof Error ? e.message : 'Failed to load projects')
      }
    }
    void loadProjects()
    return () => {
      cancelled = true
    }
  }, [])

  // Summary data (filter-driven)
  const loadSummary = useCallback(async () => {
    setLoading(true)
    try {
      const query = qs({
        projectId: projectId !== 'all' ? projectId : undefined,
        month: month !== 'all' ? month : undefined,
        year: year !== 'all' ? year : undefined,
      })
      const res = await api.get<SummaryData>(`/api/payrolls/summary${query}`)
      setData(res)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load salary summary')
    } finally {
      setLoading(false)
    }
  }, [projectId, month, year])

  useEffect(() => {
    void loadSummary()
  }, [loadSummary])

  const yearOptions = useMemo(() => {
    const y = new Date().getFullYear()
    return Array.from({ length: 5 }, (_, i) => {
      const v = String(y + 2 - i)
      return { value: v, label: v }
    })
  }, [])

  const cards = data?.cards
  const rows = data?.rows ?? []

  // Totals row (bottom of the breakdown table)
  const totals = useMemo(() => {
    return rows.reduce(
      (acc, r) => ({
        manpower: acc.manpower + r.manpower,
        totalHours: round2(acc.totalHours + r.totalHours),
        otHours: round2(acc.otHours + r.otHours),
        grossPay: round2(acc.grossPay + r.grossPay),
        deductions: round2(acc.deductions + r.deductions),
        totalAmount: round2(acc.totalAmount + r.totalAmount),
      }),
      { manpower: 0, totalHours: 0, otHours: 0, grossPay: 0, deductions: 0, totalAmount: 0 }
    )
  }, [rows])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Staff Salary Summary"
        description={`Category-wise salary distribution — ${periodLabel}`}
      >
        <Button
          className="print-hidden"
          onClick={() => printWithPageRule('size: A4 landscape; margin: 8mm;')}
          disabled={!data || rows.length === 0}
        >
          <Printer className="h-4 w-4" />
          Print
        </Button>
      </PageHeader>

      {/* Filters */}
      <div className="print-hidden">
        <FilterBar
          activeCount={
            [projectId, month, year].filter((v) => v !== 'all').length
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

      {/* Printable report content */}
      <div className="print-area print-landscape space-y-6">
        {/* Print-only report heading (company + period) */}
        <div className="hidden print:block">
          <h1 className="text-lg font-bold uppercase tracking-wide">{settings.companyName}</h1>
          <p className="mt-0.5 text-sm font-semibold">Staff Salary Summary — {periodLabel}</p>
          <p className="text-[11px] text-neutral-600">
            Project: {projectId !== 'all' ? (projects.find((p) => p.id === projectId)?.name ?? '—') : 'All Projects'}{' '}
            · Total Manpower: {cards?.totalManpower ?? 0}
          </p>
        </div>

        {/* Top stat cards */}
        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-[108px] animate-pulse rounded-xl border bg-muted/40"
                style={{ animationDelay: `${i * 80}ms` }}
              />
            ))}
          </div>
        ) : cards ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              title="Total Manpower"
              value={String(cards.totalManpower)}
              icon={Users}
              tone="navy"
              sublabel="Staff paid this period"
            />
            <StatCard
              title="Total Gross"
              value={formatNumber(cards.totalGross)}
              valuePrefix={settings.currency}
              icon={Wallet}
              tone="violet"
              sublabel="Hours + OT + other earnings"
            />
            <StatCard
              title="Total Deductions"
              value={formatNumber(cards.totalDeductions)}
              valuePrefix={settings.currency}
              icon={Receipt}
              tone="amber"
              sublabel="Advances, penalties & fees"
            />
            <StatCard
              title="Total Disbursement"
              value={formatNumber(cards.totalDisbursement)}
              valuePrefix={settings.currency}
              icon={BadgeDollarSign}
              tone="green"
              sublabel="Net amount payable"
            />
          </div>
        ) : null}

        {/* Category-wise salary breakdown */}
        <SectionCard>
          <div className="border-b px-4 py-3 sm:px-6">
            <h2 className="text-sm font-semibold">Category-wise Salary Breakdown</h2>
            <p className="text-xs text-muted-foreground">
              Sorted by total amount — share of overall disbursement per staff category
            </p>
          </div>
          {loading ? (
            <TableSkeleton rows={6} cols={7} />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={FileBarChart}
              title="No salary records for the selected filters"
              description="Try changing the month, year or project filter to see the salary summary."
            />
          ) : (
            <>
              {/* Mobile: stacked cards — the 8-column table is unreadable at <md widths */}
              <ul className="space-y-3 p-4 sm:p-6 md:hidden print:hidden">
                {rows.map((r) => (
                  <li
                    key={r.name}
                    className="rounded-xl border bg-card p-3 shadow-sm transition-colors hover:bg-muted/30"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{r.name}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {r.manpower} staff · {fmtHours(r.totalHours)}h
                          {r.otHours > 0 ? ` · +${fmtHours(r.otHours)} OT` : ''}
                        </p>
                      </div>
                      <span className="shrink-0 text-sm font-bold tabular-nums">
                        {money(r.totalAmount)}
                      </span>
                    </div>
                    <div className="mt-2.5 grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-lg bg-muted/50 px-2.5 py-1.5">
                        <p className="text-muted-foreground">Gross</p>
                        <p className="mt-0.5 font-semibold tabular-nums">{money(r.grossPay)}</p>
                      </div>
                      <div className="rounded-lg bg-muted/50 px-2.5 py-1.5">
                        <p className="text-muted-foreground">Deductions</p>
                        <p className="mt-0.5 font-semibold tabular-nums text-rose-700 dark:text-rose-400">
                          {money(r.deductions)}
                        </p>
                      </div>
                    </div>
                    <div className="mt-2.5 flex items-center gap-2.5">
                      <Progress
                        value={r.share}
                        aria-label={`${r.name} share of disbursement`}
                        className="h-1.5"
                      />
                      <span className="w-11 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                        {formatNumber(r.share)}%
                      </span>
                    </div>
                  </li>
                ))}
                {/* Totals summary card (mirrors the desktop table footer) */}
                <li className="rounded-xl border bg-muted/40 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold">Total — all categories</p>
                    <p className="text-sm font-bold tabular-nums">{money(totals.totalAmount)}</p>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {totals.manpower} staff · {fmtHours(totals.totalHours)}h · Gross{' '}
                    {money(totals.grossPay)} · Deductions {money(totals.deductions)}
                  </p>
                </li>
              </ul>

              {/* Desktop: table */}
              <div className="hidden overflow-x-auto md:block print:block print:overflow-visible">
              <Table className="text-sm">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="h-9 min-w-[160px] px-4">Staff Category</TableHead>
                    <TableHead className="h-9 px-4 text-right">Manpower</TableHead>
                    <TableHead className="h-9 px-4 text-right">Total Hours</TableHead>
                    <TableHead className="h-9 px-4 text-right">OT Hours</TableHead>
                    <TableHead className="h-9 px-4 text-right">Gross Pay</TableHead>
                    <TableHead className="h-9 px-4 text-right">Deductions</TableHead>
                    <TableHead className="h-9 px-4 text-right">Total Amount</TableHead>
                    <TableHead className="h-9 min-w-[170px] px-4">Share %</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.name}>
                      <TableCell className="px-4 py-2.5 font-medium">{r.name}</TableCell>
                      <TableCell className="px-4 py-2.5 text-right tabular-nums">
                        {r.manpower}
                      </TableCell>
                      <TableCell className="px-4 py-2.5 text-right tabular-nums">
                        {fmtHours(r.totalHours)}
                      </TableCell>
                      <TableCell className="px-4 py-2.5 text-right tabular-nums">
                        {fmtHours(r.otHours)}
                      </TableCell>
                      <TableCell className="px-4 py-2.5 text-right tabular-nums">
                        {money(r.grossPay)}
                      </TableCell>
                      <TableCell className="px-4 py-2.5 text-right tabular-nums text-rose-700 dark:text-rose-400">
                        {money(r.deductions)}
                      </TableCell>
                      <TableCell className="px-4 py-2.5 text-right font-semibold tabular-nums">
                        {money(r.totalAmount)}
                      </TableCell>
                      <TableCell className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <Progress value={r.share} className="h-2 w-16 sm:w-24" />
                          <span className="w-16 text-right text-xs tabular-nums text-muted-foreground">
                            {formatNumber(r.share)}%
                          </span>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow className="bg-muted/50 font-semibold hover:bg-muted/50">
                    <TableCell className="px-4 py-2.5">Total</TableCell>
                    <TableCell className="px-4 py-2.5 text-right tabular-nums">
                      {totals.manpower}
                    </TableCell>
                    <TableCell className="px-4 py-2.5 text-right tabular-nums">
                      {fmtHours(totals.totalHours)}
                    </TableCell>
                    <TableCell className="px-4 py-2.5 text-right tabular-nums">
                      {fmtHours(totals.otHours)}
                    </TableCell>
                    <TableCell className="px-4 py-2.5 text-right tabular-nums">
                      {money(totals.grossPay)}
                    </TableCell>
                    <TableCell className="px-4 py-2.5 text-right tabular-nums text-rose-700 dark:text-rose-400">
                      {money(totals.deductions)}
                    </TableCell>
                    <TableCell className="px-4 py-2.5 text-right tabular-nums">
                      {money(totals.totalAmount)}
                    </TableCell>
                    <TableCell className="px-4 py-2.5 text-right tabular-nums">100%</TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
              </div>
            </>
          )}
        </SectionCard>

        {/* Print footer note */}
        <p className="hidden text-center text-[9px] text-neutral-400 print:block">
          Computer-generated summary — {settings.companyName} Workforce, Payroll &amp; Accounts
          System
        </p>
      </div>
    </div>
  )
}

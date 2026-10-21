'use client'

// Worker Advances view — entry, list, filters, monthly summary, per-worker
// ledger, CSV export and print (A4 landscape). Payroll integration (auto
// deduction + stale recalculation) lives in the Payroll view.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  Banknote,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  ChevronsUpDown,
  CircleDashed,
  HandCoins,
  Landmark,
  Loader2,
  Lock,
  Pencil,
  Plus,
  Printer,
  Download,
  ReceiptText,
  Search,
  Trash2,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { AvatarInitials } from '@/components/app/shared/avatar-initials'
import { ConfirmDelete } from '@/components/app/shared/confirm-delete'
import { DataTablePagination } from '@/components/app/shared/data-table-pagination'
import { EmptyState, TableSkeleton } from '@/components/app/shared/empty-state'
import { FilterBar, FilterSelect, SearchInput } from '@/components/app/shared/filter-select'
import { PageHeader, SectionCard, MobileFab } from '@/components/app/shared/page-header'
import { StatCard } from '@/components/app/shared/stat-card'
import { printWithPageRule } from '@/components/app/print/print-page-rule'
import { AdvanceReceiptDialog } from '@/components/app/print/advance-receipt'
import { useDebounce } from '@/hooks/use-debounce'
import { useViewIntent } from '@/hooks/use-view-intent'
import { api, qs } from '@/lib/api-client'
import { buildCsv, csvFilename, downloadCsv } from '@/lib/csv'
import { formatDate, formatMoney, formatNumber, monthName, toDateInputValue } from '@/lib/format'
import { can, useAppStore } from '@/lib/store'
import {
  MONTHS,
  type AdvanceLedgerData,
  type AdvanceRow,
  type AdvanceStatus,
  type Paginated,
  type ProjectRow,
  type StaffRow,
} from '@/lib/types'
import { advanceRef, lastInstallmentMonth, monthlyInstallment } from '@/lib/advances'
import { cn } from '@/lib/utils'

type ListTotals = { count: number; given: number; deducted: number; outstanding: number }

type SummaryData = {
  totals: ListTotals & { workers: number; pendingCount: number }
  monthly: { label: string; month: number; year: number; given: number; count: number }[]
}

/** Walk all pages of a paginated list endpoint (server clamps pageSize to 100). */
async function fetchAllPages<T>(
  url: string,
  params: Record<string, string | number> = {},
  maxPages = 20
): Promise<T[]> {
  const all: T[] = []
  for (let page = 1; page <= maxPages; page++) {
    const res = await api.get<Paginated<T>>(`${url}${qs({ ...params, page, pageSize: 50 })}`)
    all.push(...res.data)
    if (res.data.length === 0 || all.length >= res.total) break
  }
  return all
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

export function AdvanceStatusBadge({ status, className }: { status: AdvanceStatus; className?: string }) {
  const map: Record<AdvanceStatus, { label: string; cls: string; icon: React.ComponentType<{ className?: string }> }> = {
    pending: {
      label: 'Pending',
      cls: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400',
      icon: CircleDashed,
    },
    partially_deducted: {
      label: 'Partially Deducted',
      cls: 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900 dark:bg-violet-950 dark:text-violet-400',
      icon: TrendingUp,
    },
    deducted: {
      label: 'Deducted',
      cls: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-400',
      icon: CheckCircle2,
    },
  }
  const s = map[status] ?? map.pending
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium',
        s.cls,
        className
      )}
    >
      <s.icon className="h-3 w-3" />
      {s.label}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export function AdvancesView() {
  const user = useAppStore((s) => s.user)
  const settings = useAppStore((s) => s.settings)
  const currency = settings.currency || 'SAR'

  const canCreate = can(user, 'advances.create')
  const canEdit = can(user, 'advances.edit')
  const canDelete = can(user, 'advances.delete')

  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 350)
  const [monthFilter, setMonthFilter] = useState('all')
  const [yearFilter, setYearFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [projectFilter, setProjectFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)

  const [rows, setRows] = useState<AdvanceRow[]>([])
  const [totals, setTotals] = useState<ListTotals>({ count: 0, given: 0, deducted: 0, outstanding: 0 })
  const [meta, setMeta] = useState({ page: 1, pageSize: 10, total: 0, totalPages: 1 })
  const [loading, setLoading] = useState(true)

  const [summary, setSummary] = useState<SummaryData | null>(null)
  const [projects, setProjects] = useState<ProjectRow[]>([])

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<AdvanceRow | null>(null)
  const [ledgerStaffId, setLedgerStaffId] = useState<string | null>(null)
  const [ledgerLabel, setLedgerLabel] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [receipt, setReceipt] = useState<AdvanceRow | null>(null)

  const yearOptions = useMemo(() => {
    const y = new Date().getFullYear()
    return Array.from({ length: 6 }, (_, i) => String(y - 3 + i))
  }, [])

  const loadList = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get<Paginated<AdvanceRow>>(
        `/api/advances${qs({
          search: debouncedSearch,
          month: monthFilter === 'all' ? '' : monthFilter,
          year: yearFilter === 'all' ? '' : yearFilter,
          status: statusFilter === 'all' ? '' : statusFilter,
          projectId: projectFilter === 'all' ? '' : projectFilter,
          page,
          pageSize,
        })}`
      )
      setRows(res.data)
      setTotals({
        count: res.totals?.count ?? 0,
        given: res.totals?.given ?? 0,
        deducted: res.totals?.deducted ?? 0,
        outstanding: res.totals?.outstanding ?? 0,
      })
      setMeta({ page: res.page, pageSize: res.pageSize, total: res.total, totalPages: res.totalPages })
      if (res.data.length === 0 && res.page > 1 && res.total > 0) setPage(res.totalPages)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load advances')
    } finally {
      setLoading(false)
    }
  }, [debouncedSearch, monthFilter, yearFilter, statusFilter, projectFilter, page, pageSize])

  const loadSummary = useCallback(async () => {
    try {
      const res = await api.get<SummaryData>('/api/advances/summary')
      setSummary(res)
    } catch {
      // cards stay hidden on failure — list is the source of truth
    }
  }, [])

  useEffect(() => {
    void loadList()
  }, [loadList])

  useEffect(() => {
    void loadSummary()
    fetchAllPages<ProjectRow>('/api/projects')
      .then(setProjects)
      .catch(() => {})
  }, [loadSummary])

  function changeFilter(setter: (v: string) => void) {
    return (v: string) => {
      setter(v)
      setPage(1)
    }
  }

  function openCreate() {
    setEditing(null)
    setFormOpen(true)
  }

  // Deep-open the create dialog when arriving via the command palette
  const shouldOpenCreate = useViewIntent('advances', 'create')
  useEffect(() => {
    if (shouldOpenCreate) openCreate()
  }, [shouldOpenCreate])

  function openEdit(row: AdvanceRow) {
    setEditing(row)
    setFormOpen(true)
  }

  async function handleDelete(row: AdvanceRow) {
    try {
      await api.del(`/api/advances/${row.id}`)
      toast.success(`Advance ${advanceRef(row.id)} deleted`)
      void loadList()
      void loadSummary()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete advance')
    }
  }

  function handleSaved(created: AdvanceRow | null) {
    setFormOpen(false)
    void loadList()
    void loadSummary()
    // Auto-open the printable receipt right after a NEW advance is recorded
    if (created) setReceipt(created)
  }

  async function handleExportCsv() {
    if (exporting) return
    setExporting(true)
    try {
      const all: AdvanceRow[] = []
      let p = 1
      for (;;) {
        const res = await api.get<Paginated<AdvanceRow>>(
          `/api/advances${qs({
            search: debouncedSearch,
            month: monthFilter === 'all' ? '' : monthFilter,
            year: yearFilter === 'all' ? '' : yearFilter,
            status: statusFilter === 'all' ? '' : statusFilter,
            projectId: projectFilter === 'all' ? '' : projectFilter,
            page: p,
            pageSize: 100,
          })}`
        )
        all.push(...res.data)
        if (p >= res.totalPages || res.data.length === 0) break
        p += 1
      }
      if (all.length === 0) {
        toast.info('No advances match the current filters')
        return
      }
      const csv = buildCsv(
        [
          'Reference',
          'Worker',
          'IQAMA',
          'Amount',
          'Given Date',
          'Payment Method',
          'Notes / Reference',
          'Deduction Month',
          'Installments',
          'Monthly Installment',
          'Deducted',
          'Remaining',
          'Status',
        ],
        all.map((r) => [
          advanceRef(r.id),
          r.staff.fullName,
          r.staff.iqamaId,
          r.amount.toFixed(2),
          formatDate(r.givenDate),
          r.paymentMethod === 'bank_transfer' ? 'Bank Transfer' : 'Cash',
          r.reference ?? '',
          `${monthName(r.deductionMonth)} ${r.deductionYear}`,
          r.installments,
          monthlyInstallment(r).toFixed(2),
          r.deductedAmount.toFixed(2),
          (r.amount - r.deductedAmount).toFixed(2),
          r.status,
        ])
      )
      const period =
        monthFilter !== 'all' || yearFilter !== 'all'
          ? `${monthFilter !== 'all' ? monthName(Number(monthFilter)) : ''}${
              monthFilter !== 'all' && yearFilter !== 'all' ? '-' : ''
            }${yearFilter !== 'all' ? yearFilter : ''}`
          : 'all'
      downloadCsv(csvFilename('worker-advances', period), csv)
      toast.success(`Exported ${all.length} advance records to CSV`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  function handlePrint() {
    printWithPageRule('size: A4 landscape; margin: 8mm;')
  }

  const maxMonthly = summary ? Math.max(...summary.monthly.map((m) => m.given), 0) : 0
  const activeFilterCount =
    (monthFilter !== 'all' ? 1 : 0) +
    (yearFilter !== 'all' ? 1 : 0) +
    (statusFilter !== 'all' ? 1 : 0) +
    (projectFilter !== 'all' ? 1 : 0)

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title="Worker Advances"
        description="Salary advances given to workers & automatic payroll recovery"
      >
        <Button
          variant="outline"
          size="sm"
          className="h-9 print-hidden"
          onClick={handlePrint}
          disabled={loading || rows.length === 0}
        >
          <Printer className="mr-2 h-4 w-4" />
          Print PDF
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-9 print-hidden"
          onClick={handleExportCsv}
          disabled={exporting}
        >
          {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
          Excel / CSV
        </Button>
        {canCreate ? (
          <Button size="sm" className="h-9 print-hidden" onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" />
            Give Advance
          </Button>
        ) : null}
      </PageHeader>

      {/* Stat cards */}
      {summary ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 print:hidden">
          <StatCard
            title="Total Advance Outstanding"
            value={formatNumber(summary.totals.outstanding)}
            valuePrefix={currency}
            sublabel="Balance not yet recovered"
            icon={HandCoins}
            tone="amber"
          />
          <StatCard
            title="Total Advanced"
            value={formatNumber(summary.totals.given)}
            valuePrefix={currency}
            sublabel={`${summary.totals.count} advance${summary.totals.count === 1 ? '' : 's'} given`}
            icon={Wallet}
            tone="navy"
          />
          <StatCard
            title="Recovered via Payroll"
            value={formatNumber(summary.totals.deducted)}
            valuePrefix={currency}
            sublabel="Deducted from salaries"
            icon={TrendingUp}
            tone="green"
          />
          <StatCard
            title="Workers with Advances"
            value={summary.totals.workers.toLocaleString()}
            sublabel={`${summary.totals.pendingCount} still pending`}
            icon={Users}
            tone="violet"
          />
        </div>
      ) : null}

      {/* Printable content — print-only heading + advances table (A4 landscape) */}
      <div className="print-area print-landscape">
        {/* Print-only header (visible only in print output) */}
        <div className="hidden print:block">
          <h1 className="text-lg font-bold">Worker Advances</h1>
          <p className="text-xs text-neutral-600">
            {settings.companyName} · Generated{' '}
            {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            {activeFilterCount > 0
              ? ` · Filter: ${
                  monthFilter !== 'all' ? `${monthName(Number(monthFilter))} ` : ''
                }${yearFilter !== 'all' ? yearFilter : ''}${
                  statusFilter !== 'all' ? ` · ${statusFilter.replace('_', ' ')}` : ''
                }`
              : ' · All records'}
            {' · Outstanding: '}
            {formatMoney(totals.outstanding, currency)}
          </p>
        </div>

        {/* Screen layout: filters + table + monthly summary */}
        <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-3 print:block">
        {/* Filters + table */}
        <div className="space-y-4 lg:col-span-2">
          <SectionCard className="p-4 sm:p-6">
            <div className="print:hidden">
            <FilterBar
              search={<SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1) }} placeholder="Search worker, IQAMA or reference…" />}
              activeCount={activeFilterCount}
            >
              <FilterSelect
                value={monthFilter}
                onChange={changeFilter(setMonthFilter)}
                placeholder="Deduction Month"
                options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))}
                emptyLabel="All months"
              />
              <FilterSelect
                value={yearFilter}
                onChange={changeFilter(setYearFilter)}
                placeholder="Year"
                options={yearOptions.map((y) => ({ value: y, label: y }))}
                emptyLabel="All years"
              />
              <FilterSelect
                value={statusFilter}
                onChange={changeFilter(setStatusFilter)}
                placeholder="Status"
                options={[
                  { value: 'pending', label: 'Pending' },
                  { value: 'partially_deducted', label: 'Partially Deducted' },
                  { value: 'deducted', label: 'Deducted' },
                ]}
                emptyLabel="All statuses"
              />
              <FilterSelect
                value={projectFilter}
                onChange={changeFilter(setProjectFilter)}
                placeholder="Project"
                options={projects.map((p) => ({ value: p.id, label: p.name }))}
                emptyLabel="All projects"
              />
            </FilterBar>
            </div>

            <div className="mt-4 print:mt-0">
              {loading ? (
                <TableSkeleton rows={6} />
              ) : rows.length === 0 ? (
                <EmptyState
                  icon={HandCoins}
                  title="No worker advances"
                  description={
                    activeFilterCount > 0 || search
                      ? 'No advances match the current filters — try clearing them.'
                      : 'Advance payments given to workers will appear here.'
                  }
                  action={
                    canCreate ? (
                      <Button size="sm" onClick={openCreate}>
                        <Plus className="mr-2 h-4 w-4" />
                        Give Advance
                      </Button>
                    ) : undefined
                  }
                />
              ) : (
                <>
                  {/* Desktop / print table */}
                  <div className="nice-scrollbar hidden overflow-x-auto md:block print:block print:overflow-visible">
                    <Table className="min-w-[760px] print:min-w-0">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="h-9">Reference</TableHead>
                          <TableHead className="h-9 min-w-[180px]">Worker</TableHead>
                          <TableHead className="h-9 text-right">Amount</TableHead>
                          <TableHead className="h-9">Given</TableHead>
                          <TableHead className="h-9">Deduction Month</TableHead>
                          <TableHead className="h-9 text-right">Deducted</TableHead>
                          <TableHead className="h-9 text-right">Remaining</TableHead>
                          <TableHead className="h-9">Status</TableHead>
                          <TableHead className="h-9 text-right print:hidden">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rows.map((r) => {
                          const remaining = r.amount - r.deductedAmount
                          const share = monthlyInstallment(r)
                          return (
                            <TableRow key={r.id}>
                              <TableCell className="px-4 py-2.5 font-mono text-xs font-medium print:px-2">
                                {advanceRef(r.id)}
                              </TableCell>
                              <TableCell className="px-4 py-2.5 print:px-2">
                                <div className="flex items-center gap-2.5">
                                  <AvatarInitials name={r.staff.fullName} size="sm" className="print:hidden" />
                                  <div className="min-w-0">
                                    <p className="truncate font-medium print:whitespace-normal">{r.staff.fullName}</p>
                                    <p className="truncate text-xs text-muted-foreground print:whitespace-normal">
                                      IQAMA: {r.staff.iqamaId}
                                    </p>
                                  </div>
                                </div>
                              </TableCell>
                              <TableCell className="px-4 py-2.5 text-right tabular-nums print:px-2">
                                {formatMoney(r.amount, currency)}
                              </TableCell>
                              <TableCell className="px-4 py-2.5 print:px-2">
                                <p className="text-sm">{formatDate(r.givenDate)}</p>
                                <p className="text-xs text-muted-foreground">
                                  {r.paymentMethod === 'bank_transfer' ? 'Bank Transfer' : 'Cash'}
                                </p>
                              </TableCell>
                              <TableCell className="px-4 py-2.5 print:px-2">
                                <p className="text-sm">
                                  {monthName(r.deductionMonth)} {r.deductionYear}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {r.installments > 1
                                    ? `${r.installments} × ${formatMoney(share, currency)}`
                                    : 'Single deduction'}
                                </p>
                              </TableCell>
                              <TableCell className="px-4 py-2.5 text-right tabular-nums print:px-2">
                                {formatMoney(r.deductedAmount, currency)}
                              </TableCell>
                              <TableCell className="px-4 py-2.5 text-right tabular-nums print:px-2">
                                {formatMoney(remaining, currency)}
                              </TableCell>
                              <TableCell className="px-4 py-2.5 print:px-2">
                                <AdvanceStatusBadge status={r.status} />
                              </TableCell>
                              <TableCell className="px-4 py-2.5 print:hidden">
                                <div className="flex items-center justify-end gap-1">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8"
                                    onClick={() => setReceipt(r)}
                                    title="Print advance receipt"
                                  >
                                    <ReceiptText className="h-4 w-4" />
                                    <span className="sr-only">Print receipt for {r.staff.fullName}</span>
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8"
                                    onClick={() => {
                                      setLedgerStaffId(r.staff.id)
                                      setLedgerLabel(
                                        `${r.staff.fullName} — IQAMA ${r.staff.iqamaId}${
                                          r.staff.position ? ` · ${r.staff.position}` : ''
                                        }`
                                      )
                                    }}
                                    title="Worker ledger"
                                  >
                                    <BookOpen className="h-4 w-4" />
                                    <span className="sr-only">Open ledger for {r.staff.fullName}</span>
                                  </Button>
                                  {canEdit ? (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8"
                                      onClick={() => openEdit(r)}
                                      disabled={r.locked}
                                      title={r.locked ? 'Locked — deducted in a finalized payroll' : 'Edit advance'}
                                    >
                                      <Pencil className="h-4 w-4" />
                                      <span className="sr-only">Edit {advanceRef(r.id)}</span>
                                    </Button>
                                  ) : null}
                                  {canDelete ? (
                                    r.locked ? (
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8"
                                        disabled
                                        title="Locked — deducted in a finalized payroll"
                                      >
                                        <Lock className="h-4 w-4" />
                                        <span className="sr-only">Advance locked</span>
                                      </Button>
                                    ) : (
                                      <ConfirmDelete
                                        onConfirm={() => handleDelete(r)}
                                        title="Delete advance?"
                                        description={`${advanceRef(r.id)} — ${formatMoney(r.amount, currency)} for ${r.staff.fullName}. The linked expense entry is removed too.`}
                                      />
                                    )
                                  ) : null}
                                </div>
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  </div>

                  {/* Mobile cards */}
                  <ul className="space-y-3 md:hidden print:hidden">
                    {rows.map((r) => {
                      const remaining = r.amount - r.deductedAmount
                      return (
                        <li key={r.id} className="rounded-xl border bg-card p-3.5 shadow-sm">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex min-w-0 items-center gap-2.5">
                              <AvatarInitials name={r.staff.fullName} size="sm" />
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold">{r.staff.fullName}</p>
                                <p className="truncate text-xs text-muted-foreground">
                                  {advanceRef(r.id)} · IQAMA {r.staff.iqamaId}
                                </p>
                              </div>
                            </div>
                            <AdvanceStatusBadge status={r.status} />
                          </div>
                          <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                            <div>
                              <p className="text-muted-foreground">Amount</p>
                              <p className="font-semibold tabular-nums">{formatMoney(r.amount, currency)}</p>
                            </div>
                            <div>
                              <p className="text-muted-foreground">Remaining</p>
                              <p className="font-semibold tabular-nums">{formatMoney(remaining, currency)}</p>
                            </div>
                            <div>
                              <p className="text-muted-foreground">Given</p>
                              <p className="font-medium">
                                {formatDate(r.givenDate)} · {r.paymentMethod === 'bank_transfer' ? 'Bank' : 'Cash'}
                              </p>
                            </div>
                            <div>
                              <p className="text-muted-foreground">Deduction</p>
                              <p className="font-medium">
                                {monthName(r.deductionMonth)} {r.deductionYear}
                                {r.installments > 1 ? ` · ${r.installments}×` : ''}
                              </p>
                            </div>
                          </div>
                          <div className="mt-3 flex items-center justify-end gap-1 border-t pt-2">
                            <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2.5" onClick={() => setReceipt(r)}>
                              <ReceiptText className="h-3.5 w-3.5" />
                              Receipt
                            </Button>
                            <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2.5" onClick={() => {
                              setLedgerStaffId(r.staff.id)
                              setLedgerLabel(`${r.staff.fullName} — IQAMA ${r.staff.iqamaId}`)
                            }}>
                              <BookOpen className="h-3.5 w-3.5" />
                              Ledger
                            </Button>
                            {canEdit ? (
                              <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2.5" onClick={() => openEdit(r)} disabled={r.locked}>
                                <Pencil className="h-3.5 w-3.5" />
                                Edit
                              </Button>
                            ) : null}
                            {canDelete ? (
                              r.locked ? (
                                <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2.5" disabled title="Locked — deducted in a finalized payroll">
                                  <Lock className="h-3.5 w-3.5" />
                                  Locked
                                </Button>
                              ) : (
                                <ConfirmDelete
                                  onConfirm={() => handleDelete(r)}
                                  title="Delete advance?"
                                  description={`${advanceRef(r.id)} — ${formatMoney(r.amount, currency)} for ${r.staff.fullName}. The linked expense entry is removed too.`}
                                  label="Delete"
                                  size="sm"
                                  triggerClassName="h-8 px-2.5 gap-1.5 text-destructive hover:text-destructive"
                                />
                              )
                            ) : null}
                          </div>
                        </li>
                      )
                    })}
                  </ul>

                  <div className="mt-4 print:hidden">
                    <DataTablePagination
                      page={meta.page}
                      pageSize={meta.pageSize}
                      total={meta.total}
                      totalPages={meta.totalPages}
                      onPageChange={setPage}
                      onPageSizeChange={(s) => {
                        setPageSize(s)
                        setPage(1)
                      }}
                    />
                  </div>
                </>
              )}
            </div>
          </SectionCard>
        </div>

        {/* Monthly summary side panel */}
        <SectionCard className="h-fit p-4 sm:p-6 print:hidden">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">Monthly Summary</h3>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Total advance given in each month (last 12 months)
          </p>
          {summary ? (
            <ul className="mt-4 space-y-2.5">
              {summary.monthly
                .slice()
                .reverse()
                .map((m) => (
                  <li key={`${m.year}-${m.month}`} className="space-y-1">
                    <div className="flex items-baseline justify-between gap-2 text-xs">
                      <span className="font-medium">{m.label}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {m.given > 0 ? `${formatNumber(m.given)} · ${m.count} advance${m.count === 1 ? '' : 's'}` : '—'}
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn(
                          'h-full rounded-full transition-all',
                          m.given > 0 ? 'bg-amber-500' : 'bg-transparent'
                        )}
                        style={{ width: maxMonthly > 0 ? `${Math.max(m.given > 0 ? 3 : 0, (m.given / maxMonthly) * 100)}%` : '0%' }}
                      />
                    </div>
                  </li>
                ))}
            </ul>
          ) : (
            <div className="mt-4 space-y-2.5">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-4 animate-pulse rounded bg-muted" />
              ))}
            </div>
          )}
        </SectionCard>
        </div>
      </div>

      {/* Create / edit dialog */}
      <AdvanceFormDialog
        open={formOpen}
        onOpenChange={(o) => {
          setFormOpen(o)
          if (!o) setEditing(null)
        }}
        editing={editing}
        currency={currency}
        onSaved={handleSaved}
      />

      {/* Per-worker ledger */}
      <AdvanceLedgerDialog
        staffId={ledgerStaffId}
        staffLabel={ledgerLabel}
        onOpenChange={(o) => !o && setLedgerStaffId(null)}
      />

      {/* Advance payment receipt (print / save as PDF) */}
      <AdvanceReceiptDialog
        advance={receipt}
        open={Boolean(receipt)}
        onOpenChange={(o) => !o && setReceipt(null)}
      />

      {/* Mobile FAB */}
      {canCreate ? (
        <MobileFab label="Give Advance" icon={Plus} onClick={openCreate} />
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Create / edit dialog
// ---------------------------------------------------------------------------

type FormState = {
  staffId: string
  amount: string
  givenDate: string
  paymentMethod: 'cash' | 'bank_transfer'
  reference: string
  deductionMonth: string
  deductionYear: string
  installmentsEnabled: boolean
  installments: string
}

function defaultForm(): FormState {
  const now = new Date()
  return {
    staffId: '',
    amount: '',
    givenDate: toDateInputValue(now),
    paymentMethod: 'cash',
    reference: '',
    deductionMonth: String(now.getMonth() + 1),
    deductionYear: String(now.getFullYear()),
    installmentsEnabled: false,
    installments: '2',
  }
}

function AdvanceFormDialog({
  open,
  onOpenChange,
  editing,
  currency,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  editing: AdvanceRow | null
  currency: string
  /** receives the created row (create only) so the caller can open the receipt */
  onSaved: (created: AdvanceRow | null) => void
}) {
  const [staffOptions, setStaffOptions] = useState<StaffRow[]>([])
  const [optionsLoading, setOptionsLoading] = useState(false)
  const [staffOpen, setStaffOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [deductionTouched, setDeductionTouched] = useState(false)
  const [form, setForm] = useState<FormState>(defaultForm)

  const yearOptions = useMemo(() => {
    const y = new Date().getFullYear()
    return Array.from({ length: 6 }, (_, i) => String(y - 3 + i))
  }, [])

  const setField = useCallback((patch: Partial<FormState>) => {
    setForm((f) => ({ ...f, ...patch }))
  }, [])

  // Load dropdown data + (re)initialize the form each time the dialog opens
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setDeductionTouched(false)
    setOptionsLoading(true)
    fetchAllPages<StaffRow>('/api/staff', { status: 'active' })
      .then((staff) => {
        if (!cancelled) setStaffOptions(staff)
      })
      .catch(() => {
        if (!cancelled) toast.error('Failed to load workers')
      })
      .finally(() => {
        if (!cancelled) setOptionsLoading(false)
      })

    if (editing) {
      setForm({
        staffId: editing.staff.id,
        amount: String(editing.amount),
        givenDate: toDateInputValue(editing.givenDate),
        paymentMethod: editing.paymentMethod,
        reference: editing.reference ?? '',
        deductionMonth: String(editing.deductionMonth),
        deductionYear: String(editing.deductionYear),
        installmentsEnabled: editing.installments > 1,
        installments: String(Math.max(2, editing.installments)),
      })
    } else {
      setForm(defaultForm())
    }
    return () => {
      cancelled = true
    }
  }, [open, editing])

  const selectedStaff = useMemo(
    () => staffOptions.find((s) => s.id === form.staffId) ?? null,
    [staffOptions, form.staffId]
  )

  // Keep the deduction month in sync with the advance date until manually changed
  function handleGivenDateChange(v: string) {
    setField({ givenDate: v })
    if (!deductionTouched && !editing && v) {
      const d = new Date(`${v}T00:00:00`)
      if (!isNaN(d.getTime())) {
        setField({
          givenDate: v,
          deductionMonth: String(d.getMonth() + 1),
          deductionYear: String(d.getFullYear()),
        })
      }
    }
  }

  const installments = form.installmentsEnabled
    ? Math.min(60, Math.max(2, Math.round(Number(form.installments) || 2)))
    : 1
  const amount = Math.max(0, Number(form.amount) || 0)
  const share = installments > 0 ? amount / installments : 0
  const last = lastInstallmentMonth({
    deductionMonth: Number(form.deductionMonth),
    deductionYear: Number(form.deductionYear),
    installments,
  })

  async function handleSubmit() {
    if (!form.staffId) {
      toast.error('Select a worker first')
      return
    }
    if (!(amount > 0)) {
      toast.error('Amount must be greater than zero')
      return
    }
    setSubmitting(true)
    try {
      const body = {
        staffId: form.staffId,
        amount,
        givenDate: form.givenDate,
        paymentMethod: form.paymentMethod,
        reference: form.reference || null,
        deductionMonth: Number(form.deductionMonth),
        deductionYear: Number(form.deductionYear),
        installments,
      }
      const res = editing
        ? await api.put<AdvanceRow>(`/api/advances/${editing.id}`, body)
        : await api.post<AdvanceRow>('/api/advances', body)
      toast.success(
        editing
          ? `Advance updated — ${formatMoney(res.amount, currency)}`
          : `Advance recorded — ${formatMoney(res.amount, currency)} for ${res.staff.fullName}. Receipt is ready to print.`
      )
      onSaved(editing ? null : res)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save advance')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="nice-scrollbar max-h-[90vh] gap-5 overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit Advance ${advanceRef(editing.id)}` : 'Give Worker Advance'}</DialogTitle>
          <DialogDescription>
            {editing
              ? 'Update the advance details. Locks apply once deducted in a finalized payroll.'
              : 'Record an advance payment — it will be deducted automatically from the payroll of the deduction month.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Worker */}
          <div className="space-y-2">
            <Label>Worker</Label>
            <Popover open={staffOpen} onOpenChange={(o) => !editing && setStaffOpen(o)}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  role="combobox"
                  aria-expanded={staffOpen}
                  disabled={!!editing || optionsLoading}
                  className="h-10 w-full justify-between font-normal"
                >
                  <span className="truncate">
                    {editing ? (
                      `${editing.staff.fullName} — IQAMA: ${editing.staff.iqamaId}`
                    ) : selectedStaff ? (
                      `${selectedStaff.fullName} — IQAMA: ${selectedStaff.iqamaId}`
                    ) : (
                      <span className="text-muted-foreground">Search by name or IQAMA</span>
                    )}
                  </span>
                  {optionsLoading ? (
                    <Loader2 className="ml-2 h-4 w-4 shrink-0 animate-spin opacity-50" />
                  ) : (
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="nice-scrollbar p-0" align="start">
                <Command shouldFilter={true}>
                  <CommandInput placeholder="Search worker name or IQAMA…" />
                  <CommandList>
                    <CommandEmpty>No worker found.</CommandEmpty>
                    <CommandGroup>
                      {staffOptions.map((s) => (
                        <CommandItem
                          key={s.id}
                          value={`${s.fullName} ${s.iqamaId}`}
                          onSelect={() => {
                            setField({ staffId: s.id })
                            setStaffOpen(false)
                          }}
                        >
                          <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
                            <span className="truncate">{s.fullName}</span>
                            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                              {s.iqamaId}
                            </span>
                          </div>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          {/* Amount + date */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="advance-amount">Amount ({currency})</Label>
              <Input
                id="advance-amount"
                type="number"
                inputMode="decimal"
                step={0.01}
                min={0}
                placeholder="0.00"
                value={form.amount}
                onChange={(e) => setField({ amount: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="advance-date">Date Given</Label>
              <Input
                id="advance-date"
                type="date"
                value={form.givenDate}
                onChange={(e) => handleGivenDateChange(e.target.value)}
              />
            </div>
          </div>

          {/* Payment method + reference */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Payment Method</Label>
              <Select
                value={form.paymentMethod}
                onValueChange={(v) => setField({ paymentMethod: v === 'bank_transfer' ? 'bank_transfer' : 'cash' })}
              >
                <SelectTrigger className="h-10 w-full" aria-label="Payment method">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="advance-reference">Notes / Reference</Label>
              <Input
                id="advance-reference"
                placeholder="Voucher no, transfer id…"
                value={form.reference}
                onChange={(e) => setField({ reference: e.target.value })}
              />
            </div>
          </div>

          {/* Deduction month */}
          <div className="space-y-2">
            <Label>Deduction Month</Label>
            <div className="grid grid-cols-2 gap-3">
              <Select
                value={form.deductionMonth}
                onValueChange={(v) => {
                  setDeductionTouched(true)
                  setField({ deductionMonth: v })
                }}
              >
                <SelectTrigger className="h-10 w-full" aria-label="Deduction month">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MONTHS.map((m, i) => (
                    <SelectItem key={m} value={String(i + 1)}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={form.deductionYear}
                onValueChange={(v) => {
                  setDeductionTouched(true)
                  setField({ deductionYear: v })
                }}
              >
                <SelectTrigger className="h-10 w-full" aria-label="Deduction year">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {yearOptions.map((y) => (
                    <SelectItem key={y} value={y}>
                      {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">
              Defaults to the month of the advance date — change it to deduct later.
            </p>
          </div>

          {/* Installments */}
          <div className="space-y-3 rounded-lg border bg-muted/30 p-3.5">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <Label htmlFor="advance-installments-toggle" className="cursor-pointer">
                  Deduct in installments
                </Label>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Split a large advance across several months
                </p>
              </div>
              <Switch
                id="advance-installments-toggle"
                checked={form.installmentsEnabled}
                onCheckedChange={(v) => setField({ installmentsEnabled: v })}
              />
            </div>
            {form.installmentsEnabled ? (
              <div className="space-y-2">
                <Label htmlFor="advance-installments">Number of months</Label>
                <Input
                  id="advance-installments"
                  type="number"
                  inputMode="numeric"
                  step={1}
                  min={2}
                  max={60}
                  value={form.installments}
                  onChange={(e) => setField({ installments: e.target.value })}
                  className="h-10 sm:max-w-[140px]"
                />
              </div>
            ) : null}
          </div>

          {/* Live preview */}
          {amount > 0 && form.deductionMonth && form.deductionYear ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-3 text-xs leading-relaxed text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
              <div className="flex items-center gap-1.5 font-semibold">
                <ReceiptText className="h-3.5 w-3.5" />
                Deduction plan
              </div>
              <p className="mt-1">
                {formatMoney(share, currency)} × {installments}{' '}
                {installments === 1 ? 'deduction' : 'installments'} starting{' '}
                {monthName(Number(form.deductionMonth))} {form.deductionYear}
                {installments > 1
                  ? ` — last deduction ${monthName(last.month)} ${last.year}`
                  : ''}
                . If a month&apos;s salary is too small, only the available amount is deducted and
                the balance carries to the next month.
              </p>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || !form.staffId || !(amount > 0)}>
            {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {editing ? 'Save Changes' : 'Record Advance'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Per-worker ledger content (shared by the Advances view dialog and the
// staff profile "Advances" tab)
// ---------------------------------------------------------------------------

export function AdvanceLedgerContent({ staffId }: { staffId: string }) {
  const settings = useAppStore((s) => s.settings)
  const currency = settings.currency || 'SAR'
  const [data, setData] = useState<AdvanceLedgerData | null>(null)
  // starts true on mount; the component is remounted per worker via `key`
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    api
      .get<AdvanceLedgerData>(`/api/advances/ledger${qs({ staffId })}`)
      .then((res) => {
        if (!cancelled) setData(res)
      })
      .catch((e) => {
        if (!cancelled) toast.error(e instanceof Error ? e.message : 'Failed to load ledger')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [staffId])

  if (loading || !data) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-12 animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
    )
  }

  if (data.advances.length === 0) {
    return (
      <EmptyState
        icon={HandCoins}
        title="No advances"
        description="This worker has never received a salary advance."
      />
    )
  }

  return (
    <div className="space-y-5">
      {/* Totals */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border bg-muted/40 p-3">
          <p className="text-[11px] font-medium text-muted-foreground">Total Advanced</p>
          <p className="mt-0.5 text-sm font-bold tabular-nums">
            {formatMoney(data.totals.given, currency)}
          </p>
        </div>
        <div className="rounded-xl border bg-muted/40 p-3">
          <p className="text-[11px] font-medium text-muted-foreground">Recovered</p>
          <p className="mt-0.5 text-sm font-bold tabular-nums">
            {formatMoney(data.totals.deducted, currency)}
          </p>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950">
          <p className="text-[11px] font-medium text-amber-700 dark:text-amber-400">
            Outstanding
          </p>
          <p className="mt-0.5 text-sm font-bold tabular-nums text-amber-800 dark:text-amber-300">
            {formatMoney(data.totals.outstanding, currency)}
          </p>
        </div>
      </div>

      {/* Advances */}
      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Advances
        </h4>
        <div className="overflow-hidden rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="h-9">Ref</TableHead>
                <TableHead className="h-9">Given</TableHead>
                <TableHead className="h-9 text-right">Amount</TableHead>
                <TableHead className="h-9">Deduction</TableHead>
                <TableHead className="h-9 text-right">Deducted</TableHead>
                <TableHead className="h-9 text-right">Remaining</TableHead>
                <TableHead className="h-9">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.advances.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="px-3 py-2 font-mono text-xs">{advanceRef(a.id)}</TableCell>
                  <TableCell className="px-3 py-2 text-xs">
                    {formatDate(a.givenDate)}
                    <span className="block text-muted-foreground">
                      {a.paymentMethod === 'bank_transfer' ? 'Bank' : 'Cash'}
                      {a.reference ? ` · ${a.reference}` : ''}
                    </span>
                  </TableCell>
                  <TableCell className="px-3 py-2 text-right tabular-nums">
                    {formatMoney(a.amount, currency)}
                  </TableCell>
                  <TableCell className="px-3 py-2 text-xs">
                    {monthName(a.deductionMonth)} {a.deductionYear}
                    {a.installments > 1 ? (
                      <span className="block text-muted-foreground">
                        {a.installments} × {formatMoney(monthlyInstallment(a), currency)}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="px-3 py-2 text-right tabular-nums">
                    {formatMoney(a.deductedAmount, currency)}
                  </TableCell>
                  <TableCell className="px-3 py-2 text-right tabular-nums font-medium">
                    {formatMoney(a.amount - a.deductedAmount, currency)}
                  </TableCell>
                  <TableCell className="px-3 py-2">
                    <AdvanceStatusBadge status={a.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Payroll deductions timeline */}
      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Payroll Deductions
        </h4>
        {data.deductions.length === 0 ? (
          <p className="rounded-xl border border-dashed bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
            No payroll has deducted from these advances yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {data.deductions.map((d) => {
              const adv = data.advances.find((a) => a.id === d.advanceId)
              return (
                <li
                  key={d.id}
                  className="flex items-center justify-between gap-3 rounded-xl border bg-card px-3.5 py-2.5 shadow-sm"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span
                      className={cn(
                        'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border',
                        d.recovered
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-600 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-400'
                          : 'border-amber-200 bg-amber-50 text-amber-600 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400'
                      )}
                    >
                      {d.recovered ? (
                        <CheckCircle2 className="h-4 w-4" />
                      ) : (
                        <Banknote className="h-4 w-4" />
                      )}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {monthName(d.month)} {d.year} payroll
                        {adv ? (
                          <span className="text-muted-foreground"> · {advanceRef(adv.id)}</span>
                        ) : null}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {d.payrollStatus === 'paid'
                          ? d.recovered
                            ? 'Finalized — advance recovered'
                            : 'Finalized payroll'
                          : 'Pending payroll — not yet finalized'}
                      </p>
                    </div>
                  </div>
                  <p className="shrink-0 text-sm font-semibold tabular-nums">
                    −{formatMoney(d.amount, currency)}
                  </p>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Per-worker ledger dialog (Advances view)
// ---------------------------------------------------------------------------

export function AdvanceLedgerDialog({
  staffId,
  staffLabel,
  onOpenChange,
}: {
  staffId: string | null
  /** "Name — IQAMA 123" line supplied by the opener (avoids an extra fetch) */
  staffLabel?: string | null
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={Boolean(staffId)} onOpenChange={onOpenChange}>
      <DialogContent className="nice-scrollbar max-h-[90vh] gap-5 overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Landmark className="h-5 w-5 text-muted-foreground" />
            Advance Ledger
          </DialogTitle>
          <DialogDescription>{staffLabel ?? 'Worker advance history'}</DialogDescription>
        </DialogHeader>
        {staffId ? <AdvanceLedgerContent key={staffId} staffId={staffId} /> : null}
      </DialogContent>
    </Dialog>
  )
}

'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  Banknote,
  Building2,
  CalendarClock,
  CalendarDays,
  Check,
  ChevronsUpDown,
  Clock,
  Download,
  FileText,
  FolderKanban,
  HandCoins,
  Loader2,
  Pencil,
  Plus,
  ReceiptText,
  RefreshCw,
  TrendingDown,
  TriangleAlert,
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
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { SalarySlipDialog, type SlipPayroll } from '@/components/app/print/salary-slip'
import { AvatarInitials } from '@/components/app/shared/avatar-initials'
import { ConfirmDelete } from '@/components/app/shared/confirm-delete'
import { DataTablePagination } from '@/components/app/shared/data-table-pagination'
import { EmptyState, TableSkeleton } from '@/components/app/shared/empty-state'
import { FilterBar, FilterSelect, SearchInput } from '@/components/app/shared/filter-select'
import { PageHeader, SectionCard, MobileFab } from '@/components/app/shared/page-header'
import { CategoryChip, StatusBadge } from '@/components/app/shared/status-badge'
import { useDebounce } from '@/hooks/use-debounce'
import { useViewIntent, useViewRecordIntent } from '@/hooks/use-view-intent'
import { api, qs } from '@/lib/api-client'
import { formatDate, formatMoney, formatNumber, monthName, round2, toDateInputValue } from '@/lib/format'
import { calcPayroll } from '@/lib/payroll'
import { can, useAppStore } from '@/lib/store'
import {
  MONTHS,
  PAY_TYPE_LABELS,
  type AdvancePayrollPreview,
  type AdvanceStalePayroll,
  type ClientRow,
  type DeductionType,
  type DeployedWorker,
  type Paginated,
  type PayrollRow,
  type PayrollStatus,
  type PayType,
  type ProjectRow,
  type StaffCategory,
  type StaffRow,
} from '@/lib/types'
import { cn } from '@/lib/utils'
import { buildCsv, csvFilename, downloadCsv } from '@/lib/csv'

type ListTotals = { gross: number; deductions: number; net: number }

type FormState = {
  staffId: string
  projectId: string
  month: string
  year: string
  totalHours: string
  hourlyRate: string
  overtimeHours: string
  overtimeRate: string
  otherEarnings: string
  advance: string
  absentPenalty: string
  ptAmount: string
  unionFees: string
  otherDeductionValue: string
  otherDeductionType: DeductionType
  status: PayrollStatus
  payDate: string
  payType: PayType
  taxCode: string
}

/** Previous month (with January → December wrap) as filter default. */
function previousMonth(): { month: string; year: string } {
  const now = new Date()
  const m = now.getMonth() + 1
  if (m === 1) return { month: '12', year: String(now.getFullYear() - 1) }
  return { month: String(m - 1), year: String(now.getFullYear()) }
}

function toNum(v: string): number {
  const n = Number(v || 0)
  if (!isFinite(n) || n < 0) return 0
  return n
}

/**
 * Walk all pages of a paginated list endpoint (the server clamps pageSize to
 * 50 max, so dropdowns must loop pages to receive every record).
 */
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

function defaultForm(defaultPayType: PayType): FormState {
  const now = new Date()
  return {
    staffId: '',
    projectId: 'none',
    month: String(now.getMonth() + 1),
    year: String(now.getFullYear()),
    totalHours: '',
    hourlyRate: '',
    overtimeHours: '',
    overtimeRate: '',
    otherEarnings: '',
    advance: '',
    absentPenalty: '',
    ptAmount: '',
    unionFees: '',
    otherDeductionValue: '',
    otherDeductionType: 'fixed',
    status: 'pending',
    payDate: '',
    payType: defaultPayType,
    taxCode: 'N/A',
  }
}

// ---------------------------------------------------------------------------
// Payroll list view
// ---------------------------------------------------------------------------

export function PayrollView() {
  const user = useAppStore((s) => s.user)
  const settings = useAppStore((s) => s.settings)
  const currency = settings.currency || 'SAR'

  const canCreate = can(user, 'payroll.create')
  const canEdit = can(user, 'payroll.edit')
  const canDelete = can(user, 'payroll.delete')
  const canPrint = can(user, 'payroll.print')
  const [markingPaidId, setMarkingPaidId] = useState<string | null>(null)

  const initialPeriod = useMemo(previousMonth, [])
  const yearOptions = useMemo(() => {
    const y = new Date().getFullYear()
    return Array.from({ length: 5 }, (_, i) => String(y - 2 + i))
  }, [])

  // Filters — default to the PREVIOUS month (sandbox today: October 2026 → 9/2026)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 350)
  const [clientFilter, setClientFilter] = useState('all')
  const [projectFilter, setProjectFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [monthFilter, setMonthFilter] = useState(initialPeriod.month)
  const [yearFilter, setYearFilter] = useState(initialPeriod.year)
  const [statusFilter, setStatusFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)

  const [rows, setRows] = useState<PayrollRow[]>([])
  const [totals, setTotals] = useState<ListTotals>({ gross: 0, deductions: 0, net: 0 })
  const [meta, setMeta] = useState({ page: 1, pageSize: 10, total: 0, totalPages: 1 })
  const [loading, setLoading] = useState(true)

  // Advances whose deduction month matches this period but whose payroll column
  // is out of date (advance added/edited after the payroll was generated)
  const [staleAdvances, setStaleAdvances] = useState<AdvanceStalePayroll[]>([])
  const [recalculating, setRecalculating] = useState(false)

  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [categories, setCategories] = useState<StaffCategory[]>([])
  const [clients, setClients] = useState<ClientRow[]>([])

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<PayrollRow | null>(null)
  const [slipRow, setSlipRow] = useState<SlipPayroll | null>(null)
  const [slipOpen, setSlipOpen] = useState(false)
  const [exporting, setExporting] = useState(false)

  const loadList = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get<Paginated<PayrollRow>>(
        `/api/payrolls${qs({
          search: debouncedSearch,
          clientId: clientFilter === 'all' ? '' : clientFilter,
          projectId: projectFilter === 'all' ? '' : projectFilter,
          categoryId: categoryFilter === 'all' ? '' : categoryFilter,
          month: monthFilter === 'all' ? '' : monthFilter,
          year: yearFilter === 'all' ? '' : yearFilter,
          status: statusFilter === 'all' ? '' : statusFilter,
          page,
          pageSize,
        })}`
      )
      setRows(res.data)
      setTotals({
        gross: res.totals?.gross ?? 0,
        deductions: res.totals?.deductions ?? 0,
        net: res.totals?.net ?? 0,
      })
      setMeta({
        page: res.page,
        pageSize: res.pageSize,
        total: res.total,
        totalPages: res.totalPages,
      })
      // Jump back if the current page no longer exists (e.g. after delete)
      if (res.data.length === 0 && res.page > 1 && res.total > 0) setPage(res.totalPages)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load payrolls')
    } finally {
      setLoading(false)
    }
  }, [debouncedSearch, clientFilter, projectFilter, categoryFilter, monthFilter, yearFilter, statusFilter, page, pageSize])

  // Stale advance detection for the filtered period (concrete month + year only)
  const loadStaleAdvances = useCallback(async () => {
    if (monthFilter === 'all' || yearFilter === 'all') {
      setStaleAdvances([])
      return
    }
    try {
      const stale = await api.get<AdvanceStalePayroll[]>(
        `/api/advances/stale-payrolls${qs({ month: monthFilter, year: yearFilter })}`
      )
      setStaleAdvances(stale)
    } catch {
      setStaleAdvances([]) // non-critical — the banner simply hides
    }
  }, [monthFilter, yearFilter])

  useEffect(() => {
    void loadList()
  }, [loadList])

  useEffect(() => {
    void loadStaleAdvances()
  }, [loadStaleAdvances, loadList])

  // One click: re-sync the Advance Deduction column of every payroll in the period
  async function handleRecalculateAdvances() {
    if (recalculating || monthFilter === 'all' || yearFilter === 'all') return
    setRecalculating(true)
    try {
      const res = await api.post<{ recalculated: number; changed: number }>(
        '/api/advances/recalculate',
        { month: Number(monthFilter), year: Number(yearFilter) }
      )
      toast.success(
        res.changed > 0
          ? `Recalculated advance deductions — ${res.changed} of ${res.recalculated} payroll record(s) updated`
          : `Checked ${res.recalculated} payroll record(s) — all advance deductions are up to date`
      )
      void loadList()
      void loadStaleAdvances()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Recalculation failed')
    } finally {
      setRecalculating(false)
    }
  }

  // Filter dropdown data (clients + projects + staff categories)
  useEffect(() => {
    fetchAllPages<ClientRow>('/api/clients')
      .then(setClients)
      .catch(() => {})
    fetchAllPages<ProjectRow>('/api/projects')
      .then(setProjects)
      .catch(() => {})
    api
      .get<{ data: StaffCategory[] }>('/api/staff-categories')
      .then((r) => setCategories(r.data))
      .catch(() => {})
  }, [])

  function changeFilter(setter: (v: string) => void) {
    return (v: string) => {
      setter(v)
      setPage(1)
    }
  }

  /** Picking a client scopes the whole list to that client's workers — and
   *  drops a project filter that belongs to a different client. */
  function handleClientFilterChange(v: string) {
    setClientFilter(v)
    setPage(1)
    if (v !== 'all' && projectFilter !== 'all') {
      const belongs = projects.some((p) => p.id === projectFilter && p.clientId === v)
      if (!belongs) setProjectFilter('all')
    }
  }

  // Project options narrow to the selected client's projects
  const clientProjectOptions = useMemo(() => {
    const list =
      clientFilter === 'all' ? projects : projects.filter((p) => p.clientId === clientFilter)
    return list.map((p) => ({ value: p.id, label: p.name }))
  }, [projects, clientFilter])

  const activeClientName =
    clientFilter === 'all' ? null : (clients.find((c) => c.id === clientFilter)?.name ?? null)

  function openCreate() {
    setEditing(null)
    setFormOpen(true)
  }

  // Export the WHOLE filtered payroll set (walks pages server-side max 100)
  async function handleExportCsv() {
    if (exporting) return
    setExporting(true)
    try {
      const all: PayrollRow[] = []
      let p = 1
      for (;;) {
        const res = await api.get<Paginated<PayrollRow>>(
          `/api/payrolls${qs({
            search: debouncedSearch,
            clientId: clientFilter === 'all' ? '' : clientFilter,
            projectId: projectFilter === 'all' ? '' : projectFilter,
            categoryId: categoryFilter === 'all' ? '' : categoryFilter,
            month: monthFilter === 'all' ? '' : monthFilter,
            year: yearFilter === 'all' ? '' : yearFilter,
            status: statusFilter === 'all' ? '' : statusFilter,
            page: p,
            pageSize: 100,
          })}`
        )
        all.push(...res.data)
        if (p >= res.totalPages || res.data.length === 0) break
        p += 1
      }
      if (all.length === 0) {
        toast.info('No payroll records match the current filters')
        return
      }
      const csv = buildCsv(
        [
          'Staff',
          'IQAMA',
          'Category',
          'Project',
          'Client Company',
          'Period',
          'Total Hours',
          'Hourly Rate',
          'OT Hours',
          'OT Rate',
          'Other Earnings',
          'Gross Pay',
          'Advance Deduction',
          'Absent Penalty',
          'PT Amount',
          'Union Fees',
          'Other Deduction',
          'Total Deductions',
          'Net Pay',
          'Status',
          'Pay Date',
          'Pay Type',
          'Tax Code',
        ],
        all.map((r) => [
          r.staff.fullName,
          r.staff.iqamaId,
          r.staff.staffCategory?.name ?? '',
          r.project?.name ?? '',
          r.project?.clientName ?? '',
          `${monthName(r.month)} ${r.year}`,
          r.totalHours.toFixed(2),
          r.hourlyRateSnapshot.toFixed(2),
          r.overtimeHours.toFixed(2),
          r.overtimeRateSnapshot.toFixed(2),
          r.otherEarnings.toFixed(2),
          r.grossPay.toFixed(2),
          r.advance.toFixed(2),
          r.absentPenalty.toFixed(2),
          r.ptAmount.toFixed(2),
          r.unionFees.toFixed(2),
          r.otherDeductionValue.toFixed(2),
          r.totalDeductions.toFixed(2),
          r.netPay.toFixed(2),
          r.status,
          r.payDate ? formatDate(r.payDate) : '',
          PAY_TYPE_LABELS[r.payType] ?? r.payType,
          r.taxCode ?? '',
        ])
      )
      const period =
        monthFilter !== 'all' || yearFilter !== 'all'
          ? `${monthFilter !== 'all' ? monthName(Number(monthFilter)) : ''}${
              monthFilter !== 'all' && yearFilter !== 'all' ? '-' : ''
            }${yearFilter !== 'all' ? yearFilter : ''}`
          : 'all-periods'
      downloadCsv(csvFilename('payroll', period), csv)
      toast.success(`Exported ${all.length} payroll records to CSV`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  // Deep-open the create dialog when arriving via the command palette
  const shouldOpenCreate = useViewIntent('payroll', 'create')
  useEffect(() => {
    if (shouldOpenCreate) openCreate()
  }, [shouldOpenCreate])

  // Deep-open a specific payroll record when arriving via the command palette:
  // apply the staff search + month/year period filters so the list shows that record
  const recordIntent = useViewRecordIntent('payroll')
  useEffect(() => {
    if (!recordIntent.matched || !recordIntent.payload) return
    const { staffName, month, year } = recordIntent.payload
    if (typeof staffName === 'string' && staffName) setSearch(staffName)
    if (typeof month === 'number' && month >= 1 && month <= 12) setMonthFilter(String(month))
    if (typeof year === 'number' && year > 0) setYearFilter(String(year))
    setPage(1)
    toast.success(`Showing payroll for ${staffName ?? 'the selected record'}`)
  }, [recordIntent.matched])

  function openEdit(row: PayrollRow) {
    setEditing(row)
    setFormOpen(true)
  }

  function openSlip(row: PayrollRow) {
    setSlipRow(row)
    setSlipOpen(true)
  }

  async function handleDelete(row: PayrollRow) {
    try {
      await api.del(`/api/payrolls/${row.id}`)
      toast.success('Payroll deleted')
      void loadList()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete payroll')
    }
  }

  // Quick action: mark a pending payroll as paid (auto-creates the linked Salary expense)
  async function handleMarkPaid(row: PayrollRow) {
    setMarkingPaidId(row.id)
    try {
      await api.post(`/api/payrolls/${row.id}/mark-paid`, {})
      toast.success(
        `${row.staff.fullName} marked as paid — expense of ${formatMoney(row.netPay, currency)} recorded`
      )
      void loadList()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to mark as paid')
    } finally {
      setMarkingPaidId(null)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payroll"
        description="Process monthly payroll, manage disbursements and print salary slips."
      >
        <Button
          variant="outline"
          onClick={() => void handleExportCsv()}
          disabled={exporting || loading}
        >
          {exporting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          Export CSV
        </Button>
        {canCreate ? (
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" />
            Create Payroll
          </Button>
        ) : null}
      </PageHeader>

      {canCreate ? <MobileFab label="Create Payroll" onClick={openCreate} icon={Plus} /> : null}

      {/* Filters */}
      <FilterBar
        search={
          <SearchInput
            value={search}
            onChange={(v) => {
              setSearch(v)
              setPage(1)
            }}
            placeholder="Search staff name or IQAMA..."
            className="sm:w-[260px]"
          />
        }
        activeCount={
          [clientFilter, projectFilter, categoryFilter, monthFilter, yearFilter, statusFilter].filter(
            (v) => v !== 'all'
          ).length
        }
      >
        <FilterSelect
          value={clientFilter}
          onChange={handleClientFilterChange}
          options={clients.map((c) => ({ value: c.id, label: c.name }))}
          placeholder="All Clients"
          className="sm:w-[190px]"
        />
        <FilterSelect
          value={projectFilter}
          onChange={changeFilter(setProjectFilter)}
          options={clientProjectOptions}
          placeholder="All Projects"
          className="sm:w-[170px]"
        />
        <FilterSelect
          value={categoryFilter}
          onChange={changeFilter(setCategoryFilter)}
          options={categories.map((c) => ({ value: c.id, label: c.name }))}
          placeholder="All Categories"
          className="sm:w-[160px]"
        />
        <FilterSelect
          value={monthFilter}
          onChange={changeFilter(setMonthFilter)}
          options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))}
          placeholder="All Months"
          className="sm:w-[150px]"
        />
        <FilterSelect
          value={yearFilter}
          onChange={changeFilter(setYearFilter)}
          options={yearOptions.map((y) => ({ value: y, label: y }))}
          placeholder="All Years"
          className="sm:w-[120px]"
        />
        <FilterSelect
          value={statusFilter}
          onChange={changeFilter(setStatusFilter)}
          options={[
            { value: 'pending', label: 'Pending' },
            { value: 'paid', label: 'Paid' },
          ]}
          placeholder="All Statuses"
          className="sm:w-[140px]"
        />
      </FilterBar>

      {/* Stale advance warning — advances changed after this payroll was generated */}
      {staleAdvances.length > 0 ? (
        <div className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3.5 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-semibold">
                {staleAdvances.length} payroll record{staleAdvances.length === 1 ? '' : 's'} need
                recalculation
              </p>
              <p className="mt-0.5 text-xs leading-relaxed">
                Worker advances were added or changed after this payroll was generated:{' '}
                {staleAdvances.slice(0, 3).map((s) => s.staffName).join(', ')}
                {staleAdvances.length > 3 ? ` +${staleAdvances.length - 3} more` : ''}. The Advance
                Deduction column is out of date.
              </p>
            </div>
          </div>
          {canEdit ? (
            <Button
              size="sm"
              className="h-9 shrink-0 border-amber-300 bg-amber-500 text-white shadow-sm hover:bg-amber-600 dark:border-amber-800 dark:bg-amber-600 dark:hover:bg-amber-500"
              onClick={handleRecalculateAdvances}
              disabled={recalculating}
            >
              {recalculating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Recalculate Payroll
            </Button>
          ) : null}
        </div>
      ) : null}

      {/* Totals for the current filter (3-up on mobile to save vertical space) */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <SummaryChip
          icon={Wallet}
          label="Total Gross"
          value={formatMoney(totals.gross, currency)}
          tone="text-primary"
        />
        <SummaryChip
          icon={TrendingDown}
          label="Total Deductions"
          value={formatMoney(totals.deductions, currency)}
          tone="text-rose-700 dark:text-rose-400"
        />
        <SummaryChip
          icon={Banknote}
          label="Total Net"
          value={formatMoney(totals.net, currency)}
          tone="text-emerald-700 dark:text-emerald-400"
        />
      </div>

      {/* Payroll table */}
      <SectionCard>
        {loading ? (
          <TableSkeleton rows={6} cols={9} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={ReceiptText}
            title="No payroll records"
            description="No payrolls match the current filters. Adjust the filters or create a new payroll record."
            action={
              canCreate ? (
                <Button onClick={openCreate}>
                  <Plus className="h-4 w-4" />
                  Create Payroll
                </Button>
              ) : null
            }
          />
        ) : (
          <>
            {/* Mobile: stacked cards — a 10-column table is unreadable at <md widths */}
            <ul className="space-y-3 p-4 sm:p-6 md:hidden print:hidden">
              {rows.map((row) => (
                <li
                  key={row.id}
                  className={cn(
                    'rounded-xl border bg-card p-3 shadow-sm transition-colors hover:bg-muted/30',
                    canPrint && 'cursor-pointer'
                  )}
                  onClick={() => {
                    if (canPrint) openSlip(row)
                  }}
                >
                  <div className="flex items-start gap-3">
                    <AvatarInitials name={row.staff.fullName} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold leading-snug">{row.staff.fullName}</p>
                      <p className="text-xs text-muted-foreground tabular-nums">
                        IQAMA: {row.staff.iqamaId}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-bold tabular-nums">{formatMoney(row.netPay, currency)}</p>
                      <StatusBadge kind={row.status === 'paid' ? 'paid' : 'pending'} />
                    </div>
                  </div>
                  <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
                    {row.staff.staffCategory ? (
                      <CategoryChip label={row.staff.staffCategory.name} />
                    ) : null}
                    <span className="flex min-w-0 items-center gap-1">
                      <FolderKanban className="h-3 w-3 shrink-0" />
                      <span className="truncate">
                        {row.project?.name ?? 'No project'}
                        {row.project?.clientName ? (
                          <span className="text-muted-foreground/80"> · {row.project.clientName}</span>
                        ) : null}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      <CalendarDays className="h-3 w-3" />
                      {monthName(row.month)} {row.year}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2 border-t pt-2.5">
                    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                      <span className="flex items-center gap-1 text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        <span className="tabular-nums">
                          {row.totalHours}h
                          {row.overtimeHours > 0 ? (
                            <span className="text-muted-foreground"> +{row.overtimeHours} OT</span>
                          ) : null}
                        </span>
                      </span>
                      <span className="flex items-center gap-1 tabular-nums text-muted-foreground">
                        Gross <span className="font-semibold text-foreground">{formatMoney(row.grossPay, currency)}</span>
                      </span>
                      <span className="flex items-center gap-1 tabular-nums text-muted-foreground">
                        Ded <span className="font-semibold text-rose-700 dark:text-rose-400">{formatMoney(row.totalDeductions, currency)}</span>
                      </span>
                    </div>
                    <div
                      className="flex shrink-0 items-center gap-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {canPrint ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-11 w-11 text-muted-foreground hover:text-foreground"
                          onClick={() => openSlip(row)}
                          aria-label={`View salary slip for ${row.staff.fullName}`}
                          title="View salary slip"
                        >
                          <FileText className="h-4 w-4" />
                        </Button>
                      ) : null}
                      {canEdit && row.status === 'pending' ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-11 w-11 text-muted-foreground hover:text-emerald-700 dark:hover:text-emerald-400"
                          onClick={() => void handleMarkPaid(row)}
                          disabled={markingPaidId === row.id}
                          aria-label={`Mark payroll as paid for ${row.staff.fullName}`}
                          title="Mark as Paid (records the salary expense)"
                        >
                          {markingPaidId === row.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Banknote className="h-4 w-4" />
                          )}
                        </Button>
                      ) : null}
                      {canEdit ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-11 w-11 text-muted-foreground hover:text-foreground"
                          onClick={() => openEdit(row)}
                          aria-label={`Edit payroll for ${row.staff.fullName}`}
                          title="Edit payroll"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      ) : null}
                      {canDelete ? (
                        <ConfirmDelete
                          onConfirm={() => handleDelete(row)}
                          title="Delete payroll?"
                          description={`This permanently removes the payroll for ${row.staff.fullName} (${monthName(row.month)} ${row.year}) and its linked expense transaction.`}
                        />
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>

            {/* Desktop: table */}
            <div className="nice-scrollbar hidden md:block print:block print:overflow-visible">
            <Table className="min-w-[1000px] print:min-w-0 print:text-xs">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[250px]">Staff Member</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead className="text-right">Hours</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead className="text-right">Gross</TableHead>
                  <TableHead className="text-right">Deductions</TableHead>
                  <TableHead className="text-right">Net Pay</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[130px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow
                    key={row.id}
                    className={cn(canPrint && 'cursor-pointer')}
                    onClick={() => {
                      if (canPrint) openSlip(row)
                    }}
                  >
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <AvatarInitials name={row.staff.fullName} />
                        <div className="min-w-0">
                          <p className="truncate font-medium">{row.staff.fullName}</p>
                          <p className="text-xs text-muted-foreground">
                            IQAMA: {row.staff.iqamaId}
                          </p>
                          {row.staff.staffCategory ? (
                            <div className="mt-1">
                              <CategoryChip label={row.staff.staffCategory.name} />
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      <span>{row.project?.name ?? '—'}</span>
                      {row.project?.clientName ? (
                        <span className="block text-[11px] text-muted-foreground">
                          {row.project.clientName}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      {monthName(row.month)} {row.year}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">
                      {row.totalHours}
                      {row.overtimeHours > 0 ? (
                        <span className="text-xs text-muted-foreground">
                          {' '}
                          + {row.overtimeHours} OT
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums text-muted-foreground">
                      {formatMoney(row.hourlyRateSnapshot, currency)}/hr
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(row.grossPay, currency)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-rose-700 dark:text-rose-400">
                      {formatMoney(row.totalDeductions, currency)}
                    </TableCell>
                    <TableCell className="text-right font-bold tabular-nums">
                      {formatMoney(row.netPay, currency)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge kind={row.status === 'paid' ? 'paid' : 'pending'} />
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-0.5">
                        {canPrint ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-foreground"
                            onClick={() => openSlip(row)}
                            aria-label={`View salary slip for ${row.staff.fullName}`}
                            title="View salary slip"
                          >
                            <FileText className="h-4 w-4" />
                          </Button>
                        ) : null}
                        {canEdit && row.status === 'pending' ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-emerald-700 dark:hover:text-emerald-400"
                            onClick={(e) => {
                              e.stopPropagation()
                              void handleMarkPaid(row)
                            }}
                            disabled={markingPaidId === row.id}
                            aria-label={`Mark payroll as paid for ${row.staff.fullName}`}
                            title="Mark as Paid (records the salary expense)"
                          >
                            {markingPaidId === row.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Banknote className="h-4 w-4" />
                            )}
                          </Button>
                        ) : null}
                        {canEdit ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-foreground"
                            onClick={() => openEdit(row)}
                            aria-label={`Edit payroll for ${row.staff.fullName}`}
                            title="Edit payroll"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        ) : null}
                        {canDelete ? (
                          <ConfirmDelete
                            onConfirm={() => handleDelete(row)}
                            title="Delete payroll?"
                            description={`This permanently removes the payroll for ${row.staff.fullName} (${monthName(row.month)} ${row.year}) and its linked expense transaction.`}
                          />
                        ) : null}
                        {!canPrint && !canEdit && !canDelete ? (
                          <span className="text-muted-foreground">—</span>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
          </>
        )}
        {!loading && rows.length > 0 ? (
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
            unit="payrolls"
          />
        ) : null}
      </SectionCard>

      <PayrollFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        editing={editing}
        clientFilterId={clientFilter !== 'all' ? clientFilter : undefined}
        clientFilterName={activeClientName}
        onSaved={() => {
          setFormOpen(false)
          void loadList()
        }}
      />

      <SalarySlipDialog payroll={slipRow} open={slipOpen} onOpenChange={setSlipOpen} />
    </div>
  )
}

function SummaryChip({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  tone: string
}) {
  return (
    <div className="flex items-center gap-2 rounded-xl border bg-muted/40 px-2.5 py-2 sm:gap-3 sm:px-4 sm:py-3">
      <Icon className={cn('hidden h-4 w-4 shrink-0 sm:block sm:h-5 sm:w-5', tone)} />
      <div className="min-w-0">
        <p className="truncate text-[11px] font-medium text-muted-foreground sm:text-xs">{label}</p>
        <p
          className="truncate text-[11px] font-semibold tabular-nums tracking-tight sm:text-base sm:tracking-normal"
          title={value}
        >
          {value}
        </p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Payroll create / edit dialog
// ---------------------------------------------------------------------------

function PayrollFormDialog({
  open,
  onOpenChange,
  editing,
  clientFilterId,
  clientFilterName,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  editing: PayrollRow | null
  /** Client selected in the payroll list — scopes the staff picker to that client's workers. */
  clientFilterId?: string
  clientFilterName?: string | null
  onSaved: () => void
}) {
  const settings = useAppStore((s) => s.settings)
  const currency = settings.currency || 'SAR'
  const defaultPayType = settings.defaultPayType || 'bank_transfer'

  const [staffOptions, setStaffOptions] = useState<StaffRow[]>([])
  const [projectOptions, setProjectOptions] = useState<ProjectRow[]>([])
  const [optionsLoading, setOptionsLoading] = useState(false)
  const [staffOpen, setStaffOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [filling, setFilling] = useState(false)
  const [form, setForm] = useState<FormState>(() => defaultForm(defaultPayType))

  // Client scoping — when the list is filtered by a client, the staff picker
  // defaults to the workers deployed to that client (toggleable).
  const activeClientId = clientFilterId ?? ''
  const [deployedWorkers, setDeployedWorkers] = useState<DeployedWorker[]>([])
  const [showAllStaff, setShowAllStaff] = useState(false)

  // Automatic advance deduction preview for the selected staff + period
  const [advancePreview, setAdvancePreview] = useState<AdvancePayrollPreview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  const yearOptions = useMemo(() => {
    const y = new Date().getFullYear()
    return Array.from({ length: 5 }, (_, i) => String(y - 2 + i))
  }, [])

  const setField = useCallback((patch: Partial<FormState>) => {
    setForm((f) => ({ ...f, ...patch }))
  }, [])

  // Load dropdown data + (re)initialize the form each time the dialog opens
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setOptionsLoading(true)
    Promise.all([
      fetchAllPages<StaffRow>('/api/staff', { status: 'active' }),
      fetchAllPages<ProjectRow>('/api/projects'),
    ])
      .then(([staff, projects]) => {
        if (cancelled) return
        setStaffOptions(staff)
        setProjectOptions(projects)
      })
      .catch(() => {
        if (!cancelled) toast.error('Failed to load staff and projects')
      })
      .finally(() => {
        if (!cancelled) setOptionsLoading(false)
      })

    if (editing) {
      setForm({
        staffId: editing.staff.id,
        projectId: editing.project?.id ?? 'none',
        month: String(editing.month),
        year: String(editing.year),
        totalHours: String(editing.totalHours),
        hourlyRate: String(editing.hourlyRateSnapshot),
        overtimeHours: String(editing.overtimeHours),
        overtimeRate: String(editing.overtimeRateSnapshot),
        otherEarnings: String(editing.otherEarnings),
        advance: String(editing.advance),
        absentPenalty: String(editing.absentPenalty),
        ptAmount: String(editing.ptAmount),
        unionFees: String(editing.unionFees),
        otherDeductionValue: String(editing.otherDeductionValue),
        otherDeductionType: editing.otherDeductionType,
        status: editing.status,
        payDate: toDateInputValue(editing.payDate),
        payType: editing.payType,
        taxCode: editing.taxCode ?? 'N/A',
      })
    } else {
      setForm(defaultForm(defaultPayType))
    }

    // Reset client scoping and fetch this client's deployed workers
    setShowAllStaff(false)
    if (clientFilterId) {
      fetchAllPages<DeployedWorker>('/api/deployments', {
        clientId: clientFilterId,
        assignment: 'assigned',
      })
        .then((rows) => {
          if (!cancelled) setDeployedWorkers(rows)
        })
        .catch(() => {
          if (!cancelled) setDeployedWorkers([])
        })
    } else {
      setDeployedWorkers([])
    }
    return () => {
      cancelled = true
    }
  }, [open, editing, defaultPayType, clientFilterId])

  const selectedStaff = useMemo(
    () => staffOptions.find((s) => s.id === form.staffId) ?? null,
    [staffOptions, form.staffId]
  )

  // Workers deployed to the active client — each shows their current project
  const deploymentByStaff = useMemo(() => {
    const m = new Map<string, string>()
    for (const w of deployedWorkers) {
      if (w.projectName && !m.has(w.id)) m.set(w.id, w.projectName)
    }
    return m
  }, [deployedWorkers])

  // Client scope active → only deployed workers (unless toggled to show all)
  const visibleStaff = useMemo(() => {
    if (!activeClientId || showAllStaff) return staffOptions
    const deployed = new Set(deployedWorkers.map((w) => w.id))
    return staffOptions.filter((s) => deployed.has(s.id))
  }, [staffOptions, activeClientId, showAllStaff, deployedWorkers])

  // Projects grouped by client company; the active client's group comes first
  const groupedProjects = useMemo(() => {
    type Group = { key: string; label: string; mine: boolean; projects: ProjectRow[] }
    const groups: Group[] = []
    const byKey = new Map<string, Group>()
    for (const p of projectOptions) {
      const key = p.clientId ?? '__none'
      let g = byKey.get(key)
      if (!g) {
        g = {
          key,
          label: p.clientName ?? 'No Client',
          mine: Boolean(activeClientId) && p.clientId === activeClientId,
          projects: [],
        }
        byKey.set(key, g)
        groups.push(g)
      }
      g.projects.push(p)
    }
    groups.sort((a, b) => {
      if (a.mine !== b.mine) return a.mine ? -1 : 1
      if (a.key === '__none') return 1
      if (b.key === '__none') return -1
      return a.label.localeCompare(b.label)
    })
    return groups
  }, [projectOptions, activeClientId])

  // Fetch the auto-deduction preview whenever staff + period are set
  useEffect(() => {
    if (!open || !form.staffId || !form.month || !form.year) {
      setAdvancePreview(null)
      return
    }
    let cancelled = false
    setPreviewLoading(true)
    api
      .get<AdvancePayrollPreview>(
        `/api/advances/payroll-preview${qs({
          staffId: form.staffId,
          month: form.month,
          year: form.year,
          excludePayrollId: editing?.id ?? '',
        })}`
      )
      .then((res) => {
        if (!cancelled) setAdvancePreview(res)
      })
      .catch(() => {
        if (!cancelled) setAdvancePreview(null)
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, form.staffId, form.month, form.year, editing])

  const autoAdvanceActive = Boolean(advancePreview && advancePreview.items.length > 0)

  /** Live calc helper — same pure function the server uses to recalculate. */
  function calcPayrollWith(advance: number) {
    return calcPayroll({
      totalHours: toNum(form.totalHours),
      hourlyRate: toNum(form.hourlyRate),
      overtimeHours: toNum(form.overtimeHours),
      overtimeRate: toNum(form.overtimeRate),
      otherEarnings: toNum(form.otherEarnings),
      advance,
      absentPenalty: toNum(form.absentPenalty),
      ptAmount: toNum(form.ptAmount),
      unionFees: toNum(form.unionFees),
      otherDeductionValue: toNum(form.otherDeductionValue),
      otherDeductionType: form.otherDeductionType,
    })
  }

  // Base calc without the advance — derives the salary room available for it.
  const calc0 = calcPayrollWith(0)
  const otherDeductionsLive =
    calc0.otherDeductionAmount +
    toNum(form.absentPenalty) +
    toNum(form.ptAmount) +
    toNum(form.unionFees)
  const advanceRoom = Math.max(0, round2(calc0.grossPay - otherDeductionsLive))

  // When worker advances match the period, their capped total REPLACES the
  // manual value (the field is locked); otherwise the manual value applies.
  const effectiveAdvance = autoAdvanceActive
    ? round2(Math.min(advancePreview!.total, advanceRoom))
    : toNum(form.advance)

  const calc = calcPayrollWith(effectiveAdvance)

  function handleSelectStaff(id: string) {
    const staff = staffOptions.find((s) => s.id === id)
    const deployment = activeClientId
      ? deployedWorkers.find((w) => w.id === id)
      : undefined
    setField({
      staffId: id,
      // Auto-fill editable rate snapshots from the staff profile
      hourlyRate: staff ? String(staff.ratePerHour) : form.hourlyRate,
      overtimeRate: staff ? String(staff.overtimeRate) : form.overtimeRate,
      // Convenience: preselect the worker's current project on this client
      ...(deployment?.projectId && form.projectId === 'none'
        ? { projectId: deployment.projectId }
        : {}),
    })
    setStaffOpen(false)
  }

  function handleStatusChange(v: string) {
    const status: PayrollStatus = v === 'paid' ? 'paid' : 'pending'
    setForm((f) => ({
      ...f,
      status,
      // Default the pay date to today when switching to Paid
      ...(status === 'paid' && !f.payDate ? { payDate: toDateInputValue(new Date()) } : {}),
    }))
  }

  async function fillHoursFromAttendance() {
    if (!form.staffId) return
    setFilling(true)
    try {
      const res = await api.get<{ totalMinutes: number; totalHours: number }>(
        `/api/attendance/hours${qs({ staffId: form.staffId, month: form.month, year: form.year })}`
      )
      if (res.totalHours > 0) {
        setField({ totalHours: String(round2(res.totalHours)) })
        toast.info(`Filled ${formatNumber(res.totalHours, 1)} hrs from attendance`)
      } else {
        toast.info('No attendance records found for this period')
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load attendance hours')
    } finally {
      setFilling(false)
    }
  }

  async function handleSubmit() {
    if (!form.staffId) {
      toast.error('Select a staff member first')
      return
    }
    setSubmitting(true)
    try {
      const body = {
        staffId: form.staffId,
        projectId: form.projectId === 'none' ? null : form.projectId,
        month: Number(form.month),
        year: Number(form.year),
        totalHours: toNum(form.totalHours),
        hourlyRate: toNum(form.hourlyRate),
        overtimeHours: toNum(form.overtimeHours),
        overtimeRate: toNum(form.overtimeRate),
        otherEarnings: toNum(form.otherEarnings),
        advance: round2(effectiveAdvance),
        absentPenalty: toNum(form.absentPenalty),
        ptAmount: toNum(form.ptAmount),
        unionFees: toNum(form.unionFees),
        otherDeductionValue: toNum(form.otherDeductionValue),
        otherDeductionType: form.otherDeductionType,
        status: form.status,
        payDate: form.payDate || null,
        payType: form.payType,
        taxCode: form.taxCode || 'N/A',
      }
      const res = editing
        ? await api.put<PayrollRow & { warning?: string; advanceApplied?: { count: number; total: number } }>(`/api/payrolls/${editing.id}`, body)
        : await api.post<PayrollRow & { warning?: string; advanceApplied?: { count: number; total: number } }>('/api/payrolls', body)
      toast.success(
        `${editing ? 'Payroll updated' : 'Payroll created'} — net ${formatMoney(res.netPay, currency)}`
      )
      if (res.advanceApplied && res.advanceApplied.count > 0) {
        toast.info(
          `Advance deduction applied: ${formatMoney(res.advanceApplied.total, currency)} from ${res.advanceApplied.count} worker advance${res.advanceApplied.count === 1 ? '' : 's'}`
        )
      }
      if (res.warning) toast.warning(res.warning)
      onSaved()
    } catch (e) {
      // 400 / 409 etc. carry friendly server messages
      toast.error(e instanceof Error ? e.message : 'Failed to save payroll')
    } finally {
      setSubmitting(false)
    }
  }

  const rateBadge = selectedStaff ? (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-gold/50 bg-gold-soft px-2 py-0.5 text-xs font-medium text-accent-foreground">
      Profile Rate: {formatNumber(selectedStaff.ratePerHour)}/hr
    </span>
  ) : editing ? (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-gold/50 bg-gold-soft px-2 py-0.5 text-xs font-medium text-accent-foreground">
      Snapshot Rate: {formatNumber(editing.hourlyRateSnapshot)}/hr
    </span>
  ) : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="nice-scrollbar max-h-[90vh] gap-5 overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit Payroll' : 'Create Payroll'}</DialogTitle>
          <DialogDescription>
            {editing
              ? `Update the payroll for ${editing.staff.fullName} — ${monthName(editing.month)} ${editing.year}. Gross, deductions and net pay are recalculated on save.`
              : activeClientId
                ? `Client view — ${clientFilterName}: pick from the workers deployed to this client. Totals are calculated automatically and re-verified by the server.`
                : 'Fill hours, rates and deductions. Gross, deductions and net pay are calculated automatically and re-verified by the server.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Staff + project + period */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label>Staff Member</Label>
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
                <PopoverContent className="w-[340px] p-0 sm:w-[420px]" align="start">
                  <Command>
                    <CommandInput placeholder="Search by name or IQAMA" />
                    <CommandList>
                      <CommandEmpty>
                        {activeClientId && !showAllStaff
                          ? `No workers deployed to ${clientFilterName ?? 'this client'} match this search.`
                          : 'No staff found.'}
                      </CommandEmpty>
                      {activeClientId ? (
                        <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
                          <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                            <Building2 className="h-3 w-3 shrink-0" />
                            <span className="truncate">
                              {deployedWorkers.length} deployed to{' '}
                              <span className="font-medium text-foreground">
                                {clientFilterName ?? 'this client'}
                              </span>
                            </span>
                          </p>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-6 shrink-0 px-2 text-[11px]"
                            onClick={() => setShowAllStaff((v) => !v)}
                          >
                            {showAllStaff ? 'Deployed only' : 'Show all staff'}
                          </Button>
                        </div>
                      ) : null}
                      <CommandGroup>
                        {visibleStaff.map((s) => {
                          const projectName = deploymentByStaff.get(s.id)
                          return (
                            <CommandItem
                              key={s.id}
                              value={`${s.fullName} ${s.iqamaId}`}
                              onSelect={() => handleSelectStaff(s.id)}
                            >
                              <Check
                                className={cn(
                                  'h-4 w-4',
                                  form.staffId === s.id ? 'opacity-100' : 'opacity-0'
                                )}
                              />
                              <span className="truncate">
                                {s.fullName} — IQAMA: {s.iqamaId}
                              </span>
                              <span className="ml-auto flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                                {projectName ? (
                                  <span
                                    className="max-w-[110px] truncate rounded-sm bg-muted px-1.5 py-0.5"
                                    title={projectName}
                                  >
                                    {projectName}
                                  </span>
                                ) : null}
                                <span className="tabular-nums">{formatNumber(s.ratePerHour)}/hr</span>
                              </span>
                            </CommandItem>
                          )
                        })}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              <div className="flex flex-wrap items-center gap-2">
                {rateBadge}
                {activeClientId && !editing ? (
                  <span className="inline-flex max-w-full items-center gap-1 rounded-md border border-primary/30 bg-primary/5 px-2 py-0.5 text-xs text-muted-foreground">
                    <Building2 className="h-3 w-3 shrink-0" />
                    <span className="truncate">
                      {showAllStaff
                        ? 'Showing all staff'
                        : `${visibleStaff.length} worker${visibleStaff.length === 1 ? '' : 's'} deployed to ${clientFilterName ?? 'this client'}`}
                    </span>
                  </span>
                ) : null}
                {editing ? (
                  <span className="text-xs text-muted-foreground">
                    Staff member is locked when editing an existing payroll.
                  </span>
                ) : null}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label>Project (optional)</Label>
                {activeClientId ? (
                  <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Building2 className="h-3 w-3" />
                    {clientFilterName} projects first
                  </span>
                ) : null}
              </div>
              <Select
                value={form.projectId}
                onValueChange={(v) => setField({ projectId: v })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select project" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No Project</SelectItem>
                  {groupedProjects.map((g) => (
                    <SelectGroup key={g.key}>
                      <SelectLabel className="text-xs font-medium text-muted-foreground">
                        {g.label}
                      </SelectLabel>
                      {g.projects.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Month</Label>
                <Select value={form.month} onValueChange={(v) => setField({ month: v })}>
                  <SelectTrigger className="w-full">
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
              </div>
              <div className="space-y-2">
                <Label>Year</Label>
                <Select value={form.year} onValueChange={(v) => setField({ year: v })}>
                  <SelectTrigger className="w-full">
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
            </div>
          </div>

          <Separator />

          {/* Hours, rates, earnings */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="payroll-total-hours">Total Hours Worked</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 px-2 text-xs text-primary hover:text-primary"
                  disabled={!form.staffId || filling}
                  onClick={fillHoursFromAttendance}
                >
                  {filling ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CalendarClock className="h-3.5 w-3.5" />
                  )}
                  Fill from attendance
                </Button>
              </div>
              <Input
                id="payroll-total-hours"
                type="number"
                inputMode="decimal"
                step={0.5}
                min={0}
                placeholder="0.00"
                value={form.totalHours}
                onChange={(e) => setField({ totalHours: e.target.value })}
              />
            </div>
            <NumberField
              id="payroll-overtime-hours"
              label="Overtime Hours"
              step={0.5}
              value={form.overtimeHours}
              onChange={(v) => setField({ overtimeHours: v })}
            />
            <NumberField
              id="payroll-hourly-rate"
              label="Hourly Rate"
              step={0.01}
              value={form.hourlyRate}
              onChange={(v) => setField({ hourlyRate: v })}
            />
            <NumberField
              id="payroll-overtime-rate"
              label="Overtime Rate"
              step={0.01}
              value={form.overtimeRate}
              onChange={(v) => setField({ overtimeRate: v })}
            />
            <NumberField
              id="payroll-other-earnings"
              label="Other Earnings"
              step={0.01}
              value={form.otherEarnings}
              onChange={(v) => setField({ otherEarnings: v })}
            />
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="payroll-advance">Advance Deduction</Label>
              <Input
                id="payroll-advance"
                type="number"
                inputMode="decimal"
                step={0.01}
                min={0}
                placeholder="0.00"
                value={autoAdvanceActive ? String(round2(effectiveAdvance)) : form.advance}
                onChange={(e) => setField({ advance: e.target.value })}
                disabled={autoAdvanceActive}
                className={cn(autoAdvanceActive && 'cursor-not-allowed opacity-80')}
              />
              {previewLoading ? (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Checking worker advances for {monthName(Number(form.month))} {form.year}…
                </p>
              ) : autoAdvanceActive && advancePreview ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
                  <p className="flex items-center gap-1.5 font-semibold">
                    <HandCoins className="h-3.5 w-3.5" />
                    Auto-applied from {advancePreview.items.length} worker advance
                    {advancePreview.items.length === 1 ? '' : 's'}
                  </p>
                  <ul className="mt-1.5 space-y-0.5">
                    {advancePreview.items.map((i) => (
                      <li key={i.advanceId} className="flex items-center justify-between gap-2">
                        <span className="font-mono">{i.reference}</span>
                        <span className="tabular-nums">
                          {formatMoney(i.scheduled, currency)}
                          {i.installments > 1 ? ` (installment ${i.installmentNo}/${i.installments})` : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {effectiveAdvance < advancePreview.total - 0.005 ? (
                    <p className="mt-1.5 border-t border-amber-200 pt-1.5 dark:border-amber-900">
                      Capped to the available salary ({formatMoney(advanceRoom, currency)}) —{' '}
                      {formatMoney(round2(advancePreview.total - effectiveAdvance), currency)} carries
                      to the next month.
                    </p>
                  ) : null}
                  <p className="mt-1.5 text-[11px] text-amber-700 dark:text-amber-400">
                    Managed in Worker Advances — edit the advance there, not here.
                  </p>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No scheduled worker advances for this period — enter a manual amount if needed.
                </p>
              )}
            </div>
            <NumberField
              id="payroll-absent-penalty"
              label="Absent Penalty"
              step={0.01}
              value={form.absentPenalty}
              onChange={(v) => setField({ absentPenalty: v })}
            />
            <NumberField
              id="payroll-pt"
              label="PT"
              step={0.01}
              value={form.ptAmount}
              onChange={(v) => setField({ ptAmount: v })}
            />
            <NumberField
              id="payroll-union-fees"
              label="Union Fees"
              step={0.01}
              value={form.unionFees}
              onChange={(v) => setField({ unionFees: v })}
            />

            {/* Other deductions with Fixed / % toggle */}
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="payroll-other-deduction">Other Deductions</Label>
              <div className="flex gap-2">
                <ToggleGroup
                  type="single"
                  variant="outline"
                  value={form.otherDeductionType}
                  onValueChange={(v) => {
                    if (v === 'fixed' || v === 'percent') setField({ otherDeductionType: v })
                  }}
                  className="h-10"
                >
                  <ToggleGroupItem value="fixed" className="px-4">
                    Fixed
                  </ToggleGroupItem>
                  <ToggleGroupItem value="percent" className="px-4">
                    % Percent
                  </ToggleGroupItem>
                </ToggleGroup>
                <Input
                  id="payroll-other-deduction"
                  type="number"
                  inputMode="decimal"
                  step={0.01}
                  min={0}
                  placeholder={form.otherDeductionType === 'percent' ? '0' : '0.00'}
                  className="flex-1"
                  value={form.otherDeductionValue}
                  onChange={(e) => setField({ otherDeductionValue: e.target.value })}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {form.otherDeductionType === 'percent'
                  ? `Calculated: ${formatNumber(calc.otherDeductionAmount)} (${String(toNum(form.otherDeductionValue))}% of Gross Pay)`
                  : `Calculated: ${formatNumber(calc.otherDeductionAmount)} (fixed)`}
              </p>
            </div>
          </div>

          {/* Live net pay summary */}
          <div className="rounded-xl border-2 border-primary/20 bg-primary/5 p-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 text-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Earnings
                </p>
                <CalcRow label="Regular" value={formatMoney(calc.regularPay, currency)} />
                <CalcRow label="Overtime" value={formatMoney(calc.overtimePay, currency)} />
                <CalcRow label="Other Earnings" value={formatMoney(toNum(form.otherEarnings), currency)} />
                <Separator className="my-1" />
                <CalcRow
                  label="Gross Pay"
                  value={formatMoney(calc.grossPay, currency)}
                  className="font-semibold"
                />
              </div>
              <div className="space-y-1.5 text-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Deductions
                </p>
                <CalcRow label="Advance Deduction" value={formatMoney(effectiveAdvance, currency)} />
                <CalcRow
                  label="Absent Penalty"
                  value={formatMoney(toNum(form.absentPenalty), currency)}
                />
                <CalcRow label="PT" value={formatMoney(toNum(form.ptAmount), currency)} />
                <CalcRow label="Union Fees" value={formatMoney(toNum(form.unionFees), currency)} />
                <CalcRow
                  label={
                    form.otherDeductionType === 'percent'
                      ? `Other (${String(toNum(form.otherDeductionValue))}%)`
                      : 'Other'
                  }
                  value={formatMoney(calc.otherDeductionAmount, currency)}
                />
                <Separator className="my-1" />
                <CalcRow
                  label="Total Deductions"
                  value={formatMoney(calc.totalDeductions, currency)}
                  className="font-semibold text-rose-700 dark:text-rose-400"
                />
              </div>
            </div>
            <div className="mt-4 flex items-center justify-between rounded-lg bg-primary px-4 py-3 text-primary-foreground">
              <span className="text-xs font-semibold uppercase tracking-wide sm:text-sm">
                Net Pay
              </span>
              <span className="text-2xl font-bold tabular-nums">
                {formatMoney(calc.netPay, currency)}
              </span>
            </div>
            {calc.negativeWarning ? (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                Net pay is negative — clamped to 0.00. Check the deduction values.
              </div>
            ) : null}
          </div>

          <Separator />

          {/* Payment details */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={handleStatusChange}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">
                    <span className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-amber-500" />
                      Pending
                    </span>
                  </SelectItem>
                  <SelectItem value="paid">
                    <span className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-emerald-500" />
                      Paid
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="payroll-pay-date">Pay Date</Label>
              <Input
                id="payroll-pay-date"
                type="date"
                value={form.payDate}
                onChange={(e) => setField({ payDate: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Pay Type</Label>
              <Select
                value={form.payType}
                onValueChange={(v) => setField({ payType: v as PayType })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(PAY_TYPE_LABELS) as PayType[]).map((t) => (
                    <SelectItem key={t} value={t}>
                      {PAY_TYPE_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="payroll-tax-code">Tax Code</Label>
              <Input
                id="payroll-tax-code"
                placeholder="N/A"
                value={form.taxCode}
                onChange={(e) => setField({ taxCode: e.target.value })}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || !form.staffId}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {editing ? 'Save Changes' : 'Create Payroll'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function NumberField({
  id,
  label,
  value,
  onChange,
  step = 0.01,
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  step?: number
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        step={step}
        min={0}
        placeholder="0.00"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}

function CalcRow({
  label,
  value,
  className,
}: {
  label: string
  value: string
  className?: string
}) {
  return (
    <div className={cn('flex items-center justify-between gap-3', className)}>
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  )
}

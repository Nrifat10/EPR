'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  Activity,
  ArrowLeftRight,
  Banknote,
  Building2,
  CalendarClock,
  Download,
  FolderKanban,
  HandCoins,
  History,
  Loader2,
  LogIn,
  Percent,
  Pencil,
  Plus,
  ScrollText,
  Trash2,
  UserPlus,
  UsersRound,
  Wallet,
  X,
} from 'lucide-react'
import { buildCsv, csvFilename, downloadCsv } from '@/lib/csv'
import { api, qs } from '@/lib/api-client'
import { useAppStore } from '@/lib/store'
import { formatDateTime, formatMoney, initials } from '@/lib/format'
import { useDebounce } from '@/hooks/use-debounce'
import type { ActivityRow, Paginated } from '@/lib/types'
import { PageHeader, SectionCard } from '@/components/app/shared/page-header'
import { FilterBar, FilterSelect, SearchInput } from '@/components/app/shared/filter-select'
import { DataTablePagination } from '@/components/app/shared/data-table-pagination'
import { EmptyState, TableSkeleton } from '@/components/app/shared/empty-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'

/** Human labels for the module codes written by logActivity(). */
const MODULE_LABELS: Record<string, string> = {
  payroll: 'Payroll',
  advance: 'Worker Advances',
  transaction: 'Transactions',
  transaction_category: 'Transaction Categories',
  vat_return: 'VAT Return Expense',
  staff: 'Staff',
  staff_category: 'Staff Categories',
  attendance: 'Attendance',
  project: 'Projects',
  client: 'Clients',
  user: 'Users',
  role: 'Roles',
  settings: 'Settings',
  quotation: 'Quotations',
  invoice: 'Invoices',
  namelist: 'Name List',
  supplier_po: 'Supplier P.O.',
  agreement: 'Agreements',
}

const MODULE_OPTIONS = Object.entries(MODULE_LABELS).map(([value, label]) => ({ value, label }))

const ACTION_OPTIONS = [
  { value: 'created', label: 'Created' },
  { value: 'updated', label: 'Updated' },
  { value: 'deleted', label: 'Deleted' },
  { value: 'paid', label: 'Marked Paid' },
  { value: 'login', label: 'Login' },
  { value: 'export', label: 'Export' },
]

const ACTION_LABELS: Record<string, string> = {
  created: 'Created',
  updated: 'Updated',
  deleted: 'Deleted',
  paid: 'Paid',
  login: 'Login',
  export: 'Exported',
}

/** Badge styling per action — soft tinted pills, WCAG-AA text. */
function actionBadgeClasses(action: string): string {
  switch (action) {
    case 'created':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-400'
    case 'updated':
      return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400'
    case 'deleted':
      return 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-400'
    case 'paid':
      return 'border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-900 dark:text-emerald-300'
    case 'login':
      return 'border-primary/30 bg-primary/10 text-primary dark:bg-primary/20 dark:text-primary'
    case 'export':
      return 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900 dark:bg-violet-950 dark:text-violet-300'
    default:
      return 'border-border bg-muted text-muted-foreground'
  }
}

/** Relative time for recent entries ("2h ago"), absolute otherwise. Tooltip always absolute. */
function formatActivityTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 0 || ms > 24 * 60 * 60 * 1000) return formatDateTime(iso)
  const minutes = Math.floor(ms / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ago`
}

function ActionIcon({ action, className }: { action: string; className?: string }) {
  switch (action) {
    case 'created':
      return <Plus className={className} />
    case 'updated':
      return <Pencil className={className} />
    case 'deleted':
      return <Trash2 className={className} />
    case 'paid':
      return <Banknote className={className} />
    case 'login':
      return <LogIn className={className} />
    case 'export':
      return <Download className={className} />
    default:
      return <Activity className={className} />
  }
}

/** Module icon (kept static like the dashboard feed icons). */
function ModuleIcon({ module, className }: { module: string; className?: string }) {
  switch (module) {
    case 'payroll':
      return <Wallet className={className} />
    case 'advance':
      return <HandCoins className={className} />
    case 'transaction':
    case 'transaction_category':
      return <ArrowLeftRight className={className} />
    case 'vat_return':
      return <Percent className={className} />
    case 'staff':
    case 'staff_category':
      return <UserPlus className={className} />
    case 'project':
      return <FolderKanban className={className} />
    case 'client':
      return <Building2 className={className} />
    case 'user':
    case 'role':
      return <UsersRound className={className} />
    default:
      return <Activity className={className} />
  }
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

type ActivityTotals = {
  today: number
  week: number
  moneyEvents: number
}

export function ActivityLogView() {
  const { settings } = useAppStore()
  const currency = settings.currency || 'SAR'

  // List state
  const [rows, setRows] = useState<ActivityRow[]>([])
  const [totals, setTotals] = useState<ActivityTotals | null>(null)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)

  // Filters
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search)
  const [moduleFilter, setModuleFilter] = useState('all')
  const [actionFilter, setActionFilter] = useState('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)

  // CSV export busy state
  const [exporting, setExporting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get<Paginated<ActivityRow> & { totals?: ActivityTotals }>(
        `/api/activity${qs({
          search: debouncedSearch,
          module: moduleFilter === 'all' ? null : moduleFilter,
          action: actionFilter === 'all' ? null : actionFilter,
          from: from || null,
          to: to || null,
          page,
          pageSize,
        })}`
      )
      setRows(res.data)
      setTotal(res.total)
      setTotalPages(res.totalPages)
      setTotals(res.totals ?? null)
      if (res.page > res.totalPages && res.totalPages > 0) setPage(res.totalPages)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load activity log')
    } finally {
      setLoading(false)
    }
  }, [debouncedSearch, moduleFilter, actionFilter, from, to, page, pageSize])

  // Reset to first page whenever filters change
  useEffect(() => {
    setPage(1)
  }, [debouncedSearch, moduleFilter, actionFilter, from, to])

  useEffect(() => {
    void load()
  }, [load])

  const hasFilters =
    Boolean(debouncedSearch) ||
    moduleFilter !== 'all' ||
    actionFilter !== 'all' ||
    Boolean(from) ||
    Boolean(to)

  function clearFilters() {
    setSearch('')
    setModuleFilter('all')
    setActionFilter('all')
    setFrom('')
    setTo('')
  }

  // Non-search filters applied — drives the mobile "Filters" badge count
  const activeFilterCount =
    (moduleFilter !== 'all' ? 1 : 0) +
    (actionFilter !== 'all' ? 1 : 0) +
    (from ? 1 : 0) +
    (to ? 1 : 0)

  /** Export every entry matching the CURRENT filters to CSV (walks pages server-side). */
  async function handleExportCsv() {
    setExporting(true)
    try {
      const all: ActivityRow[] = []
      let p = 1
      for (;;) {
        const res = await api.get<Paginated<ActivityRow>>(
          `/api/activity${qs({
            search: debouncedSearch,
            module: moduleFilter === 'all' ? null : moduleFilter,
            action: actionFilter === 'all' ? null : actionFilter,
            from: from || null,
            to: to || null,
            page: p,
            pageSize: 100,
          })}`
        )
        all.push(...res.data)
        if (p >= res.totalPages || res.data.length === 0) break
        p += 1
      }
      if (all.length === 0) {
        toast.info('No activity entries match the current filters')
        return
      }
      const csv = buildCsv(
        ['Time', 'User', 'Action', 'Module', 'Description', 'Amount'],
        all.map((r) => [
          formatDateTime(r.createdAt),
          r.userName ?? 'System',
          ACTION_LABELS[r.action] ?? r.action,
          MODULE_LABELS[r.module] ?? r.module,
          r.description,
          r.amount != null ? r.amount.toFixed(2) : '',
        ])
      )
      const range = from || to ? `${from || 'start'}-to-${to || 'now'}` : 'all-dates'
      downloadCsv(csvFilename('activity-log', range), csv)
      toast.success(`Exported ${all.length} activity entries to CSV`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  const chips = useMemo(
    () => [
      {
        icon: ScrollText,
        label: 'Total Entries',
        value: total.toLocaleString(),
        tone: 'text-primary',
      },
      {
        icon: CalendarClock,
        label: 'Today',
        value: (totals?.today ?? 0).toLocaleString(),
        tone: 'text-amber-600 dark:text-amber-400',
      },
      {
        icon: History,
        label: 'Last 7 Days',
        value: (totals?.week ?? 0).toLocaleString(),
        tone: 'text-emerald-700 dark:text-emerald-400',
      },
      {
        icon: Banknote,
        label: 'Money Events',
        value: (totals?.moneyEvents ?? 0).toLocaleString(),
        tone: 'text-rose-700 dark:text-rose-400',
      },
    ],
    [total, totals]
  )

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title="Activity Log"
        description="Complete audit trail of every action recorded across the system"
      >
        <Button
          variant="outline"
          onClick={() => void handleExportCsv()}
          disabled={exporting || loading}
        >
          {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          Export CSV
        </Button>
      </PageHeader>

      {/* Summary chips */}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-2 lg:grid-cols-4 sm:gap-3">
        {chips.map((c) => (
          <SummaryChip key={c.label} icon={c.icon} label={c.label} value={c.value} tone={c.tone} />
        ))}
      </div>

      <SectionCard>
        <div className="p-4">
          <FilterBar
            search={
              <SearchInput
                value={search}
                onChange={setSearch}
                placeholder="Search description or user..."
                className="w-full sm:w-[260px]"
              />
            }
            activeCount={activeFilterCount}
          >
            <FilterSelect
              value={moduleFilter}
              onChange={setModuleFilter}
              options={MODULE_OPTIONS}
              placeholder="Module"
              emptyLabel="All Modules"
              className="w-full sm:w-[200px]"
            />
            <FilterSelect
              value={actionFilter}
              onChange={setActionFilter}
              options={ACTION_OPTIONS}
              placeholder="Action"
              emptyLabel="All Actions"
              className="w-full sm:w-[160px]"
            />
            <div className="flex items-center gap-2">
              <Input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="h-9 w-full sm:w-[150px]"
                aria-label="From date"
              />
              <span className="text-sm text-muted-foreground">to</span>
              <Input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="h-9 w-full sm:w-[150px]"
                aria-label="To date"
              />
            </div>
            {hasFilters ? (
              <Button variant="ghost" size="sm" className="h-9 text-muted-foreground" onClick={clearFilters}>
                <X className="h-4 w-4" />
                Clear
              </Button>
            ) : null}
          </FilterBar>
        </div>

        {loading ? (
          <TableSkeleton rows={8} cols={6} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={hasFilters ? History : ScrollText}
            title={hasFilters ? 'No activity entries found' : 'No activity recorded yet'}
            description={
              hasFilters
                ? 'Try adjusting or clearing the filters to see more results.'
                : 'Actions performed across the system will appear here as they happen.'
            }
            action={
              hasFilters ? (
                <Button variant="outline" onClick={clearFilters}>
                  Clear Filters
                </Button>
              ) : null
            }
          />
        ) : (
          <>
            {/* Mobile: stacked cards */}
            <ul className="space-y-3 p-4 sm:p-6 md:hidden print:hidden">
              {rows.map((row, i) => {
                // Continuation: same user as the previous entry → skip the name (audit-log pattern)
                const continued = i > 0 && rows[i - 1].userName === row.userName
                return (
                <li key={row.id} className="rounded-xl border bg-card p-3.5 shadow-sm">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                      <ModuleIcon module={row.module} className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="line-clamp-2 text-sm font-medium leading-snug">{row.description}</p>
                        {row.amount != null ? (
                          <span className="shrink-0 text-sm font-semibold tabular-nums text-rose-700 dark:text-rose-400">
                            {formatMoney(-Math.abs(row.amount), currency)}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <span
                          className={cn(
                            'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold',
                            actionBadgeClasses(row.action)
                          )}
                        >
                          <ActionIcon action={row.action} className="h-3 w-3" />
                          {ACTION_LABELS[row.action] ?? row.action}
                        </span>
                        <span className="inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                          {MODULE_LABELS[row.module] ?? row.module}
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground" title={formatDateTime(row.createdAt)}>
                        {continued ? (
                          <span className="mr-1.5 inline-block text-muted-foreground/60">↳</span>
                        ) : (
                          <span className="font-medium text-foreground/80">{row.userName ?? 'System'}</span>
                        )}
                        {' · '}
                        {formatActivityTime(row.createdAt)}
                      </p>
                    </div>
                  </div>
                </li>
                )
              })}
            </ul>

            {/* Desktop: table */}
            <div className="hidden overflow-x-auto md:block print:block" data-fade-right="">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[160px]">Time</TableHead>
                    <TableHead className="w-[180px]">User</TableHead>
                    <TableHead className="w-[120px]">Action</TableHead>
                    <TableHead className="w-[170px]">Module</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="w-[130px] text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row, i) => {
                    // Continuation: same user as the previous entry → dimmed ↳ instead of repeating (audit-log pattern)
                    const continued = i > 0 && rows[i - 1].userName === row.userName
                    return (
                    <TableRow key={row.id}>
                      <TableCell
                        className="whitespace-nowrap text-sm text-muted-foreground tabular-nums"
                        title={formatDateTime(row.createdAt)}
                      >
                        {formatActivityTime(row.createdAt)}
                      </TableCell>
                      <TableCell>
                        {continued ? (
                          <span
                            className="pl-3.5 text-sm text-muted-foreground/50"
                            title={`Same user as above — ${row.userName ?? 'System'}`}
                          >
                            ↳
                          </span>
                        ) : (
                          <div className="flex items-center gap-2.5">
                            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">
                              {initials(row.userName)}
                            </span>
                            <span className="max-w-[120px] truncate text-sm font-medium">
                              {row.userName ?? 'System'}
                            </span>
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <span
                          className={cn(
                            'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-semibold',
                            actionBadgeClasses(row.action)
                          )}
                        >
                          <ActionIcon action={row.action} className="h-3 w-3" />
                          {ACTION_LABELS[row.action] ?? row.action}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                          <ModuleIcon module={row.module} className="h-3 w-3" />
                          {MODULE_LABELS[row.module] ?? row.module}
                        </span>
                      </TableCell>
                      <TableCell className="max-w-[420px]">
                        <p className="truncate text-sm" title={row.description}>
                          {row.description}
                        </p>
                      </TableCell>
                      <TableCell className="text-right">
                        {row.amount != null ? (
                          <span className="text-sm font-semibold tabular-nums text-rose-700 dark:text-rose-400">
                            {formatMoney(-Math.abs(row.amount), currency)}
                          </span>
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>

            <DataTablePagination
              page={page}
              pageSize={pageSize}
              total={total}
              totalPages={totalPages}
              onPageChange={setPage}
              onPageSizeChange={(s) => {
                setPageSize(s)
                setPage(1)
              }}
              unit="entries"
            />
          </>
        )}
      </SectionCard>
    </div>
  )
}

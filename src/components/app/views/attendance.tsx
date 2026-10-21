'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock,
  Download,
  Filter,
  Loader2,
  LogOut,
  Pencil,
  Plus,
  Timer,
  Users,
  X,
} from 'lucide-react'
import { buildCsv, csvFilename, downloadCsv } from '@/lib/csv'
import { api, qs } from '@/lib/api-client'
import { can, useAppStore } from '@/lib/store'
import { dateTimeLocalToISO, formatDateTime, formatDuration, isoToDateTimeLocal } from '@/lib/format'
import { useDebounce } from '@/hooks/use-debounce'
import { useViewIntent } from '@/hooks/use-view-intent'
import type { AttendanceRow, AttendanceStats, Paginated, ProjectRow, StaffRow } from '@/lib/types'
import { PageHeader, SectionCard, MobileFab } from '@/components/app/shared/page-header'
import { FilterBar, FilterSelect, SearchInput } from '@/components/app/shared/filter-select'
import { AvatarInitials } from '@/components/app/shared/avatar-initials'
import { ConfirmDelete } from '@/components/app/shared/confirm-delete'
import { DataTablePagination } from '@/components/app/shared/data-table-pagination'
import { EmptyState, TableSkeleton } from '@/components/app/shared/empty-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

type AttendanceForm = {
  staffId: string
  projectId: string
  checkIn: string
  checkOut: string
}

const EMPTY_FORM: AttendanceForm = {
  staffId: '',
  projectId: '',
  checkIn: '',
  checkOut: '',
}

function staffLabel(s: { fullName: string; iqamaId: string }): string {
  return `${s.fullName} — IQAMA: ${s.iqamaId}`
}

export function AttendanceView() {
  const { user } = useAppStore()

  // List state
  const [rows, setRows] = useState<AttendanceRow[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)

  // Filters
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search)
  const [staffFilter, setStaffFilter] = useState('all')
  const [projectFilter, setProjectFilter] = useState('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)

  // Reference data
  const [staffOptions, setStaffOptions] = useState<StaffRow[]>([])
  const [projectOptions, setProjectOptions] = useState<ProjectRow[]>([])

  // Add/Edit dialog
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<AttendanceRow | null>(null)
  const [form, setForm] = useState<AttendanceForm>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  // Quick check-out busy state (one row at a time)
  const [checkingOutId, setCheckingOutId] = useState<string | null>(null)

  // CSV export busy state
  const [exporting, setExporting] = useState(false)

  // Monthly KPI header — null month/year targets the latest month with records
  const [statsMonth, setStatsMonth] = useState<number | null>(null)
  const [statsYear, setStatsYear] = useState<number | null>(null)
  const [stats, setStats] = useState<AttendanceStats | null>(null)
  const [statsLoading, setStatsLoading] = useState(true)

  const loadStats = useCallback(async () => {
    const params =
      statsMonth !== null && statsYear !== null ? `?month=${statsMonth}&year=${statsYear}` : ''
    setStatsLoading(true)
    try {
      const res = await api.get<AttendanceStats>(`/api/attendance/stats${params}`)
      setStats(res)
    } catch {
      // Non-blocking: the list below remains fully usable
      setStats(null)
    } finally {
      setStatsLoading(false)
    }
  }, [statsMonth, statsYear])

  useEffect(() => {
    void loadStats()
  }, [loadStats])

  function stepMonth(delta: number) {
    const base = stats ?? { month: new Date().getMonth() + 1, year: new Date().getFullYear() }
    let m = base.month - 1 + delta
    let y = base.year
    while (m < 0) {
      m += 12
      y -= 1
    }
    while (m > 11) {
      m -= 12
      y += 1
    }
    setStatsMonth(m + 1)
    setStatsYear(y)
  }

  /** Point the table's date filters at the KPI month (from 1st to month end) */
  function applyStatsMonthToFilters() {
    if (!stats) return
    const pad = (n: number) => String(n).padStart(2, '0')
    const lastDay = new Date(stats.year, stats.month, 0).getDate()
    setFrom(`${stats.year}-${pad(stats.month)}-01`)
    setTo(`${stats.year}-${pad(stats.month)}-${pad(lastDay)}`)
  }

  // Deep-open the create dialog when arriving via the command palette
  const shouldOpenCreate = useViewIntent('attendance', 'create')
  useEffect(() => {
    if (shouldOpenCreate) openCreate()
  }, [shouldOpenCreate])

  const setField = <K extends keyof AttendanceForm>(key: K, value: AttendanceForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get<Paginated<AttendanceRow>>(
        `/api/attendance${qs({
          search: debouncedSearch,
          staffId: staffFilter === 'all' ? null : staffFilter,
          projectId: projectFilter === 'all' ? null : projectFilter,
          from: from || null,
          to: to || null,
          page,
          pageSize,
        })}`
      )
      setRows(res.data)
      setTotal(res.total)
      setTotalPages(res.totalPages)
      if (res.page > res.totalPages && res.totalPages > 0) setPage(res.totalPages)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load attendance records')
    } finally {
      setLoading(false)
    }
  }, [debouncedSearch, staffFilter, projectFilter, from, to, page, pageSize])

  // Reset to first page whenever filters change
  useEffect(() => {
    setPage(1)
  }, [debouncedSearch, staffFilter, projectFilter, from, to])

  useEffect(() => {
    void load()
  }, [load])

  // Reference data for filters + form
  const loadOptions = useCallback(async () => {
    try {
      const [st, pr] = await Promise.all([
        api.get<Paginated<StaffRow>>('/api/staff?pageSize=100'),
        api.get<Paginated<ProjectRow>>('/api/projects?pageSize=100'),
      ])
      setStaffOptions(st.data)
      setProjectOptions(pr.data)
    } catch {
      // non-fatal — selects keep previous data
    }
  }, [])

  useEffect(() => {
    void loadOptions()
  }, [loadOptions])

  function openCreate() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setFormOpen(true)
    void loadOptions()
  }

  function openEdit(row: AttendanceRow) {
    setEditing(row)
    setForm({
      staffId: row.staff.id,
      projectId: row.project?.id ?? '',
      checkIn: isoToDateTimeLocal(row.checkIn),
      checkOut: isoToDateTimeLocal(row.checkOut),
    })
    setFormOpen(true)
    void loadOptions()
  }

  // Live duration preview while both timestamps are set
  const previewMinutes = useMemo(() => {
    if (!form.checkIn || !form.checkOut) return null
    const a = new Date(form.checkIn).getTime()
    const b = new Date(form.checkOut).getTime()
    if (isNaN(a) || isNaN(b) || b <= a) return null
    return Math.round((b - a) / 60000)
  }, [form.checkIn, form.checkOut])

  async function handleSubmit() {
    if (!form.staffId) {
      toast.error('Please select a staff member')
      return
    }
    if (!form.checkIn) {
      toast.error('Check-in date & time is required')
      return
    }
    const checkInMs = new Date(form.checkIn).getTime()
    const checkOutMs = form.checkOut ? new Date(form.checkOut).getTime() : null
    if (checkOutMs !== null && !isNaN(checkInMs) && checkOutMs <= checkInMs) {
      toast.error('Check-out must be after check-in')
      return
    }
    setSaving(true)
    try {
      const payload = {
        staffId: form.staffId,
        projectId: form.projectId || null,
        checkIn: dateTimeLocalToISO(form.checkIn),
        checkOut: form.checkOut ? dateTimeLocalToISO(form.checkOut) : null,
      }
      if (editing) {
        await api.put(`/api/attendance/${editing.id}`, payload)
        toast.success('Attendance record updated')
      } else {
        await api.post('/api/attendance', payload)
        toast.success('Attendance marked')
      }
      setFormOpen(false)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save attendance record')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(row: AttendanceRow) {
    try {
      await api.del(`/api/attendance/${row.id}`)
      toast.success('Attendance record deleted')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete attendance record')
    }
  }

  // Quick action: close an open session with the server clock
  async function handleQuickCheckout(row: AttendanceRow) {
    setCheckingOutId(row.id)
    try {
      const updated = await api.post<AttendanceRow>(`/api/attendance/${row.id}/checkout`, {})
      toast.success(
        `Checked out ${row.staff.fullName} · ${formatDuration(updated.durationMinutes)}`
      )
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to check out')
    } finally {
      setCheckingOutId(null)
    }
  }

  const hasFilters =
    Boolean(debouncedSearch) ||
    staffFilter !== 'all' ||
    projectFilter !== 'all' ||
    Boolean(from) ||
    Boolean(to)

  function clearFilters() {
    setSearch('')
    setStaffFilter('all')
    setProjectFilter('all')
    setFrom('')
    setTo('')
  }

  const canCreate = can(user, 'attendance.create')
  const canEdit = can(user, 'attendance.edit')
  const canDelete = can(user, 'attendance.delete')

  // Non-search filters applied — drives the mobile "Filters" badge count
  const activeFilterCount =
    (staffFilter !== 'all' ? 1 : 0) +
    (projectFilter !== 'all' ? 1 : 0) +
    (from ? 1 : 0) +
    (to ? 1 : 0)

  /** Export every record matching the CURRENT filters to CSV (walks pages server-side). */
  async function handleExportCsv() {
    setExporting(true)
    try {
      const all: AttendanceRow[] = []
      let p = 1
      for (;;) {
        const res = await api.get<Paginated<AttendanceRow>>(
          `/api/attendance${qs({
            search: debouncedSearch,
            staffId: staffFilter === 'all' ? null : staffFilter,
            projectId: projectFilter === 'all' ? null : projectFilter,
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
        toast.info('No attendance records match the current filters')
        return
      }
      const csv = buildCsv(
        ['Staff', 'IQAMA', 'Project', 'Check-In', 'Check-Out', 'Duration', 'Hours (decimal)', 'Status'],
        all.map((r) => [
          r.staff.fullName,
          r.staff.iqamaId,
          r.project?.name ?? '',
          formatDateTime(r.checkIn),
          r.checkOut ? formatDateTime(r.checkOut) : '',
          formatDuration(r.durationMinutes),
          r.durationMinutes != null ? (r.durationMinutes / 60).toFixed(2) : '',
          r.checkOut ? 'Completed' : 'Open',
        ])
      )
      const range =
        from || to ? `${from || 'start'}-to-${to || 'now'}` : 'all-dates'
      downloadCsv(csvFilename('attendance', range), csv)
      toast.success(`Exported ${all.length} attendance records to CSV`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  const staffFilterOptions = useMemo(
    () => staffOptions.map((s) => ({ value: s.id, label: staffLabel(s) })),
    [staffOptions]
  )
  const projectFilterOptions = useMemo(
    () => projectOptions.map((p) => ({ value: p.id, label: p.name })),
    [projectOptions]
  )

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader title="Staff Attendance" description="Daily check-in &amp; check-out records">
        <Button
          variant="outline"
          onClick={() => void handleExportCsv()}
          disabled={exporting || loading}
        >
          {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          Export CSV
        </Button>
        {canCreate ? (
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" />
            Mark Attendance
          </Button>
        ) : null}
      </PageHeader>

      {canCreate ? <MobileFab label="Mark Attendance" onClick={openCreate} icon={Plus} /> : null}

      {/* Monthly KPI header */}
      <SectionCard className="overflow-hidden">
        <div className="flex flex-col gap-2 border-b p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div className="flex items-center gap-2">
            <CalendarRange className="h-4 w-4 text-primary" />
            <h2 className="text-base font-semibold">This Month at a Glance</h2>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => stepMonth(-1)}
              disabled={statsLoading && !stats}
              aria-label="Previous month"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="inline-flex min-w-[130px] items-center justify-center gap-1.5 rounded-md border bg-muted/40 px-2.5 py-1.5 text-sm font-medium tabular-nums">
              {statsLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" /> : null}
              {stats?.label ?? '—'}
            </span>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => stepMonth(1)}
              disabled={statsLoading && !stats}
              aria-label="Next month"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            {stats ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs text-muted-foreground"
                onClick={applyStatsMonthToFilters}
                title="Set the table date filters to this month"
              >
                <ClipboardList className="h-3.5 w-3.5" />
                Filter table
              </Button>
            ) : null}
          </div>
        </div>
        {statsLoading && !stats ? (
          <div className="grid grid-cols-2 gap-px bg-border xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-card p-4 sm:p-5">
                <div className="h-3 w-20 animate-pulse rounded bg-muted" />
                <div className="mt-2.5 h-6 w-24 animate-pulse rounded bg-muted" />
              </div>
            ))}
          </div>
        ) : stats ? (
          <div className="grid grid-cols-2 gap-px bg-border xl:grid-cols-4">
            <button
              type="button"
              onClick={applyStatsMonthToFilters}
              title="Apply this month to the table date filters"
              aria-label="Apply this month to the table date filters"
              className="group bg-card p-4 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset sm:p-5"
            >
              <div className="flex items-center justify-between gap-1.5 text-xs font-medium text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <CalendarCheck className="h-3.5 w-3.5" />
                  Sessions
                </span>
                <Filter className="h-3 w-3 text-muted-foreground/40 transition-colors group-hover:text-primary" />
              </div>
              <p className="mt-1.5 text-xl font-bold tabular-nums sm:text-2xl">
                {stats.totalSessions.toLocaleString()}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">check-ins recorded</p>
            </button>
            <button
              type="button"
              onClick={applyStatsMonthToFilters}
              title="Apply this month to the table date filters"
              aria-label="Apply this month to the table date filters"
              className="group bg-card p-4 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset sm:p-5"
            >
              <div className="flex items-center justify-between gap-1.5 text-xs font-medium text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5" />
                  Hours Logged
                </span>
                <Filter className="h-3 w-3 text-muted-foreground/40 transition-colors group-hover:text-primary" />
              </div>
              <p className="mt-1.5 text-xl font-bold tabular-nums sm:text-2xl">
                {stats.totalHours.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                <span className="ml-1 text-sm font-semibold text-muted-foreground">h</span>
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                avg {formatDuration(stats.avgSessionMinutes)} / session
              </p>
            </button>
            <button
              type="button"
              onClick={applyStatsMonthToFilters}
              title="Apply this month to the table date filters"
              aria-label="Apply this month to the table date filters"
              className="group bg-card p-4 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset sm:p-5"
            >
              <div className="flex items-center justify-between gap-1.5 text-xs font-medium text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5" />
                  Staff On Site
                </span>
                <Filter className="h-3 w-3 text-muted-foreground/40 transition-colors group-hover:text-primary" />
              </div>
              <p className="mt-1.5 text-xl font-bold tabular-nums sm:text-2xl">
                {stats.distinctStaff.toLocaleString()}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">unique members</p>
            </button>
            <button
              type="button"
              onClick={applyStatsMonthToFilters}
              title="Apply this month to the table date filters"
              aria-label="Apply this month to the table date filters"
              className="group bg-card p-4 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset sm:p-5"
            >
              <div className="flex items-center justify-between gap-1.5 text-xs font-medium text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <LogOut className="h-3.5 w-3.5" />
                  Open Sessions
                </span>
                <Filter className="h-3 w-3 text-muted-foreground/40 transition-colors group-hover:text-primary" />
              </div>
              <p
                className={
                  'mt-1.5 text-xl font-bold tabular-nums sm:text-2xl ' +
                  (stats.openSessions > 0
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-emerald-700 dark:text-emerald-400')
                }
              >
                {stats.openSessions.toLocaleString()}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {stats.openSessions > 0 ? 'awaiting check-out' : 'all sessions closed'}
              </p>
            </button>
          </div>
        ) : (
          <div className="p-4 text-sm text-muted-foreground">
            Monthly stats are unavailable right now.
          </div>
        )}
      </SectionCard>

      <SectionCard>
        <div className="p-4">
          <FilterBar
            search={
              <SearchInput
                value={search}
                onChange={setSearch}
                placeholder="Search staff name or IQAMA..."
                className="w-full sm:w-[240px]"
              />
            }
            activeCount={activeFilterCount}
          >
            <FilterSelect
              value={staffFilter}
              onChange={setStaffFilter}
              options={staffFilterOptions}
              placeholder="Staff"
              emptyLabel="All Staff"
              className="w-full sm:w-[220px]"
            />
            <FilterSelect
              value={projectFilter}
              onChange={setProjectFilter}
              options={projectFilterOptions}
              placeholder="Project"
              emptyLabel="All Projects"
              className="w-full sm:w-[180px]"
            />
            <div className="flex items-center gap-2">
              <div className="relative">
                <Input
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  className="h-9 w-full sm:w-[150px]"
                  aria-label="From date"
                />
              </div>
              <span className="text-sm text-muted-foreground">to</span>
              <div className="relative">
                <Input
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  className="h-9 w-full sm:w-[150px]"
                  aria-label="To date"
                />
              </div>
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
          <TableSkeleton rows={6} cols={6} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={hasFilters ? CalendarClock : ClipboardList}
            title={hasFilters ? 'No attendance records found' : 'No attendance records yet'}
            description={
              hasFilters
                ? 'Try adjusting or clearing the filters to see more results.'
                : 'Mark the first attendance record to start tracking work hours.'
            }
            action={
              hasFilters ? (
                <Button variant="outline" onClick={clearFilters}>
                  Clear Filters
                </Button>
              ) : canCreate ? (
                <Button onClick={openCreate}>
                  <Plus className="h-4 w-4" />
                  Mark Attendance
                </Button>
              ) : null
            }
          />
        ) : (
          <>
            {/* Mobile: stacked cards — a wide table is unreadable at <md widths */}
            <ul className="space-y-3 p-4 sm:p-6 md:hidden print:hidden">
              {rows.map((row) => (
                <li
                  key={row.id}
                  className="rounded-xl border bg-card p-3 shadow-sm transition-colors hover:bg-muted/30"
                >
                  <div className="flex items-start gap-3">
                    <AvatarInitials
                      name={row.staff.fullName}
                      src={staffOptions.find((s) => s.id === row.staff.id)?.profilePhoto ?? null}
                      size="sm"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold leading-snug">{row.staff.fullName}</p>
                      <p className="text-xs text-muted-foreground tabular-nums">
                        IQAMA: {row.staff.iqamaId}
                      </p>
                    </div>
                    <span className="flex shrink-0 items-center gap-1 text-sm font-bold tabular-nums">
                      <Timer className="h-3.5 w-3.5 text-muted-foreground" />
                      {formatDuration(row.durationMinutes)}
                    </span>
                  </div>
                  <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
                    {row.project ? (
                      <Badge
                        variant="secondary"
                        className="max-w-full truncate border-emerald-200 bg-emerald-50 font-medium text-emerald-700 hover:bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300"
                      >
                        {row.project.name}
                      </Badge>
                    ) : (
                      <span className="flex items-center gap-1">
                        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
                        No project
                      </span>
                    )}
                    <span className="flex shrink-0 items-center gap-1 tabular-nums">
                      <CalendarDays className="h-3 w-3" />
                      {formatDateTime(row.checkIn)}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2 border-t pt-2.5">
                    {row.checkOut ? (
                      <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                        <LogOut className="h-3.5 w-3.5 shrink-0 text-emerald-700 dark:text-emerald-400" />
                        <span className="truncate tabular-nums">Out {formatDateTime(row.checkOut)}</span>
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                        <span className="relative flex h-2 w-2">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
                          <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
                        </span>
                        Open session
                      </span>
                    )}
                    <div className="flex shrink-0 items-center gap-1">
                      {canEdit && !row.checkOut ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-9 border-emerald-200 px-2.5 text-xs text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 dark:border-emerald-900 dark:text-emerald-400 dark:hover:bg-emerald-950"
                          disabled={checkingOutId !== null}
                          onClick={() => void handleQuickCheckout(row)}
                          aria-label={`Check out ${row.staff.fullName} now`}
                        >
                          {checkingOutId === row.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <LogOut className="h-3.5 w-3.5" />
                          )}
                          Check Out
                        </Button>
                      ) : null}
                      {canEdit ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-11 w-11 text-muted-foreground hover:text-foreground"
                          onClick={() => openEdit(row)}
                          aria-label={`Edit attendance for ${row.staff.fullName}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      ) : null}
                      {canDelete ? (
                        <ConfirmDelete
                          title="Delete attendance record?"
                          description={`The check-in record for ${row.staff.fullName} will be permanently removed.`}
                          onConfirm={() => handleDelete(row)}
                        />
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>

            {/* Desktop: table */}
            <div className="hidden md:block print:block print:overflow-visible">
            <Table className="min-w-[850px] print:min-w-0 print:text-xs">
              <TableHeader>
                <TableRow>
                  <TableHead>Staff Member</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Check-In</TableHead>
                  <TableHead>Check-Out</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <AvatarInitials
                          name={row.staff.fullName}
                          src={staffOptions.find((s) => s.id === row.staff.id)?.profilePhoto ?? null}
                          size="sm"
                        />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{row.staff.fullName}</p>
                          <p className="text-xs text-muted-foreground">
                            IQAMA: {row.staff.iqamaId}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {row.project ? (
                        <Badge
                          variant="secondary"
                          title={row.project.name}
                          className="max-w-[170px] truncate border-emerald-200 bg-emerald-50 font-medium text-emerald-700 hover:bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300"
                        >
                          {row.project.name}
                        </Badge>
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">{formatDateTime(row.checkIn)}</TableCell>
                    <TableCell className="text-sm">
                      {row.checkOut ? (
                        formatDateTime(row.checkOut)
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-destructive">Missing</span>
                          {canEdit ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 gap-1 border-emerald-200 px-2 text-xs text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 dark:border-emerald-900 dark:text-emerald-400 dark:hover:bg-emerald-950"
                                  disabled={checkingOutId !== null}
                                  onClick={() => void handleQuickCheckout(row)}
                                  aria-label={`Check out ${row.staff.fullName} now`}
                                >
                                  {checkingOutId === row.id ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <LogOut className="h-3.5 w-3.5" />
                                  )}
                                  Check Out
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Close this session at the current time</TooltipContent>
                            </Tooltip>
                          ) : null}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground tabular-nums">
                      {formatDuration(row.durationMinutes)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {canEdit ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-foreground"
                            onClick={() => openEdit(row)}
                            aria-label={`Edit attendance for ${row.staff.fullName}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        ) : null}
                        {canDelete ? (
                          <ConfirmDelete
                            title="Delete attendance record?"
                            description={`The check-in record for ${row.staff.fullName} will be permanently removed.`}
                            onConfirm={() => handleDelete(row)}
                          />
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
            page={page}
            pageSize={pageSize}
            total={total}
            totalPages={totalPages}
            onPageChange={setPage}
            onPageSizeChange={(s) => {
              setPageSize(s)
              setPage(1)
            }}
            unit="records"
          />
        ) : null}
      </SectionCard>

      {/* Add/Edit dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto nice-scrollbar sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Attendance' : 'Mark Attendance'}</DialogTitle>
            <DialogDescription>
              {editing
                ? 'Update the check-in / check-out details of this record.'
                : 'Record a check-in and (optionally) a check-out for a staff member.'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label>
                Staff Member <span className="text-destructive">*</span>
              </Label>
              <Select value={form.staffId || undefined} onValueChange={(v) => setField('staffId', v)}>
                <SelectTrigger className="w-full" aria-label="Staff member">
                  <SelectValue placeholder="Select a staff member" />
                </SelectTrigger>
                <SelectContent>
                  {staffOptions.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {staffLabel(s)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Project (optional)</Label>
              <Select
                value={form.projectId || undefined}
                onValueChange={(v) => setField('projectId', v)}
              >
                <SelectTrigger className="w-full" aria-label="Project">
                  <SelectValue placeholder="No specific project" />
                </SelectTrigger>
                <SelectContent>
                  {projectOptions.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="attendance-checkin">
                Check-In <span className="text-destructive">*</span>
              </Label>
              <Input
                id="attendance-checkin"
                type="datetime-local"
                value={form.checkIn}
                onChange={(e) => setField('checkIn', e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="attendance-checkout">Check-Out</Label>
              <Input
                id="attendance-checkout"
                type="datetime-local"
                value={form.checkOut}
                onChange={(e) => setField('checkOut', e.target.value)}
              />
            </div>
            {form.checkIn && form.checkOut ? (
              <div className="sm:col-span-2">
                <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2.5">
                  <CalendarClock className="h-4 w-4 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    Duration:{' '}
                    <span className="font-semibold text-foreground tabular-nums">
                      {previewMinutes === null ? 'Check-out must be after check-in' : formatDuration(previewMinutes)}
                    </span>
                  </p>
                </div>
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => void handleSubmit()} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {editing ? 'Save Changes' : 'Mark Attendance'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  Banknote,
  CalendarCheck,
  CalendarDays,
  CheckCircle2,
  Clock,
  ClipboardList,
  Download,
  Eye,
  FolderKanban,
  HandCoins,
  History,
  IdCard,
  ImagePlus,
  Loader2,
  Pencil,
  Plus,
  ShieldAlert,
  UserRound,
  UserX,
  Users,
  X,
} from 'lucide-react'
import { api, qs } from '@/lib/api-client'
import { buildCsv, csvFilename, downloadCsv } from '@/lib/csv'
import { can, useAppStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { formatDate, formatDuration, formatMoney, initials, monthYearLabel } from '@/lib/format'
import { daysUntil, expiryStatus } from '@/lib/expiry'
import { useDebounce } from '@/hooks/use-debounce'
import { useViewIntent, useViewRecordIntent } from '@/hooks/use-view-intent'
import type { Paginated, ProjectRow, StaffCategory, StaffProfileStats, StaffRow } from '@/lib/types'
import { PageHeader, SectionCard, MobileFab } from '@/components/app/shared/page-header'
import { FilterBar, FilterSelect, SearchInput } from '@/components/app/shared/filter-select'
import { AvatarInitials } from '@/components/app/shared/avatar-initials'
import { CategoryChip, StatusBadge, ExpiryBadge } from '@/components/app/shared/status-badge'
import { ConfirmDelete } from '@/components/app/shared/confirm-delete'
import { DataTablePagination } from '@/components/app/shared/data-table-pagination'
import { EmptyState, TableSkeleton } from '@/components/app/shared/empty-state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AdvanceLedgerContent } from './advances'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { StaffNameListHistory } from './staff-name-list-history'

type StaffForm = {
  fullName: string
  phone: string
  position: string
  staffCategoryId: string
  iqamaId: string
  iqamaExpiry: string
  passportExpiry: string
  joiningDate: string
  // Name List additions
  passportNo: string
  nationality: string
  bloodGroup: string
  experienceYears: string
  ratePerHour: string
  overtimeRate: string
  monthlySalary: string
  status: 'active' | 'inactive'
  residentialAddress: string
  profilePhoto: string | null
  projectIds: string[]
}

const EMPTY_FORM: StaffForm = {
  fullName: '',
  phone: '',
  position: '',
  staffCategoryId: '',
  iqamaId: '',
  iqamaExpiry: '',
  passportExpiry: '',
  joiningDate: '',
  passportNo: '',
  nationality: '',
  bloodGroup: '',
  experienceYears: '',
  ratePerHour: '',
  overtimeRate: '',
  monthlySalary: '',
  status: 'active',
  residentialAddress: '',
  profilePhoto: null,
  projectIds: [],
}

type StaffListTotals = {
  active: number
  inactive: number
  unassigned: number
  avgSalary: number
  expiredDocs: number
  expiringDocs: number
}

/** Compact quick-stat chip (matches the Payroll summary-chip styling). */
function StaffSummaryChip({
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

/** Read an image file and downscale it so the stored data URL stays small. */
function resizeImageFile(file: File, max = 256): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read the selected file'))
    reader.onload = () => {
      const img = new window.Image()
      img.onerror = () => reject(new Error('The selected file is not a valid image'))
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height))
        const w = Math.max(1, Math.round(img.width * scale))
        const h = Math.max(1, Math.round(img.height * scale))
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error('Could not process the image'))
          return
        }
        ctx.drawImage(img, 0, 0, w, h)
        resolve(canvas.toDataURL('image/jpeg', 0.85))
      }
      img.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  })
}

function ProjectChips({ projects }: { projects: { id: string; name: string }[] }) {
  if (projects.length === 0) {
    return <span className="text-sm text-muted-foreground">—</span>
  }
  const shown = projects.slice(0, 2)
  const rest = projects.slice(2)
  return (
    <div className="flex flex-wrap items-center gap-1">
      {shown.map((p) => (
        <Badge
          key={p.id}
          variant="secondary"
          className="max-w-[150px] truncate border-emerald-200 bg-emerald-50 font-medium text-emerald-700 hover:bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300"
        >
          {p.name}
        </Badge>
      ))}
      {rest.length > 0 ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge
              variant="secondary"
              className="cursor-default border-emerald-200 bg-emerald-50 font-medium text-emerald-700 hover:bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300"
            >
              +{rest.length} more
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            <div className="space-y-1">
              {rest.map((p) => (
                <p key={p.id}>{p.name}</p>
              ))}
            </div>
          </TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  )
}

export function StaffListView() {
  const { user, settings } = useAppStore()

  // List state
  const [rows, setRows] = useState<StaffRow[]>([])
  const [total, setTotal] = useState(0)
  const [totals, setTotals] = useState<StaffListTotals | null>(null)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)

  // Filters
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search)
  const [projectFilter, setProjectFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [expiryFilter, setExpiryFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)

  // Reference data
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [categories, setCategories] = useState<StaffCategory[]>([])

  // View dialog
  const [viewing, setViewing] = useState<StaffRow | null>(null)
  const [historyStaff, setHistoryStaff] = useState<StaffRow | null>(null)
  const [stats, setStats] = useState<StaffProfileStats | null>(null)
  const [statsLoading, setStatsLoading] = useState(false)

  // Fetch employment & pay summary whenever the profile dialog opens
  useEffect(() => {
    if (!viewing) {
      setStats(null)
      return
    }
    let cancelled = false
    setStatsLoading(true)
    api
      .get<StaffProfileStats>(`/api/staff/${viewing.id}/profile`)
      .then((res) => {
        if (!cancelled) setStats(res)
      })
      .catch(() => {
        // Non-blocking: the profile dialog still shows the base details
        if (!cancelled) setStats(null)
      })
      .finally(() => {
        if (!cancelled) setStatsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [viewing])

  // Add/Edit dialog
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<StaffRow | null>(null)
  const [form, setForm] = useState<StaffForm>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [photoBusy, setPhotoBusy] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const setField = <K extends keyof StaffForm>(key: K, value: StaffForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get<Paginated<StaffRow>>(
        `/api/staff${qs({
          search: debouncedSearch,
          projectId: projectFilter === 'all' ? null : projectFilter,
          categoryId: categoryFilter === 'all' ? null : categoryFilter,
          status: statusFilter === 'all' ? null : statusFilter,
          expiry: expiryFilter === 'all' ? null : expiryFilter,
          page,
          pageSize,
        })}`
      )
      setRows(res.data)
      setTotal(res.total)
      setTotals(
        res.totals
          ? {
              active: res.totals.active ?? 0,
              inactive: res.totals.inactive ?? 0,
              unassigned: res.totals.unassigned ?? 0,
              avgSalary: res.totals.avgSalary ?? 0,
              expiredDocs: res.totals.expiredDocs ?? 0,
              expiringDocs: res.totals.expiringDocs ?? 0,
            }
          : null
      )
      setTotalPages(res.totalPages)
      if (res.page > res.totalPages && res.totalPages > 0) setPage(res.totalPages)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load staff list')
    } finally {
      setLoading(false)
    }
  }, [debouncedSearch, projectFilter, categoryFilter, statusFilter, expiryFilter, page, pageSize])

  // Reset to first page whenever filters change
  useEffect(() => {
    setPage(1)
  }, [debouncedSearch, projectFilter, categoryFilter, statusFilter, expiryFilter])

  useEffect(() => {
    void load()
  }, [load])

  // Reference data for filters + form
  useEffect(() => {
    ;(async () => {
      try {
        const [pr, ca] = await Promise.all([
          api.get<Paginated<ProjectRow>>('/api/projects?pageSize=100'),
          api.get<{ data: StaffCategory[] }>('/api/staff-categories'),
        ])
        setProjects(pr.data)
        setCategories(ca.data)
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Failed to load filter options')
      }
    })()
  }, [])

  const refreshFormOptions = useCallback(async () => {
    try {
      const [pr, ca] = await Promise.all([
        api.get<Paginated<ProjectRow>>('/api/projects?pageSize=100'),
        api.get<{ data: StaffCategory[] }>('/api/staff-categories'),
      ])
      setProjects(pr.data)
      setCategories(ca.data)
    } catch {
      // non-fatal — filters keep previous data
    }
  }, [])

  function openCreate() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setFormOpen(true)
    void refreshFormOptions()
  }

  // Deep-open the create dialog when arriving via the command palette
  const shouldOpenCreate = useViewIntent('staff-list', 'create')
  useEffect(() => {
    if (shouldOpenCreate) openCreate()
  }, [shouldOpenCreate])

  // Deep-open a specific staff profile when arriving via the palette record search
  const recordIntent = useViewRecordIntent('staff-list')
  useEffect(() => {
    if (!recordIntent.matched || !recordIntent.recordId) return
    api
      .get<StaffRow>(`/api/staff/${recordIntent.recordId}`)
      .then(setViewing)
      .catch(() => toast.error('Could not open the staff profile'))
  }, [recordIntent.matched, recordIntent.recordId])

  function openEdit(staff: StaffRow) {
    setEditing(staff)
    setForm({
      fullName: staff.fullName,
      phone: staff.phone ?? '',
      position: staff.position ?? '',
      staffCategoryId: staff.staffCategory?.id ?? '',
      iqamaId: staff.iqamaId,
      iqamaExpiry: staff.iqamaExpiry ? staff.iqamaExpiry.slice(0, 10) : '',
      passportExpiry: staff.passportExpiry ? staff.passportExpiry.slice(0, 10) : '',
      joiningDate: staff.joiningDate ? staff.joiningDate.slice(0, 10) : '',
      passportNo: staff.passportNo ?? '',
      nationality: staff.nationality ?? '',
      bloodGroup: staff.bloodGroup ?? '',
      experienceYears: staff.experienceYears != null ? String(staff.experienceYears) : '',
      ratePerHour: staff.ratePerHour !== 0 ? String(staff.ratePerHour) : '',
      overtimeRate: staff.overtimeRate !== 0 ? String(staff.overtimeRate) : '',
      monthlySalary: staff.monthlySalary !== 0 ? String(staff.monthlySalary) : '',
      status: staff.status,
      residentialAddress: staff.residentialAddress ?? '',
      profilePhoto: staff.profilePhoto,
      projectIds: staff.projects.map((p) => p.id),
    })
    setFormOpen(true)
    void refreshFormOptions()
  }

  async function handlePhoto(file: File | undefined) {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file')
      return
    }
    setPhotoBusy(true)
    try {
      const dataUrl = await resizeImageFile(file)
      setField('profilePhoto', dataUrl)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not process the photo')
    } finally {
      setPhotoBusy(false)
    }
  }

  async function handleSubmit() {
    if (!form.fullName.trim()) {
      toast.error('Full name is required')
      return
    }
    if (!form.phone.trim()) {
      toast.error('Phone number is required')
      return
    }
    if (!form.position.trim()) {
      toast.error('Position is required')
      return
    }
    if (!form.staffCategoryId) {
      toast.error('Staff category is required')
      return
    }
    if (!form.iqamaId.trim()) {
      toast.error('IQAMA / ID is required')
      return
    }
    if (!/^\d+$/.test(form.iqamaId.trim())) {
      toast.error('IQAMA / ID must contain digits only')
      return
    }
    if (form.ratePerHour && Number(form.ratePerHour) < 0) {
      toast.error('Rate per hour cannot be negative')
      return
    }
    setSaving(true)
    try {
      const payload = {
        fullName: form.fullName.trim(),
        phone: form.phone.trim(),
        position: form.position.trim(),
        staffCategoryId: form.staffCategoryId,
        iqamaId: form.iqamaId.trim(),
        joiningDate: form.joiningDate || null,
        iqamaExpiry: form.iqamaExpiry || null,
        passportExpiry: form.passportExpiry || null,
        passportNo: form.passportNo.trim() || null,
        nationality: form.nationality.trim() || null,
        bloodGroup: form.bloodGroup || null,
        experienceYears: form.experienceYears ? Number(form.experienceYears) : null,
        ratePerHour: form.ratePerHour ? Number(form.ratePerHour) : 0,
        overtimeRate: form.overtimeRate ? Number(form.overtimeRate) : 0,
        monthlySalary: form.monthlySalary ? Number(form.monthlySalary) : 0,
        profilePhoto: form.profilePhoto,
        residentialAddress: form.residentialAddress.trim() || null,
        status: form.status,
        projectIds: form.projectIds,
      }
      if (editing) {
        await api.put(`/api/staff/${editing.id}`, payload)
        toast.success('Staff member updated')
      } else {
        await api.post('/api/staff', payload)
        toast.success('Staff member added')
      }
      setFormOpen(false)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save staff member')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(staff: StaffRow) {
    try {
      await api.del(`/api/staff/${staff.id}`)
      toast.success('Staff member removed')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete staff member')
    }
  }

  const hasFilters =
    Boolean(debouncedSearch) ||
    projectFilter !== 'all' ||
    categoryFilter !== 'all' ||
    statusFilter !== 'all' ||
    expiryFilter !== 'all'

  const canCreate = can(user, 'staff.create')
  const canEdit = can(user, 'staff.edit')
  const canDelete = can(user, 'staff.delete')

  const projectOptions = useMemo(
    () => projects.map((p) => ({ value: p.id, label: p.name })),
    [projects]
  )
  const categoryOptions = useMemo(
    () => categories.map((c) => ({ value: c.id, label: c.name })),
    [categories]
  )

  // Export the WHOLE filtered staff directory (walks pages)
  async function handleExportCsv() {
    if (exporting) return
    setExporting(true)
    try {
      const all: StaffRow[] = []
      let p = 1
      for (;;) {
        const res = await api.get<Paginated<StaffRow>>(
          `/api/staff${qs({
            search: debouncedSearch,
            projectId: projectFilter === 'all' ? null : projectFilter,
            categoryId: categoryFilter === 'all' ? null : categoryFilter,
            status: statusFilter === 'all' ? null : statusFilter,
            expiry: expiryFilter === 'all' ? null : expiryFilter,
            page: p,
            pageSize: 100,
          })}`
        )
        all.push(...res.data)
        if (p >= res.totalPages || res.data.length === 0) break
        p += 1
      }
      const csv = buildCsv(
        [
          'Full Name', 'IQAMA ID', 'Position', 'Category', 'Phone', 'Projects',
          'Joining Date', 'IQAMA Expiry', 'IQAMA Status', 'Passport Expiry',
          'Rate/Hour', 'OT Rate/Hour', 'Monthly Salary', 'Status',
        ],
        all.map((r) => [
          r.fullName,
          r.iqamaId,
          r.position ?? '',
          r.staffCategory?.name ?? 'Uncategorized',
          r.phone ?? '',
          r.projects.map((p) => p.name).join('; '),
          r.joiningDate ? formatDate(r.joiningDate) : '',
          r.iqamaExpiry ? formatDate(r.iqamaExpiry) : '',
          expiryStatus(r.iqamaExpiry),
          r.passportExpiry ? formatDate(r.passportExpiry) : '',
          r.ratePerHour.toFixed(2),
          r.overtimeRate.toFixed(2),
          r.monthlySalary.toFixed(2),
          r.status,
        ])
      )
      downloadCsv(csvFilename('staff-directory'), csv)
      toast.success(`Exported ${all.length} staff records to CSV`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader title="Staff List" description="Workforce directory &amp; profiles">
        <Button
          variant="outline"
          onClick={() => void handleExportCsv()}
          disabled={exporting || total === 0}
        >
          {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          Export CSV
        </Button>
        {canCreate ? (
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" />
            New Staff
          </Button>
        ) : null}
      </PageHeader>

      {canCreate ? <MobileFab label="New Staff" onClick={openCreate} icon={Plus} /> : null}

      {/* Quick-stat chips — reflect the current filters */}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-3 lg:grid-cols-5 sm:gap-3">
        <StaffSummaryChip
          icon={Users}
          label="Total Staff"
          value={total.toLocaleString()}
          tone="text-primary"
        />
        <StaffSummaryChip
          icon={CheckCircle2}
          label="Active"
          value={(totals?.active ?? 0).toLocaleString()}
          tone="text-emerald-700 dark:text-emerald-400"
        />
        <StaffSummaryChip
          icon={UserX}
          label="Inactive"
          value={(totals?.inactive ?? 0).toLocaleString()}
          tone="text-rose-700 dark:text-rose-400"
        />
        <StaffSummaryChip
          icon={ShieldAlert}
          label="Expiring ≤90d"
          value={(totals?.expiringDocs ?? 0).toLocaleString()}
          tone="text-amber-600 dark:text-amber-400"
        />
        <StaffSummaryChip
          icon={Banknote}
          label="Avg Salary"
          value={formatMoney(totals?.avgSalary ?? null, settings.currency || 'SAR')}
          tone="text-primary"
        />
      </div>

      <SectionCard>
        <div className="p-4">
          <FilterBar
            search={
              <SearchInput
                value={search}
                onChange={setSearch}
                placeholder="Search name or IQAMA..."
                className="w-full sm:w-[260px]"
              />
            }
            activeCount={
              [projectFilter, categoryFilter, statusFilter, expiryFilter].filter((v) => v !== 'all').length
            }
          >
            <FilterSelect
              value={projectFilter}
              onChange={setProjectFilter}
              options={projectOptions}
              placeholder="Project"
              emptyLabel="All Projects"
            />
            <FilterSelect
              value={categoryFilter}
              onChange={setCategoryFilter}
              options={categoryOptions}
              placeholder="Category"
              emptyLabel="All Categories"
            />
            <FilterSelect
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: 'active', label: 'Active' },
                { value: 'inactive', label: 'Inactive' },
              ]}
              placeholder="Status"
              emptyLabel="All Statuses"
            />
            <FilterSelect
              value={expiryFilter}
              onChange={setExpiryFilter}
              options={[
                { value: 'expired', label: 'Expired' },
                { value: 'expiring', label: 'Expiring ≤90 days' },
                { value: 'valid', label: 'Valid' },
              ]}
              placeholder="IQAMA"
              emptyLabel="All Documents"
            />
          </FilterBar>
        </div>

        {loading ? (
          <TableSkeleton rows={6} cols={7} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={hasFilters ? Users : UserRound}
            title={hasFilters ? 'No staff match your filters' : 'No staff yet'}
            description={
              hasFilters
                ? 'Try adjusting or clearing the filters to see more results.'
                : 'Add your first staff member to start building the workforce directory.'
            }
            action={
              hasFilters ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    setSearch('')
                    setProjectFilter('all')
                    setCategoryFilter('all')
                    setStatusFilter('all')
                    setExpiryFilter('all')
                  }}
                >
                  Clear Filters
                </Button>
              ) : canCreate ? (
                <Button onClick={openCreate}>
                  <Plus className="h-4 w-4" />
                  New Staff
                </Button>
              ) : null
            }
          />
        ) : (
          <>
            {/* Mobile: stacked cards — an 8-column table is unreadable at <md widths */}
            <ul className="space-y-3 p-4 sm:p-6 md:hidden print:hidden">
              {rows.map((staff) => {
                const iqamaSt = expiryStatus(staff.iqamaExpiry)
                return (
                <li
                  key={staff.id}
                  className={cn(
                    'rounded-xl border bg-card p-3 shadow-sm transition-colors hover:bg-muted/30',
                    iqamaSt === 'expired' &&
                      'border-l-4 border-l-rose-400 dark:border-l-rose-600',
                    iqamaSt === 'expiring' &&
                      'border-l-4 border-l-amber-400 dark:border-l-amber-600'
                  )}
                >
                  <div className="flex items-start gap-3">
                    <AvatarInitials name={staff.fullName} src={staff.profilePhoto} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className="truncate font-semibold leading-snug">{staff.fullName}</p>
                        <StatusBadge kind={staff.status} />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {staff.position || 'No position set'} · IQAMA:{' '}
                        <span className="tabular-nums">{staff.iqamaId}</span>
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-bold tabular-nums">
                        {formatMoney(staff.monthlySalary, settings.currency)}
                      </p>
                      <p className="text-[11px] text-muted-foreground tabular-nums">
                        {formatMoney(staff.ratePerHour, settings.currency)}/hr
                      </p>
                    </div>
                  </div>
                  <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
                    {staff.staffCategory ? <CategoryChip label={staff.staffCategory.name} /> : null}
                    {staff.projects.length > 0 ? (
                      <span className="flex min-w-0 items-center gap-1">
                        <FolderKanban className="h-3 w-3 shrink-0" />
                        <span className="truncate">{staff.projects.map((p) => p.name).join(', ')}</span>
                      </span>
                    ) : null}
                    <span className="flex shrink-0 items-center gap-1 tabular-nums">
                      <CalendarDays className="h-3 w-3" />
                      Joined {formatDate(staff.joiningDate)}
                    </span>
                    <span
                      className={cn(
                        'flex shrink-0 items-center gap-1 tabular-nums',
                        expiryStatus(staff.iqamaExpiry) === 'expired' && 'font-medium text-rose-600 dark:text-rose-400',
                        expiryStatus(staff.iqamaExpiry) === 'expiring' && 'font-medium text-amber-600 dark:text-amber-400'
                      )}
                    >
                      <IdCard className="h-3 w-3" />
                      {staff.iqamaExpiry
                        ? `IQAMA ${formatDate(staff.iqamaExpiry)}`
                        : 'No IQAMA expiry'}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-end gap-1 border-t pt-2.5">
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-11 w-11 text-muted-foreground hover:text-foreground"
                        onClick={() => setViewing(staff)}
                        aria-label={`View ${staff.fullName}`}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-11 w-11 text-muted-foreground hover:text-foreground"
                        onClick={() => setHistoryStaff(staff)}
                        aria-label={`Name list history for ${staff.fullName}`}
                        title="Name List history"
                      >
                        <ClipboardList className="h-4 w-4" />
                      </Button>
                      {canEdit ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-11 w-11 text-muted-foreground hover:text-foreground"
                          onClick={() => openEdit(staff)}
                          aria-label={`Edit ${staff.fullName}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      ) : null}
                      {canDelete ? (
                        <ConfirmDelete
                          title={`Delete ${staff.fullName}?`}
                          description="The staff member will be removed from active lists."
                          onConfirm={() => handleDelete(staff)}
                          triggerClassName="h-11 w-11 text-muted-foreground hover:text-rose-600 dark:hover:text-rose-400"
                        />
                      ) : null}
                    </div>
                  </div>
                </li>
                )
              })}
            </ul>

            {/* Desktop: table */}
            <div className="hidden overflow-x-auto md:block print:block print:overflow-visible">
            <Table className="min-w-[1000px] print:min-w-0 print:text-xs">
              <TableHeader>
                <TableRow>
                  <TableHead>Staff Member</TableHead>
                  <TableHead>Position</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Assigned Projects</TableHead>
                  <TableHead>Joining Date</TableHead>
                  <TableHead>IQAMA Expiry</TableHead>
                  <TableHead className="text-right">Salary</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((staff) => (
                  <TableRow
                    key={staff.id}
                    className={cn(
                      expiryStatus(staff.iqamaExpiry) === 'expired' &&
                        'bg-rose-50/50 hover:bg-rose-50/70 dark:bg-rose-950/20 dark:hover:bg-rose-950/30'
                    )}
                  >
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <AvatarInitials name={staff.fullName} src={staff.profilePhoto} />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{staff.fullName}</p>
                          <p className="text-xs text-muted-foreground">IQAMA: {staff.iqamaId}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">{staff.position || '—'}</TableCell>
                    <TableCell>
                      {staff.staffCategory ? (
                        <CategoryChip label={staff.staffCategory.name} />
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <ProjectChips projects={staff.projects} />
                    </TableCell>
                    <TableCell className="text-sm">{formatDate(staff.joiningDate)}</TableCell>
                    <TableCell>
                      {staff.iqamaExpiry ? (
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              'text-sm tabular-nums',
                              expiryStatus(staff.iqamaExpiry) !== 'valid' && 'font-medium'
                            )}
                          >
                            {formatDate(staff.iqamaExpiry)}
                          </span>
                          <ExpiryBadge
                            status={expiryStatus(staff.iqamaExpiry)}
                            daysLeft={daysUntil(staff.iqamaExpiry)}
                          />
                        </div>
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-sm font-medium tabular-nums">
                      {formatMoney(staff.monthlySalary, settings.currency)}
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground tabular-nums">
                      {formatMoney(staff.ratePerHour, settings.currency)}/hr
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-foreground"
                          onClick={() => setViewing(staff)}
                          aria-label={`View ${staff.fullName}`}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-foreground"
                          onClick={() => setHistoryStaff(staff)}
                          aria-label={`Name list history for ${staff.fullName}`}
                          title="Name List history"
                        >
                          <ClipboardList className="h-4 w-4" />
                        </Button>
                        {canEdit ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-foreground"
                            onClick={() => openEdit(staff)}
                            aria-label={`Edit ${staff.fullName}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        ) : null}
                        {canDelete ? (
                          <ConfirmDelete
                            title={`Delete ${staff.fullName}?`}
                            description="The staff member will be removed from active lists."
                            onConfirm={() => handleDelete(staff)}
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
            unit="staff"
          />
        ) : null}
      </SectionCard>

      {/* View profile dialog */}
      <Dialog open={Boolean(viewing)} onOpenChange={(open) => !open && setViewing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto nice-scrollbar sm:max-w-xl">
          {viewing ? (
            <>
              <DialogHeader>
                <DialogTitle>Staff Profile</DialogTitle>
                <DialogDescription>Full details of the staff member.</DialogDescription>
              </DialogHeader>
              <Tabs defaultValue="profile">
                <TabsList
                  className={cn(
                    'grid w-full',
                    can(user, 'advances.view') ? 'grid-cols-2' : 'grid-cols-1'
                  )}
                >
                  <TabsTrigger value="profile">Profile</TabsTrigger>
                  {can(user, 'advances.view') ? (
                    <TabsTrigger value="advances" className="gap-1.5">
                      <HandCoins className="h-3.5 w-3.5" />
                      Advances
                    </TabsTrigger>
                  ) : null}
                </TabsList>
                <TabsContent value="profile" className="mt-4">
              <div className="space-y-5">
                <div className="flex items-center gap-4">
                  <AvatarInitials
                    name={viewing.fullName}
                    src={viewing.profilePhoto}
                    className="h-16 w-16 text-lg"
                  />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-base font-semibold">{viewing.fullName}</p>
                      <StatusBadge kind={viewing.status} />
                    </div>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {viewing.position || 'No position set'}
                    </p>
                    {viewing.staffCategory ? (
                      <div className="mt-1.5">
                        <CategoryChip label={viewing.staffCategory.name} />
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="grid gap-x-4 gap-y-3 rounded-lg border bg-muted/30 p-4 sm:grid-cols-2">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">IQAMA / ID</p>
                    <p className="mt-0.5 text-sm font-medium tabular-nums">{viewing.iqamaId}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">IQAMA Expiry</p>
                    <div className="mt-0.5 flex items-center gap-2">
                      <p className="text-sm font-medium tabular-nums">
                        {formatDate(viewing.iqamaExpiry)}
                      </p>
                      <ExpiryBadge
                        status={expiryStatus(viewing.iqamaExpiry)}
                        daysLeft={daysUntil(viewing.iqamaExpiry)}
                      />
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Phone</p>
                    <p className="mt-0.5 text-sm font-medium tabular-nums">{viewing.phone || '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Passport Expiry</p>
                    <div className="mt-0.5 flex items-center gap-2">
                      <p className="text-sm font-medium tabular-nums">
                        {formatDate(viewing.passportExpiry)}
                      </p>
                      <ExpiryBadge
                        status={expiryStatus(viewing.passportExpiry)}
                        daysLeft={daysUntil(viewing.passportExpiry)}
                      />
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Joining Date</p>
                    <p className="mt-0.5 text-sm font-medium">{formatDate(viewing.joiningDate)}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Monthly Salary</p>
                    <p className="mt-0.5 text-sm font-medium tabular-nums">
                      {formatMoney(viewing.monthlySalary, settings.currency)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Rate / Hour</p>
                    <p className="mt-0.5 text-sm font-medium tabular-nums">
                      {formatMoney(viewing.ratePerHour, settings.currency)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Overtime Rate / Hour</p>
                    <p className="mt-0.5 text-sm font-medium tabular-nums">
                      {formatMoney(viewing.overtimeRate, settings.currency)}
                    </p>
                  </div>
                  <div className="sm:col-span-2">
                    <p className="text-xs font-medium text-muted-foreground">Residential Address</p>
                    <p className="mt-0.5 text-sm font-medium">{viewing.residentialAddress || '—'}</p>
                  </div>
                </div>

                <div>
                  <p className="text-xs font-medium text-muted-foreground">Assigned Projects</p>
                  {viewing.projects.length > 0 ? (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {viewing.projects.map((p) => (
                        <Badge
                          key={p.id}
                          variant="secondary"
                          className="border-emerald-200 bg-emerald-50 font-medium text-emerald-700 hover:bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300"
                        >
                          {p.name}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-0.5 text-sm text-muted-foreground">No projects assigned.</p>
                  )}
                </div>

                {/* Employment & pay summary (permission-aware) */}
                <Separator />
                <div>
                  <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                    <History className="h-4 w-4 text-muted-foreground" />
                    Employment & Pay
                  </h3>
                  {statsLoading ? (
                    <div className="mt-3 space-y-3">
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {Array.from({ length: 4 }).map((_, i) => (
                          <Skeleton key={i} className="h-[62px] w-full" />
                        ))}
                      </div>
                      <Skeleton className="h-[132px] w-full" />
                    </div>
                  ) : stats ? (
                    <div className="mt-3 space-y-4">
                      {/* Headline chips */}
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {stats.payroll ? (
                          <div className="rounded-lg border bg-muted/30 p-3">
                            <p className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                              <Banknote className="h-3 w-3" /> Total earned
                            </p>
                            <p className="mt-1 text-sm font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
                              {formatMoney(stats.payroll.totalNetPaid, settings.currency)}
                            </p>
                          </div>
                        ) : null}
                        {stats.payroll ? (
                          <div className="rounded-lg border bg-muted/30 p-3">
                            <p className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                              <Clock className="h-3 w-3" /> Pending payslips
                            </p>
                            <p
                              className={`mt-1 text-sm font-bold tabular-nums ${
                                stats.payroll.pendingCount > 0
                                  ? 'text-amber-600 dark:text-amber-400'
                                  : 'text-muted-foreground'
                              }`}
                            >
                              {stats.payroll.pendingCount}
                            </p>
                          </div>
                        ) : null}
                        {stats.attendance ? (
                          <div className="rounded-lg border bg-muted/30 p-3">
                            <p className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                              <CalendarCheck className="h-3 w-3" /> Hours this month
                            </p>
                            <p className="mt-1 text-sm font-bold tabular-nums">
                              {formatDuration(stats.attendance.monthMinutes)}
                            </p>
                          </div>
                        ) : null}
                        <div className="rounded-lg border bg-muted/30 p-3">
                          <p className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                            <UserRound className="h-3 w-3" />
                            {stats.monthsEmployed !== null ? 'Employed for' : 'Sessions logged'}
                          </p>
                          <p className="mt-1 text-sm font-bold tabular-nums">
                            {stats.monthsEmployed !== null
                              ? `${stats.monthsEmployed} ${stats.monthsEmployed === 1 ? 'month' : 'months'}`
                              : stats.attendance
                                ? `${stats.attendance.totalSessions} sessions`
                                : '—'}
                          </p>
                          {stats.attendance && stats.attendance.avgHoursPerSession !== null ? (
                            <p className="text-[10px] text-muted-foreground">
                              avg {formatDuration(Math.round(stats.attendance.avgHoursPerSession * 60))}/session
                            </p>
                          ) : null}
                        </div>
                      </div>

                      {/* Payroll history */}
                      {stats.payroll ? (
                        <div>
                          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Payroll history
                            <span className="ml-1 font-normal normal-case tracking-normal">
                              ({stats.payroll.totalEntries} total)
                            </span>
                          </p>
                          {stats.payroll.recent.length > 0 ? (
                            <ul className="divide-y rounded-lg border">
                              {stats.payroll.recent.map((p) => (
                                <li
                                  key={p.id}
                                  className="flex items-center gap-2 px-3 py-2 text-sm"
                                >
                                  <span className="w-24 shrink-0 font-medium tabular-nums">
                                    {monthYearLabel(p.month, p.year)}
                                  </span>
                                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                                    {p.project ?? 'No project'}
                                  </span>
                                  <span className="shrink-0 font-semibold tabular-nums">
                                    {formatMoney(p.netPay, settings.currency)}
                                  </span>
                                  <span
                                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                      p.status === 'paid'
                                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                                        : 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                                    }`}
                                  >
                                    {p.status === 'paid' ? 'Paid' : 'Pending'}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="rounded-lg border border-dashed p-3 text-center text-xs text-muted-foreground">
                              No payroll entries yet.
                            </p>
                          )}
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <p className="mt-2 rounded-lg border border-dashed p-3 text-center text-xs text-muted-foreground">
                      Employment summary is unavailable right now.
                    </p>
                  )}
                </div>
              </div>
                </TabsContent>
                {can(user, 'advances.view') ? (
                  <TabsContent value="advances" className="mt-4">
                    <AdvanceLedgerContent key={viewing.id} staffId={viewing.id} />
                  </TabsContent>
                ) : null}
              </Tabs>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Add/Edit dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto nice-scrollbar sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Staff Member' : 'Add New Staff'}</DialogTitle>
            <DialogDescription>
              {editing
                ? 'Update the details of this staff member.'
                : 'Fill in the details to add a new staff member to the directory.'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="staff-fullname">
                Full Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="staff-fullname"
                value={form.fullName}
                onChange={(e) => setField('fullName', e.target.value)}
                placeholder="e.g. Muhammad Rafiq"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="staff-phone">
                Phone Number <span className="text-destructive">*</span>
              </Label>
              <Input
                id="staff-phone"
                value={form.phone}
                onChange={(e) => setField('phone', e.target.value)}
                placeholder="+966 5x xxx xxxx"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="staff-position">
                Position <span className="text-destructive">*</span>
              </Label>
              <Input
                id="staff-position"
                value={form.position}
                onChange={(e) => setField('position', e.target.value)}
                placeholder="e.g. Pipe Fitter"
              />
            </div>
            <div className="space-y-2">
              <Label>
                Staff Category <span className="text-destructive">*</span>
              </Label>
              <Select
                value={form.staffCategoryId || undefined}
                onValueChange={(v) => setField('staffCategoryId', v)}
              >
                <SelectTrigger className="w-full" aria-label="Staff category">
                  <SelectValue placeholder="Select a category" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="staff-iqama">
                IQAMA / ID <span className="text-destructive">*</span>
              </Label>
              <Input
                id="staff-iqama"
                value={form.iqamaId}
                onChange={(e) => setField('iqamaId', e.target.value)}
                placeholder="Digits only"
                inputMode="numeric"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="staff-joining">Joining Date</Label>
              <Input
                id="staff-joining"
                type="date"
                value={form.joiningDate}
                onChange={(e) => setField('joiningDate', e.target.value)}
              />
            </div>
            {/* Name List print fields */}
            <div className="space-y-2">
              <Label htmlFor="staff-nationality">Nationality</Label>
              <Input
                id="staff-nationality"
                value={form.nationality}
                onChange={(e) => setField('nationality', e.target.value)}
                placeholder="e.g. Bangladesh"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="staff-passport-no">Passport No.</Label>
              <Input
                id="staff-passport-no"
                value={form.passportNo}
                onChange={(e) => setField('passportNo', e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="staff-blood">Blood Group</Label>
              <Select
                value={form.bloodGroup || 'none'}
                onValueChange={(v) => setField('bloodGroup', v === 'none' ? '' : v)}
              >
                <SelectTrigger id="staff-blood">
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">—</SelectItem>
                  {['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((b) => (
                    <SelectItem key={b} value={b}>
                      {b}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="staff-experience">Experience (years)</Label>
              <Input
                id="staff-experience"
                type="number"
                min={0}
                max={60}
                value={form.experienceYears}
                onChange={(e) => setField('experienceYears', e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="staff-iqama-expiry">IQAMA Expiry</Label>
              <Input
                id="staff-iqama-expiry"
                type="date"
                value={form.iqamaExpiry}
                onChange={(e) => setField('iqamaExpiry', e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Highlights alerts within 90 days of expiry
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="staff-passport-expiry">Passport Expiry</Label>
              <Input
                id="staff-passport-expiry"
                type="date"
                value={form.passportExpiry}
                onChange={(e) => setField('passportExpiry', e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="staff-rate">Rate / Hour</Label>
              <Input
                id="staff-rate"
                type="number"
                min={0}
                step="0.01"
                value={form.ratePerHour}
                onChange={(e) => setField('ratePerHour', e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="staff-ot">Overtime Rate / Hour</Label>
              <Input
                id="staff-ot"
                type="number"
                min={0}
                step="0.01"
                value={form.overtimeRate}
                onChange={(e) => setField('overtimeRate', e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="staff-salary">Monthly Salary</Label>
              <Input
                id="staff-salary"
                type="number"
                min={0}
                step="0.01"
                value={form.monthlySalary}
                onChange={(e) => setField('monthlySalary', e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select
                value={form.status}
                onValueChange={(v) => setField('status', v as 'active' | 'inactive')}
              >
                <SelectTrigger className="w-full" aria-label="Status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="staff-address">Residential Address</Label>
              <Textarea
                id="staff-address"
                value={form.residentialAddress}
                onChange={(e) => setField('residentialAddress', e.target.value)}
                placeholder="City, district or full address"
                rows={2}
              />
            </div>

            {/* Profile photo */}
            <div className="space-y-2 sm:col-span-2">
              <Label>Profile Photo</Label>
              {form.profilePhoto ? (
                <div className="flex items-center gap-3 rounded-lg border p-3">
                  <AvatarInitials
                    name={form.fullName}
                    src={form.profilePhoto}
                    className="h-14 w-14 text-lg"
                  />
                  <div className="flex-1">
                    <p className="text-sm font-medium">Photo uploaded</p>
                    <p className="text-xs text-muted-foreground">
                      Stored at a reduced size to keep records light.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setField('profilePhoto', null)
                      if (fileInputRef.current) fileInputRef.current.value = ''
                    }}
                  >
                    <X className="h-4 w-4" />
                    Remove
                  </Button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={photoBusy}
                  className="flex w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-6 text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-foreground disabled:opacity-60"
                >
                  {photoBusy ? (
                    <Loader2 className="h-6 w-6 animate-spin" />
                  ) : (
                    <ImagePlus className="h-6 w-6" />
                  )}
                  <span className="text-sm font-medium">
                    {photoBusy ? 'Processing photo...' : 'Click to upload a photo'}
                  </span>
                  <span className="text-xs">JPG or PNG, automatically resized</span>
                </button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(e) => {
                  void handlePhoto(e.target.files?.[0])
                }}
                aria-label="Upload profile photo"
              />
            </div>

            {/* Assigned projects */}
            <div className="space-y-2 sm:col-span-2">
              <Label>Assigned Projects</Label>
              {projects.length === 0 ? (
                <p className="text-sm text-muted-foreground">No projects available.</p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {projects.map((p) => {
                    const checked = form.projectIds.includes(p.id)
                    return (
                      <label
                        key={p.id}
                        className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors ${
                          checked ? 'border-primary/40 bg-primary/5' : 'hover:bg-muted/50'
                        }`}
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(c) =>
                            setField(
                              'projectIds',
                              c
                                ? [...form.projectIds, p.id]
                                : form.projectIds.filter((id) => id !== p.id)
                            )
                          }
                          aria-label={`Assign to ${p.name}`}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{p.name}</span>
                          {p.location ? (
                            <span className="block truncate text-xs text-muted-foreground">
                              {p.location}
                            </span>
                          ) : null}
                        </span>
                      </label>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => void handleSubmit()} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {editing ? 'Save Changes' : 'Add Staff'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Name List history (per employee) */}
      <StaffNameListHistory
        staff={historyStaff}
        onOpenChange={(o) => !o && setHistoryStaff(null)}
      />
    </div>
  )
}

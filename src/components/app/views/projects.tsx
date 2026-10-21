'use client'

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  ArrowLeftRight,
  Banknote,
  Building2,
  Eye,
  FolderKanban,
  Loader2,
  Lock,
  MapPin,
  Pencil,
  Plus,
  RotateCcw,
  TrendingDown,
  TrendingUp,
  User,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { AvatarInitials } from '@/components/app/shared/avatar-initials'
import { ConfirmDelete } from '@/components/app/shared/confirm-delete'
import { DataTablePagination } from '@/components/app/shared/data-table-pagination'
import { EmptyState, TableSkeleton } from '@/components/app/shared/empty-state'
import { FilterBar, FilterSelect, SearchInput } from '@/components/app/shared/filter-select'
import { PageHeader, SectionCard } from '@/components/app/shared/page-header'
import { CategoryChip, StatusBadge } from '@/components/app/shared/status-badge'
import { useDebounce } from '@/hooks/use-debounce'
import { useViewIntent, useViewRecordIntent } from '@/hooks/use-view-intent'
import { api, qs } from '@/lib/api-client'
import { formatDate, formatDateTime, formatMoney, formatNumber } from '@/lib/format'
import { can, useAppStore } from '@/lib/store'
import type {
  ClientRow,
  Paginated,
  Project,
  ProjectFinancials,
  ProjectRow,
  ProjectStatus,
  StaffRow,
} from '@/lib/types'

type ProjectForm = {
  name: string
  managerName: string
  location: string
  status: ProjectStatus
  clientId: string
  clientRatePerHour: string
}

const EMPTY_FORM: ProjectForm = { name: '', managerName: '', location: '', status: 'active', clientId: '', clientRatePerHour: '' }

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'completed', label: 'Completed' },
]

function DetailItem({
  icon: Icon,
  label,
  children,
}: {
  icon: LucideIcon
  label: string
  children: ReactNode
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border bg-muted/30 p-3">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <div className="mt-0.5 text-sm font-medium">{children}</div>
      </div>
    </div>
  )
}

function StaffListItem({ staff, currency }: { staff: StaffRow; currency: string }) {
  return (
    <li className="flex items-center gap-3 py-2.5">
      <AvatarInitials name={staff.fullName} src={staff.profilePhoto} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{staff.fullName}</p>
        <p className="truncate text-xs text-muted-foreground">
          IQAMA {staff.iqamaId}
          {staff.position ? ` · ${staff.position}` : ''}
        </p>
      </div>
      {staff.staffCategory ? <CategoryChip label={staff.staffCategory.name} className="hidden sm:inline-flex" /> : null}
      <span className="shrink-0 text-xs font-semibold tabular-nums text-muted-foreground">
        {formatMoney(staff.ratePerHour, currency)}/hr
      </span>
    </li>
  )
}

const FIN_INCOME_COLOR = '#10b981'
const FIN_EXPENSE_COLOR = '#f43f5e'

/** Compact axis tick for the monthly financial chart */
function finCompactAxis(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1_000_000) return `${+(value / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${Math.round(value / 1_000)}K`
  return String(value)
}

/** Net result cell used in the projects table */
function NetResultCell({ row, currency }: { row: ProjectRow; currency: string }) {
  const hasFinancials = row.income !== 0 || row.expense !== 0
  if (!hasFinancials) {
    return <span className="block text-right text-muted-foreground">—</span>
  }
  const margin = row.income > 0 ? Math.round((row.netProfit / row.income) * 100) : null
  const positive = row.netProfit >= 0
  return (
    <div className="flex flex-col items-end gap-0.5">
      <span
        className={`flex items-center gap-1 text-sm font-semibold tabular-nums ${
          positive
            ? 'text-emerald-700 dark:text-emerald-400'
            : 'text-rose-700 dark:text-rose-400'
        }`}
      >
        {positive ? (
          <TrendingUp className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <TrendingDown className="h-3.5 w-3.5 shrink-0" />
        )}
        {formatMoney(row.netProfit, currency)}
      </span>
      <span className="text-[10px] tabular-nums text-muted-foreground">
        {margin !== null ? `${margin}% margin` : 'no income'}
      </span>
    </div>
  )
}

/** Financial Overview section inside the project view dialog */
function FinancialOverview({
  financials,
  currency,
}: {
  financials: ProjectFinancials
  currency: string
}) {
  const positive = financials.netProfit >= 0
  const marginTone =
    financials.margin === null
      ? 'bg-muted text-muted-foreground'
      : financials.margin >= 30
        ? 'border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300'
        : financials.margin >= 10
          ? 'border border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300'
          : 'border border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-300'
  const hasMonthly = financials.monthly.some((m) => m.income !== 0 || m.expense !== 0)

  return (
    <div className="space-y-4">
      {/* Headline stats */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-lg border bg-muted/30 p-3">
          <p className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
            <TrendingUp className="h-3 w-3" /> Income
          </p>
          <p className="mt-1 text-sm font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
            {formatMoney(financials.income, currency)}
          </p>
        </div>
        <div className="rounded-lg border bg-muted/30 p-3">
          <p className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
            <TrendingDown className="h-3 w-3" /> Expense
          </p>
          <p className="mt-1 text-sm font-bold tabular-nums text-rose-700 dark:text-rose-400">
            {formatMoney(financials.expense, currency)}
          </p>
        </div>
        <div className="rounded-lg border bg-muted/30 p-3">
          <p className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
            <Banknote className="h-3 w-3" /> Salary payouts
          </p>
          <p className="mt-1 text-sm font-bold tabular-nums text-amber-600 dark:text-amber-400">
            {formatMoney(financials.payrollExpense, currency)}
          </p>
        </div>
        <div className="rounded-lg border bg-muted/30 p-3">
          <p className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
            <ArrowLeftRight className="h-3 w-3" /> Records
          </p>
          <p className="mt-1 text-sm font-bold tabular-nums">{financials.transactionCount}</p>
        </div>
      </div>

      {/* Net + margin */}
      <div className="rounded-lg border p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-muted-foreground">Net result</p>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${marginTone}`}>
            {financials.margin !== null ? `${financials.margin}% margin` : 'no income recorded'}
          </span>
        </div>
        <p
          className={`mt-1 text-lg font-bold tabular-nums ${
            positive
              ? 'text-emerald-700 dark:text-emerald-400'
              : 'text-rose-700 dark:text-rose-400'
          }`}
        >
          {formatMoney(financials.netProfit, currency)}
        </p>
        {financials.income > 0 ? (
          <div className="mt-2 flex h-2 w-full overflow-hidden rounded-full bg-rose-200/60 dark:bg-rose-950/60">
            <div
              className="h-full rounded-full bg-emerald-500"
              style={{ width: `${Math.min(100, Math.max(0, (financials.netProfit / financials.income) * 100))}%` }}
            />
          </div>
        ) : null}
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          Income retained after expenses
        </p>
      </div>

      {/* Monthly chart */}
      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Income vs expense — last 6 months
        </h4>
        {hasMonthly ? (
          <div className="h-[170px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={financials.monthly} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barCategoryGap="28%">
                <CartesianGrid stroke="#94a3b8" strokeOpacity={0.25} strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="month"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 10, fill: '#94a3b8' }}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={40}
                  tick={{ fontSize: 10, fill: '#94a3b8' }}
                  tickFormatter={(v) => finCompactAxis(Number(v))}
                />
                <RTooltip
                  cursor={{ fill: '#94a3b8', fillOpacity: 0.15 }}
                  content={({ active, payload, label }) => {
                    if (!active || !payload || payload.length === 0) return null
                    return (
                      <div className="rounded-lg border bg-popover px-3 py-2 text-popover-foreground shadow-md">
                        <p className="mb-1 text-xs font-semibold">{label}</p>
                        {payload.map((item) => (
                          <div key={String(item.dataKey)} className="flex items-center gap-2 py-0.5">
                            <span
                              className="h-2 w-2 shrink-0 rounded-full"
                              style={{ backgroundColor: item.color ?? '#94a3b8' }}
                            />
                            <span className="text-xs text-muted-foreground">{String(item.name)}</span>
                            <span className="ml-auto pl-3 text-xs font-semibold tabular-nums">
                              {formatMoney(Number(item.value), currency)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )
                  }}
                />
                <Bar dataKey="income" name="Income" fill={FIN_INCOME_COLOR} radius={[3, 3, 0, 0]} maxBarSize={18} />
                <Bar dataKey="expense" name="Expense" fill={FIN_EXPENSE_COLOR} radius={[3, 3, 0, 0]} maxBarSize={18} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="rounded-lg border border-dashed p-3 text-center text-xs text-muted-foreground">
            No transactions in the last 6 months.
          </p>
        )}
      </div>

      {/* Top expense categories + recent transactions */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Top expense categories
          </h4>
          {financials.topExpenseCategories.length > 0 ? (
            <ul className="space-y-2">
              {financials.topExpenseCategories.map((c, i) => {
                const max = financials.topExpenseCategories[0].amount || 1
                return (
                  <li key={c.name}>
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="truncate font-medium">{c.name}</span>
                      <span className="shrink-0 font-semibold tabular-nums text-muted-foreground">
                        {formatMoney(c.amount, currency)}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-rose-400/80"
                        style={{ width: `${Math.max(4, (c.amount / max) * 100)}%`, opacity: 1 - i * 0.12 }}
                      />
                    </div>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">No expenses recorded.</p>
          )}
        </div>
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Recent transactions
          </h4>
          {financials.recentTransactions.length > 0 ? (
            <ul className="nice-scrollbar max-h-48 space-y-1.5 overflow-y-auto pr-1">
              {financials.recentTransactions.map((t) => (
                <li key={t.id} className="flex items-center gap-2 rounded-lg border bg-muted/20 px-2.5 py-1.5">
                  <span
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${
                      t.type === 'income'
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400'
                        : 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-400'
                    }`}
                  >
                    {t.type === 'income' ? (
                      <TrendingUp className="h-3 w-3" />
                    ) : (
                      <TrendingDown className="h-3 w-3" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1 truncate text-xs font-medium">
                      <span className="truncate">{t.title}</span>
                      {t.linkedPayroll ? (
                        <Lock className="h-3 w-3 shrink-0 text-muted-foreground" aria-label="Managed via Payroll" />
                      ) : null}
                    </p>
                    <p className="truncate text-[10px] text-muted-foreground">
                      {t.category ?? 'Uncategorized'} · {formatDateTime(t.date)}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 text-xs font-semibold tabular-nums ${
                      t.type === 'income'
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-rose-700 dark:text-rose-400'
                    }`}
                  >
                    {t.type === 'income' ? '+' : '−'}
                    {formatMoney(t.amount, currency)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">No transactions linked to this project yet.</p>
          )}
        </div>
      </div>
    </div>
  )
}

/** Bordered KPI tile for the portfolio header */
function KpiTile({
  icon: Icon,
  label,
  value,
  sub,
  tone,
  children,
}: {
  icon: LucideIcon
  label: string
  value: string
  sub: string
  tone?: 'emerald' | 'rose'
  /** Optional right-side visual (e.g. status donut) */
  children?: React.ReactNode
}) {
  const tones: Record<string, string> = {
    emerald: 'text-emerald-700 dark:text-emerald-400',
    rose: 'text-rose-700 dark:text-rose-400',
  }
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm sm:p-5">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="mt-1.5 flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p
            className={
              'text-xl font-bold tabular-nums sm:text-2xl ' + (tone ? tones[tone] : '')
            }
          >
            {value}
          </p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{sub}</p>
        </div>
        {children}
      </div>
    </div>
  )
}

/**
 * Mini project-status donut — pure CSS conic-gradient (no chart-library weight).
 * Colors mirror the StatusBadge palette: Active=blue, Completed=emerald, Inactive=gray.
 */
function StatusDonut({
  active,
  completed,
  inactive,
}: {
  active: number
  completed: number
  inactive: number
}) {
  const total = active + completed + inactive
  const segments = [
    { n: active, color: '#0F1F3D' },
    { n: completed, color: '#D4AF37' },
    { n: inactive, color: '#9ca3af' },
  ]
  let acc = 0
  const stops =
    total > 0
      ? segments
          .filter((s) => s.n > 0)
          .map((s) => {
            const from = (acc / total) * 360
            acc += s.n
            const to = (acc / total) * 360
            return `${s.color} ${from}deg ${to}deg`
          })
          .join(', ')
      : null
  return (
    <div
      className="relative h-14 w-14 shrink-0"
      role="img"
      aria-label={`Project status breakdown: ${active} active, ${completed} completed, ${inactive} inactive`}
      title={`${active} active · ${completed} completed · ${inactive} inactive`}
    >
      <div
        className="h-full w-full rounded-full"
        style={stops ? { background: `conic-gradient(${stops})` } : undefined}
      />
      <div className="absolute inset-[6px] rounded-full bg-card shadow-[inset_0_1px_2px_rgba(0,0,0,0.06)]" />
    </div>
  )
}

export function ProjectsView() {
  const { user, settings } = useAppStore()
  const currency = settings.currency
  const canCreate = can(user, 'projects.create')
  const canEdit = can(user, 'projects.edit')
  const canDelete = can(user, 'projects.delete')
  // Financial figures come from the accounts module — only show for accounts viewers
  const canViewFinancials = can(user, 'accounts.view')

  // List state
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search)
  const [status, setStatus] = useState('all')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [data, setData] = useState<Paginated<ProjectRow> | null>(null)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // Form dialog state
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<ProjectRow | null>(null)
  const [form, setForm] = useState<ProjectForm>(EMPTY_FORM)
  const [errors, setErrors] = useState<{ name?: string; managerName?: string }>({})
  const [submitting, setSubmitting] = useState(false)

  // View dialog state
  const [viewOpen, setViewOpen] = useState(false)
  const [viewLoading, setViewLoading] = useState(false)
  const [project, setProject] = useState<Project | null>(null)
  const [financials, setFinancials] = useState<ProjectFinancials | null>(null)
  const [finLoading, setFinLoading] = useState(false)

  // Client companies for the form's link selector (small list, loaded once)
  const [clientOptions, setClientOptions] = useState<ClientRow[]>([])
  useEffect(() => {
    api
      .get<Paginated<ClientRow>>('/api/clients?pageSize=100')
      .then((r) => setClientOptions(r.data))
      .catch(() => {})
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get<Paginated<ProjectRow>>(
        `/api/projects${qs({
          search: debouncedSearch,
          status: status === 'all' ? '' : status,
          page,
          pageSize,
        })}`
      )
      // Climb back if the current page slid past the last page (e.g. after a delete)
      if (res.data.length === 0 && res.page > 1 && res.total > 0) {
        setPage(res.totalPages)
        return
      }
      setData(res)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }, [debouncedSearch, status, page, pageSize])

  useEffect(() => {
    void load()
  }, [load])

  const rows = data?.data ?? []
  const isFiltered = debouncedSearch.trim() !== '' || status !== 'all'

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id))
  const someSelected = rows.some((r) => selected.has(r.id))

  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allSelected) {
        rows.forEach((r) => next.delete(r.id))
      } else {
        rows.forEach((r) => next.add(r.id))
      }
      return next
    })
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function resetFilters() {
    setSearch('')
    setStatus('all')
    setPage(1)
    setSelected(new Set())
  }

  function openCreate() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setErrors({})
    setFormOpen(true)
  }

  // Deep-open the create dialog when arriving via the command palette
  const shouldOpenCreate = useViewIntent('projects', 'create')
  useEffect(() => {
    if (shouldOpenCreate) openCreate()
  }, [shouldOpenCreate])

  // Deep-open a specific project overview when arriving via the palette record search
  const recordIntent = useViewRecordIntent('projects')
  useEffect(() => {
    if (!recordIntent.matched || !recordIntent.recordId) return
    api
      .get<ProjectRow>(`/api/projects/${recordIntent.recordId}`)
      .then((row) => void openView(row))
      .catch(() => toast.error('Could not open the project'))
  }, [recordIntent.matched, recordIntent.recordId])

  function openEdit(row: ProjectRow) {
    setEditing(row)
    setForm({
      name: row.name,
      managerName: row.managerName,
      location: row.location ?? '',
      status: row.status,
      clientId: row.clientId ?? '',
      clientRatePerHour:
        row.clientRatePerHour && row.clientRatePerHour > 0 ? String(row.clientRatePerHour) : '',
    })
    setErrors({})
    setFormOpen(true)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const nextErrors: { name?: string; managerName?: string } = {}
    if (!form.name.trim()) nextErrors.name = 'Project name is required'
    if (!form.managerName.trim()) nextErrors.managerName = 'Manager name is required'
    setErrors(nextErrors)
    if (nextErrors.name || nextErrors.managerName) return

    try {
      setSubmitting(true)
      const body = {
        name: form.name.trim(),
        managerName: form.managerName.trim(),
        location: form.location.trim(),
        status: form.status,
        clientId: form.clientId || null,
        clientRatePerHour: form.clientRatePerHour.trim() === '' ? 0 : Number(form.clientRatePerHour),
      }
      if (editing) {
        await api.put<ProjectRow>(`/api/projects/${editing.id}`, body)
        toast.success('Project updated')
      } else {
        await api.post<ProjectRow>('/api/projects', body)
        toast.success('Project created')
      }
      setFormOpen(false)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSubmitting(false)
    }
  }

  async function openView(row: ProjectRow) {
    setViewOpen(true)
    setViewLoading(true)
    setFinancials(null)
    setProject({ ...row, staff: [] })
    // Financials load in parallel; a failure must not block the dialog
    if (canViewFinancials) {
      setFinLoading(true)
      api
        .get<ProjectFinancials>(`/api/projects/${row.id}/financials`)
        .then(setFinancials)
        .catch(() => toast.error('Could not load the financial overview'))
        .finally(() => setFinLoading(false))
    }
    try {
      const res = await api.get<Project>(`/api/projects/${row.id}`)
      setProject(res)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Something went wrong')
      setViewOpen(false)
    } finally {
      setViewLoading(false)
    }
  }

  async function handleDelete(row: ProjectRow) {
    try {
      await api.del(`/api/projects/${row.id}`)
      toast.success('Project deleted')
      setSelected((prev) => {
        const next = new Set(prev)
        next.delete(row.id)
        return next
      })
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Something went wrong')
    }
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader title="Project Management" description="Track construction projects, managers and assigned workforce">
        {canCreate ? (
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" />
            New Project
          </Button>
        ) : null}
      </PageHeader>

      {/* Portfolio KPI header (company-wide, independent of table filters) */}
      {data?.totals ? (
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          <KpiTile
            icon={FolderKanban}
            label="Portfolio Projects"
            value={data.total.toLocaleString()}
            sub={`${data.totals.active ?? 0} active · ${data.totals.completed ?? 0} completed`}
          >
            <StatusDonut
              active={data.totals.active ?? 0}
              completed={data.totals.completed ?? 0}
              inactive={data.totals.inactive ?? 0}
            />
          </KpiTile>
          <KpiTile
            icon={Users}
            label="Workforce Allocated"
            value={(data.totals.staffAllocated ?? 0).toLocaleString()}
            sub="project assignments company-wide"
          />
          {canViewFinancials ? (
            <>
              <KpiTile
                icon={TrendingUp}
                label={`Project Income (${currency})`}
                value={formatMoney(data.totals.income ?? 0, currency)}
                sub="linked income transactions"
              />
              <KpiTile
                icon={Banknote}
                label={`Combined Net (${currency})`}
                value={formatMoney((data.totals.income ?? 0) - (data.totals.expense ?? 0), currency)}
                sub={
                  (data.totals.income ?? 0) > 0
                    ? `${Math.round((((data.totals.income ?? 0) - (data.totals.expense ?? 0)) / (data.totals.income ?? 1)) * 100)}% margin · expense ${formatMoney(data.totals.expense ?? 0, currency)}`
                    : 'no linked income yet'
                }
                tone={(data.totals.income ?? 0) - (data.totals.expense ?? 0) >= 0 ? 'emerald' : 'rose'}
              />
            </>
          ) : null}
        </div>
      ) : null}

      <SectionCard className="overflow-hidden">
        {/* Filters / toolbar */}
        <div className="border-b p-4">
          <FilterBar
            search={
              <SearchInput
                value={search}
                onChange={(v) => {
                  setSearch(v)
                  setPage(1)
                  setSelected(new Set())
                }}
                placeholder="Search projects..."
                className="w-full sm:max-w-xs"
              />
            }
            activeCount={status !== 'all' ? 1 : 0}
          >
            <FilterSelect
              value={status}
              onChange={(v) => {
                setStatus(v)
                setPage(1)
                setSelected(new Set())
              }}
              options={STATUS_OPTIONS}
              placeholder="Status"
            />
            {selected.size > 0 ? (
              <div className="flex items-center gap-2 sm:ml-auto">
                <span className="text-sm text-muted-foreground tabular-nums">
                  {selected.size} selected
                </span>
                <Button variant="ghost" size="sm" className="h-8" onClick={() => setSelected(new Set())}>
                  Clear
                </Button>
              </div>
            ) : null}
          </FilterBar>
        </div>

        {/* Table */}
        {loading && !data ? (
          <TableSkeleton rows={6} cols={7} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={FolderKanban}
            title="No projects found"
            description={
              isFiltered
                ? 'Try adjusting or clearing the filters to see more results.'
                : 'Get started by creating your first project.'
            }
            action={
              isFiltered ? (
                <Button variant="outline" onClick={resetFilters}>
                  <RotateCcw className="h-4 w-4" />
                  Reset filters
                </Button>
              ) : canCreate ? (
                <Button onClick={openCreate}>
                  <Plus className="h-4 w-4" />
                  New Project
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
          <Table className="min-w-[1000px]">
            <TableHeader>
              <TableRow>
                <TableHead className="w-10 pr-0">
                  <Checkbox
                    checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                    onCheckedChange={() => toggleAll()}
                    aria-label="Select all projects on this page"
                  />
                </TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Client Company</TableHead>
                <TableHead>Project Manager</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-center">Staff</TableHead>
                {canViewFinancials ? <TableHead className="text-right">Net Result</TableHead> : null}
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id} data-state={selected.has(row.id) ? 'selected' : undefined}>
                  <TableCell className="pr-0">
                    <Checkbox
                      checked={selected.has(row.id)}
                      onCheckedChange={() => toggleOne(row.id)}
                      aria-label={`Select ${row.name}`}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                        <FolderKanban className="h-4 w-4 text-primary" />
                      </span>
                      <span className="font-semibold">{row.name}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    {row.clientName ? (
                      <div className="flex flex-col gap-0.5">
                        <span className="flex items-center gap-1.5">
                          <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span className="max-w-[160px] truncate">{row.clientName}</span>
                        </span>
                        {row.clientRatePerHour > 0 ? (
                          <span className="text-[11px] font-medium tabular-nums text-emerald-700 dark:text-emerald-400">
                            {formatNumber(row.clientRatePerHour)} {currency}/hour billed
                          </span>
                        ) : (
                          <span className="text-[11px] text-muted-foreground">rate not set</span>
                        )}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <AvatarInitials name={row.managerName} size="sm" />
                      <span className="truncate">{row.managerName}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    {row.location ? (
                      <span className="flex items-center gap-1.5 text-muted-foreground">
                        <MapPin className="h-3.5 w-3.5 shrink-0" />
                        {row.location}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <StatusBadge kind={row.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(row.createdAt)}</TableCell>
                  <TableCell className="text-center">
                    <span className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-xs font-semibold tabular-nums">
                      <Users className="h-3.5 w-3.5 text-muted-foreground" />
                      {row.staffCount}
                    </span>
                  </TableCell>
                  {canViewFinancials ? (
                    <TableCell className="text-right">
                      <NetResultCell row={row} currency={currency} />
                    </TableCell>
                  ) : null}
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => void openView(row)}
                            aria-label={`View ${row.name}`}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>View</TooltipContent>
                      </Tooltip>
                      {canEdit ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => openEdit(row)}
                              aria-label={`Edit ${row.name}`}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Edit</TooltipContent>
                        </Tooltip>
                      ) : null}
                      {canDelete ? (
                        <ConfirmDelete
                          title="Delete project?"
                          description="This will permanently remove the project. This action cannot be undone."
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
        )}

        {/* Pagination */}
        {data && data.total > 0 ? (
          <DataTablePagination
            page={data.page}
            pageSize={data.pageSize}
            total={data.total}
            totalPages={data.totalPages}
            onPageChange={(p) => {
              setPage(p)
              setSelected(new Set())
            }}
            onPageSizeChange={(s) => {
              setPageSize(s)
              setPage(1)
              setSelected(new Set())
            }}
            unit="projects"
          />
        ) : null}
      </SectionCard>

      {/* New / Edit dialog */}
      <Dialog open={formOpen} onOpenChange={(open) => setFormOpen(open)}>
        <DialogContent className="nice-scrollbar max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Project' : 'New Project'}</DialogTitle>
            <DialogDescription>
              {editing
                ? 'Update the project details below.'
                : 'Add a project to organize staff, attendance and payroll.'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div className="space-y-2">
              <Label htmlFor="project-name">
                Project Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="project-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Aramco Rig Upgrade — Phase 3"
                autoFocus
                aria-invalid={!!errors.name}
              />
              {errors.name ? <p className="text-xs text-destructive">{errors.name}</p> : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="project-manager">
                Manager Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="project-manager"
                value={form.managerName}
                onChange={(e) => setForm((f) => ({ ...f, managerName: e.target.value }))}
                placeholder="e.g. Khalid Al-Otaibi"
                aria-invalid={!!errors.managerName}
              />
              {errors.managerName ? (
                <p className="text-xs text-destructive">{errors.managerName}</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="project-location">Location</Label>
              <Input
                id="project-location"
                value={form.location}
                onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
                placeholder="e.g. Jubail Industrial City"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="project-client">Client Company</Label>
              <Select
                value={form.clientId || 'none'}
                onValueChange={(v) => setForm((f) => ({ ...f, clientId: v === 'none' ? '' : v }))}
              >
                <SelectTrigger id="project-client" className="w-full">
                  <SelectValue placeholder="Select a client" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">
                    <span className="text-muted-foreground">No client linked</span>
                  </SelectItem>
                  {clientOptions.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                      {c.status === 'inactive' ? ' (inactive)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Workers deployed to this project count towards the client's workforce.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="project-client-rate">Client Rate / Hour ({currency})</Label>
              <Input
                id="project-client-rate"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.25"
                value={form.clientRatePerHour}
                onChange={(e) => setForm((f) => ({ ...f, clientRatePerHour: e.target.value }))}
                placeholder="e.g. 20"
                aria-describedby="project-client-rate-hint"
              />
              <p id="project-client-rate-hint" className="text-xs text-muted-foreground">
                The manpower supply price charged to the client company (e.g. 20 {currency}/hour).
                Worker salaries use each worker&apos;s own rate — this rate is only used for client
                billing in the Client Salary Summary.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="project-status">Status</Label>
              <Select
                value={form.status}
                onValueChange={(v) => setForm((f) => ({ ...f, status: v as ProjectStatus }))}
              >
                <SelectTrigger id="project-status" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={() => setFormOpen(false)} disabled={submitting}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {editing ? 'Save Changes' : 'Create Project'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* View dialog */}
      <Dialog open={viewOpen} onOpenChange={setViewOpen}>
        <DialogContent className="nice-scrollbar max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          {project ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2.5 pr-6">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <FolderKanban className="h-4 w-4 text-primary" />
                  </span>
                  <span className="truncate">{project.name}</span>
                </DialogTitle>
                <DialogDescription>Project details and assigned workforce.</DialogDescription>
              </DialogHeader>

              <div className="grid gap-3 sm:grid-cols-2">
                <DetailItem icon={User} label="Project Manager">
                  <span className="flex items-center gap-2">
                    <AvatarInitials name={project.managerName} size="sm" />
                    <span className="truncate">{project.managerName}</span>
                  </span>
                </DetailItem>
                <DetailItem icon={Building2} label="Client Company">
                  <span className="flex flex-col">
                    <span>{project.clientName ?? '—'}</span>
                    {project.clientRatePerHour > 0 ? (
                      <span className="text-xs font-medium tabular-nums text-emerald-700 dark:text-emerald-400">
                        {formatNumber(project.clientRatePerHour)} {currency}/hour billed to client
                      </span>
                    ) : project.clientName ? (
                      <span className="text-xs text-muted-foreground">
                        client rate not set — billing falls back to worker rates
                      </span>
                    ) : null}
                  </span>
                </DetailItem>
                <DetailItem icon={MapPin} label="Location">
                  {project.location ?? '—'}
                </DetailItem>
                <DetailItem icon={FolderKanban} label="Status">
                  <StatusBadge kind={project.status} />
                </DetailItem>
              </div>

              <Separator />

              {/* Financial overview (accounts viewers only) */}
              {canViewFinancials ? (
                <div>
                  <h3 className="mb-2.5 text-sm font-semibold">
                    Financial Overview
                    <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                      (linked income & expense)
                    </span>
                  </h3>
                  {financials ? (
                    <FinancialOverview financials={financials} currency={currency} />
                  ) : finLoading ? (
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {Array.from({ length: 4 }).map((_, i) => (
                          <Skeleton key={i} className="h-[64px] w-full" />
                        ))}
                      </div>
                      <Skeleton className="h-[92px] w-full" />
                      <Skeleton className="h-[170px] w-full" />
                    </div>
                  ) : (
                    <p className="rounded-lg border border-dashed p-3 text-center text-xs text-muted-foreground">
                      Financial data is unavailable right now.
                    </p>
                  )}
                </div>
              ) : null}

              <Separator />

              <div>
                <h3 className="mb-1 text-sm font-semibold">
                  Assigned Staff
                  <span className="ml-1.5 text-muted-foreground tabular-nums">
                    ({project.staff?.length ?? 0})
                  </span>
                </h3>
                {viewLoading ? (
                  <div className="space-y-3 py-2">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} className="flex items-center gap-3">
                        <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
                        <div className="flex-1 space-y-1.5">
                          <Skeleton className="h-3.5 w-40 max-w-full" />
                          <Skeleton className="h-3 w-56 max-w-full" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : project.staff && project.staff.length > 0 ? (
                  <ul className="nice-scrollbar max-h-80 divide-y overflow-y-auto">
                    {project.staff.map((s) => (
                      <StaffListItem key={s.id} staff={s} currency={currency} />
                    ))}
                  </ul>
                ) : (
                  <EmptyState
                    icon={Users}
                    title="No staff assigned"
                    description="Assign staff to this project from the Staff module."
                    className="py-8"
                  />
                )}
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}

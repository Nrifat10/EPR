'use client'

// Income List view + the SHARED TransactionsListView component
// (also consumed by expense-list.tsx for the Expense List view).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  BarChart3,
  Building2,
  CalendarDays,
  Download,
  Loader2,
  Lock,
  Pencil,
  Plus,
  Printer,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-react'

import { api, qs } from '@/lib/api-client'
import { buildCsv, csvFilename, downloadCsv } from '@/lib/csv'
import { formatDate, formatMoney, toDateInputValue } from '@/lib/format'
import { can, useAppStore } from '@/lib/store'
import type {
  Paginated,
  ProjectRow,
  TransactionCategoryRow,
  TransactionRow,
  TransactionType,
  UserRow,
  ViewKey,
} from '@/lib/types'
import { useDebounce } from '@/hooks/use-debounce'
import { useViewIntent, useViewRecordIntent } from '@/hooks/use-view-intent'
import { cn } from '@/lib/utils'

import { Button } from '@/components/ui/button'
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

import { AvatarInitials } from '../shared/avatar-initials'
import { ConfirmDelete } from '../shared/confirm-delete'
import { DataTablePagination } from '../shared/data-table-pagination'
import { EmptyState, TableSkeleton } from '../shared/empty-state'
import { FilterBar, FilterSelect, SearchInput } from '../shared/filter-select'
import { CategoryChip } from '../shared/status-badge'
import { PageHeader, SectionCard, MobileFab } from '../shared/page-header'

type TransactionsResponse = Paginated<TransactionRow> & { totals: { sum: number } }
type CategoriesResponse = { data: TransactionCategoryRow[] }
type ProjectsResponse = Paginated<ProjectRow>
type UsersResponse = { data: UserRow[] }

type TxForm = {
  title: string
  amount: string
  categoryId: string
  projectId: string // 'none' or a project id
  operatorUserId: string
  date: string
  description: string
}

const INCOME_BTN = 'bg-emerald-600 text-white hover:bg-emerald-700'
const EXPENSE_BTN =
  'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 hover:text-rose-800 dark:border-rose-800/60 dark:bg-rose-950/40 dark:text-rose-400 dark:hover:bg-rose-900/40 dark:hover:text-rose-300'

export function IncomeListView() {
  return <TransactionsListView type="income" viewKey="income-list" />
}

export function TransactionsListView({
  type,
  viewKey,
}: {
  type: TransactionType
  /** Which sidebar view mounted this list — used for deep-link intents (create dialog) */
  viewKey?: ViewKey
}) {
  const { user, settings, setView } = useAppStore()
  const currency = settings.currency
  const canCreate = can(user, 'accounts.create')
  const canEdit = can(user, 'accounts.edit')
  const canDelete = can(user, 'accounts.delete')
  const isIncome = type === 'income'

  // ---- list state ----
  const [rows, setRows] = useState<TransactionRow[]>([])
  const [sum, setSum] = useState(0)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)

  // ---- filters ----
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search)
  const [categoryId, setCategoryId] = useState('all')
  const [projectId, setProjectId] = useState('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  // ---- reference data ----
  const [categories, setCategories] = useState<TransactionCategoryRow[]>([])
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [users, setUsers] = useState<UserRow[]>([])

  // ---- add/edit dialog ----
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<TransactionRow | null>(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<TxForm>({
    title: '',
    amount: '',
    categoryId: '',
    projectId: 'none',
    operatorUserId: '',
    date: '',
    description: '',
  })

  function setField<K extends keyof TxForm>(key: K, value: TxForm[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  // guard against out-of-order responses when filters/page change quickly
  const requestId = useRef(0)

  const load = useCallback(async () => {
    const id = ++requestId.current
    setLoading(true)
    try {
      const res = await api.get<TransactionsResponse>(
        `/api/transactions${qs({
          type,
          categoryId: categoryId === 'all' ? '' : categoryId,
          projectId: projectId === 'all' ? '' : projectId,
          from,
          to,
          search: debouncedSearch,
          page,
          pageSize,
        })}`
      )
      if (id !== requestId.current) return
      // last row removed from a trailing page → step back to the last real page
      if (res.data.length === 0 && res.total > 0 && res.page > res.totalPages) {
        setPage(res.totalPages)
        return
      }
      setRows(res.data)
      setSum(res.totals?.sum ?? 0)
      setTotal(res.total)
      setTotalPages(res.totalPages)
    } catch (e) {
      if (id !== requestId.current) return
      setRows([])
      setSum(0)
      setTotal(0)
      setTotalPages(1)
      toast.error(e instanceof Error ? e.message : 'Failed to load transactions')
    } finally {
      if (id === requestId.current) setLoading(false)
    }
  }, [type, categoryId, projectId, from, to, debouncedSearch, page, pageSize])

  useEffect(() => {
    void load()
  }, [load])

  // reference data (filters + dialog dropdowns) — non-blocking
  const loadReference = useCallback(async () => {
    const [catRes, projRes, userRes] = await Promise.allSettled([
      api.get<CategoriesResponse>(`/api/transaction-categories${qs({ type })}`),
      api.get<ProjectsResponse>('/api/projects?pageSize=100'),
      api.get<UsersResponse>('/api/users'),
    ])
    if (catRes.status === 'fulfilled') setCategories(catRes.value.data)
    if (projRes.status === 'fulfilled') setProjects(projRes.value.data)
    // /api/users needs users.view — silently fall back to the current user only
    if (userRes.status === 'fulfilled') setUsers(userRes.value.data)
    if (catRes.status === 'rejected') {
      toast.error('Failed to load categories — filters may be unavailable')
    }
  }, [type])

  useEffect(() => {
    void loadReference()
  }, [loadReference])

  const operatorOptions = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>()
    for (const u of users) map.set(u.id, { id: u.id, name: u.name })
    if (user && !map.has(user.id)) map.set(user.id, { id: user.id, name: user.name })
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name))
  }, [users, user])

  const hasFilters =
    debouncedSearch !== '' ||
    categoryId !== 'all' ||
    projectId !== 'all' ||
    from !== '' ||
    to !== ''

  function resetFilters() {
    setSearch('')
    setCategoryId('all')
    setProjectId('all')
    setFrom('')
    setTo('')
    setPage(1)
  }

  function openAdd() {
    setEditing(null)
    setForm({
      title: '',
      amount: '',
      categoryId: '',
      projectId: 'none',
      operatorUserId: user?.id ?? '',
      date: toDateInputValue(new Date()),
      description: '',
    })
    setDialogOpen(true)
  }

  // Deep-open the add dialog when arriving via the command palette
  const intentView = viewKey ?? (type === 'income' ? 'income-list' : 'expense-list')
  const shouldOpenCreate = useViewIntent(intentView, 'create')
  useEffect(() => {
    if (shouldOpenCreate) openAdd()
  }, [shouldOpenCreate])

  // Deep-open a transaction record when arriving via the palette record search:
  // look the row up, then filter the list down to it so it is immediately visible.
  const recordIntent = useViewRecordIntent(intentView)
  useEffect(() => {
    if (!recordIntent.matched || !recordIntent.recordId) return
    const recordId = recordIntent.recordId
    void (async () => {
      try {
        const row = await api.get<TransactionRow>(`/api/transactions/${recordId}`)
        setSearch(row.title)
        setPage(1)
        toast.success(`Showing results for "${row.title}"`)
      } catch {
        toast.error('Could not open that transaction')
      }
    })()
  }, [recordIntent.matched])

  function openEdit(row: TransactionRow) {
    setEditing(row)
    setForm({
      title: row.title,
      amount: String(row.amount),
      categoryId: row.category.id,
      projectId: row.project?.id ?? 'none',
      operatorUserId: row.operator?.id ?? user?.id ?? '',
      date: toDateInputValue(row.transactionDate),
      description: row.description ?? '',
    })
    setDialogOpen(true)
  }

  async function handleSubmit() {
    const title = form.title.trim()
    const amount = Number(form.amount)
    if (!title) {
      toast.error('Title is required')
      return
    }
    if (!form.amount.trim() || !isFinite(amount) || amount <= 0) {
      toast.error('Amount must be greater than 0')
      return
    }
    if (!form.categoryId) {
      toast.error('Please select a category')
      return
    }
    if (!form.date) {
      toast.error('Transaction date is required')
      return
    }
    setSaving(true)
    try {
      const payload = {
        type,
        title,
        amount,
        transactionCategoryId: form.categoryId,
        projectId: form.projectId === 'none' ? null : form.projectId,
        operatorUserId: form.operatorUserId || null,
        transactionDate: form.date,
        description: form.description.trim() || null,
      }
      if (editing) {
        await api.put(`/api/transactions/${editing.id}`, payload)
        toast.success(isIncome ? 'Income updated' : 'Expense updated')
      } else {
        await api.post('/api/transactions', payload)
        toast.success(isIncome ? 'Income added' : 'Expense added')
      }
      setDialogOpen(false)
      void load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save transaction')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(row: TransactionRow) {
    try {
      await api.del(`/api/transactions/${row.id}`)
      toast.success(isIncome ? 'Income deleted' : 'Expense deleted')
      void load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete transaction')
    }
  }

  const rangeLabel =
    from && to
      ? `${formatDate(from)} – ${formatDate(to)}`
      : from
        ? `From ${formatDate(from)}`
        : to
          ? `Up to ${formatDate(to)}`
          : 'All time'

  const contextParts: string[] = [rangeLabel]
  if (categoryId !== 'all') {
    contextParts.push(
      `Category: ${categories.find((c) => c.id === categoryId)?.name ?? '—'}`
    )
  }
  if (projectId !== 'all') {
    contextParts.push(
      `Project: ${projects.find((p) => p.id === projectId)?.name ?? '—'}`
    )
  }

  // Export the WHOLE filtered set (walks pages server-side max 100)
  async function handleExportCsv() {
    if (exporting) return
    setExporting(true)
    try {
      const all: TransactionRow[] = []
      let p = 1
      for (;;) {
        const res = await api.get<TransactionsResponse>(
          `/api/transactions${qs({
            type,
            categoryId: categoryId === 'all' ? '' : categoryId,
            projectId: projectId === 'all' ? '' : projectId,
            from,
            to,
            search: debouncedSearch,
            page: p,
            pageSize: 100,
          })}`
        )
        all.push(...res.data)
        if (p >= res.totalPages || res.data.length === 0) break
        p += 1
      }
      const csv = buildCsv(
        ['Date', 'Title', 'Category', 'Project', 'Operator', 'Amount', 'Description', 'Payroll-linked'],
        all.map((r) => [
          formatDate(r.transactionDate),
          r.title,
          r.category?.name ?? '',
          r.project?.name ?? '',
          r.operator?.name ?? '',
          r.amount.toFixed(2),
          r.description ?? '',
          r.payrollId ? 'Yes (managed via Payroll)' : 'No',
        ])
      )
      downloadCsv(csvFilename(isIncome ? 'income-statement' : 'expense-statement'), csv)
      toast.success(`Exported ${all.length} ${isIncome ? 'income' : 'expense'} records to CSV`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      <div className="print-hidden">
        <PageHeader
          title={isIncome ? 'Income List' : 'Expense List'}
          description={
            isIncome
              ? 'Record and manage all company income transactions'
              : 'Record and manage all company expense transactions'
          }
        >
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleExportCsv()}
            disabled={exporting || total === 0}
          >
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Export CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="h-4 w-4" />
            Print Statement
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setView('accounts-summary')}
          >
            <BarChart3 className="h-4 w-4" />
            View Summary
          </Button>
          {canCreate ? (
            <Button
              size="sm"
              onClick={openAdd}
              className={isIncome ? INCOME_BTN : EXPENSE_BTN}
            >
              <Plus className="h-4 w-4" />
              {isIncome ? 'Add Income' : 'Add Expense'}
            </Button>
          ) : null}
        </PageHeader>
      </div>

      {canCreate ? (
        <MobileFab
          label={isIncome ? 'Add Income' : 'Add Expense'}
          onClick={openAdd}
          icon={Plus}
        />
      ) : null}

      <FilterBar
        className="print-hidden"
        search={
          <SearchInput
            value={search}
            onChange={(v) => {
              setSearch(v)
              setPage(1)
            }}
            placeholder={
              isIncome
                ? 'Search income by name, note, category…'
                : 'Search expenses by name, note, category…'
            }
            className="w-full sm:w-[240px]"
          />
        }
        activeCount={
          (categoryId !== 'all' ? 1 : 0) +
          (projectId !== 'all' ? 1 : 0) +
          (from ? 1 : 0) +
          (to ? 1 : 0)
        }
      >
        <FilterSelect
          value={categoryId}
          onChange={(v) => {
            setCategoryId(v)
            setPage(1)
          }}
          options={categories.map((c) => ({ value: c.id, label: c.name }))}
          placeholder="Category"
        />
        <FilterSelect
          value={projectId}
          onChange={(v) => {
            setProjectId(v)
            setPage(1)
          }}
          options={projects.map((p) => ({ value: p.id, label: p.name }))}
          placeholder="Project"
          className="sm:w-[200px]"
        />
        <div className="flex items-center gap-2">
          <Input
            type="date"
            aria-label="From date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value)
              setPage(1)
            }}
            className="h-9 w-full text-muted-foreground sm:w-[150px]"
          />
          <span className="shrink-0 text-xs text-muted-foreground">to</span>
          <Input
            type="date"
            aria-label="To date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value)
              setPage(1)
            }}
            className="h-9 w-full text-muted-foreground sm:w-[150px]"
          />
        </div>
        {hasFilters ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-9 text-muted-foreground"
            onClick={resetFilters}
          >
            <X className="h-4 w-4" />
            Reset
          </Button>
        ) : null}
      </FilterBar>

      <SectionCard className="print-area overflow-hidden">
        {/* print-only statement header */}
        <div className="hidden border-b pb-3 print:block">
          <p className="text-lg font-bold">{settings.companyName}</p>
          <p className="mt-0.5 text-sm font-semibold">
            {isIncome ? 'Income Statement' : 'Expense Statement'}
          </p>
          <p className="mt-0.5 text-xs">{contextParts.join('  ·  ')}</p>
          <p className="text-xs">Generated on {formatDate(new Date())}</p>
        </div>

        <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div>
            <h2 className="text-base font-semibold">
              {isIncome ? 'Income Transactions' : 'Expense Transactions'}
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {hasFilters ? 'Filtered results' : 'All records'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                'inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold tabular-nums sm:text-sm',
                isIncome
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300'
                  : 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-300'
              )}
            >
              {isIncome ? 'Total Income' : 'Total Expense'}:{' '}
              {formatMoney(sum, currency)}
            </span>
            <span className="inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium text-muted-foreground tabular-nums">
              {total} {total === 1 ? 'record' : 'records'}
            </span>
          </div>
        </div>

        {loading ? (
          <TableSkeleton rows={6} cols={7} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={isIncome ? TrendingUp : TrendingDown}
            title={isIncome ? 'No income transactions' : 'No expense transactions'}
            description="Nothing matches your current filters. Try adjusting them or add a new entry."
            action={
              canCreate ? (
                <Button
                  size="sm"
                  onClick={openAdd}
                  className={isIncome ? INCOME_BTN : EXPENSE_BTN}
                >
                  <Plus className="h-4 w-4" />
                  {isIncome ? 'Add Income' : 'Add Expense'}
                </Button>
              ) : undefined
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
                    <span
                      className={cn(
                        'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
                        isIncome
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400'
                          : 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-400'
                      )}
                    >
                      {isIncome ? (
                        <TrendingUp className="h-4 w-4" />
                      ) : (
                        <TrendingDown className="h-4 w-4" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 font-medium leading-snug">{row.title}</p>
                      {row.description ? (
                        <p className="truncate text-xs text-muted-foreground">
                          {row.description}
                        </p>
                      ) : null}
                    </div>
                    <span
                      className={cn(
                        'shrink-0 text-sm font-bold tabular-nums',
                        isIncome
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-rose-700 dark:text-rose-400'
                      )}
                    >
                      {formatMoney(row.amount, currency)}
                    </span>
                  </div>
                  <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
                    <CategoryChip label={row.category.name} />
                    {row.project ? (
                      <span className="flex min-w-0 items-center gap-1">
                        <Building2 className="h-3 w-3 shrink-0" />
                        <span className="truncate">{row.project.name}</span>
                      </span>
                    ) : null}
                    <span className="flex shrink-0 items-center gap-1 tabular-nums">
                      <CalendarDays className="h-3 w-3" />
                      {formatDate(row.transactionDate)}
                    </span>
                  </div>
                  <div className="mt-2.5 flex items-center justify-between border-t pt-2.5">
                    {row.operator ? (
                      <span className="flex min-w-0 items-center gap-2">
                        <AvatarInitials name={row.operator.name} size="sm" />
                        <span className="truncate text-xs">{row.operator.name}</span>
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">System</span>
                    )}
                    <div className="flex shrink-0 items-center gap-1">
                      {row.payrollId ? (
                        <span
                          className="inline-flex h-11 w-11 cursor-help items-center justify-center rounded-md text-muted-foreground"
                          aria-label="Managed via Payroll module"
                          title="Managed via Payroll module"
                        >
                          <Lock className="h-4 w-4" />
                        </span>
                      ) : (
                        <>
                          {canEdit ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-11 w-11 text-muted-foreground hover:text-foreground"
                              onClick={() => openEdit(row)}
                              aria-label={`Edit ${row.title}`}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          ) : null}
                          {canDelete ? (
                            <ConfirmDelete
                              onConfirm={() => handleDelete(row)}
                              title={
                                isIncome ? 'Delete income entry?' : 'Delete expense entry?'
                              }
                              description={`"${row.title}" (${formatMoney(row.amount, currency)}) will be permanently removed.`}
                            />
                          ) : null}
                        </>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>

            {/* Desktop: table */}
            <div className="hidden overflow-x-auto md:block print:block print:overflow-visible">
          <Table className="min-w-[900px] print:min-w-0 print:text-xs">
            <TableHeader>
              <TableRow>
                <TableHead>Transaction</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Project</TableHead>
                <TableHead className="print:hidden">Operator</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right print:hidden">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="max-w-[280px] print:max-w-none">
                    <div className="flex items-start gap-3">
                      <span
                        className={cn(
                          'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
                          isIncome
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400'
                            : 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-400'
                        )}
                      >
                        {isIncome ? (
                          <TrendingUp className="h-4 w-4" />
                        ) : (
                          <TrendingDown className="h-4 w-4" />
                        )}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate font-medium">{row.title}</p>
                        {row.description ? (
                          <p className="max-w-[260px] truncate text-xs text-muted-foreground print:hidden">
                            {row.description}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <CategoryChip label={row.category.name} />
                  </TableCell>
                  <TableCell className="text-right">
                    <span
                      className={cn(
                        'font-semibold tabular-nums',
                        isIncome
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-rose-700 dark:text-rose-400'
                      )}
                    >
                      {formatMoney(row.amount, currency)}
                    </span>
                  </TableCell>
                  <TableCell>
                    {row.project ? (
                      <span className="text-sm">{row.project.name}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="print:hidden">
                    {row.operator ? (
                      <div className="flex items-center gap-2">
                        <AvatarInitials name={row.operator.name} size="sm" />
                        <span className="text-sm">{row.operator.name}</span>
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground">System</span>
                    )}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {formatDate(row.transactionDate)}
                  </TableCell>
                  <TableCell className="text-right print:hidden">
                    {row.payrollId ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span
                            className="inline-flex h-8 w-8 cursor-help items-center justify-center rounded-md text-muted-foreground"
                            aria-label="Managed via Payroll module"
                          >
                            <Lock className="h-4 w-4" />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>Managed via Payroll module</TooltipContent>
                      </Tooltip>
                    ) : (
                      <div className="flex items-center justify-end gap-1">
                        {canEdit ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-foreground"
                            onClick={() => openEdit(row)}
                            aria-label={`Edit ${row.title}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        ) : null}
                        {canDelete ? (
                          <ConfirmDelete
                            onConfirm={() => handleDelete(row)}
                            title={
                              isIncome ? 'Delete income entry?' : 'Delete expense entry?'
                            }
                            description={`"${row.title}" (${formatMoney(row.amount, currency)}) will be permanently removed.`}
                          />
                        ) : null}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
            </div>
          </>
        )}

        <div className="print-hidden">
          <DataTablePagination
            page={page}
            pageSize={pageSize}
            total={total}
            totalPages={totalPages}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size)
              setPage(1)
            }}
            unit="records"
          />
        </div>
      </SectionCard>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>
              {editing
                ? isIncome
                  ? 'Edit Income'
                  : 'Edit Expense'
                : isIncome
                  ? 'Add Income'
                  : 'Add Expense'}
            </DialogTitle>
            <DialogDescription>
              {editing
                ? 'Update the transaction details below.'
                : `Fill in the details to record a new ${type} entry.`}
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void handleSubmit()
            }}
            className="space-y-4"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="tx-title">Title</Label>
                <Input
                  id="tx-title"
                  value={form.title}
                  onChange={(e) => setField('title', e.target.value)}
                  placeholder={
                    isIncome
                      ? 'e.g. Project payment — Phase 2'
                      : 'e.g. Staff transportation — October'
                  }
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tx-amount">Amount ({currency})</Label>
                <Input
                  id="tx-amount"
                  type="number"
                  inputMode="decimal"
                  min="0.01"
                  step="0.01"
                  value={form.amount}
                  onChange={(e) => setField('amount', e.target.value)}
                  placeholder="0.00"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tx-date">Date</Label>
                <Input
                  id="tx-date"
                  type="date"
                  value={form.date}
                  onChange={(e) => setField('date', e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tx-category">Category</Label>
                <Select
                  value={form.categoryId || undefined}
                  onValueChange={(v) => setField('categoryId', v)}
                >
                  <SelectTrigger id="tx-category" className="w-full">
                    <SelectValue placeholder="Select category" />
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
                <Label htmlFor="tx-project">Project</Label>
                <Select
                  value={form.projectId}
                  onValueChange={(v) => setField('projectId', v)}
                >
                  <SelectTrigger id="tx-project" className="w-full">
                    <SelectValue placeholder="No project" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="tx-operator">Operator</Label>
                <Select
                  value={form.operatorUserId || undefined}
                  onValueChange={(v) => setField('operatorUserId', v)}
                >
                  <SelectTrigger id="tx-operator" className="w-full">
                    <SelectValue placeholder="Select operator" />
                  </SelectTrigger>
                  <SelectContent>
                    {operatorOptions.map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        {o.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="tx-description">Description</Label>
                <Textarea
                  id="tx-description"
                  rows={3}
                  value={form.description}
                  onChange={(e) => setField('description', e.target.value)}
                  placeholder="Optional notes about this transaction"
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={saving}
                className={isIncome ? INCOME_BTN : undefined}
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                {editing
                  ? 'Save Changes'
                  : isIncome
                    ? 'Add Income'
                    : 'Add Expense'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

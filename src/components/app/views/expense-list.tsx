'use client'

// Expense List view — worker expense tracking, purpose-built (income keeps the
// shared TransactionsListView in income-list.tsx untouched):
//   • every expense carries WHO spent it (worker name + IQAMA) and the MONTH it
//     belongs to (defaults from the transaction date),
//   • a bill RECEIPT (JPG/PNG/WebP/PDF, ≤ 5 MB) can be uploaded, previewed,
//     replaced or removed per entry,
//   • the "Worker Expense Statement" card answers "ke koto taka expense korece
//     tar every month": per-worker monthly totals for a year, printable as an
//     A4 statement (single worker portrait / all workers landscape matrix).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  BarChart3,
  Building2,
  CalendarDays,
  Check,
  ChevronsUpDown,
  Download,
  FileText,
  Loader2,
  Lock,
  Paperclip,
  Pencil,
  Plus,
  Printer,
  ReceiptText,
  Trash2,
  TrendingDown,
  Upload,
  UserRound,
  X,
} from 'lucide-react'

import { api, qs, getAuthToken } from '@/lib/api-client'
import { buildCsv, csvFilename, downloadCsv } from '@/lib/csv'
import { formatDate, formatMoney, monthName, toDateInputValue } from '@/lib/format'
import { can, useAppStore } from '@/lib/store'
import type {
  Paginated,
  ProjectRow,
  StaffRow,
  TransactionCategoryRow,
  TransactionRow,
  UserRow,
} from '@/lib/types'
import { MONTHS } from '@/lib/types'
import { useDebounce } from '@/hooks/use-debounce'
import { useViewIntent, useViewRecordIntent } from '@/hooks/use-view-intent'
import { cn } from '@/lib/utils'

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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'

import { AvatarInitials } from '../shared/avatar-initials'
import { ConfirmDelete } from '../shared/confirm-delete'
import { DataTablePagination } from '../shared/data-table-pagination'
import { EmptyState, TableSkeleton } from '../shared/empty-state'
import { FilterBar, FilterSelect, SearchInput } from '../shared/filter-select'
import { CategoryChip } from '../shared/status-badge'
import { PageHeader, SectionCard, MobileFab } from '../shared/page-header'
import { ExpenseStatementPrintDialog } from '../print/expense-statement-print'
import type { ExpenseStatement } from '@/lib/types'

type TransactionsResponse = Paginated<TransactionRow> & { totals: { sum: number } }
type CategoriesResponse = { data: TransactionCategoryRow[] }
type ProjectsResponse = Paginated<ProjectRow>
type UsersResponse = { data: UserRow[] }
type StaffResponse = Paginated<StaffRow>

const EXPENSE_BTN =
  'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 hover:text-rose-800 dark:border-rose-800/60 dark:bg-rose-950/40 dark:text-rose-400 dark:hover:bg-rose-900/40 dark:hover:text-rose-300'

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const RECEIPT_ACCEPT = 'image/jpeg,image/jpg,image/png,image/webp,application/pdf'

type TxForm = {
  title: string
  amount: string
  categoryId: string
  projectId: string // 'none' or a project id
  operatorUserId: string
  date: string
  description: string
  spenderStaffId: string // '' = company expense (no worker)
  expenseMonth: string
  expenseYear: string
}

function formatBytes(n: number | null): string {
  if (!n || n <= 0) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/** Walk all pages of a paginated endpoint (server clamps pageSize to 50/100). */
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

/** Multipart upload — NOT via the JSON api wrapper. */
async function uploadReceipt(txId: string, file: File) {
  const fd = new FormData()
  fd.append('file', file)
  const res = await fetch(`/api/transactions/${txId}/receipt`, {
    method: 'POST',
    body: fd,
    // Bearer fallback for iframe contexts where cookies are blocked
    headers: getAuthToken() ? { Authorization: `Bearer ${getAuthToken()}` } : undefined,
  })
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    // non-JSON
  }
  if (!res.ok) {
    const message =
      body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
        ? body.error
        : `Upload failed (${res.status})`
    throw new Error(message)
  }
  return body as { receiptName: string | null; receiptExt: string | null; receiptSize: number | null }
}

export function ExpenseListView() {
  const { user, settings, setView } = useAppStore()
  const currency = settings.currency
  const canCreate = can(user, 'accounts.create')
  const canEdit = can(user, 'accounts.edit')
  const canDelete = can(user, 'accounts.delete')

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
  const [spenderId, setSpenderId] = useState('all') // 'all' | 'none' | staff id
  const [monthFilter, setMonthFilter] = useState('all')
  const [yearFilter, setYearFilter] = useState('all')

  // ---- reference data ----
  const [categories, setCategories] = useState<TransactionCategoryRow[]>([])
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [users, setUsers] = useState<UserRow[]>([])
  const [staff, setStaff] = useState<StaffRow[]>([])

  // ---- add/edit dialog ----
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<TransactionRow | null>(null)
  const [saving, setSaving] = useState(false)
  const [receiptFile, setReceiptFile] = useState<File | null>(null)
  const [removingReceipt, setRemovingReceipt] = useState(false)
  const [spenderOpen, setSpenderOpen] = useState(false)
  const monthTouched = useRef(false)
  const yearTouched = useRef(false)
  const [form, setForm] = useState<TxForm>({
    title: '',
    amount: '',
    categoryId: '',
    projectId: 'none',
    operatorUserId: '',
    date: '',
    description: '',
    spenderStaffId: '',
    expenseMonth: '',
    expenseYear: '',
  })

  function setField<K extends keyof TxForm>(key: K, value: TxForm[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  // ---- receipt preview dialog ----
  const [receiptRow, setReceiptRow] = useState<TransactionRow | null>(null)
  const [receiptDialogOpen, setReceiptDialogOpen] = useState(false)
  const [receiptBusy, setReceiptBusy] = useState(false)
  const uploadInputRef = useRef<HTMLInputElement | null>(null)
  const uploadTargetRef = useRef<string | null>(null) // tx id for the row-level quick upload

  // ---- statement ----
  const currentYear = new Date().getFullYear()
  const yearOptions = useMemo(
    () => Array.from({ length: 6 }, (_, i) => String(currentYear - 4 + i)),
    [currentYear]
  )
  const [statementYear, setStatementYear] = useState(String(currentYear))
  const [statement, setStatement] = useState<ExpenseStatement | null>(null)
  const [statementLoading, setStatementLoading] = useState(true)
  const [printOpen, setPrintOpen] = useState(false)
  const [printSpenderId, setPrintSpenderId] = useState<string | null>(null)

  // guard against out-of-order responses when filters/page change quickly
  const requestId = useRef(0)

  const load = useCallback(async () => {
    const id = ++requestId.current
    setLoading(true)
    try {
      const res = await api.get<TransactionsResponse>(
        `/api/transactions${qs({
          type: 'expense',
          categoryId: categoryId === 'all' ? '' : categoryId,
          projectId: projectId === 'all' ? '' : projectId,
          spenderId: spenderId === 'all' ? '' : spenderId,
          expenseMonth: monthFilter === 'all' ? '' : monthFilter,
          expenseYear: yearFilter === 'all' ? '' : yearFilter,
          search: debouncedSearch,
          page,
          pageSize,
        })}`
      )
      if (id !== requestId.current) return
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
      toast.error(e instanceof Error ? e.message : 'Failed to load expenses')
    } finally {
      if (id === requestId.current) setLoading(false)
    }
  }, [categoryId, projectId, spenderId, monthFilter, yearFilter, debouncedSearch, page, pageSize])

  useEffect(() => {
    void load()
  }, [load])

  const loadStatement = useCallback(async () => {
    setStatementLoading(true)
    try {
      const res = await api.get<ExpenseStatement>(
        `/api/transactions/expense-statement${qs({ year: statementYear })}`
      )
      setStatement(res)
    } catch (e) {
      setStatement(null)
      toast.error(e instanceof Error ? e.message : 'Failed to load the expense statement')
    } finally {
      setStatementLoading(false)
    }
  }, [statementYear])

  useEffect(() => {
    void loadStatement()
  }, [loadStatement])

  // reference data (filters + dialog dropdowns) — non-blocking
  const loadReference = useCallback(async () => {
    const [catRes, projRes, userRes, staffRows] = await Promise.allSettled([
      api.get<CategoriesResponse>(`/api/transaction-categories${qs({ type: 'expense' })}`),
      api.get<ProjectsResponse>('/api/projects?pageSize=100'),
      api.get<UsersResponse>('/api/users'),
      fetchAllPages<StaffRow>('/api/staff', { status: 'active' }),
    ])
    if (catRes.status === 'fulfilled') setCategories(catRes.value.data)
    if (projRes.status === 'fulfilled') setProjects(projRes.value.data)
    if (userRes.status === 'fulfilled') setUsers(userRes.value.data)
    if (staffRows.status === 'fulfilled') setStaff(staffRows.value)
    if (catRes.status === 'rejected') {
      toast.error('Failed to load categories — filters may be unavailable')
    }
  }, [])

  useEffect(() => {
    void loadReference()
  }, [loadReference])

  const operatorOptions = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>()
    for (const u of users) map.set(u.id, { id: u.id, name: u.name })
    if (user && !map.has(user.id)) map.set(user.id, { id: user.id, name: user.name })
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name))
  }, [users, user])

  const selectedSpender = useMemo(
    () => staff.find((s) => s.id === form.spenderStaffId) ?? null,
    [staff, form.spenderStaffId]
  )

  const hasFilters =
    debouncedSearch !== '' ||
    categoryId !== 'all' ||
    projectId !== 'all' ||
    spenderId !== 'all' ||
    monthFilter !== 'all' ||
    yearFilter !== 'all'

  function resetFilters() {
    setSearch('')
    setCategoryId('all')
    setProjectId('all')
    setSpenderId('all')
    setMonthFilter('all')
    setYearFilter('all')
    setPage(1)
  }

  function changeFilter(setter: (v: string) => void) {
    return (v: string) => {
      setter(v)
      setPage(1)
    }
  }

  function openAdd() {
    setEditing(null)
    const now = new Date()
    setReceiptFile(null)
    monthTouched.current = false
    yearTouched.current = false
    setForm({
      title: '',
      amount: '',
      categoryId: '',
      projectId: 'none',
      operatorUserId: user?.id ?? '',
      date: toDateInputValue(now),
      description: '',
      spenderStaffId: '',
      expenseMonth: String(now.getMonth() + 1),
      expenseYear: String(now.getFullYear()),
    })
    setDialogOpen(true)
  }

  // Deep-open the add dialog when arriving via the command palette
  const shouldOpenCreate = useViewIntent('expense-list', 'create')
  useEffect(() => {
    if (shouldOpenCreate) openAdd()
  }, [shouldOpenCreate])

  // Deep-open a transaction record when arriving via the palette record search:
  // filter the list down to its title so it is immediately visible.
  const recordIntent = useViewRecordIntent('expense-list')
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
    setReceiptFile(null)
    monthTouched.current = true // keep the stored month when editing
    yearTouched.current = true
    setForm({
      title: row.title,
      amount: String(row.amount),
      categoryId: row.category.id,
      projectId: row.project?.id ?? 'none',
      operatorUserId: row.operator?.id ?? user?.id ?? '',
      date: toDateInputValue(row.transactionDate),
      description: row.description ?? '',
      spenderStaffId: row.spender?.id ?? '',
      expenseMonth: row.expenseMonth ? String(row.expenseMonth) : '',
      expenseYear: row.expenseYear ? String(row.expenseYear) : '',
    })
    setDialogOpen(true)
  }

  function handleDateChange(v: string) {
    setField('date', v)
    // keep the expense month in sync with the date until the user picks one
    if (v) {
      const d = new Date(`${v}T00:00:00`)
      if (!Number.isNaN(d.getTime())) {
        if (!monthTouched.current) setField('expenseMonth', String(d.getMonth() + 1))
        if (!yearTouched.current) setField('expenseYear', String(d.getFullYear()))
      }
    }
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
        type: 'expense' as const,
        title,
        amount,
        transactionCategoryId: form.categoryId,
        projectId: form.projectId === 'none' ? null : form.projectId,
        operatorUserId: form.operatorUserId || null,
        transactionDate: form.date,
        description: form.description.trim() || null,
        spenderStaffId: form.spenderStaffId || null,
        expenseMonth: form.expenseMonth ? Number(form.expenseMonth) : null,
        expenseYear: form.expenseYear ? Number(form.expenseYear) : null,
      }
      let saved: TransactionRow
      if (editing) {
        saved = await api.put<TransactionRow>(`/api/transactions/${editing.id}`, payload)
      } else {
        saved = await api.post<TransactionRow>('/api/transactions', payload)
      }
      // attach/replace the chosen bill receipt (after the row exists)
      if (receiptFile) {
        try {
          await uploadReceipt(saved.id, receiptFile)
          toast.success('Bill receipt uploaded')
        } catch (e) {
          toast.error(e instanceof Error ? e.message : 'Receipt upload failed')
        }
      }
      toast.success(editing ? 'Expense updated' : 'Expense added')
      setDialogOpen(false)
      void load()
      void loadStatement()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save expense')
    } finally {
      setSaving(false)
    }
  }

  async function handleRemoveReceiptNow(row: TransactionRow) {
    setRemovingReceipt(true)
    try {
      await api.del(`/api/transactions/${row.id}/receipt`)
      toast.success('Receipt removed')
      if (editing?.id === row.id) setEditing({ ...editing, receiptName: null, receiptExt: null, receiptSize: null })
      if (receiptRow?.id === row.id) setReceiptRow({ ...row, receiptName: null, receiptExt: null, receiptSize: null })
      void load()
      void loadStatement()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to remove receipt')
    } finally {
      setRemovingReceipt(false)
    }
  }

  async function handleDelete(row: TransactionRow) {
    try {
      await api.del(`/api/transactions/${row.id}`)
      toast.success('Expense deleted')
      void load()
      void loadStatement()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete expense')
    }
  }

  // Row-level quick upload: remember the target tx, then open the file picker
  function triggerRowUpload(row: TransactionRow) {
    uploadTargetRef.current = row.id
    uploadInputRef.current?.click()
  }

  async function handleUploadInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    const targetId = uploadTargetRef.current
    e.target.value = '' // allow re-picking the same file
    uploadTargetRef.current = null
    if (!file || !targetId) return
    setReceiptBusy(true)
    try {
      await uploadReceipt(targetId, file)
      toast.success('Bill receipt uploaded')
      if (receiptRow?.id === targetId) setReceiptRow({ ...receiptRow, receiptName: file.name, receiptExt: file.type.includes('pdf') ? 'pdf' : file.type.includes('png') ? 'png' : file.type.includes('webp') ? 'webp' : 'jpg', receiptSize: file.size })
      void load()
      void loadStatement()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Receipt upload failed')
    } finally {
      setReceiptBusy(false)
    }
  }

  function openReceipt(row: TransactionRow) {
    setReceiptRow(row)
    setReceiptDialogOpen(true)
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
            type: 'expense',
            categoryId: categoryId === 'all' ? '' : categoryId,
            projectId: projectId === 'all' ? '' : projectId,
            spenderId: spenderId === 'all' ? '' : spenderId,
            expenseMonth: monthFilter === 'all' ? '' : monthFilter,
            expenseYear: yearFilter === 'all' ? '' : yearFilter,
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
        [
          'Date',
          'Title',
          'Spender (Worker)',
          'IQAMA',
          'Category',
          'Project',
          'Expense Month',
          'Amount',
          'Receipt',
          'Description',
          'Payroll-linked',
        ],
        all.map((r) => [
          formatDate(r.transactionDate),
          r.title,
          r.spender?.fullName ?? '',
          r.spender?.iqamaId ?? '',
          r.category?.name ?? '',
          r.project?.name ?? '',
          r.expenseMonth ? `${monthName(r.expenseMonth)} ${r.expenseYear ?? ''}`.trim() : '',
          r.amount.toFixed(2),
          r.receiptExt ? `Yes (${r.receiptName ?? r.receiptExt})` : 'No',
          r.description ?? '',
          r.payrollId ? 'Yes (managed via Payroll)' : 'No',
        ])
      )
      downloadCsv(csvFilename('expense-statement'), csv)
      toast.success(`Exported ${all.length} expense records to CSV`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  function openPrint(spenderFilter: string | null) {
    setPrintSpenderId(spenderFilter)
    setPrintOpen(true)
  }

  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      <div className="print-hidden">
        <PageHeader
          title="Expense List"
          description="Track who spent what — worker name, IQAMA, month and bill receipts."
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
          <Button
            variant="outline"
            size="sm"
            onClick={() => setView('accounts-summary')}
          >
            <BarChart3 className="h-4 w-4" />
            View Summary
          </Button>
          {canCreate ? (
            <Button size="sm" onClick={openAdd} className={EXPENSE_BTN}>
              <Plus className="h-4 w-4" />
              Add Expense
            </Button>
          ) : null}
        </PageHeader>
      </div>

      {canCreate ? (
        <MobileFab label="Add Expense" onClick={openAdd} icon={Plus} />
      ) : null}

      {/* Hidden file input for row-level quick receipt uploads */}
      <input
        ref={uploadInputRef}
        type="file"
        accept={RECEIPT_ACCEPT}
        className="hidden"
        onChange={(e) => void handleUploadInputChange(e)}
        aria-label="Upload bill receipt"
      />

      <FilterBar
        className="print-hidden"
        search={
          <SearchInput
            value={search}
            onChange={(v) => {
              setSearch(v)
              setPage(1)
            }}
            placeholder="Search by worker name, IQAMA, title…"
            className="w-full sm:w-[240px]"
          />
        }
        activeCount={
          (categoryId !== 'all' ? 1 : 0) +
          (projectId !== 'all' ? 1 : 0) +
          (spenderId !== 'all' ? 1 : 0) +
          (monthFilter !== 'all' ? 1 : 0) +
          (yearFilter !== 'all' ? 1 : 0)
        }
      >
        <FilterSelect
          value={spenderId}
          onChange={changeFilter(setSpenderId)}
          options={[
            { value: 'none', label: 'Company (No Worker)' },
            ...staff.map((s) => ({ value: s.id, label: s.fullName })),
          ]}
          placeholder="All Workers"
          className="sm:w-[180px]"
        />
        <FilterSelect
          value={monthFilter}
          onChange={changeFilter(setMonthFilter)}
          options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))}
          placeholder="All Months"
          className="sm:w-[140px]"
        />
        <FilterSelect
          value={yearFilter}
          onChange={changeFilter(setYearFilter)}
          options={yearOptions.map((y) => ({ value: y, label: y }))}
          placeholder="All Years"
          className="sm:w-[120px]"
        />
        <FilterSelect
          value={categoryId}
          onChange={changeFilter(setCategoryId)}
          options={categories.map((c) => ({ value: c.id, label: c.name }))}
          placeholder="Category"
        />
        <FilterSelect
          value={projectId}
          onChange={changeFilter(setProjectId)}
          options={projects.map((p) => ({ value: p.id, label: p.name }))}
          placeholder="Project"
          className="sm:w-[190px]"
        />
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

      {/* ---- Worker expense statement — who spent how much every month ---- */}
      <SectionCard className="print-hidden">
        <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <ReceiptText className="h-4 w-4 text-rose-600 dark:text-rose-400" />
              Worker Expense Statement
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Per-worker monthly totals — print a yearly statement for any worker or for everyone.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={statementYear} onValueChange={setStatementYear}>
              <SelectTrigger className="h-9 w-[110px]" aria-label="Statement year">
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
            <Button
              variant="outline"
              size="sm"
              onClick={() => openPrint(null)}
              disabled={statementLoading || !statement || (statement.spenders.length === 0 && statement.unassigned.total === 0)}
            >
              <Printer className="h-4 w-4" />
              Print All
            </Button>
          </div>
        </div>

        {statementLoading ? (
          <TableSkeleton rows={4} cols={6} />
        ) : !statement || (statement.spenders.length === 0 && statement.unassigned.total === 0) ? (
          <EmptyState
            icon={ReceiptText}
            title={`No worker expenses in ${statementYear}`}
            description="Add expenses with a selected worker to build the monthly statement."
          />
        ) : (
          <>
            {/* Desktop: month matrix */}
            <div className="nice-scrollbar hidden overflow-x-auto md:block">
              <Table className="min-w-[980px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[220px]">Worker</TableHead>
                    {MONTHS_SHORT.map((m) => (
                      <TableHead key={m} className="text-right">
                        {m}
                      </TableHead>
                    ))}
                    <TableHead className="text-right">Year Total</TableHead>
                    <TableHead className="w-[120px] text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {statement.spenders.map((s) => {
                    const byMonth = new Map(s.months.map((m) => [m.month, m.total]))
                    const active = statementYear === String(currentYear) ? new Date().getMonth() + 1 : 13
                    return (
                      <TableRow key={s.spender.id}>
                        <TableCell>
                          <div className="flex items-center gap-2.5">
                            <AvatarInitials name={s.spender.fullName} size="sm" />
                            <div className="min-w-0">
                              <p className="truncate font-medium">{s.spender.fullName}</p>
                              <p className="text-[11px] tabular-nums text-muted-foreground">
                                IQAMA: {s.spender.iqamaId}
                              </p>
                            </div>
                          </div>
                        </TableCell>
                        {MONTHS_SHORT.map((_, mi) => {
                          const v = byMonth.get(mi + 1)
                          return (
                            <TableCell
                              key={mi}
                              className={cn(
                                'text-right text-xs tabular-nums',
                                v ? 'font-medium' : 'text-muted-foreground/40',
                                mi + 1 === active && !v && 'bg-muted/30'
                              )}
                            >
                              {v ? formatMoney(v, currency) : '—'}
                            </TableCell>
                          )
                        })}
                        <TableCell className="text-right font-bold tabular-nums">
                          {formatMoney(s.total, currency)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 px-2 text-muted-foreground hover:text-foreground"
                            onClick={() => openPrint(s.spender.id)}
                            aria-label={`Print expense statement for ${s.spender.fullName}`}
                            title="Print yearly statement"
                          >
                            <Printer className="h-4 w-4" />
                            Print
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                  {statement.unassigned.total > 0 ? (
                    <TableRow className="bg-muted/30">
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                            <Building2 className="h-4 w-4" />
                          </span>
                          <div className="min-w-0">
                            <p className="truncate font-medium italic">Company / No Worker</p>
                            <p className="text-[11px] text-muted-foreground">
                              {statement.unassigned.totalCount} entries
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      {MONTHS_SHORT.map((_, mi) => {
                        const v = statement.unassigned.months.find((m) => m.month === mi + 1)
                        return (
                          <TableCell
                            key={mi}
                            className={cn(
                              'text-right text-xs tabular-nums',
                              v ? 'font-medium' : 'text-muted-foreground/40'
                            )}
                          >
                            {v ? formatMoney(v.total, currency) : '—'}
                          </TableCell>
                        )
                      })}
                      <TableCell className="text-right font-bold tabular-nums italic">
                        {formatMoney(statement.unassigned.total, currency)}
                      </TableCell>
                      <TableCell />
                    </TableRow>
                  ) : null}
                  <TableRow className="border-t-2">
                    <TableCell className="font-bold">Grand Total — {statement.year}</TableCell>
                    {MONTHS_SHORT.map((_, mi) => {
                      const v =
                        statement.spenders.reduce(
                          (s, sp) => s + (sp.months.find((m) => m.month === mi + 1)?.total ?? 0),
                          0
                        ) + (statement.unassigned.months.find((m) => m.month === mi + 1)?.total ?? 0)
                      return (
                        <TableCell
                          key={mi}
                          className={cn(
                            'text-right text-xs font-semibold tabular-nums',
                            !v && 'text-muted-foreground/40'
                          )}
                        >
                          {v ? formatMoney(v, currency) : '—'}
                        </TableCell>
                      )
                    })}
                    <TableCell className="text-right text-base font-bold tabular-nums">
                      {formatMoney(statement.grandTotal, currency)}
                    </TableCell>
                    <TableCell />
                  </TableRow>
                </TableBody>
              </Table>
            </div>

            {/* Mobile: stacked spender cards */}
            <ul className="space-y-3 p-4 sm:p-6 md:hidden">
              {statement.spenders.map((s) => (
                <li key={s.spender.id} className="rounded-xl border bg-card p-3 shadow-sm">
                  <div className="flex items-start gap-3">
                    <AvatarInitials name={s.spender.fullName} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold leading-snug">{s.spender.fullName}</p>
                      <p className="text-xs tabular-nums text-muted-foreground">
                        IQAMA: {s.spender.iqamaId}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-bold tabular-nums">{formatMoney(s.total, currency)}</p>
                      <p className="text-[11px] text-muted-foreground">{statement.year} total</p>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {s.months.map((m) => (
                      <span
                        key={m.month}
                        className="inline-flex items-center gap-1 rounded-md border bg-muted/40 px-1.5 py-0.5 text-[11px] tabular-nums"
                      >
                        <span className="font-medium">{MONTHS_SHORT[m.month - 1]}</span>
                        <span>{formatMoney(m.total, currency)}</span>
                      </span>
                    ))}
                  </div>
                  <div className="mt-2.5 flex items-center justify-between border-t pt-2.5">
                    <span className="text-xs text-muted-foreground">
                      {s.totalCount} entries · {s.receipts} receipt{s.receipts === 1 ? '' : 's'}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2 text-muted-foreground hover:text-foreground"
                      onClick={() => openPrint(s.spender.id)}
                    >
                      <Printer className="h-4 w-4" />
                      Print
                    </Button>
                  </div>
                </li>
              ))}
              {statement.unassigned.total > 0 ? (
                <li className="rounded-xl border bg-muted/30 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium italic">Company / No Worker</span>
                    <span className="text-sm font-bold tabular-nums">
                      {formatMoney(statement.unassigned.total, currency)}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {statement.unassigned.totalCount} entries without a worker
                  </p>
                </li>
              ) : null}
            </ul>
          </>
        )}
      </SectionCard>

      {/* ---- Expense transactions list ---- */}
      <SectionCard className="print-area overflow-hidden">
        {/* print-only statement header */}
        <div className="hidden border-b pb-3 print:block">
          <p className="text-lg font-bold">{settings.companyName}</p>
          <p className="mt-0.5 text-sm font-semibold">Expense Statement</p>
          <p className="mt-0.5 text-xs">Generated on {formatDate(new Date())}</p>
        </div>

        <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div>
            <h2 className="text-base font-semibold">Expense Transactions</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {hasFilters ? 'Filtered results' : 'All records'} — worker, month and receipt on every
              entry
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-semibold tabular-nums text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-300 sm:text-sm">
              Total Expense: {formatMoney(sum, currency)}
            </span>
            <span className="inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium tabular-nums text-muted-foreground">
              {total} {total === 1 ? 'record' : 'records'}
            </span>
          </div>
        </div>

        {loading ? (
          <TableSkeleton rows={6} cols={8} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={TrendingDown}
            title="No expense transactions"
            description="Nothing matches your current filters. Try adjusting them or add a new entry."
            action={
              canCreate ? (
                <Button size="sm" onClick={openAdd} className={EXPENSE_BTN}>
                  <Plus className="h-4 w-4" />
                  Add Expense
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            {/* Mobile: stacked cards */}
            <ul className="space-y-3 p-4 sm:p-6 md:hidden print:hidden">
              {rows.map((row) => (
                <li
                  key={row.id}
                  className="rounded-xl border bg-card p-3 shadow-sm transition-colors hover:bg-muted/30"
                >
                  <div className="flex items-start gap-3">
                    {row.spender ? (
                      <AvatarInitials name={row.spender.fullName} size="sm" />
                    ) : (
                      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                        <Building2 className="h-4 w-4" />
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 font-medium leading-snug">{row.title}</p>
                      {row.spender ? (
                        <p className="text-xs text-muted-foreground">
                          {row.spender.fullName} · IQAMA: {row.spender.iqamaId}
                        </p>
                      ) : (
                        <p className="text-xs italic text-muted-foreground">Company expense</p>
                      )}
                      {row.description ? (
                        <p className="truncate text-xs text-muted-foreground">{row.description}</p>
                      ) : null}
                    </div>
                    <span className="shrink-0 text-sm font-bold tabular-nums text-rose-700 dark:text-rose-400">
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
                      {row.expenseMonth
                        ? `${monthName(row.expenseMonth)} ${row.expenseYear ?? ''}`.trim()
                        : formatDate(row.transactionDate)}
                    </span>
                    <span className="flex shrink-0 items-center gap-1 tabular-nums">
                      <ReceiptText className="h-3 w-3" />
                      {formatDate(row.transactionDate)}
                    </span>
                  </div>
                  <div className="mt-2.5 flex items-center justify-between border-t pt-2.5">
                    <Button
                      variant={row.receiptExt ? 'outline' : 'ghost'}
                      size="sm"
                      className={cn(
                        'h-9 gap-1.5 px-2 text-xs',
                        row.receiptExt
                          ? 'border-emerald-200 text-emerald-700 dark:border-emerald-900 dark:text-emerald-400'
                          : 'text-muted-foreground'
                      )}
                      onClick={() =>
                        row.receiptExt
                          ? openReceipt(row)
                          : canEdit && !row.payrollId
                            ? triggerRowUpload(row)
                            : toast.info('No receipt attached')
                      }
                      disabled={receiptBusy}
                    >
                      {row.receiptExt ? <Paperclip className="h-3.5 w-3.5" /> : <Upload className="h-3.5 w-3.5" />}
                      {row.receiptExt ? 'Receipt' : 'Upload'}
                    </Button>
                    <div className="flex shrink-0 items-center gap-1">
                      {row.payrollId ? (
                        <span
                          className="inline-flex h-11 w-11 cursor-help items-center justify-center rounded-md text-muted-foreground"
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
                              title="Delete expense entry?"
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
            <div className="nice-scrollbar hidden overflow-x-auto md:block print:block print:overflow-visible">
              <Table className="min-w-[1080px] print:min-w-0 print:text-xs">
                <TableHeader>
                  <TableRow>
                    <TableHead>Transaction</TableHead>
                    <TableHead className="w-[190px]">Spent By</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Month</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Project</TableHead>
                    <TableHead className="text-center">Receipt</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right print:hidden">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="max-w-[240px] print:max-w-none">
                        <div className="flex items-start gap-3">
                          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-400">
                            <TrendingDown className="h-4 w-4" />
                          </span>
                          <div className="min-w-0">
                            <p className="truncate font-medium">{row.title}</p>
                            {row.description ? (
                              <p className="max-w-[220px] truncate text-xs text-muted-foreground print:hidden">
                                {row.description}
                              </p>
                            ) : null}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        {row.spender ? (
                          <div className="flex items-center gap-2">
                            <AvatarInitials name={row.spender.fullName} size="sm" />
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">{row.spender.fullName}</p>
                              <p className="text-[11px] tabular-nums text-muted-foreground">
                                IQAMA: {row.spender.iqamaId}
                              </p>
                            </div>
                          </div>
                        ) : (
                          <span className="text-sm italic text-muted-foreground">Company</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <CategoryChip label={row.category.name} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm">
                        {row.expenseMonth ? (
                          <span className="inline-flex items-center gap-1">
                            <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
                            {monthName(row.expenseMonth)} {row.expenseYear ?? ''}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="font-semibold tabular-nums text-rose-700 dark:text-rose-400">
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
                      <TableCell className="text-center">
                        {row.receiptExt ? (
                          <button
                            type="button"
                            onClick={() => openReceipt(row)}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-emerald-200 bg-emerald-50 text-emerald-700 transition-colors hover:bg-emerald-100 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-400"
                            title={`View receipt — ${row.receiptName ?? ''}`}
                            aria-label={`View bill receipt for ${row.title}`}
                          >
                            <Paperclip className="h-4 w-4" />
                          </button>
                        ) : canEdit && !row.payrollId ? (
                          <button
                            type="button"
                            onClick={() => triggerRowUpload(row)}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                            title="Upload bill receipt"
                            aria-label={`Upload bill receipt for ${row.title}`}
                            disabled={receiptBusy}
                          >
                            <Upload className="h-4 w-4" />
                          </button>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm tabular-nums">
                        {formatDate(row.transactionDate)}
                      </TableCell>
                      <TableCell className="text-right print:hidden">
                        {row.payrollId ? (
                          <span
                            className="inline-flex h-8 w-8 cursor-help items-center justify-center rounded-md text-muted-foreground"
                            title="Managed via Payroll module"
                          >
                            <Lock className="h-4 w-4" />
                          </span>
                        ) : (
                          <div className="flex items-center justify-end gap-0.5">
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
                                title="Delete expense entry?"
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

      {/* ---- Add / Edit expense dialog ---- */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="nice-scrollbar max-h-[90vh] overflow-y-auto sm:max-w-[620px]">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Expense' : 'Add Expense'}</DialogTitle>
            <DialogDescription>
              {editing
                ? 'Update the expense — worker, month, amounts and the bill receipt.'
                : 'Record who spent it (worker + IQAMA), the month it belongs to and attach the bill receipt.'}
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
                  placeholder="e.g. Steel boots purchase — Abdul Kareem"
                  required
                />
              </div>

              {/* WHO made the expense — searchable worker combobox */}
              <div className="space-y-2 sm:col-span-2">
                <Label>Spent By (Worker)</Label>
                <Popover open={spenderOpen} onOpenChange={setSpenderOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      role="combobox"
                      aria-expanded={spenderOpen}
                      className="h-10 w-full justify-between font-normal"
                    >
                      <span className="truncate">
                        {selectedSpender ? (
                          `${selectedSpender.fullName} — IQAMA: ${selectedSpender.iqamaId}`
                        ) : (
                          <span className="text-muted-foreground">
                            Company expense (no worker) — click to pick
                          </span>
                        )}
                      </span>
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[340px] p-0 sm:w-[440px]" align="start">
                    <Command>
                      <CommandInput placeholder="Search worker by name or IQAMA" />
                      <CommandList>
                        <CommandEmpty>No worker found.</CommandEmpty>
                        <CommandGroup>
                          <CommandItem
                            value="zzz-none-company-expense"
                            onSelect={() => {
                              setField('spenderStaffId', '')
                              setSpenderOpen(false)
                            }}
                          >
                            <Check
                              className={cn(
                                'h-4 w-4',
                                form.spenderStaffId === '' ? 'opacity-100' : 'opacity-0'
                              )}
                            />
                            <span className="italic">Company expense (no worker)</span>
                          </CommandItem>
                          {staff.map((s) => (
                            <CommandItem
                              key={s.id}
                              value={`${s.fullName} ${s.iqamaId}`}
                              onSelect={() => {
                                setField('spenderStaffId', s.id)
                                setSpenderOpen(false)
                              }}
                            >
                              <Check
                                className={cn(
                                  'h-4 w-4',
                                  form.spenderStaffId === s.id ? 'opacity-100' : 'opacity-0'
                                )}
                              />
                              <span className="truncate">
                                {s.fullName} — IQAMA: {s.iqamaId}
                              </span>
                              {s.position ? (
                                <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                                  {s.position}
                                </span>
                              ) : null}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
                {selectedSpender ? (
                  <span className="inline-flex items-center gap-1.5 rounded-md border border-rose-200 bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-300">
                    <UserRound className="h-3 w-3" />
                    {selectedSpender.fullName} · IQAMA {selectedSpender.iqamaId}
                  </span>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Optional — leave as company expense for rent, utilities, etc.
                  </p>
                )}
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
                  onChange={(e) => handleDateChange(e.target.value)}
                  required
                />
              </div>

              {/* The month the expense BELONGS to */}
              <div className="space-y-2">
                <Label>Expense Month</Label>
                <Select
                  value={form.expenseMonth || undefined}
                  onValueChange={(v) => {
                    monthTouched.current = true
                    setField('expenseMonth', v)
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="From date" />
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
                <Label>Expense Year</Label>
                <Select
                  value={form.expenseYear || undefined}
                  onValueChange={(v) => {
                    yearTouched.current = true
                    setField('expenseYear', v)
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="From date" />
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

              {/* Bill receipt upload */}
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="tx-receipt">Bill Receipt</Label>
                {editing?.receiptExt ? (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 dark:border-emerald-900 dark:bg-emerald-950/60">
                    <div className="flex min-w-0 items-center gap-2">
                      <Paperclip className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {editing.receiptName ?? 'receipt'}
                          {editing.receiptSize ? (
                            <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                              {formatBytes(editing.receiptSize)}
                            </span>
                          ) : null}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          Attached — upload a new file below to replace it
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2 text-xs"
                        onClick={() => openReceipt(editing)}
                      >
                        <FileText className="h-3.5 w-3.5" />
                        View
                      </Button>
                      {canEdit ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2 text-xs text-rose-600 hover:text-rose-700 dark:text-rose-400"
                          onClick={() => void handleRemoveReceiptNow(editing)}
                          disabled={removingReceipt}
                        >
                          {removingReceipt ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" />
                          )}
                          Remove
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ) : null}
                <div className="flex items-center gap-2">
                  <Input
                    id="tx-receipt"
                    type="file"
                    accept={RECEIPT_ACCEPT}
                    onChange={(e) => setReceiptFile(e.target.files?.[0] ?? null)}
                    className="h-10 text-sm"
                  />
                  {receiptFile ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-10 w-10 shrink-0"
                      onClick={() => setReceiptFile(null)}
                      aria-label="Clear chosen file"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground">
                  {receiptFile
                    ? `${receiptFile.name} (${formatBytes(receiptFile.size)}) will be attached on save`
                    : 'JPG, PNG, WebP or PDF — max 5 MB. Attach the original bill for records.'}
                </p>
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
                  rows={2}
                  value={form.description}
                  onChange={(e) => setField('description', e.target.value)}
                  placeholder="Optional notes about this expense"
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
              <Button type="submit" disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {editing ? 'Save Changes' : 'Add Expense'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ---- Receipt preview dialog ---- */}
      <Dialog open={receiptDialogOpen} onOpenChange={setReceiptDialogOpen}>
        <DialogContent className="sm:max-w-[640px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Paperclip className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              Bill Receipt
            </DialogTitle>
            <DialogDescription>
              {receiptRow
                ? `${receiptRow.title} — ${formatMoney(receiptRow.amount, currency)}${
                    receiptRow.spender ? ` · ${receiptRow.spender.fullName}` : ''
                  }`
                : ''}
            </DialogDescription>
          </DialogHeader>
          {receiptRow?.receiptExt ? (
            <div className="space-y-3">
              <div className="rounded-lg border bg-muted/30 p-3">
                <p className="truncate text-sm font-medium">{receiptRow.receiptName ?? 'receipt'}</p>
                <p className="text-xs text-muted-foreground">
                  {receiptRow.receiptExt.toUpperCase()} · {formatBytes(receiptRow.receiptSize)} ·{' '}
                  {formatDate(receiptRow.transactionDate)}
                </p>
              </div>
              {receiptRow.receiptExt === 'pdf' ? (
                <iframe
                  src={`/api/transactions/${receiptRow.id}/receipt`}
                  title="Receipt PDF"
                  className="h-[420px] w-full rounded-lg border bg-white"
                />
              ) : (
                <div className="max-h-[420px] overflow-auto rounded-lg border bg-white p-2">
                  <img
                    src={`/api/transactions/${receiptRow.id}/receipt`}
                    alt={`Bill receipt for ${receiptRow.title}`}
                    className="mx-auto max-w-full"
                  />
                </div>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    window.open(`/api/transactions/${receiptRow.id}/receipt`, '_blank')
                  }
                >
                  <FileText className="h-4 w-4" />
                  Open in New Tab
                </Button>
                {canEdit && !receiptRow.payrollId ? (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setReceiptDialogOpen(false)
                        // reuse the row-level quick upload flow
                        setDialogOpen(false)
                        triggerRowUpload(receiptRow)
                      }}
                      disabled={receiptBusy}
                    >
                      {receiptBusy ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Upload className="h-4 w-4" />
                      )}
                      Replace
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-rose-600 hover:text-rose-700 dark:text-rose-400"
                      onClick={() => void handleRemoveReceiptNow(receiptRow)}
                      disabled={receiptBusy || removingReceipt}
                    >
                      {removingReceipt ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                      Remove
                    </Button>
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <EmptyState
              icon={ReceiptText}
              title="No receipt attached"
              description="Upload a bill receipt (JPG, PNG, WebP or PDF) for this expense."
            />
          )}
        </DialogContent>
      </Dialog>

      {/* ---- Yearly statement print dialog ---- */}
      <ExpenseStatementPrintDialog
        open={printOpen}
        onOpenChange={setPrintOpen}
        statement={statement}
        spenderId={printSpenderId}
      />
    </div>
  )
}

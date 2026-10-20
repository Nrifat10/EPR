'use client'

// Quotations view — business document module for quotes sent to clients:
//   • stat cards (count, quoted value, accepted value, awaiting decision)
//   • filter bar (search + status + year) with the shared mobile collapse
//   • desktop table + mobile stacked cards, row actions Edit / Delete / Print
//   • add/edit dialog with a live line-items editor (server always recomputes
//     the final money figures — the in-dialog math is only a preview),
//     client picker (registered clients) with a free-text fallback
//   • CSV export of the filtered list, A4 print via QuotationPrintDialog
// Role-based: add/edit/delete/print only with quotations.* permissions.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  Building2,
  Calculator,
  CheckCircle2,
  Clock,
  Download,
  FileText,
  Hash,
  Pencil,
  Plus,
  Printer,
  Trash2,
  X,
} from 'lucide-react'

import { api, qs } from '@/lib/api-client'
import { buildCsv, csvFilename, downloadCsv } from '@/lib/csv'
import { formatDate, formatMoney, formatNumber, round2, toDateInputValue } from '@/lib/format'
import { can, useAppStore } from '@/lib/store'
import type { ClientRow, Paginated, QuotationRow } from '@/lib/types'
import { useDebounce } from '@/hooks/use-debounce'
import { useViewIntent } from '@/hooks/use-view-intent'
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
import { Badge } from '@/components/ui/badge'

import { ConfirmDelete } from '../shared/confirm-delete'
import { DataTablePagination } from '../shared/data-table-pagination'
import { EmptyState, TableSkeleton } from '../shared/empty-state'
import { FilterBar, FilterSelect, SearchInput } from '../shared/filter-select'
import { PageHeader, SectionCard, MobileFab } from '../shared/page-header'
import { StatCard } from '../shared/stat-card'
import { QuotationPrintDialog } from '../print/quotation-print'
import type { QuotationDetail } from '../print/quotation-print'

type QuotationListRow = QuotationRow & { itemCount: number }

type QuotationTotals = {
  count: number
  totalValue: number
  acceptedValue: number
  acceptedCount: number
  pendingCount: number
  pendingValue: number
}

type QuotationsResponse = Paginated<QuotationListRow> & {
  totals: QuotationTotals
  years: number[]
}

const EMPTY_TOTALS: QuotationTotals = {
  count: 0,
  totalValue: 0,
  acceptedValue: 0,
  acceptedCount: 0,
  pendingCount: 0,
  pendingValue: 0,
}

const STATUS_OPTIONS = [
  { value: 'draft', label: 'Draft' },
  { value: 'sent', label: 'Sent' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'expired', label: 'Expired' },
]

/** Status chip colors — sky (not indigo) for "sent", app palette elsewhere. */
function QuoteStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    draft: {
      label: 'Draft',
      className:
        'border-gray-200 bg-gray-100 text-gray-600 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-400',
    },
    sent: {
      label: 'Sent',
      className:
        'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-300',
    },
    accepted: {
      label: 'Accepted',
      className:
        'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300',
    },
    rejected: {
      label: 'Rejected',
      className:
        'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-300',
    },
    expired: {
      label: 'Expired',
      className:
        'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300',
    },
  }
  const entry = map[status] ?? {
    label: status,
    className: 'border-gray-200 bg-gray-50 text-gray-600 dark:border-gray-800 dark:bg-gray-800/40 dark:text-gray-400',
  }
  return (
    <Badge variant="outline" className={cn('whitespace-nowrap font-medium capitalize', entry.className)}>
      {entry.label}
    </Badge>
  )
}

/** One editable line item in the dialog (string fields for smooth typing). */
type ItemForm = {
  key: string
  description: string
  unit: string
  quantity: string
  unitPrice: string
}

type QuotationForm = {
  clientId: string
  clientName: string
  subject: string
  issueDate: string
  validityDate: string
  status: string
  discount: string
  vatPercent: string
  notes: string
  terms: string
  items: ItemForm[]
}

let itemKeySeq = 0
function newItemForm(): ItemForm {
  itemKeySeq += 1
  return { key: `item-${itemKeySeq}`, description: '', unit: '', quantity: '1', unitPrice: '' }
}

function emptyForm(vatPercent: number): QuotationForm {
  const today = new Date()
  const validity = new Date(today.getTime() + 30 * 86_400_000)
  return {
    clientId: '',
    clientName: '',
    subject: '',
    issueDate: toDateInputValue(today),
    validityDate: toDateInputValue(validity),
    status: 'draft',
    discount: '',
    vatPercent: String(vatPercent),
    notes: '',
    terms: '',
    items: [newItemForm()],
  }
}

/** Parse a numeric input; null when blank/invalid. */
function parseNum(v: string): number | null {
  if (v.trim() === '') return null
  const n = parseFloat(v)
  return isFinite(n) ? n : null
}

export function QuotationsView() {
  const { user, settings } = useAppStore()
  const currency = settings.currency || 'SAR'
  const defaultVatPercent = settings.vatRate || 15
  const canCreate = can(user, 'quotations.create')
  const canEdit = can(user, 'quotations.edit')
  const canDelete = can(user, 'quotations.delete')

  const currentYear = new Date().getFullYear()

  // ---- list state ----
  const [rows, setRows] = useState<QuotationListRow[]>([])
  const [totals, setTotals] = useState<QuotationTotals>(EMPTY_TOTALS)
  const [years, setYears] = useState<number[]>([currentYear])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)

  // ---- list filters ----
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search)
  const [statusFilter, setStatusFilter] = useState('all')
  const [yearFilter, setYearFilter] = useState('all')

  // ---- add/edit dialog ----
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<QuotationRow | null>(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<QuotationForm>(() => emptyForm(defaultVatPercent))
  const [clients, setClients] = useState<{ id: string; name: string }[]>([])
  const clientsLoaded = useRef(false)

  // ---- print ----
  const [printOpen, setPrintOpen] = useState(false)
  const [printQuotation, setPrintQuotation] = useState<QuotationDetail | null>(null)
  const [printLoading, setPrintLoading] = useState(false)

  // guard against out-of-order responses when filters/page change quickly
  const requestId = useRef(0)

  // -----------------------------------------------------------------------
  // Data loading
  // -----------------------------------------------------------------------
  const load = useCallback(async () => {
    const id = ++requestId.current
    setLoading(true)
    try {
      const res = await api.get<QuotationsResponse>(
        `/api/quotations${qs({
          search: debouncedSearch,
          status: statusFilter === 'all' ? '' : statusFilter,
          year: yearFilter === 'all' ? '' : yearFilter,
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
      setTotals(res.totals ?? EMPTY_TOTALS)
      setYears(res.years?.length ? res.years : [currentYear])
      setTotal(res.total)
      setTotalPages(res.totalPages)
    } catch (e) {
      if (id !== requestId.current) return
      setRows([])
      setTotals(EMPTY_TOTALS)
      setTotal(0)
      setTotalPages(1)
      toast.error(e instanceof Error ? e.message : 'Failed to load quotations')
    } finally {
      if (id === requestId.current) setLoading(false)
    }
  }, [debouncedSearch, statusFilter, yearFilter, page, pageSize, currentYear])

  useEffect(() => {
    void load()
  }, [load])

  const yearOptions = useMemo(() => {
    const set = new Set<number>(years)
    set.add(currentYear)
    return Array.from(set).sort((a, b) => b - a)
  }, [years, currentYear])

  const hasFilters = debouncedSearch !== '' || statusFilter !== 'all' || yearFilter !== 'all'

  function resetFilters() {
    setSearch('')
    setStatusFilter('all')
    setYearFilter('all')
    setPage(1)
  }

  /** Registered clients for the picker — fetched once, when the dialog opens. */
  const loadClients = useCallback(async () => {
    if (clientsLoaded.current) return
    try {
      const res = await api.get<Paginated<ClientRow>>('/api/clients?pageSize=100')
      setClients(res.data.map((c) => ({ id: c.id, name: c.name })))
      clientsLoaded.current = true
    } catch {
      // picker stays empty — free-text fallback still works
    }
  }, [])

  // -----------------------------------------------------------------------
  // Add / Edit dialog
  // -----------------------------------------------------------------------
  function openAdd() {
    setEditing(null)
    setForm(emptyForm(defaultVatPercent))
    setDialogOpen(true)
    void loadClients()
  }

  // Deep-open the create dialog when arriving via the command palette
  const shouldOpenCreate = useViewIntent('quotations', 'create')
  useEffect(() => {
    if (shouldOpenCreate) openAdd()
  }, [shouldOpenCreate])

  async function openEdit(row: QuotationRow) {
    try {
      // list rows carry no items — fetch the full document for the editor
      const full = await api.get<QuotationDetail>(`/api/quotations/${row.id}`)
      setEditing(row)
      setForm({
        clientId: full.clientId ?? '',
        clientName: full.clientName,
        subject: full.subject ?? '',
        issueDate: toDateInputValue(full.issueDate),
        validityDate: full.validityDate ? toDateInputValue(full.validityDate) : '',
        status: full.status,
        discount: full.discount ? String(full.discount) : '',
        vatPercent: String(Math.round(full.vatRate * 100)),
        notes: full.notes ?? '',
        terms: full.terms ?? '',
        items: (full.items ?? []).map((it) => {
          itemKeySeq += 1
          return {
            key: `item-${itemKeySeq}`,
            description: it.description,
            unit: it.unit ?? '',
            quantity: String(it.quantity),
            unitPrice: String(it.unitPrice),
          }
        }),
      })
      setDialogOpen(true)
      void loadClients()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not open the quotation')
    }
  }

  function setField<K extends keyof QuotationForm>(key: K, value: QuotationForm[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function setItemField(key: string, field: keyof ItemForm, value: string) {
    setForm((f) => ({
      ...f,
      items: f.items.map((it) => (it.key === key ? { ...it, [field]: value } : it)),
    }))
  }

  function addItemAt(index: number) {
    setForm((f) => {
      const items = [...f.items]
      items.splice(index + 1, 0, newItemForm())
      return { ...f, items }
    })
  }

  function removeItemAt(index: number) {
    setForm((f) => ({
      ...f,
      items: f.items.length > 1 ? f.items.filter((_, i) => i !== index) : f.items,
    }))
  }

  // -----------------------------------------------------------------------
  // LIVE totals preview — mirrors the server-side computation exactly
  // -----------------------------------------------------------------------
  const calc = useMemo(() => {
    const items = form.items.map((it) => {
      const quantity = Math.max(0, parseNum(it.quantity) ?? 0)
      const unitPrice = Math.max(0, parseNum(it.unitPrice) ?? 0)
      return { quantity, unitPrice, lineTotal: round2(quantity * unitPrice) }
    })
    const subtotal = round2(items.reduce((s, it) => s + it.lineTotal, 0))
    const discount = Math.max(0, parseNum(form.discount) ?? 0)
    const percent = parseNum(form.vatPercent)
    const vatRate = percent !== null && percent >= 0 && percent <= 100 ? percent / 100 : defaultVatPercent / 100
    const effectiveDiscount = Math.min(discount, subtotal)
    const vatAmount = round2((subtotal - effectiveDiscount) * vatRate)
    const total = round2(subtotal - effectiveDiscount + vatAmount)
    return { items, subtotal, discount: effectiveDiscount, vatAmount, total, vatRate }
  }, [form, defaultVatPercent])

  const money = (n: number) => formatMoney(n, currency)
  const vatPercentLabel = Math.round(calc.vatRate * 100)

  async function handleSubmit() {
    // Friendly client-side validation before hitting the API
    const clientName = form.clientName.trim()
    if (!clientName) {
      toast.error('Client name is required')
      return
    }
    if (!form.issueDate) {
      toast.error('Issue date is required')
      return
    }
    const rawDiscount = parseNum(form.discount) ?? 0
    if (rawDiscount < 0) {
      toast.error('Discount cannot be negative')
      return
    }
    if (rawDiscount > calc.subtotal) {
      toast.error('Discount cannot be greater than the subtotal')
      return
    }
    const items = form.items.map((it) => ({
      description: it.description.trim(),
      unit: it.unit.trim() || null,
      quantity: Math.max(0, parseNum(it.quantity) ?? 0),
      unitPrice: Math.max(0, parseNum(it.unitPrice) ?? 0),
    }))
    if (items.length === 0 || items.some((it) => !it.description)) {
      toast.error('Every line item needs a description')
      return
    }
    if (items.some((it) => it.quantity <= 0)) {
      toast.error('Every line item needs a quantity greater than 0')
      return
    }
    if (items.some((it) => it.unitPrice < 0)) {
      toast.error('Unit prices cannot be negative')
      return
    }

    const body = {
      clientId: form.clientId || null,
      clientName,
      subject: form.subject.trim() || null,
      issueDate: form.issueDate,
      validityDate: form.validityDate || null,
      status: form.status,
      discount: round2(rawDiscount),
      vatRate: calc.vatRate,
      notes: form.notes.trim() || null,
      terms: form.terms.trim() || null,
      items,
    }

    setSaving(true)
    try {
      if (editing) {
        const updated = await api.put<QuotationRow>(`/api/quotations/${editing.id}`, body)
        toast.success(`Quotation ${updated.quoteNumber} updated`)
      } else {
        const created = await api.post<QuotationRow>('/api/quotations', body)
        toast.success(`Quotation ${created.quoteNumber} created`)
      }
      setDialogOpen(false)
      void load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save the quotation')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(row: QuotationRow) {
    try {
      await api.del(`/api/quotations/${row.id}`)
      toast.success(`Quotation ${row.quoteNumber} deleted`)
      void load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not delete the quotation')
    }
  }

  // -----------------------------------------------------------------------
  // CSV export + print
  // -----------------------------------------------------------------------

  /** Walk every page of the filtered list (server caps pageSize at 100). */
  async function fetchAllFiltered(): Promise<QuotationListRow[]> {
    const all: QuotationListRow[] = []
    let p = 1
    for (;;) {
      const res = await api.get<QuotationsResponse>(
        `/api/quotations${qs({
          search: debouncedSearch,
          status: statusFilter === 'all' ? '' : statusFilter,
          year: yearFilter === 'all' ? '' : yearFilter,
          page: p,
          pageSize: 100,
        })}`
      )
      all.push(...res.data)
      if (p >= res.totalPages || res.data.length === 0) break
      p += 1
    }
    return all
  }

  async function handleExportCsv() {
    if (exporting) return
    setExporting(true)
    try {
      const all = await fetchAllFiltered()
      const csv = buildCsv(
        [
          'Quote No',
          'Issue Date',
          'Valid Until',
          'Client',
          'Subject',
          'Status',
          'Items',
          `Subtotal (${currency})`,
          `Discount (${currency})`,
          `VAT Rate %`,
          `VAT Amount (${currency})`,
          `Total (${currency})`,
        ],
        all.map((q) => [
          q.quoteNumber,
          q.issueDate.slice(0, 10),
          q.validityDate ? q.validityDate.slice(0, 10) : '',
          q.clientName,
          q.subject ?? '',
          q.status,
          q.itemCount,
          q.subtotal.toFixed(2),
          q.discount.toFixed(2),
          (q.vatRate * 100).toFixed(0),
          q.vatAmount.toFixed(2),
          q.total.toFixed(2),
        ])
      )
      downloadCsv(csvFilename('quotations'), csv)
      toast.success(`Exported ${all.length} quotation${all.length === 1 ? '' : 's'} to CSV`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  async function openPrint(row: QuotationRow) {
    if (printLoading) return
    setPrintLoading(true)
    try {
      const full = await api.get<QuotationDetail>(`/api/quotations/${row.id}`)
      setPrintQuotation(full)
      setPrintOpen(true)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not prepare the quotation document')
    } finally {
      setPrintLoading(false)
    }
  }

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------
  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      <PageHeader
        title="Quotations"
        description={`Prepare price quotations for clients — items, ${vatPercentLabel}% VAT and totals are computed automatically.`}
      >
        <Button
          variant="outline"
          size="sm"
          onClick={() => void handleExportCsv()}
          disabled={exporting || total === 0}
        >
          {exporting ? <Calculator className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          Export CSV
        </Button>
        {canCreate ? (
          <Button size="sm" onClick={openAdd}>
            <Plus className="h-4 w-4" />
            Add Quotation
          </Button>
        ) : null}
      </PageHeader>

      {canCreate ? <MobileFab label="Add Quotation" onClick={openAdd} icon={Plus} /> : null}

      {/* ---- Stat cards ---- */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Total Quotations"
          value={String(totals.count)}
          icon={FileText}
          tone="navy"
          sublabel={hasFilters ? 'Matching current filters' : 'All quotations on record'}
        />
        <StatCard
          title="Quoted Value"
          value={formatNumber(totals.totalValue)}
          valuePrefix={currency}
          icon={Calculator}
          tone="teal"
          sublabel="Sum of quotation totals"
        />
        <StatCard
          title="Accepted Value"
          value={formatNumber(totals.acceptedValue)}
          valuePrefix={currency}
          icon={CheckCircle2}
          tone="green"
          sublabel={
            totals.acceptedCount === 0
              ? 'No accepted quotes yet'
              : `${totals.acceptedCount} accepted quotation${totals.acceptedCount === 1 ? '' : 's'}`
          }
        />
        <StatCard
          title="Awaiting Decision"
          value={String(totals.pendingCount)}
          icon={Clock}
          tone="gold"
          sublabel={
            totals.pendingCount === 0
              ? 'Nothing pending'
              : `Avg ${money(round2(totals.pendingValue / totals.pendingCount))} · draft + sent`
          }
        />
      </div>

      {/* ---- Quotations list ---- */}
      <SectionCard className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div>
            <h2 className="text-base font-semibold">All Quotations</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {hasFilters ? 'Filtered — matches your search/filters' : 'All records'} — newest first
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold tabular-nums text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300 sm:text-sm">
              Quoted: {money(totals.totalValue)}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold tabular-nums text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300 sm:text-sm">
              Accepted: {money(totals.acceptedValue)}
            </span>
            <span className="inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium tabular-nums text-muted-foreground">
              {total} {total === 1 ? 'quote' : 'quotes'}
            </span>
          </div>
        </div>

        <div className="border-b p-4 sm:p-6">
          <FilterBar
            search={
              <SearchInput
                value={search}
                onChange={(v) => {
                  setSearch(v)
                  setPage(1)
                }}
                placeholder="Search quote no, client, subject…"
                className="w-full sm:w-[240px]"
              />
            }
            activeCount={(statusFilter !== 'all' ? 1 : 0) + (yearFilter !== 'all' ? 1 : 0)}
          >
            <FilterSelect
              value={statusFilter}
              onChange={(v) => {
                setStatusFilter(v)
                setPage(1)
              }}
              options={STATUS_OPTIONS}
              placeholder="All Statuses"
              className="sm:w-[150px]"
            />
            <FilterSelect
              value={yearFilter}
              onChange={(v) => {
                setYearFilter(v)
                setPage(1)
              }}
              options={yearOptions.map((y) => ({ value: String(y), label: String(y) }))}
              placeholder="All Years"
              className="sm:w-[120px]"
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
        </div>

        {loading ? (
          <TableSkeleton rows={6} cols={7} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No quotations found"
            description={
              hasFilters
                ? 'Nothing matches your current filters. Try adjusting them.'
                : 'Create your first quotation to start sending price offers to clients.'
            }
            action={
              canCreate ? (
                <Button size="sm" onClick={openAdd}>
                  <Plus className="h-4 w-4" />
                  Add Quotation
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            {/* Desktop: full table */}
            <div className="nice-scrollbar hidden overflow-x-auto md:block">
              <Table className="min-w-[960px]">
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead className="w-[130px]">Quote No</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead className="w-[110px]">Issue Date</TableHead>
                    <TableHead className="w-[110px]">Valid Until</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="w-[100px]">Status</TableHead>
                    {canEdit || canDelete ? (
                      <TableHead className="w-[130px] text-right">Actions</TableHead>
                    ) : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.id} className="group">
                      <TableCell>
                        <span className="inline-flex items-center gap-1.5 font-semibold tabular-nums">
                          <Hash className="h-3 w-3 text-muted-foreground" />
                          {row.quoteNumber}
                        </span>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {row.itemCount} item{row.itemCount === 1 ? '' : 's'}
                        </p>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
                            <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                          </span>
                          <div className="min-w-0">
                            <p className="truncate font-medium">{row.clientName}</p>
                            {row.subject ? (
                              <p className="max-w-[260px] truncate text-xs text-muted-foreground" title={row.subject}>
                                {row.subject}
                              </p>
                            ) : null}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums">
                        {formatDate(row.issueDate)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                        {formatDate(row.validityDate)}
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {money(row.total)}
                        <p className="text-xs font-normal tabular-nums text-muted-foreground">
                          incl. VAT {money(row.vatAmount)}
                        </p>
                      </TableCell>
                      <TableCell>
                        <QuoteStatusBadge status={row.status} />
                      </TableCell>
                      {canEdit || canDelete ? (
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-0.5">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-foreground"
                              onClick={() => void openPrint(row)}
                              disabled={printLoading}
                              aria-label={`Print quotation ${row.quoteNumber}`}
                            >
                              <Printer className="h-4 w-4" />
                            </Button>
                            {canEdit ? (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                onClick={() => void openEdit(row)}
                                aria-label={`Edit quotation ${row.quoteNumber}`}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                            ) : null}
                            {canDelete ? (
                              <ConfirmDelete
                                onConfirm={() => void handleDelete(row)}
                                title="Delete quotation?"
                                description={`Quotation ${row.quoteNumber} (${row.clientName}, ${money(
                                  row.total
                                )}) and all its line items will be permanently removed.`}
                              />
                            ) : null}
                          </div>
                        </TableCell>
                      ) : null}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Mobile: stacked cards */}
            <ul className="space-y-3 p-4 sm:p-6 md:hidden">
              {rows.map((row) => (
                <li
                  key={row.id}
                  className="rounded-xl border bg-card p-3 shadow-sm transition-colors hover:bg-muted/30"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 font-semibold tabular-nums">
                        <Hash className="h-3.5 w-3.5 text-muted-foreground" />
                        {row.quoteNumber}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {row.clientName}
                      </p>
                      {row.subject ? (
                        <p className="truncate text-xs text-muted-foreground/80" title={row.subject}>
                          {row.subject}
                        </p>
                      ) : null}
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Issued {formatDate(row.issueDate)}
                        {row.validityDate ? ` · valid until ${formatDate(row.validityDate)}` : ''}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-bold tabular-nums">{money(row.total)}</p>
                      <p className="text-[11px] font-medium tabular-nums text-muted-foreground">
                        incl. VAT {money(row.vatAmount)}
                      </p>
                      <div className="mt-1 flex justify-end">
                        <QuoteStatusBadge status={row.status} />
                      </div>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center justify-between border-t pt-2">
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {row.itemCount} item{row.itemCount === 1 ? '' : 's'}
                    </span>
                    <div className="flex items-center gap-0.5">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
                        onClick={() => void openPrint(row)}
                        disabled={printLoading}
                        aria-label={`Print quotation ${row.quoteNumber}`}
                      >
                        <Printer className="h-4 w-4" />
                      </Button>
                      {canEdit ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-foreground"
                          onClick={() => void openEdit(row)}
                          aria-label={`Edit quotation ${row.quoteNumber}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      ) : null}
                      {canDelete ? (
                        <ConfirmDelete
                          onConfirm={() => void handleDelete(row)}
                          title="Delete quotation?"
                          description={`Quotation ${row.quoteNumber} (${money(row.total)}) will be permanently removed.`}
                        />
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}

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
          unit="quotes"
        />
      </SectionCard>

      {/* ---- Add / Edit dialog ---- */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="nice-scrollbar max-h-[90vh] gap-5 overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit Quotation ${editing.quoteNumber}` : 'New Quotation'}</DialogTitle>
            <DialogDescription>
              {editing
                ? 'Update the quotation details and line items. Totals are recomputed on save.'
                : 'Fill in the client, dates and line items — the quote number is generated automatically.'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="quote-client">Registered Client</Label>
              <Select
                value={form.clientId || 'none'}
                onValueChange={(v) => {
                  if (v === 'none') {
                    setField('clientId', '')
                  } else {
                    const client = clients.find((c) => c.id === v)
                    setForm((f) => ({
                      ...f,
                      clientId: v,
                      clientName: client ? client.name : f.clientName,
                    }))
                  }
                }}
              >
                <SelectTrigger id="quote-client" className="w-full" aria-label="Registered client">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Free-text / one-time client</SelectItem>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="quote-client-name">
                Client Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="quote-client-name"
                value={form.clientName}
                onChange={(e) => {
                  // typing a custom name detaches the registered client link
                  const clientName = e.target.value
                  setForm((f) => ({ ...f, clientName, clientId: '' }))
                }}
                placeholder="Client / company name"
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="quote-subject">Subject</Label>
              <Input
                id="quote-subject"
                value={form.subject}
                onChange={(e) => setField('subject', e.target.value)}
                placeholder="e.g. Supply of skilled manpower — Jubail project"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="quote-issue-date">
                Issue Date <span className="text-destructive">*</span>
              </Label>
              <Input
                id="quote-issue-date"
                type="date"
                value={form.issueDate}
                onChange={(e) => setField('issueDate', e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="quote-validity">Valid Until</Label>
              <Input
                id="quote-validity"
                type="date"
                value={form.validityDate}
                onChange={(e) => setField('validityDate', e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="quote-status">Status</Label>
              <Select value={form.status} onValueChange={(v) => setField('status', v)}>
                <SelectTrigger id="quote-status" className="w-full" aria-label="Status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="quote-vat">VAT %</Label>
                <Input
                  id="quote-vat"
                  type="number"
                  min={0}
                  max={100}
                  step="0.5"
                  value={form.vatPercent}
                  onChange={(e) => setField('vatPercent', e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="quote-discount">Discount</Label>
                <Input
                  id="quote-discount"
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.discount}
                  onChange={(e) => setField('discount', e.target.value)}
                  placeholder="0.00"
                />
              </div>
            </div>
          </div>

          {/* ---- Line items editor ---- */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm">Line Items</Label>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Line totals, VAT and the grand total update live as you type.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9"
                onClick={() => addItemAt(form.items.length - 1)}
              >
                <Plus className="h-4 w-4" />
                Add Item
              </Button>
            </div>

            <div className="space-y-2.5">
              {form.items.map((it, i) => (
                <div key={it.key} className="rounded-lg border bg-muted/20 p-2.5">
                  <div className="flex items-start gap-2">
                    <span className="mt-2 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-semibold tabular-nums text-muted-foreground">
                      {i + 1}
                    </span>
                    <Input
                      value={it.description}
                      onChange={(e) => setItemField(it.key, 'description', e.target.value)}
                      placeholder="Description of goods / services"
                      className="min-w-0 flex-1"
                      aria-label={`Item ${i + 1} description`}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => removeItemAt(i)}
                      disabled={form.items.length <= 1}
                      aria-label={`Remove item ${i + 1}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 pl-8 sm:grid-cols-4">
                    <div className="space-y-1">
                      <Label className="text-[11px] text-muted-foreground">Unit</Label>
                      <Input
                        value={it.unit}
                        onChange={(e) => setItemField(it.key, 'unit', e.target.value)}
                        placeholder="e.g. day"
                        className="h-9"
                        aria-label={`Item ${i + 1} unit`}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px] text-muted-foreground">Qty</Label>
                      <Input
                        type="number"
                        min={0}
                        step="any"
                        value={it.quantity}
                        onChange={(e) => setItemField(it.key, 'quantity', e.target.value)}
                        className="h-9 tabular-nums"
                        aria-label={`Item ${i + 1} quantity`}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px] text-muted-foreground">Unit Price</Label>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={it.unitPrice}
                        onChange={(e) => setItemField(it.key, 'unitPrice', e.target.value)}
                        placeholder="0.00"
                        className="h-9 tabular-nums"
                        aria-label={`Item ${i + 1} unit price`}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px] text-muted-foreground">Line Total</Label>
                      <p className="flex h-9 items-center rounded-md border bg-background px-2.5 text-sm font-semibold tabular-nums">
                        {formatNumber(calc.items[i]?.lineTotal ?? 0)}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* ---- Live totals footer ---- */}
            <div className="rounded-lg border bg-muted/40 p-3">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div>
                  <p className="text-[11px] font-medium text-muted-foreground">Subtotal</p>
                  <p className="text-sm font-semibold tabular-nums">{money(calc.subtotal)}</p>
                </div>
                <div>
                  <p className="text-[11px] font-medium text-muted-foreground">Discount</p>
                  <p className="text-sm font-semibold tabular-nums text-rose-600 dark:text-rose-400">
                    -{money(calc.discount)}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-medium text-muted-foreground">VAT ({vatPercentLabel}%)</p>
                  <p className="text-sm font-semibold tabular-nums">{money(calc.vatAmount)}</p>
                </div>
                <div>
                  <p className="text-[11px] font-medium text-muted-foreground">Total</p>
                  <p className="text-base font-bold tabular-nums">{money(calc.total)}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="quote-notes">Notes</Label>
              <Textarea
                id="quote-notes"
                value={form.notes}
                onChange={(e) => setField('notes', e.target.value)}
                placeholder="Optional notes shown on the printed quotation"
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="quote-terms">Terms &amp; Conditions</Label>
              <Textarea
                id="quote-terms"
                value={form.terms}
                onChange={(e) => setField('terms', e.target.value)}
                placeholder="e.g. 50% advance, balance on delivery"
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => void handleSubmit()} disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Save Changes' : 'Create Quotation'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- Print dialog ---- */}
      <QuotationPrintDialog quotation={printQuotation} open={printOpen} onOpenChange={setPrintOpen} />
    </div>
  )
}

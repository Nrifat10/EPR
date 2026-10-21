'use client'

// VAT Return Expense view — purpose-built for ZATCA quarterly filing support:
//   • record supplier bills that carry VAT — the user types ONLY the grand
//     total ("Amount With VAT"); the without-VAT / VAT split is derived LIVE
//     while typing and always re-computed server-side on save,
//   • monthly totals (4 header cards) + a month-by-month table for the year,
//   • quarterly VAT return summary (Q1–Q4) with the current-quarter highlight
//     and the days remaining until the quarter end / filing deadline,
//   • CSV export of the filtered bills and of the monthly+quarterly summary,
//   • an A4 print report (company letterhead, period, bill table, totals).
// Role-based: add/edit/delete buttons only appear with vat.create/edit/delete.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  AlertTriangle,
  Building2,
  CalendarClock,
  CalendarDays,
  Calculator,
  CalendarRange,
  Download,
  FileSpreadsheet,
  Hash,
  Pencil,
  Percent,
  Plus,
  Printer,
  ReceiptText,
  Trash2,
  TrendingDown,
  X,
} from 'lucide-react'

import { api, qs } from '@/lib/api-client'
import { ApiError } from '@/lib/api-client'
import { buildCsv, csvFilename, downloadCsv } from '@/lib/csv'
import { formatDate, formatMoney, formatNumber, monthName, round2, toDateInputValue } from '@/lib/format'
import { can, useAppStore } from '@/lib/store'
import type { Paginated, VatBillRow, VatBillTotals, VatSummaryData } from '@/lib/types'
import { MONTHS } from '@/lib/types'
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

import { ConfirmDelete } from '../shared/confirm-delete'
import { DataTablePagination } from '../shared/data-table-pagination'
import { EmptyState, TableSkeleton } from '../shared/empty-state'
import { FilterBar, FilterSelect, SearchInput } from '../shared/filter-select'
import { PageHeader, SectionCard, MobileFab } from '../shared/page-header'
import { StatCard } from '../shared/stat-card'
import { VatReturnPrintDialog } from '../print/vat-return-print'

type BillsResponse = Paginated<VatBillRow> & { totals: VatBillTotals }

/** Bill entry form — only amountWithVat is typed; the split is derived. */
type BillForm = {
  billDate: string
  billNumber: string
  supplierName: string
  supplierVatNumber: string
  description: string
  amountWithVat: string
}

const EMPTY_FORM: BillForm = {
  billDate: '',
  billNumber: '',
  supplierName: '',
  supplierVatNumber: '',
  description: '',
  amountWithVat: '',
}

const QUARTER_OPTIONS = [
  { value: '1', label: 'Q1 (Jan – Mar)' },
  { value: '2', label: 'Q2 (Apr – Jun)' },
  { value: '3', label: 'Q3 (Jul – Sep)' },
  { value: '4', label: 'Q4 (Oct – Dec)' },
]

/** Quarter number (1-4) a month (1-12) belongs to. */
function quarterOfMonth(month: number): number {
  return Math.floor((month - 1) / 3) + 1
}

/** Whole days from now until an ISO date (negative = already past). */
function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000)
}

export function VatReturnExpenseView() {
  const { user, settings } = useAppStore()
  const currency = settings.currency
  // Live form calculation uses the configured rate (percent → fraction)
  const vatRate = (settings.vatRate || 15) / 100
  const canCreate = can(user, 'vat.create')
  const canEdit = can(user, 'vat.edit')
  const canDelete = can(user, 'vat.delete')

  const now = new Date()
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth() + 1

  // ---- bills list state ----
  const [rows, setRows] = useState<VatBillRow[]>([])
  const [totals, setTotals] = useState<VatBillTotals>({ count: 0, withVat: 0, withoutVat: 0, vat: 0 })
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)

  // ---- list filters ----
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search)
  const [monthFilter, setMonthFilter] = useState('all')
  const [yearFilter, setYearFilter] = useState('all')
  const [quarterFilter, setQuarterFilter] = useState('all')
  const [fromFilter, setFromFilter] = useState('')
  const [toFilter, setToFilter] = useState('')

  // ---- summary state (monthly + quarterly) ----
  const [summaryMonth, setSummaryMonth] = useState(String(currentMonth))
  const [summaryYear, setSummaryYear] = useState(String(currentYear))
  const [selectedQuarter, setSelectedQuarter] = useState(String(quarterOfMonth(currentMonth)))
  const [summary, setSummary] = useState<VatSummaryData | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(true)

  // ---- add/edit dialog ----
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<VatBillRow | null>(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<BillForm>(EMPTY_FORM)
  const [billNumberError, setBillNumberError] = useState<string | null>(null)
  const [amountError, setAmountError] = useState<string | null>(null)

  // ---- print ----
  const [printOpen, setPrintOpen] = useState(false)
  const [printBills, setPrintBills] = useState<VatBillRow[]>([])
  const [printTotals, setPrintTotals] = useState<VatBillTotals>({ count: 0, withVat: 0, withoutVat: 0, vat: 0 })

  // guard against out-of-order responses when filters/page change quickly
  const requestId = useRef(0)

  function setField<K extends keyof BillForm>(key: K, value: BillForm[K]) {
    setForm((f) => ({ ...f, [key]: value }))
    if (key === 'billNumber') setBillNumberError(null)
    if (key === 'amountWithVat') setAmountError(null)
  }

  // -----------------------------------------------------------------------
  // LIVE auto-calculation — the ONLY typed amount is amountWithVat.
  //   withoutVat = round2(withVat / (1 + rate))
  //   vat        = round2(withVat - withoutVat)   → the two always sum back
  // Cleared input ⇒ cleared outputs. Mirrors the server-side splitVat().
  // -----------------------------------------------------------------------
  const calc = useMemo(() => {
    const raw = form.amountWithVat.trim()
    if (raw === '') return null
    const parsed = parseFloat(raw)
    if (!isFinite(parsed) || parsed <= 0) return null
    const withVat = round2(parsed)
    const withoutVat = round2(withVat / (1 + vatRate))
    return { withVat, withoutVat, vat: round2(withVat - withoutVat) }
  }, [form.amountWithVat, vatRate])

  // -----------------------------------------------------------------------
  // Data loading
  // -----------------------------------------------------------------------
  const load = useCallback(async () => {
    const id = ++requestId.current
    setLoading(true)
    try {
      const res = await api.get<BillsResponse>(
        `/api/vat-bills${qs({
          search: debouncedSearch,
          month: monthFilter === 'all' ? '' : monthFilter,
          year: yearFilter === 'all' ? '' : yearFilter,
          quarter: quarterFilter === 'all' ? '' : quarterFilter,
          from: fromFilter,
          to: toFilter,
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
      setTotals(res.totals ?? { count: 0, withVat: 0, withoutVat: 0, vat: 0 })
      setTotal(res.total)
      setTotalPages(res.totalPages)
    } catch (e) {
      if (id !== requestId.current) return
      setRows([])
      setTotals({ count: 0, withVat: 0, withoutVat: 0, vat: 0 })
      setTotal(0)
      setTotalPages(1)
      toast.error(e instanceof Error ? e.message : 'Failed to load VAT bills')
    } finally {
      if (id === requestId.current) setLoading(false)
    }
  }, [debouncedSearch, monthFilter, yearFilter, quarterFilter, fromFilter, toFilter, page, pageSize])

  useEffect(() => {
    void load()
  }, [load])

  const loadSummary = useCallback(async () => {
    setSummaryLoading(true)
    try {
      const res = await api.get<VatSummaryData>(
        `/api/vat-bills/summary${qs({ month: summaryMonth, year: summaryYear })}`
      )
      setSummary(res)
    } catch (e) {
      setSummary(null)
      toast.error(e instanceof Error ? e.message : 'Failed to load the VAT summary')
    } finally {
      setSummaryLoading(false)
    }
  }, [summaryMonth, summaryYear])

  useEffect(() => {
    void loadSummary()
  }, [loadSummary])

  /** Reload list + summary after any mutation so every total auto-updates. */
  function reloadAll() {
    void load()
    void loadSummary()
  }

  // -----------------------------------------------------------------------
  // Filters helpers
  // -----------------------------------------------------------------------
  const yearOptions = useMemo(() => {
    const years = summary?.years ?? [currentYear]
    const set = new Set<number>(years)
    set.add(currentYear)
    set.add(Number(summaryYear))
    return Array.from(set).sort((a, b) => b - a)
  }, [summary, currentYear, summaryYear])

  const hasFilters =
    debouncedSearch !== '' ||
    monthFilter !== 'all' ||
    yearFilter !== 'all' ||
    quarterFilter !== 'all' ||
    fromFilter !== '' ||
    toFilter !== ''

  function resetFilters() {
    setSearch('')
    setMonthFilter('all')
    setYearFilter('all')
    setQuarterFilter('all')
    setFromFilter('')
    setToFilter('')
    setPage(1)
  }

  /** Human label of the active list filter — reused by export + print. */
  const periodLabel = useMemo(() => {
    if (fromFilter || toFilter) {
      const f = fromFilter ? formatDate(fromFilter) : '…'
      const t = toFilter ? formatDate(toFilter) : '…'
      return `${f} → ${t}`
    }
    if (quarterFilter !== 'all' && yearFilter !== 'all') return `Q${quarterFilter} ${yearFilter}`
    if (monthFilter !== 'all' && yearFilter !== 'all') return `${monthName(Number(monthFilter))} ${yearFilter}`
    if (yearFilter !== 'all') return `Year ${yearFilter}`
    return 'All bills'
  }, [fromFilter, toFilter, quarterFilter, yearFilter, monthFilter])

  // -----------------------------------------------------------------------
  // Add / Edit dialog
  // -----------------------------------------------------------------------
  function openAdd() {
    setEditing(null)
    setBillNumberError(null)
    setAmountError(null)
    setForm({ ...EMPTY_FORM, billDate: toDateInputValue(new Date()) })
    setDialogOpen(true)
  }

  // Deep-open the create dialog when arriving via the command palette
  const shouldOpenCreate = useViewIntent('vat-return-expense', 'create')
  useEffect(() => {
    if (shouldOpenCreate) openAdd()
  }, [shouldOpenCreate])

  function openEdit(row: VatBillRow) {
    setEditing(row)
    setBillNumberError(null)
    setAmountError(null)
    setForm({
      billDate: toDateInputValue(row.billDate),
      billNumber: row.billNumber,
      supplierName: row.supplierName ?? '',
      supplierVatNumber: row.supplierVatNumber ?? '',
      description: row.description ?? '',
      amountWithVat: String(row.amountWithVat),
    })
    setDialogOpen(true)
  }

  async function handleSubmit() {
    // Friendly client-side validation before hitting the API
    if (!form.billDate) {
      toast.error('Bill date is required')
      return
    }
    const billNumber = form.billNumber.trim()
    if (!billNumber) {
      setBillNumberError('Bill number is required')
      return
    }
    const amount = parseFloat(form.amountWithVat)
    if (!isFinite(amount) || amount <= 0) {
      setAmountError('Amount must be greater than 0 (no negative or zero values)')
      return
    }
    setSaving(true)
    try {
      const body = {
        billDate: form.billDate,
        billNumber,
        supplierName: form.supplierName.trim() || null,
        supplierVatNumber: form.supplierVatNumber.trim() || null,
        description: form.description.trim() || null,
        amountWithVat: round2(amount),
      }
      if (editing) {
        await api.put<VatBillRow>(`/api/vat-bills/${editing.id}`, body)
        toast.success(`Bill ${billNumber} updated`)
      } else {
        await api.post<VatBillRow>('/api/vat-bills', body)
        toast.success(`Bill ${billNumber} recorded`)
      }
      setDialogOpen(false)
      reloadAll()
    } catch (e) {
      // 409 duplicate bill number → show it on the field itself
      if (e instanceof ApiError && e.status === 409) {
        setBillNumberError(e.message)
        toast.error(e.message)
      } else {
        toast.error(e instanceof Error ? e.message : 'Could not save the bill')
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(row: VatBillRow) {
    try {
      await api.del(`/api/vat-bills/${row.id}`)
      toast.success(`Bill ${row.billNumber} deleted`)
      reloadAll()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not delete the bill')
    }
  }

  // -----------------------------------------------------------------------
  // Export (Excel-friendly CSV) + Print (→ "Save as PDF")
  // -----------------------------------------------------------------------

  /** Walk every page of the filtered bills list (server caps pageSize at 100). */
  async function fetchAllFiltered(): Promise<{ bills: VatBillRow[]; totals: VatBillTotals }> {
    const all: VatBillRow[] = []
    let p = 1
    let t: VatBillTotals = { count: 0, withVat: 0, withoutVat: 0, vat: 0 }
    for (;;) {
      const res = await api.get<BillsResponse>(
        `/api/vat-bills${qs({
          search: debouncedSearch,
          month: monthFilter === 'all' ? '' : monthFilter,
          year: yearFilter === 'all' ? '' : yearFilter,
          quarter: quarterFilter === 'all' ? '' : quarterFilter,
          from: fromFilter,
          to: toFilter,
          page: p,
          pageSize: 100,
        })}`
      )
      all.push(...res.data)
      t = res.totals ?? t
      if (p >= res.totalPages || res.data.length === 0) break
      p += 1
    }
    return { bills: all, totals: t }
  }

  async function handleExportBillsCsv() {
    if (exporting) return
    setExporting(true)
    try {
      const { bills } = await fetchAllFiltered()
      const csv = buildCsv(
        [
          'Date',
          'Bill Number',
          'Supplier Name',
          'Supplier VAT Number',
          'Description',
          `Amount With VAT (${currency})`,
          `Amount Without VAT (${currency})`,
          `VAT Amount (${currency})`,
          'VAT Rate %',
        ],
        bills.map((b) => [
          b.billDate.slice(0, 10),
          b.billNumber,
          b.supplierName ?? '',
          b.supplierVatNumber ?? '',
          b.description ?? '',
          b.amountWithVat.toFixed(2),
          b.amountWithoutVat.toFixed(2),
          b.vatAmount.toFixed(2),
          (b.vatRateSnapshot * 100).toFixed(0),
        ])
      )
      downloadCsv(csvFilename('vat-expense-bills'), csv)
      toast.success(`Exported ${bills.length} bill${bills.length === 1 ? '' : 's'} to CSV`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  /** Monthly + quarterly summary of the selected year as one CSV. */
  function handleExportSummaryCsv() {
    if (!summary) return
    const esc = (cell: string | number) => {
      const s = String(cell)
      return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const lines: (string | number)[][] = [
      [`VAT Return Expense — ${settings.companyName}`],
      [`VAT rate: ${Math.round(summary.vatRate * 100)}%`],
      [],
      [`Monthly Summary — ${summary.year}`],
      ['Month', 'Bills', 'With VAT', 'Without VAT', 'VAT Amount'],
      ...summary.monthly.map((m) => [
        `${monthName(m.month)} ${summary.year}`,
        m.count,
        m.withVat.toFixed(2),
        m.withoutVat.toFixed(2),
        m.vat.toFixed(2),
      ]),
      [
        `Year Total ${summary.year}`,
        summary.yearTotals.count,
        summary.yearTotals.withVat.toFixed(2),
        summary.yearTotals.withoutVat.toFixed(2),
        summary.yearTotals.vat.toFixed(2),
      ],
      [],
      [`Quarterly VAT Return — ${summary.year}`],
      ['Quarter', 'Months', 'Bills', 'With VAT', 'Without VAT', 'Input VAT (claimable)'],
      ...summary.quarters.map((q) => [
        `Q${q.quarter}`,
        q.months.map((m) => monthName(m.month).slice(0, 3)).join('-'),
        q.count,
        q.withVat.toFixed(2),
        q.withoutVat.toFixed(2),
        q.vat.toFixed(2),
      ]),
    ]
    // BOM so Excel detects UTF-8; CRLF line endings (same as buildCsv)
    const csv = `\uFEFF${lines.map((r) => r.map(esc).join(',')).join('\r\n')}`
    downloadCsv(csvFilename('vat-return-summary', String(summary.year)), csv)
    toast.success(`Exported the ${summary.year} monthly + quarterly summary to CSV`)
  }

  async function openPrint() {
    try {
      setSummaryLoading(true)
      const { bills, totals: t } = await fetchAllFiltered()
      setPrintBills(bills)
      setPrintTotals(t)
      setPrintOpen(true)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not prepare the print report')
    } finally {
      setSummaryLoading(false)
    }
  }

  // -----------------------------------------------------------------------
  // Derived summary values
  // -----------------------------------------------------------------------
  const vatPercentLabel = Math.round(vatRate * 100)
  const monthTotals = summary?.monthTotals ?? { count: 0, withVat: 0, withoutVat: 0, vat: 0 }
  const quarter = summary?.quarters.find((q) => q.quarter === Number(selectedQuarter)) ?? null
  const isCurrentYear = summary ? summary.year === summary.currentYear : false
  const isCurrentQuarter = isCurrentYear && summary ? summary.currentQuarter === Number(selectedQuarter) : false

  // Filing countdown (only meaningful for the current year)
  let countdown: { quarterEnd: string; filingDeadline: string; daysToEnd: number; daysToFile: number } | null = null
  if (summary?.quarterEndDate && summary.filingDeadline) {
    countdown = {
      quarterEnd: summary.quarterEndDate,
      filingDeadline: summary.filingDeadline,
      daysToEnd: daysUntil(summary.quarterEndDate),
      daysToFile: daysUntil(summary.filingDeadline),
    }
  }

  const money = (n: number) => formatMoney(n, currency)

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------
  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      <div className="print-hidden">
        <PageHeader
          title="VAT Return Expense"
          description={`Record supplier bills carrying ${vatPercentLabel}% VAT and prepare the quarterly VAT return.`}
        >
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportSummaryCsv}
            disabled={!summary || summaryLoading}
          >
            <FileSpreadsheet className="h-4 w-4" />
            Export Summary
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleExportBillsCsv()}
            disabled={exporting || total === 0}
          >
            {exporting ? <Calculator className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Export Bills
          </Button>
          <Button variant="outline" size="sm" onClick={() => void openPrint()} disabled={loading}>
            <Printer className="h-4 w-4" />
            Print Report
          </Button>
          {canCreate ? (
            <Button size="sm" onClick={openAdd}>
              <Plus className="h-4 w-4" />
              Add Bill
            </Button>
          ) : null}
        </PageHeader>
      </div>

      {canCreate ? <MobileFab label="Add Bill" onClick={openAdd} icon={Plus} /> : null}

      {/* ---- Monthly summary (selected month) ---- */}
      <section className="print-hidden space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <CalendarDays className="h-4 w-4 text-primary" />
              Monthly Summary
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Totals for the selected month — they update automatically whenever a bill is added,
              edited or deleted.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={summaryMonth} onValueChange={setSummaryMonth}>
              <SelectTrigger className="h-9 w-[150px]" aria-label="Summary month">
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
            <Select value={summaryYear} onValueChange={setSummaryYear}>
              <SelectTrigger className="h-9 w-[110px]" aria-label="Summary year">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {yearOptions.map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            title={`Bills — ${monthName(Number(summaryMonth))} ${summaryYear}`}
            value={String(monthTotals.count)}
            icon={ReceiptText}
            tone="navy"
            sublabel={monthTotals.count === 0 ? 'No bills this month' : 'VAT bills recorded'}
          />
          <StatCard
            title="Total Amount With VAT"
            value={formatNumber(monthTotals.withVat)}
            valuePrefix={currency}
            icon={TrendingDown}
            tone="red"
            sublabel="Gross bill totals"
          />
          <StatCard
            title="Total Amount Without VAT"
            value={formatNumber(monthTotals.withoutVat)}
            valuePrefix={currency}
            icon={Calculator}
            tone="teal"
            sublabel="Net expense value"
          />
          <StatCard
            title={`Total VAT (${vatPercentLabel}%)`}
            value={formatNumber(monthTotals.vat)}
            valuePrefix={currency}
            icon={Percent}
            tone="gold"
            sublabel="Input VAT — claimable in the return"
          />
        </div>
      </section>

      {/* ---- Bills list ---- */}
      <SectionCard className="print-hidden overflow-hidden">
        <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div>
            <h2 className="text-base font-semibold">Expense Bills with VAT</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {hasFilters ? `Filtered — ${periodLabel}` : 'All records'} — newest first
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-semibold tabular-nums text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-300 sm:text-sm">
              With VAT: {money(totals.withVat)}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold tabular-nums text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300 sm:text-sm">
              Input VAT: {money(totals.vat)}
            </span>
            <span className="inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium tabular-nums text-muted-foreground">
              {total} {total === 1 ? 'bill' : 'bills'}
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
                placeholder="Search bill no, supplier, VAT no…"
                className="w-full sm:w-[240px]"
              />
            }
            activeCount={
              (monthFilter !== 'all' ? 1 : 0) +
              (yearFilter !== 'all' ? 1 : 0) +
              (quarterFilter !== 'all' ? 1 : 0) +
              (fromFilter !== '' ? 1 : 0) +
              (toFilter !== '' ? 1 : 0)
            }
          >
            <FilterSelect
              value={monthFilter}
              onChange={(v) => {
                setMonthFilter(v)
                if (v !== 'all') setQuarterFilter('all') // month and quarter exclude each other
                setPage(1)
              }}
              options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))}
              placeholder="All Months"
              className="sm:w-[140px]"
            />
            <FilterSelect
              value={quarterFilter}
              onChange={(v) => {
                setQuarterFilter(v)
                if (v !== 'all') {
                  setMonthFilter('all') // quarter overrides the month filter
                  if (yearFilter === 'all') setYearFilter(String(currentYear))
                }
                setPage(1)
              }}
              options={QUARTER_OPTIONS}
              placeholder="All Quarters"
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
            <div className="flex items-center gap-1.5">
              <Input
                type="date"
                aria-label="From date"
                value={fromFilter}
                onChange={(e) => {
                  setFromFilter(e.target.value)
                  setMonthFilter('all') // a date range overrides month/quarter
                  setQuarterFilter('all')
                  setPage(1)
                }}
                className="h-9 w-[145px]"
              />
              <span className="text-xs text-muted-foreground">→</span>
              <Input
                type="date"
                aria-label="To date"
                value={toFilter}
                onChange={(e) => {
                  setToFilter(e.target.value)
                  setMonthFilter('all')
                  setQuarterFilter('all')
                  setPage(1)
                }}
                className="h-9 w-[145px]"
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
        </div>

        {loading ? (
          <TableSkeleton rows={6} cols={7} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={ReceiptText}
            title="No VAT bills found"
            description={
              hasFilters
                ? 'Nothing matches your current filters. Try adjusting them.'
                : 'Record your first supplier bill that carries VAT to start building the return.'
            }
            action={
              canCreate ? (
                <Button size="sm" onClick={openAdd}>
                  <Plus className="h-4 w-4" />
                  Add Bill
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            {/* Desktop / print: full table */}
            <div className="nice-scrollbar hidden overflow-x-auto md:block">
              <Table className="min-w-[960px]">
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead className="w-[110px]">Date</TableHead>
                    <TableHead className="w-[130px]">Bill No</TableHead>
                    <TableHead>Supplier</TableHead>
                    <TableHead className="text-right">With VAT</TableHead>
                    <TableHead className="text-right">Without VAT</TableHead>
                    <TableHead className="text-right">VAT ({vatPercentLabel}%)</TableHead>
                    {canEdit || canDelete ? (
                      <TableHead className="w-[100px] text-right">Actions</TableHead>
                    ) : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.id} className="group">
                      <TableCell className="whitespace-nowrap tabular-nums">
                        {formatDate(row.billDate)}
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1.5 font-semibold tabular-nums">
                          <Hash className="h-3 w-3 text-muted-foreground" />
                          {row.billNumber}
                        </span>
                        {row.description ? (
                          <p className="mt-0.5 max-w-[220px] truncate text-xs text-muted-foreground" title={row.description}>
                            {row.description}
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        {row.supplierName ? (
                          <div className="flex items-center gap-2">
                            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
                              <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                            </span>
                            <div className="min-w-0">
                              <p className="truncate font-medium">{row.supplierName}</p>
                              {row.supplierVatNumber ? (
                                <p className="text-xs tabular-nums text-muted-foreground">
                                  VAT No: {row.supplierVatNumber}
                                </p>
                              ) : null}
                            </div>
                          </div>
                        ) : (
                          <span className="text-sm italic text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {money(row.amountWithVat)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {money(row.amountWithoutVat)}
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums text-amber-700 dark:text-amber-400">
                        {money(row.vatAmount)}
                      </TableCell>
                      {canEdit || canDelete ? (
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-0.5">
                            {canEdit ? (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                onClick={() => openEdit(row)}
                                aria-label={`Edit bill ${row.billNumber}`}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                            ) : null}
                            {canDelete ? (
                              <ConfirmDelete
                                onConfirm={() => void handleDelete(row)}
                                title="Delete VAT bill?"
                                description={`Bill ${row.billNumber} (${money(row.amountWithVat)}, VAT ${money(
                                  row.vatAmount
                                )}) will be permanently removed.`}
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
                        {row.billNumber}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {formatDate(row.billDate)}
                        {row.supplierName ? ` · ${row.supplierName}` : ''}
                      </p>
                      {row.supplierVatNumber ? (
                        <p className="text-xs tabular-nums text-muted-foreground">
                          Supplier VAT No: {row.supplierVatNumber}
                        </p>
                      ) : null}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-bold tabular-nums">{money(row.amountWithVat)}</p>
                      <p className="text-[11px] font-medium tabular-nums text-amber-700 dark:text-amber-400">
                        VAT {money(row.vatAmount)}
                      </p>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center justify-between border-t pt-2">
                    <span className="text-xs tabular-nums text-muted-foreground">
                      Without VAT: {money(row.amountWithoutVat)}
                    </span>
                    {canEdit || canDelete ? (
                      <div className="flex items-center gap-0.5">
                      {canEdit ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-foreground"
                          onClick={() => openEdit(row)}
                          aria-label={`Edit bill ${row.billNumber}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      ) : null}
                      {canDelete ? (
                        <ConfirmDelete
                          onConfirm={() => void handleDelete(row)}
                          title="Delete VAT bill?"
                          description={`Bill ${row.billNumber} (${money(row.amountWithVat)}) will be permanently removed.`}
                        />
                      ) : null}
                      </div>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
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
            unit="bills"
          />
        </div>
      </SectionCard>

      {/* ---- Month-by-month + Quarterly VAT return ---- */}
      <div className="grid gap-4 sm:gap-6 xl:grid-cols-2">
        {/* Month-by-month table for the selected year */}
        <SectionCard className="print-hidden overflow-hidden">
          <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between sm:p-6">
            <div>
              <h2 className="text-base font-semibold">Month-by-Month — {summaryYear}</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Tap a month to load its totals in the summary cards above.
              </p>
            </div>
            <Select value={summaryYear} onValueChange={setSummaryYear}>
              <SelectTrigger className="h-9 w-[110px]" aria-label="Month table year">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {yearOptions.map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {summaryLoading && !summary ? (
            <TableSkeleton rows={6} cols={5} />
          ) : (
            <div className="nice-scrollbar overflow-x-auto">
              <Table className="min-w-[520px]">
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead>Month</TableHead>
                    <TableHead className="text-right">Bills</TableHead>
                    <TableHead className="text-right">With VAT</TableHead>
                    <TableHead className="text-right">Without VAT</TableHead>
                    <TableHead className="text-right">VAT Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(summary?.monthly ?? []).map((m) => {
                    const selected = String(m.month) === summaryMonth
                    return (
                      <TableRow
                        key={m.month}
                        onClick={() => setSummaryMonth(String(m.month))}
                        className={cn(
                          'cursor-pointer',
                          selected &&
                            'bg-primary/5 hover:bg-primary/10 dark:bg-primary/10 dark:hover:bg-primary/15'
                        )}
                      >
                        <TableCell>
                          <span className="flex items-center gap-2 font-medium">
                            {monthName(m.month)}
                            {selected ? (
                              <span className="rounded-full bg-primary px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-primary-foreground">
                                Selected
                              </span>
                            ) : null}
                          </span>
                        </TableCell>
                        <TableCell className={cn('text-right tabular-nums', !m.count && 'text-muted-foreground/50')}>
                          {m.count || '—'}
                        </TableCell>
                        <TableCell className={cn('text-right tabular-nums', !m.withVat && 'text-muted-foreground/50')}>
                          {m.withVat ? money(m.withVat) : '—'}
                        </TableCell>
                        <TableCell className={cn('text-right tabular-nums', !m.withoutVat && 'text-muted-foreground/50')}>
                          {m.withoutVat ? money(m.withoutVat) : '—'}
                        </TableCell>
                        <TableCell
                          className={cn(
                            'text-right font-semibold tabular-nums',
                            m.vat ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground/50'
                          )}
                        >
                          {m.vat ? money(m.vat) : '—'}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
                <tfoot>
                  <TableRow className="bg-muted/50 font-bold hover:bg-muted/50">
                    <TableCell>Year Total {summaryYear}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {summary?.yearTotals.count ?? 0}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {money(summary?.yearTotals.withVat ?? 0)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {money(summary?.yearTotals.withoutVat ?? 0)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {money(summary?.yearTotals.vat ?? 0)}
                    </TableCell>
                  </TableRow>
                </tfoot>
              </Table>
            </div>
          )}
        </SectionCard>

        {/* Quarterly VAT return summary */}
        <SectionCard className="print-hidden overflow-hidden">
          <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between sm:p-6">
            <div>
              <h2 className="flex items-center gap-2 text-base font-semibold">
                <CalendarRange className="h-4 w-4 text-primary" />
                Quarterly VAT Return
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Input VAT per quarter — the figure to claim in the ZATCA return.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={selectedQuarter} onValueChange={setSelectedQuarter}>
                <SelectTrigger className="h-9 w-[140px]" aria-label="Quarter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {QUARTER_OPTIONS.map((q) => (
                    <SelectItem key={q.value} value={q.value}>
                      {q.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={summaryYear} onValueChange={setSummaryYear}>
                <SelectTrigger className="h-9 w-[100px]" aria-label="Quarter year">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {yearOptions.map((y) => (
                    <SelectItem key={y} value={String(y)}>
                      {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-4 p-4 sm:p-6">
            {/* Filing countdown — current year only */}
            {isCurrentYear && countdown ? (
              <div
                className={cn(
                  'flex items-start gap-3 rounded-xl border p-3.5',
                  countdown.daysToFile < 0
                    ? 'border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/40'
                    : 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40'
                )}
              >
                <CalendarClock
                  className={cn(
                    'mt-0.5 h-5 w-5 shrink-0',
                    countdown.daysToFile < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-amber-600 dark:text-amber-400'
                  )}
                />
                <div className="min-w-0 text-sm">
                  {countdown.daysToFile < 0 ? (
                    <>
                      <p className="font-semibold text-rose-700 dark:text-rose-300">
                        Filing period overdue by {Math.abs(countdown.daysToFile)} day
                        {Math.abs(countdown.daysToFile) === 1 ? '' : 's'}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        The deadline was {formatDate(countdown.filingDeadline)} — file the return as
                        soon as possible to avoid penalties.
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="font-semibold text-amber-800 dark:text-amber-300">
                        Q{summary?.currentQuarter} {summary?.currentYear} in progress —{' '}
                        {countdown.daysToEnd >= 0
                          ? `${countdown.daysToEnd} day${countdown.daysToEnd === 1 ? '' : 's'} until the quarter ends`
                          : 'quarter has ended'}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Filing period closes {formatDate(countdown.filingDeadline)} —{' '}
                        <span className="font-semibold text-amber-800 dark:text-amber-300">
                          {countdown.daysToFile} day{countdown.daysToFile === 1 ? '' : 's'} remaining
                        </span>{' '}
                        (deadline: last day of the month following quarter end).
                      </p>
                    </>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-3 rounded-xl border bg-muted/40 p-3.5 text-sm">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                <p className="text-xs text-muted-foreground">
                  Viewing {summaryYear} — the filing countdown only applies to the current year
                  ({currentYear}).
                </p>
              </div>
            )}

            {/* Quarter quick-select tiles */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {(summary?.quarters ?? []).map((q) => {
                const selected = String(q.quarter) === selectedQuarter
                const isNow = isCurrentYear && summary?.currentQuarter === q.quarter
                return (
                  <button
                    key={q.quarter}
                    type="button"
                    onClick={() => setSelectedQuarter(String(q.quarter))}
                    className={cn(
                      'rounded-xl border p-3 text-left transition-all',
                      'hover:-translate-y-0.5 hover:shadow-md',
                      selected
                        ? 'border-primary bg-primary/5 ring-2 ring-primary/30 dark:bg-primary/10'
                        : 'bg-card'
                    )}
                    aria-pressed={selected}
                  >
                    <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                      Q{q.quarter}
                      {isNow ? (
                        <span className="rounded-full bg-gold px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-[#2A2005]">
                          Now
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-1 text-sm font-bold tabular-nums">{money(q.vat)}</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {q.count} bill{q.count === 1 ? '' : 's'}
                    </p>
                  </button>
                )
              })}
            </div>

            {/* Selected quarter breakdown — 3 months + grand total */}
            <div className="nice-scrollbar overflow-x-auto rounded-xl border">
              <Table className="min-w-[440px]">
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead>Month</TableHead>
                    <TableHead className="text-right">Bills</TableHead>
                    <TableHead className="text-right">With VAT</TableHead>
                    <TableHead className="text-right">Without VAT</TableHead>
                    <TableHead className="text-right">Input VAT</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(quarter?.months ?? []).map((m) => (
                    <TableRow key={m.month}>
                      <TableCell className="font-medium">
                        {monthName(m.month)} {summaryYear}
                      </TableCell>
                      <TableCell className={cn('text-right tabular-nums', !m.count && 'text-muted-foreground/50')}>
                        {m.count || '—'}
                      </TableCell>
                      <TableCell className={cn('text-right tabular-nums', !m.withVat && 'text-muted-foreground/50')}>
                        {m.withVat ? money(m.withVat) : '—'}
                      </TableCell>
                      <TableCell className={cn('text-right tabular-nums', !m.withoutVat && 'text-muted-foreground/50')}>
                        {m.withoutVat ? money(m.withoutVat) : '—'}
                      </TableCell>
                      <TableCell
                        className={cn(
                          'text-right font-semibold tabular-nums',
                          m.vat ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground/50'
                        )}
                      >
                        {m.vat ? money(m.vat) : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <tfoot>
                  <TableRow className="bg-gold-soft/60 font-bold hover:bg-gold-soft/60 dark:bg-gold/10">
                    <TableCell>
                      Q{selectedQuarter} Grand Total
                      {isCurrentQuarter ? (
                        <span className="ml-2 rounded-full bg-gold px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-[#2A2005]">
                          Current
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{quarter?.count ?? 0}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(quarter?.withVat ?? 0)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(quarter?.withoutVat ?? 0)}</TableCell>
                    <TableCell className="text-right text-base tabular-nums">
                      {money(quarter?.vat ?? 0)}
                    </TableCell>
                  </TableRow>
                </tfoot>
              </Table>
            </div>
            <p className="text-xs text-muted-foreground">
              The <span className="font-semibold">Input VAT</span> grand total is the recoverable VAT
              on purchase expenses for Q{selectedQuarter} {summaryYear} — transfer it to the
              &quot;Input VAT&quot; section of the VAT return form.
            </p>
          </div>
        </SectionCard>
      </div>

      {/* ---- Add / Edit bill dialog ---- */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="nice-scrollbar max-h-[90vh] overflow-y-auto sm:max-w-[620px]">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit VAT Bill' : 'Add VAT Bill'}</DialogTitle>
            <DialogDescription>
              {editing
                ? 'Update the bill — the VAT split is recalculated from the current VAT rate.'
                : `Type only the Amount With VAT — the ${vatPercentLabel}% VAT split is calculated automatically.`}
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
              <div className="space-y-2">
                <Label htmlFor="vat-bill-date">Bill Date</Label>
                <Input
                  id="vat-bill-date"
                  type="date"
                  value={form.billDate}
                  onChange={(e) => setField('billDate', e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="vat-bill-number">Bill Number</Label>
                <Input
                  id="vat-bill-number"
                  value={form.billNumber}
                  onChange={(e) => setField('billNumber', e.target.value)}
                  placeholder="e.g. INV-2026-0142"
                  required
                  aria-invalid={Boolean(billNumberError)}
                  aria-describedby={billNumberError ? 'vat-bill-number-error' : undefined}
                />
                {billNumberError ? (
                  <p id="vat-bill-number-error" className="flex items-start gap-1.5 text-xs font-medium text-destructive">
                    <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
                    {billNumberError}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">Must be unique across all bills.</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="vat-supplier-name">Supplier Name</Label>
                <Input
                  id="vat-supplier-name"
                  value={form.supplierName}
                  onChange={(e) => setField('supplierName', e.target.value)}
                  placeholder="e.g. Saudi Industrial Supplies Co."
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="vat-supplier-number">Supplier VAT Number</Label>
                <Input
                  id="vat-supplier-number"
                  value={form.supplierVatNumber}
                  onChange={(e) => setField('supplierVatNumber', e.target.value)}
                  placeholder="e.g. 300012345600003"
                  className="tabular-nums"
                />
              </div>

              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="vat-description">Description / Note</Label>
                <Textarea
                  id="vat-description"
                  value={form.description}
                  onChange={(e) => setField('description', e.target.value)}
                  placeholder="Optional — what the bill was for"
                  rows={2}
                />
              </div>

              {/* The ONLY typed amount */}
              <div className="space-y-2">
                <Label htmlFor="vat-amount-with">
                  Amount With VAT ({currency}) <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="vat-amount-with"
                  type="number"
                  inputMode="decimal"
                  min="0.01"
                  step="0.01"
                  value={form.amountWithVat}
                  onChange={(e) => setField('amountWithVat', e.target.value)}
                  placeholder="0.00"
                  required
                  aria-invalid={Boolean(amountError)}
                  aria-describedby={amountError ? 'vat-amount-error' : undefined}
                  className="text-base font-semibold tabular-nums"
                />
                {amountError ? (
                  <p id="vat-amount-error" className="flex items-start gap-1.5 text-xs font-medium text-destructive">
                    <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
                    {amountError}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    The bill grand total — type this and the split below fills itself.
                  </p>
                )}
              </div>

              {/* Live-calculated, read-only split */}
              <div className="space-y-2">
                <Label htmlFor="vat-amount-without" className="flex items-center gap-1.5">
                  Amount Without VAT
                  <span className="rounded-full border bg-muted px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-muted-foreground">
                    Auto
                  </span>
                </Label>
                <Input
                  id="vat-amount-without"
                  readOnly
                  tabIndex={-1}
                  value={calc ? calc.withoutVat.toFixed(2) : ''}
                  placeholder="—"
                  className="bg-muted/60 tabular-nums text-muted-foreground"
                />
              </div>

              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="vat-amount-vat" className="flex items-center gap-1.5">
                  VAT Amount ({vatPercentLabel}%)
                  <span className="rounded-full border bg-muted px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-muted-foreground">
                    Auto
                  </span>
                </Label>
                <Input
                  id="vat-amount-vat"
                  readOnly
                  tabIndex={-1}
                  value={calc ? calc.vat.toFixed(2) : ''}
                  placeholder="—"
                  className="bg-muted/60 tabular-nums font-semibold text-amber-700 dark:text-amber-400"
                />
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Calculator className="h-3.5 w-3.5 shrink-0" />
                  Without VAT = With VAT ÷ {formatNumber(1 + vatRate, 4)} · VAT = With VAT − Without
                  VAT · e.g. 1,150.00 → 1,000.00 + 150.00
                </p>
              </div>
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? (
                  <>
                    <Calculator className="h-4 w-4 animate-spin" />
                    Saving…
                  </>
                ) : editing ? (
                  'Save Changes'
                ) : (
                  'Record Bill'
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ---- Print report ---- */}
      <VatReturnPrintDialog
        open={printOpen}
        onOpenChange={setPrintOpen}
        bills={printBills}
        totals={printTotals}
        summary={summary}
        periodLabel={periodLabel}
        quarter={Number(selectedQuarter)}
      />
    </div>
  )
}

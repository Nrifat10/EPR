'use client'

// Supplier P.O. view — manpower purchase orders sent TO suppliers:
//   • stat cards (count, P.O. value, received value, open orders)
//   • filter bar (search + status + year) with the shared mobile collapse
//   • desktop table + mobile stacked cards, row actions Edit / Delete / Print
//   • add/edit dialog following the boss's Manpower P.O. template: supplier
//     details (address / VAT / C.R.), ORDER fields (quotation ref, payment
//     terms), ASSIGNMENT fields (work site, start date, duration, working
//     hours) and a manpower items editor (TRADE / WORKERS / HOURLY RATE →
//     AMOUNT = workers × rate × hours-per-month, default 260). The server
//     always recomputes the final money figures — the in-dialog math is only
//     a preview. Draft preview renders the print document unsaved.
//   • CSV export of the filtered list, A4 print via SupplierPoPrintDialog
//     (reads the shared company letterhead config)
// Role-based: add/edit/delete/print only with supplierpo.* permissions.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  Building2,
  Calculator,
  Clock,
  Download,
  Eye,
  Hash,
  Mail,
  Package,
  PackageCheck,
  Pencil,
  Phone,
  Plus,
  Printer,
  Trash2,
  X,
} from 'lucide-react'

import { api, qs } from '@/lib/api-client'
import { buildCsv, csvFilename, downloadCsv } from '@/lib/csv'
import { formatDate, formatMoney, formatNumber, round2, toDateInputValue } from '@/lib/format'
import { can, useAppStore } from '@/lib/store'
import type { LetterheadConfig, Paginated, SupplierPoRow, SupplierRow } from '@/lib/types'
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
import { Checkbox } from '@/components/ui/checkbox'

import { ConfirmDelete } from '../shared/confirm-delete'
import { DataTablePagination } from '../shared/data-table-pagination'
import { EmptyState, TableSkeleton } from '../shared/empty-state'
import { FilterBar, FilterSelect, SearchInput } from '../shared/filter-select'
import { PageHeader, SectionCard, MobileFab } from '../shared/page-header'
import { StatCard } from '../shared/stat-card'
import { SupplierPoPrintDialog, DEFAULT_LETTERHEAD } from '../print/supplier-po-print'
import type { SupplierPoDetail } from '../print/supplier-po-print'

type PoListRow = SupplierPoRow & { itemCount: number }

type PoTotals = {
  count: number
  totalValue: number
  receivedValue: number
  receivedCount: number
  openCount: number
  openValue: number
}

type PoResponse = Paginated<PoListRow> & {
  totals: PoTotals
  years: number[]
}

type SupplierListResponse = Paginated<SupplierRow> & {
  totals: { activeCount: number; inactiveCount: number }
}

/** Saved-supplier directory form (string fields for smooth typing). */
type SupplierDirForm = {
  name: string
  contactPerson: string
  phone: string
  email: string
  address: string
  vatNumber: string
  crNumber: string
  status: string
  notes: string
}

function emptySupplierForm(): SupplierDirForm {
  return {
    name: '',
    contactPerson: '',
    phone: '',
    email: '',
    address: '',
    vatNumber: '',
    crNumber: '',
    status: 'active',
    notes: '',
  }
}

const EMPTY_TOTALS: PoTotals = {
  count: 0,
  totalValue: 0,
  receivedValue: 0,
  receivedCount: 0,
  openCount: 0,
  openValue: 0,
}

const STATUS_OPTIONS = [
  { value: 'draft', label: 'Draft' },
  { value: 'ordered', label: 'Ordered' },
  { value: 'received', label: 'Received' },
  { value: 'cancelled', label: 'Cancelled' },
]

/** Status chip colors — sky (not indigo) for "ordered", app palette elsewhere. */
function PoStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    draft: {
      label: 'Draft',
      className:
        'border-gray-200 bg-gray-100 text-gray-600 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-400',
    },
    ordered: {
      label: 'Ordered',
      className:
        'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-300',
    },
    received: {
      label: 'Received',
      className:
        'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300',
    },
    cancelled: {
      label: 'Cancelled',
      className:
        'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-300',
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

type PoForm = {
  supplierName: string
  supplierPhone: string
  attention: string
  supplierAddress: string
  supplierVat: string
  supplierCr: string
  issueDate: string
  quotationRef: string
  paymentTerms: string
  status: string
  vatPercent: string
  workSite: string
  startDate: string
  durationMonths: string
  workingHours: string
  hoursPerMonth: string
  notes: string
  items: ItemForm[]
}

let itemKeySeq = 0
function newItemForm(): ItemForm {
  itemKeySeq += 1
  return {
    key: `po-item-${itemKeySeq}`,
    description: '',
    unit: '',
    quantity: '1',
    unitPrice: '',
  }
}

function emptyForm(vatPercent: number): PoForm {
  return {
    supplierName: '',
    supplierPhone: '',
    attention: '',
    supplierAddress: '',
    supplierVat: '',
    supplierCr: '',
    issueDate: toDateInputValue(new Date()),
    quotationRef: '',
    paymentTerms: 'Net 30 Days',
    status: 'draft',
    vatPercent: String(vatPercent),
    workSite: '',
    startDate: '',
    durationMonths: '',
    workingHours: '10 hrs × 26 days',
    hoursPerMonth: '260',
    notes: '',
    items: [newItemForm()],
  }
}

/** Parse a numeric input; null when blank/invalid. */
function parseNum(v: string): number | null {
  if (v.trim() === '') return null
  const n = parseFloat(v)
  return isFinite(n) ? n : null
}

export function SupplierPosView() {
  const { user, settings } = useAppStore()
  const currency = settings.currency || 'SAR'
  const defaultVatPercent = settings.vatRate || 15
  const canCreate = can(user, 'supplierpo.create')
  const canEdit = can(user, 'supplierpo.edit')
  const canDelete = can(user, 'supplierpo.delete')
  // supplier directory (add / edit / delete saved suppliers)
  const canCreateSupplier = can(user, 'suppliers.create')
  const canEditSupplier = can(user, 'suppliers.edit')
  const canDeleteSupplier = can(user, 'suppliers.delete')

  const currentYear = new Date().getFullYear()

  // ---- list state ----
  const [rows, setRows] = useState<PoListRow[]>([])
  const [totals, setTotals] = useState<PoTotals>(EMPTY_TOTALS)
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
  const [editing, setEditing] = useState<SupplierPoRow | null>(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<PoForm>(() => emptyForm(defaultVatPercent))

  // ---- print ----
  const [printOpen, setPrintOpen] = useState(false)
  const [printPo, setPrintPo] = useState<SupplierPoDetail | null>(null)
  const [printLoading, setPrintLoading] = useState(false)
  // draft preview (unsaved form state rendered by the same print component)
  const [draftPreview, setDraftPreview] = useState<SupplierPoDetail | null>(null)

  // ---- saved suppliers directory ("add supplier" + persistence) ----
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([])
  const [suppliersLoading, setSuppliersLoading] = useState(false)
  const [suppliersOpen, setSuppliersOpen] = useState(false)
  const [supplierSearch, setSupplierSearch] = useState('')
  const debouncedSupplierSearch = useDebounce(supplierSearch)
  const [supplierFormOpen, setSupplierFormOpen] = useState(false)
  const [editingSupplier, setEditingSupplier] = useState<SupplierRow | null>(null)
  const [savingSupplier, setSavingSupplier] = useState(false)
  const [supplierForm, setSupplierForm] = useState<SupplierDirForm>(emptySupplierForm)

  // picked saved supplier inside the P.O. dialog ('' = type manually)
  const [pickedSupplierId, setPickedSupplierId] = useState('')
  // "save this supplier for future P.O.s" checkbox
  const [saveSupplier, setSaveSupplier] = useState(true)

  // company letterhead config — the printed P.O. reads it from here
  const [letterhead, setLetterhead] = useState<LetterheadConfig | null>(null)
  useEffect(() => {
    api
      .get<LetterheadConfig>('/api/letterhead')
      .then((res) => setLetterhead({ ...DEFAULT_LETTERHEAD, ...res }))
      .catch(() => {
        // fall back to the styled typed header
      })
  }, [])

  // guard against out-of-order responses when filters/page change quickly
  const requestId = useRef(0)

  // -----------------------------------------------------------------------
  // Data loading
  // -----------------------------------------------------------------------
  const load = useCallback(async () => {
    const id = ++requestId.current
    setLoading(true)
    try {
      const res = await api.get<PoResponse>(
        `/api/supplier-pos${qs({
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
      toast.error(e instanceof Error ? e.message : 'Failed to load purchase orders')
    } finally {
      if (id === requestId.current) setLoading(false)
    }
  }, [debouncedSearch, statusFilter, yearFilter, page, pageSize, currentYear])

  useEffect(() => {
    void load()
  }, [load])

  // -----------------------------------------------------------------------
  // Saved suppliers directory — loaded once for the P.O. dropdown and kept
  // fresh after every add/edit/delete. Server caps pageSize at 100, so walk
  // the pages (hard cap 10 pages = 1000 suppliers).
  // -----------------------------------------------------------------------
  const loadSuppliers = useCallback(async () => {
    setSuppliersLoading(true)
    try {
      const all: SupplierRow[] = []
      let p = 1
      for (;;) {
        const res = await api.get<SupplierListResponse>(
          `/api/suppliers${qs({ page: p, pageSize: 100, sort: 'name' })}`
        )
        all.push(...res.data)
        if (p >= res.totalPages || res.data.length === 0 || p >= 10) break
        p += 1
      }
      setSuppliers(all)
    } catch {
      // dropdown simply stays empty — P.O.s can always be typed manually
      setSuppliers([])
    } finally {
      setSuppliersLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadSuppliers()
  }, [loadSuppliers])

  // Client-side filter for the manage dialog list (list is fully loaded)
  const filteredSuppliers = useMemo(() => {
    const q = debouncedSupplierSearch.trim().toLowerCase()
    if (!q) return suppliers
    return suppliers.filter((s) =>
      [s.name, s.contactPerson, s.phone, s.email, s.address, s.vatNumber, s.crNumber]
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(q))
    )
  }, [suppliers, debouncedSupplierSearch])

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

  // -----------------------------------------------------------------------
  // Add / Edit dialog
  // -----------------------------------------------------------------------
  function openAdd() {
    setEditing(null)
    setForm(emptyForm(defaultVatPercent))
    setPickedSupplierId('')
    setSaveSupplier(true)
    setDialogOpen(true)
  }

  // Deep-open the create dialog when arriving via the command palette
  const shouldOpenCreate = useViewIntent('supplier-pos', 'create')
  useEffect(() => {
    if (shouldOpenCreate) openAdd()
  }, [shouldOpenCreate])

  async function openEdit(row: SupplierPoRow) {
    try {
      // list rows carry no items — fetch the full document for the editor
      const full = await api.get<SupplierPoDetail>(`/api/supplier-pos/${row.id}`)
      setEditing(row)
      setForm({
        supplierName: full.supplierName,
        supplierPhone: full.supplierPhone ?? '',
        attention: full.attention ?? '',
        supplierAddress: full.supplierAddress ?? '',
        supplierVat: full.supplierVat ?? '',
        supplierCr: full.supplierCr ?? '',
        issueDate: toDateInputValue(full.issueDate),
        quotationRef: full.quotationRef ?? '',
        paymentTerms: full.paymentTerms ?? 'Net 30 Days',
        status: full.status,
        vatPercent: String(Math.round(full.vatRate * 100)),
        workSite: full.workSite ?? '',
        startDate: full.startDate ? toDateInputValue(full.startDate) : '',
        durationMonths: full.durationMonths ? String(full.durationMonths) : '',
        workingHours: full.workingHours ?? '',
        hoursPerMonth: full.hoursPerMonth ? String(full.hoursPerMonth) : '',
        notes: full.notes ?? '',
        items: (full.items ?? []).map((it) => {
          itemKeySeq += 1
          return {
            key: `po-item-${itemKeySeq}`,
            description: it.description,
            unit: it.unit ?? '',
            quantity: String(it.quantity),
            unitPrice: String(it.unitPrice),
          }
        }),
      })
      setPickedSupplierId(full.supplierId ?? '')
      setSaveSupplier(!full.supplierId)
      setDialogOpen(true)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not open the purchase order')
    }
  }

  function setField<K extends keyof PoForm>(key: K, value: PoForm[K]) {
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
  // LIVE totals preview — mirrors the server-side computation exactly.
  // Manpower mode (hours/month set): AMOUNT = workers × rate × hrs/month.
  // -----------------------------------------------------------------------
  const calc = useMemo(() => {
    const hoursRaw = parseNum(form.hoursPerMonth)
    const hoursPerMonth = hoursRaw !== null && hoursRaw > 0 ? Math.round(hoursRaw) : null
    const items = form.items.map((it) => {
      const quantity = Math.max(0, parseNum(it.quantity) ?? 0)
      const unitPrice = Math.max(0, parseNum(it.unitPrice) ?? 0)
      return {
        quantity,
        unitPrice,
        lineTotal: round2(quantity * unitPrice * (hoursPerMonth ?? 1)),
      }
    })
    const subtotal = round2(items.reduce((s, it) => s + it.lineTotal, 0))
    const percent = parseNum(form.vatPercent)
    const vatRate = percent !== null && percent >= 0 && percent <= 100 ? percent / 100 : defaultVatPercent / 100
    const vatAmount = round2(subtotal * vatRate)
    const total = round2(subtotal + vatAmount)
    const monthsRaw = parseNum(form.durationMonths)
    const durationMonths = monthsRaw !== null && monthsRaw > 0 ? Math.round(monthsRaw) : null
    const totalWorkers = round2(items.reduce((s, it) => s + it.quantity, 0))
    return {
      items,
      subtotal,
      vatAmount,
      total,
      vatRate,
      hoursPerMonth,
      durationMonths,
      totalWorkers,
      poValue: durationMonths ? round2(total * durationMonths) : null,
    }
  }, [form, defaultVatPercent])

  const money = (n: number) => formatMoney(n, currency)
  const vatPercentLabel = Math.round(calc.vatRate * 100)
  const isManpower = calc.hoursPerMonth !== null

  // -----------------------------------------------------------------------
  // Saved suppliers directory — add / edit / delete (persists in the DB)
  // -----------------------------------------------------------------------
  function openSuppliersDialog() {
    setSupplierFormOpen(false)
    setEditingSupplier(null)
    setSuppliersOpen(true)
    void loadSuppliers()
  }

  function openAddSupplier() {
    setEditingSupplier(null)
    setSupplierForm(emptySupplierForm())
    setSupplierFormOpen(true)
  }

  function openEditSupplier(s: SupplierRow) {
    setEditingSupplier(s)
    setSupplierForm({
      name: s.name,
      contactPerson: s.contactPerson ?? '',
      phone: s.phone ?? '',
      email: s.email ?? '',
      address: s.address ?? '',
      vatNumber: s.vatNumber ?? '',
      crNumber: s.crNumber ?? '',
      status: s.status,
      notes: s.notes ?? '',
    })
    setSupplierFormOpen(true)
  }

  function setSupplierField<K extends keyof SupplierDirForm>(key: K, value: SupplierDirForm[K]) {
    setSupplierForm((f) => ({ ...f, [key]: value }))
  }

  async function handleSupplierSubmit() {
    const name = supplierForm.name.trim()
    if (!name) {
      toast.error('Supplier name is required')
      return
    }
    setSavingSupplier(true)
    try {
      const body = {
        name,
        contactPerson: supplierForm.contactPerson.trim() || null,
        phone: supplierForm.phone.trim() || null,
        email: supplierForm.email.trim() || null,
        address: supplierForm.address.trim() || null,
        vatNumber: supplierForm.vatNumber.trim() || null,
        crNumber: supplierForm.crNumber.trim() || null,
        status: supplierForm.status,
        notes: supplierForm.notes.trim() || null,
      }
      if (editingSupplier) {
        const updated = await api.put<SupplierRow>(`/api/suppliers/${editingSupplier.id}`, body)
        toast.success(`Supplier "${updated.name}" updated`)
      } else {
        const created = await api.post<SupplierRow>('/api/suppliers', body)
        toast.success(`Supplier "${created.name}" saved — it will auto-fill on future P.O.s`)
      }
      setSupplierFormOpen(false)
      setEditingSupplier(null)
      await loadSuppliers()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save the supplier')
    } finally {
      setSavingSupplier(false)
    }
  }

  async function handleSupplierDelete(s: SupplierRow) {
    try {
      await api.del(`/api/suppliers/${s.id}`)
      toast.success(`Supplier "${s.name}" deleted`)
      if (pickedSupplierId === s.id) setPickedSupplierId('')
      await loadSuppliers()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not delete the supplier')
    }
  }

  /** Picking a saved supplier auto-fills the whole P.O. supplier block. */
  function pickSupplier(id: string) {
    if (id === '__manual__') {
      setPickedSupplierId('')
      return
    }
    const s = suppliers.find((x) => x.id === id)
    if (!s) return
    setPickedSupplierId(id)
    setForm((f) => ({
      ...f,
      supplierName: s.name,
      attention: s.contactPerson ?? '',
      supplierPhone: s.phone ?? '',
      supplierAddress: s.address ?? '',
      supplierVat: s.vatNumber ?? '',
      supplierCr: s.crNumber ?? '',
    }))
  }

  async function handleSubmit() {
    // Friendly client-side validation before hitting the API
    const supplierName = form.supplierName.trim()
    if (!supplierName) {
      toast.error('Supplier name is required')
      return
    }
    if (!form.issueDate) {
      toast.error('Issue date is required')
      return
    }
    const items = form.items.map((it) => ({
      description: it.description.trim(),
      unit: it.unit.trim() || null,
      quantity: Math.max(0, parseNum(it.quantity) ?? 0),
      unitPrice: Math.max(0, parseNum(it.unitPrice) ?? 0),
    }))
    if (items.length === 0 || items.some((it) => !it.description)) {
      toast.error('Every line item needs a trade / description')
      return
    }
    if (items.some((it) => it.quantity <= 0)) {
      toast.error(isManpower ? 'Every trade needs workers greater than 0' : 'Every line item needs a quantity greater than 0')
      return
    }
    if (items.some((it) => it.unitPrice < 0)) {
      toast.error('Hourly rates cannot be negative')
      return
    }

    // Saved-supplier link: only keep the pick when the typed name still
    // matches the directory entry (the user may have edited the name after
    // picking — that makes it a manual / new supplier again).
    const picked = suppliers.find((s) => s.id === pickedSupplierId)
    const linkSupplierId = picked && picked.name === supplierName ? picked.id : null
    const saveThisSupplier = saveSupplier && !linkSupplierId

    const body = {
      supplierName,
      supplierId: linkSupplierId,
      saveSupplier: saveThisSupplier,
      supplierPhone: form.supplierPhone.trim() || null,
      attention: form.attention.trim() || null,
      supplierAddress: form.supplierAddress.trim() || null,
      supplierVat: form.supplierVat.trim() || null,
      supplierCr: form.supplierCr.trim() || null,
      issueDate: form.issueDate,
      quotationRef: form.quotationRef.trim() || null,
      paymentTerms: form.paymentTerms.trim() || null,
      workSite: form.workSite.trim() || null,
      startDate: form.startDate || null,
      durationMonths: calc.durationMonths,
      workingHours: form.workingHours.trim() || null,
      hoursPerMonth: calc.hoursPerMonth,
      status: form.status,
      vatRate: calc.vatRate,
      notes: form.notes.trim() || null,
      items,
    }

    setSaving(true)
    try {
      if (editing) {
        const updated = await api.put<SupplierPoRow>(`/api/supplier-pos/${editing.id}`, body)
        toast.success(`Purchase order ${updated.poNumber} updated`)
      } else {
        const created = await api.post<SupplierPoRow>('/api/supplier-pos', body)
        toast.success(`Purchase order ${created.poNumber} created`)
      }
      setDialogOpen(false)
      void load()
      // the save may have created / enriched a directory entry — keep the
      // dropdown fresh so it shows up immediately
      if (saveThisSupplier || linkSupplierId) void loadSuppliers()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save the purchase order')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(row: SupplierPoRow) {
    try {
      await api.del(`/api/supplier-pos/${row.id}`)
      toast.success(`Purchase order ${row.poNumber} deleted`)
      void load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not delete the purchase order')
    }
  }

  // -----------------------------------------------------------------------
  // CSV export + print
  // -----------------------------------------------------------------------

  /** Walk every page of the filtered list (server caps pageSize at 100). */
  async function fetchAllFiltered(): Promise<PoListRow[]> {
    const all: PoListRow[] = []
    let p = 1
    for (;;) {
      const res = await api.get<PoResponse>(
        `/api/supplier-pos${qs({
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
          'P.O. No',
          'Issue Date',
          'Expected Date',
          'Supplier',
          'Phone',
          'Attention',
          'Status',
          'Items',
          `Subtotal (${currency})`,
          `VAT Rate %`,
          `VAT Amount (${currency})`,
          `Total (${currency})`,
        ],
        all.map((p) => [
          p.poNumber,
          p.issueDate.slice(0, 10),
          p.expectedDate ? p.expectedDate.slice(0, 10) : '',
          p.supplierName,
          p.supplierPhone ?? '',
          p.attention ?? '',
          p.status,
          p.itemCount,
          p.subtotal.toFixed(2),
          (p.vatRate * 100).toFixed(0),
          p.vatAmount.toFixed(2),
          p.total.toFixed(2),
        ])
      )
      downloadCsv(csvFilename('supplier-pos'), csv)
      toast.success(`Exported ${all.length} purchase order${all.length === 1 ? '' : 's'} to CSV`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  async function openPrint(row: SupplierPoRow) {
    if (printLoading) return
    setPrintLoading(true)
    try {
      const full = await api.get<SupplierPoDetail>(`/api/supplier-pos/${row.id}`)
      setDraftPreview(null)
      setPrintPo(full)
      setPrintOpen(true)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not prepare the purchase order document')
    } finally {
      setPrintLoading(false)
    }
  }

  /** Build an unsaved P.O. from the current form state for the print preview. */
  function buildDraftPreview(): SupplierPoDetail | null {
    const supplierName = form.supplierName.trim()
    if (!supplierName) {
      toast.error('Fill the supplier name before previewing')
      return null
    }
    if (form.items.some((it) => !it.description.trim())) {
      toast.error('Every line item needs a trade / description')
      return null
    }
    const items = form.items.map((it, i) => ({
      id: `draft-${i}`,
      sr: i + 1,
      description: it.description.trim(),
      unit: it.unit.trim() || null,
      quantity: Math.max(0, parseNum(it.quantity) ?? 0),
      unitPrice: Math.max(0, parseNum(it.unitPrice) ?? 0),
      lineTotal: calc.items[i]?.lineTotal ?? 0,
    }))
    return {
      id: 'draft',
      poNumber: 'DRAFT',
      supplierId: null,
      supplierName,
      supplierPhone: form.supplierPhone.trim() || null,
      attention: form.attention.trim() || null,
      issueDate: form.issueDate ? new Date(form.issueDate).toISOString() : new Date().toISOString(),
      expectedDate: null,
      status: form.status,
      quotationRef: form.quotationRef.trim() || null,
      paymentTerms: form.paymentTerms.trim() || null,
      workSite: form.workSite.trim() || null,
      startDate: form.startDate ? new Date(form.startDate).toISOString() : null,
      durationMonths: calc.durationMonths,
      workingHours: form.workingHours.trim() || null,
      hoursPerMonth: calc.hoursPerMonth,
      supplierAddress: form.supplierAddress.trim() || null,
      supplierVat: form.supplierVat.trim() || null,
      supplierCr: form.supplierCr.trim() || null,
      subtotal: calc.subtotal,
      vatRate: calc.vatRate,
      vatAmount: calc.vatAmount,
      total: calc.total,
      notes: form.notes.trim() || null,
      createdByName: user?.name ?? null,
      createdAt: new Date().toISOString(),
      items,
    }
  }

  function openDraftPreview() {
    const draft = buildDraftPreview()
    if (!draft) return
    setPrintPo(null)
    setDraftPreview(draft)
    setPrintOpen(true)
  }

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------
  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      <PageHeader
        title="Supplier P.O."
        description={`Issue purchase orders to suppliers — items, ${vatPercentLabel}% VAT and totals are computed automatically.`}
      >
        <Button
          variant="outline"
          size="sm"
          onClick={openSuppliersDialog}
        >
          <Building2 className="h-4 w-4" />
          Suppliers
          <span className="ml-1 rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-muted-foreground">
            {suppliers.length}
          </span>
        </Button>
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
            Add P.O.
          </Button>
        ) : null}
      </PageHeader>

      {canCreate ? <MobileFab label="Add P.O." onClick={openAdd} icon={Plus} /> : null}

      {/* ---- Stat cards ---- */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Total P.O.s"
          value={String(totals.count)}
          icon={Package}
          tone="navy"
          sublabel={hasFilters ? 'Matching current filters' : 'All purchase orders on record'}
        />
        <StatCard
          title="P.O. Value"
          value={formatNumber(totals.totalValue)}
          valuePrefix={currency}
          icon={Calculator}
          tone="teal"
          sublabel="Sum of purchase order totals"
        />
        <StatCard
          title="Received Value"
          value={formatNumber(totals.receivedValue)}
          valuePrefix={currency}
          icon={PackageCheck}
          tone="green"
          sublabel={
            totals.receivedCount === 0
              ? 'Nothing received yet'
              : `${totals.receivedCount} received order${totals.receivedCount === 1 ? '' : 's'}`
          }
        />
        <StatCard
          title="Open Orders"
          value={String(totals.openCount)}
          icon={Clock}
          tone="gold"
          sublabel={
            totals.openCount === 0
              ? 'No open orders'
              : `Avg ${money(round2(totals.openValue / totals.openCount))} · draft + ordered`
          }
        />
      </div>

      {/* ---- Purchase orders list ---- */}
      <SectionCard className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div>
            <h2 className="text-base font-semibold">All Purchase Orders</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {hasFilters ? 'Filtered — matches your search/filters' : 'All records'} — newest first
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold tabular-nums text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300 sm:text-sm">
              Ordered: {money(totals.totalValue)}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold tabular-nums text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300 sm:text-sm">
              Open: {money(totals.openValue)}
            </span>
            <span className="inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium tabular-nums text-muted-foreground">
              {total} {total === 1 ? 'order' : 'orders'}
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
                placeholder="Search P.O. no, supplier, attention…"
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
            icon={Package}
            title="No purchase orders found"
            description={
              hasFilters
                ? 'Nothing matches your current filters. Try adjusting them.'
                : 'Create your first purchase order to start ordering from suppliers.'
            }
            action={
              canCreate ? (
                <Button size="sm" onClick={openAdd}>
                  <Plus className="h-4 w-4" />
                  Add P.O.
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
                    <TableHead className="w-[120px]">P.O. No</TableHead>
                    <TableHead>Supplier</TableHead>
                    <TableHead className="w-[110px]">Issue Date</TableHead>
                    <TableHead className="w-[110px]">Expected</TableHead>
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
                          {row.poNumber}
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
                            <p className="truncate font-medium">{row.supplierName}</p>
                            {row.attention || row.supplierPhone ? (
                              <p className="max-w-[260px] truncate text-xs text-muted-foreground">
                                {row.attention ? `Attn: ${row.attention}` : ''}
                                {row.attention && row.supplierPhone ? ' · ' : ''}
                                {row.supplierPhone ?? ''}
                              </p>
                            ) : null}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums">
                        {formatDate(row.issueDate)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                        {formatDate(row.expectedDate)}
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {money(row.total)}
                        <p className="text-xs font-normal tabular-nums text-muted-foreground">
                          incl. VAT {money(row.vatAmount)}
                        </p>
                      </TableCell>
                      <TableCell>
                        <PoStatusBadge status={row.status} />
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
                              aria-label={`Print purchase order ${row.poNumber}`}
                            >
                              <Printer className="h-4 w-4" />
                            </Button>
                            {canEdit ? (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                onClick={() => void openEdit(row)}
                                aria-label={`Edit purchase order ${row.poNumber}`}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                            ) : null}
                            {canDelete ? (
                              <ConfirmDelete
                                onConfirm={() => void handleDelete(row)}
                                title="Delete purchase order?"
                                description={`P.O. ${row.poNumber} (${row.supplierName}, ${money(
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
                        {row.poNumber}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {row.supplierName}
                      </p>
                      {row.attention ? (
                        <p className="truncate text-xs text-muted-foreground/80">
                          Attn: {row.attention}
                        </p>
                      ) : null}
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Issued {formatDate(row.issueDate)}
                        {row.expectedDate ? ` · expected ${formatDate(row.expectedDate)}` : ''}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-bold tabular-nums">{money(row.total)}</p>
                      <p className="text-[11px] font-medium tabular-nums text-muted-foreground">
                        incl. VAT {money(row.vatAmount)}
                      </p>
                      <div className="mt-1 flex justify-end">
                        <PoStatusBadge status={row.status} />
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
                        aria-label={`Print purchase order ${row.poNumber}`}
                      >
                        <Printer className="h-4 w-4" />
                      </Button>
                      {canEdit ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-foreground"
                          onClick={() => void openEdit(row)}
                          aria-label={`Edit purchase order ${row.poNumber}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      ) : null}
                      {canDelete ? (
                        <ConfirmDelete
                          onConfirm={() => void handleDelete(row)}
                          title="Delete purchase order?"
                          description={`P.O. ${row.poNumber} (${money(row.total)}) will be permanently removed.`}
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
          unit="orders"
        />
      </SectionCard>

      {/* ---- Add / Edit dialog ---- */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="nice-scrollbar max-h-[90vh] gap-5 overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit P.O. ${editing.poNumber}` : 'New Purchase Order'}</DialogTitle>
            <DialogDescription>
              {editing
                ? 'Update the purchase order details and line items. Totals are recomputed on save.'
                : 'Fill in the supplier, dates and line items — the P.O. number is generated automatically.'}
            </DialogDescription>
          </DialogHeader>

          {/* ---- Supplier details ---- */}
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold">Supplier</p>
              {pickedSupplierId ? (
                <Badge
                  variant="outline"
                  className="border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300"
                >
                  Saved supplier — details auto-filled
                </Badge>
              ) : null}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="po-saved-supplier">Saved Supplier (optional)</Label>
                <div className="flex gap-2">
                  <Select
                    value={pickedSupplierId || '__manual__'}
                    onValueChange={pickSupplier}
                  >
                    <SelectTrigger id="po-saved-supplier" className="w-full" aria-label="Saved supplier">
                      <SelectValue placeholder="Pick a saved supplier…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__manual__">
                        ✍️ New — type details manually
                      </SelectItem>
                      {suppliers.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                          {s.status !== 'active' ? ' (inactive)' : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-9 w-9 shrink-0"
                    onClick={openSuppliersDialog}
                    aria-label="Add or manage saved suppliers"
                    title="Add / manage suppliers"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {pickedSupplierId
                    ? 'Details filled from the supplier directory — edit below only for this P.O.'
                    : suppliers.length === 0
                      ? 'No saved suppliers yet — use + to add one, or type the details below.'
                      : 'Pick a saved supplier to auto-fill the details below.'}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="po-supplier">
                  Supplier Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="po-supplier"
                  value={form.supplierName}
                  onChange={(e) => setField('supplierName', e.target.value)}
                  placeholder="Supplier / company name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="po-phone">Supplier Phone</Label>
                <Input
                  id="po-phone"
                  value={form.supplierPhone}
                  onChange={(e) => setField('supplierPhone', e.target.value)}
                  placeholder="+966 …"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="po-attention">Contact Person</Label>
                <Input
                  id="po-attention"
                  value={form.attention}
                  onChange={(e) => setField('attention', e.target.value)}
                  placeholder="e.g. Mr. Faisal Al-Otaibi"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="po-supplier-address">Supplier Address</Label>
                <Input
                  id="po-supplier-address"
                  value={form.supplierAddress}
                  onChange={(e) => setField('supplierAddress', e.target.value)}
                  placeholder="District, City, Country"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="po-supplier-vat">Supplier VAT No.</Label>
                <Input
                  id="po-supplier-vat"
                  value={form.supplierVat}
                  onChange={(e) => setField('supplierVat', e.target.value)}
                  placeholder="300000000000003"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="po-supplier-cr">Supplier C.R. No.</Label>
                <Input
                  id="po-supplier-cr"
                  value={form.supplierCr}
                  onChange={(e) => setField('supplierCr', e.target.value)}
                  placeholder="1010 000 000"
                />
              </div>
            </div>
            {!pickedSupplierId ? (
              <label
                htmlFor="po-save-supplier"
                className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-dashed bg-muted/30 p-3 transition-colors hover:bg-muted/60"
              >
                <Checkbox
                  id="po-save-supplier"
                  checked={saveSupplier}
                  onCheckedChange={(v) => setSaveSupplier(v === true)}
                  className="mt-0.5"
                />
                <span className="space-y-0.5">
                  <span className="block text-sm font-medium">
                    Save this supplier for future P.O.s
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    The name, contact, address, VAT and C.R. details are stored in the supplier
                    directory and auto-fill the next time you pick this supplier.
                  </span>
                </span>
              </label>
            ) : null}
          </div>

          {/* ---- P.O. details (ORDER strip) ---- */}
          <div className="space-y-3">
            <p className="text-sm font-semibold">P.O. Details</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="po-issue-date">
                  PO Date <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="po-issue-date"
                  type="date"
                  value={form.issueDate}
                  onChange={(e) => setField('issueDate', e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="po-quote-ref">Quotation Ref.</Label>
                <Input
                  id="po-quote-ref"
                  value={form.quotationRef}
                  onChange={(e) => setField('quotationRef', e.target.value)}
                  placeholder="e.g. QT-RS-2214"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="po-payment-terms">Payment Terms</Label>
                <Input
                  id="po-payment-terms"
                  value={form.paymentTerms}
                  onChange={(e) => setField('paymentTerms', e.target.value)}
                  placeholder="Net 30 Days"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="po-status">Status</Label>
                <Select value={form.status} onValueChange={(v) => setField('status', v)}>
                  <SelectTrigger id="po-status" className="w-full" aria-label="Status">
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
              <div className="space-y-2">
                <Label htmlFor="po-vat">VAT %</Label>
                <Input
                  id="po-vat"
                  type="number"
                  min={0}
                  max={100}
                  step="0.5"
                  value={form.vatPercent}
                  onChange={(e) => setField('vatPercent', e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* ---- Assignment ---- */}
          <div className="space-y-3">
            <p className="text-sm font-semibold">Assignment</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="po-work-site">Work Site</Label>
                <Input
                  id="po-work-site"
                  value={form.workSite}
                  onChange={(e) => setField('workSite', e.target.value)}
                  placeholder="e.g. Dammam - Al Faisaliyah"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="po-start-date">Start Date</Label>
                <Input
                  id="po-start-date"
                  type="date"
                  value={form.startDate}
                  onChange={(e) => setField('startDate', e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="po-duration">Duration (months)</Label>
                <Input
                  id="po-duration"
                  type="number"
                  min={1}
                  step="1"
                  value={form.durationMonths}
                  onChange={(e) => setField('durationMonths', e.target.value)}
                  placeholder="e.g. 6"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="po-working-hours">Working Hours</Label>
                <Input
                  id="po-working-hours"
                  value={form.workingHours}
                  onChange={(e) => setField('workingHours', e.target.value)}
                  placeholder="10 hrs × 26 days"
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="po-hours-month">Hours / Month (rate basis)</Label>
                <Input
                  id="po-hours-month"
                  type="number"
                  min={1}
                  step="1"
                  value={form.hoursPerMonth}
                  onChange={(e) => setField('hoursPerMonth', e.target.value)}
                  placeholder="260"
                />
                <p className="text-xs text-muted-foreground">
                  {isManpower
                    ? `Amount = No. of Workers × Hourly Rate × ${calc.hoursPerMonth} hours / month`
                    : 'Blank = direct amounts (Qty × Unit Price) — for non-manpower purchases'}
                </p>
              </div>
            </div>
          </div>

          {/* ---- Manpower items editor ---- */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm">Manpower — Trades</Label>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {isManpower
                    ? `Amount = workers × hourly rate × ${calc.hoursPerMonth} hrs/month — totals update live.`
                    : 'Direct amounts (Qty × Unit Price) — totals update live.'}
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
                Add Trade
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
                      placeholder="Trade / category — e.g. Electrician"
                      className="min-w-0 flex-1"
                      aria-label={`Trade ${i + 1} name`}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => removeItemAt(i)}
                      disabled={form.items.length <= 1}
                      aria-label={`Remove trade ${i + 1}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2 pl-8">
                    <div className="space-y-1">
                      <Label className="text-[11px] text-muted-foreground">No. of Workers</Label>
                      <Input
                        type="number"
                        min={0}
                        step="any"
                        value={it.quantity}
                        onChange={(e) => setItemField(it.key, 'quantity', e.target.value)}
                        className="h-9 tabular-nums"
                        aria-label={`Trade ${i + 1} number of workers`}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px] text-muted-foreground">
                        Hourly Rate ({currency})
                      </Label>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={it.unitPrice}
                        onChange={(e) => setItemField(it.key, 'unitPrice', e.target.value)}
                        placeholder="0.00"
                        className="h-9 tabular-nums"
                        aria-label={`Trade ${i + 1} hourly rate`}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px] text-muted-foreground">
                        Amount ({currency})
                      </Label>
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
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <div>
                  <p className="text-[11px] font-medium text-muted-foreground">
                    {isManpower ? 'Monthly Subtotal' : 'Subtotal'}
                  </p>
                  <p className="text-sm font-semibold tabular-nums">{money(calc.subtotal)}</p>
                </div>
                <div>
                  <p className="text-[11px] font-medium text-muted-foreground">VAT ({vatPercentLabel}%)</p>
                  <p className="text-sm font-semibold tabular-nums">{money(calc.vatAmount)}</p>
                </div>
                <div>
                  <p className="text-[11px] font-medium text-muted-foreground">
                    {isManpower ? 'Total / Month' : 'Total'}
                  </p>
                  <p className="text-base font-bold tabular-nums">{money(calc.total)}</p>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-2 text-xs text-muted-foreground">
                {isManpower ? (
                  <span>
                    Total Workers:{' '}
                    <span className="font-semibold tabular-nums text-foreground">
                      {calc.totalWorkers.toLocaleString('en-US')}
                    </span>
                  </span>
                ) : null}
                {calc.durationMonths ? (
                  <span>
                    PO Value ({calc.durationMonths} months):{' '}
                    <span className="font-semibold tabular-nums text-foreground">
                      {money(calc.poValue ?? 0)}
                    </span>
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="po-notes">Terms &amp; Conditions (one per line)</Label>
            <Textarea
              id="po-notes"
              value={form.notes}
              onChange={(e) => setField('notes', e.target.value)}
              placeholder={'e.g.\nValid Iqama / work permit / GOSI for every worker before mobilization.\nAccommodation, transport and food are the supplier\u2019s responsibility.'}
              rows={4}
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={openDraftPreview}
              disabled={saving}
            >
              <Eye className="h-4 w-4" />
              Preview
            </Button>
            <Button onClick={() => void handleSubmit()} disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Save Changes' : 'Create P.O.'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- Manage saved suppliers dialog ---- */}
      <Dialog open={suppliersOpen} onOpenChange={setSuppliersOpen}>
        <DialogContent className="nice-scrollbar max-h-[90vh] gap-4 overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-muted-foreground" />
              Suppliers
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold tabular-nums text-muted-foreground">
                {suppliers.length}
              </span>
            </DialogTitle>
            <DialogDescription>
              Saved suppliers stay in the system — pick one when creating a P.O. and the details
              auto-fill. Deleting a supplier never deletes its purchase orders.
            </DialogDescription>
          </DialogHeader>

          {/* toolbar: search + add */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <SearchInput
              value={supplierSearch}
              onChange={setSupplierSearch}
              placeholder="Search suppliers…"
              className="w-full sm:flex-1"
            />
            {canCreateSupplier ? (
              <Button
                size="sm"
                variant={supplierFormOpen ? 'outline' : 'default'}
                className="sm:w-auto"
                onClick={() => (supplierFormOpen ? setSupplierFormOpen(false) : openAddSupplier())}
              >
                {supplierFormOpen ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                {supplierFormOpen ? 'Close Form' : 'Add Supplier'}
              </Button>
            ) : null}
          </div>

          {/* add / edit form */}
          {supplierFormOpen ? (
            <div className="space-y-3 rounded-xl border bg-muted/20 p-4">
              <p className="text-sm font-semibold">
                {editingSupplier ? `Edit — ${editingSupplier.name}` : 'New Supplier'}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="sup-name">
                    Supplier Name <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="sup-name"
                    value={supplierForm.name}
                    onChange={(e) => setSupplierField('name', e.target.value)}
                    placeholder="Supplier / company name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sup-contact">Contact Person</Label>
                  <Input
                    id="sup-contact"
                    value={supplierForm.contactPerson}
                    onChange={(e) => setSupplierField('contactPerson', e.target.value)}
                    placeholder="e.g. Mr. Faisal Al-Otaibi"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sup-phone">Phone</Label>
                  <Input
                    id="sup-phone"
                    value={supplierForm.phone}
                    onChange={(e) => setSupplierField('phone', e.target.value)}
                    placeholder="+966 …"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sup-email">Email</Label>
                  <Input
                    id="sup-email"
                    type="email"
                    value={supplierForm.email}
                    onChange={(e) => setSupplierField('email', e.target.value)}
                    placeholder="accounts@supplier.com"
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="sup-address">Address</Label>
                  <Input
                    id="sup-address"
                    value={supplierForm.address}
                    onChange={(e) => setSupplierField('address', e.target.value)}
                    placeholder="District, City, Country"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sup-vat">VAT No.</Label>
                  <Input
                    id="sup-vat"
                    value={supplierForm.vatNumber}
                    onChange={(e) => setSupplierField('vatNumber', e.target.value)}
                    placeholder="300000000000003"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sup-cr">C.R. No.</Label>
                  <Input
                    id="sup-cr"
                    value={supplierForm.crNumber}
                    onChange={(e) => setSupplierField('crNumber', e.target.value)}
                    placeholder="1010 000 000"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sup-status">Status</Label>
                  <Select
                    value={supplierForm.status}
                    onValueChange={(v) => setSupplierField('status', v)}
                  >
                    <SelectTrigger id="sup-status" className="w-full" aria-label="Supplier status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="inactive">Inactive</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sup-notes">Notes</Label>
                  <Input
                    id="sup-notes"
                    value={supplierForm.notes}
                    onChange={(e) => setSupplierField('notes', e.target.value)}
                    placeholder="Optional internal notes"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSupplierFormOpen(false)}
                  disabled={savingSupplier}
                >
                  Cancel
                </Button>
                <Button size="sm" onClick={() => void handleSupplierSubmit()} disabled={savingSupplier}>
                  {savingSupplier ? 'Saving…' : editingSupplier ? 'Save Changes' : 'Save Supplier'}
                </Button>
              </div>
            </div>
          ) : null}

          {/* list */}
          {suppliersLoading && suppliers.length === 0 ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-16 animate-pulse rounded-lg bg-muted/50" />
              ))}
            </div>
          ) : filteredSuppliers.length === 0 ? (
            <div className="rounded-xl border border-dashed p-6 text-center">
              <Building2 className="mx-auto h-8 w-8 text-muted-foreground/60" />
              <p className="mt-2 text-sm font-medium">
                {debouncedSupplierSearch
                  ? 'No suppliers match your search'
                  : 'No saved suppliers yet'}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {debouncedSupplierSearch
                  ? 'Try a different name, phone or VAT number.'
                  : 'Add your first supplier — it will be saved and auto-fill future P.O.s.'}
              </p>
              {canCreateSupplier && !debouncedSupplierSearch && !supplierFormOpen ? (
                <Button size="sm" variant="outline" className="mt-3" onClick={openAddSupplier}>
                  <Plus className="h-4 w-4" />
                  Add Supplier
                </Button>
              ) : null}
            </div>
          ) : (
            <ul className="nice-scrollbar max-h-[46vh] space-y-2 overflow-y-auto pr-1">
              {filteredSuppliers.map((s) => (
                <li
                  key={s.id}
                  className={cn(
                    'rounded-xl border p-3 transition-colors hover:bg-muted/30',
                    s.status !== 'active' && 'opacity-70'
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-2.5">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                        <Building2 className="h-4 w-4 text-muted-foreground" />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">
                          {s.name}
                          {s.status !== 'active' ? (
                            <Badge variant="outline" className="ml-2 text-[10px] text-muted-foreground">
                              Inactive
                            </Badge>
                          ) : null}
                        </p>
                        {s.contactPerson ? (
                          <p className="truncate text-xs text-muted-foreground">
                            Attn: {s.contactPerson}
                          </p>
                        ) : null}
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                          {s.phone ? (
                            <span className="inline-flex items-center gap-1">
                              <Phone className="h-3 w-3" />
                              {s.phone}
                            </span>
                          ) : null}
                          {s.email ? (
                            <span className="inline-flex items-center gap-1">
                              <Mail className="h-3 w-3" />
                              {s.email}
                            </span>
                          ) : null}
                          {s.address ? <span className="truncate">{s.address}</span> : null}
                        </div>
                        {s.vatNumber || s.crNumber ? (
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            {s.vatNumber ? (
                              <span className="rounded border bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium tabular-nums">
                                VAT {s.vatNumber}
                              </span>
                            ) : null}
                            {s.crNumber ? (
                              <span className="rounded border bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium tabular-nums">
                                C.R. {s.crNumber}
                              </span>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className="text-[11px] font-medium tabular-nums text-muted-foreground">
                        {s.poCount} P.O.{s.poCount === 1 ? '' : 's'}
                      </span>
                      <div className="flex items-center gap-0.5">
                        {canEditSupplier ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-foreground"
                            onClick={() => openEditSupplier(s)}
                            aria-label={`Edit supplier ${s.name}`}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        ) : null}
                        {canDeleteSupplier ? (
                          <ConfirmDelete
                            onConfirm={() => void handleSupplierDelete(s)}
                            title="Delete supplier?"
                            description={`"${s.name}" will be removed from the supplier directory.${
                              s.poCount
                                ? ` Its ${s.poCount} purchase order${s.poCount === 1 ? '' : 's'} will be kept.`
                                : ''
                            }`}
                          />
                        ) : null}
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>

      {/* ---- Print dialog (saved documents + live drafts) ---- */}
      <SupplierPoPrintDialog
        po={printPo ?? draftPreview}
        letterhead={letterhead}
        open={printOpen}
        onOpenChange={(v) => {
          setPrintOpen(v)
          if (!v) {
            setPrintPo(null)
            setDraftPreview(null)
          }
        }}
      />
    </div>
  )
}

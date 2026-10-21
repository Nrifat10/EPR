'use client'

// E-Invoice view — bilingual ZATCA-style tax invoices, credit notes and debit
// notes (the flagship business document module):
//   • KPI cards (total invoiced / collected / outstanding / overdue)
//   • filter bar (search, status incl. derived Overdue, client, date range,
//     year) with the shared mobile collapse
//   • desktop table + mobile stacked cards; row actions: preview, edit
//     (draft), issue (draft — locks the document + ZATCA chain), record
//     payment, duplicate, credit/debit note creation, signed-copy upload
//     (proof of delivery on locked invoices), delete (draft)
//   • big bilingual add/edit dialog: every English field has an Arabic twin
//     (RTL, Cairo font) that auto-translates when the English field is left;
//     manually typed Arabic is flagged and never overwritten. "Translate All"
//     batches every eligible field in one request. Live totals + bilingual
//     amount in words, unsaved draft preview rendered by the exact print
//     component used for the final PDF.
//   • payments dialog (list + add + delete, status recompute)
// Role-based: actions gated behind einvoices.* permissions.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  CircleDollarSign,
  CloudUpload,
  Copy,
  Eye,
  FileCode,
  FileOutput,
  Languages,
  Loader2,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Plus,
  QrCode,
  Send,
  ShieldCheck,
  Trash2,
  UserPlus,
  Wallet,
  X,
} from 'lucide-react'

import { api, qs } from '@/lib/api-client'
import { amountInWordsBoth } from '@/lib/arabic-words'
import { fileToDataUrl } from '@/lib/image-data-url'
import { formatDate, formatMoney, formatNumber, round2, toDateInputValue } from '@/lib/format'
import { can, useAppStore } from '@/lib/store'
import type { ClientRow, EInvoiceConfig, EInvoiceRow, Paginated } from '@/lib/types'
import { useDebounce } from '@/hooks/use-debounce'
import { useViewIntent } from '@/hooks/use-view-intent'
import { cn } from '@/lib/utils'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
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
import { MobileFab, PageHeader, SectionCard } from '../shared/page-header'
import { StatCard } from '../shared/stat-card'
import { EInvoicePrintDialog } from '../print/e-invoice-print'
import {
  EInvoiceZatcaSubmitDialog,
  downloadEInvoiceUbl,
} from './e-invoice-zatca-submit'
import { ZatcaStatusBadge } from './zatca-shared'

// ── List response shapes ────────────────────────────────────────────────────

type EInvoiceTotals = {
  count: number
  totalDue: number
  paid: number
  outstanding: number
  overdueCount: number
  overdueAmount: number
}

type EInvoicesResponse = {
  rows: EInvoiceRow[]
  totalCount: number
  totalPages: number
  page: number
  pageSize: number
  totals: EInvoiceTotals
  years: number[]
}

const EMPTY_TOTALS: EInvoiceTotals = {
  count: 0,
  totalDue: 0,
  paid: 0,
  outstanding: 0,
  overdueCount: 0,
  overdueAmount: 0,
}

const STATUS_FILTER_OPTIONS = [
  { value: 'draft', label: 'Draft' },
  { value: 'issued', label: 'Issued' },
  { value: 'partially_paid', label: 'Partially Paid' },
  { value: 'paid', label: 'Paid' },
  { value: 'overdue', label: 'Overdue' },
]

const DOC_TYPE_OPTIONS = [
  { value: 'invoice', label: 'Tax Invoice' },
  { value: 'credit_note', label: 'Credit Note' },
  { value: 'debit_note', label: 'Debit Note' },
]

const DOC_TYPE_HINTS: Record<string, string> = {
  invoice: '',
  credit_note: 'Corrects an issued invoice — references the original INV-… number.',
  debit_note: 'Adds a charge to an issued invoice — references the original INV-… number.',
}

/** Status chip colors — amber issued, emerald paid, neutral draft, teal partial, rose overdue. */
function EIStatusBadge({ status, overdue }: { status: string; overdue: boolean }) {
  const map: Record<string, { label: string; className: string }> = {
    draft: {
      label: 'Draft',
      className:
        'border-gray-200 bg-gray-100 text-gray-600 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-400',
    },
    issued: {
      label: 'Issued',
      className:
        'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300',
    },
    partially_paid: {
      label: 'Partially Paid',
      className:
        'border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-800 dark:bg-teal-950 dark:text-teal-300',
    },
    paid: {
      label: 'Paid',
      className:
        'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300',
    },
  }
  const entry = overdue
    ? {
        label: 'Overdue',
        className:
          'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-300',
      }
    : (map[status] ?? {
        label: status,
        className:
          'border-gray-200 bg-gray-50 text-gray-600 dark:border-gray-800 dark:bg-gray-800/40 dark:text-gray-400',
      })
  return (
    <Badge variant="outline" className={cn('whitespace-nowrap font-medium', entry.className)}>
      {entry.label}
    </Badge>
  )
}

/** Gold-tinted CRN / rose-tinted DBN chip next to the invoice number. */
function DocTypeChip({ docType }: { docType: string }) {
  if (docType === 'credit_note') {
    return (
      <Badge
        variant="outline"
        className="border-[#C0934C]/50 bg-[#C0934C]/10 text-[#8E6420] dark:border-[#C0934C]/40 dark:bg-[#C0934C]/15 dark:text-[#E1B169]"
      >
        Credit Note
      </Badge>
    )
  }
  if (docType === 'debit_note') {
    return (
      <Badge
        variant="outline"
        className="border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-300"
      >
        Debit Note
      </Badge>
    )
  }
  return null
}

/** Compact ZATCA phase chip — P1 (Generation) / P2 (Integration). */
function PhaseChip({ phase }: { phase: number | null | undefined }) {
  const isP2 = (phase ?? 1) === 2
  return (
    <Badge
      variant="outline"
      title={
        isP2
          ? 'ZATCA Phase 2 (Integration) — 8-tag cryptographic QR + Fatoora submission'
          : 'ZATCA Phase 1 (Generation) — 5-tag QR, no portal submission'
      }
      className={cn(
        'whitespace-nowrap font-semibold',
        isP2
          ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300'
          : 'border-[#132A4A]/25 bg-[#132A4A]/5 text-[#132A4A] dark:border-[#E1B169]/30 dark:bg-[#0C1D33]/60 dark:text-[#E1B169]'
      )}
    >
      {isP2 ? 'P2 · Integration' : 'P1 · Generation'}
    </Badge>
  )
}

// ── Form model ──────────────────────────────────────────────────────────────

/** Header Arabic field keys — MUST match the backend arManualFlags contract. */
type ArHeaderKey = 'clientName' | 'clientAddress' | 'project' | 'paymentTerms' | 'paymentMethod' | 'notes'

type EItemForm = {
  key: string
  descriptionEn: string
  descriptionAr: string
  descArManual: boolean
  unitEn: string
  unitAr: string
  unitArManual: boolean
  quantity: string
  unitPrice: string
  discount: string
  vatPercent: string
}

type EIForm = {
  docType: 'invoice' | 'credit_note' | 'debit_note'
  zatcaPhase: 1 | 2
  relatedInvoiceId: string
  clientId: string
  clientNameEn: string
  clientNameAr: string
  clientVatNumber: string
  clientCrNumber: string
  clientAddressEn: string
  clientAddressAr: string
  poRef: string
  contractRef: string
  projectEn: string
  projectAr: string
  paymentTermsEn: string
  paymentTermsAr: string
  paymentMethodEn: string
  paymentMethodAr: string
  issueDate: string
  supplyDate: string
  dueDate: string
  notesEn: string
  notesAr: string
  showReceiverSignature: boolean
  items: EItemForm[]
  arManual: Record<ArHeaderKey, boolean>
}

/** The bilingual header pairs (drives rendering + translation + saving). */
const HEADER_AR_FIELDS: Array<{
  key: ArHeaderKey
  label: string
  enKey: keyof EIForm
  arKey: keyof EIForm
  context: string
  multiline?: boolean
  placeholderEn: string
  placeholderAr: string
}> = [
  {
    key: 'clientName',
    label: 'Client Name',
    enKey: 'clientNameEn',
    arKey: 'clientNameAr',
    context: 'client_name',
    placeholderEn: 'Client / company name',
    placeholderAr: 'اسم العميل / الشركة',
  },
  {
    key: 'clientAddress',
    label: 'Address',
    enKey: 'clientAddressEn',
    arKey: 'clientAddressAr',
    context: 'address',
    multiline: true,
    placeholderEn: 'Street, city, country',
    placeholderAr: 'الشارع، المدينة، الدولة',
  },
  {
    key: 'project',
    label: 'Project',
    enKey: 'projectEn',
    arKey: 'projectAr',
    context: 'project',
    placeholderEn: 'e.g. Jubail Industrial Support',
    placeholderAr: 'المشروع',
  },
  {
    key: 'paymentTerms',
    label: 'Payment Terms',
    enKey: 'paymentTermsEn',
    arKey: 'paymentTermsAr',
    context: 'payment_terms',
    multiline: true,
    placeholderEn: 'e.g. 30 days from invoice date',
    placeholderAr: 'شروط الدفع',
  },
  {
    key: 'paymentMethod',
    label: 'Payment Method',
    enKey: 'paymentMethodEn',
    arKey: 'paymentMethodAr',
    context: 'payment_method',
    placeholderEn: 'e.g. Bank transfer',
    placeholderAr: 'طريقة الدفع',
  },
  {
    key: 'notes',
    label: 'Notes',
    enKey: 'notesEn',
    arKey: 'notesAr',
    context: 'notes',
    multiline: true,
    placeholderEn: 'Optional notes printed on the invoice',
    placeholderAr: 'ملاحظات',
  },
]

const MANUAL_DOT_CLASS = 'inline-block h-1.5 w-1.5 rounded-full bg-amber-500'

let itemKeySeq = 0
function newItemForm(): EItemForm {
  itemKeySeq += 1
  return {
    key: `item-${itemKeySeq}`,
    descriptionEn: '',
    descriptionAr: '',
    descArManual: false,
    unitEn: '',
    unitAr: '',
    unitArManual: false,
    quantity: '1',
    unitPrice: '',
    discount: '',
    vatPercent: '15',
  }
}

function emptyForm(showReceiverSignature: boolean): EIForm {
  const today = new Date()
  const due = new Date(today.getTime() + 30 * 86_400_000)
  return {
    docType: 'invoice',
    zatcaPhase: 1,
    relatedInvoiceId: '',
    clientId: '',
    clientNameEn: '',
    clientNameAr: '',
    clientVatNumber: '',
    clientCrNumber: '',
    clientAddressEn: '',
    clientAddressAr: '',
    poRef: '',
    contractRef: '',
    projectEn: '',
    projectAr: '',
    paymentTermsEn: '',
    paymentTermsAr: '',
    paymentMethodEn: '',
    paymentMethodAr: '',
    issueDate: toDateInputValue(today),
    supplyDate: '',
    dueDate: toDateInputValue(due),
    notesEn: '',
    notesAr: '',
    showReceiverSignature,
    items: [newItemForm()],
    arManual: {
      clientName: false,
      clientAddress: false,
      project: false,
      paymentTerms: false,
      paymentMethod: false,
      notes: false,
    },
  }
}

/** Parse a numeric input; null when blank/invalid. */
function parseNum(v: string): number | null {
  if (v.trim() === '') return null
  const n = parseFloat(v)
  return isFinite(n) ? n : null
}

// ── Translation plumbing ────────────────────────────────────────────────────

type TranslateEntry = { key: string; text: string; context: string }
type TranslateResponse = {
  results: Array<{ key: string; translated: string; source: string }>
  providerError?: string
}

/**
 * English + Arabic input pair. The Arabic input is RTL with the Cairo font;
 * when the English input is left (blur) the Arabic auto-translates unless it
 * was typed manually. The Languages button re-translates — manual Arabic asks
 * for confirmation first (handled by the parent).
 */
function ArField({
  idPrefix,
  label,
  required,
  en,
  ar,
  manual,
  busy,
  disabled,
  placeholderEn,
  placeholderAr,
  multiline,
  onEnChange,
  onArChange,
  onEnBlur,
  onTranslate,
}: {
  idPrefix: string
  label: string
  required?: boolean
  en: string
  ar: string
  manual: boolean
  busy: boolean
  disabled?: boolean
  placeholderEn?: string
  placeholderAr?: string
  multiline?: boolean
  onEnChange: (v: string) => void
  onArChange: (v: string) => void
  onEnBlur: () => void
  onTranslate: () => void
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label htmlFor={`${idPrefix}-en`}>
          {label} {required ? <span className="text-destructive">*</span> : null}
        </Label>
        {manual && ar.trim() ? (
          <span
            className={cn(MANUAL_DOT_CLASS, 'mr-auto ml-2')}
            title="Arabic edited manually — auto-translate will not overwrite it"
            aria-label="Arabic edited manually"
          />
        ) : null}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {multiline ? (
          <Textarea
            id={`${idPrefix}-en`}
            value={en}
            onChange={(e) => onEnChange(e.target.value)}
            onBlur={onEnBlur}
            placeholder={placeholderEn}
            rows={2}
            disabled={disabled}
            aria-label={`${label} (English)`}
          />
        ) : (
          <Input
            id={`${idPrefix}-en`}
            value={en}
            onChange={(e) => onEnChange(e.target.value)}
            onBlur={onEnBlur}
            placeholder={placeholderEn}
            disabled={disabled}
            aria-label={`${label} (English)`}
          />
        )}
        <div className="flex gap-1">
          {multiline ? (
            <Textarea
              id={`${idPrefix}-ar`}
              lang="ar"
              dir="rtl"
              value={ar}
              onChange={(e) => onArChange(e.target.value)}
              placeholder={placeholderAr}
              rows={2}
              disabled={disabled}
              className="flex-1 font-arabic"
              aria-label={`${label} (Arabic)`}
            />
          ) : (
            <Input
              id={`${idPrefix}-ar`}
              lang="ar"
              dir="rtl"
              value={ar}
              onChange={(e) => onArChange(e.target.value)}
              placeholder={placeholderAr}
              disabled={disabled}
              className="flex-1 font-arabic"
              aria-label={`${label} (Arabic)`}
            />
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0 text-muted-foreground hover:text-foreground"
            onClick={onTranslate}
            disabled={busy || disabled || !en.trim()}
            title="Translate to Arabic"
            aria-label={`Translate ${label} to Arabic`}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Languages className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ── The view ────────────────────────────────────────────────────────────────

export function EInvoicesView() {
  const { user, settings } = useAppStore()
  const currency = settings.currency || 'SAR'
  const canCreate = can(user, 'einvoices.create')
  const canEdit = can(user, 'einvoices.edit')
  const canDelete = can(user, 'einvoices.delete')

  const currentYear = new Date().getFullYear()
  const money = (n: number) => formatMoney(n, currency)

  // ---- list state ----
  const [rows, setRows] = useState<EInvoiceRow[]>([])
  const [totals, setTotals] = useState<EInvoiceTotals>(EMPTY_TOTALS)
  const [years, setYears] = useState<number[]>([currentYear])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [loading, setLoading] = useState(true)

  // ---- list filters ----
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search)
  const [statusFilter, setStatusFilter] = useState('all')
  const [clientFilter, setClientFilter] = useState('all')
  const [phaseFilter, setPhaseFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [yearFilter, setYearFilter] = useState('all')

  // ---- clients (filter + picker) ----
  const [clients, setClients] = useState<ClientRow[]>([])
  const clientsLoaded = useRef(false)

  // ---- add/edit dialog ----
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<EInvoiceRow | null>(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<EIForm>(() => emptyForm(true))
  const [nextNumber, setNextNumber] = useState('')
  const nextNumberCache = useRef<Map<string, string>>(new Map())
  const [issuedInvoices, setIssuedInvoices] = useState<EInvoiceRow[]>([])
  const issuedLoaded = useRef(false)

  // ---- translation ----
  const [translatingKeys, setTranslatingKeys] = useState<Set<string>>(new Set())
  const [translateAllBusy, setTranslateAllBusy] = useState(false)
  const [translateError, setTranslateError] = useState<string | null>(null)
  const [translateConfirm, setTranslateConfirm] = useState<TranslateEntry | null>(null)

  // ---- issue / delete confirmations ----
  const [issueTarget, setIssueTarget] = useState<EInvoiceRow | null>(null)
  const [issuing, setIssuing] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<EInvoiceRow | null>(null)

  // ---- payments dialog ----
  const [payOpen, setPayOpen] = useState(false)
  const [payInvoice, setPayInvoice] = useState<EInvoiceRow | null>(null)
  const [paySaving, setPaySaving] = useState(false)
  const [payMethodBusy, setPayMethodBusy] = useState(false)
  const [payForm, setPayForm] = useState(() => ({
    amount: '',
    paymentDate: toDateInputValue(new Date()),
    methodEn: '',
    methodAr: '',
    reference: '',
    notes: '',
  }))

  // ---- signed copy (proof of delivery) ----
  const signedInputRef = useRef<HTMLInputElement>(null)
  const signedTargetRef = useRef<EInvoiceRow | null>(null)
  const [signedBusy, setSignedBusy] = useState(false)
  const [signedPreview, setSignedPreview] = useState<{ number: string; image: string } | null>(null)

  // ---- note creation ----
  const [noteBusy, setNoteBusy] = useState(false)

  // ---- ZATCA Phase 2 submission (connect system) ----
  const [zatcaTarget, setZatcaTarget] = useState<EInvoiceRow | null>(null)
  const [zatcaOpen, setZatcaOpen] = useState(false)

  // ---- quick add client (saved to the Clients module) ----
  const [clientAddOpen, setClientAddOpen] = useState(false)
  const [clientAddSaving, setClientAddSaving] = useState(false)
  const [clientForm, setClientForm] = useState(() => ({
    name: '',
    nameAr: '',
    contactPerson: '',
    phone: '',
    email: '',
    city: '',
    address: '',
    vatNumber: '',
    crNumber: '',
  }))

  // ---- print / preview ----
  const [printOpen, setPrintOpen] = useState(false)
  const [printLoading, setPrintLoading] = useState(false)
  const [printInvoice, setPrintInvoice] = useState<EInvoiceRow | null>(null)
  const [draftPreview, setDraftPreview] = useState<EInvoiceRow | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [eiConfig, setEiConfig] = useState<EInvoiceConfig | null>(null)
  const configRef = useRef<EInvoiceConfig | null>(null)
  const configLoaded = useRef(false)

  // guard against out-of-order responses when filters/page change quickly
  const requestId = useRef(0)

  // -----------------------------------------------------------------------
  // Data loading
  // -----------------------------------------------------------------------
  const load = useCallback(async () => {
    const id = ++requestId.current
    setLoading(true)
    try {
      const res = await api.get<EInvoicesResponse>(
        `/api/e-invoices${qs({
          search: debouncedSearch,
          status: statusFilter === 'all' ? '' : statusFilter,
          clientId: clientFilter === 'all' ? '' : clientFilter,
          zatcaPhase: phaseFilter === 'all' ? '' : phaseFilter,
          dateFrom,
          dateTo,
          year: yearFilter === 'all' ? '' : yearFilter,
          page,
          pageSize,
        })}`
      )
      if (id !== requestId.current) return
      if (res.rows.length === 0 && res.totalCount > 0 && res.page > res.totalPages) {
        setPage(res.totalPages)
        return
      }
      setRows(res.rows)
      setTotals(res.totals ?? EMPTY_TOTALS)
      setYears(res.years?.length ? res.years : [currentYear])
      setTotal(res.totalCount)
      setTotalPages(res.totalPages)
    } catch (e) {
      if (id !== requestId.current) return
      setRows([])
      setTotals(EMPTY_TOTALS)
      setTotal(0)
      setTotalPages(1)
      toast.error(e instanceof Error ? e.message : 'Failed to load e-invoices')
    } finally {
      if (id === requestId.current) setLoading(false)
    }
  }, [
    debouncedSearch,
    statusFilter,
    clientFilter,
    phaseFilter,
    dateFrom,
    dateTo,
    yearFilter,
    page,
    pageSize,
    currentYear,
  ])

  useEffect(() => {
    void load()
  }, [load])

  /** Registered clients — fetched once (filter select + editor picker). */
  const loadClients = useCallback(async () => {
    if (clientsLoaded.current) return
    clientsLoaded.current = true
    try {
      const res = await api.get<Paginated<ClientRow>>('/api/clients?pageSize=100')
      setClients(res.data)
    } catch {
      // pickers stay empty — free-text fallback still works
    }
  }, [])

  useEffect(() => {
    void loadClients()
  }, [loadClients])

  /** Issued (non-draft) invoices — original-invoice picker for credit/debit notes. */
  const loadIssuedInvoices = useCallback(async () => {
    if (issuedLoaded.current) return
    issuedLoaded.current = true
    try {
      const res = await api.get<EInvoicesResponse>('/api/e-invoices?pageSize=100')
      setIssuedInvoices(res.rows.filter((r) => r.status !== 'draft'))
    } catch {
      // picker stays empty — notes can still be created from row actions
    }
  }, [])

  /** E-Invoice print config — cached after the first read (parent of the print dialog). */
  const loadConfig = useCallback(async () => {
    if (configLoaded.current) return
    configLoaded.current = true
    try {
      const res = await api.get<EInvoiceConfig>('/api/e-invoice-config')
      configRef.current = res
      setEiConfig(res)
    } catch {
      // fall back to defaults inside the print component
    }
  }, [])

  const yearOptions = useMemo(() => {
    const set = new Set<number>(years)
    set.add(currentYear)
    return Array.from(set).sort((a, b) => b - a)
  }, [years, currentYear])

  const hasFilters =
    debouncedSearch !== '' ||
    statusFilter !== 'all' ||
    clientFilter !== 'all' ||
    dateFrom !== '' ||
    dateTo !== '' ||
    yearFilter !== 'all'

  function resetFilters() {
    setSearch('')
    setStatusFilter('all')
    setClientFilter('all')
    setDateFrom('')
    setDateTo('')
    setYearFilter('all')
    setPage(1)
  }

  /** Predict the number a NEW document will receive (server generator). */
  const fetchNextNumber = useCallback(async (docType: string): Promise<string> => {
    const cached = nextNumberCache.current.get(docType)
    if (cached) return cached
    try {
      const res = await api.get<{ nextNumber: string }>(`/api/e-invoices/next-number?docType=${docType}`)
      nextNumberCache.current.set(docType, res.nextNumber)
      return res.nextNumber
    } catch {
      return ''
    }
  }, [])

  // Live number hint — refresh when the dialog opens or the doc type changes
  useEffect(() => {
    if (!dialogOpen || editing) return
    let cancelled = false
    void fetchNextNumber(form.docType).then((n) => {
      if (cancelled || !n) return
      setNextNumber(n)
      setDraftPreview((d) => (d && d.id === 'draft' ? { ...d, invoiceNumber: n } : d))
    })
    return () => {
      cancelled = true
    }
  }, [dialogOpen, editing, form.docType, fetchNextNumber])

  // -----------------------------------------------------------------------
  // Add / Edit dialog
  // -----------------------------------------------------------------------
  function openAdd() {
    setEditing(null)
    setTranslateError(null)
    setNextNumber('')
    setForm(emptyForm(configRef.current?.showReceiverSignature ?? true))
    setDialogOpen(true)
    void loadClients()
    void loadIssuedInvoices()
    void loadConfig()
  }

  // Deep-open the create dialog when arriving via the command palette
  const shouldOpenCreate = useViewIntent('e-invoices', 'create')
  useEffect(() => {
    if (shouldOpenCreate) void openAdd()
  }, [shouldOpenCreate])

  async function openEdit(row: EInvoiceRow) {
    try {
      // list rows carry no items — fetch the full document for the editor
      const full = await api.get<EInvoiceRow>(`/api/e-invoices/${row.id}`)
      setEditing(full)
      const manual: Record<ArHeaderKey, boolean> = {
        clientName: false,
        clientAddress: false,
        project: false,
        paymentTerms: false,
        paymentMethod: false,
        notes: false,
      }
      for (const k of full.arManualFlags ?? []) {
        if (k in manual) manual[k as ArHeaderKey] = true
      }
      setForm({
        docType: (['invoice', 'credit_note', 'debit_note'] as const).includes(
          full.docType as EIForm['docType']
        )
          ? (full.docType as EIForm['docType'])
          : 'invoice',
        zatcaPhase: full.zatcaPhase === 2 ? 2 : 1,
        relatedInvoiceId: full.relatedInvoiceId ?? '',
        clientId: full.clientId ?? '',
        clientNameEn: full.clientNameEn,
        clientNameAr: full.clientNameAr ?? '',
        clientVatNumber: full.clientVatNumber ?? '',
        clientCrNumber: full.clientCrNumber ?? '',
        clientAddressEn: full.clientAddressEn ?? '',
        clientAddressAr: full.clientAddressAr ?? '',
        poRef: full.poRef ?? '',
        contractRef: full.contractRef ?? '',
        projectEn: full.projectEn ?? '',
        projectAr: full.projectAr ?? '',
        paymentTermsEn: full.paymentTermsEn ?? '',
        paymentTermsAr: full.paymentTermsAr ?? '',
        paymentMethodEn: full.paymentMethodEn ?? '',
        paymentMethodAr: full.paymentMethodAr ?? '',
        issueDate: toDateInputValue(full.issueDate),
        supplyDate: full.supplyDate ? toDateInputValue(full.supplyDate) : '',
        dueDate: full.dueDate ? toDateInputValue(full.dueDate) : '',
        notesEn: full.notesEn ?? '',
        notesAr: full.notesAr ?? '',
        showReceiverSignature: full.showReceiverSignature,
        items: (full.items ?? []).map((it) => {
          itemKeySeq += 1
          return {
            key: `item-${itemKeySeq}`,
            descriptionEn: it.descriptionEn,
            descriptionAr: it.descriptionAr ?? '',
            descArManual: it.descArManual,
            unitEn: it.unitEn ?? '',
            unitAr: it.unitAr ?? '',
            unitArManual: it.unitArManual,
            quantity: String(it.quantity),
            unitPrice: String(it.unitPrice),
            discount: it.discount ? String(it.discount) : '',
            vatPercent: String(Math.round(it.vatPercent)),
          }
        }),
        arManual: manual,
      })
      setTranslateError(null)
      setDialogOpen(true)
      void loadClients()
      void loadIssuedInvoices()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not open the e-invoice')
    }
  }

  function setField<K extends keyof EIForm>(key: K, value: EIForm[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function setItemField(key: string, patch: Partial<EItemForm>) {
    setForm((f) => ({
      ...f,
      items: f.items.map((it) => (it.key === key ? { ...it, ...patch } : it)),
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

  /** Selecting a registered client fills EN + AR identity fields (not manual). */
  function handleClientSelect(v: string) {
    if (v === 'none') {
      setField('clientId', '')
      return
    }
    const c = clients.find((x) => x.id === v)
    if (!c) return
    setForm((f) => ({
      ...f,
      clientId: v,
      clientNameEn: c.name,
      clientNameAr: c.nameAr ?? '',
      clientVatNumber: c.vatNumber ?? '',
      clientCrNumber: c.crNumber ?? '',
      clientAddressEn: c.address ?? '',
      clientAddressAr: c.addressAr ?? '',
      // values now come from the client record — no longer "manually typed"
      arManual: { ...f.arManual, clientName: false, clientAddress: false },
    }))
  }

  /** Quick-add a client from inside the e-invoice form — saved to Clients. */
  async function handleQuickAddClient() {
    const name = clientForm.name.trim()
    if (!name) {
      toast.error('Client name (English) is required')
      return
    }
    if (clientAddSaving) return
    setClientAddSaving(true)
    try {
      const created = await api.post<ClientRow>('/api/clients', {
        name,
        nameAr: clientForm.nameAr.trim() || null,
        contactPerson: clientForm.contactPerson.trim() || null,
        phone: clientForm.phone.trim() || null,
        email: clientForm.email.trim() || null,
        city: clientForm.city.trim() || null,
        address: clientForm.address.trim() || null,
        vatNumber: clientForm.vatNumber.trim() || null,
        crNumber: clientForm.crNumber.trim() || null,
      })
      toast.success(`Client "${created.name}" saved`)
      setClientAddOpen(false)
      // refresh the picker, then auto-select + fill from the new record
      try {
        const res = await api.get<Paginated<ClientRow>>('/api/clients?pageSize=100')
        setClients(res.data)
      } catch {
        // non-fatal — the picker refreshes next time it opens
      }
      setForm((f) => ({
        ...f,
        clientId: created.id,
        clientNameEn: created.name,
        clientNameAr: created.nameAr ?? '',
        clientVatNumber: created.vatNumber ?? '',
        clientCrNumber: created.crNumber ?? '',
        clientAddressEn: created.address ?? '',
        clientAddressAr: created.addressAr ?? '',
        arManual: { ...f.arManual, clientName: false, clientAddress: false },
      }))
      setClientForm({
        name: '',
        nameAr: '',
        contactPerson: '',
        phone: '',
        email: '',
        city: '',
        address: '',
        vatNumber: '',
        crNumber: '',
      })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save the client')
    } finally {
      setClientAddSaving(false)
    }
  }

  // -----------------------------------------------------------------------
  // Translation
  // -----------------------------------------------------------------------
  /**
   * POST /api/e-invoices/translate and apply the results. `force` overrides
   * the manual-Arabic protection (used after the user confirms an overwrite).
   * Returns how many fields were actually filled + the provider error, if any.
   */
  async function runTranslation(
    entries: TranslateEntry[],
    force = false
  ): Promise<{ applied: number; providerError: string | null }> {
    if (entries.length === 0) return { applied: 0, providerError: null }
    setTranslatingKeys((s) => {
      const n = new Set(s)
      entries.forEach((e) => n.add(e.key))
      return n
    })
    try {
      const res = await api.post<TranslateResponse>('/api/e-invoices/translate', { entries })
      const byKey = new Map(res.results.map((r) => [r.key, r]))

      // count against the form snapshot (toast only — the updater stays pure)
      let applied = 0
      for (const e of entries) {
        const r = byKey.get(e.key)
        if (!r || !r.translated.trim()) continue
        if (e.key.startsWith('h:')) {
          const hk = e.key.slice(2) as ArHeaderKey
          if (force || !form.arManual[hk]) applied += 1
        } else {
          const [, itemKey, fieldKind] = e.key.split(':')
          const it = form.items.find((x) => x.key === itemKey)
          if (!it) continue
          if (fieldKind === 'desc' && (force || !it.descArManual)) applied += 1
          if (fieldKind === 'unit' && (force || !it.unitArManual)) applied += 1
        }
      }

      setForm((f) => {
        let changed = false
        const next: EIForm = { ...f, arManual: { ...f.arManual } }
        for (const e of entries) {
          const r = byKey.get(e.key)
          if (!r || !r.translated.trim()) continue
          if (e.key.startsWith('h:')) {
            const hk = e.key.slice(2) as ArHeaderKey
            const field = HEADER_AR_FIELDS.find((x) => x.key === hk)
            if (!field || (!force && next.arManual[hk])) continue
            ;(next[field.arKey] as string) = r.translated
            changed = true
          } else {
            const [, itemKey, fieldKind] = e.key.split(':')
            next.items = next.items.map((it) => {
              if (it.key !== itemKey) return it
              if (fieldKind === 'desc' && (force || !it.descArManual)) {
                changed = true
                return { ...it, descriptionAr: r.translated }
              }
              if (fieldKind === 'unit' && (force || !it.unitArManual)) {
                changed = true
                return { ...it, unitAr: r.translated }
              }
              return it
            })
          }
        }
        return changed ? next : f
      })

      if (res.providerError) {
        setTranslateError(res.providerError)
      } else {
        setTranslateError(null)
      }
      return { applied, providerError: res.providerError ?? null }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Translation failed')
      return { applied: 0, providerError: null }
    } finally {
      setTranslatingKeys((s) => {
        const n = new Set(s)
        entries.forEach((e) => n.delete(e.key))
        return n
      })
    }
  }

  /** Translate one header pair (button). Manual Arabic asks for confirmation. */
  async function translateHeaderField(hk: ArHeaderKey) {
    const field = HEADER_AR_FIELDS.find((f) => f.key === hk)
    if (!field) return
    const text = (form[field.enKey] as string).trim()
    if (!text) return
    if (form.arManual[hk] && (form[field.arKey] as string).trim()) {
      setTranslateConfirm({ key: `h:${hk}`, text, context: field.context })
      return
    }
    const r = await runTranslation([{ key: `h:${hk}`, text, context: field.context }])
    if (r.applied > 0) toast.success('Arabic translation applied')
    else if (!r.providerError) toast.info('No translation available — type the Arabic manually')
  }

  /** EN blur → auto-translate when the Arabic is empty or not manual. */
  function handleHeaderEnBlur(hk: ArHeaderKey) {
    const field = HEADER_AR_FIELDS.find((f) => f.key === hk)
    if (!field) return
    const text = (form[field.enKey] as string).trim()
    if (!text) return
    const ar = (form[field.arKey] as string).trim()
    if (!ar || !form.arManual[hk]) {
      void runTranslation([{ key: `h:${hk}`, text, context: field.context }])
    }
  }

  /** Translate one item field (button). Manual Arabic asks for confirmation. */
  async function translateItemField(itemKey: string, fieldKind: 'desc' | 'unit') {
    const it = form.items.find((x) => x.key === itemKey)
    if (!it) return
    const text = (fieldKind === 'desc' ? it.descriptionEn : it.unitEn).trim()
    if (!text) return
    const ar = (fieldKind === 'desc' ? it.descriptionAr : it.unitAr).trim()
    const isManual = fieldKind === 'desc' ? it.descArManual : it.unitArManual
    if (isManual && ar) {
      setTranslateConfirm({
        key: `i:${itemKey}:${fieldKind}`,
        text,
        context: fieldKind === 'desc' ? 'description' : 'unit',
      })
      return
    }
    const r = await runTranslation([
      { key: `i:${itemKey}:${fieldKind}`, text, context: fieldKind === 'desc' ? 'description' : 'unit' },
    ])
    if (r.applied > 0) toast.success('Arabic translation applied')
    else if (!r.providerError) toast.info('No translation available — type the Arabic manually')
  }

  /** EN blur on an item field → auto-translate when Arabic is empty or not manual. */
  function handleItemEnBlur(itemKey: string, fieldKind: 'desc' | 'unit') {
    const it = form.items.find((x) => x.key === itemKey)
    if (!it) return
    const text = (fieldKind === 'desc' ? it.descriptionEn : it.unitEn).trim()
    if (!text) return
    const ar = (fieldKind === 'desc' ? it.descriptionAr : it.unitAr).trim()
    const isManual = fieldKind === 'desc' ? it.descArManual : it.unitArManual
    if (!ar || !isManual) {
      void runTranslation([
        { key: `i:${itemKey}:${fieldKind}`, text, context: fieldKind === 'desc' ? 'description' : 'unit' },
      ])
    }
  }

  /** Translate every field whose Arabic is empty or not manually typed (one batch). */
  async function handleTranslateAll() {
    if (translateAllBusy) return
    const entries: TranslateEntry[] = []
    for (const f of HEADER_AR_FIELDS) {
      const en = (form[f.enKey] as string).trim()
      const ar = (form[f.arKey] as string).trim()
      if (en && (!ar || !form.arManual[f.key])) {
        entries.push({ key: `h:${f.key}`, text: en, context: f.context })
      }
    }
    for (const it of form.items) {
      if (it.descriptionEn.trim() && (!it.descriptionAr.trim() || !it.descArManual)) {
        entries.push({ key: `i:${it.key}:desc`, text: it.descriptionEn.trim(), context: 'description' })
      }
      if (it.unitEn.trim() && (!it.unitAr.trim() || !it.unitArManual)) {
        entries.push({ key: `i:${it.key}:unit`, text: it.unitEn.trim(), context: 'unit' })
      }
    }
    if (entries.length === 0) {
      toast.info('Nothing to translate — Arabic fields are already filled or English is empty')
      return
    }
    const capped = entries.slice(0, 60)
    setTranslateAllBusy(true)
    try {
      const r = await runTranslation(capped)
      if (r.applied > 0) {
        toast.success(`${r.applied} field${r.applied === 1 ? '' : 's'} translated`)
      } else if (!r.providerError) {
        toast.info('No new translations were applied')
      }
    } finally {
      setTranslateAllBusy(false)
    }
  }

  /** Confirmed overwrite of manually typed Arabic. */
  async function handleConfirmTranslate() {
    const t = translateConfirm
    if (!t) return
    setTranslateConfirm(null)
    const r = await runTranslation([t], true)
    if (r.applied > 0) toast.success('Arabic translation replaced')
    else if (!r.providerError) toast.info('No translation available — type the Arabic manually')
  }

  // -----------------------------------------------------------------------
  // LIVE totals preview — mirrors the server-side computation exactly
  // (per-line discount → taxable → per-line VAT → roll-up)
  // -----------------------------------------------------------------------
  const calc = useMemo(() => {
    const items = form.items.map((it) => {
      const quantity = Math.max(0, parseNum(it.quantity) ?? 0)
      const unitPrice = Math.max(0, parseNum(it.unitPrice) ?? 0)
      const discount = Math.min(Math.max(0, parseNum(it.discount) ?? 0), round2(quantity * unitPrice))
      const vatPercent = parseNum(it.vatPercent) ?? 15
      const taxable = round2(quantity * unitPrice - discount)
      const vat = round2((taxable * vatPercent) / 100)
      return { gross: round2(quantity * unitPrice), discount, taxable, vat, lineTotal: round2(taxable + vat) }
    })
    const subtotal = round2(items.reduce((s, it) => s + it.gross, 0))
    const totalDiscount = round2(items.reduce((s, it) => s + it.discount, 0))
    const taxableAmount = round2(items.reduce((s, it) => s + it.taxable, 0))
    const vatAmount = round2(items.reduce((s, it) => s + it.vat, 0))
    return { items, subtotal, totalDiscount, taxableAmount, vatAmount, totalDue: round2(taxableAmount + vatAmount) }
  }, [form])

  const words = amountInWordsBoth(calc.totalDue, currency)

  // -----------------------------------------------------------------------
  // Save / delete / issue / duplicate / notes
  // -----------------------------------------------------------------------
  async function handleSubmit() {
    const clientNameEn = form.clientNameEn.trim()
    if (!clientNameEn) {
      toast.error('Client name (English) is required')
      return
    }
    if (!form.issueDate) {
      toast.error('Issue date is required')
      return
    }
    if (form.docType !== 'invoice' && !form.relatedInvoiceId) {
      toast.error('Select the original issued invoice this note corrects')
      return
    }
    if (form.items.length === 0 || form.items.some((it) => !it.descriptionEn.trim())) {
      toast.error('Every line item needs an English description')
      return
    }
    if (form.items.some((it) => (parseNum(it.quantity) ?? 0) <= 0)) {
      toast.error('Every line item needs a quantity greater than 0')
      return
    }
    if (form.items.some((it) => (parseNum(it.unitPrice) ?? 0) < 0)) {
      toast.error('Unit prices cannot be negative')
      return
    }
    if (
      form.items.some((it) => (parseNum(it.discount) ?? 0) > round2((parseNum(it.quantity) ?? 0) * (parseNum(it.unitPrice) ?? 0)))
    ) {
      toast.error('A line discount cannot be greater than the line amount')
      return
    }

    const body = {
      docType: form.docType,
      zatcaPhase: form.zatcaPhase,
      clientId: form.clientId || null,
      clientNameEn,
      clientNameAr: form.clientNameAr.trim(),
      clientVatNumber: form.clientVatNumber.trim() || null,
      clientCrNumber: form.clientCrNumber.trim() || null,
      clientAddressEn: form.clientAddressEn.trim() || null,
      clientAddressAr: form.clientAddressAr.trim() || null,
      poRef: form.poRef.trim() || null,
      contractRef: form.contractRef.trim() || null,
      projectEn: form.projectEn.trim() || null,
      projectAr: form.projectAr.trim() || null,
      paymentTermsEn: form.paymentTermsEn.trim() || null,
      paymentTermsAr: form.paymentTermsAr.trim() || null,
      paymentMethodEn: form.paymentMethodEn.trim() || null,
      paymentMethodAr: form.paymentMethodAr.trim() || null,
      issueDate: form.issueDate,
      supplyDate: form.supplyDate || null,
      dueDate: form.dueDate || null,
      notesEn: form.notesEn.trim() || null,
      notesAr: form.notesAr.trim() || null,
      showReceiverSignature: form.showReceiverSignature,
      arManualFlags: HEADER_AR_FIELDS.filter((f) => form.arManual[f.key]).map((f) => f.key),
      relatedInvoiceId: form.docType !== 'invoice' ? form.relatedInvoiceId || null : null,
      items: form.items.map((it) => ({
        descriptionEn: it.descriptionEn.trim(),
        descriptionAr: it.descriptionAr.trim(),
        descArManual: it.descArManual,
        unitEn: it.unitEn.trim() || null,
        unitAr: it.unitAr.trim() || null,
        unitArManual: it.unitArManual,
        quantity: Math.max(0, parseNum(it.quantity) ?? 0),
        unitPrice: Math.max(0, parseNum(it.unitPrice) ?? 0),
        discount: round2(Math.max(0, parseNum(it.discount) ?? 0)),
        vatPercent: parseNum(it.vatPercent) ?? 15,
      })),
    }

    setSaving(true)
    try {
      if (editing) {
        const updated = await api.put<EInvoiceRow>(`/api/e-invoices/${editing.id}`, body)
        toast.success(`E-Invoice ${updated.invoiceNumber} updated`)
      } else {
        const created = await api.post<EInvoiceRow>('/api/e-invoices', body)
        toast.success(`Draft ${created.invoiceNumber} created — issue it when ready`)
      }
      setDialogOpen(false)
      nextNumberCache.current.clear() // predictions are stale after a create
      void load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save the e-invoice')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(row: EInvoiceRow) {
    try {
      await api.del(`/api/e-invoices/${row.id}`)
      toast.success(`E-Invoice ${row.invoiceNumber} deleted`)
      void load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not delete the e-invoice')
    }
  }

  async function handleIssue() {
    const target = issueTarget
    if (!target || issuing) return
    setIssuing(true)
    try {
      const issued = await api.post<EInvoiceRow>(`/api/e-invoices/${target.id}/issue`, {})
      toast.success(
        `${issued.invoiceNumber} issued — locked with the ZATCA hash chain and QR code`
      )
      setIssueTarget(null)
      nextNumberCache.current.clear()
      void load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not issue the e-invoice')
    } finally {
      setIssuing(false)
    }
  }

  async function handleDuplicate(row: EInvoiceRow) {
    try {
      const dup = await api.post<EInvoiceRow>(`/api/e-invoices/${row.id}/duplicate`, {})
      nextNumberCache.current.clear()
      toast.success(`Duplicated as ${dup.invoiceNumber} (draft) — open it to adjust details`)
      void load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not duplicate the e-invoice')
    }
  }

  /** Create a credit/debit note draft referencing this issued invoice, then open it in the editor. */
  async function handleCreateNote(row: EInvoiceRow, docType: 'credit_note' | 'debit_note') {
    if (noteBusy) return
    setNoteBusy(true)
    try {
      const full = await api.get<EInvoiceRow>(`/api/e-invoices/${row.id}`)
      const created = await api.post<EInvoiceRow>('/api/e-invoices', {
        docType,
        relatedInvoiceId: full.id,
        clientId: full.clientId,
        clientNameEn: full.clientNameEn,
        clientNameAr: full.clientNameAr,
        clientVatNumber: full.clientVatNumber,
        clientCrNumber: full.clientCrNumber,
        clientAddressEn: full.clientAddressEn,
        clientAddressAr: full.clientAddressAr,
        issueDate: toDateInputValue(new Date()),
        items: [
          {
            descriptionEn: `Adjustment against ${full.invoiceNumber}`,
            quantity: 1,
            unitPrice: 0,
            vatPercent: 15,
          },
        ],
      })
      nextNumberCache.current.clear()
      issuedLoaded.current = false // the picker should see fresh rows
      toast.success(
        `${docType === 'credit_note' ? 'Credit Note' : 'Debit Note'} ${created.invoiceNumber} created as a draft — adjust the amounts, then issue it`
      )
      void load()
      await openEdit(created)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not create the note')
    } finally {
      setNoteBusy(false)
    }
  }

  // -----------------------------------------------------------------------
  // Payments
  // -----------------------------------------------------------------------
  async function openPayments(row: EInvoiceRow) {
    try {
      const full = await api.get<EInvoiceRow>(`/api/e-invoices/${row.id}`)
      setPayInvoice(full)
      setPayForm({
        amount: '',
        paymentDate: toDateInputValue(new Date()),
        methodEn: '',
        methodAr: '',
        reference: '',
        notes: '',
      })
      setPayOpen(true)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load the invoice')
    }
  }

  async function handleAddPayment() {
    const inv = payInvoice
    if (!inv || paySaving) return
    const amount = parseNum(payForm.amount)
    if (amount === null || amount <= 0) {
      toast.error('Enter a payment amount greater than 0')
      return
    }
    if (!payForm.paymentDate) {
      toast.error('Payment date is required')
      return
    }
    setPaySaving(true)
    try {
      const res = await api.post<{ row: EInvoiceRow; paidAmount: number; status: string }>(
        `/api/e-invoices/${inv.id}/payments`,
        {
          amount,
          paymentDate: payForm.paymentDate,
          methodEn: payForm.methodEn.trim() || null,
          methodAr: payForm.methodAr.trim() || null,
          reference: payForm.reference.trim() || null,
          notes: payForm.notes.trim() || null,
        }
      )
      setPayInvoice(res.row)
      setPayForm((f) => ({ ...f, amount: '', reference: '' }))
      toast.success(
        `Payment of ${money(round2(amount))} recorded — ${res.row.invoiceNumber} is now ${
          res.row.status === 'paid'
            ? 'fully paid'
            : res.row.status === 'partially_paid'
              ? 'partially paid'
              : res.row.status
        }`
      )
      void load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not record the payment')
    } finally {
      setPaySaving(false)
    }
  }

  async function handleDeletePayment(paymentId: string) {
    const inv = payInvoice
    if (!inv) return
    try {
      const res = await api.del<{ row: EInvoiceRow }>(
        `/api/e-invoices/${inv.id}/payments/${paymentId}`
      )
      setPayInvoice(res.row)
      toast.success('Payment removed')
      void load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not delete the payment')
    }
  }

  // -----------------------------------------------------------------------
  // Signed copy (proof of delivery — allowed on issued/locked invoices)
  // -----------------------------------------------------------------------
  function promptSignedCopy(row: EInvoiceRow) {
    signedTargetRef.current = row
    signedInputRef.current?.click()
  }

  async function handleSignedFileSelected(file: File | undefined) {
    const row = signedTargetRef.current
    if (!file || !row) return
    if (!/^image\/(png|jpe?g)$/.test(file.type)) {
      toast.error('Only PNG or JPEG images are allowed')
      if (signedInputRef.current) signedInputRef.current.value = ''
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error('Image is too large — maximum 2 MB')
      if (signedInputRef.current) signedInputRef.current.value = ''
      return
    }
    setSignedBusy(true)
    try {
      const dataUrl = await fileToDataUrl(file)
      const res = await api.put<{ signedCopyImage: string }>(
        `/api/e-invoices/${row.id}/signed-copy`,
        { image: dataUrl }
      )
      signedTargetRef.current = null
      setRows((rs) =>
        rs.map((r) => (r.id === row.id ? { ...r, signedCopyImage: res.signedCopyImage } : r))
      )
      toast.success(`Signed copy attached to ${row.invoiceNumber}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not upload the signed copy')
    } finally {
      setSignedBusy(false)
      if (signedInputRef.current) signedInputRef.current.value = ''
    }
  }

  async function handleRemoveSignedCopy(row: EInvoiceRow) {
    try {
      await api.del(`/api/e-invoices/${row.id}/signed-copy`)
      setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, signedCopyImage: null } : r)))
      toast.success(`Signed copy removed from ${row.invoiceNumber}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not remove the signed copy')
    }
  }

  // -----------------------------------------------------------------------
  // Print / preview
  // -----------------------------------------------------------------------
  /** Build a draft EInvoiceRow from the unsaved form for the live preview. */
  function buildDraftRow(): EInvoiceRow {
    const year = form.issueDate
      ? new Date(`${form.issueDate}T00:00:00`).getFullYear()
      : new Date().getFullYear()
    const prefix =
      form.docType === 'credit_note' ? 'CRN' : form.docType === 'debit_note' ? 'DBN' : 'INV'
    const related = form.relatedInvoiceId
      ? issuedInvoices.find((x) => x.id === form.relatedInvoiceId)
      : null
    const toDate = (v: string) => (v ? new Date(`${v}T00:00:00`).toISOString() : null)
    return {
      id: 'draft',
      invoiceNumber: editing?.invoiceNumber ?? nextNumber ?? `${prefix}-${year}-00001`,
      docType: form.docType,
      zatcaPhase: form.zatcaPhase,
      zatcaStatus: null,
      zatcaSubmittedAt: null,
      zatcaSubmissionMode: null,
      clientId: form.clientId || null,
      clientNameEn: form.clientNameEn.trim() || 'Client name',
      clientNameAr: form.clientNameAr.trim(),
      clientVatNumber: form.clientVatNumber.trim() || null,
      clientCrNumber: form.clientCrNumber.trim() || null,
      clientAddressEn: form.clientAddressEn.trim() || null,
      clientAddressAr: form.clientAddressAr.trim() || null,
      poRef: form.poRef.trim() || null,
      contractRef: form.contractRef.trim() || null,
      projectEn: form.projectEn.trim() || null,
      projectAr: form.projectAr.trim() || null,
      paymentTermsEn: form.paymentTermsEn.trim() || null,
      paymentTermsAr: form.paymentTermsAr.trim() || null,
      paymentMethodEn: form.paymentMethodEn.trim() || null,
      paymentMethodAr: form.paymentMethodAr.trim() || null,
      issueDate: toDate(form.issueDate) ?? new Date().toISOString(),
      supplyDate: toDate(form.supplyDate),
      dueDate: toDate(form.dueDate),
      status: 'draft',
      subtotal: calc.subtotal,
      totalDiscount: calc.totalDiscount,
      taxableAmount: calc.taxableAmount,
      vatAmount: calc.vatAmount,
      totalDue: calc.totalDue,
      paidAmount: 0,
      notesEn: form.notesEn.trim() || null,
      notesAr: form.notesAr.trim() || null,
      arManualFlags: HEADER_AR_FIELDS.filter((f) => form.arManual[f.key]).map((f) => f.key),
      showReceiverSignature: form.showReceiverSignature,
      relatedInvoiceId: form.docType !== 'invoice' ? form.relatedInvoiceId || null : null,
      uuid: null,
      icv: null,
      invoiceHash: null,
      previousHash: null,
      issuedAt: null,
      issuedByName: null,
      signedCopyImage: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      overdue: false,
      itemCount: form.items.length,
      items: form.items.map((it, i) => ({
        id: `draft-${it.key}`,
        sr: i + 1,
        descriptionEn: it.descriptionEn.trim() || '—',
        descriptionAr: it.descriptionAr.trim(),
        descArManual: it.descArManual,
        unitEn: it.unitEn.trim() || null,
        unitAr: it.unitAr.trim() || null,
        unitArManual: it.unitArManual,
        quantity: Math.max(0, parseNum(it.quantity) ?? 0),
        unitPrice: Math.max(0, parseNum(it.unitPrice) ?? 0),
        discount: round2(Math.max(0, parseNum(it.discount) ?? 0)),
        vatPercent: parseNum(it.vatPercent) ?? 15,
        taxableAmount: calc.items[i]?.taxable ?? 0,
        vatAmount: calc.items[i]?.vat ?? 0,
        lineTotal: calc.items[i]?.lineTotal ?? 0,
      })),
      payments: [],
      relatedInvoiceNumber: related?.invoiceNumber ?? null,
    }
  }

  /** Live preview of the UNSAVED form — rendered by the same print component. */
  function openDraftPreview() {
    void loadConfig()
    setQrDataUrl(null) // QR available after save
    setPrintInvoice(null)
    setDraftPreview(buildDraftRow())
    setPrintOpen(true)
  }

  async function openPrint(row: EInvoiceRow) {
    if (printLoading) return
    setPrintLoading(true)
    try {
      void loadConfig()
      const [full, qr] = await Promise.all([
        api.get<EInvoiceRow>(`/api/e-invoices/${row.id}`),
        api.get<{ qrPayload: string; qrDataUrl: string }>(`/api/e-invoices/${row.id}/qr`),
      ])
      setDraftPreview(null)
      setQrDataUrl(qr.qrDataUrl)
      setPrintInvoice(full)
      setPrintOpen(true)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not prepare the e-invoice document')
    } finally {
      setPrintLoading(false)
    }
  }

  /** Open the Phase 2 "connect system" submission dialog. */
  function openZatcaSubmit(row: EInvoiceRow) {
    setZatcaTarget(row)
    setZatcaOpen(true)
  }

  async function handleDownloadUbl(row: EInvoiceRow) {
    try {
      await downloadEInvoiceUbl(row.id, row.invoiceNumber)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Download failed')
    }
  }

  // -----------------------------------------------------------------------
  // Render helpers
  // -----------------------------------------------------------------------
  /** Desktop + mobile action cluster for one row (permission + status aware). */
  const renderRowActions = (row: EInvoiceRow, mobile: boolean) => {
    const isDraft = row.status === 'draft'
    const isP2 = (row.zatcaPhase ?? 1) === 2
    const canPay = (row.status === 'issued' || row.status === 'partially_paid') && canEdit
    const canSubmitZatca = !isDraft && isP2 && canEdit
    const iconBtn =
      'h-8 w-8 text-muted-foreground hover:text-foreground'
    return (
      <div className={`flex items-center justify-end gap-0.5 ${mobile ? '' : ''}`}>
        <Button
          variant="ghost"
          size="icon"
          className={iconBtn}
          onClick={() => void openPrint(row)}
          disabled={printLoading}
          aria-label={`Preview ${row.invoiceNumber}`}
          title="Preview / print"
        >
          <Eye className="h-4 w-4" />
        </Button>
        {!mobile && isDraft && canEdit ? (
          <Button
            variant="ghost"
            size="icon"
            className={iconBtn}
            onClick={() => void openEdit(row)}
            aria-label={`Edit ${row.invoiceNumber}`}
            title="Edit draft"
          >
            <Pencil className="h-4 w-4" />
          </Button>
        ) : null}
        {!mobile && isDraft && canEdit ? (
          <Button
            variant="ghost"
            size="icon"
            className={cn(iconBtn, 'text-amber-600 hover:text-amber-700 dark:text-amber-400')}
            onClick={() => setIssueTarget(row)}
            aria-label={`Issue ${row.invoiceNumber}`}
            title="Issue invoice (locks it)"
          >
            <Send className="h-4 w-4" />
          </Button>
        ) : null}
        {!mobile && canPay ? (
          <Button
            variant="ghost"
            size="icon"
            className={iconBtn}
            onClick={() => void openPayments(row)}
            aria-label={`Record payment on ${row.invoiceNumber}`}
            title="Record payment"
          >
            <Wallet className="h-4 w-4" />
          </Button>
        ) : null}
        {!mobile && canSubmitZatca ? (
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              iconBtn,
              row.zatcaStatus === 'cleared' || row.zatcaStatus === 'reported'
                ? 'text-emerald-600 hover:text-emerald-700 dark:text-emerald-400'
                : 'text-amber-600 hover:text-amber-700 dark:text-amber-400'
            )}
            onClick={() => openZatcaSubmit(row)}
            aria-label={`Submit ${row.invoiceNumber} to ZATCA`}
            title={
              row.zatcaStatus
                ? `ZATCA: ${row.zatcaStatus} — open submission details`
                : 'Submit to ZATCA (Phase 2 connect system)'
            }
          >
            <CloudUpload className="h-4 w-4" />
          </Button>
        ) : null}
        {!mobile && !isDraft && canEdit ? (
          row.signedCopyImage ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(iconBtn, 'text-emerald-600 hover:text-emerald-700 dark:text-emerald-400')}
                  aria-label="Signed copy options"
                  title="Signed copy attached"
                >
                  <Paperclip className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() =>
                    setSignedPreview({ number: row.invoiceNumber, image: row.signedCopyImage ?? '' })
                  }
                >
                  <Eye className="mr-2 h-4 w-4" />
                  View signed copy
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => promptSignedCopy(row)}>
                  <Paperclip className="mr-2 h-4 w-4" />
                  Replace signed copy
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => void handleRemoveSignedCopy(row)}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Remove signed copy
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              className={iconBtn}
              onClick={() => promptSignedCopy(row)}
              disabled={signedBusy}
              aria-label={`Attach signed copy to ${row.invoiceNumber}`}
              title="Attach signed copy (proof of delivery)"
            >
              <Paperclip className="h-4 w-4" />
            </Button>
          )
        ) : null}
        {!mobile && canCreate ? (
          <Button
            variant="ghost"
            size="icon"
            className={iconBtn}
            onClick={() => void handleDuplicate(row)}
            aria-label={`Duplicate ${row.invoiceNumber}`}
            title="Duplicate as draft"
          >
            <Copy className="h-4 w-4" />
          </Button>
        ) : null}
        {!mobile && isDraft && canDelete ? (
          <ConfirmDelete
            onConfirm={() => void handleDelete(row)}
            title="Delete e-invoice?"
            description={`Draft ${row.invoiceNumber} (${row.clientNameEn}, ${money(
              row.totalDue
            )}) and all its line items will be permanently removed.`}
          />
        ) : null}
        {/* Overflow menu — keeps the row compact on mobile, holds notes + extras */}
        {(() => {
          const items: React.ReactNode[] = []
          if (mobile && isDraft && canEdit) {
            items.push(
              <DropdownMenuItem key="edit" onClick={() => void openEdit(row)}>
                <Pencil className="mr-2 h-4 w-4" />
                Edit draft
              </DropdownMenuItem>
            )
          }
          if (mobile && isDraft && canEdit) {
            items.push(
              <DropdownMenuItem key="issue" onClick={() => setIssueTarget(row)}>
                <Send className="mr-2 h-4 w-4" />
                Issue invoice
              </DropdownMenuItem>
            )
          }
          if (mobile && canPay) {
            items.push(
              <DropdownMenuItem key="pay" onClick={() => void openPayments(row)}>
                <Wallet className="mr-2 h-4 w-4" />
                Record payment
              </DropdownMenuItem>
            )
          }
          if (mobile && canSubmitZatca) {
            items.push(
              <DropdownMenuItem key="zatca" onClick={() => openZatcaSubmit(row)}>
                <CloudUpload className="mr-2 h-4 w-4" />
                {row.zatcaStatus ? `ZATCA: ${row.zatcaStatus}` : 'Submit to ZATCA'}
              </DropdownMenuItem>
            )
          }
          if (isP2 && !isDraft) {
            items.push(
              <DropdownMenuItem key="ubl" onClick={() => void handleDownloadUbl(row)}>
                <FileCode className="mr-2 h-4 w-4" />
                Download UBL XML
              </DropdownMenuItem>
            )
          }
          if (canCreate) {
            items.push(
              <DropdownMenuItem key="dup" onClick={() => void handleDuplicate(row)}>
                <Copy className="mr-2 h-4 w-4" />
                Duplicate as draft
              </DropdownMenuItem>
            )
          }
          if (mobile && !isDraft && canEdit) {
            items.push(
              <DropdownMenuItem key="signed" onClick={() => promptSignedCopy(row)}>
                <Paperclip className="mr-2 h-4 w-4" />
                {row.signedCopyImage ? 'Replace signed copy' : 'Attach signed copy'}
              </DropdownMenuItem>
            )
            if (row.signedCopyImage) {
              items.push(
                <DropdownMenuItem
                  key="signed-view"
                  onClick={() =>
                    setSignedPreview({ number: row.invoiceNumber, image: row.signedCopyImage ?? '' })
                  }
                >
                  <Eye className="mr-2 h-4 w-4" />
                  View signed copy
                </DropdownMenuItem>
              )
            }
          }
          if (!isDraft && canCreate) {
            items.push(
              <DropdownMenuSeparator key="sep-notes" />,
              <DropdownMenuItem key="crn" onClick={() => void handleCreateNote(row, 'credit_note')}>
                <ArrowDownLeft className="mr-2 h-4 w-4" />
                Credit Note — correct this invoice
              </DropdownMenuItem>,
              <DropdownMenuItem key="dbn" onClick={() => void handleCreateNote(row, 'debit_note')}>
                <ArrowUpRight className="mr-2 h-4 w-4" />
                Debit Note — add a charge
              </DropdownMenuItem>
            )
          }
          if (mobile && isDraft && canDelete) {
            items.push(
              <DropdownMenuSeparator key="sep-del" />,
              <DropdownMenuItem
                key="del"
                onClick={() => setDeleteTarget(row)}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete draft
              </DropdownMenuItem>
            )
          }
          if (items.length === 0) return null
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={iconBtn}
                  aria-label={`More actions for ${row.invoiceNumber}`}
                  title="More actions"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">{items}</DropdownMenuContent>
            </DropdownMenu>
          )
        })()}
      </div>
    )
  }

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------
  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      <PageHeader
        title="E-Invoice"
        description="Bilingual ZATCA tax invoices · فواتير ضريبية ثنائية اللغة"
      >
        {canCreate ? (
          <Button size="sm" onClick={openAdd}>
            <Plus className="h-4 w-4" />
            New E-Invoice
          </Button>
        ) : null}
      </PageHeader>

      {canCreate ? <MobileFab label="New E-Invoice" onClick={openAdd} icon={Plus} /> : null}

      {/* ---- KPI cards ---- */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Total Invoiced"
          value={formatNumber(totals.totalDue)}
          valuePrefix={currency}
          icon={FileOutput}
          tone="navy"
          sublabel={
            hasFilters
              ? 'Matching current filters'
              : `${totals.count} document${totals.count === 1 ? '' : 's'} on record`
          }
        />
        <StatCard
          title="Collected"
          value={formatNumber(totals.paid)}
          valuePrefix={currency}
          icon={Wallet}
          tone="green"
          sublabel="Payments received"
        />
        <StatCard
          title="Outstanding"
          value={formatNumber(totals.outstanding)}
          valuePrefix={currency}
          icon={CircleDollarSign}
          tone="gold"
          sublabel="Awaiting collection"
        />
        <StatCard
          title="Overdue"
          value={formatNumber(totals.overdueAmount)}
          valuePrefix={currency}
          icon={AlertTriangle}
          tone="red"
          sublabel={
            totals.overdueCount === 0
              ? 'Nothing overdue'
              : `${totals.overdueCount} overdue document${totals.overdueCount === 1 ? '' : 's'}`
          }
        />
      </div>

      {/* ---- E-Invoice list ---- */}
      <SectionCard className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div>
            <h2 className="text-base font-semibold">All E-Invoices</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {hasFilters ? 'Filtered — matches your search/filters' : 'All records'} — drafts,
              issued invoices, credit notes and debit notes
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold tabular-nums text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300 sm:text-sm">
              Invoiced: {money(totals.totalDue)}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold tabular-nums text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300 sm:text-sm">
              Collected: {money(totals.paid)}
            </span>
            <span className="inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium tabular-nums text-muted-foreground">
              {total} {total === 1 ? 'document' : 'documents'}
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
                placeholder="Search number, client, project, P.O.…"
                className="w-full sm:w-[240px]"
              />
            }
            activeCount={
              (statusFilter !== 'all' ? 1 : 0) +
              (clientFilter !== 'all' ? 1 : 0) +
              (phaseFilter !== 'all' ? 1 : 0) +
              (dateFrom !== '' ? 1 : 0) +
              (dateTo !== '' ? 1 : 0) +
              (yearFilter !== 'all' ? 1 : 0)
            }
          >
            <FilterSelect
              value={statusFilter}
              onChange={(v) => {
                setStatusFilter(v)
                setPage(1)
              }}
              options={STATUS_FILTER_OPTIONS}
              placeholder="All Statuses"
              className="sm:w-[150px]"
            />
            <FilterSelect
              value={clientFilter}
              onChange={(v) => {
                setClientFilter(v)
                setPage(1)
              }}
              options={clients.map((c) => ({ value: c.id, label: c.name }))}
              placeholder="All Clients"
              className="sm:w-[170px]"
            />
            <FilterSelect
              value={phaseFilter}
              onChange={(v) => {
                setPhaseFilter(v)
                setPage(1)
              }}
              options={[
                { value: '1', label: 'Phase 1 · Generation' },
                { value: '2', label: 'Phase 2 · Integration' },
              ]}
              placeholder="All ZATCA Phases"
              className="sm:w-[185px]"
            />
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value)
                setPage(1)
              }}
              aria-label="Issue date from"
              className="h-9 w-full sm:w-[145px]"
            />
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value)
                setPage(1)
              }}
              aria-label="Issue date to"
              className="h-9 w-full sm:w-[145px]"
            />
            <FilterSelect
              value={yearFilter}
              onChange={(v) => {
                setYearFilter(v)
                setPage(1)
              }}
              options={yearOptions.map((y) => ({ value: String(y), label: String(y) }))}
              placeholder="All Years"
              className="sm:w-[115px]"
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
          <TableSkeleton rows={6} cols={8} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={FileOutput}
            title="No e-invoices found"
            description={
              hasFilters
                ? 'Nothing matches your current filters. Try adjusting them.'
                : 'Create your first bilingual ZATCA tax invoice — draft it, then issue it when ready.'
            }
            action={
              canCreate ? (
                <Button size="sm" onClick={openAdd}>
                  <Plus className="h-4 w-4" />
                  New E-Invoice
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            {/* Desktop: full table */}
            <div className="nice-scrollbar hidden overflow-x-auto md:block">
              <Table className="min-w-[1100px]">
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead className="w-[170px]">Invoice</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead className="w-[105px]">Issue Date</TableHead>
                    <TableHead className="w-[105px]">Due Date</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="w-[150px]">Paid · Balance</TableHead>
                    <TableHead className="w-[115px]">Status</TableHead>
                    {canEdit || canDelete || canCreate ? (
                      <TableHead className="w-[210px] text-right">Actions</TableHead>
                    ) : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.id} className="group">
                      <TableCell>
                        <span className="inline-flex items-center gap-1.5 font-mono text-[13px] font-bold">
                          {row.invoiceNumber}
                        </span>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <DocTypeChip docType={row.docType} />
                          <PhaseChip phase={row.zatcaPhase} />
                          {row.relatedInvoiceNumber ? (
                            <span
                              className="text-[11px] text-muted-foreground"
                              title="References this original invoice"
                            >
                              vs {row.relatedInvoiceNumber}
                            </span>
                          ) : null}
                          {row.itemCount !== undefined ? (
                            <span className="text-[11px] text-muted-foreground">
                              · {row.itemCount} item{row.itemCount === 1 ? '' : 's'}
                            </span>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="min-w-0">
                          <p className="truncate font-medium">{row.clientNameEn}</p>
                          {row.clientNameAr ? (
                            <p
                              lang="ar"
                              dir="rtl"
                              className="max-w-[260px] truncate text-xs text-muted-foreground"
                              title={row.clientNameAr}
                            >
                              {row.clientNameAr}
                            </p>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums">
                        {formatDate(row.issueDate)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums">
                        {formatDate(row.dueDate)}
                        {row.overdue ? (
                          <span className="ml-1.5 rounded border border-rose-300 bg-rose-50 px-1 py-px text-[10px] font-bold uppercase tracking-wide text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-300">
                            Overdue
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {money(row.totalDue)}
                        <p className="text-xs font-normal tabular-nums text-muted-foreground">
                          incl. VAT {money(row.vatAmount)}
                        </p>
                      </TableCell>
                      <TableCell>
                        {row.status === 'draft' ? (
                          <span className="text-xs text-muted-foreground">Not issued yet</span>
                        ) : (
                          <div className="w-full max-w-[135px]">
                            <Progress
                              value={
                                row.totalDue > 0
                                  ? Math.min(100, (row.paidAmount / row.totalDue) * 100)
                                  : 0
                              }
                              className="h-1.5"
                              aria-label={`Paid ${Math.round(
                                (row.paidAmount / Math.max(row.totalDue, 0.01)) * 100
                              )}%`}
                            />
                            <p className="mt-1 text-[11px] tabular-nums text-muted-foreground">
                              Paid {money(row.paidAmount)} · Bal{' '}
                              {money(round2(row.totalDue - row.paidAmount))}
                            </p>
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <EIStatusBadge status={row.status} overdue={row.overdue} />
                        {row.zatcaStatus ? (
                          <div className="mt-1">
                            <ZatcaStatusBadge status={row.zatcaStatus} />
                          </div>
                        ) : null}
                      </TableCell>
                      {canEdit || canDelete || canCreate ? (
                        <TableCell className="text-right">{renderRowActions(row, false)}</TableCell>
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
                      <p className="font-mono text-[13px] font-bold">{row.invoiceNumber}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <DocTypeChip docType={row.docType} />
                        <PhaseChip phase={row.zatcaPhase} />
                        <EIStatusBadge status={row.status} overdue={row.overdue} />
                      </div>
                      <p className="mt-1.5 truncate text-xs font-medium">{row.clientNameEn}</p>
                      {row.clientNameAr ? (
                        <p lang="ar" dir="rtl" className="truncate text-xs text-muted-foreground">
                          {row.clientNameAr}
                        </p>
                      ) : null}
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Issued {formatDate(row.issueDate)}
                        {row.dueDate ? ` · due ${formatDate(row.dueDate)}` : ''}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-bold tabular-nums">{money(row.totalDue)}</p>
                      <p className="text-[11px] font-medium tabular-nums text-muted-foreground">
                        incl. VAT {money(row.vatAmount)}
                      </p>
                      {row.status !== 'draft' ? (
                        <p className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
                          Paid {money(row.paidAmount)} · Bal{' '}
                          {money(round2(row.totalDue - row.paidAmount))}
                        </p>
                      ) : null}
                      {row.signedCopyImage ? (
                        <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-px text-[10px] font-semibold text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
                          <Paperclip className="h-3 w-3" />
                          Signed copy
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="mt-2 flex items-center justify-between border-t pt-2">
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {row.itemCount ?? '—'} item{row.itemCount === 1 ? '' : 's'}
                    </span>
                    {renderRowActions(row, true)}
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
          unit="documents"
        />
      </SectionCard>

      {/* ---- Add / Edit dialog ---- */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="nice-scrollbar max-h-[90vh] gap-5 overflow-y-auto sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>
              {editing ? `Edit E-Invoice ${editing.invoiceNumber}` : 'New E-Invoice'}
            </DialogTitle>
            <DialogDescription>
              {editing
                ? 'Draft only — once issued the document is locked. Totals are recomputed on save.'
                : 'Fill in the client, dates and bilingual line items — the number is generated automatically. Arabic auto-translates; typed Arabic is never overwritten.'}
            </DialogDescription>
          </DialogHeader>

          {/* Translate-all toolbar + provider warning */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/30 px-3 py-2">
            <p className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
              <Languages className="h-4 w-4 shrink-0" />
              <span className="min-w-0">
                Arabic auto-translates when you leave an English field. Manually typed Arabic is
                marked and never overwritten.
              </span>
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 shrink-0"
              onClick={() => void handleTranslateAll()}
              disabled={translateAllBusy || saving}
            >
              {translateAllBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Languages className="h-4 w-4" />
              )}
              Translate All
            </Button>
          </div>
          {translateError ? (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">
              Auto-translation unavailable — type the Arabic manually. ({translateError})
            </div>
          ) : null}

          {/* 1 ─ Document */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Document</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="ei-doctype">Document Type</Label>
                <Select
                  value={form.docType}
                  onValueChange={(v) => setField('docType', v as EIForm['docType'])}
                  disabled={!!editing}
                >
                  <SelectTrigger id="ei-doctype" className="w-full" aria-label="Document type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DOC_TYPE_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  {DOC_TYPE_HINTS[form.docType] ||
                    'Standard B2B tax invoice with the ZATCA QR code.'}
                </p>
              </div>
              {form.docType !== 'invoice' ? (
                <div className="space-y-2">
                  <Label htmlFor="ei-related">
                    Original Invoice <span className="text-destructive">*</span>
                  </Label>
                  <Select
                    value={form.relatedInvoiceId || 'none'}
                    onValueChange={(v) => setField('relatedInvoiceId', v === 'none' ? '' : v)}
                  >
                    <SelectTrigger id="ei-related" className="w-full" aria-label="Original invoice">
                      <SelectValue placeholder="Select the issued invoice" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Not selected</SelectItem>
                      {issuedInvoices.map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          {r.invoiceNumber} — {r.clientNameEn}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground">
                    Only issued (non-draft) invoices can be corrected by a note.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label>Number</Label>
                  {editing ? (
                    <p className="font-mono text-sm font-semibold">{editing.invoiceNumber}</p>
                  ) : (
                    <>
                      <p className="font-mono text-sm font-semibold">
                        {nextNumber || '…'}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        Will be numbered{' '}
                        <span className="font-mono font-semibold">{nextNumber || 'INV-…'}</span>{' '}
                        when saved
                      </p>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* ZATCA phase — per-invoice designation (Phase 1 & 2 are separate) */}
            <div className="space-y-2">
              <Label>ZATCA Phase</Label>
              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  role="radio"
                  aria-checked={form.zatcaPhase === 1}
                  onClick={() => setField('zatcaPhase', 1)}
                  className={cn(
                    'rounded-lg border p-3 text-left transition-colors',
                    form.zatcaPhase === 1
                      ? 'border-[#132A4A] bg-[#132A4A]/[0.04] ring-1 ring-[#132A4A]/30 dark:border-[#E1B169]/50 dark:bg-[#0C1D33]/50 dark:ring-[#E1B169]/30'
                      : 'border-border hover:border-muted-foreground/40'
                  )}
                >
                  <div className="flex items-start gap-2.5">
                    <QrCode className="mt-0.5 h-4 w-4 shrink-0 text-[#132A4A] dark:text-[#E1B169]" />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">Phase 1 · Generation</p>
                      <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                        QR with the 5 mandatory TLV tags (seller, VAT no., timestamp,
                        total, VAT). No crypto, no portal submission.
                      </p>
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={form.zatcaPhase === 2}
                  onClick={() => setField('zatcaPhase', 2)}
                  className={cn(
                    'rounded-lg border p-3 text-left transition-colors',
                    form.zatcaPhase === 2
                      ? 'border-emerald-600 bg-emerald-50/60 ring-1 ring-emerald-600/30 dark:border-emerald-500/60 dark:bg-emerald-950/40 dark:ring-emerald-500/30'
                      : 'border-border hover:border-muted-foreground/40'
                  )}
                >
                  <div className="flex items-start gap-2.5">
                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">Phase 2 · Integration</p>
                      <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                        Full 8-tag cryptographic QR (hash + ECDSA signature + key) +
                        UBL XML. Submit to the ZATCA Fatoora portal after issuing.
                      </p>
                    </div>
                  </div>
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Choose per invoice — Phase 1 when the QR is enough, Phase 2 when it
                must be cleared on the Fatoora gateway. The phase locks when the
                document is issued.
              </p>
            </div>
          </section>

          {/* 2 ─ Client */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Client</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="ei-client">Registered Client</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1 px-2 text-xs text-[#8E6420] hover:text-[#8E6420] dark:text-[#E1B169] dark:hover:text-[#E1B169]"
                    onClick={() => setClientAddOpen(true)}
                  >
                    <UserPlus className="h-3.5 w-3.5" />
                    New Client
                  </Button>
                </div>
                <Select value={form.clientId || 'none'} onValueChange={handleClientSelect}>
                  <SelectTrigger id="ei-client" className="w-full" aria-label="Registered client">
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
                <p className="text-[11px] text-muted-foreground">
                  Selecting a client fills the name, VAT, CR and address fields — or add
                  a new one and it is saved to Clients.
                </p>
              </div>
              <ArField
                idPrefix="ei-name"
                label="Client Name"
                required
                en={form.clientNameEn}
                ar={form.clientNameAr}
                manual={form.arManual.clientName}
                busy={translatingKeys.has('h:clientName')}
                placeholderEn="Client / company name"
                placeholderAr="اسم العميل / الشركة"
                onEnChange={(v) => setForm((f) => ({ ...f, clientNameEn: v, clientId: '' }))}
                onArChange={(v) =>
                  setForm((f) => ({
                    ...f,
                    clientNameAr: v,
                    arManual: { ...f.arManual, clientName: true },
                  }))
                }
                onEnBlur={() => handleHeaderEnBlur('clientName')}
                onTranslate={() => void translateHeaderField('clientName')}
              />
              <div className="space-y-2">
                <Label htmlFor="ei-vat">VAT No.</Label>
                <Input
                  id="ei-vat"
                  value={form.clientVatNumber}
                  onChange={(e) => setField('clientVatNumber', e.target.value)}
                  placeholder="3XXXXXXXXXXXXX3"
                  className="font-mono"
                  inputMode="numeric"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ei-cr">C.R. No.</Label>
                <Input
                  id="ei-cr"
                  value={form.clientCrNumber}
                  onChange={(e) => setField('clientCrNumber', e.target.value)}
                  placeholder="e.g. 2050xxxxxxx"
                  className="font-mono"
                  inputMode="numeric"
                />
              </div>
              <div className="sm:col-span-2">
                <ArField
                  idPrefix="ei-address"
                  label="Address"
                  multiline
                  en={form.clientAddressEn}
                  ar={form.clientAddressAr}
                  manual={form.arManual.clientAddress}
                  busy={translatingKeys.has('h:clientAddress')}
                  placeholderEn="Street, city, country"
                  placeholderAr="الشارع، المدينة، الدولة"
                  onEnChange={(v) => setField('clientAddressEn', v)}
                  onArChange={(v) =>
                    setForm((f) => ({
                      ...f,
                      clientAddressAr: v,
                      arManual: { ...f.arManual, clientAddress: true },
                    }))
                  }
                  onEnBlur={() => handleHeaderEnBlur('clientAddress')}
                  onTranslate={() => void translateHeaderField('clientAddress')}
                />
              </div>
            </div>
          </section>

          {/* 3 ─ Dates & refs */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Dates &amp; References</h3>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="ei-issue">
                  Issue Date <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="ei-issue"
                  type="date"
                  value={form.issueDate}
                  onChange={(e) => setField('issueDate', e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ei-supply">Supply Date</Label>
                <Input
                  id="ei-supply"
                  type="date"
                  value={form.supplyDate}
                  onChange={(e) => setField('supplyDate', e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ei-due">Due Date</Label>
                <Input
                  id="ei-due"
                  type="date"
                  value={form.dueDate}
                  onChange={(e) => setField('dueDate', e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ei-po">P.O. Ref</Label>
                <Input
                  id="ei-po"
                  value={form.poRef}
                  onChange={(e) => setField('poRef', e.target.value)}
                  placeholder="e.g. PO-2026-118"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ei-contract">Contract Ref</Label>
                <Input
                  id="ei-contract"
                  value={form.contractRef}
                  onChange={(e) => setField('contractRef', e.target.value)}
                  placeholder="e.g. AGR-2025-042"
                />
              </div>
            </div>
          </section>

          {/* 4 ─ Bilingual details */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Bilingual Details</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <ArField
                idPrefix="ei-project"
                label="Project"
                en={form.projectEn}
                ar={form.projectAr}
                manual={form.arManual.project}
                busy={translatingKeys.has('h:project')}
                placeholderEn="e.g. Jubail Industrial Support"
                placeholderAr="المشروع"
                onEnChange={(v) => setField('projectEn', v)}
                onArChange={(v) =>
                  setForm((f) => ({
                    ...f,
                    projectAr: v,
                    arManual: { ...f.arManual, project: true },
                  }))
                }
                onEnBlur={() => handleHeaderEnBlur('project')}
                onTranslate={() => void translateHeaderField('project')}
              />
              <ArField
                idPrefix="ei-method"
                label="Payment Method"
                en={form.paymentMethodEn}
                ar={form.paymentMethodAr}
                manual={form.arManual.paymentMethod}
                busy={translatingKeys.has('h:paymentMethod')}
                placeholderEn="e.g. Bank transfer"
                placeholderAr="طريقة الدفع"
                onEnChange={(v) => setField('paymentMethodEn', v)}
                onArChange={(v) =>
                  setForm((f) => ({
                    ...f,
                    paymentMethodAr: v,
                    arManual: { ...f.arManual, paymentMethod: true },
                  }))
                }
                onEnBlur={() => handleHeaderEnBlur('paymentMethod')}
                onTranslate={() => void translateHeaderField('paymentMethod')}
              />
              <div className="sm:col-span-2">
                <ArField
                  idPrefix="ei-terms"
                  label="Payment Terms"
                  multiline
                  en={form.paymentTermsEn}
                  ar={form.paymentTermsAr}
                  manual={form.arManual.paymentTerms}
                  busy={translatingKeys.has('h:paymentTerms')}
                  placeholderEn="e.g. 30 days from invoice date"
                  placeholderAr="شروط الدفع"
                  onEnChange={(v) => setField('paymentTermsEn', v)}
                  onArChange={(v) =>
                    setForm((f) => ({
                      ...f,
                      paymentTermsAr: v,
                      arManual: { ...f.arManual, paymentTerms: true },
                    }))
                  }
                  onEnBlur={() => handleHeaderEnBlur('paymentTerms')}
                  onTranslate={() => void translateHeaderField('paymentTerms')}
                />
              </div>
              <div className="sm:col-span-2">
                <ArField
                  idPrefix="ei-notes"
                  label="Notes"
                  multiline
                  en={form.notesEn}
                  ar={form.notesAr}
                  manual={form.arManual.notes}
                  busy={translatingKeys.has('h:notes')}
                  placeholderEn="Optional notes printed on the invoice"
                  placeholderAr="ملاحظات"
                  onEnChange={(v) => setField('notesEn', v)}
                  onArChange={(v) =>
                    setForm((f) => ({
                      ...f,
                      notesAr: v,
                      arManual: { ...f.arManual, notes: true },
                    }))
                  }
                  onEnBlur={() => handleHeaderEnBlur('notes')}
                  onTranslate={() => void translateHeaderField('notes')}
                />
              </div>
            </div>
          </section>

          {/* 5 ─ Items editor */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm">Line Items</Label>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Per-line discount and VAT (15% / 0%) — taxable, VAT and totals update live.
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
                    <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
                      <Input
                        value={it.descriptionEn}
                        onChange={(e) => setItemField(it.key, { descriptionEn: e.target.value })}
                        onBlur={() => handleItemEnBlur(it.key, 'desc')}
                        placeholder="Description of goods / services"
                        aria-label={`Item ${i + 1} description (English)`}
                      />
                      <div className="flex gap-1">
                        <div className="relative min-w-0 flex-1">
                          <Input
                            lang="ar"
                            dir="rtl"
                            value={it.descriptionAr}
                            onChange={(e) =>
                              setItemField(it.key, {
                                descriptionAr: e.target.value,
                                descArManual: true,
                              })
                            }
                            placeholder="الوصف بالعربية"
                            className="font-arabic"
                            aria-label={`Item ${i + 1} description (Arabic)`}
                          />
                          {it.descArManual && it.descriptionAr.trim() ? (
                            <span
                              className={cn(MANUAL_DOT_CLASS, 'absolute left-2 top-1/2 -translate-y-1/2')}
                              title="Arabic edited manually — auto-translate will not overwrite it"
                            />
                          ) : null}
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9 shrink-0 text-muted-foreground hover:text-foreground"
                          onClick={() => void translateItemField(it.key, 'desc')}
                          disabled={translatingKeys.has(`i:${it.key}:desc`) || !it.descriptionEn.trim()}
                          aria-label={`Translate item ${i + 1} description to Arabic`}
                          title="Translate to Arabic"
                        >
                          {translatingKeys.has(`i:${it.key}:desc`) ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Languages className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </div>
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
                  <div className="mt-2 grid grid-cols-2 gap-2 pl-8 sm:grid-cols-4 lg:grid-cols-9">
                    <div className="space-y-1">
                      <Label className="text-[11px] text-muted-foreground">Unit (EN)</Label>
                      <Input
                        value={it.unitEn}
                        onChange={(e) => setItemField(it.key, { unitEn: e.target.value })}
                        onBlur={() => handleItemEnBlur(it.key, 'unit')}
                        placeholder="e.g. day"
                        className="h-9"
                        aria-label={`Item ${i + 1} unit (English)`}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px] text-muted-foreground">Unit (AR)</Label>
                      <div className="flex gap-1">
                        <div className="relative min-w-0 flex-1">
                          <Input
                            lang="ar"
                            dir="rtl"
                            value={it.unitAr}
                            onChange={(e) =>
                              setItemField(it.key, { unitAr: e.target.value, unitArManual: true })
                            }
                            placeholder="الوحدة"
                            className="h-9 font-arabic"
                            aria-label={`Item ${i + 1} unit (Arabic)`}
                          />
                          {it.unitArManual && it.unitAr.trim() ? (
                            <span
                              className={cn(
                                MANUAL_DOT_CLASS,
                                'absolute left-2 top-1/2 -translate-y-1/2'
                              )}
                              title="Arabic edited manually — auto-translate will not overwrite it"
                            />
                          ) : null}
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9 shrink-0 text-muted-foreground hover:text-foreground"
                          onClick={() => void translateItemField(it.key, 'unit')}
                          disabled={translatingKeys.has(`i:${it.key}:unit`) || !it.unitEn.trim()}
                          aria-label={`Translate item ${i + 1} unit to Arabic`}
                          title="Translate to Arabic"
                        >
                          {translatingKeys.has(`i:${it.key}:unit`) ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Languages className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px] text-muted-foreground">Qty</Label>
                      <Input
                        type="number"
                        min={0}
                        step="any"
                        value={it.quantity}
                        onChange={(e) => setItemField(it.key, { quantity: e.target.value })}
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
                        onChange={(e) => setItemField(it.key, { unitPrice: e.target.value })}
                        placeholder="0.00"
                        className="h-9 tabular-nums"
                        aria-label={`Item ${i + 1} unit price`}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px] text-muted-foreground">Discount</Label>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={it.discount}
                        onChange={(e) => setItemField(it.key, { discount: e.target.value })}
                        placeholder="0.00"
                        className="h-9 tabular-nums"
                        aria-label={`Item ${i + 1} discount`}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px] text-muted-foreground">VAT %</Label>
                      <Select
                        value={it.vatPercent}
                        onValueChange={(v) => setItemField(it.key, { vatPercent: v })}
                      >
                        <SelectTrigger
                          className="h-9 w-full"
                          aria-label={`Item ${i + 1} VAT percent`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="15">15%</SelectItem>
                          <SelectItem value="0">0%</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px] text-muted-foreground">Taxable</Label>
                      <p className="flex h-9 items-center rounded-md border bg-background px-2.5 text-sm tabular-nums">
                        {formatNumber(calc.items[i]?.taxable ?? 0)}
                      </p>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px] text-muted-foreground">VAT</Label>
                      <p className="flex h-9 items-center rounded-md border bg-background px-2.5 text-sm tabular-nums">
                        {formatNumber(calc.items[i]?.vat ?? 0)}
                      </p>
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

            {/* 6 ─ Live totals (sticky in the dialog) */}
            <div className="sticky bottom-0 z-20 -mx-6 border-t bg-background/95 px-6 py-3 shadow-[0_-2px_8px_rgba(0,0,0,0.04)] backdrop-blur">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                <div>
                  <p className="text-[11px] font-medium text-muted-foreground">Subtotal</p>
                  <p className="text-sm font-semibold tabular-nums">{money(calc.subtotal)}</p>
                </div>
                <div>
                  <p className="text-[11px] font-medium text-muted-foreground">Total Discount</p>
                  <p className="text-sm font-semibold tabular-nums text-rose-600 dark:text-rose-400">
                    -{money(calc.totalDiscount)}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-medium text-muted-foreground">Taxable</p>
                  <p className="text-sm font-semibold tabular-nums">{money(calc.taxableAmount)}</p>
                </div>
                <div>
                  <p className="text-[11px] font-medium text-muted-foreground">VAT</p>
                  <p className="text-sm font-semibold tabular-nums">{money(calc.vatAmount)}</p>
                </div>
                <div>
                  <p className="text-[11px] font-medium text-muted-foreground">Total Due</p>
                  <p className="text-base font-bold tabular-nums">{money(calc.totalDue)}</p>
                </div>
              </div>
              <p className="mt-2 border-t pt-2 text-[11px] leading-relaxed text-muted-foreground">
                <span className="font-semibold not-italic text-foreground">Amount in words:</span>{' '}
                {words.en}
                <span lang="ar" dir="rtl" className="mt-0.5 block font-arabic">
                  {words.ar}
                </span>
              </p>
            </div>
          </div>

          {/* 7 ─ Options */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Options</h3>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <Label htmlFor="ei-receiver" className="text-sm">
                  Show Receiver Signature
                </Label>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Prints a receiver signature line on the invoice (default from E-Invoice
                  settings).
                </p>
              </div>
              <Switch
                id="ei-receiver"
                checked={form.showReceiverSignature}
                onCheckedChange={(v) => setField('showReceiverSignature', v)}
              />
            </div>
          </section>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button variant="outline" onClick={openDraftPreview} disabled={saving}>
              <Eye className="h-4 w-4" />
              Preview
            </Button>
            <Button onClick={() => void handleSubmit()} disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Save Changes' : 'Save Draft'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- Issue confirmation ---- */}
      <AlertDialog open={!!issueTarget} onOpenChange={(v) => !v && setIssueTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Issue {issueTarget?.invoiceNumber}?</AlertDialogTitle>
            <AlertDialogDescription>
              After issuing, the invoice is LOCKED — it receives its ZATCA UUID, invoice counter
              (ICV) and hash-chain signature, and can no longer be edited or deleted. Corrections
              must be made with a Credit Note or Debit Note. Payments can still be recorded, and a
              signed delivery copy can be attached.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={issuing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                void handleIssue()
              }}
            >
              {issuing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Issue Invoice
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ---- Mobile delete confirmation ---- */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete e-invoice?</AlertDialogTitle>
            <AlertDialogDescription>
              Draft {deleteTarget?.invoiceNumber} ({deleteTarget?.clientNameEn}) and all its line
              items will be permanently removed. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault()
                if (deleteTarget) void handleDelete(deleteTarget).then(() => setDeleteTarget(null))
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ---- Manual-translation overwrite confirmation ---- */}
      <AlertDialog open={!!translateConfirm} onOpenChange={(v) => !v && setTranslateConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Overwrite the Arabic translation?</AlertDialogTitle>
            <AlertDialogDescription>
              The Arabic text was edited manually. Translating again will replace it with a new
              machine translation of “{translateConfirm?.text}”.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep my Arabic</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                void handleConfirmTranslate()
              }}
            >
              Translate Anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ---- Payments dialog ---- */}
      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent className="nice-scrollbar max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Record Payment — {payInvoice?.invoiceNumber}</DialogTitle>
            <DialogDescription>
              Payments are only allowed on issued invoices. The status updates automatically
              (partially paid / paid).
            </DialogDescription>
          </DialogHeader>

          {payInvoice ? (
            <>
              <div className="grid grid-cols-3 gap-2 rounded-lg border bg-muted/30 p-3 text-center">
                <div>
                  <p className="text-[11px] text-muted-foreground">Total Due</p>
                  <p className="text-sm font-bold tabular-nums">{money(payInvoice.totalDue)}</p>
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground">Paid</p>
                  <p className="text-sm font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                    {money(payInvoice.paidAmount)}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground">Balance</p>
                  <p className="text-sm font-bold tabular-nums">
                    {money(round2(payInvoice.totalDue - payInvoice.paidAmount))}
                  </p>
                </div>
              </div>

              {/* existing payments */}
              <div className="space-y-1.5">
                <Label className="text-sm">Recorded Payments</Label>
                {payInvoice.payments?.length ? (
                  <div className="nice-scrollbar max-h-44 space-y-1.5 overflow-y-auto pr-1">
                    {payInvoice.payments.map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center justify-between gap-2 rounded-md border bg-muted/30 px-2.5 py-1.5 text-xs"
                      >
                        <div className="min-w-0">
                          <p className="font-semibold tabular-nums">
                            {money(p.amount)}
                            <span className="ml-1.5 font-normal text-muted-foreground">
                              {formatDate(p.paymentDate)}
                            </span>
                          </p>
                          <p className="truncate text-muted-foreground">
                            {[p.methodEn, p.reference].filter(Boolean).join(' · ') || '—'}
                            {p.methodAr ? ' · ' : ''}
                            {p.methodAr ? (
                              <span lang="ar" dir="rtl">
                                {p.methodAr}
                              </span>
                            ) : null}
                          </p>
                        </div>
                        <ConfirmDelete
                          onConfirm={() => void handleDeletePayment(p.id)}
                          title="Delete payment?"
                          description={`This payment of ${money(p.amount)} will be removed and the invoice status recomputed.`}
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
                    No payments recorded yet.
                  </p>
                )}
              </div>

              {/* add form */}
              <div className="space-y-3 rounded-lg border p-3">
                <Label className="text-sm">Add Payment</Label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="pay-amount" className="text-xs text-muted-foreground">
                      Amount ({currency})
                    </Label>
                    <Input
                      id="pay-amount"
                      type="number"
                      min={0}
                      step="0.01"
                      value={payForm.amount}
                      onChange={(e) => setPayForm((f) => ({ ...f, amount: e.target.value }))}
                      placeholder={formatNumber(
                        round2(payInvoice.totalDue - payInvoice.paidAmount)
                      )}
                      className="tabular-nums"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="pay-date" className="text-xs text-muted-foreground">
                      Payment Date
                    </Label>
                    <Input
                      id="pay-date"
                      type="date"
                      value={payForm.paymentDate}
                      onChange={(e) => setPayForm((f) => ({ ...f, paymentDate: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="pay-method-en" className="text-xs text-muted-foreground">
                      Method (EN)
                    </Label>
                    <Input
                      id="pay-method-en"
                      value={payForm.methodEn}
                      onChange={(e) => setPayForm((f) => ({ ...f, methodEn: e.target.value }))}
                      placeholder="e.g. Bank transfer"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="pay-method-ar" className="text-xs text-muted-foreground">
                      Method (AR)
                    </Label>
                    <div className="flex gap-1">
                      <Input
                        id="pay-method-ar"
                        lang="ar"
                        dir="rtl"
                        value={payForm.methodAr}
                        onChange={(e) => setPayForm((f) => ({ ...f, methodAr: e.target.value }))}
                        placeholder="طريقة الدفع"
                        className="font-arabic"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 shrink-0 text-muted-foreground hover:text-foreground"
                        onClick={async () => {
                          const text = payForm.methodEn.trim()
                          if (!text || payMethodBusy) return
                          setPayMethodBusy(true)
                          try {
                            const res = await api.post<TranslateResponse>(
                              '/api/e-invoices/translate',
                              { entries: [{ key: 'm', text, context: 'payment_method' }] }
                            )
                            const r = res.results.find((x) => x.key === 'm')
                            if (r?.translated) {
                              setPayForm((f) => ({ ...f, methodAr: r.translated }))
                            } else {
                              toast.info('No translation available — type the Arabic manually')
                            }
                            if (res.providerError) {
                              toast.error('Auto-translation unavailable', {
                                description: res.providerError,
                              })
                            }
                          } catch (e) {
                            toast.error(e instanceof Error ? e.message : 'Translation failed')
                          } finally {
                            setPayMethodBusy(false)
                          }
                        }}
                        disabled={payMethodBusy || !payForm.methodEn.trim()}
                        aria-label="Translate payment method to Arabic"
                        title="Translate to Arabic"
                      >
                        {payMethodBusy ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Languages className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="pay-ref" className="text-xs text-muted-foreground">
                      Reference
                    </Label>
                    <Input
                      id="pay-ref"
                      value={payForm.reference}
                      onChange={(e) => setPayForm((f) => ({ ...f, reference: e.target.value }))}
                      placeholder="e.g. TT-00931 / cheque no."
                    />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="pay-notes" className="text-xs text-muted-foreground">
                      Notes
                    </Label>
                    <Input
                      id="pay-notes"
                      value={payForm.notes}
                      onChange={(e) => setPayForm((f) => ({ ...f, notes: e.target.value }))}
                      placeholder="Optional"
                    />
                  </div>
                </div>
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    onClick={() => void handleAddPayment()}
                    disabled={paySaving || payInvoice.status === 'paid'}
                  >
                    {paySaving ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Wallet className="h-4 w-4" />
                    )}
                    Add Payment
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading invoice…
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ---- Signed copy preview ---- */}
      <Dialog open={!!signedPreview} onOpenChange={(v) => !v && setSignedPreview(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">
              Signed copy — {signedPreview?.number}
            </DialogTitle>
            <DialogDescription>
              Signed / stamped delivery copy attached to this issued e-invoice.
            </DialogDescription>
          </DialogHeader>
          {signedPreview ? (
            <div className="overflow-hidden rounded-lg border bg-white">
              { }
              <img
                src={signedPreview.image}
                alt={`Signed copy of ${signedPreview.number}`}
                className="max-h-[60vh] w-full object-contain"
              />
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Hidden file input for signed-copy uploads (proof of delivery) */}
      <input
        ref={signedInputRef}
        type="file"
        accept="image/png,image/jpeg"
        className="sr-only"
        onChange={(e) => void handleSignedFileSelected(e.target.files?.[0])}
        aria-label="Upload signed copy image"
        disabled={signedBusy}
      />

      {/* ---- Print / preview dialog (saved documents + live drafts) ---- */}
      <EInvoicePrintDialog
        invoice={printInvoice ?? draftPreview}
        config={eiConfig}
        qrDataUrl={qrDataUrl}
        open={printOpen}
        onOpenChange={(v) => {
          setPrintOpen(v)
          if (!v) {
            setPrintInvoice(null)
            setDraftPreview(null)
            setQrDataUrl(null)
          }
        }}
      />

      {/* ---- ZATCA Phase 2 submission (connect system) ---- */}
      <EInvoiceZatcaSubmitDialog
        open={zatcaOpen}
        onOpenChange={setZatcaOpen}
        invoice={zatcaTarget}
        onSubmitted={() => void load()}
      />

      {/* ---- Quick add client (saved to the Clients module) ---- */}
      <Dialog open={clientAddOpen} onOpenChange={setClientAddOpen}>
        <DialogContent className="nice-scrollbar max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="h-4 w-4 text-[#8E6420] dark:text-[#E1B169]" />
              Add New Client
            </DialogTitle>
            <DialogDescription>
              Saved permanently to the Clients module — the client becomes
              selectable here and everywhere else.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="qc-name">
                Client Name (English) <span className="text-destructive">*</span>
              </Label>
              <Input
                id="qc-name"
                value={clientForm.name}
                onChange={(e) => setClientForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Al Bawani Co. Ltd."
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="qc-name-ar">Client Name (Arabic)</Label>
              <Input
                id="qc-name-ar"
                lang="ar"
                dir="rtl"
                value={clientForm.nameAr}
                onChange={(e) => setClientForm((f) => ({ ...f, nameAr: e.target.value }))}
                placeholder="مثال: شركة البواني"
                className="font-[Cairo]"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="qc-contact">Contact Person</Label>
              <Input
                id="qc-contact"
                value={clientForm.contactPerson}
                onChange={(e) =>
                  setClientForm((f) => ({ ...f, contactPerson: e.target.value }))
                }
                placeholder="e.g. Eng. Ahmed Ali"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="qc-phone">Phone</Label>
              <Input
                id="qc-phone"
                value={clientForm.phone}
                onChange={(e) => setClientForm((f) => ({ ...f, phone: e.target.value }))}
                placeholder="e.g. +966 5X XXX XXXX"
                inputMode="tel"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="qc-email">Email</Label>
              <Input
                id="qc-email"
                type="email"
                value={clientForm.email}
                onChange={(e) => setClientForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="e.g. accounts@client.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="qc-city">City</Label>
              <Input
                id="qc-city"
                value={clientForm.city}
                onChange={(e) => setClientForm((f) => ({ ...f, city: e.target.value }))}
                placeholder="e.g. Riyadh"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="qc-vat">VAT No.</Label>
              <Input
                id="qc-vat"
                value={clientForm.vatNumber}
                onChange={(e) => setClientForm((f) => ({ ...f, vatNumber: e.target.value }))}
                placeholder="3XXXXXXXXXXXXX3"
                className="font-mono"
                inputMode="numeric"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="qc-cr">C.R. No.</Label>
              <Input
                id="qc-cr"
                value={clientForm.crNumber}
                onChange={(e) => setClientForm((f) => ({ ...f, crNumber: e.target.value }))}
                placeholder="e.g. 2050xxxxxxx"
                className="font-mono"
                inputMode="numeric"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="qc-address">Address</Label>
              <Textarea
                id="qc-address"
                value={clientForm.address}
                onChange={(e) => setClientForm((f) => ({ ...f, address: e.target.value }))}
                placeholder="Street, city, country"
                rows={2}
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => setClientAddOpen(false)}
              disabled={clientAddSaving}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void handleQuickAddClient()}
              disabled={clientAddSaving}
            >
              {clientAddSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <UserPlus className="h-4 w-4" />
              )}
              Save Client
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

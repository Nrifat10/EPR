'use client'

// Agreements view — contract / agreement manager (Business Documents section).
//   • stat cards (total, total value, signed, active) over the filtered list
//   • search + status + type + year filters, CSV export
//   • desktop table + mobile cards with per-row Edit / Delete / Print
//   • the create/edit dialog supports two layout styles:
//       – Detailed: priced line-item editor with live line totals and a live
//         contract-value footer (value is always recomputed server-side),
//       – Simple: a single "Contract Value (price as per P.O.)" field.
//     plus an installments editor (with a mismatch warning against the value)
//     and an ordered clauses editor with starter templates that auto-switch
//     with the agreement type.
//   • per-row A4 agreement print preview (letterhead, parties, scope,
//     payment schedule, clauses, signatures).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  ArrowDown,
  ArrowUp,
  Banknote,
  CalendarClock,
  CalendarX,
  ChevronsUpDown,
  FileSignature,
  Loader2,
  PenLine,
  Pencil,
  Plus,
  Printer,
  ReceiptText,
  ScrollText,
  Stamp,
  Download,
  X,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { ConfirmDelete } from '@/components/app/shared/confirm-delete'
import { DataTablePagination } from '@/components/app/shared/data-table-pagination'
import { EmptyState, TableSkeleton } from '@/components/app/shared/empty-state'
import { FilterBar, FilterSelect, SearchInput } from '@/components/app/shared/filter-select'
import { PageHeader, SectionCard, MobileFab } from '@/components/app/shared/page-header'
import { StatCard } from '@/components/app/shared/stat-card'
import { AgreementPrintDialog } from '@/components/app/print/agreement-print'
import { useDebounce } from '@/hooks/use-debounce'
import { useViewIntent } from '@/hooks/use-view-intent'
import { api, qs } from '@/lib/api-client'
import { buildCsv, csvFilename, downloadCsv } from '@/lib/csv'
import { formatDate, formatMoney, formatNumber, round2, toDateInputValue } from '@/lib/format'
import { can, useAppStore } from '@/lib/store'
import {
  AGREEMENT_STATUSES,
  AGREEMENT_TYPES,
  type AgreementRow,
  type ClientRow,
  type Paginated,
} from '@/lib/types'
import { cn } from '@/lib/utils'

type ListTotals = {
  count: number
  totalValue: number
  signedValue: number
  signedCount: number
  active: number
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  final: 'Final',
  signed: 'Signed',
  expired: 'Expired',
}

const TYPE_LABELS: Record<string, string> = {
  labor_supply: 'Labor Supply',
  service: 'Service',
  subcontract: 'Subcontract',
}

const LAYOUT_LABELS: Record<string, string> = {
  detailed: 'Detailed',
  simple: 'Simple',
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

function AgreementStatusBadge({ status, className }: { status: string; className?: string }) {
  const map: Record<
    string,
    { label: string; cls: string; icon: React.ComponentType<{ className?: string }> }
  > = {
    draft: {
      label: 'Draft',
      cls: 'border-neutral-200 bg-muted text-muted-foreground dark:border-neutral-700 dark:bg-muted/40',
      icon: Pencil,
    },
    final: {
      label: 'Final',
      cls: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400',
      icon: Stamp,
    },
    signed: {
      label: 'Signed',
      cls: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-400',
      icon: PenLine,
    },
    expired: {
      label: 'Expired',
      cls: 'border-neutral-300 bg-neutral-100 text-neutral-500 dark:border-neutral-700 dark:bg-neutral-800/60 dark:text-neutral-400',
      icon: CalendarX,
    },
  }
  const s = map[status] ?? map.draft
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium',
        s.cls,
        className
      )}
    >
      <s.icon className="h-3 w-3" />
      {s.label}
    </span>
  )
}

function AgreementTypeBadge({ type, className }: { type: string; className?: string }) {
  const map: Record<string, string> = {
    labor_supply: 'border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-900 dark:bg-teal-950 dark:text-teal-400',
    service: 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900 dark:bg-violet-950 dark:text-violet-400',
    subcontract: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-400',
  }
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium',
        map[type] ?? map.labor_supply,
        className
      )}
    >
      {TYPE_LABELS[type] ?? type}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export function AgreementsView() {
  const user = useAppStore((s) => s.user)
  const settings = useAppStore((s) => s.settings)
  const currency = settings.currency || 'SAR'

  const canCreate = can(user, 'agreements.create')
  const canEdit = can(user, 'agreements.edit')
  const canDelete = can(user, 'agreements.delete')

  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 350)
  const [statusFilter, setStatusFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [yearFilter, setYearFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)

  const [rows, setRows] = useState<AgreementRow[]>([])
  const [totals, setTotals] = useState<ListTotals>({
    count: 0,
    totalValue: 0,
    signedValue: 0,
    signedCount: 0,
    active: 0,
  })
  const [meta, setMeta] = useState({ page: 1, pageSize: 10, total: 0, totalPages: 1 })
  const [loading, setLoading] = useState(true)

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<AgreementRow | null>(null)
  const [printing, setPrinting] = useState<AgreementRow | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  const yearOptions = useMemo(() => {
    const y = new Date().getFullYear()
    return Array.from({ length: 6 }, (_, i) => String(y - 3 + i))
  }, [])

  const loadList = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get<Paginated<AgreementRow>>(
        `/api/agreements${qs({
          search: debouncedSearch,
          status: statusFilter === 'all' ? '' : statusFilter,
          type: typeFilter === 'all' ? '' : typeFilter,
          year: yearFilter === 'all' ? '' : yearFilter,
          page,
          pageSize,
        })}`
      )
      setRows(res.data)
      setTotals({
        count: res.totals?.count ?? 0,
        totalValue: res.totals?.totalValue ?? 0,
        signedValue: res.totals?.signedValue ?? 0,
        signedCount: res.totals?.signedCount ?? 0,
        active: res.totals?.active ?? 0,
      })
      setMeta({ page: res.page, pageSize: res.pageSize, total: res.total, totalPages: res.totalPages })
      if (res.data.length === 0 && res.page > 1 && res.total > 0) setPage(res.totalPages)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load agreements')
    } finally {
      setLoading(false)
    }
  }, [debouncedSearch, statusFilter, typeFilter, yearFilter, page, pageSize])

  useEffect(() => {
    void loadList()
  }, [loadList])

  function changeFilter(setter: (v: string) => void) {
    return (v: string) => {
      setter(v)
      setPage(1)
    }
  }

  function openCreate() {
    setEditing(null)
    setFormOpen(true)
  }

  // Deep-open the create dialog when arriving via the command palette
  const shouldOpenCreate = useViewIntent('agreements', 'create')
  useEffect(() => {
    if (shouldOpenCreate) openCreate()
  }, [shouldOpenCreate])

  /** Fetch the full agreement (items/installments/clauses) for edit or print. */
  const fetchFull = useCallback(async (id: string): Promise<AgreementRow | null> => {
    try {
      return await api.get<AgreementRow>(`/api/agreements/${id}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load agreement')
      return null
    }
  }, [])

  async function openEdit(row: AgreementRow) {
    if (busyId) return
    setBusyId(row.id)
    const full = await fetchFull(row.id)
    setBusyId(null)
    if (full) {
      setEditing(full)
      setFormOpen(true)
    }
  }

  async function openPrint(row: AgreementRow) {
    if (busyId) return
    setBusyId(row.id)
    const full = await fetchFull(row.id)
    setBusyId(null)
    if (full) setPrinting(full)
  }

  async function handleDelete(row: AgreementRow) {
    try {
      await api.del(`/api/agreements/${row.id}`)
      toast.success(`Agreement ${row.refNumber} deleted`)
      void loadList()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete agreement')
    }
  }

  function handleSaved() {
    setFormOpen(false)
    void loadList()
  }

  async function handleExportCsv() {
    if (exporting) return
    setExporting(true)
    try {
      const all: AgreementRow[] = []
      let p = 1
      for (;;) {
        const res = await api.get<Paginated<AgreementRow>>(
          `/api/agreements${qs({
            search: debouncedSearch,
            status: statusFilter === 'all' ? '' : statusFilter,
            type: typeFilter === 'all' ? '' : typeFilter,
            year: yearFilter === 'all' ? '' : yearFilter,
            page: p,
            pageSize: 100,
          })}`
        )
        all.push(...res.data)
        if (p >= res.totalPages || res.data.length === 0) break
        p += 1
      }
      if (all.length === 0) {
        toast.info('No agreements match the current filters')
        return
      }
      const csv = buildCsv(
        [
          'Ref Number',
          'Title',
          'Client (Party B)',
          'Type',
          'Layout',
          'Start Date',
          'End Date',
          `Value (${currency})`,
          'Status',
          'Created By',
          'Created At',
        ],
        all.map((r) => [
          r.refNumber,
          r.title,
          r.clientName,
          TYPE_LABELS[r.type] ?? r.type,
          LAYOUT_LABELS[r.layoutStyle] ?? r.layoutStyle,
          formatDate(r.startDate),
          r.endDate ? formatDate(r.endDate) : '',
          r.value.toFixed(2),
          STATUS_LABELS[r.status] ?? r.status,
          r.createdByName ?? '',
          formatDate(r.createdAt),
        ])
      )
      downloadCsv(csvFilename('agreements', yearFilter !== 'all' ? yearFilter : 'all'), csv)
      toast.success(`Exported ${all.length} agreement${all.length === 1 ? '' : 's'} to CSV`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  const activeFilterCount =
    (statusFilter !== 'all' ? 1 : 0) + (typeFilter !== 'all' ? 1 : 0) + (yearFilter !== 'all' ? 1 : 0)

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title="Agreements"
        description="Contracts with clients — labor supply, services and subcontracts"
      >
        <Button
          variant="outline"
          size="sm"
          className="h-9"
          onClick={handleExportCsv}
          disabled={exporting}
        >
          {exporting ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Download className="mr-2 h-4 w-4" />
          )}
          Excel / CSV
        </Button>
        {canCreate ? (
          <Button size="sm" className="h-9" onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" />
            New Agreement
          </Button>
        ) : null}
      </PageHeader>

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Total Agreements"
          value={totals.count.toLocaleString()}
          sublabel="Matching the current filters"
          icon={FileSignature}
          tone="navy"
        />
        <StatCard
          title="Total Value"
          value={formatNumber(totals.totalValue)}
          valuePrefix={currency}
          sublabel="All statuses combined"
          icon={Banknote}
          tone="gold"
        />
        <StatCard
          title="Signed"
          value={totals.signedCount.toLocaleString()}
          sublabel={
            totals.signedCount > 0 ? `Worth ${formatMoney(totals.signedValue, currency)}` : 'None yet'
          }
          icon={PenLine}
          tone="green"
        />
        <StatCard
          title="Active"
          value={totals.active.toLocaleString()}
          sublabel="Signed and not yet ended"
          icon={CalendarClock}
          tone="teal"
        />
      </div>

      {/* List */}
      <SectionCard className="p-4 sm:p-6">
        <FilterBar
          search={
            <SearchInput
              value={search}
              onChange={(v) => {
                setSearch(v)
                setPage(1)
              }}
              placeholder="Search ref, title or client…"
            />
          }
          activeCount={activeFilterCount}
        >
          <FilterSelect
            value={statusFilter}
            onChange={changeFilter(setStatusFilter)}
            placeholder="Status"
            options={AGREEMENT_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }))}
            emptyLabel="All statuses"
          />
          <FilterSelect
            value={typeFilter}
            onChange={changeFilter(setTypeFilter)}
            placeholder="Type"
            options={AGREEMENT_TYPES.map((t) => ({ value: t, label: TYPE_LABELS[t] }))}
            emptyLabel="All types"
          />
          <FilterSelect
            value={yearFilter}
            onChange={changeFilter(setYearFilter)}
            placeholder="Year"
            options={yearOptions.map((y) => ({ value: y, label: y }))}
            emptyLabel="All years"
          />
        </FilterBar>

        <div className="mt-4">
          {loading ? (
            <TableSkeleton rows={6} />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={FileSignature}
              title="No agreements"
              description={
                activeFilterCount > 0 || search
                  ? 'No agreements match the current filters — try clearing them.'
                  : 'Contracts and agreements with clients will appear here.'
              }
              action={
                canCreate ? (
                  <Button size="sm" onClick={openCreate}>
                    <Plus className="mr-2 h-4 w-4" />
                    New Agreement
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <>
              {/* Desktop table */}
              <div className="nice-scrollbar hidden overflow-x-auto md:block">
                <Table className="min-w-[880px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="h-9">Ref</TableHead>
                      <TableHead className="h-9 min-w-[200px]">Title</TableHead>
                      <TableHead className="h-9 min-w-[140px]">Client</TableHead>
                      <TableHead className="h-9">Type</TableHead>
                      <TableHead className="h-9">Period</TableHead>
                      <TableHead className="h-9 text-right">Value</TableHead>
                      <TableHead className="h-9">Status</TableHead>
                      <TableHead className="h-9 text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="px-4 py-2.5 font-mono text-xs font-medium">
                          {r.refNumber}
                        </TableCell>
                        <TableCell className="px-4 py-2.5">
                          <p className="max-w-[260px] truncate font-medium" title={r.title}>
                            {r.title}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {LAYOUT_LABELS[r.layoutStyle] ?? r.layoutStyle}
                            {r.createdByName ? ` · by ${r.createdByName}` : ''}
                          </p>
                        </TableCell>
                        <TableCell className="px-4 py-2.5">
                          <p className="max-w-[160px] truncate" title={r.clientName}>
                            {r.clientName}
                          </p>
                        </TableCell>
                        <TableCell className="px-4 py-2.5">
                          <AgreementTypeBadge type={r.type} />
                        </TableCell>
                        <TableCell className="px-4 py-2.5">
                          <p className="text-sm">{formatDate(r.startDate)}</p>
                          <p className="text-xs text-muted-foreground">
                            {r.endDate ? `to ${formatDate(r.endDate)}` : 'ongoing'}
                          </p>
                        </TableCell>
                        <TableCell className="px-4 py-2.5 text-right tabular-nums font-medium">
                          {formatMoney(r.value, currency)}
                        </TableCell>
                        <TableCell className="px-4 py-2.5">
                          <AgreementStatusBadge status={r.status} />
                        </TableCell>
                        <TableCell className="px-4 py-2.5">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => void openPrint(r)}
                              disabled={busyId === r.id}
                              title="Print agreement"
                            >
                              {busyId === r.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Printer className="h-4 w-4" />
                              )}
                              <span className="sr-only">Print {r.refNumber}</span>
                            </Button>
                            {canEdit ? (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => void openEdit(r)}
                                disabled={busyId === r.id}
                                title="Edit agreement"
                              >
                                <Pencil className="h-4 w-4" />
                                <span className="sr-only">Edit {r.refNumber}</span>
                              </Button>
                            ) : null}
                            {canDelete ? (
                              <ConfirmDelete
                                onConfirm={() => handleDelete(r)}
                                title="Delete agreement?"
                                description={`${r.refNumber} — ${r.title} with ${r.clientName}. Items, installments and clauses are removed too.`}
                              />
                            ) : null}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile cards */}
              <ul className="space-y-3 md:hidden">
                {rows.map((r) => (
                  <li key={r.id} className="rounded-xl border bg-card p-3.5 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-mono text-[11px] font-semibold text-muted-foreground">
                          {r.refNumber}
                        </p>
                        <p className="mt-0.5 line-clamp-2 text-sm font-semibold">{r.title}</p>
                      </div>
                      <AgreementStatusBadge status={r.status} />
                    </div>
                    <div className="mt-2.5 flex flex-wrap items-center gap-2">
                      <AgreementTypeBadge type={r.type} />
                      <span className="text-xs text-muted-foreground">{r.clientName}</span>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                      <div>
                        <p className="text-muted-foreground">Value</p>
                        <p className="font-semibold tabular-nums">{formatMoney(r.value, currency)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Period</p>
                        <p className="font-medium">
                          {formatDate(r.startDate)}
                          {r.endDate ? ` → ${formatDate(r.endDate)}` : ' → ongoing'}
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 flex items-center justify-end gap-1 border-t pt-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 gap-1.5 px-2.5"
                        onClick={() => void openPrint(r)}
                        disabled={busyId === r.id}
                      >
                        {busyId === r.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Printer className="h-3.5 w-3.5" />
                        )}
                        Print
                      </Button>
                      {canEdit ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 gap-1.5 px-2.5"
                          onClick={() => void openEdit(r)}
                          disabled={busyId === r.id}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Edit
                        </Button>
                      ) : null}
                      {canDelete ? (
                        <ConfirmDelete
                          onConfirm={() => handleDelete(r)}
                          title="Delete agreement?"
                          description={`${r.refNumber} — ${r.title} with ${r.clientName}. Items, installments and clauses are removed too.`}
                          label="Delete"
                          size="sm"
                          triggerClassName="h-8 px-2.5 gap-1.5 text-destructive hover:text-destructive"
                        />
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>

              <div className="mt-4">
                <DataTablePagination
                  page={meta.page}
                  pageSize={meta.pageSize}
                  total={meta.total}
                  totalPages={meta.totalPages}
                  onPageChange={setPage}
                  onPageSizeChange={(s) => {
                    setPageSize(s)
                    setPage(1)
                  }}
                />
              </div>
            </>
          )}
        </div>
      </SectionCard>

      {/* Create / edit dialog */}
      <AgreementFormDialog
        open={formOpen}
        onOpenChange={(o) => {
          setFormOpen(o)
          if (!o) setEditing(null)
        }}
        editing={editing}
        currency={currency}
        onSaved={handleSaved}
      />

      {/* A4 agreement print preview */}
      <AgreementPrintDialog
        agreement={printing}
        open={Boolean(printing)}
        onOpenChange={(o) => !o && setPrinting(null)}
      />

      {/* Mobile FAB */}
      {canCreate ? <MobileFab label="New Agreement" icon={Plus} onClick={openCreate} /> : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Create / edit dialog
// ---------------------------------------------------------------------------

type AgreementType = (typeof AGREEMENT_TYPES)[number]
type AgreementStatus = (typeof AGREEMENT_STATUSES)[number]

type ItemDraft = {
  key: string
  description: string
  unit: string
  quantity: string
  unitPrice: string
}

type InstallmentDraft = {
  key: string
  label: string
  dueDate: string
  amount: string
  paid: boolean
}

type ClauseDraft = {
  key: string
  title: string
  body: string
}

type FormState = {
  title: string
  clientId: string
  clientName: string
  type: AgreementType
  layoutStyle: 'detailed' | 'simple'
  startDate: string
  endDate: string
  status: AgreementStatus
  notes: string
  simpleValue: string
  items: ItemDraft[]
  installments: InstallmentDraft[]
  clauses: ClauseDraft[]
  /** true while the clause list is still the untouched starter templates —
   *  switching the agreement type then swaps in the new type's templates. */
  clausesAuto: boolean
}

let keySeq = 0
const nextKey = () => `k${++keySeq}`

const newItem = (): ItemDraft => ({
  key: nextKey(),
  description: '',
  unit: '',
  quantity: '1',
  unitPrice: '',
})

const newInstallment = (): InstallmentDraft => ({
  key: nextKey(),
  label: '',
  dueDate: '',
  amount: '',
  paid: false,
})

const newClause = (): ClauseDraft => ({ key: nextKey(), title: '', body: '' })

/** Starter clause templates — 5 for subcontracts, 3 generic otherwise. */
function clauseTemplates(type: AgreementType): ClauseDraft[] {
  if (type === 'subcontract') {
    return [
      {
        ...newClause(),
        title: 'Scope of Work',
        body: 'The Subcontractor shall execute and complete the subcontracted works described in this Agreement, including the supply of labour, materials and equipment as applicable, in accordance with the main contract requirements and the reasonable directions of the First Party.',
      },
      {
        ...newClause(),
        title: 'Payment Terms',
        body: 'Payments shall be made as per the payment schedule stated in this Agreement, against approved invoices and progress certifications. No payment shall fall due until the corresponding milestone or installment is certified by the First Party.',
      },
      {
        ...newClause(),
        title: 'Duration',
        body: 'The subcontracted works shall commence on the start date stated above and shall be completed within the period stated in this Agreement or by the end date above, subject only to any extensions agreed in writing by both parties.',
      },
      {
        ...newClause(),
        title: 'Termination',
        body: 'Either party may terminate this Agreement by serving thirty (30) days\u2019 prior written notice. The First Party may terminate immediately for cause if the Subcontractor fails to perform its obligations or breaches statutory or site safety requirements.',
      },
      {
        ...newClause(),
        title: 'Liability',
        body: 'The Subcontractor shall be liable for any loss or damage caused by its negligence or failure to perform its obligations under this Agreement. The aggregate liability of the First Party shall not exceed the total contract value stated herein.',
      },
    ]
  }
  return [
    {
      ...newClause(),
      title: 'Scope',
      body: 'The First Party shall provide the manpower and/or services described in this Agreement to the Second Party in accordance with the terms and conditions stated herein.',
    },
    {
      ...newClause(),
      title: 'Payment',
      body: 'The Second Party shall pay the First Party the amounts due as per the payment schedule stated in this Agreement, by bank transfer to the First Party\u2019s designated bank account, without deduction or set-off.',
    },
    {
      ...newClause(),
      title: 'Duration',
      body: 'This Agreement shall come into effect on the start date stated above and shall remain in force until the completion of the obligations herein or until the end date stated above, whichever occurs first.',
    },
  ]
}

function asType(v: string): AgreementType {
  return (AGREEMENT_TYPES as readonly string[]).includes(v) ? (v as AgreementType) : 'labor_supply'
}

function asStatus(v: string): AgreementStatus {
  return (AGREEMENT_STATUSES as readonly string[]).includes(v)
    ? (v as AgreementStatus)
    : 'draft'
}

function defaultForm(): FormState {
  const now = new Date()
  return {
    title: '',
    clientId: '',
    clientName: '',
    type: 'labor_supply',
    layoutStyle: 'detailed',
    startDate: toDateInputValue(now),
    endDate: '',
    status: 'draft',
    notes: '',
    simpleValue: '',
    items: [newItem()],
    installments: [],
    clauses: clauseTemplates('labor_supply'),
    clausesAuto: true,
  }
}

function formFromAgreement(a: AgreementRow): FormState {
  return {
    title: a.title,
    clientId: a.clientId ?? '',
    clientName: a.clientName,
    type: asType(a.type),
    layoutStyle: a.layoutStyle === 'simple' ? 'simple' : 'detailed',
    startDate: toDateInputValue(a.startDate),
    endDate: a.endDate ? toDateInputValue(a.endDate) : '',
    status: asStatus(a.status),
    notes: a.notes ?? '',
    simpleValue: a.layoutStyle === 'simple' ? String(a.value) : '',
    items:
      a.items && a.items.length > 0
        ? a.items.map((it) => ({
            key: nextKey(),
            description: it.description,
            unit: it.unit ?? '',
            quantity: String(it.quantity),
            unitPrice: String(it.unitPrice),
          }))
        : [newItem()],
    installments: (a.installments ?? []).map((i) => ({
      key: nextKey(),
      label: i.label,
      dueDate: i.dueDate ? toDateInputValue(i.dueDate) : '',
      amount: String(i.amount),
      paid: i.paid,
    })),
    clauses: (a.clauses ?? []).map((c) => ({
      key: nextKey(),
      title: c.title ?? '',
      body: c.body,
    })),
    clausesAuto: false,
  }
}

function clausesAreBlank(clauses: ClauseDraft[]): boolean {
  return clauses.every((c) => !c.title.trim() && !c.body.trim())
}

function AgreementFormDialog({
  open,
  onOpenChange,
  editing,
  currency,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  editing: AgreementRow | null
  currency: string
  onSaved: () => void
}) {
  const [clients, setClients] = useState<ClientRow[]>([])
  const [clientOpen, setClientOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [form, setForm] = useState<FormState>(defaultForm)

  const setField = useCallback((patch: Partial<FormState>) => {
    setForm((f) => ({ ...f, ...patch }))
  }, [])

  // Load client options + (re)initialize the form each time the dialog opens
  useEffect(() => {
    if (!open) return
    let cancelled = false
    api
      .get<Paginated<ClientRow>>('/api/clients?pageSize=100')
      .then((res) => {
        if (!cancelled) setClients(res.data)
      })
      .catch(() => {
        // free-text fallback still works without the picker
      })
    setForm(editing ? formFromAgreement(editing) : defaultForm())
    return () => {
      cancelled = true
    }
  }, [open, editing])

  const selectedClient = useMemo(
    () => clients.find((c) => c.id === form.clientId) ?? null,
    [clients, form.clientId]
  )

  // ---- live totals -------------------------------------------------------
  const itemsTotal = round2(
    form.items.reduce(
      (s, it) => s + (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0),
      0
    )
  )
  const contractValue =
    form.layoutStyle === 'detailed' ? itemsTotal : round2(Number(form.simpleValue) || 0)
  const installmentsTotal = round2(
    form.installments.reduce((s, i) => s + (Number(i.amount) || 0), 0)
  )
  const installmentsMismatch =
    form.installments.length > 0 && Math.abs(installmentsTotal - contractValue) > 0.005

  // ---- row editors -------------------------------------------------------
  function updateItem(key: string, patch: Partial<ItemDraft>) {
    setForm((f) => ({
      ...f,
      items: f.items.map((it) => (it.key === key ? { ...it, ...patch } : it)),
    }))
  }
  function removeItem(key: string) {
    setForm((f) => ({ ...f, items: f.items.filter((it) => it.key !== key) }))
  }
  function updateInstallment(key: string, patch: Partial<InstallmentDraft>) {
    setForm((f) => ({
      ...f,
      installments: f.installments.map((i) => (i.key === key ? { ...i, ...patch } : i)),
    }))
  }
  function removeInstallment(key: string) {
    setForm((f) => ({ ...f, installments: f.installments.filter((i) => i.key !== key) }))
  }
  function updateClause(key: string, patch: Partial<ClauseDraft>) {
    setForm((f) => ({
      ...f,
      clauses: f.clauses.map((c) => (c.key === key ? { ...c, ...patch } : c)),
      clausesAuto: false,
    }))
  }
  function removeClause(key: string) {
    setForm((f) => ({ ...f, clauses: f.clauses.filter((c) => c.key !== key), clausesAuto: false }))
  }
  function moveClause(index: number, dir: -1 | 1) {
    setForm((f) => {
      const target = index + dir
      if (target < 0 || target >= f.clauses.length) return f
      const clauses = [...f.clauses]
      ;[clauses[index], clauses[target]] = [clauses[target], clauses[index]]
      return { ...f, clauses }
    })
  }

  /** Type change — swap the starter clause templates while they are untouched
   *  (or the editor is empty); once the user has edited clauses they are kept. */
  function handleTypeChange(v: string) {
    const type = asType(v)
    setForm((f) => {
      const auto = f.clausesAuto || clausesAreBlank(f.clauses)
      return {
        ...f,
        type,
        clauses: auto ? clauseTemplates(type) : f.clauses,
        clausesAuto: auto ? true : f.clausesAuto,
      }
    })
  }

  // ---- submit ------------------------------------------------------------
  async function handleSubmit() {
    if (!form.title.trim()) {
      toast.error('Enter the agreement title')
      return
    }
    if (!form.clientName.trim()) {
      toast.error('Enter the client name (Party B)')
      return
    }
    if (!form.startDate) {
      toast.error('Select the start date')
      return
    }
    if (form.endDate && form.endDate < form.startDate) {
      toast.error('End date cannot be before the start date')
      return
    }

    const cleanItems =
      form.layoutStyle === 'detailed'
        ? form.items.filter((it) => it.description.trim())
        : []
    if (form.layoutStyle === 'detailed' && cleanItems.length === 0) {
      toast.error('Add at least one item with a description, or switch to the Simple layout')
      return
    }
    const simpleValue = round2(Number(form.simpleValue) || 0)
    if (form.layoutStyle === 'simple' && !(simpleValue > 0)) {
      toast.error('Enter the contract value (price as per P.O.) for a simple agreement')
      return
    }

    setSubmitting(true)
    try {
      const body = {
        title: form.title.trim(),
        clientId: form.clientId || null,
        clientName: form.clientName.trim(),
        type: form.type,
        layoutStyle: form.layoutStyle,
        startDate: form.startDate,
        endDate: form.endDate || null,
        status: form.status,
        notes: form.notes.trim() || null,
        value: form.layoutStyle === 'simple' ? simpleValue : undefined,
        items: cleanItems.map((it) => ({
          description: it.description.trim(),
          unit: it.unit.trim() || null,
          quantity: Number(it.quantity) || 0,
          unitPrice: Number(it.unitPrice) || 0,
        })),
        installments: form.installments
          .filter((i) => i.label.trim())
          .map((i) => ({
            label: i.label.trim(),
            dueDate: i.dueDate || null,
            amount: Number(i.amount) || 0,
            paid: i.paid,
          })),
        clauses: form.clauses
          .filter((c) => c.body.trim())
          .map((c) => ({ title: c.title.trim() || null, body: c.body.trim() })),
      }
      const res = editing
        ? await api.put<AgreementRow>(`/api/agreements/${editing.id}`, body)
        : await api.post<AgreementRow>('/api/agreements', body)
      toast.success(
        editing
          ? `Agreement ${res.refNumber} updated — ${formatMoney(res.value, currency)}`
          : `Agreement ${res.refNumber} created — ${formatMoney(res.value, currency)} for ${res.clientName}`
      )
      onSaved()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save agreement')
    } finally {
      setSubmitting(false)
    }
  }

  const inputCls = 'h-9'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="nice-scrollbar max-h-[85vh] gap-5 overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSignature className="h-5 w-5 text-muted-foreground" />
            {editing ? `Edit Agreement ${editing.refNumber}` : 'New Agreement'}
          </DialogTitle>
          <DialogDescription>
            {editing
              ? 'Update the agreement header, items, installments or clauses. The contract value is recomputed from the items (detailed layout).'
              : 'A contract between Landmark Inter Gulf LLC (Party A) and the client (Party B). Pick the layout, add items or the P.O. value, installments and clauses.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* ---- Header fields ---- */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="agr-title">Agreement Title</Label>
              <Input
                id="agr-title"
                placeholder="e.g. Manpower supply for Riyadh tower project"
                value={form.title}
                onChange={(e) => setField({ title: e.target.value })}
              />
            </div>

            {/* Client picker */}
            <div className="space-y-2">
              <Label>Client (Party B)</Label>
              <Popover open={clientOpen} onOpenChange={setClientOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    aria-expanded={clientOpen}
                    className="h-10 w-full justify-between font-normal"
                  >
                    <span className="truncate">
                      {selectedClient ? (
                        selectedClient.name
                      ) : (
                        <span className="text-muted-foreground">Pick from saved clients…</span>
                      )}
                    </span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="nice-scrollbar p-0" align="start">
                  <Command shouldFilter={true}>
                    <CommandInput placeholder="Search client name…" />
                    <CommandList>
                      <CommandEmpty>No client found — type the name below instead.</CommandEmpty>
                      <CommandGroup>
                        {clients.map((c) => (
                          <CommandItem
                            key={c.id}
                            value={`${c.name} ${c.contactPerson ?? ''}`}
                            onSelect={() => {
                              setField({ clientId: c.id, clientName: c.name })
                              setClientOpen(false)
                            }}
                          >
                            <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
                              <span className="truncate">{c.name}</span>
                              {c.contactPerson ? (
                                <span className="shrink-0 text-xs text-muted-foreground">
                                  {c.contactPerson}
                                </span>
                              ) : null}
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            {/* Free-text client name (required) */}
            <div className="space-y-2">
              <Label htmlFor="agr-client-name">
                Client Name <span className="text-muted-foreground">(Party B)</span>
              </Label>
              <Input
                id="agr-client-name"
                placeholder="Type freely if not in the list"
                value={form.clientName}
                onChange={(e) => setField({ clientName: e.target.value, clientId: '' })}
              />
              <p className="text-xs text-muted-foreground">
                Typing here detaches the saved-client link — the print uses this name.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Agreement Type</Label>
              <Select value={form.type} onValueChange={handleTypeChange}>
                <SelectTrigger className="h-10 w-full" aria-label="Agreement type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AGREEMENT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {TYPE_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Status</Label>
              <Select
                value={form.status}
                onValueChange={(v) => setField({ status: asStatus(v) })}
              >
                <SelectTrigger className="h-10 w-full" aria-label="Agreement status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AGREEMENT_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {STATUS_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="agr-start">Start Date</Label>
              <Input
                id="agr-start"
                type="date"
                value={form.startDate}
                onChange={(e) => setField({ startDate: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="agr-end">
                End Date <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="agr-end"
                type="date"
                value={form.endDate}
                min={form.startDate || undefined}
                onChange={(e) => setField({ endDate: e.target.value })}
              />
            </div>
          </div>

          {/* ---- Layout style toggle ---- */}
          <div className="space-y-2">
            <Label>Layout Style</Label>
            <div
              className="grid grid-cols-1 gap-1 rounded-lg border bg-muted/40 p-1 sm:grid-cols-2"
              role="group"
              aria-label="Layout style"
            >
              <button
                type="button"
                onClick={() => setField({ layoutStyle: 'detailed' })}
                aria-pressed={form.layoutStyle === 'detailed'}
                className={cn(
                  'flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
                  form.layoutStyle === 'detailed'
                    ? 'bg-card font-medium text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <ReceiptText className="h-4 w-4" />
                Detailed — priced items
              </button>
              <button
                type="button"
                onClick={() => setField({ layoutStyle: 'simple' })}
                aria-pressed={form.layoutStyle === 'simple'}
                className={cn(
                  'flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
                  form.layoutStyle === 'simple'
                    ? 'bg-card font-medium text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <ScrollText className="h-4 w-4" />
                Simple — price as per P.O.
              </button>
            </div>
          </div>

          {/* ---- DETAILED: items editor ---- */}
          {form.layoutStyle === 'detailed' ? (
            <div className="space-y-3 rounded-lg border bg-muted/20 p-3.5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <ReceiptText className="h-4 w-4 text-muted-foreground" />
                  <h4 className="text-sm font-semibold">Scope &amp; Pricing</h4>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5"
                  onClick={() => setForm((f) => ({ ...f, items: [...f.items, newItem()] }))}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add Item
                </Button>
              </div>

              {form.items.length === 0 ? (
                <p className="rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
                  No items — add the first line item.
                </p>
              ) : (
                <div className="space-y-2.5">
                  {form.items.map((it, idx) => {
                    const lineTotal = round2(
                      (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0)
                    )
                    return (
                      <div key={it.key} className="rounded-lg border bg-card p-2.5">
                        <div className="flex items-center gap-2">
                          <span className="w-5 shrink-0 text-center text-xs font-semibold text-muted-foreground tabular-nums">
                            {idx + 1}
                          </span>
                          <Input
                            placeholder="Description (e.g. Supply of riggers)"
                            value={it.description}
                            onChange={(e) => updateItem(it.key, { description: e.target.value })}
                            className={inputCls}
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => removeItem(it.key)}
                            aria-label={`Remove item ${idx + 1}`}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-2 pl-7 sm:grid-cols-4">
                          <div>
                            <Label className="sr-only" htmlFor={`it-unit-${it.key}`}>
                              Unit
                            </Label>
                            <Input
                              id={`it-unit-${it.key}`}
                              placeholder="Unit"
                              value={it.unit}
                              onChange={(e) => updateItem(it.key, { unit: e.target.value })}
                              className={inputCls}
                            />
                          </div>
                          <div>
                            <Label className="sr-only" htmlFor={`it-qty-${it.key}`}>
                              Quantity
                            </Label>
                            <Input
                              id={`it-qty-${it.key}`}
                              type="number"
                              inputMode="decimal"
                              step="any"
                              min={0}
                              placeholder="Qty"
                              value={it.quantity}
                              onChange={(e) => updateItem(it.key, { quantity: e.target.value })}
                              className={inputCls}
                            />
                          </div>
                          <div>
                            <Label className="sr-only" htmlFor={`it-price-${it.key}`}>
                              Unit price
                            </Label>
                            <Input
                              id={`it-price-${it.key}`}
                              type="number"
                              inputMode="decimal"
                              step="any"
                              min={0}
                              placeholder="Unit price"
                              value={it.unitPrice}
                              onChange={(e) => updateItem(it.key, { unitPrice: e.target.value })}
                              className={inputCls}
                            />
                          </div>
                          <div className="flex items-center justify-end gap-1.5 rounded-md border bg-muted/50 px-2.5 py-1.5">
                            <span className="text-xs text-muted-foreground">Line</span>
                            <span className="text-sm font-semibold tabular-nums">
                              {formatMoney(lineTotal, currency)}
                            </span>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 border-t pt-3">
                <span className="text-xs font-medium text-muted-foreground">
                  Contract Value ({form.items.length} item
                  {form.items.length === 1 ? '' : 's'})
                </span>
                <span className="text-base font-bold tabular-nums">
                  {formatMoney(itemsTotal, currency)}
                </span>
              </div>
            </div>
          ) : (
            /* ---- SIMPLE: single value ---- */
            <div className="space-y-3 rounded-lg border bg-muted/20 p-3.5">
              <div className="flex items-center gap-2">
                <ScrollText className="h-4 w-4 text-muted-foreground" />
                <h4 className="text-sm font-semibold">Contract Value</h4>
              </div>
              <div className="sm:max-w-xs">
                <Label htmlFor="agr-simple-value">Contract Value ({currency})</Label>
                <Input
                  id="agr-simple-value"
                  type="number"
                  inputMode="decimal"
                  step={0.01}
                  min={0}
                  placeholder="0.00"
                  value={form.simpleValue}
                  onChange={(e) => setField({ simpleValue: e.target.value })}
                  className="h-10"
                />
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Price as per Purchase Order — no item breakdown for this layout.
                </p>
              </div>
            </div>
          )}

          {/* ---- Installments editor ---- */}
          <div className="space-y-3 rounded-lg border bg-muted/20 p-3.5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Banknote className="h-4 w-4 text-muted-foreground" />
                <h4 className="text-sm font-semibold">Installments</h4>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1.5"
                onClick={() =>
                  setForm((f) => ({ ...f, installments: [...f.installments, newInstallment()] }))
                }
              >
                <Plus className="h-3.5 w-3.5" />
                Add Installment
              </Button>
            </div>

            {form.installments.length === 0 ? (
              <p className="rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
                No installments — add payment milestones (e.g. Advance 30%, Final 70%).
              </p>
            ) : (
              <div className="space-y-2.5">
                {form.installments.map((ins, idx) => (
                  <div key={ins.key} className="rounded-lg border bg-card p-2.5">
                    <div className="flex items-center gap-2">
                      <span className="w-5 shrink-0 text-center text-xs font-semibold text-muted-foreground tabular-nums">
                        {idx + 1}
                      </span>
                      <Input
                        placeholder="Label (e.g. Advance 30%)"
                        value={ins.label}
                        onChange={(e) => updateInstallment(ins.key, { label: e.target.value })}
                        className={inputCls}
                      />
                      <label className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs">
                        <Checkbox
                          checked={ins.paid}
                          onCheckedChange={(v) => updateInstallment(ins.key, { paid: v === true })}
                          aria-label={`Installment ${idx + 1} paid`}
                        />
                        Paid
                      </label>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => removeInstallment(ins.key)}
                        aria-label={`Remove installment ${idx + 1}`}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 pl-7">
                      <div>
                        <Label className="sr-only" htmlFor={`ins-due-${ins.key}`}>
                          Due date
                        </Label>
                        <Input
                          id={`ins-due-${ins.key}`}
                          type="date"
                          value={ins.dueDate}
                          onChange={(e) => updateInstallment(ins.key, { dueDate: e.target.value })}
                          className={inputCls}
                        />
                      </div>
                      <div>
                        <Label className="sr-only" htmlFor={`ins-amt-${ins.key}`}>
                          Amount
                        </Label>
                        <Input
                          id={`ins-amt-${ins.key}`}
                          type="number"
                          inputMode="decimal"
                          step={0.01}
                          min={0}
                          placeholder={`Amount (${currency})`}
                          value={ins.amount}
                          onChange={(e) => updateInstallment(ins.key, { amount: e.target.value })}
                          className={inputCls}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {form.installments.length > 0 ? (
              <div
                className={cn(
                  'flex flex-wrap items-center justify-end gap-x-2 gap-y-1 rounded-md border-t pt-3 text-xs',
                  installmentsMismatch
                    ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300'
                    : 'text-muted-foreground'
                )}
              >
                {installmentsMismatch ? (
                  <span>
                    Installments total {formatMoney(installmentsTotal, currency)} vs value{' '}
                    {formatMoney(contractValue, currency)} — they do not match.
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5">
                    Installments total {formatMoney(installmentsTotal, currency)} — matches the
                    contract value.
                  </span>
                )}
              </div>
            ) : null}
          </div>

          {/* ---- Clauses editor ---- */}
          <div className="space-y-3 rounded-lg border bg-muted/20 p-3.5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <ScrollText className="h-4 w-4 text-muted-foreground" />
                <h4 className="text-sm font-semibold">Clauses</h4>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1.5"
                onClick={() =>
                  setForm((f) => ({
                    ...f,
                    clauses: [...f.clauses, newClause()],
                    clausesAuto: false,
                  }))
                }
              >
                <Plus className="h-3.5 w-3.5" />
                Add Clause
              </Button>
            </div>

            {form.clauses.length === 0 ? (
              <p className="rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
                No clauses — add the contract terms (starter templates appear automatically for a
                new agreement).
              </p>
            ) : (
              <div className="space-y-2.5">
                {form.clauses.map((c, idx) => (
                  <div key={c.key} className="rounded-lg border bg-card p-2.5">
                    <div className="flex items-center gap-1.5">
                      <span className="w-5 shrink-0 text-center text-xs font-semibold text-muted-foreground tabular-nums">
                        {idx + 1}
                      </span>
                      <Input
                        placeholder="Clause title (optional, e.g. Scope of Work)"
                        value={c.title}
                        onChange={(e) => updateClause(c.key, { title: e.target.value })}
                        className={inputCls}
                      />
                      <div className="flex shrink-0 items-center gap-0.5">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground"
                          onClick={() => moveClause(idx, -1)}
                          disabled={idx === 0}
                          aria-label={`Move clause ${idx + 1} up`}
                        >
                          <ArrowUp className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground"
                          onClick={() => moveClause(idx, 1)}
                          disabled={idx === form.clauses.length - 1}
                          aria-label={`Move clause ${idx + 1} down`}
                        >
                          <ArrowDown className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => removeClause(c.key)}
                          aria-label={`Remove clause ${idx + 1}`}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    <div className="pl-6.5">
                      <Textarea
                        placeholder="Clause text…"
                        value={c.body}
                        onChange={(e) => updateClause(c.key, { body: e.target.value })}
                        rows={3}
                        className="mt-2 text-sm"
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ---- Notes ---- */}
          <div className="space-y-2">
            <Label htmlFor="agr-notes">
              Notes <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="agr-notes"
              placeholder="Internal notes, linked P.O. numbers, remarks…"
              value={form.notes}
              onChange={(e) => setField({ notes: e.target.value })}
              rows={2}
              className="text-sm"
            />
          </div>

          {/* ---- Live summary ---- */}
          <div className="rounded-lg border border-[#D4AF37]/60 bg-[#0F1F3D] px-4 py-3 text-white">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-widest text-neutral-300">
                {TYPE_LABELS[form.type]} · {LAYOUT_LABELS[form.layoutStyle]}
              </span>
              <span className="text-lg font-bold tabular-nums">
                {formatMoney(contractValue, currency)}
              </span>
            </div>
            <p className="mt-1 text-xs text-neutral-300">
              {form.layoutStyle === 'detailed'
                ? `${form.items.filter((i) => i.description.trim()).length} item(s) · value recomputed server-side on save`
                : 'Price as per Purchase Order'}
              {form.installments.length > 0
                ? ` · ${form.installments.length} installment(s)`
                : ''}
              {form.clauses.length > 0 ? ` · ${form.clauses.length} clause(s)` : ''}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {editing ? 'Save Changes' : 'Create Agreement'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

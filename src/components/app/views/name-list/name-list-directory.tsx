'use client'

// Name List DIRECTORY tab — company/person directory (the original module, (clients, suppliers, subcontractors
// and other contacts):
//   • clickable per-type KPI cards that filter the list (Clients / Suppliers /
//     Subcontractors / Others)
//   • search (name / contact / phone / email / CR no) + type + status filters
//   • desktop table + mobile stacked cards, add/edit dialog with every field,
//     delete confirmation, CSV export and an A4 print directory
// Role-based: add/edit/delete buttons only appear with namelist.create/edit/delete.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  Building2,
  Calculator,
  Download,
  HardHat,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  Printer,
  Trash2,
  Truck,
  UserRound,
  Users,
  X,
} from 'lucide-react'

import { api, qs } from '@/lib/api-client'
import { ApiError } from '@/lib/api-client'
import { buildCsv, csvFilename, downloadCsv } from '@/lib/csv'
import { can, useAppStore } from '@/lib/store'
import type { NameListEntryRow, Paginated } from '@/lib/types'
import { useDebounce } from '@/hooks/use-debounce'
import { cn } from '@/lib/utils'

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

import { StatusBadge } from '../../shared/status-badge'
import { ConfirmDelete } from '../../shared/confirm-delete'
import { DataTablePagination } from '../../shared/data-table-pagination'
import { EmptyState, TableSkeleton } from '../../shared/empty-state'
import { FilterBar, FilterSelect, SearchInput } from '../../shared/filter-select'
import { PageHeader, SectionCard, MobileFab } from '../../shared/page-header'
import { StatCard } from '../../shared/stat-card'
import { NameListPrintDialog, type NameListTypeCounts } from '../../print/name-list-print'

type NameListResponse = Paginated<NameListEntryRow> & { totals: NameListTypeCounts }

const TYPE_OPTIONS = [
  { value: 'client', label: 'Client' },
  { value: 'supplier', label: 'Supplier' },
  { value: 'subcontractor', label: 'Subcontractor' },
  { value: 'other', label: 'Other' },
]

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
]

function typeLabel(t: string): string {
  return TYPE_OPTIONS.find((o) => o.value === t)?.label ?? t
}

/** Colored type chip — navy clients, teal suppliers, amber subcontractors. */
function TypeBadge({ type }: { type: string }) {
  const styles: Record<string, string> = {
    client:
      'border-navy/25 bg-navy/8 text-primary dark:border-white/20 dark:bg-white/10 dark:text-white',
    supplier:
      'border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-900 dark:bg-teal-950 dark:text-teal-300',
    subcontractor:
      'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300',
    other:
      'border-gray-200 bg-gray-50 text-gray-600 dark:border-gray-800 dark:bg-gray-800/40 dark:text-gray-400',
  }
  return (
    <Badge variant="outline" className={cn('font-medium', styles[type] ?? styles.other)}>
      {typeLabel(type)}
    </Badge>
  )
}

type EntryForm = {
  name: string
  type: string
  contactPerson: string
  phone: string
  email: string
  crNumber: string
  vatNumber: string
  address: string
  city: string
  status: string
  notes: string
}

const EMPTY_FORM: EntryForm = {
  name: '',
  type: 'client',
  contactPerson: '',
  phone: '',
  email: '',
  crNumber: '',
  vatNumber: '',
  address: '',
  city: '',
  status: 'active',
  notes: '',
}

export function NameListDirectoryView() {
  const { user } = useAppStore()
  const canCreate = can(user, 'namelist.create')
  const canEdit = can(user, 'namelist.edit')
  const canDelete = can(user, 'namelist.delete')

  // ---- list state ----
  const [rows, setRows] = useState<NameListEntryRow[]>([])
  const [counts, setCounts] = useState<NameListTypeCounts>({
    client: 0, supplier: 0, subcontractor: 0, other: 0,
  })
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)

  // ---- filters ----
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search)
  const [typeFilter, setTypeFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')

  // ---- add/edit dialog ----
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<NameListEntryRow | null>(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<EntryForm>(EMPTY_FORM)
  const [nameError, setNameError] = useState<string | null>(null)

  // ---- print ----
  const [printOpen, setPrintOpen] = useState(false)
  const [printEntries, setPrintEntries] = useState<NameListEntryRow[]>([])
  const [printCounts, setPrintCounts] = useState<NameListTypeCounts>({
    client: 0, supplier: 0, subcontractor: 0, other: 0,
  })

  // guard against out-of-order list responses
  const requestId = useRef(0)

  function setField<K extends keyof EntryForm>(key: K, value: EntryForm[K]) {
    setForm((f) => ({ ...f, [key]: value }))
    if (key === 'name' || key === 'type') setNameError(null)
  }

  // -----------------------------------------------------------------------
  // Data loading
  // -----------------------------------------------------------------------
  const load = useCallback(async () => {
    const id = ++requestId.current
    setLoading(true)
    try {
      const res = await api.get<NameListResponse>(
        `/api/name-list${qs({
          search: debouncedSearch,
          type: typeFilter === 'all' ? '' : typeFilter,
          status: statusFilter === 'all' ? '' : statusFilter,
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
      setCounts(res.totals ?? { client: 0, supplier: 0, subcontractor: 0, other: 0 })
      setTotal(res.total)
      setTotalPages(res.totalPages)
    } catch (e) {
      if (id !== requestId.current) return
      setRows([])
      setTotal(0)
      setTotalPages(1)
      toast.error(e instanceof Error ? e.message : 'Failed to load the name list')
    } finally {
      if (id === requestId.current) setLoading(false)
    }
  }, [debouncedSearch, typeFilter, statusFilter, page, pageSize])

  useEffect(() => {
    void load()
  }, [load])

  const hasFilters =
    debouncedSearch !== '' || typeFilter !== 'all' || statusFilter !== 'all'

  function resetFilters() {
    setSearch('')
    setTypeFilter('all')
    setStatusFilter('all')
    setPage(1)
  }

  /** Human label of the active filters — reused by the print header. */
  const filterLabel = useMemo(() => {
    const parts: string[] = []
    if (typeFilter !== 'all') parts.push(`${typeLabel(typeFilter)}s`)
    if (statusFilter !== 'all') parts.push(statusFilter)
    if (debouncedSearch !== '') parts.push(`search “${debouncedSearch}”`)
    return parts.length > 0 ? parts.join(' · ') : 'All entries'
  }, [typeFilter, statusFilter, debouncedSearch])

  // -----------------------------------------------------------------------
  // Add / Edit dialog
  // -----------------------------------------------------------------------
  function openAdd() {
    setEditing(null)
    setNameError(null)
    setForm(EMPTY_FORM)
    setDialogOpen(true)
  }

  function openEdit(row: NameListEntryRow) {
    setEditing(row)
    setNameError(null)
    setForm({
      name: row.name,
      type: row.type,
      contactPerson: row.contactPerson ?? '',
      phone: row.phone ?? '',
      email: row.email ?? '',
      crNumber: row.crNumber ?? '',
      vatNumber: row.vatNumber ?? '',
      address: row.address ?? '',
      city: row.city ?? '',
      status: row.status,
      notes: row.notes ?? '',
    })
    setDialogOpen(true)
  }

  async function handleSubmit() {
    const name = form.name.trim()
    if (!name) {
      setNameError('Name is required')
      return
    }
    setSaving(true)
    try {
      const body = {
        name,
        type: form.type,
        contactPerson: form.contactPerson.trim() || null,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        crNumber: form.crNumber.trim() || null,
        vatNumber: form.vatNumber.trim() || null,
        address: form.address.trim() || null,
        city: form.city.trim() || null,
        status: form.status,
        notes: form.notes.trim() || null,
      }
      if (editing) {
        await api.put<NameListEntryRow>(`/api/name-list/${editing.id}`, body)
        toast.success(`"${name}" updated`)
      } else {
        await api.post<NameListEntryRow>('/api/name-list', body)
        toast.success(`"${name}" added to the name list`)
      }
      setDialogOpen(false)
      void load()
    } catch (e) {
      // 409 duplicate (same name + type) → show it on the field itself
      if (e instanceof ApiError && e.status === 409) {
        setNameError(e.message)
        toast.error(e.message)
      } else {
        toast.error(e instanceof Error ? e.message : 'Could not save the entry')
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(row: NameListEntryRow) {
    try {
      await api.del(`/api/name-list/${row.id}`)
      toast.success(`"${row.name}" deleted`)
      void load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not delete the entry')
    }
  }

  // -----------------------------------------------------------------------
  // CSV export + print
  // -----------------------------------------------------------------------
  /** Walk every page of the filtered list (server caps pageSize at 100). */
  async function fetchAllFiltered(): Promise<NameListEntryRow[]> {
    const all: NameListEntryRow[] = []
    let p = 1
    for (;;) {
      const res = await api.get<NameListResponse>(
        `/api/name-list${qs({
          search: debouncedSearch,
          type: typeFilter === 'all' ? '' : typeFilter,
          status: statusFilter === 'all' ? '' : statusFilter,
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
      const entries = await fetchAllFiltered()
      const csv = buildCsv(
        [
          'Name',
          'Type',
          'Contact Person',
          'Phone',
          'Email',
          'CR Number',
          'VAT Number',
          'Address',
          'City',
          'Status',
          'Notes',
        ],
        entries.map((e) => [
          e.name,
          typeLabel(e.type),
          e.contactPerson ?? '',
          e.phone ?? '',
          e.email ?? '',
          e.crNumber ?? '',
          e.vatNumber ?? '',
          e.address ?? '',
          e.city ?? '',
          e.status,
          e.notes ?? '',
        ])
      )
      downloadCsv(csvFilename('name-list'), csv)
      toast.success(`Exported ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} to CSV`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  async function openPrint() {
    try {
      const entries = await fetchAllFiltered()
      setPrintEntries(entries)
      setPrintCounts(counts)
      setPrintOpen(true)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not prepare the print list')
    }
  }

  // Per-type card definitions (clickable → toggles the type filter)
  const typeCards = [
    { value: 'client', label: 'Clients', count: counts.client, icon: Building2, tone: 'navy' as const },
    { value: 'supplier', label: 'Suppliers', count: counts.supplier, icon: Truck, tone: 'teal' as const },
    {
      value: 'subcontractor',
      label: 'Subcontractors',
      count: counts.subcontractor,
      icon: HardHat,
      tone: 'amber' as const,
    },
    { value: 'other', label: 'Others', count: counts.other, icon: Users, tone: 'gold' as const },
  ]

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------
  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      <div className="print-hidden">
        <PageHeader
          title="Directory"
          description="Company directory — clients, suppliers, subcontractors and other contacts."
        >
          <Button
            variant="outline"
            size="sm"
            onClick={() => void openPrint()}
            disabled={loading || total === 0}
          >
            <Printer className="h-4 w-4" />
            Print List
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
              Add Entry
            </Button>
          ) : null}
        </PageHeader>
      </div>

      {canCreate ? <MobileFab label="Add Entry" onClick={openAdd} icon={Plus} /> : null}

      {/* ---- Clickable per-type cards ---- */}
      <div className="print-hidden grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {typeCards.map((card) => {
          const active = typeFilter === card.value
          return (
            <button
              key={card.value}
              type="button"
              onClick={() => {
                setTypeFilter(active ? 'all' : card.value)
                setPage(1)
              }}
              aria-pressed={active}
              className={cn(
                'rounded-xl text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                active && 'ring-2 ring-primary ring-offset-2 ring-offset-background'
              )}
            >
              <StatCard
                title={card.label}
                value={String(card.count)}
                icon={card.icon}
                tone={card.tone}
                sublabel={active ? 'Filtering — tap to clear' : 'Tap to filter'}
              />
            </button>
          )
        })}
      </div>

      {/* ---- Directory list ---- */}
      <SectionCard className="print-hidden overflow-hidden">
        <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div>
            <h2 className="text-base font-semibold">Directory</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {hasFilters ? `Filtered — ${filterLabel}` : 'All entries'} — alphabetical
            </p>
          </div>
          <span className="inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium tabular-nums text-muted-foreground">
            {total} entr{total === 1 ? 'y' : 'ies'}
          </span>
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
                placeholder="Search name, contact, phone, email, CR no…"
                className="w-full sm:w-[260px]"
              />
            }
            activeCount={
              (typeFilter !== 'all' ? 1 : 0) + (statusFilter !== 'all' ? 1 : 0)
            }
          >
            <FilterSelect
              value={typeFilter}
              onChange={(v) => {
                setTypeFilter(v)
                setPage(1)
              }}
              options={TYPE_OPTIONS}
              placeholder="All Types"
              className="sm:w-[160px]"
            />
            <FilterSelect
              value={statusFilter}
              onChange={(v) => {
                setStatusFilter(v)
                setPage(1)
              }}
              options={STATUS_OPTIONS}
              placeholder="All Statuses"
              className="sm:w-[140px]"
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
            icon={UserRound}
            title="No entries found"
            description={
              hasFilters
                ? 'Nothing matches your current filters. Try adjusting them.'
                : 'Add your first client, supplier or subcontractor to build the directory.'
            }
            action={
              canCreate ? (
                <Button size="sm" onClick={openAdd}>
                  <Plus className="h-4 w-4" />
                  Add Entry
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            {/* Desktop: full table */}
            <div className="nice-scrollbar hidden overflow-x-auto md:block">
              <Table className="min-w-[1020px]">
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead>Name</TableHead>
                    <TableHead className="w-[150px]">Type</TableHead>
                    <TableHead className="w-[160px]">Contact Person</TableHead>
                    <TableHead className="w-[130px]">Phone</TableHead>
                    <TableHead className="w-[190px]">Email</TableHead>
                    <TableHead className="w-[120px]">CR No</TableHead>
                    <TableHead className="w-[110px]">City</TableHead>
                    <TableHead className="w-[96px]">Status</TableHead>
                    <TableHead className="w-[96px] text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.id} className="group">
                      <TableCell className="max-w-[240px]">
                        <p className="truncate font-medium" title={row.name}>
                          {row.name}
                        </p>
                        {row.address ? (
                          <p
                            className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground"
                            title={row.address}
                          >
                            <MapPin className="h-3 w-3 shrink-0" />
                            {row.address}
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <TypeBadge type={row.type} />
                        {row.vatNumber ? (
                          <p className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
                            VAT: {row.vatNumber}
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {row.contactPerson ?? <span className="italic">—</span>}
                      </TableCell>
                      <TableCell className="tabular-nums text-muted-foreground">
                        {row.phone ?? <span className="italic">—</span>}
                      </TableCell>
                      <TableCell className="max-w-[190px] truncate text-muted-foreground">
                        {row.email ?? <span className="italic">—</span>}
                      </TableCell>
                      <TableCell className="tabular-nums text-muted-foreground">
                        {row.crNumber ?? <span className="italic">—</span>}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {row.city ?? <span className="italic">—</span>}
                      </TableCell>
                      <TableCell>
                        {row.status === 'active' ? (
                          <StatusBadge kind="active" label="Active" />
                        ) : (
                          <StatusBadge kind="inactive" label="Inactive" />
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-0.5">
                          {canEdit ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-foreground"
                              onClick={() => openEdit(row)}
                              aria-label={`Edit ${row.name}`}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          ) : null}
                          {canDelete ? (
                            <ConfirmDelete
                              onConfirm={() => void handleDelete(row)}
                              title="Delete name list entry?"
                              description={`"${row.name}" (${typeLabel(row.type)}) will be permanently removed from the directory.`}
                            />
                          ) : null}
                        </div>
                      </TableCell>
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
                      <p className="truncate font-semibold" title={row.name}>
                        {row.name}
                      </p>
                      <div className="mt-1">
                        <TypeBadge type={row.type} />
                      </div>
                    </div>
                    {row.status === 'active' ? (
                      <StatusBadge kind="active" label="Active" />
                    ) : (
                      <StatusBadge kind="inactive" label="Inactive" />
                    )}
                  </div>
                  <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                    {row.contactPerson ? (
                      <p className="flex items-center gap-1.5">
                        <UserRound className="h-3 w-3 shrink-0" />
                        {row.contactPerson}
                      </p>
                    ) : null}
                    {row.phone ? (
                      <p className="flex items-center gap-1.5 tabular-nums">
                        <Phone className="h-3 w-3 shrink-0" />
                        {row.phone}
                      </p>
                    ) : null}
                    {row.email ? (
                      <p className="flex items-center gap-1.5 truncate">
                        <Mail className="h-3 w-3 shrink-0" />
                        {row.email}
                      </p>
                    ) : null}
                    {(row.city || row.crNumber) && (
                      <p className="flex items-center gap-1.5">
                        <MapPin className="h-3 w-3 shrink-0" />
                        {[row.city, row.crNumber ? `CR ${row.crNumber}` : null]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    )}
                  </div>
                  {canEdit || canDelete ? (
                    <div className="mt-2 flex items-center justify-end gap-0.5 border-t pt-2">
                      {canEdit ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-foreground"
                          onClick={() => openEdit(row)}
                          aria-label={`Edit ${row.name}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      ) : null}
                      {canDelete ? (
                        <ConfirmDelete
                          onConfirm={() => void handleDelete(row)}
                          title="Delete name list entry?"
                          description={`"${row.name}" will be permanently removed.`}
                        />
                      ) : null}
                    </div>
                  ) : null}
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
            unit="entries"
          />
        </div>
      </SectionCard>

      {/* ---- Add / Edit dialog ---- */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="nice-scrollbar max-h-[90vh] overflow-y-auto sm:max-w-[620px]">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Name List Entry' : 'Add Name List Entry'}</DialogTitle>
            <DialogDescription>
              {editing
                ? 'Update the directory entry.'
                : 'Register a client, supplier, subcontractor or other contact.'}
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
                <Label htmlFor="nl-name">
                  Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="nl-name"
                  value={form.name}
                  onChange={(e) => setField('name', e.target.value)}
                  placeholder="e.g. Saudi Industrial Supplies Co."
                  required
                  aria-invalid={Boolean(nameError)}
                  aria-describedby={nameError ? 'nl-name-error' : undefined}
                />
                {nameError ? (
                  <p id="nl-name-error" className="text-xs font-medium text-destructive">
                    {nameError}
                  </p>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="nl-type">Type</Label>
                <Select value={form.type} onValueChange={(v) => setField('type', v)}>
                  <SelectTrigger id="nl-type" className="w-full" aria-label="Type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TYPE_OPTIONS.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="nl-contact">Contact Person</Label>
                <Input
                  id="nl-contact"
                  value={form.contactPerson}
                  onChange={(e) => setField('contactPerson', e.target.value)}
                  placeholder="e.g. Eng. Khalid Al-Harbi"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="nl-phone">Phone</Label>
                <Input
                  id="nl-phone"
                  value={form.phone}
                  onChange={(e) => setField('phone', e.target.value)}
                  placeholder="e.g. +966 13 123 4567"
                  className="tabular-nums"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="nl-email">Email</Label>
                <Input
                  id="nl-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setField('email', e.target.value)}
                  placeholder="e.g. info@company.com"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="nl-city">City</Label>
                <Input
                  id="nl-city"
                  value={form.city}
                  onChange={(e) => setField('city', e.target.value)}
                  placeholder="e.g. Jubail"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="nl-cr">CR Number</Label>
                <Input
                  id="nl-cr"
                  value={form.crNumber}
                  onChange={(e) => setField('crNumber', e.target.value)}
                  placeholder="e.g. 2050123456"
                  className="tabular-nums"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="nl-vat">VAT Number</Label>
                <Input
                  id="nl-vat"
                  value={form.vatNumber}
                  onChange={(e) => setField('vatNumber', e.target.value)}
                  placeholder="e.g. 300012345600003"
                  className="tabular-nums"
                />
              </div>

              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="nl-address">Address</Label>
                <Input
                  id="nl-address"
                  value={form.address}
                  onChange={(e) => setField('address', e.target.value)}
                  placeholder="Street, building, district…"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="nl-status">Status</Label>
                <Select value={form.status} onValueChange={(v) => setField('status', v)}>
                  <SelectTrigger id="nl-status" className="w-full" aria-label="Status">
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
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="nl-notes">Notes</Label>
                <Textarea
                  id="nl-notes"
                  value={form.notes}
                  onChange={(e) => setField('notes', e.target.value)}
                  placeholder="Optional — remarks about this company or person"
                  rows={2}
                />
              </div>
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'Saving…' : editing ? 'Save Changes' : 'Add Entry'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ---- Print report ---- */}
      <NameListPrintDialog
        open={printOpen}
        onOpenChange={setPrintOpen}
        entries={printEntries}
        counts={printCounts}
        filterLabel={filterLabel}
      />
    </div>
  )
}

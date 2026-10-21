'use client'

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  Building2,
  Download,
  Eye,
  FileText,
  Hash,
  Landmark,
  Loader2,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  RotateCcw,
  User,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
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
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { AvatarInitials } from '@/components/app/shared/avatar-initials'
import { ConfirmDelete } from '@/components/app/shared/confirm-delete'
import { DataTablePagination } from '@/components/app/shared/data-table-pagination'
import { EmptyState, TableSkeleton } from '@/components/app/shared/empty-state'
import { FilterBar, FilterSelect, SearchInput } from '@/components/app/shared/filter-select'
import { MobileFab, PageHeader, SectionCard } from '@/components/app/shared/page-header'
import { CategoryChip, StatusBadge } from '@/components/app/shared/status-badge'
import { useDebounce } from '@/hooks/use-debounce'
import { useViewIntent, useViewRecordIntent } from '@/hooks/use-view-intent'
import { api, qs } from '@/lib/api-client'
import { buildCsv, csvFilename, downloadCsv } from '@/lib/csv'
import { formatDate, formatMoney } from '@/lib/format'
import { can, useAppStore } from '@/lib/store'
import type { Client, ClientRow, ClientStatus, Paginated } from '@/lib/types'
import { ClientNameLists } from './client-name-lists'

type ClientForm = {
  name: string
  nameAr: string
  contactPerson: string
  phone: string
  email: string
  city: string
  address: string
  addressAr: string
  crNumber: string
  vatNumber: string
  bankName: string
  iban: string
  accountNumber: string
  swiftCode: string
  status: ClientStatus
  notes: string
}

const EMPTY_FORM: ClientForm = {
  name: '',
  nameAr: '',
  contactPerson: '',
  phone: '',
  email: '',
  city: '',
  address: '',
  addressAr: '',
  crNumber: '',
  vatNumber: '',
  bankName: '',
  iban: '',
  accountNumber: '',
  swiftCode: '',
  status: 'active',
  notes: '',
}

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
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

/** KPI tile (same visual language as the projects portfolio header) */
function KpiTile({
  icon: Icon,
  label,
  value,
  sub,
  children,
}: {
  icon: LucideIcon
  label: string
  value: string
  sub: string
  children?: ReactNode
}) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm sm:p-5">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="mt-1.5 flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xl font-bold tabular-nums sm:text-2xl">{value}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{sub}</p>
        </div>
        {children}
      </div>
    </div>
  )
}

export function ClientsView() {
  const { user, settings } = useAppStore()
  const currency = settings.currency
  const canCreate = can(user, 'clients.create')
  const canEdit = can(user, 'clients.edit')
  const canDelete = can(user, 'clients.delete')
  const canViewFinancials = can(user, 'accounts.view')

  // List state
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search)
  const [status, setStatus] = useState('all')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [data, setData] = useState<Paginated<ClientRow> | null>(null)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)

  // Form dialog state
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<ClientRow | null>(null)
  const [form, setForm] = useState<ClientForm>(EMPTY_FORM)
  const [errors, setErrors] = useState<{ name?: string; vatNumber?: string }>({})
  const [submitting, setSubmitting] = useState(false)

  // Detail dialog state
  const [viewOpen, setViewOpen] = useState(false)
  const [viewLoading, setViewLoading] = useState(false)
  const [client, setClient] = useState<Client | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get<Paginated<ClientRow>>(
        `/api/clients${qs({
          search: debouncedSearch,
          status: status === 'all' ? '' : status,
          page,
          pageSize,
        })}`
      )
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

  function resetFilters() {
    setSearch('')
    setStatus('all')
    setPage(1)
  }

  function openCreate() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setErrors({})
    setFormOpen(true)
  }

  // Deep-open create dialog when arriving via the command palette
  const shouldOpenCreate = useViewIntent('clients', 'create')
  useEffect(() => {
    if (shouldOpenCreate) openCreate()
  }, [shouldOpenCreate])

  // Deep-open a client detail when arriving via the palette record search
  const recordIntent = useViewRecordIntent('clients')
  useEffect(() => {
    if (!recordIntent.matched || !recordIntent.recordId) return
    void openView(recordIntent.recordId)
  }, [recordIntent.matched, recordIntent.recordId])

  function openEdit(row: ClientRow) {
    setEditing(row)
    setForm({
      name: row.name,
      nameAr: row.nameAr ?? '',
      contactPerson: row.contactPerson ?? '',
      phone: row.phone ?? '',
      email: row.email ?? '',
      city: row.city ?? '',
      address: row.address ?? '',
      addressAr: row.addressAr ?? '',
      crNumber: row.crNumber ?? '',
      vatNumber: row.vatNumber ?? '',
      bankName: row.bankName ?? '',
      iban: row.iban ?? '',
      accountNumber: row.accountNumber ?? '',
      swiftCode: row.swiftCode ?? '',
      status: row.status,
      notes: row.notes ?? '',
    })
    setErrors({})
    setFormOpen(true)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const nextErrors: { name?: string; vatNumber?: string } = {}
    if (!form.name.trim()) nextErrors.name = 'Client name is required'
    const vat = form.vatNumber.replace(/[\s-]/g, '')
    if (vat && !/^\d{15}$/.test(vat)) {
      nextErrors.vatNumber = 'VAT number must be exactly 15 digits (e.g. 3xxxxxxxxxxxxx3)'
    }
    setErrors(nextErrors)
    if (nextErrors.name || nextErrors.vatNumber) return

    try {
      setSubmitting(true)
      const body = {
        name: form.name.trim(),
        nameAr: form.nameAr.trim(),
        contactPerson: form.contactPerson.trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
        city: form.city.trim(),
        address: form.address.trim(),
        addressAr: form.addressAr.trim(),
        crNumber: form.crNumber.trim(),
        vatNumber: vat,
        bankName: form.bankName.trim(),
        iban: form.iban.replace(/\s/g, ''),
        accountNumber: form.accountNumber.trim(),
        swiftCode: form.swiftCode.replace(/\s/g, '').toUpperCase(),
        status: form.status,
        notes: form.notes.trim(),
      }
      if (editing) {
        await api.put(`/api/clients/${editing.id}`, body)
        toast.success('Client updated')
      } else {
        await api.post('/api/clients', body)
        toast.success('Client created')
      }
      setFormOpen(false)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSubmitting(false)
    }
  }

  async function openView(id: string) {
    setViewOpen(true)
    setViewLoading(true)
    setClient(null)
    try {
      const res = await api.get<Client>(`/api/clients/${id}`)
      setClient(res)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Something went wrong')
      setViewOpen(false)
    } finally {
      setViewLoading(false)
    }
  }

  async function handleDelete(row: ClientRow) {
    try {
      await api.del(`/api/clients/${row.id}`)
      toast.success('Client deleted')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Something went wrong')
    }
  }

  /** CSV export walking all pages with the current filters (same pattern as staff list) */
  async function exportCsv() {
    setExporting(true)
    try {
      const all: ClientRow[] = []
      let p = 1
      for (;;) {
        const res = await api.get<Paginated<ClientRow>>(
          `/api/clients${qs({
            search: debouncedSearch,
            status: status === 'all' ? '' : status,
            page: p,
            pageSize: 100,
          })}`
        )
        all.push(...res.data)
        if (p >= res.totalPages) break
        p++
      }
      downloadCsv(
        csvFilename('clients'),
        buildCsv(
          ['Client Name', 'Name (Arabic)', 'Contact Person', 'Phone', 'Email', 'City', 'Address', 'Address (Arabic)', 'CR Number', 'VAT Number', 'Bank', 'IBAN', 'Account Number', 'SWIFT', 'Status', 'Projects', 'Deployed Workers', 'Notes', 'Created'],
          all.map((c) => [
            c.name,
            c.nameAr ?? '',
            c.contactPerson ?? '',
            c.phone ?? '',
            c.email ?? '',
            c.city ?? '',
            c.address ?? '',
            c.addressAr ?? '',
            c.crNumber ?? '',
            c.vatNumber ?? '',
            c.bankName ?? '',
            c.iban ?? '',
            c.accountNumber ?? '',
            c.swiftCode ?? '',
            c.status,
            c.projectCount,
            c.deployedWorkers,
            c.notes ?? '',
            formatDate(c.createdAt),
          ])
        )
      )
      toast.success(`Exported ${all.length} client${all.length === 1 ? '' : 's'} to CSV`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title="Client Management"
        description="Companies we supply workforce to — contacts, projects and deployed workers"
      >
        {canCreate ? (
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" />
            New Client
          </Button>
        ) : null}
      </PageHeader>

      {canCreate ? (
        <MobileFab label="New Client" onClick={openCreate} icon={Plus} />
      ) : null}

      {/* KPI header (company-wide, independent of table filters) */}
      {data?.totals ? (
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          <KpiTile
            icon={Building2}
            label="Total Clients"
            value={data.total.toLocaleString()}
            sub={`${data.totals.active ?? 0} active · ${data.totals.inactive ?? 0} inactive`}
          />
          <KpiTile
            icon={FileText}
            label="Linked Projects"
            value={(data.totals.projectCount ?? 0).toLocaleString()}
            sub="projects with a client"
          />
          <KpiTile
            icon={Users}
            label="Workers Deployed"
            value={(data.totals.assignments ?? 0).toLocaleString()}
            sub="worker assignments"
          />
          <KpiTile
            icon={Building2}
            label="Client Coverage"
            value={`${data.totals.clientCount ? Math.round(((data.totals.projectCount ?? 0) / data.totals.clientCount) * 10) / 10 : 0}`}
            sub="avg projects / client"
          />
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
                }}
                placeholder="Search clients, contacts, cities..."
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
              }}
              options={STATUS_OPTIONS}
              placeholder="Status"
            />
            <Button
              variant="outline"
              size="sm"
              className="h-9"
              onClick={() => void exportCsv()}
              disabled={exporting || (data?.total ?? 0) === 0}
            >
              {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Export CSV
            </Button>
            {isFiltered ? (
              <Button variant="ghost" size="sm" className="h-9" onClick={resetFilters}>
                <RotateCcw className="h-4 w-4" />
                Clear
              </Button>
            ) : null}
          </FilterBar>
        </div>

        {/* Desktop table */}
        {loading && !data ? (
          <div className="hidden md:block">
            <TableSkeleton rows={6} cols={7} />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Building2}
            title="No clients found"
            description={
              isFiltered
                ? 'Try adjusting or clearing the filters to see more results.'
                : 'Get started by creating your first client company.'
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
                  New Client
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="hidden overflow-x-auto md:block">
            <Table className="min-w-[900px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Client Company</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-center">Projects</TableHead>
                  <TableHead className="text-center">Workers</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                          <Building2 className="h-4 w-4 text-primary" />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-semibold">{row.name}</p>
                          {row.nameAr ? (
                            <p lang="ar" dir="rtl" className="truncate text-xs text-muted-foreground">
                              {row.nameAr}
                            </p>
                          ) : null}
                          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                            {row.vatNumber ? (
                              <span className="rounded border border-emerald-200 bg-emerald-50 px-1.5 py-px font-mono text-[10px] font-semibold tabular-nums text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
                                VAT {row.vatNumber}
                              </span>
                            ) : null}
                            {row.crNumber ? (
                              <span className="text-xs text-muted-foreground">CR {row.crNumber}</span>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {row.contactPerson || row.phone ? (
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <AvatarInitials name={row.contactPerson ?? row.name} size="sm" />
                            <span className="truncate">{row.contactPerson ?? '—'}</span>
                          </div>
                          {row.phone ? (
                            <p className="mt-0.5 pl-9 text-xs tabular-nums text-muted-foreground">{row.phone}</p>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {row.city || row.address ? (
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                          <MapPin className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">{row.city ?? row.address}</span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusBadge kind={row.status} />
                    </TableCell>
                    <TableCell className="text-center">
                      <span className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-xs font-semibold tabular-nums">
                        <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                        {row.projectCount}
                      </span>
                    </TableCell>
                    <TableCell className="text-center">
                      <span className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-xs font-semibold tabular-nums">
                        <Users className="h-3.5 w-3.5 text-muted-foreground" />
                        {row.deployedWorkers}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => void openView(row.id)}
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
                            title="Delete client?"
                            description={
                              row.projectCount > 0
                                ? 'This client has linked projects and cannot be deleted yet. Unlink the projects first.'
                                : 'This will permanently remove the client. This action cannot be undone.'
                            }
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

        {/* Mobile cards */}
        {loading && !data ? (
          <div className="space-y-3 p-4 md:hidden">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-28 w-full" />
            ))}
          </div>
        ) : rows.length > 0 ? (
          <div className="space-y-3 p-4 md:hidden">
            {rows.map((row) => (
              <div
                key={row.id}
                className="rounded-xl border bg-card p-4 shadow-sm"
                style={{ borderLeftWidth: 4, borderLeftColor: row.status === 'active' ? 'var(--primary)' : '#9ca3af' }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                      <Building2 className="h-4 w-4 text-primary" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{row.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {row.city ?? '—'}
                        {row.contactPerson ? ` · ${row.contactPerson}` : ''}
                      </p>
                    </div>
                  </div>
                  <StatusBadge kind={row.status} />
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-xs font-semibold tabular-nums">
                    <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                    {row.projectCount} project{row.projectCount === 1 ? '' : 's'}
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-xs font-semibold tabular-nums">
                    <Users className="h-3.5 w-3.5 text-muted-foreground" />
                    {row.deployedWorkers} worker{row.deployedWorkers === 1 ? '' : 's'}
                  </span>
                  {row.phone ? (
                    <span className="inline-flex items-center gap-1 text-xs tabular-nums text-muted-foreground">
                      <Phone className="h-3 w-3" />
                      {row.phone}
                    </span>
                  ) : null}
                </div>
                <div className="mt-3 flex items-center justify-end gap-1">
                  <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => void openView(row.id)} aria-label={`View ${row.name}`}>
                    <Eye className="h-4 w-4" />
                  </Button>
                  {canEdit ? (
                    <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => openEdit(row)} aria-label={`Edit ${row.name}`}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                  ) : null}
                  {canDelete ? (
                    <ConfirmDelete
                      title="Delete client?"
                      description="This will permanently remove the client. This action cannot be undone."
                      onConfirm={() => handleDelete(row)}
                      triggerClassName="h-9 w-9"
                    />
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {/* Pagination */}
        {data && data.total > 0 ? (
          <DataTablePagination
            page={data.page}
            pageSize={data.pageSize}
            total={data.total}
            totalPages={data.totalPages}
            onPageChange={setPage}
            onPageSizeChange={(s) => {
              setPageSize(s)
              setPage(1)
            }}
            unit="clients"
          />
        ) : null}
      </SectionCard>

      {/* New / Edit dialog */}
      <Dialog open={formOpen} onOpenChange={(open) => setFormOpen(open)}>
        <DialogContent className="nice-scrollbar max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Client' : 'New Client'}</DialogTitle>
            <DialogDescription>
              {editing
                ? 'Update the client company details below.'
                : 'Add a client company that receives our workforce.'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div className="space-y-2">
              <Label htmlFor="client-name">
                Company Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="client-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Gulf Crescent Contracting Co."
                autoFocus
                aria-invalid={!!errors.name}
              />
              {errors.name ? <p className="text-xs text-destructive">{errors.name}</p> : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="client-name-ar">
                Company Name — <span lang="ar" dir="rtl">الاسم بالعربية</span>
              </Label>
              <Input
                id="client-name-ar"
                lang="ar"
                dir="rtl"
                value={form.nameAr}
                onChange={(e) => setForm((f) => ({ ...f, nameAr: e.target.value }))}
                placeholder="e.g. شركة الهلال الخليج للمقاولات"
              />
              <p className="text-xs text-muted-foreground">
                Printed bilingually on ZATCA tax invoices and agreements.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="client-contact">Contact Person</Label>
                <Input
                  id="client-contact"
                  value={form.contactPerson}
                  onChange={(e) => setForm((f) => ({ ...f, contactPerson: e.target.value }))}
                  placeholder="e.g. Bandar Al-Suwailem"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="client-phone">Phone</Label>
                <Input
                  id="client-phone"
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  placeholder="+966 13 847 2200"
                  inputMode="tel"
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="client-email">Email</Label>
                <Input
                  id="client-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  placeholder="projects@company.sa"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="client-city">City</Label>
                <Input
                  id="client-city"
                  value={form.city}
                  onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
                  placeholder="e.g. Dammam"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="client-address">Address</Label>
              <Input
                id="client-address"
                value={form.address}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                placeholder="Street / district"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="client-address-ar">
                Address — <span lang="ar" dir="rtl">العنوان بالعربية</span>
              </Label>
              <Input
                id="client-address-ar"
                lang="ar"
                dir="rtl"
                value={form.addressAr}
                onChange={(e) => setForm((f) => ({ ...f, addressAr: e.target.value }))}
                placeholder="الشارع / الحي"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="client-cr">CR Number</Label>
                <Input
                  id="client-cr"
                  value={form.crNumber}
                  onChange={(e) => setForm((f) => ({ ...f, crNumber: e.target.value }))}
                  placeholder="Commercial registration"
                  inputMode="numeric"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="client-vat">VAT Number</Label>
                <Input
                  id="client-vat"
                  value={form.vatNumber}
                  onChange={(e) => setForm((f) => ({ ...f, vatNumber: e.target.value }))}
                  placeholder="3XXXXXXXXXXXXX3"
                  inputMode="numeric"
                  className="font-mono"
                  aria-invalid={!!errors.vatNumber}
                />
                {errors.vatNumber ? (
                  <p className="text-xs text-destructive">{errors.vatNumber}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    15 digits — required on B2B tax invoices.
                  </p>
                )}
              </div>
            </div>

            {/* ---- Bank account ---- */}
            <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
              <div className="flex items-center gap-2">
                <Landmark className="h-4 w-4 text-muted-foreground" />
                <p className="text-sm font-semibold">Bank Account</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="client-bank">Bank Name</Label>
                  <Input
                    id="client-bank"
                    value={form.bankName}
                    onChange={(e) => setForm((f) => ({ ...f, bankName: e.target.value }))}
                    placeholder="e.g. Saudi National Bank"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="client-iban">IBAN</Label>
                  <Input
                    id="client-iban"
                    value={form.iban}
                    onChange={(e) => setForm((f) => ({ ...f, iban: e.target.value }))}
                    placeholder="SA00 0000 0000 0000 0000 0000"
                    className="font-mono"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="client-account">Account Number</Label>
                  <Input
                    id="client-account"
                    value={form.accountNumber}
                    onChange={(e) => setForm((f) => ({ ...f, accountNumber: e.target.value }))}
                    placeholder="00000000000000"
                    className="font-mono"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="client-swift">SWIFT Code</Label>
                  <Input
                    id="client-swift"
                    value={form.swiftCode}
                    onChange={(e) => setForm((f) => ({ ...f, swiftCode: e.target.value }))}
                    placeholder="NCBKSAJE"
                    className="font-mono"
                  />
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="client-status">Status</Label>
              <Select
                value={form.status}
                onValueChange={(v) => setForm((f) => ({ ...f, status: v as ClientStatus }))}
              >
                <SelectTrigger id="client-status" className="w-full">
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
            <div className="space-y-2">
              <Label htmlFor="client-notes">Notes</Label>
              <Textarea
                id="client-notes"
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="Contract terms, invoicing requirements, remarks…"
                rows={3}
              />
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={() => setFormOpen(false)} disabled={submitting}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {editing ? 'Save Changes' : 'Create Client'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Detail dialog */}
      <Dialog open={viewOpen} onOpenChange={setViewOpen}>
        <DialogContent className="nice-scrollbar max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          {viewLoading || !client ? (
            <>
              {/* Keep Radix a11y happy while the detail loads (sr-only title/description) */}
              <DialogHeader className="sr-only">
                <DialogTitle>Loading client details</DialogTitle>
                <DialogDescription>Fetching client projects and deployed workers.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <Skeleton className="h-8 w-64" />
                <div className="grid gap-3 sm:grid-cols-2">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-16 w-full" />
                  ))}
                </div>
                <Skeleton className="h-24 w-full" />
              </div>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2.5 pr-6">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <Building2 className="h-4 w-4 text-primary" />
                  </span>
                  <span className="truncate">{client.name}</span>
                </DialogTitle>
                <DialogDescription>Client details, projects and deployed workforce.</DialogDescription>
              </DialogHeader>

              <div className="grid gap-3 sm:grid-cols-2">
                <DetailItem icon={User} label="Contact Person">
                  <span className="flex items-center gap-2">
                    <AvatarInitials name={client.contactPerson ?? client.name} size="sm" />
                    <span className="truncate">{client.contactPerson ?? '—'}</span>
                  </span>
                </DetailItem>
                <DetailItem icon={Phone} label="Phone">
                  {client.phone ? (
                    <a href={`tel:${client.phone.replace(/\s+/g, '')}`} className="tabular-nums hover:underline">
                      {client.phone}
                    </a>
                  ) : (
                    '—'
                  )}
                </DetailItem>
                <DetailItem icon={Mail} label="Email">
                  {client.email ? (
                    <a href={`mailto:${client.email}`} className="truncate hover:underline">
                      {client.email}
                    </a>
                  ) : (
                    '—'
                  )}
                </DetailItem>
                <DetailItem icon={MapPin} label="Location">
                  {client.city || client.address ? (
                    <span className="truncate">
                      {[client.city, client.address].filter(Boolean).join(', ')}
                    </span>
                  ) : (
                    '—'
                  )}
                </DetailItem>
                {client.nameAr ? (
                  <DetailItem icon={Building2} label="Company Name — العربية">
                    <span lang="ar" dir="rtl" className="truncate">
                      {client.nameAr}
                    </span>
                  </DetailItem>
                ) : null}
                {client.addressAr ? (
                  <DetailItem icon={MapPin} label="Address — العربية">
                    <span lang="ar" dir="rtl" className="truncate">
                      {client.addressAr}
                    </span>
                  </DetailItem>
                ) : null}
                <DetailItem icon={Hash} label="CR Number">
                  {client.crNumber ?? '—'}
                </DetailItem>
                <DetailItem icon={Hash} label="VAT Number">
                  {client.vatNumber ? (
                    <span className="font-mono tabular-nums">{client.vatNumber}</span>
                  ) : (
                    '—'
                  )}
                </DetailItem>
                <DetailItem icon={Building2} label="Status">
                  <StatusBadge kind={client.status} />
                </DetailItem>
              </div>

              {client.bankName || client.iban || client.accountNumber ? (
                <div className="rounded-lg border bg-muted/30 p-3">
                  <div className="flex items-center gap-2">
                    <Landmark className="h-4 w-4 text-muted-foreground" />
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Bank Account
                    </p>
                  </div>
                  <div className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                    {client.bankName ? (
                      <p>
                        <span className="text-muted-foreground">Bank:</span>{' '}
                        <span className="font-medium">{client.bankName}</span>
                      </p>
                    ) : null}
                    {client.iban ? (
                      <p className="truncate">
                        <span className="text-muted-foreground">IBAN:</span>{' '}
                        <span className="font-mono">{client.iban}</span>
                      </p>
                    ) : null}
                    {client.accountNumber ? (
                      <p>
                        <span className="text-muted-foreground">Account:</span>{' '}
                        <span className="font-mono">{client.accountNumber}</span>
                      </p>
                    ) : null}
                    {client.swiftCode ? (
                      <p>
                        <span className="text-muted-foreground">SWIFT:</span>{' '}
                        <span className="font-mono">{client.swiftCode}</span>
                      </p>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {client.notes ? (
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground">Notes</p>
                  <p className="mt-0.5 whitespace-pre-line text-sm">{client.notes}</p>
                </div>
              ) : null}

              <Separator />

              {/* Projects */}
              <div>
                <h3 className="mb-1 text-sm font-semibold">
                  Projects
                  <span className="ml-1.5 text-muted-foreground tabular-nums">({client.projects.length})</span>
                </h3>
                {client.projects.length > 0 ? (
                  <ul className="space-y-2">
                    {client.projects.map((p) => (
                      <li key={p.id} className="flex items-center gap-3 rounded-lg border bg-muted/20 px-3 py-2.5">
                        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{p.name}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {p.location ?? '—'} · {p.managerName}
                          </p>
                        </div>
                        {canViewFinancials && (p.income !== 0 || p.expense !== 0) ? (
                          <span
                            className={`shrink-0 text-xs font-semibold tabular-nums ${
                              p.income - p.expense >= 0
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : 'text-rose-700 dark:text-rose-400'
                            }`}
                          >
                            {formatMoney(p.income - p.expense, currency)}
                          </span>
                        ) : null}
                        <StatusBadge kind={p.status} className="shrink-0" />
                        <span className="shrink-0 rounded-md bg-muted px-2 py-1 text-xs font-semibold tabular-nums">
                          {p.staffCount}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="rounded-lg border border-dashed p-3 text-center text-xs text-muted-foreground">
                    No projects linked to this client yet. Link a project from Project Management.
                  </p>
                )}
              </div>

              <Separator />

              {/* Name Lists — every list this company has, grouped by date */}
              <ClientNameLists clientId={client.id} />

              {/* Deployed workers */}
              <div>
                <h3 className="mb-1 text-sm font-semibold">
                  Deployed Workers
                  <span className="ml-1.5 text-muted-foreground tabular-nums">({client.workers.length})</span>
                </h3>
                {client.workers.length > 0 ? (
                  <ul className="nice-scrollbar max-h-80 divide-y overflow-y-auto">
                    {client.workers.map((w) => (
                      <li key={`${w.id}-${w.projectId}`} className="flex items-center gap-3 py-2.5">
                        <AvatarInitials name={w.fullName} src={w.profilePhoto} size="sm" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{w.fullName}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            IQAMA {w.iqamaId}
                            {w.position ? ` · ${w.position}` : ''}
                          </p>
                        </div>
                        {w.categoryName ? (
                          <CategoryChip label={w.categoryName} className="hidden sm:inline-flex" />
                        ) : null}
                        {w.projectName ? (
                          <span className="hidden max-w-[140px] shrink-0 truncate text-xs text-muted-foreground lg:inline">
                            {w.projectName}
                          </span>
                        ) : null}
                        <span className="shrink-0 text-xs font-semibold tabular-nums text-muted-foreground">
                          {formatMoney(w.ratePerHour, currency)}/hr
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState
                    icon={Users}
                    title="No workers deployed"
                    description="Assign staff to this client's projects to see them here."
                    className="py-8"
                  />
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

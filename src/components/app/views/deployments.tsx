'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Building2,
  ChevronRight,
  Download,
  FileText,
  Loader2,
  MapPin,
  Network,
  RotateCcw,
  UserX,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { AvatarInitials } from '@/components/app/shared/avatar-initials'
import { DataTablePagination } from '@/components/app/shared/data-table-pagination'
import { EmptyState, TableSkeleton } from '@/components/app/shared/empty-state'
import { FilterBar, FilterSelect, SearchInput } from '@/components/app/shared/filter-select'
import { PageHeader, SectionCard } from '@/components/app/shared/page-header'
import { CategoryChip, StatusBadge } from '@/components/app/shared/status-badge'
import { useDebounce } from '@/hooks/use-debounce'
import { api, qs } from '@/lib/api-client'
import { buildCsv, csvFilename, downloadCsv } from '@/lib/csv'
import { formatMoney } from '@/lib/format'
import { useAppStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import type {
  ClientDeploymentGroup,
  ClientRow,
  DeploymentTotals,
  Paginated,
  ProjectRow,
  StaffCategory,
  DeployedWorker,
} from '@/lib/types'

function SummaryChip({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  tone: string
}) {
  return (
    <div className="flex items-center gap-2 rounded-xl border bg-muted/40 px-2.5 py-2 sm:gap-3 sm:px-4 sm:py-3">
      <Icon className={cn('hidden h-4 w-4 shrink-0 sm:block sm:h-5 sm:w-5', tone)} />
      <div className="min-w-0">
        <p className="truncate text-[11px] font-medium text-muted-foreground sm:text-xs">{label}</p>
        <p className="truncate text-[11px] font-semibold tabular-nums tracking-tight sm:text-base sm:tracking-normal" title={value}>
          {value}
        </p>
      </div>
    </div>
  )
}

const ASSIGNMENT_OPTIONS = [
  { value: 'assigned', label: 'Assigned' },
  { value: 'unassigned', label: 'Unassigned (bench)' },
]

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
]

export function WorkerDeploymentView() {
  const { settings } = useAppStore()
  const currency = settings.currency

  // ---- Shared option lists (small, loaded once for the filter selects) ----
  const [clientOptions, setClientOptions] = useState<ClientRow[]>([])
  const [projectOptions, setProjectOptions] = useState<ProjectRow[]>([])
  const [categoryOptions, setCategoryOptions] = useState<StaffCategory[]>([])

  useEffect(() => {
    api.get<Paginated<ClientRow>>('/api/clients?pageSize=100').then((r) => setClientOptions(r.data)).catch(() => {})
    api.get<Paginated<ProjectRow>>('/api/projects?pageSize=100').then((r) => setProjectOptions(r.data)).catch(() => {})
    api.get<Paginated<StaffCategory>>('/api/staff-categories?pageSize=100').then((r) => setCategoryOptions(r.data)).catch(() => {})
  }, [])

  // ---- Grouped mode (By Client tab) ----
  const [groups, setGroups] = useState<ClientDeploymentGroup[] | null>(null)
  const [groupsLoading, setGroupsLoading] = useState(true)
  const [groupSearch, setGroupSearch] = useState('')
  const debouncedGroupSearch = useDebounce(groupSearch)
  const [groupClient, setGroupClient] = useState('all')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const loadGroups = useCallback(async () => {
    setGroupsLoading(true)
    try {
      const res = await api.get<{ groups: ClientDeploymentGroup[]; totals: DeploymentTotals }>(
        `/api/deployments?mode=grouped${qs({
          search: debouncedGroupSearch,
          clientId: groupClient === 'all' ? '' : groupClient,
        })}`
      )
      setGroups(res.groups)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setGroupsLoading(false)
    }
  }, [debouncedGroupSearch, groupClient])

  useEffect(() => {
    void loadGroups()
  }, [loadGroups])

  function toggleGroup(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // ---- Flat mode (By Worker tab) ----
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search)
  const [clientId, setClientId] = useState('all')
  const [projectId, setProjectId] = useState('all')
  const [categoryId, setCategoryId] = useState('all')
  const [status, setStatus] = useState('all')
  const [assignment, setAssignment] = useState('all')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [data, setData] = useState<Paginated<DeployedWorker> | null>(null)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)

  // Projects choices narrow with the selected client
  const visibleProjects = useMemo(
    () => (clientId === 'all' ? projectOptions : projectOptions.filter((p) => p.clientId === clientId)),
    [projectOptions, clientId]
  )

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get<Paginated<DeployedWorker>>(
        `/api/deployments${qs({
          search: debouncedSearch,
          clientId: clientId === 'all' ? '' : clientId,
          projectId: projectId === 'all' ? '' : projectId,
          categoryId: categoryId === 'all' ? '' : categoryId,
          status: status === 'all' ? '' : status,
          assignment: assignment === 'all' ? '' : assignment,
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
  }, [debouncedSearch, clientId, projectId, categoryId, status, assignment, page, pageSize])

  useEffect(() => {
    void load()
  }, [load])

  const rows = data?.data ?? []
  const isFiltered =
    debouncedSearch.trim() !== '' ||
    clientId !== 'all' ||
    projectId !== 'all' ||
    categoryId !== 'all' ||
    status !== 'all' ||
    assignment !== 'all'
  const activeFilterCount = [
    clientId !== 'all',
    projectId !== 'all',
    categoryId !== 'all',
    status !== 'all',
    assignment !== 'all',
  ].filter(Boolean).length

  function resetFilters() {
    setSearch('')
    setClientId('all')
    setProjectId('all')
    setCategoryId('all')
    setStatus('all')
    setAssignment('all')
    setPage(1)
  }

  /** CSV export walking all flat pages with the current filters */
  async function exportCsv() {
    setExporting(true)
    try {
      const all: DeployedWorker[] = []
      let p = 1
      for (;;) {
        const res = await api.get<Paginated<DeployedWorker>>(
          `/api/deployments${qs({
            search: debouncedSearch,
            clientId: clientId === 'all' ? '' : clientId,
            projectId: projectId === 'all' ? '' : projectId,
            categoryId: categoryId === 'all' ? '' : categoryId,
            status: status === 'all' ? '' : status,
            assignment: assignment === 'all' ? '' : assignment,
            page: p,
            pageSize: 100,
          })}`
        )
        all.push(...res.data)
        if (p >= res.totalPages) break
        p++
      }
      downloadCsv(
        csvFilename('worker-deployment'),
        buildCsv(
          ['Worker', 'IQAMA', 'Position', 'Category', 'Status', 'Project', 'Client Company', 'Rate/Hour', 'Monthly Salary'],
          all.map((w) => [
            w.fullName,
            w.iqamaId,
            w.position ?? '',
            w.categoryName ?? '',
            w.status,
            w.projectName ?? '— (unassigned)',
            w.clientName ?? '—',
            w.ratePerHour,
            w.monthlySalary,
          ])
        )
      )
      toast.success(`Exported ${all.length} deployment${all.length === 1 ? '' : 's'} to CSV`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  const totals = data?.totals

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title="Worker Deployment"
        description="See which workers are working at which client company"
      />

      {/* KPI chips (filter-independent) */}
      {totals ? (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <SummaryChip
            icon={Network}
            label="Client Assignments"
            value={totals.assignments.toLocaleString()}
            tone="text-primary"
          />
          <SummaryChip
            icon={Users}
            label="Deployed Workers"
            value={totals.distinctWorkers.toLocaleString()}
            tone="text-emerald-600 dark:text-emerald-400"
          />
          <SummaryChip
            icon={UserX}
            label="Unassigned (Bench)"
            value={totals.unassignedActive.toLocaleString()}
            tone="text-amber-600 dark:text-amber-400"
          />
          <SummaryChip
            icon={Building2}
            label="Client Companies"
            value={totals.clientCount.toLocaleString()}
            tone="text-rose-600 dark:text-rose-400"
          />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      )}

      <Tabs defaultValue="by-client">
        <TabsList>
          <TabsTrigger value="by-client">By Client Company</TabsTrigger>
          <TabsTrigger value="by-worker">By Worker</TabsTrigger>
        </TabsList>

        {/* ============ TAB 1: grouped by client ============ */}
        <TabsContent value="by-client" className="mt-4">
          <SectionCard className="overflow-hidden">
            <div className="border-b p-4">
              <FilterBar
                search={
                  <SearchInput
                    value={groupSearch}
                    onChange={(v) => {
                      setGroupSearch(v)
                    }}
                    placeholder="Search client companies..."
                    className="w-full sm:max-w-xs"
                  />
                }
                activeCount={groupClient !== 'all' ? 1 : 0}
              >
                <FilterSelect
                  value={groupClient}
                  onChange={(v) => {
                    setGroupClient(v)
                  }}
                  options={clientOptions.map((c) => ({ value: c.id, label: c.name }))}
                  placeholder="Client"
                  className="w-full sm:w-[220px]"
                />
                {groupSearch || groupClient !== 'all' ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-9"
                    onClick={() => {
                      setGroupSearch('')
                      setGroupClient('all')
                    }}
                  >
                    <RotateCcw className="h-4 w-4" />
                    Clear
                  </Button>
                ) : null}
              </FilterBar>
            </div>

            {groupsLoading && !groups ? (
              <div className="space-y-3 p-4">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-24 w-full" />
                ))}
              </div>
            ) : !groups || groups.length === 0 ? (
              <EmptyState
                icon={Building2}
                title="No clients found"
                description="Create clients and link projects to them to see worker deployments."
              />
            ) : (
              <div className="divide-y">
                {groups.map((g) => {
                  const isCollapsed = collapsed.has(g.client.id)
                  return (
                    <div key={g.client.id}>
                      <button
                        type="button"
                        onClick={() => toggleGroup(g.client.id)}
                        aria-expanded={!isCollapsed}
                        className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-muted/40"
                      >
                        <span
                          className={cn(
                            'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
                            g.client.status === 'active' ? 'bg-primary/10' : 'bg-muted'
                          )}
                        >
                          <Building2
                            className={cn(
                              'h-5 w-5',
                              g.client.status === 'active' ? 'text-primary' : 'text-muted-foreground'
                            )}
                          />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-semibold">{g.client.name}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {g.client.city ?? '—'}
                            {g.client.contactPerson ? ` · ${g.client.contactPerson}` : ''}
                            {` · ${g.activeProjects} active project${g.activeProjects === 1 ? '' : 's'}`}
                          </p>
                        </div>
                        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-xs font-semibold tabular-nums">
                          <Users className="h-3.5 w-3.5 text-muted-foreground" />
                          {g.totalWorkers}
                        </span>
                        <StatusBadge kind={g.client.status} className="hidden shrink-0 sm:inline-flex" />
                        <ChevronRight
                          className={cn(
                            'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
                            !isCollapsed && 'rotate-90'
                          )}
                        />
                      </button>

                      {!isCollapsed ? (
                        <div className="space-y-4 bg-muted/20 px-4 pb-4 pt-1">
                          {g.projects.length === 0 ? (
                            <p className="rounded-lg border border-dashed p-3 text-center text-xs text-muted-foreground">
                              No projects linked to this client yet.
                            </p>
                          ) : (
                            g.projects.map((p) => (
                              <div key={p.id} className="rounded-xl border bg-card shadow-sm">
                                <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-3 py-2.5">
                                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.name}</span>
                                  {p.location ? (
                                    <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                                      <MapPin className="h-3 w-3 shrink-0" />
                                      <span className="truncate">{p.location}</span>
                                    </span>
                                  ) : null}
                                  <StatusBadge kind={p.status} />
                                  <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-semibold tabular-nums">
                                    {p.workers.length} worker{p.workers.length === 1 ? '' : 's'}
                                  </span>
                                </div>
                                {p.workers.length === 0 ? (
                                  <p className="p-3 text-center text-xs text-muted-foreground">
                                    No workers assigned to this project.
                                  </p>
                                ) : (
                                  <ul className="divide-y">
                                    {p.workers.map((w) => (
                                      <li key={w.id} className="flex items-center gap-3 px-3 py-2.5">
                                        <AvatarInitials name={w.fullName} src={w.profilePhoto} size="sm" />
                                        <div className="min-w-0 flex-1">
                                          <p className="truncate text-sm font-medium">
                                            {w.fullName}
                                            {w.status === 'inactive' ? (
                                              <span className="ml-1.5 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                                                inactive
                                              </span>
                                            ) : null}
                                          </p>
                                          <p className="truncate text-xs text-muted-foreground">
                                            IQAMA {w.iqamaId}
                                            {w.position ? ` · ${w.position}` : ''}
                                          </p>
                                        </div>
                                        {w.categoryName ? (
                                          <CategoryChip label={w.categoryName} className="hidden md:inline-flex" />
                                        ) : null}
                                        <span className="shrink-0 text-xs font-semibold tabular-nums text-muted-foreground">
                                          {formatMoney(w.ratePerHour, currency)}/hr
                                        </span>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                            ))
                          )}
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            )}
          </SectionCard>
        </TabsContent>

        {/* ============ TAB 2: flat worker table ============ */}
        <TabsContent value="by-worker" className="mt-4">
          <SectionCard className="overflow-hidden">
            <div className="border-b p-4">
              <FilterBar
                search={
                  <SearchInput
                    value={search}
                    onChange={(v) => {
                      setSearch(v)
                      setPage(1)
                    }}
                    placeholder="Search workers, projects, companies..."
                    className="w-full sm:max-w-xs"
                  />
                }
                activeCount={activeFilterCount}
              >
                <FilterSelect
                  value={assignment}
                  onChange={(v) => {
                    setAssignment(v)
                    setPage(1)
                  }}
                  options={ASSIGNMENT_OPTIONS}
                  placeholder="Assignment"
                />
                <FilterSelect
                  value={clientId}
                  onChange={(v) => {
                    setClientId(v)
                    setProjectId('all')
                    setPage(1)
                  }}
                  options={clientOptions.map((c) => ({ value: c.id, label: c.name }))}
                  placeholder="Client Company"
                  className="w-full sm:w-[200px]"
                />
                <FilterSelect
                  value={projectId}
                  onChange={(v) => {
                    setProjectId(v)
                    setPage(1)
                  }}
                  options={visibleProjects.map((p) => ({ value: p.id, label: p.name }))}
                  placeholder="Project"
                  className="w-full sm:w-[200px]"
                />
                <FilterSelect
                  value={categoryId}
                  onChange={(v) => {
                    setCategoryId(v)
                    setPage(1)
                  }}
                  options={categoryOptions.map((c) => ({ value: c.id, label: c.name }))}
                  placeholder="Category"
                  className="w-full sm:w-[160px]"
                />
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

            {loading && !data ? (
              <div className="hidden md:block">
                <TableSkeleton rows={6} cols={6} />
              </div>
            ) : rows.length === 0 ? (
              <EmptyState
                icon={Network}
                title="No deployments found"
                description={
                  isFiltered
                    ? 'Try adjusting or clearing the filters to see more results.'
                    : 'Assign staff to projects to build the deployment map.'
                }
                action={
                  isFiltered ? (
                    <Button variant="outline" onClick={resetFilters}>
                      <RotateCcw className="h-4 w-4" />
                      Reset filters
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <>
                {/* Desktop table */}
                <div className="hidden overflow-x-auto md:block">
                  <Table className="min-w-[860px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Worker</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Project</TableHead>
                        <TableHead>Client Company</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Rate</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((w) => (
                        <TableRow key={`${w.id}-${w.projectId ?? 'bench'}`}>
                          <TableCell>
                            <div className="flex items-center gap-2.5">
                              <AvatarInitials name={w.fullName} src={w.profilePhoto} size="sm" />
                              <div className="min-w-0">
                                <p className="truncate font-semibold">{w.fullName}</p>
                                <p className="truncate text-xs text-muted-foreground">
                                  IQAMA {w.iqamaId}
                                  {w.position ? ` · ${w.position}` : ''}
                                </p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            {w.categoryName ? <CategoryChip label={w.categoryName} /> : <span className="text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell>
                            {w.projectName ? (
                              <span className="flex items-center gap-1.5">
                                <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                <span className="truncate">{w.projectName}</span>
                              </span>
                            ) : (
                              <span className="rounded-md bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-400">
                                Bench
                              </span>
                            )}
                          </TableCell>
                          <TableCell>
                            {w.clientName ? (
                              <span className="flex items-center gap-1.5">
                                <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                <span className="truncate">{w.clientName}</span>
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <StatusBadge kind={w.status} />
                          </TableCell>
                          <TableCell className="text-right">
                            <span className="text-xs font-semibold tabular-nums text-muted-foreground">
                              {formatMoney(w.ratePerHour, currency)}/hr
                            </span>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {/* Mobile cards */}
                <div className="space-y-3 p-4 md:hidden">
                  {rows.map((w) => (
                    <div
                      key={`${w.id}-${w.projectId ?? 'bench'}`}
                      className="rounded-xl border bg-card p-4 shadow-sm"
                      style={{ borderLeftWidth: 4, borderLeftColor: w.clientName ? 'var(--primary)' : '#f59e0b' }}
                    >
                      <div className="flex items-start gap-3">
                        <AvatarInitials name={w.fullName} src={w.profilePhoto} size="sm" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold">{w.fullName}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            IQAMA {w.iqamaId}
                            {w.position ? ` · ${w.position}` : ''}
                          </p>
                        </div>
                        <StatusBadge kind={w.status} />
                      </div>
                      <div className="mt-2.5 space-y-1 border-t pt-2.5">
                        {w.clientName ? (
                          <p className="flex items-center gap-1.5 text-xs">
                            <Building2 className="h-3.5 w-3.5 shrink-0 text-primary" />
                            <span className="truncate font-medium">{w.clientName}</span>
                          </p>
                        ) : (
                          <p className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                            <UserX className="h-3.5 w-3.5 shrink-0" />
                            Unassigned (bench)
                          </p>
                        )}
                        {w.projectName ? (
                          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <FileText className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate">{w.projectName}</span>
                          </p>
                        ) : null}
                        {w.categoryName ? (
                          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Users className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate">{w.categoryName}</span>
                          </p>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

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
                unit="workers"
              />
            ) : null}
          </SectionCard>
        </TabsContent>
      </Tabs>
    </div>
  )
}

'use client'

// Worker Lists — the Name List module's main tab: KPI cards, filters
// (search / subject / kind / status / client / date range), the list table
// (desktop) + stacked cards (mobile), create dialog and the in-place editor.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  CalendarCheck2,
  CalendarDays,
  ChevronRight,
  ClipboardList,
  FileSpreadsheet,
  Hourglass,
  ListChecks,
  Pencil,
  Plus,
  Printer,
  Search,
  Trash2,
  Users,
} from 'lucide-react'

import { api, qs } from '@/lib/api-client'
import { can, useAppStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import {
  NL_RESULT_META,
  NL_STATUS_META,
  nlDateInput,
} from '@/lib/name-list-utils'
import { useDebounce } from '@/hooks/use-debounce'
import { useViewIntent, useViewRecordIntent } from '@/hooks/use-view-intent'
import type {
  NameListDetail,
  NameListRow,
  NameListSubjectRow,
  Paginated,
} from '@/lib/types'

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SectionCard } from '../../shared/page-header'
import { StatCard } from '../../shared/stat-card'
import { ConfirmDelete } from '../../shared/confirm-delete'
import { DataTablePagination } from '../../shared/data-table-pagination'
import { EmptyState, TableSkeleton } from '../../shared/empty-state'
import { FilterBar, FilterSelect, SearchInput } from '../../shared/filter-select'
import { ListEditor } from './list-editor'
import { ListHeaderDialog } from './list-header-dialog'

type ListsResponse = Paginated<NameListRow> & { totals: Record<string, number> }
type ClientRow = { id: string; name: string }

export function WorkerListsView({
  onPrintLists,
  openListId,
  onOpenListHandled,
}: {
  onPrintLists: (lists: NameListDetail[]) => void
  /** set by the Today tab / record intents — opens this list in the editor */
  openListId?: string | null
  onOpenListHandled?: () => void
}) {
  const user = useAppStore((s) => s.user)
  const canCreate = can(user, 'namelist.create')
  const canEdit = can(user, 'namelist.edit')
  const canDelete = can(user, 'namelist.delete')
  const isAdmin =
    (user?.role?.name ?? '').toLowerCase() === 'admin' ||
    (user?.role?.name ?? '').toLowerCase() === 'super admin'

  // editor state — when set, the detail screen replaces the index
  const [editingId, setEditingId] = useState<string | null>(null)

  // list state
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search)
  const [subjectId, setSubjectId] = useState('all')
  const [kind, setKind] = useState('all')
  const [status, setStatus] = useState('all')
  const [clientId, setClientId] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [data, setData] = useState<ListsResponse | null>(null)
  const [loading, setLoading] = useState(true)

  // meta
  const [subjects, setSubjects] = useState<NameListSubjectRow[]>([])
  const [clients, setClients] = useState<ClientRow[]>([])

  // dialogs
  const [createOpen, setCreateOpen] = useState(false)

  // deep-open from the command palette / Clients tab
  const recordIntent = useViewRecordIntent('name-list')
  useEffect(() => {
    if (recordIntent.matched && recordIntent.recordId) {
      setEditingId(recordIntent.recordId)
    }
  }, [recordIntent.matched, recordIntent.recordId])

  // command palette → "New Name List" opens the create dialog
  const shouldOpenCreate = useViewIntent('name-list', 'create')
  useEffect(() => {
    if (shouldOpenCreate && canCreate) setCreateOpen(true)
  }, [shouldOpenCreate, canCreate])

  // deep-open from the Today tab
  useEffect(() => {
    if (openListId) {
      setEditingId(openListId)
      onOpenListHandled?.()
    }
  }, [openListId, onOpenListHandled])

  useEffect(() => {
    api
      .get<NameListSubjectRow[]>('/api/name-list-subjects')
      .then(setSubjects)
      .catch(() => setSubjects([]))
    api
      .get<Paginated<ClientRow>>('/api/clients?page=1&pageSize=100')
      .then((r) => setClients(r.data))
      .catch(() => setClients([]))
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get<ListsResponse>(
        `/api/name-lists${qs({
          search: debouncedSearch,
          subjectId: subjectId === 'all' ? '' : subjectId,
          kind: kind === 'all' ? '' : kind,
          status: status === 'all' ? '' : status,
          clientId: clientId === 'all' ? '' : clientId,
          dateFrom,
          dateTo,
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
      toast.error(e instanceof Error ? e.message : 'Failed to load lists')
    } finally {
      setLoading(false)
    }
  }, [debouncedSearch, subjectId, kind, status, clientId, dateFrom, dateTo, page, pageSize])

  useEffect(() => {
    void load()
  }, [load])

  async function printOne(row: NameListRow) {
    try {
      const detail = await api.get<NameListDetail>(`/api/name-lists/${row.id}`)
      onPrintLists([detail])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load list')
    }
  }

  async function handleDelete(row: NameListRow) {
    try {
      await api.del(`/api/name-lists/${row.id}`)
      toast.success(`${row.listNo} deleted`)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete')
    }
  }

  const rows = data?.data ?? []
  const totals = data?.totals ?? {}
  const todayStr = nlDateInput(new Date())
  const thisMonth = useMemo(() => {
    const now = new Date()
    return rows.filter((r) => {
      const d = new Date(r.date)
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
    })
  }, [rows])
  const pendingResults = useMemo(
    () => rows.reduce((s, r) => s + (r.subjectKind === 'interview' ? r.resultCounts.pending : 0), 0),
    [rows]
  )

  // ── editor mode ──
  if (editingId) {
    return (
      <ListEditor
        listId={editingId}
        onBack={() => setEditingId(null)}
        onPrint={(l) => onPrintLists([l])}
        onListMutated={() => void load()}
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard
          icon={ListChecks}
          title="Total lists"
          value={String(data?.total ?? 0)}
          sublabel={`${totals.draft ?? 0} draft · ${totals.sent ?? 0} sent · ${totals.completed ?? 0} completed`}
        />
        <StatCard
          icon={CalendarDays}
          title="Today"
          value={String(rows.filter((r) => nlDateInput(r.date) === todayStr).length)}
          sublabel="lists scheduled today (in view)"
        />
        <StatCard
          icon={Users}
          title="Workers (in view)"
          value={String(rows.reduce((s, r) => s + r.workerCount, 0))}
          sublabel={`${thisMonth.length} list(s) this month`}
        />
        <StatCard
          icon={Hourglass}
          title="Pending results"
          value={String(pendingResults)}
          sublabel="interview workers without a result"
        />
      </div>

      {/* filter bar */}
      <SectionCard>
        <FilterBar>
          <SearchInput
            value={search}
            onChange={(v) => {
              setSearch(v)
              setPage(1)
            }}
            placeholder="Search list no, client, location…"
          />
          <FilterSelect
            value={subjectId}
            onChange={(v) => {
              setSubjectId(v)
              setPage(1)
            }}
            placeholder="Subject"
            options={[
              { value: 'all', label: 'All subjects' },
              ...subjects.map((s) => ({ value: s.id, label: s.name })),
            ]}
          />
          <FilterSelect
            value={kind}
            onChange={(v) => {
              setKind(v)
              setPage(1)
            }}
            placeholder="Type"
            options={[
              { value: 'all', label: 'Interview + Mobilization' },
              { value: 'interview', label: 'Interview type' },
              { value: 'mobilization', label: 'Mobilization type' },
            ]}
          />
          <FilterSelect
            value={status}
            onChange={(v) => {
              setStatus(v)
              setPage(1)
            }}
            placeholder="Status"
            options={[
              { value: 'all', label: 'All statuses' },
              { value: 'draft', label: 'Draft' },
              { value: 'sent', label: 'Sent' },
              { value: 'completed', label: 'Completed' },
              { value: 'cancelled', label: 'Cancelled' },
            ]}
          />
          <FilterSelect
            value={clientId}
            onChange={(v) => {
              setClientId(v)
              setPage(1)
            }}
            placeholder="Client"
            options={[
              { value: 'all', label: 'All clients' },
              ...clients.map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
          <div className="flex items-center gap-1.5">
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value)
                setPage(1)
              }}
              className="h-9 w-[9.5rem]"
              title="From date"
            />
            <span className="text-xs text-muted-foreground">→</span>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value)
                setPage(1)
              }}
              className="h-9 w-[9.5rem]"
              title="To date"
            />
          </div>
          {(debouncedSearch || subjectId !== 'all' || kind !== 'all' || status !== 'all' || clientId !== 'all' || dateFrom || dateTo) ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch('')
                setSubjectId('all')
                setKind('all')
                setStatus('all')
                setClientId('all')
                setDateFrom('')
                setDateTo('')
                setPage(1)
              }}
            >
              Reset
            </Button>
          ) : null}
          {canCreate ? (
            <Button size="sm" onClick={() => setCreateOpen(true)} className="ml-auto">
              <Plus className="h-4 w-4" /> New List
            </Button>
          ) : null}
        </FilterBar>

        {/* table (desktop) */}
        <div className="mt-3 hidden overflow-x-auto lg:block">
          {loading ? (
            <TableSkeleton rows={6} />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={ListChecks}
              title="No name lists yet"
              description={
                canCreate
                  ? 'Create the first interview or mobilization list — workers are picked from the Employee database.'
                  : 'Lists created by your team will appear here.'
              }
            />
          ) : (
            <table className="w-full text-[15px]">
              <thead>
                <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3 font-semibold">List No</th>
                  <th className="py-2 pr-3 font-semibold">Date / Time</th>
                  <th className="py-2 pr-3 font-semibold">Client</th>
                  <th className="py-2 pr-3 font-semibold">Subject</th>
                  <th className="py-2 pr-3 font-semibold">Location / Site</th>
                  <th className="py-2 pr-3 text-center font-semibold">Workers</th>
                  <th className="py-2 pr-3 font-semibold">Status</th>
                  <th className="w-28 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    className="cursor-pointer border-b border-border/50 transition-colors hover:bg-muted/30"
                    onClick={() => setEditingId(r.id)}
                  >
                    <td className="py-2.5 pr-3">
                      <span className="font-mono text-[13px] font-bold">{r.listNo}</span>
                      {r.refInterviewListNo ? (
                        <span
                          className="ml-1.5 align-middle"
                          title={`Created from interview list ${r.refInterviewListNo}`}
                        >
                          <ClipboardList className="inline h-3 w-3 text-muted-foreground" />
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2.5 pr-3 whitespace-nowrap text-[13px]">
                      {nlDateInput(r.date)}
                      {r.time ? <span className="text-muted-foreground"> · {r.time}</span> : null}
                    </td>
                    <td className="py-2.5 pr-3 font-semibold">{r.clientName}</td>
                    <td className="py-2.5 pr-3">
                      <span
                        className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white"
                        style={{ background: r.subjectColor }}
                      >
                        {r.subjectName}
                      </span>
                    </td>
                    <td className="max-w-40 truncate py-2.5 pr-3 text-[13px]">
                      {r.subjectKind === 'mobilization'
                        ? r.projectName ?? r.location ?? '—'
                        : r.location ?? '—'}
                    </td>
                    <td className="py-2.5 pr-3 text-center">
                      <span className="font-bold">{r.workerCount}</span>
                      {r.subjectKind === 'interview' && r.resultCounts.pending < r.workerCount ? (
                        <span className="ml-1 inline-flex gap-0.5 align-middle">
                          {(['selected', 'rejected', 'absent'] as const).map((k) =>
                            r.resultCounts[k] > 0 ? (
                              <span
                                key={k}
                                title={`${NL_RESULT_META[k].label}: ${r.resultCounts[k]}`}
                                className={cn('inline-block h-2 w-2 rounded-full', NL_RESULT_META[k].dot)}
                              />
                            ) : null
                          )}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2.5 pr-3">
                      <Badge variant="outline" className={NL_STATUS_META[r.status].chip}>
                        {NL_STATUS_META[r.status].label}
                      </Badge>
                    </td>
                    <td className="py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-0.5">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title="Print / PDF"
                          onClick={() => printOne(r)}
                        >
                          <Printer className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Open" onClick={() => setEditingId(r.id)}>
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                        {canDelete ? (
                          <ConfirmDelete
                            title={`Delete ${r.listNo}?`}
                            description={
                              r.status === 'completed'
                                ? 'This is a Completed list — only Admin can delete it. The deletion is logged.'
                                : 'The list and its worker results are removed. The deletion is logged.'
                            }
                            onConfirm={() => handleDelete(r)}
                            triggerClassName="h-7 w-7"
                          />
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* cards (mobile / tablet) */}
        <div className="mt-3 space-y-2 lg:hidden">
          {loading ? (
            <TableSkeleton rows={4} />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={ListChecks}
              title="No name lists yet"
              description={canCreate ? 'Create the first list — workers come from the Employee database.' : undefined}
            />
          ) : (
            rows.map((r) => (
              <button
                key={r.id}
                className="block w-full rounded-lg border p-3 text-left transition-colors hover:border-primary/40"
                onClick={() => setEditingId(r.id)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono text-[15px] font-bold">{r.listNo}</span>
                      <span
                        className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white"
                        style={{ background: r.subjectColor }}
                      >
                        {r.subjectName}
                      </span>
                      <Badge variant="outline" className={cn('text-[10px]', NL_STATUS_META[r.status].chip)}>
                        {NL_STATUS_META[r.status].label}
                      </Badge>
                    </div>
                    <p className="mt-1 truncate text-[15px] font-semibold">{r.clientName}</p>
                    <p className="text-[13px] text-muted-foreground">
                      {nlDateInput(r.date)}
                      {r.time ? ` · ${r.time}` : ''}
                      {r.location || r.projectName
                        ? ` · ${r.subjectKind === 'mobilization' ? r.projectName ?? r.location : r.location}`
                        : ''}
                    </p>
                    <p className="mt-0.5 text-[13px]">
                      <b>{r.workerCount}</b> workers
                      {r.subjectKind === 'interview' && r.resultCounts.selected > 0
                        ? ` · ${r.resultCounts.selected} selected`
                        : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col gap-1">
                    <span
                      className="cursor-pointer rounded-md border p-1.5 hover:bg-muted"
                      onClick={(e) => {
                        e.stopPropagation()
                        printOne(r)
                      }}
                      title="Print / PDF"
                    >
                      <Printer className="h-4 w-4" />
                    </span>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>

        {data && data.total > 0 ? (
          <DataTablePagination
            page={data.page}
            pageSize={data.pageSize}
            total={data.total}
            totalPages={data.totalPages}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size)
              setPage(1)
            }}
            unit="lists"
          />
        ) : null}
      </SectionCard>

      {/* create dialog */}
      {createOpen ? (
        <ListHeaderDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          list={null}
          onSaved={(id) => {
            void load()
            if (id) setEditingId(id)
          }}
        />
      ) : null}
    </div>
  )
}

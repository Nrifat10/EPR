'use client'

// Worker picker for Name Lists — searches the Employee database: by name,
// Iqama No., Passport No., Mobile No. or Employee ID, with trade / nationality /
// deployment filters. Available workers list first. Bulk checkboxes → "Add
// selected", or "New worker" to type a brand-new worker straight into the
// list (quick-add creates the employee record on the fly).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, Plus, Search, UserPlus, Users } from 'lucide-react'

import { api, qs } from '@/lib/api-client'
import type { Paginated, StaffRow } from '@/lib/types'
import { NL_DEPLOYMENT_META } from '@/lib/name-list-utils'
import { useDebounce } from '@/hooks/use-debounce'
import { cn } from '@/lib/utils'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import { EmptyState } from '../../shared/empty-state'
import { QuickAddWorkerDialog, type QuickWorker } from './quick-add-worker'

type Category = { id: string; name: string }

export function WorkerPickerDialog({
  open,
  onOpenChange,
  existingStaffIds,
  onAdd,
  listId = null,
  initialSelectedIds,
  onWorkerCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** staff ids already in the list — shown greyed, cannot re-add */
  existingStaffIds: Set<string>
  onAdd: (staffIds: string[]) => Promise<void> | void
  /** when set, quick-added workers go straight into this list server-side */
  listId?: string | null
  /** draft selection (create-mode): rows start checked and stay toggleable */
  initialSelectedIds?: string[] | Set<string>
  /** fired after a quick-add so the parent can refresh / close */
  onWorkerCreated?: (staff: QuickWorker, info: { addedToList: boolean; tempIqama: boolean; listNo: string | null }) => void | Promise<void>
}) {
  const [search, setSearch] = useState('')
  const debounced = useDebounce(search)
  const [categoryId, setCategoryId] = useState('all')
  const [nationality, setNationality] = useState('')
  const [deployment, setDeployment] = useState('all')
  const [rows, setRows] = useState<StaffRow[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [adding, setAdding] = useState(false)
  const [categories, setCategories] = useState<Category[]>([])
  const [quickAddOpen, setQuickAddOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get<Paginated<StaffRow>>(
        `/api/staff${qs({
          search: debounced,
          categoryId: categoryId === 'all' ? '' : categoryId,
          nationality,
          deploymentStatus: deployment === 'all' ? '' : deployment,
          status: 'active',
          page: 1,
          pageSize: 100,
        })}`
      )
      setRows(res.data)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load workers')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [debounced, categoryId, nationality, deployment])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  useEffect(() => {
    if (!open) return
    api
      .get<Paginated<Category>>('/api/staff-categories?page=1&pageSize=50')
      .then((r) => setCategories(r.data))
      .catch(() => setCategories([]))
  }, [open])

  // reset transient state on open
  useEffect(() => {
    if (open) {
      setSearch('')
      setCategoryId('all')
      setNationality('')
      setDeployment('all')
      setSelected(new Set(initialSelectedIds ?? []))
    }
  }, [open, initialSelectedIds])

  // Available workers first, then alphabetical
  const ordered = useMemo(() => {
    if (!rows) return null
    const rank = (s: StaffRow) =>
      s.deploymentStatus === 'available' ? 0 : s.deploymentStatus === 'in_interview' ? 1 : 2
    return [...rows].sort((a, b) => rank(a) - rank(b) || a.fullName.localeCompare(b.fullName))
  }, [rows])

  const nationalities = useMemo(() => {
    if (!rows) return []
    return [...new Set(rows.map((r) => r.nationality).filter((n): n is string => !!n))].sort()
  }, [rows])

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleAdd() {
    if (selected.size === 0) return
    setAdding(true)
    try {
      await onAdd([...selected])
      onOpenChange(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to add workers')
    } finally {
      setAdding(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-4 w-4" /> Add workers from the Employee database
          </DialogTitle>
          <DialogDescription>
            Search by name, Iqama No., Passport No., Mobile No. or Employee ID. Available workers
            are listed first.
          </DialogDescription>
        </DialogHeader>

        {/* filters */}
        <div className="grid gap-2 border-b px-5 py-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="relative sm:col-span-2 lg:col-span-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name / Iqama / Passport / Mobile / ID"
              className="pl-8"
            />
          </div>
          <Select value={categoryId} onValueChange={setCategoryId}>
            <SelectTrigger>
              <SelectValue placeholder="Trade" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All trades</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={nationality} onValueChange={setNationality}>
            <SelectTrigger>
              <SelectValue placeholder="Nationality" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All nationalities</SelectItem>
              {nationalities.map((n) => (
                <SelectItem key={n} value={n}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={deployment} onValueChange={setDeployment}>
            <SelectTrigger>
              <SelectValue placeholder="Deployment" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any deployment</SelectItem>
              <SelectItem value="available">Available</SelectItem>
              <SelectItem value="in_interview">In Interview</SelectItem>
              <SelectItem value="selected">Selected</SelectItem>
              <SelectItem value="deployed">Deployed</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* worker list */}
        <div className="nice-scrollbar min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {loading || ordered === null ? (
            <div className="space-y-2 p-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-12 animate-pulse rounded-md bg-muted" />
              ))}
            </div>
          ) : ordered.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No workers found"
              description="Try a different search or clear the filters."
            />
          ) : (
            <ul className="space-y-1">
              {ordered.map((s) => {
                const inList = existingStaffIds.has(s.id)
                const missing: string[] = []
                if (!s.phone) missing.push('Mobile')
                if (!s.passportNo) missing.push('Passport')
                if (!s.bloodGroup) missing.push('Blood Group')
                return (
                  <li key={s.id}>
                    <label
                      className={cn(
                        'flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 transition-colors',
                        inList
                          ? 'cursor-not-allowed border-border/40 bg-muted/40 opacity-50'
                          : selected.has(s.id)
                            ? 'border-primary/40 bg-primary/5'
                            : 'border-transparent hover:bg-muted/50'
                      )}
                    >
                      <Checkbox
                        checked={selected.has(s.id)}
                        disabled={inList}
                        onCheckedChange={() => toggle(s.id)}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[15px] font-medium">{s.fullName}</p>
                        <p className="truncate text-[13px] text-muted-foreground">
                          {s.staffCategory?.name ?? s.position ?? '—'}
                          {s.nationality ? ` · ${s.nationality}` : ''} · Iqama {s.iqamaId}
                        </p>
                      </div>
                      {missing.length > 0 ? (
                        <span
                          className="flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400"
                          title={`Missing in employee record: ${missing.join(', ')}`}
                        >
                          <AlertTriangle className="h-3.5 w-3.5" />
                          {missing.length}
                        </span>
                      ) : null}
                      <Badge
                        variant="outline"
                        className={cn('shrink-0 text-[11px]', NL_DEPLOYMENT_META[s.deploymentStatus]?.chip ?? '')}
                      >
                        {NL_DEPLOYMENT_META[s.deploymentStatus]?.label ?? s.deploymentStatus}
                      </Badge>
                      {inList ? (
                        <span className="shrink-0 text-[11px] text-muted-foreground">in list</span>
                      ) : null}
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <DialogFooter className="items-center justify-between gap-2 border-t px-5 py-3">
          <Label className="text-[13px] text-muted-foreground">
            {rows ? `${rows.length} worker(s) shown` : ''}
            {nationality === '' && categoryId === 'all' && deployment === 'all' && !debounced
              ? ' — use filters to narrow down'
              : ''}
          </Label>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setQuickAddOpen(true)} title="Type a new worker directly — creates the employee record">
              <Plus className="h-4 w-4" />
              New worker
            </Button>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleAdd} disabled={selected.size === 0 || adding}>
              <UserPlus className="h-4 w-4" />
              Add selected ({selected.size})
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>

      {/* quick-add stacked on top of the picker */}
      {quickAddOpen ? (
        <QuickAddWorkerDialog
          open={quickAddOpen}
          onOpenChange={setQuickAddOpen}
          listId={listId}
          categories={categories}
          nationalities={nationalities}
          onSaved={async (staff, info) => {
            // keep the fresh worker visible & selectable in this session
            if (!info.addedToList) {
              setSelected((prev) => new Set(prev).add(staff.id))
            }
            await load()
            if (onWorkerCreated) await onWorkerCreated(staff, info)
          }}
        />
      ) : null}
    </Dialog>
  )
}

'use client'

// Name List header dialog — shared form for creating a list and editing a
// list's header fields. Worker selection happens through the picker.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { UserPlus } from 'lucide-react'

import { api, qs } from '@/lib/api-client'
import { cn } from '@/lib/utils'
import { nlDateInput } from '@/lib/name-list-utils'
import type { NameListDetail, NameListSubjectRow, Paginated } from '@/lib/types'

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
import { Textarea } from '@/components/ui/textarea'
import { WorkerPickerDialog } from './worker-picker'

type ClientRow = { id: string; name: string; contactPerson: string | null; phone: string | null }
type ProjectRow = { id: string; name: string; clientId: string | null }
type Category = { id: string; name: string }

const EMPTY = {
  date: '',
  time: '',
  clientId: '',
  subjectId: '',
  location: '',
  projectId: '',
  clientContact: '',
  clientPhone: '',
  transport: '',
  refPoNo: '',
  notes: '',
}

export function ListHeaderDialog({
  open,
  onOpenChange,
  list,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** null → create mode */
  list: NameListDetail | null
  /** called with the new list id after creation, or after a successful edit */
  onSaved: (createdId?: string) => void | Promise<void>
}) {
  const isEdit = list !== null
  const [form, setForm] = useState({ ...EMPTY })
  const [positions, setPositions] = useState<string[]>([])
  const [workers, setWorkers] = useState<string[]>([])
  const [subjects, setSubjects] = useState<NameListSubjectRow[]>([])
  const [clients, setClients] = useState<ClientRow[]>([])
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const load = useCallback(async () => {
    const [subs, cls, cats] = await Promise.all([
      api.get<NameListSubjectRow[]>('/api/name-list-subjects'),
      api.get<Paginated<ClientRow>>('/api/clients?page=1&pageSize=100'),
      api.get<Paginated<Category>>('/api/staff-categories?page=1&pageSize=50'),
    ])
    setSubjects(subs)
    setClients(cls.data)
    setCategories(cats.data)
  }, [])

  useEffect(() => {
    if (!open) return
    void load().catch(() => toast.error('Failed to load form data'))
    if (list) {
      const c = clients.find((x) => x.id === list.clientId)
      setForm({
        date: nlDateInput(list.date),
        time: list.time ?? '',
        clientId: list.clientId,
        subjectId: list.subjectId,
        location: list.location ?? '',
        projectId: list.projectId ?? '',
        clientContact: list.clientContact ?? c?.contactPerson ?? '',
        clientPhone: list.clientPhone ?? c?.phone ?? '',
        transport: list.transport ?? '',
        refPoNo: list.refPoNo ?? '',
        notes: list.notes ?? '',
      })
      setPositions(list.positions)
      setWorkers(list.workers.map((w) => w.staffId))
    } else {
      const today = new Date()
      setForm((f) => ({
        ...EMPTY,
        date: nlDateInput(today),
        subjectId: f.subjectId || '',
        clientId: f.clientId || '',
      }))
      setPositions([])
      setWorkers([])
    }
  }, [open, list])

  // projects for the chosen client (site selector on mobilization lists)
  useEffect(() => {
    if (!open || !form.clientId) {
      setProjects([])
      return
    }
    api
      .get<Paginated<ProjectRow>>(`/api/projects${qs({ clientId: form.clientId, page: 1, pageSize: 50 })}`)
      .then((r) => setProjects(r.data))
      .catch(() => setProjects([]))
  }, [open, form.clientId])

  const subject = useMemo(
    () => subjects.find((s) => s.id === form.subjectId) ?? null,
    [subjects, form.subjectId]
  )
  const isMob = subject?.kind === 'mobilization'

  // auto-fill contact from the selected client
  function pickClient(id: string) {
    const c = clients.find((x) => x.id === id)
    setForm((f) => ({
      ...f,
      clientId: id,
      clientContact: c?.contactPerson ?? '',
      clientPhone: c?.phone ?? '',
    }))
  }

  function togglePosition(name: string) {
    setPositions((p) => (p.includes(name) ? p.filter((x) => x !== name) : [...p, name]))
  }

  async function handleSubmit() {
    if (!form.date) return toast.error('Date is required')
    if (!form.clientId) return toast.error('Client company is required')
    if (!form.subjectId) return toast.error('Subject is required')
    setSubmitting(true)
    try {
      const payload = {
        date: form.date,
        time: form.time || null,
        clientId: form.clientId,
        subjectId: form.subjectId,
        location: form.location || null,
        projectId: form.projectId || null,
        positions,
        clientContact: form.clientContact || null,
        clientPhone: form.clientPhone || null,
        transport: form.transport || null,
        refPoNo: form.refPoNo || null,
        notes: form.notes || null,
      }
      if (isEdit) {
        await api.put(`/api/name-lists/${list.id}`, payload)
        toast.success('List updated')
        await onSaved()
      } else {
        const res = await api.post<{ id: string; listNo: string }>('/api/name-lists', {
          ...payload,
          workers,
        })
        toast.success(`List ${res.listNo} created`)
        await onSaved(res.id)
      }
      onOpenChange(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="nice-scrollbar max-h-[90vh] overflow-y-auto sm:max-w-[640px]">
          <DialogHeader>
            <DialogTitle>{isEdit ? `Edit ${list.listNo}` : 'New Name List'}</DialogTitle>
            <DialogDescription>
              {isEdit
                ? 'Update the list details. Workers are managed on the list screen.'
                : 'Each list gets its own number — create as many lists per day as you need.'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>Subject (purpose) *</Label>
              <Select value={form.subjectId} onValueChange={(v) => setForm((f) => ({ ...f, subjectId: v }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Select subject" />
                </SelectTrigger>
                <SelectContent>
                  {subjects.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      <span className="inline-flex items-center gap-2">
                        <span
                          className="inline-block h-2.5 w-2.5 rounded-full"
                          style={{ background: s.color }}
                        />
                        {s.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Client company *</Label>
              <Select value={form.clientId} onValueChange={pickClient}>
                <SelectTrigger>
                  <SelectValue placeholder="Select company" />
                </SelectTrigger>
                <SelectContent>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Date *</Label>
              <Input
                type="date"
                value={form.date}
                onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Time</Label>
              <Input
                type="time"
                value={form.time}
                onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))}
              />
            </div>

            {isMob ? (
              <div className="grid gap-1.5 sm:col-span-2">
                <Label>Project / Site</Label>
                <Select
                  value={form.projectId || 'none'}
                  onValueChange={(v) => setForm((f) => ({ ...f, projectId: v === 'none' ? '' : v }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select site" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— none —</SelectItem>
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="grid gap-1.5 sm:col-span-2">
                <Label>Location (interview place)</Label>
                <Input
                  value={form.location}
                  onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
                  placeholder="e.g. Al Noor HR Office, Dammam"
                />
              </div>
            )}

            <div className="grid gap-1.5 sm:col-span-2">
              <Label>Positions / trades requested</Label>
              <div className="flex flex-wrap gap-1.5">
                {categories.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => togglePosition(c.name)}
                    className={cn(
                      'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                      positions.includes(c.name)
                        ? 'border-primary/50 bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:bg-muted'
                    )}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label>Client contact person</Label>
              <Input
                value={form.clientContact}
                onChange={(e) => setForm((f) => ({ ...f, clientContact: e.target.value }))}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Client contact phone</Label>
              <Input
                value={form.clientPhone}
                onChange={(e) => setForm((f) => ({ ...f, clientPhone: e.target.value }))}
              />
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label>Transport</Label>
              <Input
                value={form.transport}
                onChange={(e) => setForm((f) => ({ ...f, transport: e.target.value }))}
                placeholder="e.g. Company bus · Vehicle 12 · Driver Salim"
              />
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label>Reference — client PO / Quotation no. (optional)</Label>
              <Input
                value={form.refPoNo}
                onChange={(e) => setForm((f) => ({ ...f, refPoNo: e.target.value }))}
                placeholder="e.g. PO-77421"
              />
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label>Notes</Label>
              <Textarea
                rows={2}
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </div>

            {!isEdit ? (
              <div className="grid gap-1.5 sm:col-span-2">
                <Label>Workers (can also be added after creating)</Label>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setPickerOpen(true)}
                  className="justify-start"
                >
                  <UserPlus className="h-4 w-4" />
                  {workers.length > 0
                    ? `${workers.length} worker(s) selected — add / change`
                    : 'Pick workers from the Employee database'}
                </Button>
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              {isEdit ? 'Save changes' : 'Create list'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {pickerOpen ? (
        <WorkerPickerDialog
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          existingStaffIds={new Set()}
          initialSelectedIds={workers}
          onAdd={(ids) => setWorkers(ids)}
          onWorkerCreated={(staff) => setWorkers((prev) => Array.from(new Set([...prev, staff.id])))}
        />
      ) : null}
    </>
  )
}

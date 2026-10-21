'use client'

// Name List editor — the detail screen for one worker list:
//   • header card (list no, subject badge, status, client, date/time) + actions
//     (edit header, status transitions, print, Excel, share, duplicate,
//     signed-copy upload, "Create Mobilization List from Selected")
//   • workers card: add from the Employee database, reorder (up/down + drag
//     rows), remove, per-worker result + remarks with quick actions, warning
//     icons for missing Mobile / Passport / Blood Group (with quick-fix popover)
//   • non-blocking warnings for date/time clashes and already-deployed workers
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  ArrowLeft,
  ArrowDown,
  ArrowUp,
  BadgeCheck,
  CalendarCheck2,
  CalendarX2,
  CheckCheck,
  ClipboardList,
  Copy,
  FileSpreadsheet,
  FileUp,
  Pencil,
  Plus,
  Printer,
  Send,
  Share2,
  Trash2,
  TriangleAlert,
  UserPlus,
  UserRoundPlus,
  Users,
  X,
} from 'lucide-react'

import { api } from '@/lib/api-client'
import { can, useAppStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import {
  NL_RESULT_META,
  NL_STATUS_META,
  formatSaudiMobile,
  nlDateInput,
} from '@/lib/name-list-utils'
import type {
  NameListColumns,
  NameListDetail,
  NameListWorkerResult,
  Paginated,
  StaffRow,
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
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { SectionCard } from '../../shared/page-header'
import { WorkerPickerDialog } from './worker-picker'
import { QuickAddWorkerDialog } from './quick-add-worker'
import { ShareDialog } from './share-dialog'
import { ListHeaderDialog } from './list-header-dialog'

export type NameListWarning = {
  staffId: string
  type: 'conflict' | 'deployed' | 'missing'
  message: string
}

type DetailResponse = NameListDetail & { warnings: NameListWarning[] }

export function ListEditor({
  listId,
  onBack,
  onPrint,
  onListMutated,
}: {
  listId: string
  onBack: () => void
  onPrint: (list: NameListDetail) => void
  onListMutated?: () => void
}) {
  const user = useAppStore((s) => s.user)
  const canEdit = can(user, 'namelist.edit')
  const isAdmin =
    (user?.role?.name ?? '').toLowerCase() === 'admin' ||
    (user?.role?.name ?? '').toLowerCase() === 'super admin'

  const [detail, setDetail] = useState<DetailResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [quickAddOpen, setQuickAddOpen] = useState(false)
  const [headerOpen, setHeaderOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [quickFix, setQuickFix] = useState<{ staffId: string; name: string } | null>(null)
  const [quickValues, setQuickValues] = useState({ phone: '', passportNo: '', bloodGroup: '' })
  const [confirmStatus, setConfirmStatus] = useState<string | null>(null)
  const dragStaff = useRef<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await api.get<DetailResponse>(`/api/name-lists/${listId}`)
      setDetail(res)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load the list')
      onBack()
    } finally {
      setLoading(false)
    }
  }, [listId, onBack])

  useEffect(() => {
    setLoading(true)
    void load()
  }, [load])

  const readOnly = detail ? detail.status === 'completed' || detail.status === 'cancelled' : false
  const isInterview = detail?.subjectKind === 'interview'

  const warningsByStaff = useMemo(() => {
    const m = new Map<string, NameListWarning[]>()
    for (const w of detail?.warnings ?? []) {
      if (w.type === 'missing') continue // shown on the row itself
      if (!m.has(w.staffId)) m.set(w.staffId, [])
      m.get(w.staffId)!.push(w)
    }
    return m
  }, [detail?.warnings])

  const generalWarnings = useMemo(() => {
    const seen = new Set<string>()
    return (detail?.warnings ?? []).filter((w) => {
      if (w.type !== 'missing') return false
      const key = w.message
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }, [detail?.warnings])

  // ── worker operations ──

  async function addWorkers(staffIds: string[]) {
    if (!detail) return
    try {
      const res = await api.post<{ added: number; warnings: NameListWarning[]; message?: string }>(
        `/api/name-lists/${detail.id}/workers`,
        { staffIds }
      )
      if (res.message) toast.info(res.message)
      if (res.warnings?.length) {
        for (const w of res.warnings) toast.warning(w.message)
      }
      await load()
      onListMutated?.()
    } catch (e) {
      throw e
    }
  }

  async function removeWorker(staffId: string) {
    if (!detail) return
    try {
      await api.patch(`/api/name-lists/${detail.id}/workers`, { op: 'remove', staffId })
      toast.success('Worker removed')
      await load()
      onListMutated?.()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to remove worker')
    }
  }

  async function reorder(staffId: string, dir: -1 | 1) {
    if (!detail) return
    const order = detail.workers.map((w) => w.staffId)
    const i = order.indexOf(staffId)
    const j = i + dir
    if (i < 0 || j < 0 || j >= order.length) return
    ;[order[i], order[j]] = [order[j], order[i]]
    try {
      await api.patch(`/api/name-lists/${detail.id}/workers`, { op: 'reorder', order })
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to reorder')
    }
  }

  async function handleDrop(targetStaffId: string) {
    const from = dragStaff.current
    dragStaff.current = null
    if (!detail || !from || from === targetStaffId) return
    const order = detail.workers.map((w) => w.staffId)
    const fromIdx = order.indexOf(from)
    const toIdx = order.indexOf(targetStaffId)
    if (fromIdx < 0 || toIdx < 0) return
    order.splice(toIdx, 0, order.splice(fromIdx, 1)[0])
    try {
      await api.patch(`/api/name-lists/${detail.id}/workers`, { op: 'reorder', order })
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to reorder')
    }
  }

  async function saveResult(workerId: string, result: NameListWorkerResult | null, remarks?: string) {
    if (!detail) return
    try {
      await api.patch(`/api/name-lists/${detail.id}/workers`, {
        op: 'result',
        updates: [{ workerId, result, ...(remarks !== undefined ? { remarks } : {}) }],
      })
      await load()
      onListMutated?.()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save result')
    }
  }

  async function markAll(result: NameListWorkerResult) {
    if (!detail) return
    setBusy(true)
    try {
      await api.patch(`/api/name-lists/${detail.id}/workers`, { op: 'resultAll', result })
      toast.success(`All workers marked ${NL_RESULT_META[result].label}`)
      await load()
      onListMutated?.()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to mark all')
    } finally {
      setBusy(false)
    }
  }

  // ── list-level actions ──

  async function changeStatus(status: string) {
    if (!detail) return
    setBusy(true)
    try {
      const res = await api.put<{ note?: string }>(`/api/name-lists/${detail.id}/status`, { status })
      toast.success(res.note ? `Status updated — ${res.note}` : 'Status updated')
      setConfirmStatus(null)
      await load()
      onListMutated?.()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to change status')
    } finally {
      setBusy(false)
    }
  }

  async function createMobilization() {
    if (!detail) return
    setBusy(true)
    try {
      const res = await api.post<{ listNo: string; workerCount: number }>(
        `/api/name-lists/${detail.id}/create-mobilization`,
        {}
      )
      toast.success(`Mobilization list ${res.listNo} created with ${res.workerCount} selected worker(s)`)
      onListMutated?.()
      onBack()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to create mobilization list')
    } finally {
      setBusy(false)
    }
  }

  async function duplicate() {
    if (!detail) return
    setBusy(true)
    try {
      const res = await api.post<{ listNo: string }>(`/api/name-lists/${detail.id}/duplicate`, {})
      toast.success(`Duplicated as ${res.listNo}`)
      onListMutated?.()
      onBack()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to duplicate')
    } finally {
      setBusy(false)
    }
  }

  async function uploadSignedCopy(file: File) {
    if (!detail) return
    const fd = new FormData()
    fd.append('file', file)
    try {
      await api.postForm(`/api/name-lists/${detail.id}/signed-copy`, fd)
      toast.success('Signed copy attached')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed')
    }
  }

  async function removeSignedCopy() {
    if (!detail) return
    try {
      await api.del(`/api/name-lists/${detail.id}/signed-copy`)
      toast.success('Signed copy removed')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to remove')
    }
  }

  // ── quick-fix missing employee data ──

  function openQuickFix(staffId: string, name: string, w: NameListDetail['workers'][number]) {
    setQuickFix({ staffId, name })
    setQuickValues({
      phone: w.staff.phone ?? '',
      passportNo: w.staff.passportNo ?? '',
      bloodGroup: w.staff.bloodGroup ?? '',
    })
  }

  async function saveQuickFix() {
    if (!quickFix || !detail) return
    setBusy(true)
    try {
      const staff = await api.get<StaffRow>(`/api/staff/${quickFix.staffId}`)
      await api.put(`/api/staff/${quickFix.staffId}`, {
        ...staff,
        phone: quickValues.phone || null,
        passportNo: quickValues.passportNo || null,
        bloodGroup: quickValues.bloodGroup || null,
        projectIds: staff.projects.map((p) => p.id),
      })
      toast.success('Employee record updated')
      setQuickFix(null)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update employee')
    } finally {
      setBusy(false)
    }
  }

  if (loading || !detail) {
    return (
      <div className="space-y-4">
        <div className="h-24 animate-pulse rounded-xl bg-muted" />
        <div className="h-64 animate-pulse rounded-xl bg-muted" />
      </div>
    )
  }

  const selectedCount = detail.workers.filter((w) => w.result === 'selected').length
  const statusMeta = NL_STATUS_META[detail.status]

  return (
    <div className="flex flex-col gap-4">
      {/* ── header card ── */}
      <SectionCard>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onBack} title="Back to lists">
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <h2 className="text-lg font-bold tracking-tight">{detail.listNo}</h2>
              <span
                className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white"
                style={{ background: detail.subjectColor }}
              >
                {detail.subjectName}
              </span>
              <Badge variant="outline" className={statusMeta.chip}>
                {statusMeta.label}
              </Badge>
              {detail.refInterviewListNo ? (
                <Badge variant="outline" className="gap-1 text-[10px]">
                  <ClipboardList className="h-3 w-3" />
                  From interview {detail.refInterviewListNo}
                </Badge>
              ) : null}
            </div>
            <p className="mt-1 text-[15px] text-muted-foreground">
              {detail.clientName} · {nlDateInput(detail.date)}
              {detail.time ? ` · ${detail.time}` : ''}
              {detail.projectName ? ` · ${detail.projectName}` : detail.location ? ` · ${detail.location}` : ''}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {canEdit && !readOnly ? (
              <Button variant="outline" size="sm" onClick={() => setHeaderOpen(true)}>
                <Pencil className="h-4 w-4" /> Edit details
              </Button>
            ) : null}
            <Button variant="outline" size="sm" onClick={() => onPrint(detail)}>
              <Printer className="h-4 w-4" /> Print
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href={`/api/name-lists/${detail.id}/excel`} download>
                <FileSpreadsheet className="h-4 w-4" /> Excel
              </a>
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShareOpen(true)}>
              <Share2 className="h-4 w-4" /> Share
            </Button>
            {can(user, 'namelist.create') ? (
              <Button variant="outline" size="sm" onClick={duplicate} disabled={busy}>
                <Copy className="h-4 w-4" /> Duplicate
              </Button>
            ) : null}
          </div>
        </div>

        {/* meta grid */}
        <div className="mt-3 grid gap-x-6 gap-y-2 text-[15px] sm:grid-cols-2 lg:grid-cols-3">
          <MetaItem label="Client company" value={detail.clientName} />
          <MetaItem
            label={detail.subjectKind === 'mobilization' ? 'Project / Site' : 'Location'}
            value={detail.projectName ?? detail.location ?? '—'}
          />
          <MetaItem label="Positions / trades" value={detail.positions.join(', ') || '—'} />
          <MetaItem
            label="Client contact"
            value={
              detail.clientContact || detail.clientPhone
                ? `${detail.clientContact ?? '—'}${detail.clientPhone ? ` · ${detail.clientPhone}` : ''}`
                : '—'
            }
          />
          <MetaItem label="Transport" value={detail.transport ?? '—'} />
          <MetaItem
            label="Reference"
            value={
              [
                detail.refInterviewListNo ? `Interview list ${detail.refInterviewListNo}` : null,
                detail.refPoNo ? `PO ${detail.refPoNo}` : null,
              ]
                .filter(Boolean)
                .join(' · ') || '—'
            }
          />
          {detail.notes ? (
            <div className="sm:col-span-2 lg:col-span-3">
              <MetaItem label="Notes" value={detail.notes} />
            </div>
          ) : null}
        </div>

        {/* status actions */}
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
          {canEdit && detail.status === 'draft' ? (
            <Button size="sm" onClick={() => setConfirmStatus('sent')} disabled={busy}>
              <Send className="h-4 w-4" /> Mark Sent
            </Button>
          ) : null}
          {canEdit && detail.status === 'sent' ? (
            <Button size="sm" onClick={() => setConfirmStatus('completed')} disabled={busy}>
              <BadgeCheck className="h-4 w-4" /> Mark Completed
            </Button>
          ) : null}
          {canEdit && (detail.status === 'draft' || detail.status === 'sent') ? (
            <Button variant="outline" size="sm" onClick={() => setConfirmStatus('cancelled')} disabled={busy}>
              <CalendarX2 className="h-4 w-4" /> Cancel list
            </Button>
          ) : null}
          {canEdit && detail.status === 'sent' ? (
            <Button variant="outline" size="sm" onClick={() => setConfirmStatus('draft')} disabled={busy}>
              <ArrowLeft className="h-4 w-4" /> Back to Draft
            </Button>
          ) : null}
          {canEdit && isInterview && selectedCount > 0 && detail.status !== 'completed' ? (
            <Button
              size="sm"
              className="ml-auto bg-emerald-700 hover:bg-emerald-600"
              onClick={createMobilization}
              disabled={busy}
              title="Creates a new Mobilization list with only the Selected workers"
            >
              <CalendarCheck2 className="h-4 w-4" />
              Create Mobilization List from Selected ({selectedCount})
            </Button>
          ) : null}
          <span className="text-xs text-muted-foreground">
            Created by {detail.createdByName ?? '—'}
          </span>
        </div>

        {/* signed copy */}
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Signed / stamped copy
          </span>
          {detail.signedCopyName ? (
            <>
              <a
                href={`/api/name-lists/${detail.id}/signed-copy`}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-medium text-primary underline-offset-2 hover:underline"
              >
                {detail.signedCopyName}
              </a>
              {canEdit ? (
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={removeSignedCopy} title="Remove signed copy">
                  <X className="h-3.5 w-3.5" />
                </Button>
              ) : null}
            </>
          ) : (
            <>
              {canEdit ? (
                <label className="cursor-pointer">
                  <input
                    type="file"
                    className="hidden"
                    accept="image/jpeg,image/png,image/webp,application/pdf"
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) void uploadSignedCopy(f)
                      e.target.value = ''
                    }}
                  />
                  <span className="inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium hover:bg-muted">
                    <FileUp className="h-3.5 w-3.5" /> Upload scan / photo
                  </span>
                </label>
              ) : (
                <span className="text-xs text-muted-foreground">—</span>
              )}
            </>
          )}
        </div>
      </SectionCard>

      {/* ── warnings ── */}
      {generalWarnings.length > 0 ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300">
          <p className="mb-1 flex items-center gap-1.5 font-semibold">
            <TriangleAlert className="h-4 w-4" /> Check these workers
          </p>
          <ul className="list-inside list-disc space-y-0.5">
            {generalWarnings.slice(0, 5).map((w, i) => (
              <li key={i}>{w.message}</li>
            ))}
          </ul>
          <p className="mt-1 opacity-80">
            Warnings are advisory — you can still keep these workers on the list.
          </p>
        </div>
      ) : null}

      {/* ── workers card ── */}
      <SectionCard>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-base font-semibold">
            <Users className="h-4 w-4" />
            {detail.workers.length} {detail.workers.length === 1 ? 'worker' : 'workers'} in this list
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            {canEdit && !readOnly && isInterview ? (
              <>
                <Button variant="outline" size="sm" onClick={() => markAll('selected')} disabled={busy || detail.workers.length === 0}>
                  <CheckCheck className="h-4 w-4" /> Mark all Selected
                </Button>
                <Button variant="outline" size="sm" onClick={() => markAll('absent')} disabled={busy || detail.workers.length === 0}>
                  <CalendarX2 className="h-4 w-4" /> Mark all Absent
                </Button>
              </>
            ) : null}
            {canEdit && !readOnly ? (
              <>
                <Button variant="outline" size="sm" onClick={() => setQuickAddOpen(true)} title="Type a new worker directly — creates the employee record and adds it to this list">
                  <UserRoundPlus className="h-4 w-4" /> New worker
                </Button>
                <Button size="sm" onClick={() => setPickerOpen(true)}>
                  <UserPlus className="h-4 w-4" /> Add workers
                </Button>
              </>
            ) : null}
          </div>
        </div>

        {/* results summary (interview kind) */}
        {isInterview && detail.workers.length > 0 ? (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            {(['selected', 'rejected', 'absent', 'onhold'] as const).map((r) =>
              detail.resultCounts[r] > 0 ? (
                <span
                  key={r}
                  className={cn('rounded-full border px-2 py-0.5 font-medium', NL_RESULT_META[r].chip)}
                >
                  {NL_RESULT_META[r].label}: {detail.resultCounts[r]}
                </span>
              ) : null
            )}
            {detail.resultCounts.pending > 0 ? (
              <span className="rounded-full border border-neutral-300 bg-neutral-50 px-2 py-0.5 font-medium text-neutral-600 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                Pending: {detail.resultCounts.pending}
              </span>
            ) : null}
          </div>
        ) : null}

        {/* workers table (desktop) */}
        <div className="mt-3 hidden overflow-x-auto lg:block">
          <table className="w-full text-[15px]">
            <thead>
              <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="w-16 py-2 pl-1 font-semibold">#</th>
                <th className="py-2 font-semibold">Employee</th>
                <th className="py-2 font-semibold">Iqama</th>
                <th className="py-2 font-semibold">Mobile</th>
                {isInterview ? (
                  <th className="w-44 py-2 font-semibold">Result</th>
                ) : (
                  <th className="py-2 font-semibold">Passport</th>
                )}
                <th className="w-56 py-2 font-semibold">Remarks</th>
                <th className="w-24 py-2" />
              </tr>
            </thead>
            <tbody>
              {detail.workers.map((w, i) => {
                const rowWarnings = warningsByStaff.get(w.staffId) ?? []
                const missing: string[] = []
                if (!w.staff.phone) missing.push('Mobile')
                if (!w.staff.passportNo) missing.push('Passport')
                if (!w.staff.bloodGroup) missing.push('Blood')
                return (
                  <tr
                    key={w.id}
                    className="border-b border-border/50 align-middle transition-colors hover:bg-muted/30"
                    draggable={canEdit && !readOnly}
                    onDragStart={() => (dragStaff.current = w.staffId)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => handleDrop(w.staffId)}
                  >
                    <td className="py-2 pl-1">
                      <div className="flex items-center gap-1">
                        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-gold/60 text-xs font-bold text-primary dark:border-gold/50">
                          {i + 1}
                        </span>
                        {canEdit && !readOnly ? (
                          <span className="flex flex-col">
                            <button
                              className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                              disabled={i === 0}
                              onClick={() => reorder(w.staffId, -1)}
                              title="Move up"
                            >
                              <ArrowUp className="h-3 w-3" />
                            </button>
                            <button
                              className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                              disabled={i === detail.workers.length - 1}
                              onClick={() => reorder(w.staffId, 1)}
                              title="Move down"
                            >
                              <ArrowDown className="h-3 w-3" />
                            </button>
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="py-2">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold">{w.staff.fullName}</span>
                        {missing.length > 0 ? (
                          <button
                            className="text-amber-600 hover:text-amber-700 dark:text-amber-400"
                            title={`Missing: ${missing.join(', ')} — click to update the employee record`}
                            onClick={() => openQuickFix(w.staffId, w.staff.fullName, w)}
                            disabled={!canEdit}
                          >
                            <TriangleAlert className="h-3.5 w-3.5" />
                          </button>
                        ) : null}
                      </div>
                      <p className="text-[13px] text-muted-foreground">
                        {w.staff.categoryName ?? w.staff.position ?? '—'}
                        {w.staff.nationality ? ` · ${w.staff.nationality}` : ''}
                        {w.staff.bloodGroup ? ` · ${w.staff.bloodGroup}` : ''}
                      </p>
                      {rowWarnings.map((rw, k) => (
                        <p key={k} className="text-xs text-amber-600 dark:text-amber-400">
                          ⚠ {rw.message}
                        </p>
                      ))}
                    </td>
                    <td className="py-2 font-mono text-[13px]">{w.staff.iqamaId}</td>
                    <td className="py-2 font-mono text-[13px]">{formatSaudiMobile(w.staff.phone)}</td>
                    {isInterview ? (
                      <td className="py-2">
                        {canEdit && !readOnly ? (
                          <Select
                            value={w.result ?? 'pending'}
                            onValueChange={(v) => saveResult(w.id, v === 'pending' ? null : (v as NameListWorkerResult))}
                          >
                            <SelectTrigger size="sm" className="h-9 w-full text-[13px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="pending">Pending</SelectItem>
                              <SelectItem value="selected">Selected</SelectItem>
                              <SelectItem value="rejected">Rejected</SelectItem>
                              <SelectItem value="absent">Absent</SelectItem>
                              <SelectItem value="onhold">On hold</SelectItem>
                            </SelectContent>
                          </Select>
                        ) : (
                          <Badge variant="outline" className={w.result ? NL_RESULT_META[w.result].chip : ''}>
                            {w.result ? NL_RESULT_META[w.result].label : 'Pending'}
                          </Badge>
                        )}
                      </td>
                    ) : (
                      <td className="py-2 font-mono text-[13px]">{w.staff.passportNo ?? '—'}</td>
                    )}
                    <td className="py-2">
                      {canEdit && !readOnly ? (
                        <Input
                          defaultValue={w.remarks ?? ''}
                          className="h-9 text-[13px]"
                          placeholder="Offered rate, reason…"
                          onBlur={(e) => {
                            if ((w.remarks ?? '') !== e.target.value) {
                              void saveResult(w.id, w.result, e.target.value)
                            }
                          }}
                        />
                      ) : (
                        <span className="text-[13px]">{w.remarks ?? '—'}</span>
                      )}
                    </td>
                    <td className="py-2 text-right">
                      {canEdit && !readOnly ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => removeWorker(w.staffId)}
                          title="Remove from list"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* workers list (mobile / tablet) */}
        <ul className="mt-3 space-y-2 lg:hidden">
          {detail.workers.map((w, i) => {
            const missing: string[] = []
            if (!w.staff.phone) missing.push('Mobile')
            if (!w.staff.passportNo) missing.push('Passport')
            if (!w.staff.bloodGroup) missing.push('Blood')
            const rowWarnings = warningsByStaff.get(w.staffId) ?? []
            return (
              <li key={w.id} className="rounded-lg border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-[15px] font-semibold">
                      <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-gold/60 text-[11px] font-bold text-primary dark:border-gold/50">
                        {i + 1}
                      </span>
                      {w.staff.fullName}
                      {missing.length > 0 ? (
                        <button
                          className="text-amber-600 dark:text-amber-400"
                          title={`Missing: ${missing.join(', ')}`}
                          onClick={() => openQuickFix(w.staffId, w.staff.fullName, w)}
                          disabled={!canEdit}
                        >
                          <TriangleAlert className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                    </p>
                    <p className="mt-0.5 text-[13px] text-muted-foreground">
                      {w.staff.categoryName ?? '—'}
                      {w.staff.nationality ? ` · ${w.staff.nationality}` : ''} · Iqama {w.staff.iqamaId}
                    </p>
                    <p className="text-[13px] text-muted-foreground">{formatSaudiMobile(w.staff.phone)}</p>
                    {rowWarnings.map((rw, k) => (
                      <p key={k} className="text-xs text-amber-600 dark:text-amber-400">
                        ⚠ {rw.message}
                      </p>
                    ))}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    {isInterview && canEdit && !readOnly ? (
                      <Select
                        value={w.result ?? 'pending'}
                        onValueChange={(v) => saveResult(w.id, v === 'pending' ? null : (v as NameListWorkerResult))}
                      >
                        <SelectTrigger size="sm" className="h-9 w-32 text-[13px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="pending">Pending</SelectItem>
                          <SelectItem value="selected">Selected</SelectItem>
                          <SelectItem value="rejected">Rejected</SelectItem>
                          <SelectItem value="absent">Absent</SelectItem>
                          <SelectItem value="onhold">On hold</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : isInterview ? (
                      <Badge variant="outline" className={w.result ? NL_RESULT_META[w.result].chip : ''}>
                        {w.result ? NL_RESULT_META[w.result].label : 'Pending'}
                      </Badge>
                    ) : null}
                    {canEdit && !readOnly ? (
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" disabled={i === 0} onClick={() => reorder(w.staffId, -1)}>
                          <ArrowUp className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          disabled={i === detail.workers.length - 1}
                          onClick={() => reorder(w.staffId, 1)}
                        >
                          <ArrowDown className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => removeWorker(w.staffId)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </div>
                {isInterview && canEdit && !readOnly ? (
                  <Input
                    defaultValue={w.remarks ?? ''}
                    className="mt-2 h-9 text-[13px]"
                    placeholder="Remarks (offered rate, reason…)"
                    onBlur={(e) => {
                      if ((w.remarks ?? '') !== e.target.value) {
                        void saveResult(w.id, w.result, e.target.value)
                      }
                    }}
                  />
                ) : w.remarks ? (
                  <p className="mt-1 text-[13px] text-muted-foreground">{w.remarks}</p>
                ) : null}
              </li>
            )
          })}
        </ul>

        {detail.workers.length === 0 ? (
          <div className="mt-4 rounded-lg border border-dashed p-6 text-center text-[15px] text-muted-foreground">
            No workers yet.{' '}
            {canEdit && !readOnly ? (
              <>
                <button className="font-medium text-primary underline-offset-2 hover:underline" onClick={() => setPickerOpen(true)}>
                  Add from the Employee database
                </button>
                {' or '}
                <button className="font-medium text-primary underline-offset-2 hover:underline" onClick={() => setQuickAddOpen(true)}>
                  type a new worker directly
                </button>
              </>
            ) : null}
          </div>
        ) : null}
      </SectionCard>

      {/* ── dialogs ── */}
      {pickerOpen ? (
        <WorkerPickerDialog
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          existingStaffIds={new Set(detail.workers.map((w) => w.staffId))}
          onAdd={addWorkers}
          listId={detail.id}
          onWorkerCreated={async () => {
            await load()
            onListMutated?.()
          }}
        />
      ) : null}

      {quickAddOpen ? (
        <QuickAddWorkerDialog
          open={quickAddOpen}
          onOpenChange={setQuickAddOpen}
          listId={detail.id}
          onSaved={async () => {
            await load()
            onListMutated?.()
          }}
        />
      ) : null}

      {headerOpen ? (
        <ListHeaderDialog
          open={headerOpen}
          onOpenChange={setHeaderOpen}
          list={detail}
          onSaved={async () => {
            await load()
            onListMutated?.()
          }}
        />
      ) : null}

      {shareOpen ? (
        <ShareDialog open={shareOpen} onOpenChange={setShareOpen} list={detail} onPrint={() => onPrint(detail)} />
      ) : null}

      {/* quick-fix missing data dialog */}
      {quickFix ? (
        <Dialog open onOpenChange={(o) => !o && setQuickFix(null)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Update employee record</DialogTitle>
              <DialogDescription>
                Fill the missing details for {quickFix.name} — they print on the name lists.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <Label>Mobile No.</Label>
                <Input
                  value={quickValues.phone}
                  onChange={(e) => setQuickValues((v) => ({ ...v, phone: e.target.value }))}
                  placeholder="05X XXX XXXX"
                />
              </div>
              <div className="grid gap-1.5">
                <Label>Passport No.</Label>
                <Input
                  value={quickValues.passportNo}
                  onChange={(e) => setQuickValues((v) => ({ ...v, passportNo: e.target.value }))}
                />
              </div>
              <div className="grid gap-1.5">
                <Label>Blood Group</Label>
                <Select
                  value={quickValues.bloodGroup}
                  onValueChange={(v) => setQuickValues((s) => ({ ...s, bloodGroup: v }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    {['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((b) => (
                      <SelectItem key={b} value={b}>
                        {b}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setQuickFix(null)}>
                Cancel
              </Button>
              <Button onClick={saveQuickFix} disabled={busy}>
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      {/* status confirmation */}
      <Dialog open={confirmStatus !== null} onOpenChange={(o) => !o && setConfirmStatus(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {confirmStatus === 'completed'
                ? 'Mark this list Completed?'
                : confirmStatus === 'cancelled'
                  ? 'Cancel this list?'
                  : confirmStatus === 'sent'
                    ? 'Mark this list as Sent?'
                    : 'Move back to Draft?'}
            </DialogTitle>
            <DialogDescription>
              {confirmStatus === 'completed' && detail.subjectKind === 'mobilization'
                ? detail.subjectName.toLowerCase().startsWith('demob')
                  ? 'Every worker on this list will be released from the site and return to Available.'
                  : 'Every worker on this list will be marked Deployed and assigned to the site (start date = list date).'
                : confirmStatus === 'completed'
                  ? 'The list becomes read-only. Results already saved stay as they are.'
                  : confirmStatus === 'cancelled'
                    ? 'The list becomes read-only. Pending workers return to Available.'
                    : 'The list stays editable.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmStatus(null)}>
              Keep as is
            </Button>
            <Button
              onClick={() => confirmStatus && changeStatus(confirmStatus)}
              disabled={busy}
              variant={confirmStatus === 'cancelled' ? 'destructive' : 'default'}
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-[15px]">{value}</p>
    </div>
  )
}

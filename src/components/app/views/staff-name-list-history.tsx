'use client'

// Staff → "Name List history" dialog: every list this employee has been on —
// dates, companies, subjects and their result on each list.
import { useEffect, useState } from 'react'
import { ClipboardList } from 'lucide-react'

import { api, qs } from '@/lib/api-client'
import { useAppStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { NL_RESULT_META, NL_STATUS_META, nlDateInput } from '@/lib/name-list-utils'
import type { NameListRow, Paginated, StaffRow } from '@/lib/types'

import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { EmptyState } from '@/components/app/shared/empty-state'

type HistoryRow = NameListRow & {
  staffResult?: string | null
  staffRemarks?: string | null
}

export function StaffNameListHistory({
  staff,
  onOpenList,
  onOpenChange,
}: {
  staff: StaffRow | null
  /** navigates to the Name List module and opens the list */
  onOpenList?: (id: string) => void
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={staff !== null} onOpenChange={onOpenChange}>
      <DialogContent className="nice-scrollbar max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4" /> Name List history
          </DialogTitle>
          <DialogDescription>
            {staff ? `${staff.fullName} — every list, date, company and result.` : ''}
          </DialogDescription>
        </DialogHeader>
        {/* keyed by staff id → fresh state per employee */}
        {staff ? <HistoryContent key={staff.id} staff={staff} onOpenList={onOpenList} /> : null}
      </DialogContent>
    </Dialog>
  )
}

function HistoryContent({
  staff,
  onOpenList,
}: {
  staff: StaffRow
  onOpenList?: (id: string) => void
}) {
  const setView = useAppStore((s) => s.setView)
  const setPendingIntent = useAppStore((s) => s.setPendingIntent)
  const [rows, setRows] = useState<HistoryRow[] | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .get<Paginated<HistoryRow>>(
        `/api/name-lists${qs({ staffId: staff.id, page: 1, pageSize: 50 })}`
      )
      .then((r) => {
        if (!cancelled) setRows(r.data)
      })
      .catch(() => {
        if (!cancelled) setRows([])
      })
    return () => {
      cancelled = true
    }
  }, [staff.id])

  function openList(id: string) {
    onOpenList?.(id)
    setView('name-list')
    setPendingIntent({ view: 'name-list', kind: 'record', recordId: id })
  }

  return (
    <>
        {rows === null ? (
          <div className="space-y-2 py-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-14 animate-pulse rounded-md bg-muted" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title="No lists yet"
            description="This worker has not been on any interview or mobilization list."
            className="py-8"
          />
        ) : (
          <ul className="space-y-1.5">
            {rows.map((l) => {
              return (
                <li key={l.id}>
                  <button
                    className="flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left transition-colors hover:border-primary/40 hover:bg-muted/40"
                    onClick={() => openList(l.id)}
                    title="Open this list"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white"
                          style={{ background: l.subjectColor }}
                        >
                          {l.subjectName}
                        </span>
                        <span className="font-mono text-xs font-bold">{l.listNo}</span>
                        <Badge variant="outline" className={cn('text-[10px]', NL_STATUS_META[l.status].chip)}>
                          {NL_STATUS_META[l.status].label}
                        </Badge>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {nlDateInput(l.date)}
                        {l.time ? ` · ${l.time}` : ''} · {l.clientName}
                        {l.subjectKind === 'mobilization'
                          ? l.projectName
                            ? ` · ${l.projectName}`
                            : ''
                          : l.location
                            ? ` · ${l.location}`
                            : ''}
                      </p>
                      {l.staffRemarks ? (
                        <p className="truncate text-[11px] text-muted-foreground">
                          Remarks: {l.staffRemarks}
                        </p>
                      ) : null}
                    </div>
                    {l.staffResult ? (
                      <Badge
                        variant="outline"
                        className={cn(
                          'shrink-0 text-[10px]',
                          NL_RESULT_META[l.staffResult as keyof typeof NL_RESULT_META]?.chip ?? ''
                        )}
                      >
                        {NL_RESULT_META[l.staffResult as keyof typeof NL_RESULT_META]?.label ?? l.staffResult}
                      </Badge>
                    ) : null}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
    </>
  )
}

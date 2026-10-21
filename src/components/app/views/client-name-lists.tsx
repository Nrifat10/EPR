'use client'

// Client detail → "Name Lists" section: every worker list this company has,
// newest first, grouped by date, with subject badge, worker count, status and
// a deep-link that opens the list in the Name List module.
import { useEffect, useMemo, useState } from 'react'
import { ChevronRight, ClipboardList } from 'lucide-react'

import { api, qs } from '@/lib/api-client'
import { useAppStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { NL_STATUS_META, nlDateInput } from '@/lib/name-list-utils'
import type { NameListRow, Paginated } from '@/lib/types'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/app/shared/empty-state'

type ListsResponse = Paginated<NameListRow>

export function ClientNameLists({ clientId }: { clientId: string }) {
  const setView = useAppStore((s) => s.setView)
  const setPendingIntent = useAppStore((s) => s.setPendingIntent)
  const [rows, setRows] = useState<NameListRow[] | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .get<ListsResponse>(`/api/name-lists${qs({ clientId, page: 1, pageSize: 50 })}`)
      .then((r) => {
        if (!cancelled) setRows(r.data)
      })
      .catch(() => {
        if (!cancelled) setRows([])
      })
    return () => {
      cancelled = true
    }
  }, [clientId])

  const groups = useMemo(() => {
    const map = new Map<string, NameListRow[]>()
    for (const r of rows ?? []) {
      const key = nlDateInput(r.date)
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(r)
    }
    return [...map.entries()]
  }, [rows])

  function openList(id: string) {
    setView('name-list')
    setPendingIntent({ view: 'name-list', kind: 'record', recordId: id })
  }

  return (
    <div>
      <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold">
        <ClipboardList className="h-4 w-4" />
        Name Lists
        <span className="ml-1 text-muted-foreground tabular-nums">({rows?.length ?? 0})</span>
      </h3>
      {rows === null ? (
        <div className="space-y-1.5 py-1">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-9 animate-pulse rounded-md bg-muted" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No lists yet"
          description="Interview, mobilization and demobilization lists for this company appear here."
          className="py-6"
        />
      ) : (
        <ul className="nice-scrollbar max-h-96 space-y-2 overflow-y-auto">
          {groups.map(([date, lists]) => (
            <li key={date}>
              <p className="sticky top-0 z-10 -mx-1 bg-background/95 px-1 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur">
                {date}
              </p>
              <ul className="mt-1 space-y-1">
                {lists.map((l) => (
                  <li key={l.id}>
                    <button
                      className="flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left transition-colors hover:border-primary/40 hover:bg-muted/40"
                      onClick={() => openList(l.id)}
                      title={`Open ${l.listNo} in the Name List module`}
                    >
                      <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white" style={{ background: l.subjectColor }}>
                        {l.subjectName}
                      </span>
                      <span className="shrink-0 font-mono text-xs font-bold">{l.listNo}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {l.time ? `${l.time} · ` : ''}
                        {l.subjectKind === 'mobilization' ? l.projectName ?? l.location ?? '' : l.location ?? ''}
                      </span>
                      <span className="ml-auto flex shrink-0 items-center gap-1.5">
                        <span className="text-xs tabular-nums">
                          <b>{l.workerCount}</b>
                          <span className="text-muted-foreground">w</span>
                        </span>
                        <Badge variant="outline" className={cn('text-[10px]', NL_STATUS_META[l.status].chip)}>
                          {NL_STATUS_META[l.status].label}
                        </Badge>
                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      {rows !== null && rows.length > 0 ? (
        <Button
          variant="ghost"
          size="sm"
          className="mt-1.5 h-7 px-2 text-xs text-muted-foreground"
          onClick={() => setView('name-list')}
        >
          Manage all lists in the Name List module <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      ) : null}
    </div>
  )
}

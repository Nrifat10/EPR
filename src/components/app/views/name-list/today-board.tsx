'use client'

// Today's Lists board — every list for the selected day (default today),
// grouped by client company, with subject badge, list no., time, location /
// site, worker count and results so far. Several lists can be selected and
// printed together in one PDF.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { CalendarDays, ChevronRight, Printer, Users } from 'lucide-react'

import { api, qs } from '@/lib/api-client'
import { can, useAppStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { NL_RESULT_META, NL_STATUS_META, nlDateInput } from '@/lib/name-list-utils'
import type { NameListDetail, NameListRow } from '@/lib/types'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { SectionCard } from '../../shared/page-header'
import { EmptyState } from '../../shared/empty-state'

type TodayResponse = {
  date: string
  groups: { clientId: string; clientName: string; lists: NameListRow[] }[]
}

export function TodayBoard({
  onOpenList,
  onPrintLists,
}: {
  onOpenList: (id: string) => void
  onPrintLists: (lists: NameListDetail[]) => void
}) {
  const user = useAppStore((s) => s.user)
  const canPrint = can(user, 'namelist.view')
  const [date, setDate] = useState(nlDateInput(new Date()))
  const [data, setData] = useState<TodayResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [printing, setPrinting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get<TodayResponse>(`/api/name-lists/today${qs({ date })}`)
      setData(res)
      setSelected(new Set())
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load today\u2019s lists')
    } finally {
      setLoading(false)
    }
  }, [date])

  useEffect(() => {
    void load()
  }, [load])

  const allLists = useMemo(
    () => data?.groups.flatMap((g) => g.lists) ?? [],
    [data]
  )

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function printSelected() {
    if (selected.size === 0) return
    setPrinting(true)
    try {
      const details = await Promise.all(
        [...selected].map((id) => api.get<NameListDetail>(`/api/name-lists/${id}`))
      )
      onPrintLists(details)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load lists for printing')
    } finally {
      setPrinting(false)
    }
  }

  const totals = useMemo(() => {
    let lists = 0
    let workers = 0
    const companies = new Set<string>()
    for (const g of data?.groups ?? []) {
      companies.add(g.clientId)
      for (const l of g.lists) {
        lists++
        workers += l.workerCount
      }
    }
    return { lists, workers, companies: companies.size }
  }, [data])

  return (
    <div className="flex flex-col gap-4">
      <SectionCard>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-base font-semibold">
              <CalendarDays className="h-4 w-4" /> Today&rsquo;s Lists
            </h3>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              {totals.lists} list{totals.lists === 1 ? '' : 's'} · {totals.workers} worker
              {totals.workers === 1 ? '' : 's'} · {totals.companies} compan
              {totals.companies === 1 ? 'y' : 'ies'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-40"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDate(nlDateInput(new Date()))}
            >
              Today
            </Button>
            {canPrint && selected.size > 0 ? (
              <Button size="sm" onClick={printSelected} disabled={printing}>
                <Printer className="h-4 w-4" />
                Print {selected.size} list{selected.size === 1 ? '' : 's'} — one PDF
              </Button>
            ) : null}
          </div>
        </div>
      </SectionCard>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      ) : !data || data.groups.length === 0 ? (
        <SectionCard>
          <EmptyState
            icon={CalendarDays}
            title="No lists for this day"
            description="Create interview or mobilization lists from the Lists tab."
          />
        </SectionCard>
      ) : (
        <div className="space-y-4">
          {data.groups.map((g) => (
            <SectionCard key={g.clientId}>
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-[15px] font-bold">{g.clientName}</h4>
                <Badge variant="outline" className="gap-1">
                  <Users className="h-3 w-3" />
                  {g.lists.length} list{g.lists.length === 1 ? '' : 's'} ·{' '}
                  {g.lists.reduce((s, l) => s + l.workerCount, 0)} workers
                </Badge>
              </div>
              <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {g.lists.map((l) => (
                  <div
                    key={l.id}
                    className={cn(
                      'group rounded-lg border p-3 transition-colors hover:border-primary/40',
                      selected.has(l.id) && 'border-primary/50 bg-primary/5'
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span
                            className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white"
                            style={{ background: l.subjectColor }}
                          >
                            {l.subjectName}
                          </span>
                          <Badge variant="outline" className={cn('text-[10px]', NL_STATUS_META[l.status].chip)}>
                            {NL_STATUS_META[l.status].label}
                          </Badge>
                        </div>
                        <p className="mt-1.5 font-mono text-[15px] font-bold">{l.listNo}</p>
                        <p className="text-[13px] text-muted-foreground">
                          {l.time ?? '—'}
                          {l.subjectKind === 'mobilization'
                            ? ` · ${l.projectName ?? l.location ?? 'site —'}`
                            : l.location
                              ? ` · ${l.location}`
                              : ''}
                        </p>
                        <p className="mt-1 text-[13px]">
                          <b>{l.workerCount}</b> worker{l.workerCount === 1 ? '' : 's'}
                          {l.subjectKind === 'interview' && l.resultCounts.selected + l.resultCounts.rejected + l.resultCounts.absent > 0 ? (
                            <span className="ml-1.5 inline-flex flex-wrap gap-1">
                              {(['selected', 'rejected', 'absent'] as const).map((r) =>
                                l.resultCounts[r] > 0 ? (
                                  <span
                                    key={r}
                                    className={cn(
                                      'rounded-full border px-1.5 py-px text-[11px] font-medium',
                                      NL_RESULT_META[r].chip
                                    )}
                                  >
                                    {NL_RESULT_META[r].label} {l.resultCounts[r]}
                                  </span>
                                ) : null
                              )}
                            </span>
                          ) : null}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1.5">
                        <Checkbox
                          checked={selected.has(l.id)}
                          onCheckedChange={() => toggle(l.id)}
                          aria-label={`Select ${l.listNo} for printing`}
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => onOpenList(l.id)}
                        >
                          Open <ChevronRight className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </SectionCard>
          ))}
        </div>
      )}
    </div>
  )
}

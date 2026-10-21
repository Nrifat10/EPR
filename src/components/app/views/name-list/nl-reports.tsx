'use client'

// Name List reports — three tabs:
//   1. Interview success rate (Selected ÷ interviewed) by company / trade / month
//   2. Lists & workers sent per company per day / week / month
//   3. Workers with the most Rejected / Absent results
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { BarChart3, Percent, TrendingDown, TrendingUp, Users } from 'lucide-react'

import { api, qs } from '@/lib/api-client'
import { cn } from '@/lib/utils'
import { nlFormatDate } from '@/lib/name-list-utils'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SectionCard } from '../../shared/page-header'
import { EmptyState } from '../../shared/empty-state'
import { TableSkeleton } from '../../shared/empty-state'

type SuccessRow = {
  key: string
  interviewed: number
  selected: number
  rejected: number
  absent: number
  rate: number
}
type SuccessData = { byCompany: SuccessRow[]; byTrade: SuccessRow[]; byMonth: SuccessRow[] }
type VolumeData = {
  rows: {
    clientName: string
    totalLists: number
    totalWorkers: number
    periods: { period: string; lists: number; workers: number }[]
  }[]
}
type ProblemData = {
  workers: {
    staffId: string
    name: string
    trade: string
    rejected: number
    absent: number
    total: number
    events: {
      listNo: string
      date: string
      client: string
      subject: string
      result: string | null
      remarks: string | null
    }[]
  }[]
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function monthLabel(key: string): string {
  const [y, m] = key.split('-')
  return `${MONTHS[parseInt(m, 10) - 1] ?? m} ${y}`
}

export function NLReports() {
  const [tab, setTab] = useState('success')
  const defaultFrom = new Date()
  defaultFrom.setMonth(defaultFrom.getMonth() - 5)
  const [from, setFrom] = useState(defaultFrom.toISOString().slice(0, 10))
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10))
  const [group, setGroup] = useState('month')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState<SuccessData | null>(null)
  const [volume, setVolume] = useState<VolumeData | null>(null)
  const [problem, setProblem] = useState<ProblemData | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      if (tab === 'success') {
        setSuccess(await api.get<SuccessData>(`/api/name-lists/reports${qs({ type: 'success-rate', from, to })}`))
      } else if (tab === 'volume') {
        setVolume(await api.get<VolumeData>(`/api/name-lists/reports${qs({ type: 'volume', from, to, group })}`))
      } else {
        setProblem(await api.get<ProblemData>(`/api/name-lists/reports${qs({ type: 'problem-workers', from, to })}`))
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load report')
    } finally {
      setLoading(false)
    }
  }, [tab, from, to, group])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="flex flex-col gap-4">
      <SectionCard>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <BarChart3 className="h-4 w-4" /> Name List reports
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Interview success, sending volume and problem workers.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-36" />
            <span className="text-xs text-muted-foreground">to</span>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-36" />
            {tab === 'volume' ? (
              <Tabs value={group} onValueChange={setGroup}>
                <TabsList className="h-8">
                  <TabsTrigger value="day" className="h-6 px-2.5 text-xs">Day</TabsTrigger>
                  <TabsTrigger value="week" className="h-6 px-2.5 text-xs">Week</TabsTrigger>
                  <TabsTrigger value="month" className="h-6 px-2.5 text-xs">Month</TabsTrigger>
                </TabsList>
              </Tabs>
            ) : null}
            <Button variant="outline" size="sm" onClick={() => void load()}>
              Refresh
            </Button>
          </div>
        </div>
        <div className="mt-3">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="success">
                <Percent className="mr-1.5 h-3.5 w-3.5" /> Success rate
              </TabsTrigger>
              <TabsTrigger value="volume">
                <TrendingUp className="mr-1.5 h-3.5 w-3.5" /> Volume sent
              </TabsTrigger>
              <TabsTrigger value="problems">
                <TrendingDown className="mr-1.5 h-3.5 w-3.5" /> Problem workers
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </SectionCard>

      {loading ? (
        <SectionCard>
          <TableSkeleton rows={5} />
        </SectionCard>
      ) : tab === 'success' && success ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <SuccessTable title="By company" rows={success.byCompany} />
          <SuccessTable title="By trade" rows={success.byTrade} />
          <SuccessTable title="By month" rows={success.byMonth} isMonth />
        </div>
      ) : tab === 'volume' && volume ? (
        <SectionCard>
          {volume.rows.length === 0 ? (
            <EmptyState icon={TrendingUp} title="No lists in this period" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-3 font-semibold">Company</th>
                    {volume.rows[0]?.periods.map((p) => (
                      <th key={p.period} className="py-2 px-2 text-center font-semibold">
                        {group === 'month' ? monthLabel(p.period) : p.period}
                      </th>
                    ))}
                    <th className="py-2 pl-3 text-right font-semibold">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {volume.rows.map((r) => (
                    <tr key={r.clientName} className="border-b border-border/50">
                      <td className="py-2 pr-3 font-medium">{r.clientName}</td>
                      {volume.rows[0].periods.map((p) => {
                        const cell = r.periods.find((x) => x.period === p.period)
                        return (
                          <td key={p.period} className="py-2 px-2 text-center text-xs">
                            {cell ? (
                              <span>
                                <b>{cell.lists}</b> list{cell.lists === 1 ? '' : 's'}
                                <span className="text-muted-foreground"> · {cell.workers}w</span>
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                        )
                      })}
                      <td className="py-2 pl-3 text-right text-xs">
                        <b>{r.totalLists}</b> lists · <b>{r.totalWorkers}</b> workers
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      ) : tab === 'problems' && problem ? (
        <SectionCard>
          {problem.workers.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No rejected or absent results in this period"
              description="Workers with clean interview records — nothing to worry about."
            />
          ) : (
            <div className="space-y-2">
              {problem.workers.map((w, i) => (
                <div key={w.staffId} className="rounded-lg border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-gold/60 text-[11px] font-bold text-primary dark:border-gold/50">
                        {i + 1}
                      </span>
                      <div>
                        <p className="text-sm font-medium">{w.name}</p>
                        <p className="text-xs text-muted-foreground">{w.trade}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {w.rejected > 0 ? (
                        <Badge variant="outline" className="border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300">
                          {w.rejected} rejected
                        </Badge>
                      ) : null}
                      {w.absent > 0 ? (
                        <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300">
                          {w.absent} absent
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                  <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                    {w.events.map((e, k) => (
                      <li key={k}>
                        {nlFormatDate(e.date)} · {e.listNo} · {e.client} · {e.subject} →{' '}
                        <b className={e.result === 'rejected' ? 'text-rose-600' : 'text-amber-600'}>
                          {e.result}
                        </b>
                        {e.remarks ? ` — ${e.remarks}` : ''}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      ) : null}
    </div>
  )
}

function SuccessTable({ title, rows, isMonth }: { title: string; rows: SuccessRow[]; isMonth?: boolean }) {
  const maxInterviewed = Math.max(1, ...rows.map((r) => r.interviewed))
  return (
    <SectionCard>
      <h4 className="text-sm font-semibold">{title}</h4>
      {rows.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">
          No interview results recorded in this period.
        </p>
      ) : (
        <ul className="mt-3 space-y-2.5">
          {rows.slice(0, 8).map((r) => (
            <li key={r.key}>
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className="truncate font-medium">{isMonth ? monthLabel(r.key) : r.key}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {r.selected}/{r.interviewed} selected
                </span>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-emerald-600/80"
                    style={{ width: `${(r.interviewed / maxInterviewed) * 100}%` }}
                  />
                </div>
                <span
                  className={cn(
                    'w-10 shrink-0 text-right text-xs font-bold tabular-nums',
                    r.rate >= 50 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'
                  )}
                >
                  {r.rate}%
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  )
}

'use client'

// Accounts Summary — income vs expense analysis with chart,
// category breakdown and monthly table. Printable as a Financial Statement.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  BarChart3,
  Printer,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react'

import { api, qs } from '@/lib/api-client'
import { formatDate, formatMoney, formatNumber, toDateInputValue } from '@/lib/format'
import { useAppStore } from '@/lib/store'
import type { Paginated, ProjectRow, TransactionType } from '@/lib/types'
import { cn } from '@/lib/utils'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

import { EmptyState } from '../shared/empty-state'
import { FilterBar, FilterSelect } from '../shared/filter-select'
import { PageHeader, SectionCard } from '../shared/page-header'
import { StatCard } from '../shared/stat-card'

type SummaryData = {
  totals: { income: number; expense: number; net: number }
  byMonth: { month: string; label: string; income: number; expense: number; net: number }[]
  byCategory: { name: string; type: TransactionType; amount: number }[]
  range: { from: string; to: string }
}
type ProjectsResponse = Paginated<ProjectRow>

/** First day of the month 6 months ago (matches the API default range). */
function defaultFrom(): string {
  const now = new Date()
  return toDateInputValue(new Date(now.getFullYear(), now.getMonth() - 6, 1))
}

/** Compact number for the chart Y axis: 1275000 → "1.3M", 45000 → "45k". */
function compactNumber(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (Math.abs(v) >= 1_000) return `${Math.round(v / 1_000)}k`
  return `${v}`
}

type TooltipPayloadItem = {
  name?: string | number
  value?: number | string
  color?: string
}

function MoneyTooltip({
  active,
  payload,
  label,
  currency,
}: {
  active?: boolean
  payload?: TooltipPayloadItem[]
  label?: string | number
  currency: string
}) {
  if (!active || !payload || payload.length === 0) return null
  return (
    <div className="min-w-[190px] rounded-lg border bg-popover px-3 py-2 text-popover-foreground shadow-md">
      <p className="mb-1.5 text-xs font-semibold">{label}</p>
      <div className="space-y-1">
        {payload.map((item, i) => (
          <div key={i} className="flex items-center justify-between gap-4 text-xs">
            <span className="flex items-center gap-1.5">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: item.color }}
              />
              {item.name}
            </span>
            <span className="font-medium tabular-nums">
              {formatMoney(Number(item.value ?? 0), currency)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function SummarySkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading accounts summary">
      <div className="grid gap-4 sm:grid-cols-3 sm:gap-6">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="h-[116px] animate-pulse rounded-xl border bg-muted/40"
            style={{ animationDelay: `${i * 80}ms` }}
          />
        ))}
      </div>
      <div className="mt-4 h-[380px] animate-pulse rounded-xl border bg-muted/40 sm:mt-6" />
      <div className="mt-4 grid gap-4 sm:mt-6 lg:grid-cols-2">
        <div className="h-[300px] animate-pulse rounded-xl border bg-muted/40" />
        <div className="h-[300px] animate-pulse rounded-xl border bg-muted/40" />
      </div>
    </div>
  )
}

function CategoryBreakdown({
  title,
  icon: Icon,
  items,
  tone,
  currency,
}: {
  title: string
  icon: React.ComponentType<{ className?: string }>
  items: { name: string; amount: number }[]
  tone: 'income' | 'expense'
  currency: string
}) {
  const total = useMemo(() => items.reduce((s, i) => s + i.amount, 0), [items])
  const max = useMemo(() => Math.max(...items.map((i) => i.amount), 1), [items])

  return (
    <SectionCard className="overflow-hidden">
      <div className="border-b p-4 sm:p-5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold sm:text-base">{title}</h3>
          <span
            className={cn(
              'rounded-full border px-2.5 py-0.5 text-xs font-semibold tabular-nums',
              tone === 'income'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300'
                : 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-300'
            )}
          >
            {formatMoney(total, currency)}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {items.length} {items.length === 1 ? 'category' : 'categories'} in this period
        </p>
      </div>
      {items.length === 0 ? (
        <EmptyState
          icon={Icon}
          title="No categories"
          description={`No ${tone} transactions were recorded in the selected period.`}
          className="py-10"
        />
      ) : (
        <ul className="nice-scrollbar max-h-80 space-y-3 overflow-y-auto p-4 sm:p-5">
          {items.map((item) => {
            const share = total > 0 ? Math.round((item.amount / total) * 100) : 0
            return (
              <li key={item.name}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="truncate font-medium">{item.name}</span>
                  <span className="shrink-0 font-semibold tabular-nums">
                    {formatMoney(item.amount, currency)}
                  </span>
                </div>
                <div className="mt-1.5 flex items-center gap-2.5">
                  <Progress
                    value={(item.amount / max) * 100}
                    aria-label={`${item.name} share`}
                    className={cn(
                      'h-1.5',
                      tone === 'income'
                        ? 'bg-emerald-500/15 [&>[data-slot=progress-indicator]]:bg-emerald-500'
                        : 'bg-rose-500/15 [&>[data-slot=progress-indicator]]:bg-rose-500'
                    )}
                  />
                  <span className="w-10 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                    {share}%
                  </span>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </SectionCard>
  )
}

export function AccountsSummaryView() {
  const { settings } = useAppStore()
  const currency = settings.currency

  const [from, setFrom] = useState(defaultFrom)
  const [to, setTo] = useState(() => toDateInputValue(new Date()))
  const [projectId, setProjectId] = useState('all')

  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [data, setData] = useState<SummaryData | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get<SummaryData>(
        `/api/accounts/summary${qs({
          from,
          to,
          projectId: projectId === 'all' ? '' : projectId,
        })}`
      )
      setData(res)
    } catch (e) {
      setData(null)
      toast.error(e instanceof Error ? e.message : 'Failed to load accounts summary')
    } finally {
      setLoading(false)
    }
  }, [from, to, projectId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    let cancelled = false
    api
      .get<ProjectsResponse>('/api/projects?pageSize=100')
      .then((res) => {
        if (!cancelled) setProjects(res.data)
      })
      .catch(() => {
        // project filter simply stays unavailable
      })
    return () => {
      cancelled = true
    }
  }, [])

  const incomeCats = useMemo(
    () =>
      (data?.byCategory ?? [])
        .filter((c) => c.type === 'income')
        .map((c) => ({ name: c.name, amount: c.amount })),
    [data]
  )
  const expenseCats = useMemo(
    () =>
      (data?.byCategory ?? [])
        .filter((c) => c.type === 'expense')
        .map((c) => ({ name: c.name, amount: c.amount })),
    [data]
  )

  const hasData = (data?.totals.income ?? 0) !== 0 || (data?.totals.expense ?? 0) !== 0
  const rangeLabel = `${formatDate(from)} – ${formatDate(to)}`
  const projectLabel =
    projectId !== 'all'
      ? `  ·  Project: ${projects.find((p) => p.id === projectId)?.name ?? '—'}`
      : ''

  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      <div className="print-hidden">
        <PageHeader
          title="Accounts Summary"
          description="Income vs expense performance across the selected period"
        >
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="h-4 w-4" />
            Print Statement
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load()}
            disabled={loading}
          >
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            Refresh
          </Button>
        </PageHeader>
      </div>

      <FilterBar
        className="print-hidden"
        activeCount={(from !== defaultFrom() ? 1 : 0) + (projectId !== 'all' ? 1 : 0)}
      >
        <div className="flex items-center gap-2">
          <Input
            type="date"
            aria-label="From date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="h-9 w-full text-muted-foreground sm:w-[160px]"
          />
          <span className="shrink-0 text-xs text-muted-foreground">to</span>
          <Input
            type="date"
            aria-label="To date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="h-9 w-full text-muted-foreground sm:w-[160px]"
          />
        </div>
        <FilterSelect
          value={projectId}
          onChange={setProjectId}
          options={projects.map((p) => ({ value: p.id, label: p.name }))}
          placeholder="Project"
          className="sm:w-[220px]"
        />
        <Button
          variant="ghost"
          size="sm"
          className="h-9 text-muted-foreground"
          onClick={() => {
            setFrom(defaultFrom())
            setTo(toDateInputValue(new Date()))
            setProjectId('all')
          }}
        >
          Reset
        </Button>
      </FilterBar>

      {loading ? (
        <SummarySkeleton />
      ) : !data ? (
        <SectionCard className="overflow-hidden">
          <EmptyState
            icon={BarChart3}
            title="Summary unavailable"
            description="The accounts summary could not be loaded. Try refreshing."
            className="py-16"
          />
        </SectionCard>
      ) : (
        <div className="print-area">
          {/* print-only statement header */}
          <div className="mb-4 hidden print:block">
            <p className="text-lg font-bold">{settings.companyName}</p>
            <p className="mt-0.5 text-sm font-semibold">Financial Statement</p>
            <p className="mt-0.5 text-xs">
              {rangeLabel}
              {projectLabel}
            </p>
            <p className="text-xs">Generated on {formatDate(new Date())}</p>
          </div>

          {/* top cards */}
          <div className="grid gap-4 sm:grid-cols-3 sm:gap-6">
            <StatCard
              title="Total Income"
              value={formatNumber(data.totals.income)}
              valuePrefix={currency}
              icon={TrendingUp}
              tone="green"
              sublabel="All income in range"
            />
            <StatCard
              title="Total Expense"
              value={formatNumber(data.totals.expense)}
              valuePrefix={currency}
              icon={TrendingDown}
              tone="red"
              sublabel="All expenses in range"
            />
            <StatCard
              title="Net Balance"
              value={formatNumber(data.totals.net)}
              valuePrefix={currency}
              icon={Wallet}
              tone={data.totals.net >= 0 ? 'gold' : 'red'}
              sublabel="Income − Expense"
            />
          </div>

          {hasData ? (
            <>
              {/* monthly chart */}
              <SectionCard className="mt-4 overflow-hidden sm:mt-6">
                <div className="flex flex-col gap-2 border-b p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                  <div>
                    <h3 className="text-sm font-semibold sm:text-base">
                      Monthly Performance
                    </h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Income vs expense per month
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                      Income
                    </span>
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span className="h-2.5 w-2.5 rounded-full bg-rose-500" />
                      Expense
                    </span>
                  </div>
                </div>
                <div className="h-[300px] w-full p-2 text-muted-foreground sm:p-4">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={data.byMonth}
                      margin={{ top: 12, right: 12, left: 4, bottom: 4 }}
                    >
                      <defs>
                        <linearGradient id="ligIncomeFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.32} />
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0.02} />
                        </linearGradient>
                        <linearGradient id="ligExpenseFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.32} />
                          <stop offset="95%" stopColor="#f43f5e" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        stroke="currentColor"
                        strokeOpacity={0.25}
                        strokeDasharray="4 4"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="label"
                        tickLine={false}
                        axisLine={false}
                        tickMargin={8}
                        tick={{ fontSize: 11, fill: 'currentColor' }}
                      />
                      <YAxis
                        tickLine={false}
                        axisLine={false}
                        width={56}
                        tick={{ fontSize: 11, fill: 'currentColor' }}
                        tickFormatter={(v: number) => compactNumber(v)}
                      />
                      <Tooltip
                        content={<MoneyTooltip currency={currency} />}
                        cursor={{
                          stroke: 'currentColor',
                          strokeOpacity: 0.3,
                          strokeDasharray: '4 4',
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey="income"
                        name="Income"
                        stroke="#10b981"
                        strokeWidth={2}
                        fill="url(#ligIncomeFill)"
                        dot={false}
                        activeDot={{ r: 4 }}
                      />
                      <Area
                        type="monotone"
                        dataKey="expense"
                        name="Expense"
                        stroke="#f43f5e"
                        strokeWidth={2}
                        fill="url(#ligExpenseFill)"
                        dot={false}
                        activeDot={{ r: 4 }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </SectionCard>

              {/* category breakdown */}
              <div className="mt-4 grid gap-4 sm:mt-6 lg:grid-cols-2">
                <CategoryBreakdown
                  title="Income by Category"
                  icon={TrendingUp}
                  items={incomeCats}
                  tone="income"
                  currency={currency}
                />
                <CategoryBreakdown
                  title="Expense by Category"
                  icon={TrendingDown}
                  items={expenseCats}
                  tone="expense"
                  currency={currency}
                />
              </div>

              {/* monthly table */}
              <SectionCard className="mt-4 overflow-hidden sm:mt-6">
                <div className="border-b p-4 sm:p-5">
                  <h3 className="text-sm font-semibold sm:text-base">
                    Monthly Breakdown
                  </h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {rangeLabel}
                  </p>
                </div>
                {/* Mobile: stacked cards (income / expense / net per month) */}
                <ul className="space-y-3 p-4 sm:p-6 md:hidden print:hidden">
                  {data.byMonth.map((m) => (
                    <li
                      key={m.month}
                      className="rounded-xl border bg-card p-3 shadow-sm transition-colors hover:bg-muted/30"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-medium">{m.label}</p>
                        <span
                          className={cn(
                            'shrink-0 text-sm font-bold tabular-nums',
                            m.net >= 0
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : 'text-rose-700 dark:text-rose-400'
                          )}
                        >
                          {formatMoney(m.net, currency)}
                        </span>
                      </div>
                      <div className="mt-2.5 grid grid-cols-2 gap-2 text-xs">
                        <div className="rounded-lg bg-emerald-50 px-2.5 py-1.5 dark:bg-emerald-950/40">
                          <p className="flex items-center gap-1 text-emerald-700 dark:text-emerald-300">
                            <TrendingUp className="h-3 w-3" />
                            Income
                          </p>
                          <p className="mt-0.5 font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                            {formatMoney(m.income, currency)}
                          </p>
                        </div>
                        <div className="rounded-lg bg-rose-50 px-2.5 py-1.5 dark:bg-rose-950/40">
                          <p className="flex items-center gap-1 text-rose-700 dark:text-rose-300">
                            <TrendingDown className="h-3 w-3" />
                            Expense
                          </p>
                          <p className="mt-0.5 font-semibold tabular-nums text-rose-700 dark:text-rose-400">
                            {formatMoney(m.expense, currency)}
                          </p>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
                {/* Desktop: table */}
                <div className="hidden md:block print:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Month</TableHead>
                      <TableHead className="text-right">Income</TableHead>
                      <TableHead className="text-right">Expense</TableHead>
                      <TableHead className="text-right">Net</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.byMonth.map((m) => (
                      <TableRow key={m.month}>
                        <TableCell className="font-medium">{m.label}</TableCell>
                        <TableCell className="text-right tabular-nums text-emerald-700 dark:text-emerald-400">
                          {formatMoney(m.income, currency)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-rose-700 dark:text-rose-400">
                          {formatMoney(m.expense, currency)}
                        </TableCell>
                        <TableCell
                          className={cn(
                            'text-right font-semibold tabular-nums',
                            m.net >= 0
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : 'text-rose-700 dark:text-rose-400'
                          )}
                        >
                          {formatMoney(m.net, currency)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                </div>
              </SectionCard>
            </>
          ) : (
            <SectionCard className="mt-4 overflow-hidden sm:mt-6">
              <EmptyState
                icon={BarChart3}
                title="No financial activity"
                description="No transactions were recorded in the selected period."
                className="py-16"
              />
            </SectionCard>
          )}
        </div>
      )}
    </div>
  )
}

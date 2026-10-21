'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { TooltipProps } from 'recharts'
import {
  Activity,
  AlertTriangle,
  ArrowLeftRight,
  ArrowRight,
  BadgeDollarSign,
  Banknote,
  BarChart3,
  Building2,
  CheckCircle2,
  HandCoins,
  ChevronsDown,
  ChevronsUp,
  Clock,
  FolderKanban,
  IdCard,
  Loader2,
  MapPin,
  RotateCcw,
  ShieldAlert,
  TrendingDown,
  TrendingUp,
  UserPlus,
  Users,
  UsersRound,
  Wallet,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/app/shared/empty-state'
import { PageHeader, SectionCard } from '@/components/app/shared/page-header'
import { StatCard } from '@/components/app/shared/stat-card'
import { AvatarInitials } from '@/components/app/shared/avatar-initials'
import { api } from '@/lib/api-client'
import { formatDate, formatDateTime, formatMoney, formatNumber } from '@/lib/format'
import { can, useAppStore } from '@/lib/store'
import type { ActivityRow, DashboardData, DocumentAlert } from '@/lib/types'
import { ExpiryBadge } from '@/components/app/shared/status-badge'

const INCOME_COLOR = '#10b981'
const EXPENSE_COLOR = '#f43f5e'
const PAID_COLOR = '#10b981'
const PENDING_COLOR = '#f59e0b'

/** Compact Y-axis tick: 1400000 → "1.4M", 700000 → "700K" */
function compactAxis(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1_000_000) return `${+(value / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${Math.round(value / 1_000)}K`
  return String(value)
}

function ChartTooltip({
  active,
  payload,
  label,
  currency,
}: TooltipProps<number, string> & { currency: string }) {
  if (!active || !payload || payload.length === 0) return null
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-popover-foreground shadow-md">
      <p className="mb-1.5 text-xs font-semibold">{label}</p>
      {payload.map((item) => (
        <div key={String(item.dataKey)} className="flex items-center gap-2 py-0.5">
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: item.color ?? '#94a3b8' }}
          />
          <span className="text-muted-foreground">{String(item.name ?? '')}</span>
          <span className="ml-auto pl-4 font-semibold tabular-nums">
            {formatMoney(Number(item.value), currency)}
          </span>
        </div>
      ))}
    </div>
  )
}

/** Donut tooltip for the payroll status chart */
function DonutTooltip({
  active,
  payload,
}: TooltipProps<number, string>) {
  if (!active || !payload || payload.length === 0) return null
  const item = payload[0]
  return (
    <div className="rounded-lg border bg-popover px-3 py-1.5 text-popover-foreground shadow-md">
      <span className="text-xs font-semibold">{String(item.name)}</span>
      <span className="ml-2 text-xs tabular-nums text-muted-foreground">
        {Number(item.value)} payslips
      </span>
    </div>
  )
}

/** Payroll status donut + pending payouts quick list (latest payroll month) */
function PayrollStatusSection({
  status,
  currency,
  onMarkPaid,
  markingId,
  expanded,
  onToggleExpand,
  expanding,
}: {
  status: NonNullable<DashboardData['payrollStatus']>
  currency: string
  onMarkPaid: (row: { id: string; staffName: string; netPay: number }) => void
  markingId: string | null
  expanded: boolean
  onToggleExpand: () => void
  expanding: boolean
}) {
  const { user, setView } = useAppStore()
  const canEditPayroll = can(user, 'payroll.edit')
  const totalCount = status.paidCount + status.pendingCount
  const paidShare = totalCount > 0 ? Math.round((status.paidCount / totalCount) * 100) : 0
  const donutData = [
    { name: 'Paid', value: status.paidCount, fill: PAID_COLOR },
    { name: 'Pending', value: status.pendingCount, fill: PENDING_COLOR },
  ]

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {/* Status donut */}
      <SectionCard className="overflow-hidden">
        <div className="border-b p-4 sm:p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold">Payroll Status</h2>
            <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
              {status.month}
            </span>
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">Latest payroll month</p>
        </div>
        <div className="flex items-center justify-center p-4 pb-2">
          <div className="relative h-[150px] w-[150px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={donutData}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={52}
                  outerRadius={70}
                  paddingAngle={status.paidCount > 0 && status.pendingCount > 0 ? 3 : 0}
                  cornerRadius={6}
                  strokeWidth={0}
                  startAngle={90}
                  endAngle={-270}
                >
                  {donutData.map((d) => (
                    <Cell key={d.name} fill={d.fill} />
                  ))}
                </Pie>
                <Tooltip content={<DonutTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-bold tabular-nums leading-none">{totalCount}</span>
              <span className="mt-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                payslips
              </span>
            </div>
          </div>
        </div>
        <div className="space-y-3 p-4 pt-2 sm:px-5">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-emerald-500 transition-[width] duration-500"
              style={{ width: `${paidShare}%` }}
            />
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500" />
              <span className="text-muted-foreground">Paid</span>
              <span className="ml-auto font-semibold tabular-nums">{status.paidCount}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-amber-500" />
              <span className="text-muted-foreground">Pending</span>
              <span className="ml-auto font-semibold tabular-nums">{status.pendingCount}</span>
            </div>
          </div>
          <div className="flex items-baseline justify-between border-t pt-3">
            <span className="text-xs text-muted-foreground">Disbursed</span>
            <span className="text-sm font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
              {formatMoney(status.paidAmount, currency)}
            </span>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-xs text-muted-foreground">Awaiting payment</span>
            <span className="text-sm font-semibold tabular-nums text-amber-700 dark:text-amber-400">
              {formatMoney(status.pendingAmount, currency)}
            </span>
          </div>
        </div>
      </SectionCard>

      {/* Pending payouts list */}
      <SectionCard className="flex flex-col overflow-hidden lg:col-span-2">
        <div className="flex flex-col gap-2 border-b p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div>
            <h2 className="text-base font-semibold">Pending Payouts</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Top net payouts still awaiting disbursement — {status.month}
            </p>
          </div>
          {status.pendingCount > 0 ? (
            <div className="flex shrink-0 items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
              <Clock className="h-3.5 w-3.5" />
              {status.pendingCount} pending · {formatMoney(status.pendingAmount, currency)}
            </div>
          ) : (
            <div className="flex shrink-0 items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
              <CheckCircle2 className="h-3.5 w-3.5" />
              All paid
            </div>
          )}
        </div>
        {status.pendingCount === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            title="Everything is disbursed"
            description={`All ${totalCount} payroll entries for ${status.month} are marked as paid.`}
            className="flex-1"
          />
        ) : (
          <ul className="nice-scrollbar max-h-[268px] divide-y overflow-y-auto">
            {status.pending.map((row, i) => (
              <li key={row.id} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
                {expanded && status.pending.length > 6 ? (
                  <span className="w-5 shrink-0 text-right text-[11px] font-semibold tabular-nums text-muted-foreground">
                    {i + 1}
                  </span>
                ) : null}
                <AvatarInitials name={row.staffName} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{row.staffName}</p>
                  <p className="text-xs text-muted-foreground">Net payout</p>
                </div>
                <span className="shrink-0 text-sm font-bold tabular-nums">
                  {formatMoney(row.netPay, currency)}
                </span>
                {canEditPayroll ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 shrink-0 gap-1.5 border-emerald-600 bg-emerald-600 font-semibold text-white shadow-sm hover:border-emerald-700 hover:bg-emerald-700 hover:text-white dark:border-emerald-500 dark:bg-emerald-600 dark:hover:border-emerald-400 dark:hover:bg-emerald-500"
                    disabled={markingId !== null}
                    onClick={() => onMarkPaid(row)}
                  >
                    {markingId === row.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Banknote className="h-3.5 w-3.5" />
                    )}
                    Mark Paid
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {status.pendingCount > 6 ? (
          <div className="border-t px-4 py-2 sm:px-5">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-muted-foreground"
              onClick={onToggleExpand}
              disabled={expanding}
            >
              {expanding ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : expanded ? (
                <ChevronsUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronsDown className="h-3.5 w-3.5" />
              )}
              {expanded
                ? 'Show top 6'
                : `Show all ${status.pendingCount} pending payouts`}
            </Button>
          </div>
        ) : null}
        <div className="mt-auto border-t px-4 py-3 sm:px-5">
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setView('payroll')}>
            <Wallet className="h-4 w-4" />
            Open payroll module
          </Button>
        </div>
      </SectionCard>
    </div>
  )
}

/** IQAMA document-compliance alert card — expired + expiring-soon workforce documents */
function DocumentAlertsSection({
  alerts,
  onReview,
}: {
  alerts: NonNullable<DashboardData['documentAlerts']>
  onReview: () => void
}) {
  const expired = alerts.expired
  const expiring = alerts.expiring
  const total = expired.length + expiring.length
  if (total === 0) return null
  return (
    <SectionCard className="overflow-hidden border-amber-200/70 dark:border-amber-900/50">
      <div className="flex flex-col gap-2 border-b border-amber-100 bg-amber-50/60 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5 dark:border-amber-950 dark:bg-amber-950/30">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-300">
            <ShieldAlert className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-base font-semibold">Document Compliance</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {expired.length > 0 ? (
                <>
                  <span className="text-base font-bold tabular-nums text-rose-600 dark:text-rose-400">{expired.length}</span>
                  <span className="font-medium"> expired</span>
                  {' and '}
                </>
              ) : null}
              <span className="text-base font-bold tabular-nums text-amber-600 dark:text-amber-400">{expiring.length}</span>
              <span className="font-medium"> expiring</span> IQAMA{total === 1 ? '' : 's'} within 90 days
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" className="shrink-0" onClick={onReview}>
          <IdCard className="h-4 w-4" />
          Review staff
        </Button>
      </div>
      <ul className="nice-scrollbar max-h-72 divide-y overflow-y-auto">
        {expired.map((d) => (
          <DocumentAlertRow key={d.staffId} alert={d} />
        ))}
        {expiring.map((d) => (
          <DocumentAlertRow key={d.staffId} alert={d} />
        ))}
      </ul>
    </SectionCard>
  )
}

function DocumentAlertRow({ alert }: { alert: DocumentAlert }) {
  const expired = alert.daysLeft < 0
  return (
    <li className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/40 sm:px-5">
      <AvatarInitials name={alert.fullName} className="h-8 w-8 text-xs" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{alert.fullName}</p>
        <p className="text-xs text-muted-foreground tabular-nums">IQAMA {alert.iqamaId}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-sm font-medium tabular-nums">{formatDate(alert.iqamaExpiry)}</p>
        <ExpiryBadge
          status={expired ? 'expired' : 'expiring'}
          daysLeft={alert.daysLeft}
          className="mt-0.5"
        />
      </div>
    </li>
  )
}

function ActivityModuleIcon({ module }: { module: string }) {
  switch (module) {
    case 'payroll':
      return <Wallet className="h-4 w-4 text-muted-foreground" />
    case 'transaction':
    case 'transaction_category':
      return <ArrowLeftRight className="h-4 w-4 text-muted-foreground" />
    case 'staff':
    case 'staff_category':
      return <UserPlus className="h-4 w-4 text-muted-foreground" />
    case 'project':
      return <FolderKanban className="h-4 w-4 text-muted-foreground" />
    case 'user':
    case 'role':
      return <UsersRound className="h-4 w-4 text-muted-foreground" />
    default:
      return <Activity className="h-4 w-4 text-muted-foreground" />
  }
}

function ActivityItem({ item, currency }: { item: ActivityRow; currency: string }) {
  return (
    <li className="flex items-start gap-3 px-4 py-3 sm:px-5">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
        <ActivityModuleIcon module={item.module} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-snug">{item.description}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {item.userName ?? 'System'} · {formatDateTime(item.createdAt)}
        </p>
      </div>
      {item.amount !== null && item.amount !== undefined ? (
        <span className="shrink-0 rounded-md bg-rose-50 px-2 py-1 text-xs font-semibold tabular-nums text-rose-700 dark:bg-rose-950/50 dark:text-rose-400">
          {formatMoney(-Math.abs(item.amount), currency)}
        </span>
      ) : null}
    </li>
  )
}

function DashboardSkeleton() {
  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-7 w-36" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-[118px] w-full" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-[330px] w-full" />
        <Skeleton className="h-[330px] w-full lg:col-span-2" />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-[388px] w-full lg:col-span-2" />
        <Skeleton className="h-[388px] w-full" />
      </div>
    </div>
  )
}

/** Client deployment overview — which companies our workers are at (clients.view gated) */
function ClientDeploymentSection({
  deployment,
  onViewDeployments,
}: {
  deployment: NonNullable<DashboardData['clientDeployment']>
  onViewDeployments: () => void
}) {
  const max = deployment.topClients[0]?.workers || 1
  return (
    <SectionCard className="overflow-hidden">
      <div className="flex flex-col gap-2 border-b p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Building2 className="h-4 w-4 text-primary" />
            Workforce by Client
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {deployment.deployedWorkers.toLocaleString()} workers deployed across{' '}
            <span className="font-semibold tabular-nums text-foreground">{deployment.activeClients}</span>{' '}
            active client{deployment.activeClients === 1 ? '' : 's'}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 shrink-0 text-xs text-muted-foreground hover:text-foreground"
          onClick={onViewDeployments}
        >
          View deployments
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="space-y-2.5 p-4 sm:p-5">
        {deployment.topClients.length === 0 ? (
          <p className="rounded-lg border border-dashed p-3 text-center text-xs text-muted-foreground">
            No workers deployed to client projects yet.
          </p>
        ) : (
          deployment.topClients.map((c, i) => (
            <div key={c.id} className="flex items-center gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                <Building2 className="h-4 w-4 text-primary" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate font-medium">{c.name}</span>
                  <span className="shrink-0 text-xs font-semibold tabular-nums">
                    {c.workers} worker{c.workers === 1 ? '' : 's'}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <div className="h-1.5 max-w-[220px] flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${Math.max(6, (c.workers / max) * 100)}%`, opacity: 1 - i * 0.1 }}
                    />
                  </div>
                  {c.city ? (
                    <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
                      <MapPin className="h-3 w-3" />
                      {c.city}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </SectionCard>
  )
}

export function DashboardView() {
  const { setView, user, settings } = useAppStore()
  const currency = settings.currency
  const canViewActivity = can(user, 'activity.view')
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Pending payouts "show all" toggle (6 → full list and back)
  const [pendingLimit, setPendingLimit] = useState(6)
  const [expanding, setExpanding] = useState(false)

  const load = useCallback(
    async (showLoading = true) => {
      if (showLoading) setLoading(true)
      setError(null)
      try {
        const res = await api.get<DashboardData>(
          `/api/dashboard${pendingLimit !== 6 ? `?pendingLimit=${pendingLimit}` : ''}`
        )
        setData(res)
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Something went wrong'
        setError(message)
        toast.error(message)
      } finally {
        if (showLoading) setLoading(false)
      }
    },
    [pendingLimit]
  )

  // Single load driver: full skeleton on mount, silent refresh on expansion change
  const pendingLimitRef = useRef(6)
  useEffect(() => {
    const isInitial = pendingLimitRef.current === pendingLimit
    pendingLimitRef.current = pendingLimit
    if (isInitial) {
      void load(true)
    } else {
      setExpanding(true)
      load(false)
        .catch(() => undefined)
        .finally(() => setExpanding(false))
    }
  }, [load, pendingLimit])

  // Quick action: mark a pending payroll as paid (syncs the linked Salary expense)
  const [markingId, setMarkingId] = useState<string | null>(null)
  async function handleMarkPaid(row: { id: string; staffName: string; netPay: number }) {
    setMarkingId(row.id)
    try {
      await api.post(`/api/payrolls/${row.id}/mark-paid`, {})
      toast.success(`Salary paid — ${row.staffName} · ${formatMoney(row.netPay, currency)}`)
      await load(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to mark payroll as paid')
    } finally {
      setMarkingId(null)
    }
  }

  if (loading && !data) return <DashboardSkeleton />

  if (!data) {
    return (
      <SectionCard>
        <EmptyState
          icon={AlertTriangle}
          title="Unable to load dashboard"
          description={error ?? 'Please try again in a moment.'}
          action={
            <Button variant="outline" onClick={() => void load()}>
              <RotateCcw className="h-4 w-4" />
              Retry
            </Button>
          }
        />
      </SectionCard>
    )
  }

  const { stats } = data
  const firstName = user?.name?.trim().split(/\s+/)[0] ?? 'there'
  const hasChartData = data.chart.length > 0

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title="Dashboard"
        description={`Welcome back, ${firstName} — company overview & financial performance`}
      />

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard
          title="Total Staff"
          value={stats.totalStaff.toLocaleString()}
          sublabel="Active workforce members"
          icon={Users}
          tone="navy"
          onMoreInfo={() => setView('staff-list')}
          moreInfoLabel="View staff"
        />
        <StatCard
          title="Total Users"
          value={stats.totalUsers.toLocaleString()}
          sublabel="System accounts"
          icon={UsersRound}
          tone="violet"
          onMoreInfo={() => setView('users')}
          moreInfoLabel="View users"
        />
        <StatCard
          title="Total Income"
          value={formatNumber(stats.totalIncome)}
          valuePrefix={currency}
          sublabel="All-time revenue"
          icon={TrendingUp}
          tone="green"
          onMoreInfo={() => setView('income-list')}
          moreInfoLabel="View income"
        />
        <StatCard
          title="Total Expense"
          value={formatNumber(stats.totalExpense)}
          valuePrefix={currency}
          sublabel="All-time spending"
          icon={TrendingDown}
          tone="red"
          onMoreInfo={() => setView('expense-list')}
          moreInfoLabel="View expenses"
        />
        <StatCard
          title="Net Balance"
          value={formatNumber(stats.netBalance)}
          valuePrefix={currency}
          sublabel="Income minus expense"
          icon={Wallet}
          tone={stats.netBalance < 0 ? 'red' : 'gold'}
          onMoreInfo={() => setView('accounts-summary')}
          moreInfoLabel="View summary"
        />
        <StatCard
          title="Salary Paid"
          value={formatNumber(stats.salaryPaid)}
          valuePrefix={currency}
          sublabel="Disbursed payroll total"
          icon={BadgeDollarSign}
          tone="teal"
          onMoreInfo={() => setView('payroll')}
          moreInfoLabel="View payroll"
        />
        {stats.advanceOutstanding !== null ? (
          <StatCard
            title="Total Advance Outstanding"
            value={formatNumber(stats.advanceOutstanding)}
            valuePrefix={currency}
            sublabel="Worker advances not yet recovered"
            icon={HandCoins}
            tone="amber"
            onMoreInfo={() => setView('advances')}
            moreInfoLabel="View advances"
          />
        ) : null}
      </div>

      {/* IQAMA document alerts (expired / expiring within 90 days) */}
      {data.documentAlerts ? (
        <DocumentAlertsSection
          alerts={data.documentAlerts}
          onReview={() => setView('staff-list')}
        />
      ) : null}

      {/* Workforce by client company */}
      {data.clientDeployment ? (
        <ClientDeploymentSection
          deployment={data.clientDeployment}
          onViewDeployments={() => setView('deployments')}
        />
      ) : null}

      {/* Payroll status (latest payroll month) */}
      {data.payrollStatus && can(user, 'payroll.view') ? (
        <PayrollStatusSection
          status={data.payrollStatus}
          currency={currency}
          onMarkPaid={(row) => void handleMarkPaid(row)}
          markingId={markingId}
          expanded={pendingLimit !== 6}
          onToggleExpand={() => setPendingLimit((l) => (l === 6 ? 200 : 6))}
          expanding={expanding}
        />
      ) : null}

      {/* Chart + recent activity */}
      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard className="overflow-hidden lg:col-span-2">
          <div className="flex flex-col gap-2 border-b p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
            <div>
              <h2 className="text-base font-semibold">Financial Performance</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Income vs expense — last 6 months
              </p>
            </div>
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: INCOME_COLOR }} />
                Income
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: EXPENSE_COLOR }} />
                Expense
              </span>
            </div>
          </div>
          {hasChartData ? (
            <div className="h-[300px] w-full p-2 sm:p-4">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="dashIncomeFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={INCOME_COLOR} stopOpacity={0.25} />
                      <stop offset="100%" stopColor={INCOME_COLOR} stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="dashExpenseFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={EXPENSE_COLOR} stopOpacity={0.22} />
                      <stop offset="100%" stopColor={EXPENSE_COLOR} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#94a3b8" strokeOpacity={0.3} strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="month"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 11, fill: '#64748b' }}
                    tickMargin={8}
                    minTickGap={12}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 11, fill: '#64748b' }}
                    width={52}
                    tickFormatter={(value) => compactAxis(Number(value))}
                  />
                  <Tooltip
                    cursor={{ stroke: '#94a3b8', strokeOpacity: 0.5, strokeDasharray: '4 4' }}
                    content={<ChartTooltip currency={currency} />}
                  />
                  <Area
                    type="monotone"
                    dataKey="income"
                    name="Income"
                    stroke={INCOME_COLOR}
                    strokeWidth={2}
                    fill="url(#dashIncomeFill)"
                    dot={false}
                    activeDot={{ r: 4, strokeWidth: 0 }}
                  />
                  <Area
                    type="monotone"
                    dataKey="expense"
                    name="Expense"
                    stroke={EXPENSE_COLOR}
                    strokeWidth={2}
                    fill="url(#dashExpenseFill)"
                    dot={false}
                    activeDot={{ r: 4, strokeWidth: 0 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState
              icon={BarChart3}
              title="No financial data yet"
              description="Income and expense records from the last 6 months will appear here."
              className="py-14"
            />
          )}
        </SectionCard>

        <SectionCard className="flex flex-col overflow-hidden">
          <div className="flex items-center justify-between gap-2 border-b p-4 sm:p-5">
            <div className="min-w-0">
              <h2 className="text-base font-semibold">Recent Activity</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">Latest actions across all modules</p>
            </div>
            {canViewActivity ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 shrink-0 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setView('activity-log')}
              >
                View all
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            ) : null}
          </div>
          {data.recentActivity.length === 0 ? (
            <EmptyState
              icon={Activity}
              title="No recent activity"
              description="Actions like sign-ins, payroll runs and transactions will appear here."
              className="flex-1"
            />
          ) : (
            <ul className="nice-scrollbar max-h-96 divide-y overflow-y-auto">
              {data.recentActivity.map((item) => (
                <ActivityItem key={item.id} item={item} currency={currency} />
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </div>
  )
}

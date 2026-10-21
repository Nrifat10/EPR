'use client'

// Client Salary Summary — monthly MANPOWER BILLING grouped by client company.
// HOURS MIRROR PAYROLL: for the chosen month every payroll record becomes one
// billing line with EXACTLY the same regular + overtime hours the worker's
// salary sheet shows (they are read-only here — edit the payroll to change them).
// The client RATE is entered MANUALLY per worker (the price we charge the
// client company, e.g. 20 SAR/hour — distinct from the worker's own payroll
// rate, e.g. 15 SAR/hour). Unset rates fall back to the project's default
// client rate, then to the worker's own pay rate (⚠ flagged). Each client group
// carries Subtotal + 15% VAT + Grand Total and can be PRINTED / DOWNLOADED
// separately as its own company summary.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BadgeDollarSign,
  Building2,
  Check,
  ChevronRight,
  Download,
  FileBarChart,
  FolderKanban,
  Info,
  Loader2,
  Lock,
  Pencil,
  Printer,
  Users,
  Wallet,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { PageHeader, SectionCard } from '@/components/app/shared/page-header'
import { StatCard } from '@/components/app/shared/stat-card'
import { FilterBar, FilterSelect, SearchInput } from '@/components/app/shared/filter-select'
import { EmptyState, TableSkeleton } from '@/components/app/shared/empty-state'
import { StatusBadge } from '@/components/app/shared/status-badge'
import { printWithPageRule } from '@/components/app/print/print-page-rule'
import { ClientSummaryPrintDialog } from '@/components/app/print/client-summary-print'
import { useDebounce } from '@/hooks/use-debounce'
import { api, qs } from '@/lib/api-client'
import { buildCsv, csvFilename, downloadCsv } from '@/lib/csv'
import { formatMoney, formatNumber, monthName, round2 } from '@/lib/format'
import { can, useAppStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import type {
  ClientBillingLine,
  ClientSalaryGroup,
  ClientSalarySummaryData,
} from '@/lib/types'

const STAFF_SCOPE_OPTIONS = [
  // NOTE: the FilterSelect built-in empty item (value "all") IS the default
  // "Active staff only" — so only the non-default option is listed here.
  { value: 'include-inactive', label: 'All staff (incl. inactive)' },
]

const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => ({
  value: String(i + 1),
  label: monthName(i + 1),
}))

const YEAR_OPTIONS = (() => {
  const y = new Date().getFullYear()
  return Array.from({ length: 6 }, (_, i) => ({ value: String(y - 4 + i), label: String(y - 4 + i) }))
})()

/** Stable key for a group (null clientId = the "No Client" bucket) */
function groupKey(g: ClientSalaryGroup): string {
  return g.clientId ?? '_noclient'
}

/** Filesystem-safe client name fragment for download filenames */
function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'client'
  )
}

/** "212" | "212.5" — integers stay clean, fractions keep 2dp */
function fmtHours(n: number): string {
  return Number.isInteger(n) ? String(n) : formatNumber(n, 2)
}

// ---------------------------------------------------------------------------
// Live rate-edit overlay — amounts recompute client-side while typing so the
// user sees hours × rate instantly; the saved value lands on the payroll row.
// ---------------------------------------------------------------------------

/** payrollId → in-progress manual rate values (0 = cleared → inherit fallback) */
type RateEdit = { rate?: number; otRate?: number }
type RateEdits = Record<string, RateEdit>

function editRate(r: ClientBillingLine, edits: RateEdits): number {
  return edits[r.payrollId]?.rate !== undefined ? edits[r.payrollId].rate! : r.manualRate
}
function editOtRate(r: ClientBillingLine, edits: RateEdits): number {
  return edits[r.payrollId]?.otRate !== undefined ? edits[r.payrollId].otRate! : r.manualOtRate
}
/** manual entry → project default → worker's own pay rate */
function effectiveRate(r: ClientBillingLine, edits: RateEdits): number {
  const manual = editRate(r, edits)
  if (manual > 0) return manual
  if (r.projectRate > 0) return r.projectRate
  return r.workerRate
}
/** manual OT entry, else the same effective regular rate */
function effectiveOtRate(r: ClientBillingLine, edits: RateEdits, effRate?: number): number {
  const manual = editOtRate(r, edits)
  if (manual > 0) return manual
  return effRate ?? effectiveRate(r, edits)
}
function rateSourceOf(r: ClientBillingLine, edits: RateEdits): ClientBillingLine['rateSource'] {
  if (editRate(r, edits) > 0) return 'manual'
  if (r.projectRate > 0) return 'project'
  return 'worker'
}

/** Rebuild rows + aggregates with the current in-progress edits applied. */
function recomputeSummary(data: ClientSalarySummaryData, edits: RateEdits): ClientSalarySummaryData {
  const groups = data.groups.map((g) => {
    const rows = g.rows.map((r) => {
      const rate = effectiveRate(r, edits)
      const otRate = effectiveOtRate(r, edits, rate)
      return {
        ...r,
        clientRate: rate,
        clientOtRate: otRate,
        rateSource: rateSourceOf(r, edits),
        amount: round2(r.hours * rate + r.otHours * otRate),
      }
    })
    const hours = round2(rows.reduce((s, r) => s + r.hours, 0))
    const otHours = round2(rows.reduce((s, r) => s + r.otHours, 0))
    const billedAmount = round2(rows.reduce((s, r) => s + r.amount, 0))
    const vatAmount = round2(billedAmount * data.vatRate)
    return {
      ...g,
      rows,
      hours,
      otHours,
      billedAmount,
      vatAmount,
      grandTotal: round2(billedAmount + vatAmount),
      margin: round2(billedAmount - g.workerCost),
      share: 0,
    }
  })
  const denominator = groups.reduce((s, g) => s + g.grandTotal, 0)
  for (const g of groups) {
    g.share = denominator > 0 ? round2((100 * g.grandTotal) / denominator) : 0
  }
  // Cards stay global — only recompute them from the (filtered) groups when no
  // search is active, i.e. when the visible groups ARE all groups.
  const cards = { ...data.cards }
  if (groups.length === data.groups.length) {
    cards.billedAmount = round2(groups.reduce((s, g) => s + g.billedAmount, 0))
    cards.vatAmount = round2(groups.reduce((s, g) => s + g.vatAmount, 0))
    cards.grandTotal = round2(groups.reduce((s, g) => s + g.grandTotal, 0))
    cards.margin = round2(groups.reduce((s, g) => s + g.margin, 0))
  }
  return { ...data, groups, cards }
}

// ---------------------------------------------------------------------------
// Per-project bucket (workers of one project inside a client group)
// ---------------------------------------------------------------------------

type ProjectBucket = {
  projectId: string
  projectName: string
  /** Project's negotiated default client rate (fallback for unset rows) */
  projectRate: number
  rows: ClientBillingLine[]
  hours: number
  otHours: number
  subtotal: number
}

function bucketByProject(rows: ClientBillingLine[]): ProjectBucket[] {
  const map = new Map<string, ProjectBucket>()
  for (const r of rows) {
    let b = map.get(r.projectId)
    if (!b) {
      b = {
        projectId: r.projectId,
        projectName: r.projectName,
        projectRate: r.projectRate,
        rows: [],
        hours: 0,
        otHours: 0,
        subtotal: 0,
      }
      map.set(r.projectId, b)
    }
    b.rows.push(r)
    b.hours = round2(b.hours + r.hours)
    b.otHours = round2(b.otHours + r.otHours)
    b.subtotal = round2(b.subtotal + r.amount)
  }
  return Array.from(map.values()).sort(
    (a, b) => b.subtotal - a.subtotal || a.projectName.localeCompare(b.projectName)
  )
}

// ---------------------------------------------------------------------------
// RateCell — an always-editable rate input. Live-updates the amount while
// typing; commits on Enter/blur via PUT /api/payrolls/[id]/client-rate.
// ---------------------------------------------------------------------------

function RateCell({
  value,
  manual,
  currency,
  canEdit,
  onChange,
  onCommit,
  ariaLabel,
  compact,
}: {
  /** Effective (fallback-resolved) rate — what the input shows */
  value: number
  /** Raw manually-saved rate on the payroll row (0 = inherited) */
  manual: number
  currency: string
  canEdit: boolean
  /** live, while typing — 0 = cleared */
  onChange: (v: number) => void
  /** persist — resolve with the new raw manual value */
  onCommit: (v: number) => Promise<void>
  ariaLabel: string
  compact?: boolean
}) {
  const [txt, setTxt] = useState(value > 0 ? String(value) : '')
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [editing, setEditing] = useState(false)
  const [dirty, setDirty] = useState(false)
  const timer = useRef<number | null>(null)

  // Sync from the parent (bulk apply / reload) while NOT editing — the
  // documented "adjust state when a prop changes" render pattern (no effect).
  const [prevValue, setPrevValue] = useState(value)
  if (prevValue !== value && !editing) {
    setPrevValue(value)
    setTxt(value > 0 ? String(value) : '')
  }

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current)
    },
    []
  )

  async function commit() {
    const v = txt.trim() === '' ? 0 : Number(txt)
    if (!Number.isFinite(v) || v < 0 || v > 100000) {
      toast.error('Enter a valid rate (0 – 100,000)')
      setTxt(value > 0 ? String(value) : '')
      setDirty(false)
      return
    }
    if (!dirty) return // untouched — focus + blur must not save a phantom rate
    onChange(v)
    if (v === manual) {
      setDirty(false)
      return // unchanged — nothing to persist
    }
    setState('saving')
    try {
      await onCommit(v)
      setDirty(false)
      setState('saved')
      if (timer.current) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setState('idle'), 1400)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save the rate')
      setState('idle')
      setTxt(value > 0 ? String(value) : '')
      setDirty(false)
      onChange(manual)
    }
  }

  if (!canEdit) {
    return (
      <span className="tabular-nums" title={`${formatNumber(value)} ${currency} per hour`}>
        {formatNumber(value)}
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1">
      <Input
        type="number"
        inputMode="decimal"
        min={0}
        step="0.25"
        value={txt}
        placeholder="auto"
        aria-label={ariaLabel}
        onChange={(e) => {
          setTxt(e.target.value)
          setDirty(true)
          const v = e.target.value.trim() === '' ? 0 : Number(e.target.value)
          onChange(Number.isFinite(v) && v >= 0 ? v : 0)
        }}
        onFocus={() => setEditing(true)}
        onBlur={() => {
          setEditing(false)
          void commit()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            ;(e.target as HTMLInputElement).blur()
          } else if (e.key === 'Escape') {
            setTxt(value > 0 ? String(value) : '')
            setDirty(false)
            onChange(manual)
            ;(e.target as HTMLInputElement).blur()
          }
        }}
        className={cn(
          'h-7 px-2 py-0 text-right tabular-nums',
          compact ? 'w-[68px] text-xs' : 'w-20 text-xs'
        )}
      />
      {state === 'saving' ? (
        <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground" aria-hidden />
      ) : state === 'saved' ? (
        <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" aria-label="Rate saved" />
      ) : null}
    </span>
  )
}

// ---------------------------------------------------------------------------
// BulkRateApply — set one rate for EVERY worker of a project (this month).
// ---------------------------------------------------------------------------

function BulkRateApply({
  projectId,
  month,
  year,
  workerCount,
  currency,
  onApplied,
}: {
  projectId: string
  month: number
  year: number
  workerCount: number
  currency: string
  onApplied: (clientRate: number, clientOtRate: number | null) => void
}) {
  const [rate, setRate] = useState('')
  const [otRate, setOtRate] = useState('')
  const [busy, setBusy] = useState(false)

  async function apply() {
    const n = rate.trim() === '' ? 0 : Number(rate)
    if (!Number.isFinite(n) || n <= 0 || n > 100000) {
      toast.error(`Enter the client rate to apply (1 – 100,000 ${currency})`)
      return
    }
    const ot = otRate.trim() === '' ? null : Number(otRate)
    if (ot !== null && (!Number.isFinite(ot) || ot < 0 || ot > 100000)) {
      toast.error('Enter a valid OT rate (or leave it empty to use the same rate)')
      return
    }
    setBusy(true)
    try {
      const res = await api.put<{ updated: number }>('/api/clients/salary-summary/rates', {
        month,
        year,
        projectId,
        clientRate: n,
        clientOtRate: ot ?? undefined,
      })
      onApplied(n, ot)
      toast.success(`Client rate ${formatNumber(n)} ${currency}/h applied to ${res.updated} worker${res.updated === 1 ? '' : 's'}`)
      setRate('')
      setOtRate('')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not apply the rate')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="print-hidden flex flex-wrap items-center gap-1.5"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Apply to all {workerCount}:
      </span>
      <Input
        type="number"
        inputMode="decimal"
        min={0}
        step="0.25"
        value={rate}
        placeholder={`rate ${currency}/h`}
        aria-label={`Client rate for all workers of this project`}
        onChange={(e) => setRate(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            void apply()
          }
        }}
        className="h-7 w-[92px] px-2 py-0 text-right text-xs tabular-nums"
        disabled={busy}
      />
      <Input
        type="number"
        inputMode="decimal"
        min={0}
        step="0.25"
        value={otRate}
        placeholder="OT (optional)"
        aria-label="Client overtime rate for all workers (optional)"
        onChange={(e) => setOtRate(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            void apply()
          }
        }}
        className="h-7 w-[96px] px-2 py-0 text-right text-xs tabular-nums"
        disabled={busy}
      />
      <Button
        type="button"
        size="sm"
        variant="secondary"
        className="h-7 px-2.5 text-xs"
        onClick={() => void apply()}
        disabled={busy}
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
        Apply
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

export function ClientSalarySummaryView() {
  const settings = useAppStore((s) => s.settings)
  const user = useAppStore((s) => s.user)

  const [searchInput, setSearchInput] = useState('')
  const search = useDebounce(searchInput, 350)
  // 'all' = the select's built-in empty item → Active staff only (default)
  const [scope, setScope] = useState('all')
  const now = new Date()
  const [month, setMonth] = useState(String(now.getMonth() + 1))
  const [year, setYear] = useState(String(now.getFullYear()))

  const [data, setData] = useState<ClientSalarySummaryData | null>(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [printGroup, setPrintGroup] = useState<ClientSalaryGroup | null>(null)
  const [rateEdits, setRateEdits] = useState<RateEdits>({})

  const money = useCallback((n: number) => formatMoney(n, settings.currency), [settings.currency])
  const vatPercent = data ? Math.round(data.vatRate * 100) : 15
  const canEditRate = can(user, 'payroll.edit')

  const loadSummary = useCallback(async () => {
    setLoading(true)
    setRateEdits({})
    try {
      const query = qs({
        search: search || undefined,
        includeInactive: scope === 'include-inactive' ? 'true' : undefined,
        month,
        year,
      })
      const res = await api.get<ClientSalarySummaryData>(`/api/clients/salary-summary${query}`)
      setData(res)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load client salary summary')
    } finally {
      setLoading(false)
    }
  }, [search, scope, month, year])

  useEffect(() => {
    void loadSummary()
  }, [loadSummary])

  // Live view = server data + in-progress rate edits (amounts update as you type)
  const view = useMemo(
    () => (data ? recomputeSummary(data, rateEdits) : null),
    [data, rateEdits]
  )

  const cards = view?.cards
  const groups = view?.groups ?? []

  // Footer totals over the (server-filtered) groups
  const totals = useMemo(() => {
    return groups.reduce(
      (acc, g) => ({
        workers: acc.workers + g.workerCount,
        projects: acc.projects + g.projectCount,
        hours: round2(acc.hours + g.hours),
        otHours: round2(acc.otHours + g.otHours),
        billed: round2(acc.billed + g.billedAmount),
        vat: round2(acc.vat + g.vatAmount),
        grand: round2(acc.grand + g.grandTotal),
      }),
      { workers: 0, projects: 0, hours: 0, otHours: 0, billed: 0, vat: 0, grand: 0 }
    )
  }, [groups])

  // Rows still billed at each worker's OWN pay rate (no manual + no project rate)
  const fallbackProjects = useMemo(() => {
    if (!view) return []
    const names = new Set<string>()
    for (const g of view.groups) {
      for (const r of g.rows) {
        if (r.rateSource === 'worker' && (r.hours > 0 || r.otHours > 0)) names.add(r.projectName)
      }
    }
    return Array.from(names).sort()
  }, [view])

  const toggle = useCallback((key: string) => {
    setExpanded((prev) => (prev === key ? null : key))
  }, [])

  const periodLabel = `${monthName(Number(month))} ${year}`

  /** Update the in-progress edit overlay (live recompute, no request) */
  const setEdit = useCallback((payrollId: string, patch: RateEdit) => {
    setRateEdits((prev) => ({ ...prev, [payrollId]: { ...prev[payrollId], ...patch } }))
  }, [])

  /** Persist one worker's manual client rate (regular hours) */
  const commitRate = useCallback(
    async (payrollId: string, v: number) => {
      await api.put(`/api/payrolls/${payrollId}/client-rate`, { clientRate: v })
    },
    []
  )

  /** Persist one worker's manual client OT rate */
  const commitOtRate = useCallback(async (payrollId: string, v: number) => {
    await api.put(`/api/payrolls/${payrollId}/client-rate`, { clientOtRate: v })
  }, [])

  /** Bulk apply landed — overlay every row of the project with the new rates */
  const applyBulkToLocal = useCallback(
    (projectId: string, clientRate: number, clientOtRate: number | null) => {
      setRateEdits((prev) => {
        const next = { ...prev }
        for (const g of groups) {
          for (const r of g.rows) {
            if (r.projectId !== projectId) continue
            next[r.payrollId] = {
              ...next[r.payrollId],
              rate: clientRate,
              ...(clientOtRate !== null ? { otRate: clientOtRate } : {}),
            }
          }
        }
        return next
      })
    },
    [groups]
  )

  /** One company's summary as CSV (worker lines + Subtotal / VAT / Grand Total) */
  const exportClientCsv = useCallback(
    (g: ClientSalaryGroup) => {
      const headers = [
        'Worker',
        'Iqama ID',
        'Position',
        'Category',
        'Project',
        'Hours',
        'OT Hours',
        `Rate/Hr (${settings.currency})`,
        `OT Rate (${settings.currency})`,
        `Amount (${settings.currency})`,
      ]
      const rows: (string | number | null | undefined)[][] = g.rows.map((r) => [
        r.fullName,
        r.iqamaId,
        r.position,
        r.categoryName,
        r.projectName,
        r.hours,
        r.otHours,
        r.clientRate,
        r.clientOtRate,
        r.amount,
      ])
      rows.push([
        `SUBTOTAL — ${g.workerCount} worker${g.workerCount === 1 ? '' : 's'}`,
        '',
        '',
        '',
        '',
        g.hours,
        g.otHours,
        '',
        '',
        g.billedAmount,
      ])
      rows.push([`VAT ${vatPercent}%`, '', '', '', '', '', '', '', '', g.vatAmount])
      rows.push(['GRAND TOTAL (incl. VAT)', '', '', '', '', '', '', '', '', g.grandTotal])
      downloadCsv(
        csvFilename('client-summary', `${slug(g.clientName)}-${slug(periodLabel)}`),
        buildCsv(headers, rows)
      )
      toast.success(`${g.clientName} summary downloaded`)
    },
    [settings.currency, vatPercent, periodLabel]
  )

  /** All clients in one CSV, with per-client subtotal rows + global totals */
  const exportCsv = useCallback(() => {
    if (!view) return
    const headers = [
      'Client Company',
      'City',
      'Worker',
      'Iqama ID',
      'Position',
      'Category',
      'Project',
      'Hours',
      'OT Hours',
      `Rate/Hr (${settings.currency})`,
      `OT Rate (${settings.currency})`,
      `Amount (${settings.currency})`,
    ]
    const rows: (string | number | null | undefined)[][] = groups.flatMap((g) => [
      ...g.rows.map((r) => [
        g.clientName,
        g.city,
        r.fullName,
        r.iqamaId,
        r.position,
        r.categoryName,
        r.projectName,
        r.hours,
        r.otHours,
        r.clientRate,
        r.clientOtRate,
        r.amount,
      ]),
      [
        `${g.clientName} — SUBTOTAL`,
        '',
        `${g.workerCount} workers`,
        '',
        '',
        '',
        '',
        g.hours,
        g.otHours,
        '',
        '',
        g.billedAmount,
      ],
    ])
    rows.push([
      'TOTAL BILLED (excl. VAT)',
      '',
      '',
      '',
      '',
      '',
      '',
      view.cards.billedHours,
      view.cards.billedOtHours,
      '',
      '',
      view.cards.billedAmount,
    ])
    rows.push([`VAT ${vatPercent}%`, '', '', '', '', '', '', '', '', '', '', view.cards.vatAmount])
    rows.push([
      'GRAND TOTAL (incl. VAT)',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      view.cards.grandTotal,
    ])
    downloadCsv(csvFilename('client-salary-summary', slug(periodLabel)), buildCsv(headers, rows))
    toast.success('Client salary summary exported')
  }, [view, groups, settings.currency, vatPercent, periodLabel])

  const scopeLabel = scope === 'include-inactive' ? 'All staff (incl. inactive)' : 'Active staff only'

  /** Rate source badge shown under the rate input */
  function rateSourceBadge(r: ClientBillingLine) {
    if (r.rateSource === 'manual') {
      return (
        <span
          className="text-[9px] font-medium text-emerald-700 dark:text-emerald-400"
          title="Manually entered client rate"
        >
          manual
        </span>
      )
    }
    if (r.rateSource === 'project') {
      return (
        <span
          className="text-[9px] text-muted-foreground"
          title="Using the project's default client rate — type a rate to override"
        >
          project
        </span>
      )
    }
    return (
      <span
        className="text-[9px] font-medium text-amber-600 dark:text-amber-400"
        title="No client rate set — billed at the worker's own pay rate"
      >
        ⚠ worker rate
      </span>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Client Salary Summary"
        description={`Hours mirror this month's payroll — enter the client rate per worker (client price ≠ worker pay rate) + ${vatPercent}% VAT`}
      >
        <Button
          variant="outline"
          className="print-hidden"
          onClick={exportCsv}
          disabled={!view || groups.length === 0}
        >
          <Download className="h-4 w-4" />
          CSV
        </Button>
        <Button
          className="print-hidden"
          onClick={() => printWithPageRule('size: A4 landscape; margin: 8mm;')}
          disabled={!view || groups.length === 0}
        >
          <Printer className="h-4 w-4" />
          Print
        </Button>
      </PageHeader>

      {/* Filters */}
      <div className="print-hidden">
        <FilterBar
          activeCount={[searchInput, scope !== 'all' ? scope : ''].filter(Boolean).length}
          search={
            <SearchInput
              value={searchInput}
              onChange={setSearchInput}
              placeholder="Search client, worker, iqama, project…"
              className="sm:w-[260px]"
            />
          }
        >
          <FilterSelect
            key="month"
            value={month}
            onChange={(v) => {
              setMonth(v)
              setExpanded(null)
            }}
            options={MONTH_OPTIONS}
            placeholder="Month"
            allowEmpty={false}
            className="sm:w-[150px]"
          />
          <FilterSelect
            key="year"
            value={year}
            onChange={(v) => {
              setYear(v)
              setExpanded(null)
            }}
            options={YEAR_OPTIONS}
            placeholder="Year"
            allowEmpty={false}
            className="sm:w-[110px]"
          />
          <FilterSelect
            key="scope"
            value={scope}
            onChange={setScope}
            placeholder="Staff scope"
            emptyLabel="Active staff only"
            options={STAFF_SCOPE_OPTIONS}
            className="sm:w-[210px]"
          />
        </FilterBar>
      </div>

      {/* Printable report content */}
      <div className="print-area print-landscape space-y-6">
        {/* Print-only report heading (company + period) */}
        <div className="hidden print:block">
          <h1 className="text-lg font-bold uppercase tracking-wide">{settings.companyName}</h1>
          <p className="mt-0.5 text-sm font-semibold">
            Client Salary Summary — Manpower Billing · {periodLabel}
          </p>
          <p className="text-[11px] text-neutral-600">
            Staff scope: {scopeLabel} · Clients: {cards?.totalClients ?? 0} · Workers billed:{' '}
            {cards?.totalWorkers ?? 0} · Hours: {fmtHours(cards?.billedHours ?? 0)}
            {cards && cards.billedOtHours > 0 ? ` + ${fmtHours(cards.billedOtHours)} OT` : ''} ·
            Billed (excl. VAT): {money(cards?.billedAmount ?? 0)} · Grand total (incl.{' '}
            {vatPercent}% VAT): {money(cards?.grandTotal ?? 0)}
          </p>
        </div>

        {/* Top stat cards */}
        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-[108px] animate-pulse rounded-xl border bg-muted/40"
                style={{ animationDelay: `${i * 80}ms` }}
              />
            ))}
          </div>
        ) : cards ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              title="Client Companies"
              value={String(cards.totalClients)}
              icon={Building2}
              tone="navy"
              sublabel="Clients billed this month"
            />
            <StatCard
              title="Workers Billed"
              value={String(cards.totalWorkers)}
              icon={Users}
              tone="teal"
              sublabel={`With payroll in ${periodLabel}`}
            />
            <StatCard
              title={`Billed Amount — ${periodLabel}`}
              value={formatNumber(cards.billedAmount)}
              valuePrefix={settings.currency}
              icon={Wallet}
              tone="violet"
              sublabel={`${fmtHours(cards.billedHours)} h${cards.billedOtHours > 0 ? ` + ${fmtHours(cards.billedOtHours)} OT` : ''} × client rate (excl. VAT)`}
            />
            <StatCard
              title="Grand Total (incl. VAT)"
              value={formatNumber(cards.grandTotal)}
              valuePrefix={settings.currency}
              icon={BadgeDollarSign}
              tone="gold"
              sublabel={`incl. ${money(cards.vatAmount)} VAT (${vatPercent}%)`}
            />
          </div>
        ) : null}

        {/* How this report works — hours synced from payroll, rates entered here */}
        {!loading && view && groups.length > 0 ? (
          <div className="space-y-1.5 rounded-xl border border-dashed bg-muted/30 px-4 py-2.5 text-xs leading-relaxed text-muted-foreground print:px-2">
            <p className="flex items-start gap-2">
              <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>
                <span className="font-semibold text-foreground">Hours &amp; OT hours are synced</span>{' '}
                from the <span className="font-semibold text-foreground">{periodLabel}</span> payroll —
                exactly the same numbers as each worker&apos;s Salary Sheet. To change hours, edit the
                payroll record; they update here automatically.
              </span>
            </p>
            <p className="flex items-start gap-2">
              <Pencil className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>
                <span className="font-semibold text-foreground">Type the client rate</span> in the Rate
                column of each worker (and the OT rate when needed) — the price you charge the client
                company is separate from the worker&apos;s own pay rate. Amounts and totals update
                live; every entry is saved per worker, per month.
              </span>
            </p>
          </div>
        ) : null}

        {/* Bench + multi-client context notes */}
        {!loading && cards && (cards.benchWorkers > 0 || cards.multiClientWorkers > 0) ? (
          <div className="space-y-1.5 rounded-xl border border-dashed bg-muted/30 px-4 py-2.5 text-xs leading-relaxed text-muted-foreground print:px-2">
            {cards.benchWorkers > 0 && (
              <p className="flex items-start gap-2">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                <span>
                  <span className="font-semibold text-foreground">{cards.benchWorkers}</span> active staff are
                  not deployed to any project (bench) —{' '}
                  <span className="font-semibold text-foreground">{money(cards.benchSalary)}</span>/month is
                  not included in the client totals.
                </span>
              </p>
            )}
            {cards.multiClientWorkers > 0 && (
              <p className="flex items-start gap-2">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                <span>
                  <span className="font-semibold text-foreground">{cards.multiClientWorkers}</span> workers are
                  billed under more than one client and appear in each client&apos;s list; the cards above
                  count them once.
                </span>
              </p>
            )}
          </div>
        ) : null}

        {!loading && fallbackProjects.length > 0 ? (
          <div className="print-hidden flex items-start gap-2 rounded-xl border border-amber-300/60 bg-amber-50 px-4 py-2.5 text-xs leading-relaxed text-amber-900 dark:border-amber-500/30 dark:bg-amber-950/40 dark:text-amber-200">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>
              <span className="font-semibold">
                {fallbackProjects.length} project{fallbackProjects.length === 1 ? '' : 's'}
              </span>{' '}
              ({fallbackProjects.join(', ')}) ha{fallbackProjects.length === 1 ? 's' : 've'} workers
              still billed at each worker&apos;s OWN pay rate (no client rate set).
              {canEditRate
                ? ' Type the agreed client rate in the Rate column below, or use "Apply to all" for a whole project.'
                : ' Ask an admin/accountant to enter the client rates.'}
            </span>
          </div>
        ) : null}

        {/* Client-wise billing breakdown */}
        <SectionCard>
          <div className="border-b px-4 py-3 sm:px-6">
            <h2 className="text-sm font-semibold">Client-wise Billing Breakdown</h2>
            <p className="text-xs text-muted-foreground">
              {periodLabel} · payroll hours × manually-entered client rate + {vatPercent}% VAT — sorted
              by grand total; expand a client to enter rates and print or download that company&apos;s
              summary
            </p>
          </div>

          {loading ? (
            <TableSkeleton rows={5} cols={7} />
          ) : groups.length === 0 ? (
            <EmptyState
              icon={FileBarChart}
              title={search ? 'No matches for the current search' : `No payroll records for ${periodLabel}`}
              description={
                search
                  ? 'Try a different client, worker, iqama or project name.'
                  : 'Client billing mirrors payroll hours — create this month’s payroll in the Payroll module (or Salary Sheet) first, and every worker will appear here automatically with their hours.'
              }
            />
          ) : (
            <>
              {/* Mobile: stacked expandable cards */}
              <ul className="space-y-3 p-4 sm:p-6 md:hidden print:hidden">
                {groups.map((g) => {
                  const key = groupKey(g)
                  const open = expanded === key
                  return (
                    <li key={key} className="rounded-xl border bg-card shadow-sm">
                      <button
                        type="button"
                        onClick={() => toggle(key)}
                        aria-expanded={open}
                        className="flex w-full items-start justify-between gap-3 p-3 text-left"
                      >
                        <div className="min-w-0">
                          <p className="flex items-center gap-2 truncate font-medium">
                            <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                            <span className="truncate">{g.clientName}</span>
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {g.workerCount} workers · {fmtHours(g.hours)} h
                            {g.otHours > 0 ? ` + ${fmtHours(g.otHours)} OT` : ''}
                            {g.city ? ` · ${g.city}` : ''}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-sm font-bold tabular-nums">{money(g.grandTotal)}</p>
                          <p className="text-[11px] text-muted-foreground">incl. {money(g.vatAmount)} VAT</p>
                        </div>
                        <ChevronRight
                          className={cn(
                            'mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform',
                            open && 'rotate-90'
                          )}
                          aria-hidden
                        />
                      </button>
                      {open ? (
                        <div className="border-t px-3 py-2.5">
                          {bucketByProject(g.rows).map((p) => (
                            <div key={p.projectId} className="mb-3">
                              <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold">
                                <FolderKanban className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                                {p.projectName}
                                <span className="font-normal text-muted-foreground">
                                  · {p.rows.length} worker{p.rows.length === 1 ? '' : 's'}
                                </span>
                              </p>
                              {canEditRate ? (
                                <div className="mb-2">
                                  <BulkRateApply
                                    projectId={p.projectId}
                                    month={Number(month)}
                                    year={Number(year)}
                                    workerCount={p.rows.length}
                                    currency={settings.currency}
                                    onApplied={(rate, ot) => applyBulkToLocal(p.projectId, rate, ot)}
                                  />
                                </div>
                              ) : null}
                              <ul className="divide-y">
                                {p.rows.map((r) => (
                                  <li key={r.payrollId} className="flex items-start justify-between gap-3 py-2">
                                    <div className="min-w-0 flex-1">
                                      <p className="truncate text-sm font-medium">{r.fullName}</p>
                                      <p className="truncate text-[11px] text-muted-foreground">
                                        {fmtHours(r.hours)} h
                                        {r.otHours > 0 ? ` + ${fmtHours(r.otHours)} OT` : ''} ×{' '}
                                        {formatNumber(r.clientRate)} {settings.currency}
                                        {r.rateSource === 'worker' ? ' ⚠' : ''}
                                      </p>
                                      {canEditRate ? (
                                        <div className="mt-1 flex items-center gap-2">
                                          <RateCell
                                            value={r.clientRate}
                                            manual={r.manualRate}
                                            currency={settings.currency}
                                            canEdit
                                            compact
                                            ariaLabel={`Client rate for ${r.fullName}`}
                                            onChange={(v) => setEdit(r.payrollId, { rate: v })}
                                            onCommit={(v) => commitRate(r.payrollId, v)}
                                          />
                                          {r.otHours > 0 ? (
                                            <RateCell
                                              value={r.clientOtRate}
                                              manual={r.manualOtRate}
                                              currency={settings.currency}
                                              canEdit
                                              compact
                                              ariaLabel={`Client OT rate for ${r.fullName}`}
                                              onChange={(v) => setEdit(r.payrollId, { otRate: v })}
                                              onCommit={(v) => commitOtRate(r.payrollId, v)}
                                            />
                                          ) : null}
                                        </div>
                                      ) : null}
                                    </div>
                                    <p className="shrink-0 text-sm font-semibold tabular-nums">
                                      {money(r.amount)}
                                    </p>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ))}
                          <div className="mt-2 space-y-1 border-t pt-2 text-xs">
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Subtotal (excl. VAT)</span>
                              <span className="font-semibold tabular-nums">{money(g.billedAmount)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">VAT ({vatPercent}%)</span>
                              <span className="font-semibold tabular-nums">{money(g.vatAmount)}</span>
                            </div>
                            <div className="flex justify-between text-sm">
                              <span className="font-bold">Grand Total</span>
                              <span className="font-bold tabular-nums">{money(g.grandTotal)}</span>
                            </div>
                          </div>
                          <div className="mt-3 flex gap-2">
                            <Button size="sm" variant="outline" className="flex-1" onClick={() => setPrintGroup(g)}>
                              <Printer className="h-3.5 w-3.5" />
                              Print
                            </Button>
                            <Button size="sm" variant="outline" className="flex-1" onClick={() => exportClientCsv(g)}>
                              <Download className="h-3.5 w-3.5" />
                              CSV
                            </Button>
                          </div>
                        </div>
                      ) : null}
                    </li>
                  )
                })}
                {/* Totals card */}
                <li className="rounded-xl border bg-muted/40 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold">Total — all clients</p>
                    <p className="text-sm font-bold tabular-nums">{money(totals.grand)}</p>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {totals.workers} workers · {fmtHours(totals.hours)} h
                    {totals.otHours > 0 ? ` + ${fmtHours(totals.otHours)} OT` : ''} · incl.{' '}
                    {money(totals.vat)} VAT
                  </p>
                </li>
              </ul>

              {/* Desktop: expandable table */}
              <div className="hidden overflow-x-auto md:block print:block print:overflow-visible">
                <Table className="print-fit-cells text-sm">
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="h-9 w-10 px-3 print:px-1" aria-label="Expand" />
                      <TableHead className="h-9 min-w-[200px] px-4 print:min-w-0 print:px-2">Client Company</TableHead>
                      <TableHead className="h-9 px-4 text-right print:px-2">Workers</TableHead>
                      <TableHead className="h-9 px-4 text-right print:px-2">Hours</TableHead>
                      <TableHead className="h-9 px-4 text-right print:px-2">OT Hrs</TableHead>
                      <TableHead className="h-9 px-4 text-right print:px-2">Subtotal (excl. VAT)</TableHead>
                      <TableHead className="h-9 px-4 text-right print:px-2">VAT ({vatPercent}%)</TableHead>
                      <TableHead className="h-9 px-4 text-right print:px-2">Grand Total</TableHead>
                      <TableHead className="h-9 min-w-[150px] px-4 print:min-w-0 print:px-2">Share %</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {groups.map((g) => {
                      const key = groupKey(g)
                      const open = expanded === key
                      return [
                        <TableRow
                          key={key}
                          className={cn('cursor-pointer transition-colors', open && 'bg-muted/40')}
                          onClick={() => toggle(key)}
                        >
                          <TableCell className="px-3 py-2.5 print:px-1">
                            <button
                              type="button"
                              aria-expanded={open}
                              aria-label={`${open ? 'Collapse' : 'Expand'} ${g.clientName} workers`}
                              onClick={(e) => {
                                e.stopPropagation()
                                toggle(key)
                              }}
                              className="rounded-md p-1 text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              <ChevronRight
                                className={cn('h-4 w-4 transition-transform', open && 'rotate-90')}
                                aria-hidden
                              />
                            </button>
                          </TableCell>
                          <TableCell className="px-4 py-2.5 print:px-2">
                            <div className="flex items-center gap-2">
                              <Building2
                                className={cn(
                                  'h-4 w-4 shrink-0',
                                  g.clientId ? 'text-muted-foreground' : 'text-muted-foreground/60'
                                )}
                                aria-hidden
                              />
                              <div className="min-w-0">
                                <p className="flex flex-wrap items-center gap-2 font-medium">
                                  <span className="truncate print:whitespace-normal">{g.clientName}</span>
                                  {g.clientStatus === 'inactive' && (
                                    <StatusBadge kind="inactive" className="px-1.5 py-0 text-[10px]" />
                                  )}
                                </p>
                                <p className="truncate text-xs text-muted-foreground print:whitespace-normal">
                                  {[
                                    g.city,
                                    g.contactPerson ? `Attn: ${g.contactPerson}` : null,
                                    g.phone,
                                  ]
                                    .filter(Boolean)
                                    .join(' · ') || '—'}
                                </p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="px-4 py-2.5 text-right tabular-nums print:px-2">{g.workerCount}</TableCell>
                          <TableCell className="px-4 py-2.5 text-right tabular-nums print:px-2">
                            <span title="Regular hours — mirrors this month's payroll">
                              {fmtHours(g.hours)}
                            </span>
                          </TableCell>
                          <TableCell className="px-4 py-2.5 text-right tabular-nums text-muted-foreground print:px-2">
                            {g.otHours > 0 ? (
                              <span title="Overtime hours — mirrors this month's payroll">
                                {fmtHours(g.otHours)}
                              </span>
                            ) : (
                              '—'
                            )}
                          </TableCell>
                          <TableCell className="px-4 py-2.5 text-right tabular-nums print:px-2">
                            {money(g.billedAmount)}
                          </TableCell>
                          <TableCell className="px-4 py-2.5 text-right tabular-nums text-muted-foreground print:px-2">
                            {money(g.vatAmount)}
                          </TableCell>
                          <TableCell className="px-4 py-2.5 text-right font-semibold tabular-nums print:px-2">
                            {money(g.grandTotal)}
                          </TableCell>
                          <TableCell className="px-4 py-2.5 print:px-2">
                            <div className="flex items-center gap-2">
                              <Progress
                                value={g.share}
                                aria-label={`${g.clientName} share of grand total billing`}
                                className="h-2 w-16 sm:w-24"
                              />
                              <span className="w-16 text-right text-xs tabular-nums text-muted-foreground">
                                {formatNumber(g.share)}%
                              </span>
                            </div>
                          </TableCell>
                        </TableRow>,
                        <TableRow
                          key={`${key}-detail`}
                          className={cn('bg-muted/20 hover:bg-muted/20', open ? '' : 'hidden print:table-row')}
                        >
                          <TableCell colSpan={9} className="px-4 py-3 sm:px-8 print:px-4">
                            <div className="rounded-lg border bg-background">
                              <div className="flex flex-wrap items-center justify-between gap-3 border-b px-3 py-2">
                                <p className="text-xs font-semibold">
                                  Billed workers — {g.clientName}
                                  <span className="ml-2 font-normal text-muted-foreground">
                                    {g.workerCount} worker{g.workerCount === 1 ? '' : 's'} ·{' '}
                                    {g.workersWithHours} with hours this month
                                  </span>
                                </p>
                                <div className="print-hidden flex items-center gap-2">
                                  <Button size="sm" variant="outline" onClick={() => setPrintGroup(g)}>
                                    <Printer className="h-3.5 w-3.5" />
                                    Print Summary
                                  </Button>
                                  <Button size="sm" variant="outline" onClick={() => exportClientCsv(g)}>
                                    <Download className="h-3.5 w-3.5" />
                                    CSV
                                  </Button>
                                </div>
                              </div>

                              {/* One section per project — rates entered per worker below */}
                              {bucketByProject(g.rows).map((p) => (
                                <div key={p.projectId} className="break-inside-avoid">
                                  <div className="flex flex-wrap items-center justify-between gap-2 bg-muted/30 px-3 py-1.5">
                                    <p className="flex items-center gap-1.5 text-xs font-semibold">
                                      <FolderKanban className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                                      {p.projectName}
                                      <span className="font-normal text-muted-foreground">
                                        · {p.rows.length} worker{p.rows.length === 1 ? '' : 's'} ·{' '}
                                        {fmtHours(p.hours)} h
                                        {p.otHours > 0 ? ` + ${fmtHours(p.otHours)} OT` : ''}
                                      </span>
                                    </p>
                                    <div className="flex flex-wrap items-center gap-3">
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <span className="cursor-help text-xs tabular-nums text-muted-foreground">
                                            default {formatNumber(p.projectRate)}{' '}
                                            {settings.currency}/h
                                          </span>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                          This project&apos;s default client rate (set in Project
                                          Management) — used for workers whose rate is not entered
                                          below
                                        </TooltipContent>
                                      </Tooltip>
                                      {canEditRate ? (
                                        <BulkRateApply
                                          projectId={p.projectId}
                                          month={Number(month)}
                                          year={Number(year)}
                                          workerCount={p.rows.length}
                                          currency={settings.currency}
                                          onApplied={(rate, ot) => applyBulkToLocal(p.projectId, rate, ot)}
                                        />
                                      ) : null}
                                      <span className="text-xs font-bold tabular-nums">
                                        {money(p.subtotal)}
                                      </span>
                                    </div>
                                  </div>
                                  <div className="overflow-x-auto">
                                    <Table className="text-xs">
                                      <TableHeader>
                                        <TableRow className="hover:bg-transparent">
                                          <TableHead className="h-8 w-10 px-3 text-right">#</TableHead>
                                          <TableHead className="h-8 min-w-[170px] px-3 print:min-w-0">Worker</TableHead>
                                          <TableHead className="h-8 min-w-[110px] px-3 print:min-w-0">Position</TableHead>
                                          <TableHead className="h-8 min-w-[100px] px-3 print:min-w-0">Category</TableHead>
                                          <TableHead className="h-8 px-3 text-right">
                                            <span title="Mirrors this month's payroll — edit hours in the Payroll module">
                                              Hours
                                            </span>
                                          </TableHead>
                                          <TableHead className="h-8 px-3 text-right">OT Hrs</TableHead>
                                          <TableHead className="h-8 min-w-[110px] px-3 text-right">
                                            <span title="Client billing price per regular hour — enter manually; separate from the worker's pay rate">
                                              Rate / Hr
                                            </span>
                                          </TableHead>
                                          <TableHead className="h-8 min-w-[110px] px-3 text-right">
                                            <span title="Client billing price per overtime hour — defaults to the regular rate">
                                              OT Rate
                                            </span>
                                          </TableHead>
                                          <TableHead className="h-8 px-3 text-right">Amount</TableHead>
                                        </TableRow>
                                      </TableHeader>
                                      <TableBody>
                                        {p.rows.map((r, i) => (
                                          <TableRow
                                            key={r.payrollId}
                                            className={r.hours === 0 && r.otHours === 0 ? 'text-muted-foreground/70' : undefined}
                                          >
                                            <TableCell className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                                              {i + 1}
                                            </TableCell>
                                            <TableCell className="px-3 py-1.5">
                                              <p className="font-medium">{r.fullName}</p>
                                              <p className="text-[10px] text-muted-foreground">IQAMA {r.iqamaId}</p>
                                            </TableCell>
                                            <TableCell className="px-3 py-1.5">{r.position ?? '—'}</TableCell>
                                            <TableCell className="px-3 py-1.5 text-muted-foreground">
                                              {r.categoryName ?? '—'}
                                            </TableCell>
                                            <TableCell className="px-3 py-1.5 text-right tabular-nums">
                                              <span className="inline-flex items-center gap-1">
                                                {fmtHours(r.hours)}
                                                <Lock
                                                  className="h-2.5 w-2.5 text-muted-foreground/60"
                                                  aria-label="Hours synced from payroll"
                                                />
                                              </span>
                                            </TableCell>
                                            <TableCell className="px-3 py-1.5 text-right tabular-nums">
                                              {r.otHours > 0 ? (
                                                <span className="inline-flex items-center gap-1">
                                                  {fmtHours(r.otHours)}
                                                  <Lock
                                                    className="h-2.5 w-2.5 text-muted-foreground/60"
                                                    aria-label="OT hours synced from payroll"
                                                  />
                                                </span>
                                              ) : (
                                                '—'
                                              )}
                                            </TableCell>
                                            <TableCell className="px-3 py-1.5 text-right">
                                              <div className="flex flex-col items-end">
                                                <RateCell
                                                  value={r.clientRate}
                                                  manual={r.manualRate}
                                                  currency={settings.currency}
                                                  canEdit={canEditRate}
                                                  ariaLabel={`Client rate per hour for ${r.fullName}`}
                                                  onChange={(v) => setEdit(r.payrollId, { rate: v })}
                                                  onCommit={(v) => commitRate(r.payrollId, v)}
                                                />
                                                {rateSourceBadge(r)}
                                              </div>
                                            </TableCell>
                                            <TableCell className="px-3 py-1.5 text-right">
                                              {r.otHours > 0 || r.manualOtRate > 0 ? (
                                                <div className="flex flex-col items-end">
                                                  <RateCell
                                                    value={r.clientOtRate}
                                                    manual={r.manualOtRate}
                                                    currency={settings.currency}
                                                    canEdit={canEditRate}
                                                    ariaLabel={`Client overtime rate for ${r.fullName}`}
                                                    onChange={(v) => setEdit(r.payrollId, { otRate: v })}
                                                    onCommit={(v) => commitOtRate(r.payrollId, v)}
                                                  />
                                                  <span className="text-[9px] text-muted-foreground">
                                                    {r.manualOtRate > 0 ? 'manual' : '= regular'}
                                                  </span>
                                                </div>
                                              ) : (
                                                <span className="text-muted-foreground">—</span>
                                              )}
                                            </TableCell>
                                            <TableCell className="px-3 py-1.5 text-right font-semibold tabular-nums">
                                              {money(r.amount)}
                                            </TableCell>
                                          </TableRow>
                                        ))}
                                      </TableBody>
                                    </Table>
                                  </div>
                                </div>
                              ))}

                              {/* Client totals */}
                              <div className="space-y-1 border-t px-3 py-2.5 text-xs">
                                <div className="flex items-center justify-between">
                                  <span className="text-muted-foreground">
                                    Subtotal — {g.workerCount} worker{g.workerCount === 1 ? '' : 's'} (excl. VAT)
                                  </span>
                                  <span className="font-semibold tabular-nums">{money(g.billedAmount)}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <span className="text-muted-foreground">VAT ({vatPercent}%)</span>
                                  <span className="font-semibold tabular-nums">{money(g.vatAmount)}</span>
                                </div>
                                <div className="flex items-center justify-between border-t pt-1.5 text-sm">
                                  <span className="font-bold">Grand Total (incl. VAT)</span>
                                  <span className="font-bold tabular-nums">{money(g.grandTotal)}</span>
                                </div>
                                <p className="print-hidden pt-1 text-[11px] text-muted-foreground">
                                  Worker payroll cost (hours × worker pay rate): {money(g.workerCost)} ·
                                  Estimated margin before VAT:{' '}
                                  <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                                    {money(g.margin)}
                                  </span>
                                </p>
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>,
                      ]
                    })}
                  </TableBody>
                  <TableFooter>
                    <TableRow className="bg-muted/50 font-semibold hover:bg-muted/50">
                      <TableCell className="px-3 py-2.5 print:px-1" />
                      <TableCell className="px-4 py-2.5 print:px-2">Total</TableCell>
                      <TableCell className="px-4 py-2.5 text-right tabular-nums print:px-2">{totals.workers}</TableCell>
                      <TableCell className="px-4 py-2.5 text-right tabular-nums print:px-2">{fmtHours(totals.hours)}</TableCell>
                      <TableCell className="px-4 py-2.5 text-right tabular-nums print:px-2">
                        {totals.otHours > 0 ? fmtHours(totals.otHours) : '—'}
                      </TableCell>
                      <TableCell className="px-4 py-2.5 text-right tabular-nums print:px-2">{money(totals.billed)}</TableCell>
                      <TableCell className="px-4 py-2.5 text-right tabular-nums print:px-2">{money(totals.vat)}</TableCell>
                      <TableCell className="px-4 py-2.5 text-right tabular-nums print:px-2">{money(totals.grand)}</TableCell>
                      <TableCell className="px-4 py-2.5 text-right tabular-nums print:px-2">100%</TableCell>
                    </TableRow>
                  </TableFooter>
                </Table>
              </div>
            </>
          )}
        </SectionCard>

        {/* Print footer note */}
        <p className="hidden text-center text-[9px] text-neutral-400 print:block">
          Computer-generated summary — {settings.companyName} Workforce, Payroll &amp; Accounts System
        </p>
      </div>

      {/* Per-client printable billing statement */}
      <ClientSummaryPrintDialog
        open={printGroup !== null}
        onOpenChange={(o) => {
          if (!o) setPrintGroup(null)
        }}
        group={printGroup}
        month={Number(month)}
        year={Number(year)}
        vatRate={view?.vatRate ?? 0.15}
      />
    </div>
  )
}

// HMR bump 2026-01-payroll-synced-rates

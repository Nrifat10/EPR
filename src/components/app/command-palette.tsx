'use client'

import { useEffect, useState } from 'react'
import {
  BadgeDollarSign,
  BarChart3,
  BookUser,
  Building2,
  CalendarClock,
  FileOutput,
  FileSignature,
  FileSpreadsheet,
  FileText,
  FolderKanban,
  HandCoins,
  HardHat,
  History,
  Landmark,
  LayoutDashboard,
  Loader2,
  MapPin,
  Network,
  Package,
  PieChart,
  BadgePercent,
  ReceiptText,
  ScrollText,
  Settings as SettingsIcon,
  ShieldCheck,
  Sparkles,
  Tags,
  TrendingDown,
  TrendingUp,
  UserCog,
  Users,
  Wallet,
} from 'lucide-react'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command'
import { api } from '@/lib/api-client'
import { formatMoney, monthName } from '@/lib/format'
import { useDebounce } from '@/hooks/use-debounce'
import { useAppStore, can } from '@/lib/store'
import type { PaletteSearchResults, ViewKey } from '@/lib/types'

type NavEntry = { view: ViewKey; label: string; icon: React.ComponentType<{ className?: string }>; perm: string; keywords: string }

const NAV: NavEntry[] = [
  { view: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, perm: 'dashboard.view', keywords: 'home overview stats' },
  { view: 'ai-assistant', label: 'AI Assistant', icon: Sparkles, perm: 'ai.use', keywords: 'chat ai assistant glm claude openai ask questions copilot' },
  { view: 'projects', label: 'Project Management', icon: FolderKanban, perm: 'projects.view', keywords: 'construction sites directory' },
  { view: 'clients', label: 'Clients', icon: Building2, perm: 'clients.view', keywords: 'customer company contact cr' },
  { view: 'deployments', label: 'Worker Deployment', icon: Network, perm: 'clients.view', keywords: 'who works where company allocation mapping bench' },
  { view: 'staff-list', label: 'Staff List', icon: Users, perm: 'staff.view', keywords: 'workforce directory employees iqama' },
  { view: 'staff-categories', label: 'Staff Categories', icon: Tags, perm: 'staff.view', keywords: 'job classification trades' },
  { view: 'attendance', label: 'Staff Attendance', icon: CalendarClock, perm: 'attendance.view', keywords: 'check in out timesheet hours' },
  { view: 'payroll', label: 'Payroll', icon: Wallet, perm: 'payroll.view', keywords: 'salary wages monthly payment deductions' },
  { view: 'advances', label: 'Worker Advances', icon: HandCoins, perm: 'advances.view', keywords: 'advance loan worker deduction recovery installment outstanding' },
  { view: 'salary-sheet', label: 'Salary Sheet', icon: FileSpreadsheet, perm: 'payroll.view', keywords: 'monthly sheet print landscape' },
  { view: 'salary-summary', label: 'Staff Salary Summary', icon: ScrollText, perm: 'payroll.view', keywords: 'category breakdown report' },
  { view: 'client-salary-summary', label: 'Client Salary Summary', icon: ReceiptText, perm: 'payroll.view', keywords: 'client company original salary price manpower cost billing' },
  { view: 'income-list', label: 'Income List', icon: TrendingUp, perm: 'accounts.view', keywords: 'revenue payments received' },
  { view: 'expense-list', label: 'Expense List', icon: TrendingDown, perm: 'accounts.view', keywords: 'spending costs salary expense' },
  { view: 'accounts-summary', label: 'Accounts Summary', icon: PieChart, perm: 'accounts.view', keywords: 'financial statement balance chart' },
  { view: 'transaction-categories', label: 'Transaction Categories', icon: BarChart3, perm: 'accounts.view', keywords: 'income expense classification' },
  { view: 'vat-return-expense', label: 'VAT Return Expense', icon: BadgePercent, perm: 'vat.view', keywords: 'zatca tax input vat quarterly filing supplier bills 15%' },
  { view: 'quotations', label: 'Quotations', icon: FileText, perm: 'quotations.view', keywords: 'quote price offer estimate proposal client' },
  { view: 'e-invoices', label: 'E-Invoice', icon: FileOutput, perm: 'einvoices.view', keywords: 'bill billing tax invoice zatca bilingual arabic qr payment due credit debit note' },
  { view: 'supplier-pos', label: 'Supplier P.O.', icon: Package, perm: 'supplierpo.view', keywords: 'purchase order supplier buy materials' },
  { view: 'agreements', label: 'Agreements', icon: FileSignature, perm: 'agreements.view', keywords: 'contract labor supply service subcontract clauses installments' },
  { view: 'name-list', label: 'Name List', icon: BookUser, perm: 'namelist.view', keywords: 'worker lists interview mobilization trade test medical demobilization companies directory' },
  { view: 'roles', label: 'Roles & Permissions', icon: ShieldCheck, perm: 'roles.view', keywords: 'access control rbac' },
  { view: 'users', label: 'Users', icon: UserCog, perm: 'users.view', keywords: 'accounts login team' },
  { view: 'settings', label: 'Settings', icon: SettingsIcon, perm: 'settings.view', keywords: 'company profile logo currency' },
  { view: 'activity-log', label: 'Activity Log', icon: History, perm: 'activity.view', keywords: 'audit trail history who did what changelog' },
]

type QuickAction = {
  view: ViewKey
  label: string
  icon: React.ComponentType<{ className?: string }>
  perm: string
  keywords: string
  /** When set, the target view deep-opens its create dialog on arrival */
  intent?: 'create' | 'print'
}

const ACTIONS: QuickAction[] = [
  { view: 'payroll', label: 'Create Payroll', icon: Wallet, perm: 'payroll.create', keywords: 'new salary add wages', intent: 'create' },
  { view: 'advances', label: 'Give Worker Advance', icon: HandCoins, perm: 'advances.create', keywords: 'new advance loan cash payment worker', intent: 'create' },
  { view: 'staff-list', label: 'Add New Staff', icon: HardHat, perm: 'staff.create', keywords: 'new employee worker hire', intent: 'create' },
  { view: 'projects', label: 'New Project', icon: FolderKanban, perm: 'projects.create', keywords: 'add construction site', intent: 'create' },
  { view: 'clients', label: 'New Client', icon: Building2, perm: 'clients.create', keywords: 'add customer company', intent: 'create' },
  { view: 'income-list', label: 'Add Income', icon: TrendingUp, perm: 'accounts.create', keywords: 'new revenue payment received', intent: 'create' },
  { view: 'expense-list', label: 'Add Expense', icon: TrendingDown, perm: 'accounts.create', keywords: 'new cost spending', intent: 'create' },
  { view: 'vat-return-expense', label: 'Add VAT Bill', icon: BadgePercent, perm: 'vat.create', keywords: 'new vat expense supplier bill input tax 15% quarterly', intent: 'create' },
  { view: 'quotations', label: 'New Quotation', icon: FileText, perm: 'quotations.create', keywords: 'new quote price offer estimate', intent: 'create' },
  { view: 'e-invoices', label: 'New E-Invoice', icon: FileOutput, perm: 'einvoices.create', keywords: 'new bill invoice tax zatca bilingual arabic customer charge', intent: 'create' },
  { view: 'supplier-pos', label: 'New Supplier P.O.', icon: Package, perm: 'supplierpo.create', keywords: 'new purchase order supplier buy', intent: 'create' },
  { view: 'agreements', label: 'New Agreement', icon: FileSignature, perm: 'agreements.create', keywords: 'new contract labor supply service', intent: 'create' },
  { view: 'name-list', label: 'New Name List', icon: BookUser, perm: 'namelist.create', keywords: 'new worker list interview mobilization trade test medical demobilization deployment', intent: 'create' },
  { view: 'attendance', label: 'Mark Attendance', icon: CalendarClock, perm: 'attendance.create', keywords: 'check in timesheet hours present', intent: 'create' },
  { view: 'salary-sheet', label: 'Print Salary Sheet', icon: FileSpreadsheet, perm: 'payroll.print', keywords: 'export report landscape paper pdf', intent: 'print' },
]

const REPORTS: QuickAction[] = [
  { view: 'salary-summary', label: 'Staff Salary Summary Report', icon: ScrollText, perm: 'payroll.view', keywords: 'category share distribution' },
  { view: 'client-salary-summary', label: 'Client Salary Summary Report', icon: ReceiptText, perm: 'payroll.view', keywords: 'client company original price salary rollup' },
  { view: 'advances', label: 'Worker Advance Ledger Report', icon: HandCoins, perm: 'advances.view', keywords: 'outstanding balance recovery ledger' },
  { view: 'accounts-summary', label: 'Financial Statement', icon: Landmark, perm: 'accounts.view', keywords: 'profit loss performance' },
  { view: 'dashboard', label: 'Financial Performance Chart', icon: BadgeDollarSign, perm: 'dashboard.view', keywords: 'income expense trend 6 months' },
]

const EMPTY_RESULTS: PaletteSearchResults = { staff: [], projects: [], clients: [], transactions: [], payrolls: [] }

/**
 * Strict match filter (replaces cmdk's weak letter-order fuzzy):
 * 1. Substring match — scored by position (earlier = better)
 * 2. Every search word prefixes some value word ("print salary" → Salary Sheet …print…)
 * 3. Otherwise the item is hidden. This keeps loosely-spelled look-alikes out and
 *    lets late-arriving record results become the auto-selected first item.
 */
function paletteFilter(value: string, search: string): number {
  const v = value.toLowerCase()
  const s = search.trim().toLowerCase()
  if (!s) return 1
  const idx = v.indexOf(s)
  if (idx >= 0) return 100 - Math.min(50, idx)
  const sWords = s.split(/\s+/).filter(Boolean)
  if (sWords.length > 1) {
    const vWords = v.split(/[\s—–-]+/).filter(Boolean)
    if (sWords.every((w) => vWords.some((vw) => vw.startsWith(w)))) return 50
  }
  return 0
}

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { user, setView, setPendingIntent } = useAppStore()

  // Global record search (staff + projects + transactions + payrolls) typed into the palette input.
  // Results remember the query they belong to, so the loading spinner is DERIVED
  // (results.q !== current query) instead of imperative state — no effect-setState.
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebounce(query)
  const [results, setResults] = useState<{ q: string } & PaletteSearchResults>({
    q: '',
    staff: [],
    projects: [],
    clients: [],
    transactions: [],
    payrolls: [],
  })
  const canSearchStaff = can(user, 'staff.view')
  const canSearchProjects = can(user, 'projects.view')
  const canSearchClients = can(user, 'clients.view')
  const canSearchTransactions = can(user, 'accounts.view')
  const canSearchPayrolls = can(user, 'payroll.view')
  const canSearch =
    canSearchStaff || canSearchProjects || canSearchClients || canSearchTransactions || canSearchPayrolls
  const { currency } = useAppStore((s) => s.settings)
  // Derived: records only render while a real query is typed (instant hide)
  const recordSearchActive = open && canSearch && query.trim().length >= 2
  // Derived: true while the fetch for the current query is in flight (or debouncing)
  const activeQuery = debouncedQuery.trim()
  const searching = recordSearchActive && results.q !== activeQuery
  const shown = searching ? EMPTY_RESULTS : results

  useEffect(() => {
    const q = debouncedQuery.trim()
    if (!open || !canSearch || q.length < 2) return
    let cancelled = false
    api
      .get<PaletteSearchResults>(`/api/search?q=${encodeURIComponent(q)}`)
      .then((res) => {
        if (!cancelled) setResults({ q, ...res })
      })
      .catch(() => {
        // Non-blocking: static commands remain fully usable
        if (!cancelled) setResults({ q, staff: [], projects: [], clients: [], transactions: [], payrolls: [] })
      })
    return () => {
      cancelled = true
    }
  }, [debouncedQuery, open, canSearch])

  /** Every close path (Escape, backdrop, select, Ctrl+K) resets the input */
  function handleOpenChange(next: boolean) {
    onOpenChange(next)
    if (!next) setQuery('')
  }

  // Global shortcut: Ctrl+K / Cmd+K
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        handleOpenChange(!open)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onOpenChange])

  const visibleNav = NAV.filter((n) => can(user, n.perm))
  const visibleActions = ACTIONS.filter((a) => can(user, a.perm))
  const visibleReports = REPORTS.filter((r) => can(user, r.perm))
  const hasRecords =
    shown.staff.length > 0 ||
    shown.projects.length > 0 ||
    shown.clients.length > 0 ||
    shown.transactions.length > 0 ||
    shown.payrolls.length > 0
  const showRecords = recordSearchActive && (hasRecords || searching)

  function run(view: ViewKey, intent?: 'create' | 'print') {
    handleOpenChange(false)
    if (intent) setPendingIntent({ view, kind: intent })
    setView(view)
  }

  function runRecord(
    view: ViewKey,
    recordId: string,
    payload?: { staffName?: string; month?: number; year?: number }
  ) {
    handleOpenChange(false)
    setPendingIntent({ view, kind: 'record', recordId, payload })
    setView(view)
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={handleOpenChange}
      title="Command palette"
      description="Search modules, records, actions and reports"
      className="sm:max-w-lg"
      commandProps={{ filter: paletteFilter }}
    >
      {/* cmdk: onValueChange on the INPUT fires on search-text change (root fires on selection) */}
      <CommandInput
        placeholder="Search modules, staff, projects, payroll…"
        onValueChange={setQuery}
      />
      <CommandList className="nice-scrollbar max-h-[420px]">
        <CommandEmpty>No results found.</CommandEmpty>

        {/* Live record search (staff + projects) */}
        {showRecords ? (
          <CommandGroup
            heading={
              <span className="flex items-center gap-1.5">
                Records
                {searching ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              </span>
            }
          >
            {shown.staff.map((s) => (
              <CommandItem
                key={s.id}
                value={`staff ${s.fullName} ${s.iqamaId} ${s.position ?? ''}`}
                onSelect={() => runRecord('staff-list', s.id)}
              >
                <HardHat />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{s.fullName}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    IQAMA {s.iqamaId}
                    {s.position ? ` · ${s.position}` : ''}
                  </span>
                </span>
                <CommandShortcut className="text-xs">opens profile</CommandShortcut>
              </CommandItem>
            ))}
            {shown.projects.map((p) => (
              <CommandItem
                key={p.id}
                value={`project ${p.name} ${p.managerName ?? ''} ${p.location ?? ''}`}
                onSelect={() => runRecord('projects', p.id)}
              >
                <FolderKanban />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{p.name}</span>
                  <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                    {p.location ? (
                      <>
                        <MapPin className="h-3 w-3 shrink-0" />
                        {p.location}
                      </>
                    ) : (
                      (p.managerName ?? 'Project')
                    )}
                  </span>
                </span>
                <CommandShortcut className="text-xs">opens overview</CommandShortcut>
              </CommandItem>
            ))}
            {shown.clients.map((c) => (
              <CommandItem
                key={c.id}
                value={`client ${c.name} ${c.contactPerson ?? ''} ${c.city ?? ''}`}
                onSelect={() => runRecord('clients', c.id)}
              >
                <Building2 />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{c.name}</span>
                  <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                    {c.city ? (
                      <>
                        <MapPin className="h-3 w-3 shrink-0" />
                        {c.city}
                      </>
                    ) : (
                      (c.contactPerson ?? 'Client company')
                    )}
                  </span>
                </span>
                <CommandShortcut className="text-xs">opens client</CommandShortcut>
              </CommandItem>
            ))}
            {shown.transactions.map((t) => (
              <CommandItem
                key={t.id}
                value={`transaction ${t.type} ${t.title} ${t.categoryName}`}
                onSelect={() => runRecord(t.type === 'income' ? 'income-list' : 'expense-list', t.id)}
              >
                {t.type === 'income' ? <TrendingUp /> : <TrendingDown />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{t.title}</span>
                  <span className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                    <span
                      className={
                        t.type === 'income'
                          ? 'font-semibold text-emerald-700 tabular-nums dark:text-emerald-400'
                          : 'font-semibold text-rose-700 tabular-nums dark:text-rose-400'
                      }
                    >
                      {t.type === 'income' ? '+' : '−'}
                      {formatMoney(t.amount, currency)}
                    </span>
                    <span className="truncate">{t.categoryName}</span>
                  </span>
                </span>
                <CommandShortcut className="text-xs">opens in list</CommandShortcut>
              </CommandItem>
            ))}
            {shown.payrolls.map((p) => (
              <CommandItem
                key={p.id}
                value={`payroll salary ${p.staffName} ${monthName(p.month)} ${p.year} ${p.status}`}
                onSelect={() =>
                  runRecord('payroll', p.id, {
                    staffName: p.staffName,
                    month: p.month,
                    year: p.year,
                  })
                }
              >
                <Wallet />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{p.staffName}</span>
                  <span className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                    <span className="font-semibold tabular-nums">
                      {formatMoney(p.netPay, currency)}
                    </span>
                    <span className="truncate">
                      {monthName(p.month)} {p.year} · {p.status}
                    </span>
                  </span>
                </span>
                <CommandShortcut className="text-xs">opens in payroll</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {showRecords ? <CommandSeparator /> : null}

        <CommandGroup heading="Quick Actions">
          {visibleActions.map((a) => (
            <CommandItem key={a.label} value={`${a.label} ${a.keywords}`} onSelect={() => run(a.view, a.intent)}>
              <a.icon />
              <span className="font-medium">{a.label}</span>
              {a.intent ? (
                <CommandShortcut className="text-xs">
                  {a.intent === 'print' ? 'opens print preview' : 'opens form'}
                </CommandShortcut>
              ) : null}
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Navigation">
          {visibleNav.map((n) => (
            <CommandItem key={n.view} value={`${n.label} ${n.keywords}`} onSelect={() => run(n.view)}>
              <n.icon />
              <span>{n.label}</span>
            </CommandItem>
          ))}
        </CommandGroup>

        {visibleReports.length > 0 ? (
          <>
            <CommandSeparator />
            <CommandGroup heading="Reports">
              {visibleReports.map((r) => (
                <CommandItem key={r.label} value={`${r.label} ${r.keywords}`} onSelect={() => run(r.view)}>
                  <r.icon />
                  <span>{r.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        ) : null}

        <CommandSeparator />
        <CommandGroup heading="Help">
          <CommandItem
            value="keyboard shortcut palette search records staff projects transactions"
            onSelect={() => handleOpenChange(false)}
            className="text-muted-foreground"
          >
            <span className="text-xs">
              Tip: type a staff, project, payroll or transaction name to open its record ·{' '}
              <CommandShortcut>Ctrl K</CommandShortcut> palette ·{' '}
              <CommandShortcut>?</CommandShortcut> shortcuts
            </span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}

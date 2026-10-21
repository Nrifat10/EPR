'use client'

import { useState } from 'react'
import { useSidebar } from '@/components/ui/sidebar'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Keyboard, Moon, PanelLeft, Search, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useAppStore } from '@/lib/store'
import { useSyncExternalStore } from 'react'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { ShortcutsDialog } from '@/components/app/shortcuts-dialog'

const emptySubscribe = () => () => {}
/** true after hydration (avoids SSR/client theme mismatch) */
function useHydrated(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  )
}

const VIEW_TITLES: Record<string, { title: string; subtitle: string }> = {
  dashboard: { title: 'Dashboard', subtitle: 'Company overview & financial performance' },
  projects: { title: 'Project Management', subtitle: 'Construction project directory' },
  'staff-list': { title: 'Staff List', subtitle: 'Workforce directory & profiles' },
  'staff-categories': { title: 'Staff Categories', subtitle: 'Job categories & classifications' },
  attendance: { title: 'Staff Attendance', subtitle: 'Check-in / check-out records' },
  payroll: { title: 'Payroll', subtitle: 'Monthly payroll processing' },
  advances: { title: 'Worker Advances', subtitle: 'Salary advances & payroll recovery' },
  'salary-sheet': { title: 'Salary Sheet', subtitle: 'Monthly payroll sheet & printing' },
  'salary-summary': { title: 'Staff Salary Summary', subtitle: 'Category-wise salary breakdown' },
  'client-salary-summary': { title: 'Client Salary Summary', subtitle: 'Client billing — payroll hours × client rate + VAT' },
  'income-list': { title: 'Income List', subtitle: 'Company income transactions' },
  'expense-list': { title: 'Expense List', subtitle: 'Company expense transactions' },
  'accounts-summary': { title: 'Accounts Summary', subtitle: 'Income vs expense analysis' },
  'transaction-categories': { title: 'Transaction Categories', subtitle: 'Income & expense categories' },
  roles: { title: 'Roles & Permissions', subtitle: 'Role-based access control' },
  users: { title: 'Users', subtitle: 'System user accounts' },
  settings: { title: 'Settings', subtitle: 'Company profile & preferences' },
}

export function Topbar({ onOpenPalette }: { onOpenPalette: () => void }) {
  const { view } = useAppStore()
  const { toggleSidebar } = useSidebar()
  const { resolvedTheme, setTheme } = useTheme()
  const mounted = useHydrated()
  const [shortcutsOpen, setShortcutsOpen] = useState(false)

  const meta = VIEW_TITLES[view] ?? { title: 'Dashboard', subtitle: '' }

  return (
    <>
      <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <Button
        variant="ghost"
        size="icon"
        className="h-9 w-9"
        onClick={toggleSidebar}
        aria-label="Toggle sidebar"
      >
        <PanelLeft className="h-4 w-4" />
      </Button>
      <div className="min-w-0">
        <h2 className="truncate text-sm font-semibold leading-tight sm:text-base">{meta.title}</h2>
        <p className="hidden truncate text-xs text-muted-foreground sm:block">{meta.subtitle}</p>
      </div>
      <div className="ml-auto flex items-center gap-1.5">
        {/* Global search / command palette trigger */}
        <button
          type="button"
          onClick={onOpenPalette}
          className="hidden h-9 items-center gap-2 rounded-lg border bg-muted/40 px-3 text-sm text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground md:flex"
          aria-label="Open command palette (Ctrl+K)"
        >
          <Search className="h-4 w-4" />
          <span className="leading-none">Search…</span>
          <kbd className="pointer-events-none ml-1 select-none rounded border bg-background px-1.5 py-0.5 font-mono text-[10px] font-semibold text-muted-foreground">
            Ctrl K
          </kbd>
        </button>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 md:hidden"
          onClick={onOpenPalette}
          aria-label="Open command palette"
        >
          <Search className="h-4 w-4" />
        </Button>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="hidden h-9 w-9 sm:inline-flex"
              onClick={() => setShortcutsOpen(true)}
              aria-label="Keyboard shortcuts"
            >
              <Keyboard className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Keyboard shortcuts (?)</TooltipContent>
        </Tooltip>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9"
          onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
          aria-label="Toggle dark mode"
        >
          {mounted && resolvedTheme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
        <Separator orientation="vertical" className="!h-5" />
        <TopbarActions />
      </div>
      </header>
      {/* thin gold brand hairline under the header */}
      <div className="gold-rule pointer-events-none sticky top-14 z-20 opacity-70" aria-hidden />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </>
  )
}

function TopbarActions() {
  const { view } = useAppStore()
  const { setView } = useAppStore()
  if (view !== 'dashboard') return null
  return (
    <div className="hidden items-center gap-2 lg:flex">
      <Button size="sm" variant="outline" onClick={() => setView('income-list')} className="h-8">
        Add Income
      </Button>
      <Button size="sm" onClick={() => setView('expense-list')} className="h-8">
        Add Expense
      </Button>
    </div>
  )
}

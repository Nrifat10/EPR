'use client'

import { useCallback, useState } from 'react'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import {
  ChevronsUpDown,
  HandCoins,
  KeyRound,
  LogOut,
  Users,
  HardHat,
  LayoutDashboard,
  Landmark,
  ScrollText,
  Sparkles,
  CalendarClock,
  Wallet,
  FileSpreadsheet,
  FileOutput,
  BarChart3,
  TrendingUp,
  TrendingDown,
  PieChart,
  Tags,
  ShieldCheck,
  Settings as SettingsIcon,
  FolderKanban,
  UserCog,
  Building2,
  Network,
  ReceiptText,
  FileText,
  Package,
  FileSignature,
  BookUser,
  BadgePercent,
} from 'lucide-react'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from '@/components/ui/sidebar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { AvatarInitials } from '@/components/app/shared/avatar-initials'
import { ChangePasswordDialog } from '@/components/app/change-password-dialog'
import { useAppStore, can } from '@/lib/store'
import type { ViewKey } from '@/lib/types'
import { cn } from '@/lib/utils'

type MenuItem = {
  view: ViewKey
  label: string
  icon: React.ComponentType<{ className?: string }>
  perm?: string
}

type MenuGroup = {
  label?: string
  items: (MenuItem | { submenu: true; label: string; icon: React.ComponentType<{ className?: string }>; perm?: string; children: MenuItem[] })[]
}

const MENU: MenuGroup[] = [
  {
    items: [
      { view: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, perm: 'dashboard.view' },
      { view: 'ai-assistant', label: 'AI Assistant', icon: Sparkles, perm: 'ai.use' },
      { view: 'projects', label: 'Project Management', icon: FolderKanban, perm: 'projects.view' },
      { view: 'clients', label: 'Clients', icon: Building2, perm: 'clients.view' },
      { view: 'deployments', label: 'Worker Deployment', icon: Network, perm: 'clients.view' },
    ],
  },
  {
    label: 'Staff Management',
    items: [
      {
        submenu: true,
        label: 'Staff & Workforce',
        icon: HardHat,
        perm: 'staff.view',
        children: [
          { view: 'staff-list', label: 'Staff List', icon: Users, perm: 'staff.view' },
          { view: 'staff-categories', label: 'Staff Categories', icon: Tags, perm: 'staff.view' },
          { view: 'attendance', label: 'Staff Attendance', icon: CalendarClock, perm: 'attendance.view' },
          { view: 'payroll', label: 'Payroll', icon: Wallet, perm: 'payroll.view' },
          { view: 'advances', label: 'Worker Advances', icon: HandCoins, perm: 'advances.view' },
          { view: 'salary-sheet', label: 'Salary Sheet', icon: FileSpreadsheet, perm: 'payroll.view' },
          { view: 'salary-summary', label: 'Staff Salary Summary', icon: ScrollText, perm: 'payroll.view' },
          { view: 'client-salary-summary', label: 'Client Salary Summary', icon: ReceiptText, perm: 'payroll.view' },
        ],
      },
    ],
  },
  {
    label: 'Account Research',
    items: [
      {
        submenu: true,
        label: 'Accounts',
        icon: Landmark,
        perm: 'accounts.view',
        children: [
          { view: 'income-list', label: 'Income List', icon: TrendingUp, perm: 'accounts.view' },
          { view: 'expense-list', label: 'Expense List', icon: TrendingDown, perm: 'accounts.view' },
          { view: 'accounts-summary', label: 'Summary', icon: PieChart, perm: 'accounts.view' },
          { view: 'transaction-categories', label: 'Categories', icon: Tags, perm: 'accounts.view' },
        ],
      },
      { view: 'vat-return-expense', label: 'VAT Return Expense', icon: BadgePercent, perm: 'vat.view' },
    ],
  },
  {
    label: 'Business Documents',
    items: [
      { view: 'quotations', label: 'Quotations', icon: FileText, perm: 'quotations.view' },
      { view: 'e-invoices', label: 'E-Invoice', icon: FileOutput, perm: 'einvoices.view' },
      { view: 'supplier-pos', label: 'Supplier P.O.', icon: Package, perm: 'supplierpo.view' },
      { view: 'agreements', label: 'Agreements', icon: FileSignature, perm: 'agreements.view' },
      { view: 'name-list', label: 'Name List', icon: BookUser, perm: 'namelist.view' },
    ],
  },
  {
    label: 'Administration',
    items: [
      { view: 'roles', label: 'Roles', icon: ShieldCheck, perm: 'roles.view' },
      { view: 'users', label: 'Users', icon: UserCog, perm: 'users.view' },
      { view: 'settings', label: 'Settings', icon: SettingsIcon, perm: 'settings.view' },
      { view: 'activity-log', label: 'Activity Log', icon: ScrollText, perm: 'activity.view' },
    ],
  },
]

export function AppSidebar({ onLogout }: { onLogout: () => void }) {
  const { view, setView, user, settings } = useAppStore()
  const { setOpenMobile } = useSidebar()
  const pathname = usePathname()
  void pathname
  const [changePwOpen, setChangePwOpen] = useState(false)

  // Navigate and close the mobile off-canvas sheet (no-op on desktop)
  const navigate = useCallback(
    (v: ViewKey) => {
      setView(v)
      setOpenMobile(false)
    },
    [setView, setOpenMobile]
  )

  return (
    <Sidebar side="left" variant="sidebar" collapsible="icon" className="border-r-0">
      {/* Brand — Landmark Inter Gulf (logo white badge + gold wordmark) */}
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <div className="flex items-center gap-2.5 px-1.5 py-2 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white shadow-md ring-1 ring-black/10 transition-all duration-200 group-data-[collapsible=icon]:h-8 group-data-[collapsible=icon]:w-8 group-data-[collapsible=icon]:rounded-lg">
                <Image
                  src={settings.logo ?? '/logo-mark.png'}
                  alt={settings.companyName}
                  width={40}
                  height={40}
                  className="h-full w-full object-contain p-[3px]"
                  unoptimized
                />
              </div>
              <div className="min-w-0 group-data-[collapsible=icon]:hidden">
                <p className="truncate text-sm font-bold leading-tight text-white">
                  {settings.companyName}
                </p>
                <p className="truncate text-[10px] font-semibold uppercase tracking-[0.16em] text-gold">
                  Workforce &amp; Payroll
                </p>
              </div>
            </div>
            {/* gold hairline separator under the brand */}
            <div className="gold-rule mx-2 mt-1 opacity-80 group-data-[collapsible=icon]:hidden" aria-hidden />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent className="nice-scrollbar">
        {MENU.map((group, gi) => {
          const visibleItems = group.items.filter(
            (item) => !('perm' in item) || !item.perm || can(user, item.perm)
          )
          if (visibleItems.length === 0) return null
          return (
            <SidebarGroup key={gi}>
              {group.label ? <SidebarGroupLabel className="mt-1.5">{group.label}</SidebarGroupLabel> : null}
              <SidebarGroupContent>
                <SidebarMenu>
                  {visibleItems.map((item, ii) => {
                    if ('submenu' in item) {
                      const visibleChildren = item.children.filter(
                        (c) => !c.perm || can(user, c.perm)
                      )
                      if (visibleChildren.length === 0) return null
                      return (
                        <Collapsible
                          key={ii}
                          defaultOpen={visibleChildren.some((c) => c.view === view)}
                          className="group/collapsible"
                        >
                          <SidebarMenu>
                            <SidebarMenuItem>
                              <CollapsibleTrigger asChild>
                                <SidebarMenuButton tooltip={item.label}>
                                  <item.icon />
                                  <span>{item.label}</span>
                                  <ChevronsUpDown className="ml-auto h-4 w-4 transition-transform group-hover/collapsible:state-open:rotate-180" />
                                </SidebarMenuButton>
                              </CollapsibleTrigger>
                              <CollapsibleContent>
                                <SidebarMenuSub>
                                  {visibleChildren.map((c) => (
                                    <SidebarMenuSubItem key={c.view}>
                                      {/* Real <button> (not a span) so sub-nav is keyboard focusable */}
                                      <SidebarMenuSubButton
                                        asChild
                                        isActive={view === c.view}
                                        onClick={() => navigate(c.view)}
                                        className={cn(
                                          'cursor-pointer',
                                          view === c.view &&
                                            'data-[active=true]:bg-sidebar-primary data-[active=true]:font-semibold data-[active=true]:text-sidebar-primary-foreground data-[active=true]:shadow-sm hover:bg-sidebar-primary/90'
                                        )}
                                      >
                                        <button type="button" className="w-full text-left">
                                          <c.icon className="h-4 w-4" />
                                          <span>{c.label}</span>
                                        </button>
                                      </SidebarMenuSubButton>
                                    </SidebarMenuSubItem>
                                  ))}
                                </SidebarMenuSub>
                              </CollapsibleContent>
                            </SidebarMenuItem>
                          </SidebarMenu>
                        </Collapsible>
                      )
                    }
                    const active = view === item.view
                    return (
                      <SidebarMenuItem key={item.view}>
                        <SidebarMenuButton
                          isActive={active}
                          tooltip={item.label}
                          onClick={() => navigate(item.view)}
                          className={cn(
                            'cursor-pointer',
                            active &&
                              'data-[active=true]:bg-sidebar-primary data-[active=true]:font-semibold data-[active=true]:text-sidebar-primary-foreground data-[active=true]:shadow-sm hover:bg-sidebar-primary/90'
                          )}
                        >
                          <item.icon />
                          <span>{item.label}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    )
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          )
        })}
      </SidebarContent>

      {/* User chip at bottom */}
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  className="data-[state=open]:bg-sidebar-accent"
                >
                  <AvatarInitials name={user?.name} src={user?.avatar} />
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-semibold">{user?.name}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {user?.role?.name ?? 'No role'}
                    </span>
                  </div>
                  <ChevronsUpDown className="ml-auto size-4 text-muted-foreground" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
                side="top"
                align="start"
                sideOffset={4}
              >
                <DropdownMenuLabel className="p-0 font-normal">
                  <div className="flex items-center gap-2 px-2 py-1.5 text-left text-sm">
                    <AvatarInitials name={user?.name} src={user?.avatar} />
                    <div className="grid flex-1 text-left text-sm leading-tight">
                      <span className="truncate font-semibold">{user?.name}</span>
                      <span className="truncate text-xs text-muted-foreground">{user?.email}</span>
                    </div>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setChangePwOpen(true)}>
                  <KeyRound className="mr-2 h-4 w-4" />
                  Change password
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onLogout} className="text-destructive focus:text-destructive">
                  <LogOut className="mr-2 h-4 w-4" />
                  Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <ChangePasswordDialog open={changePwOpen} onOpenChange={setChangePwOpen} />
    </Sidebar>
  )
}

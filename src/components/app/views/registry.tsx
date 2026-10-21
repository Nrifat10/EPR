'use client'

import { useAppStore } from '@/lib/store'
import { DashboardView } from './dashboard'
import { ProjectsView } from './projects'
import { ClientsView } from './clients'
import { WorkerDeploymentView } from './deployments'
import { StaffListView } from './staff-list'
import { StaffCategoriesView } from './staff-categories'
import { AttendanceView } from './attendance'
import { PayrollView } from './payroll'
import { AdvancesView } from './advances'
import { SalarySheetView } from './salary-sheet'
import { SalarySummaryView } from './salary-summary'
import { ClientSalarySummaryView } from './client-salary-summary'
import { IncomeListView } from './income-list'
import { ExpenseListView } from './expense-list'
import { AccountsSummaryView } from './accounts-summary'
import { TransactionCategoriesView } from './transaction-categories'
import { VatReturnExpenseView } from './vat-return-expense'
import { QuotationsView } from './quotations'
import { EInvoicesView } from './e-invoices'
import { NameListView } from './name-list'
import { SupplierPosView } from './supplier-pos'
import { AgreementsView } from './agreements'
import { RolesView } from './roles'
import { UsersView } from './users'
import { SettingsView } from './settings'
import { ActivityLogView } from './activity-log'
import { AiAssistantView } from './ai-assistant'

export function ViewRouter() {
  const { view } = useAppStore()
  switch (view) {
    case 'dashboard':
      return <DashboardView />
    case 'projects':
      return <ProjectsView />
    case 'clients':
      return <ClientsView />
    case 'deployments':
      return <WorkerDeploymentView />
    case 'staff-list':
      return <StaffListView />
    case 'staff-categories':
      return <StaffCategoriesView />
    case 'attendance':
      return <AttendanceView />
    case 'payroll':
      return <PayrollView />
    case 'advances':
      return <AdvancesView />
    case 'salary-sheet':
      return <SalarySheetView />
    case 'salary-summary':
      return <SalarySummaryView />
    case 'client-salary-summary':
      return <ClientSalarySummaryView />
    case 'income-list':
      return <IncomeListView />
    case 'expense-list':
      return <ExpenseListView />
    case 'accounts-summary':
      return <AccountsSummaryView />
    case 'transaction-categories':
      return <TransactionCategoriesView />
    case 'vat-return-expense':
      return <VatReturnExpenseView />
    case 'quotations':
      return <QuotationsView />
    case 'e-invoices':
      return <EInvoicesView />
    case 'name-list':
      return <NameListView />
    case 'supplier-pos':
      return <SupplierPosView />
    case 'agreements':
      return <AgreementsView />
    case 'roles':
      return <RolesView />
    case 'users':
      return <UsersView />
    case 'settings':
      return <SettingsView />
    case 'activity-log':
      return <ActivityLogView />
    case 'ai-assistant':
      return <AiAssistantView />
    default:
      return <DashboardView />
  }
}

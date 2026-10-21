// Shared TypeScript types for Landmark Inter Gulf system
// Used by both API routes and frontend components

export type Role = {
  id: string
  name: string
  description: string | null
  permissions: string[]
  userCount?: number
  createdAt?: string
}

export type SessionUser = {
  id: string
  name: string
  email: string
  avatar: string | null
  role: { id: string; name: string; permissions: string[] } | null
}

export type ProjectStatus = 'active' | 'inactive' | 'completed'

export type ProjectRow = {
  id: string
  name: string
  managerName: string
  location: string | null
  status: ProjectStatus
  clientId: string | null
  clientName: string | null
  /** Rate billed to the client company per worker-hour (0 = not set; billing falls back to the worker rate) */
  clientRatePerHour: number
  createdAt: string
  staffCount: number
  /** Total linked income transactions (0 when none) */
  income: number
  /** Total linked expense transactions (0 when none) */
  expense: number
  /** income - expense */
  netProfit: number
}

export type Project = ProjectRow & {
  staff?: StaffRow[]
}

/** GET /api/projects/[id]/financials — profitability breakdown */
export type ProjectFinancials = {
  projectId: string
  income: number
  expense: number
  netProfit: number
  /** netProfit / income * 100, null when income is 0 */
  margin: number | null
  transactionCount: number
  /** Sum of expenses linked to payroll payouts (salary disbursements) */
  payrollExpense: number
  /** Last 6 months with any transaction (label e.g. "Apr '26") */
  monthly: { month: string; income: number; expense: number }[]
  /** Top expense categories by amount (max 5) */
  topExpenseCategories: { name: string; amount: number }[]
  /** Most recent transactions (max 8) */
  recentTransactions: {
    id: string
    title: string
    type: TransactionType
    amount: number
    date: string
    category: string | null
    linkedPayroll: boolean
  }[]
}

export type ClientStatus = 'active' | 'inactive'

/** Client company row (GET /api/projects uses the same shape for embedded client info) */
export type ClientRow = {
  id: string
  name: string
  /** Arabic company name — printed bilingually on ZATCA-style invoices */
  nameAr: string | null
  contactPerson: string | null
  phone: string | null
  email: string | null
  address: string | null
  /** Arabic address */
  addressAr: string | null
  city: string | null
  crNumber: string | null
  /** Saudi VAT registration number (15 digits) — required on B2B tax invoices */
  vatNumber: string | null
  bankName: string | null
  iban: string | null
  accountNumber: string | null
  swiftCode: string | null
  status: ClientStatus
  notes: string | null
  createdAt: string
  projectCount: number
  /** Distinct staff deployed across all of this client's projects */
  deployedWorkers: number
}

/** GET /api/clients/[id] — full client detail with per-project staff */
export type Client = ClientRow & {
  projects: {
    id: string
    name: string
    status: ProjectStatus
    location: string | null
    managerName: string
    staffCount: number
    income: number
    expense: number
  }[]
  /** Distinct workers deployed across all projects (same list, flat) */
  workers: DeployedWorker[]
}

/** A worker entry inside a deployment listing */
export type DeployedWorker = {
  id: string
  fullName: string
  position: string | null
  iqamaId: string
  status: StaffStatus
  profilePhoto: string | null
  ratePerHour: number
  monthlySalary: number
  categoryName: string | null
  projectId: string | null
  projectName: string | null
  clientId: string | null
  clientName: string | null
}

/** Deployment KPI totals returned by /api/deployments (flat mode) */
export type DeploymentTotals = {
  assignments: number
  distinctWorkers: number
  unassignedActive: number
  clientCount: number
}

/** GET /api/deployments?mode=grouped — per-client grouping with workers */
export type ClientDeploymentGroup = {
  client: {
    id: string
    name: string
    city: string | null
    status: ClientStatus
    contactPerson: string | null
    phone: string | null
  }
  totalWorkers: number
  activeProjects: number
  projects: {
    id: string
    name: string
    status: ProjectStatus
    location: string | null
    workers: DeployedWorker[]
  }[]
}

export type StaffCategory = {
  id: string
  name: string
  description: string | null
  staffCount?: number
}

/** One worker × project billing line inside a client group (month-scoped) */
export type ClientBillingLine = {
  /** Payroll record this line mirrors (hours + manual client rates live there) */
  payrollId: string
  projectId: string
  projectName: string
  staffId: string
  fullName: string
  iqamaId: string
  position: string | null
  categoryName: string | null
  /** Regular hours — EXACTLY Payroll.totalHours for the same month */
  hours: number
  /** Overtime hours — EXACTLY Payroll.overtimeHours for the same month */
  otHours: number
  /** Effective rate billed to the client for regular hours */
  clientRate: number
  /** Effective rate billed to the client for OT hours (defaults to clientRate) */
  clientOtRate: number
  /** Raw manually-entered rate on the payroll row (0 = inherited from project/worker) */
  manualRate: number
  /** Raw manually-entered OT rate on the payroll row (0 = same as regular rate) */
  manualOtRate: number
  /** Project's negotiated default client rate (fallback when manual = 0) */
  projectRate: number
  /** 'manual' = typed in this summary · 'project' = project default · 'worker' = worker pay-rate fallback */
  rateSource: 'manual' | 'project' | 'worker'
  /** (hours × clientRate) + (otHours × clientOtRate) — excl VAT */
  amount: number
  /** Worker's own hourly rate — the payroll salary rate (hourlyRateSnapshot) */
  workerRate: number
  /** hours × workerRate + otHours × worker OT rate — payroll cost of the same hours */
  workerCost: number
  monthlySalary: number
  status: StaffStatus
}

/** One client company's billing roll-up (GET /api/clients/salary-summary?month&year) */
export type ClientSalaryGroup = {
  clientId: string | null
  clientName: string
  city: string | null
  contactPerson: string | null
  phone: string | null
  email: string | null
  crNumber: string | null
  address: string | null
  clientStatus: ClientStatus
  projectCount: number
  /** Distinct workers billed at this client this month (payroll rows) */
  workerCount: number
  /** Workers with regular or OT hours in the selected month */
  workersWithHours: number
  /** Billing lines (worker × project) for the selected month — mirror Payroll rows */
  rows: ClientBillingLine[]
  /** Σ regular hours of the group's rows (Payroll.totalHours) */
  hours: number
  /** Σ overtime hours of the group's rows (Payroll.overtimeHours) */
  otHours: number
  /** Σ hours × client rate (excl VAT) */
  billedAmount: number
  /** 15% VAT on billedAmount */
  vatAmount: number
  /** billedAmount + vatAmount */
  grandTotal: number
  /** Σ hours × worker rate — payroll cost of the same hours */
  workerCost: number
  /** billedAmount − workerCost (excl VAT) */
  margin: number
  /** Σ monthlySalary of the group's distinct workers (original salary context) */
  totalMonthlySalary: number
  avgMonthlySalary: number
  /** Share of the sum of all group grand totals */
  share: number
}

export type ClientSalarySummaryData = {
  /** Billing month the numbers were computed for */
  month: number
  year: number
  /** VAT rate applied (0.15 = Saudi standard 15%) */
  vatRate: number
  cards: {
    totalClients: number
    /** Distinct workers with payroll rows this month (a worker on 2 clients counts once) */
    totalWorkers: number
    /** Σ monthlySalary of those distinct workers */
    totalMonthlySalary: number
    avgMonthlySalary: number
    /** Active staff with no project assignment at all (context note) */
    benchWorkers: number
    benchSalary: number
    /** Workers billed under 2+ different clients this month */
    multiClientWorkers: number
    /** Billing month aggregates over all client groups */
    billedHours: number
    billedOtHours: number
    billedAmount: number
    vatAmount: number
    grandTotal: number
    workerCost: number
    margin: number
  }
  groups: ClientSalaryGroup[]
}

export type StaffStatus = 'active' | 'inactive'

/** GET /api/staff/[id]/profile — employment & pay summary for the staff dialog */
export type StaffProfileStats = {
  staffId: string
  /** null when the caller lacks payroll.view */
  payroll: {
    totalNetPaid: number
    pendingCount: number
    totalEntries: number
    /** Newest first, max 6 */
    recent: {
      id: string
      month: number
      year: number
      netPay: number
      status: PayrollStatus
      project: string | null
    }[]
  } | null
  /** null when the caller lacks attendance.view */
  attendance: {
    monthMinutes: number
    totalSessions: number
    avgHoursPerSession: number | null
  } | null
  monthsEmployed: number | null
}

export type StaffRow = {
  id: string
  fullName: string
  phone: string | null
  position: string | null
  iqamaId: string
  iqamaExpiry: string | null
  passportExpiry: string | null
  joiningDate: string | null
  ratePerHour: number
  overtimeRate: number
  monthlySalary: number
  profilePhoto: string | null
  residentialAddress: string | null
  status: StaffStatus
  staffCategory: { id: string; name: string } | null
  projects: { id: string; name: string }[]
  // ---- Name List additions ----
  passportNo: string | null
  nationality: string | null
  bloodGroup: string | null
  experienceYears: number | null
  deploymentStatus: string
}

export type AttendanceRow = {
  id: string
  staff: { id: string; fullName: string; iqamaId: string }
  project: { id: string; name: string } | null
  checkIn: string
  checkOut: string | null
  durationMinutes: number | null
}

export type PayrollStatus = 'pending' | 'paid'
export type PayType = 'bank_transfer' | 'cash' | 'cheque'
export type DeductionType = 'fixed' | 'percent'

export type PayrollRow = {
  id: string
  month: number
  year: number
  totalHours: number
  hourlyRateSnapshot: number
  overtimeHours: number
  overtimeRateSnapshot: number
  otherEarnings: number
  advance: number
  absentPenalty: number
  ptAmount: number
  unionFees: number
  otherDeductionValue: number
  otherDeductionType: DeductionType
  clientRate: number
  clientOtRate: number
  grossPay: number
  totalDeductions: number
  netPay: number
  status: PayrollStatus
  payDate: string | null
  payType: PayType
  taxCode: string | null
  staff: { id: string; fullName: string; iqamaId: string; staffCategory: { id: string; name: string } | null }
  project: { id: string; name: string; clientName: string | null } | null
}

export type PayrollInput = {
  staffId: string
  projectId?: string | null
  month: number
  year: number
  totalHours: number
  hourlyRate: number
  overtimeHours: number
  overtimeRate: number
  otherEarnings: number
  advance: number
  absentPenalty: number
  ptAmount: number
  unionFees: number
  otherDeductionValue: number
  otherDeductionType: DeductionType
  status: PayrollStatus
  payDate?: string | null
  payType: PayType
  taxCode?: string | null
}

export type TransactionType = 'income' | 'expense'

// ---------------------------------------------------------------------------
// Worker advances
// ---------------------------------------------------------------------------

export type AdvanceStatus = 'pending' | 'partially_deducted' | 'deducted'
export type AdvancePaymentMethod = 'cash' | 'bank_transfer'

/** Advance row (GET /api/advances) — remaining is derived client-side. */
export type AdvanceRow = {
  id: string
  amount: number
  givenDate: string
  paymentMethod: AdvancePaymentMethod
  reference: string | null
  deductionMonth: number
  deductionYear: number
  installments: number
  deductedAmount: number
  status: AdvanceStatus
  createdAt: string
  /** true when a finalized (paid) payroll already deducted from it → edit/delete blocked */
  locked?: boolean
  staff: { id: string; fullName: string; iqamaId: string; position?: string | null }
}

export type AdvanceListTotals = {
  count: number
  given: number
  deducted: number
  outstanding: number
}

/** GET /api/advances/summary — header cards + monthly given totals */
export type AdvanceSummaryData = {
  totals: AdvanceListTotals & { workers: number; pendingCount: number }
  monthly: { label: string; month: number; year: number; given: number; count: number }[]
}

/** GET /api/advances/ledger?staffId — per-worker advance ledger */
export type AdvanceLedgerData = {
  staff: {
    id: string
    fullName: string
    iqamaId: string
    position: string | null
    monthlySalary: number
    status: StaffStatus
  }
  advances: AdvanceRow[]
  deductions: {
    id: string
    advanceId: string
    amount: number
    month: number
    year: number
    payrollStatus: PayrollStatus
    recovered: boolean
    createdAt: string
  }[]
  totals: { given: number; deducted: number; outstanding: number }
}

/** GET /api/advances/payroll-preview — what the auto-deduction would apply */
export type AdvancePayrollPreview = {
  items: {
    advanceId: string
    reference: string
    scheduled: number
    remaining: number
    installmentNo: number
    installments: number
  }[]
  total: number
}

/** GET /api/advances/stale-payrolls — payrolls whose advance column is out of date */
export type AdvanceStalePayroll = {
  payrollId: string
  staffName: string
  month: number
  year: number
  stored: number
  expected: number
}

export type TransactionCategoryRow = {
  id: string
  name: string
  type: TransactionType
  transactionCount?: number
}

export type TransactionRow = {
  id: string
  type: TransactionType
  title: string
  amount: number
  transactionDate: string
  description: string | null
  category: { id: string; name: string; type: TransactionType }
  project: { id: string; name: string } | null
  operator: { id: string; name: string } | null
  payrollId: string | null
  /** WHO made the expense (worker) — name + IQAMA come from the staff record */
  spender: { id: string; fullName: string; iqamaId: string } | null
  /** Month (1-12) / year the expense belongs to (mirrors transactionDate by default) */
  expenseMonth: number | null
  expenseYear: number | null
  /** Attached bill receipt (served from /api/transactions/[id]/receipt) */
  receiptName: string | null
  receiptExt: string | null
  receiptSize: number | null
}

export type UserRow = {
  id: string
  name: string
  email: string
  avatar: string | null
  isActive: boolean
  createdAt: string
  role: { id: string; name: string } | null
}

/** One month's aggregate for a spender in the worker expense statement */
export type ExpenseStatementMonth = {
  month: number
  count: number
  total: number
  receipts: number
}

/** Per-spender block of the yearly worker expense statement */
export type ExpenseStatementSpender = {
  spender: { id: string; fullName: string; iqamaId: string; position: string | null }
  months: ExpenseStatementMonth[]
  totalCount: number
  total: number
  receipts: number
}

/** GET /api/transactions/expense-statement?year — who spent how much each month */
export type ExpenseStatement = {
  year: number
  grandTotal: number
  spenders: ExpenseStatementSpender[]
  unassigned: {
    months: ExpenseStatementMonth[]
    totalCount: number
    total: number
  }
}

export type AppSettings = {
  companyName: string
  /** Arabic company name — printed bilingually on ZATCA-style invoices */
  companyNameAr: string
  address: string
  addressAr: string
  phone: string
  email: string
  logo: string | null
  currency: string
  defaultPayType: PayType
  authorizedSignatory: string
  signatoryTitle: string
  /** Seller VAT registration number — QR tag 2 / UBL PartyTaxScheme CompanyID */
  vatNumber: string
  /** Seller commercial registration (CR) number — UBL PartyIdentification */
  crNumber: string
  /** Company bank details printed as payment instructions on invoices */
  bankName: string
  bankIban: string
  bankAccountNumber: string
  /** Account holder name shown on payment instructions */
  bankAccountName: string
  /** SWIFT/BIC code for international transfers */
  bankSwiftCode: string
  /** Bank branch address */
  bankAddress: string
  /** VAT rate in PERCENT for the VAT Return Expense module (15 = 15% Saudi standard) */
  vatRate: number
}

export type ActivityRow = {
  id: string
  userName: string | null
  action: string
  module: string
  description: string
  amount: number | null
  createdAt: string
}

export type DashboardData = {
  stats: {
    totalStaff: number
    totalUsers: number
    totalIncome: number
    totalExpense: number
    netBalance: number
    salaryPaid: number
    /** Outstanding worker-advance balance (null without advances.view) */
    advanceOutstanding: number | null
  }
  payrollStatus: {
    month: string
    pendingCount: number
    paidCount: number
    pendingAmount: number
    paidAmount: number
    pending: { id: string; staffId: string; staffName: string; netPay: number }[]
  } | null
  chart: { month: string; income: number; expense: number }[]
  recentActivity: ActivityRow[]
  /** IQAMA document compliance alerts (null when the caller lacks staff.view) */
  documentAlerts: {
    expired: DocumentAlert[]
    expiring: DocumentAlert[]
  } | null
  /** Client deployment overview (null when the caller lacks clients.view) */
  clientDeployment: {
    clientCount: number
    activeClients: number
    deployedWorkers: number
    topClients: { id: string; name: string; city: string | null; workers: number }[]
  } | null
}

export type DocumentAlert = {
  staffId: string
  fullName: string
  iqamaId: string
  iqamaExpiry: string
  /** whole days from today (negative = already expired) */
  daysLeft: number
}

export type SheetTotals = {
  count: number
  gross: number
  deductions: number
  net: number
}

export type SheetRow = PayrollRow & {
  basicPay: number
  otPay: number
  penaltyPt: number
  unionOther: number
}

export type CategoryBreakdown = {
  categoryId: string | null
  name: string
  manpower: number
  totalHours: number
  grossPay: number
  deductions: number
  totalAmount: number
}

// ---------------------------------------------------------------------------
// VAT Return Expense
// ---------------------------------------------------------------------------

/** One supplier bill carrying VAT (GET/POST /api/vat-bills) */
export type VatBillRow = {
  id: string
  billDate: string
  billNumber: string
  supplierName: string | null
  supplierVatNumber: string | null
  description: string | null
  amountWithVat: number
  amountWithoutVat: number
  vatAmount: number
  /** Rate fraction applied when the row was saved (0.15 = 15%) */
  vatRateSnapshot: number
  createdBy: { id: string; name: string } | null
  createdAt: string
}

/** Totals block returned with the bills list */
export type VatBillTotals = {
  count: number
  withVat: number
  withoutVat: number
  vat: number
}

/** One month line of the month-by-month / quarter tables */
export type VatMonthLine = {
  month: number // 1-12
  count: number
  withVat: number
  withoutVat: number
  vat: number
}

/** One quarter (Q1 Jan–Mar … Q4 Oct–Dec) with its 3 month lines + grand total */
export type VatQuarterLine = {
  quarter: number // 1-4
  months: VatMonthLine[]
  count: number
  withVat: number
  withoutVat: number
  vat: number
}

/** GET /api/vat-bills/summary — everything the monthly + quarterly cards need */
export type VatSummaryData = {
  year: number
  /** Selected month (1-12) the header cards are computed for */
  month: number
  /** VAT rate FRACTION in effect (0.15) */
  vatRate: number
  /** Distinct years that have bills (for the dropdowns, current year always present) */
  years: number[]
  /** Selected month totals (zeroed when no bills) */
  monthTotals: VatBillTotals
  /** 12 month lines for the selected year (all months present, zeroed when empty) */
  monthly: VatMonthLine[]
  /** Selected year grand totals */
  yearTotals: VatBillTotals
  /** All four quarters of the selected year */
  quarters: VatQuarterLine[]
  /** Which quarter is currently in progress (1-4, server "today") */
  currentQuarter: number
  currentYear: number
  /** Last day of the current quarter (ISO) — null outside the current year */
  quarterEndDate: string | null
  /** ZATCA-style filing deadline: last day of the month FOLLOWING quarter end (ISO) */
  filingDeadline: string | null
}

export type Paginated<T> = {
  data: T[]
  page: number
  pageSize: number
  total: number
  totalPages: number
  totals?: Record<string, number>
}

/** Global record search results (command palette) */
export type PaletteSearchResults = {
  staff: {
    id: string
    fullName: string
    iqamaId: string
    position: string | null
    status: string
  }[]
  projects: {
    id: string
    name: string
    managerName: string | null
    location: string | null
    status: string
  }[]
  transactions: {
    id: string
    type: 'income' | 'expense'
    title: string
    amount: number
    transactionDate: string
    categoryName: string
  }[]
  payrolls: {
    id: string
    staffId: string
    staffName: string
    month: number
    year: number
    netPay: number
    status: 'pending' | 'paid'
  }[]
  clients: {
    id: string
    name: string
    city: string | null
    contactPerson: string | null
    status: string
  }[]
}

/** Monthly attendance KPIs (attendance view header) */
export type AttendanceStats = {
  month: number
  year: number
  label: string
  totalSessions: number
  openSessions: number
  totalMinutes: number
  totalHours: number
  distinctStaff: number
  avgSessionMinutes: number
}

export type ViewKey =
  | 'dashboard'
  | 'projects'
  | 'clients'
  | 'deployments'
  | 'staff-list'
  | 'staff-categories'
  | 'attendance'
  | 'payroll'
  | 'advances'
  | 'salary-sheet'
  | 'salary-summary'
  | 'client-salary-summary'
  | 'income-list'
  | 'expense-list'
  | 'accounts-summary'
  | 'transaction-categories'
  | 'vat-return-expense'
  | 'quotations'
  | 'e-invoices'
  | 'name-list'
  | 'supplier-pos'
  | 'agreements'
  | 'roles'
  | 'users'
  | 'settings'
  | 'activity-log'
  | 'ai-assistant'

// ── AI Assistant ──

export type AiChatSummary = {
  id: string
  title: string
  lastPreview: string
  createdAt: string
  updatedAt: string
}

export type AiToolEvent = {
  name: string
  args: Record<string, unknown>
  ok: boolean
  ms?: number
  rows?: number
  summary?: string
  error?: string
}

export type AiAttachmentMeta = {
  name: string
  type: string
  size: number
  extractedChars?: number
}

export type AiDraft = {
  type: 'quotation' | 'invoice' | 'po' | 'email' | 'letter'
  title: string
  data: Record<string, unknown>
}

export type AiMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  toolEvents: AiToolEvent[]
  attachments: AiAttachmentMeta[]
  drafts: AiDraft[]
  promptTokens: number
  completionTokens: number
  isError: boolean
  createdAt: string
  /** client-only streaming state */
  streaming?: boolean
}

export type AiSettingsView = {
  provider: 'builtin' | 'zhipu' | 'anthropic' | 'openai'
  model: string
  apiKeyHint: string | null
  hasKey: boolean
  baseUrl: string
  maxTokens: number
  monthlyLimitSar: number
  inCostPer1k: number
  outCostPer1k: number
  updatedAt: string
}

export type AiUsageView = {
  month: {
    label: string
    requests: number
    promptTokens: number
    completionTokens: number
    totalTokens: number
    costSar: number
  }
  perUser: {
    userName: string
    requests: number
    promptTokens: number
    completionTokens: number
    totalTokens: number
    costSar: number
  }[]
  trend: { label: string; tokens: number; costSar: number }[]
  sixMonthCost: number
}

export type AiLogRow = {
  id: string
  userName: string | null
  question: string
  toolsCalled: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  costSar: number
  durationMs: number
  provider: string
  model: string
  success: boolean
  error: string | null
  createdAt: string
}

export const AI_DRAFT_ICONS: Record<AiDraft['type'], string> = {
  quotation: 'quotation',
  invoice: 'invoice',
  po: 'po',
  email: 'email',
  letter: 'letter',
}

export const VIEW_LABELS: Partial<Record<ViewKey, string>> = {
  dashboard: 'Dashboard',
  projects: 'Project Management',
  clients: 'Clients',
  deployments: 'Worker Deployment',
  'staff-list': 'Staff List',
  'staff-categories': 'Staff Categories',
  attendance: 'Staff Attendance',
  payroll: 'Payroll',
  advances: 'Worker Advances',
  'salary-sheet': 'Salary Sheet',
  'salary-summary': 'Staff Salary Summary',
  'client-salary-summary': 'Client Salary Summary',
  'income-list': 'Income List',
  'expense-list': 'Expense List',
  'accounts-summary': 'Accounts Summary',
  'transaction-categories': 'Categories',
  'vat-return-expense': 'VAT Return Expense',
  quotations: 'Quotations',
  'e-invoices': 'E-Invoice',
  'name-list': 'Name List',
  'supplier-pos': 'Supplier P.O.',
  agreements: 'Agreements',
  roles: 'Roles',
  users: 'Users',
  settings: 'Settings',
  'activity-log': 'Activity Log',
  'ai-assistant': 'AI Assistant',
}
export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export const PAY_TYPE_LABELS: Record<PayType, string> = {
  bank_transfer: 'Bank Transfer',
  cash: 'Cash',
  cheque: 'Cheque',
}

// ── Business Documents (Quotations, E-Invoices, Name List, Supplier P.O., Agreements) ──

/** Shared line-item shape used by quotations, supplier POs and agreements */
export type DocItemRow = {
  id?: string
  sr: number
  description: string
  unit: string | null
  quantity: number
  unitPrice: number
  /** Optional per-line discount amount (quotations). */
  discount?: number
  lineTotal: number
  /** Quotation template: gray detail line under the description. */
  subText?: string | null
  /** Quotation template: SAR/hour basis (Rate / Hour column). */
  ratePerHour?: number | null
  /** Quotation template: hours/month basis (Hours / Month column). */
  hoursPerMonth?: number | null
}

/** Signature / stamp image placed on a quotation (percent-of-A4 coordinates). */
export type QuotationAssetRow = {
  id?: string
  type: 'signature' | 'stamp'
  dataUrl: string
  posX: number // % of page width (left edge)
  posY: number // % of page height (top edge)
  width: number // % of page width
  rotation: number // degrees clockwise
  visible: boolean
}

/** Company letterhead configuration (single row, GET /api/letterhead). */
export type LetterheadConfig = {
  mode: 'none' | 'header' | 'header_footer' | 'full'
  headerImage: string | null
  footerImage: string | null
  fullPageImage: string | null
  showCompanyDetails: boolean
  headerHeightMm: number
  footerHeightMm: number
}

export type QuotationRow = {
  id: string
  quoteNumber: string
  clientId: string | null
  clientName: string
  subject: string | null
  referenceNo: string | null
  issueDate: string
  validityDate: string | null
  status: string
  subtotal: number
  discount: number
  vatRate: number
  vatAmount: number
  total: number
  notes: string | null
  terms: string | null
  /** Quotation template: PROJECT DETAILS box. */
  projectName: string | null
  projectLocation: string | null
  contractPeriod: string | null
  /** Numeric months — drives the Contract Value row (total × months). */
  contractMonths: number | null
  mobilization: string | null
  /** Newline-separated bullet lists (INCLUDED / EXCLUDED boxes). */
  inclusions: string | null
  exclusions: string | null
  createdByName: string | null
  createdAt: string
  items?: DocItemRow[]
  assets?: QuotationAssetRow[]
}

/** Company/person directory entry (the "Directory" tab of the Name List
 *  module) — maps the NameListEntry table. */
export type NameListEntryRow = {
  id: string
  name: string
  type: string
  contactPerson: string | null
  phone: string | null
  email: string | null
  crNumber: string | null
  vatNumber: string | null
  address: string | null
  city: string | null
  status: string
  notes: string | null
  createdAt: string
}

/** Saved supplier directory row (GET /api/suppliers) — picked from a dropdown
 *  when creating Supplier P.O.s so details auto-fill and persist. */
export type SupplierRow = {
  id: string
  name: string
  contactPerson: string | null
  phone: string | null
  email: string | null
  address: string | null
  vatNumber: string | null
  crNumber: string | null
  status: string // active | inactive
  notes: string | null
  createdByName: string | null
  createdAt: string
  poCount: number
}

export type SupplierPoRow = {
  id: string
  poNumber: string
  supplierId: string | null
  supplierName: string
  supplierPhone: string | null
  attention: string | null
  issueDate: string
  expectedDate: string | null
  status: string
  quotationRef: string | null
  paymentTerms: string | null
  workSite: string | null
  startDate: string | null
  durationMonths: number | null
  workingHours: string | null
  hoursPerMonth: number | null
  supplierAddress: string | null
  supplierVat: string | null
  supplierCr: string | null
  subtotal: number
  vatRate: number
  vatAmount: number
  total: number
  notes: string | null
  createdByName: string | null
  createdAt: string
  items?: DocItemRow[]
}

export type AgreementInstallmentRow = {
  id?: string
  sr: number
  label: string
  dueDate: string | null
  amount: number
  paid: boolean
}

export type AgreementClauseRow = {
  id?: string
  sr: number
  title: string | null
  body: string
}

export type AgreementRow = {
  id: string
  refNumber: string
  title: string
  partyA: string
  clientId: string | null
  clientName: string
  type: string
  layoutStyle: string
  startDate: string
  endDate: string | null
  status: string
  value: number
  currency: string
  notes: string | null
  createdByName: string | null
  createdAt: string
  items?: DocItemRow[]
  installments?: AgreementInstallmentRow[]
  clauses?: AgreementClauseRow[]
}

export const QUOTATION_STATUSES = ['draft', 'sent', 'accepted', 'rejected', 'expired'] as const
export const SUPPLIER_PO_STATUSES = ['draft', 'ordered', 'received', 'cancelled'] as const
export const AGREEMENT_STATUSES = ['draft', 'final', 'signed', 'expired'] as const
export const AGREEMENT_TYPES = ['labor_supply', 'service', 'subcontract'] as const
export const NAME_LIST_TYPES = ['client', 'supplier', 'subcontractor', 'other'] as const

// ═══════════ E-INVOICE MODULE (bilingual ZATCA-style) ═══════════
export const EINVOICE_DOC_TYPES = ['invoice', 'credit_note', 'debit_note'] as const
export const EINVOICE_STATUSES = ['draft', 'issued', 'partially_paid', 'paid'] as const
// Derived status — not stored: dueDate < today AND status IN (issued, partially_paid) AND paid < total
export const EINVOICE_FILTER_STATUSES = ['draft', 'issued', 'partially_paid', 'paid', 'overdue'] as const

export type EInvoiceItemRow = {
  id: string
  sr: number
  descriptionEn: string
  descriptionAr: string
  descArManual: boolean
  unitEn: string | null
  unitAr: string | null
  unitArManual: boolean
  quantity: number
  unitPrice: number
  discount: number
  vatPercent: number
  taxableAmount: number
  vatAmount: number
  lineTotal: number
}
export type EInvoicePaymentRow = {
  id: string
  amount: number
  paymentDate: string
  methodEn: string | null
  methodAr: string | null
  reference: string | null
  notes: string | null
  createdByName: string | null
  createdAt: string
}
export type EInvoiceRow = {
  id: string
  invoiceNumber: string
  docType: string
  clientId: string | null
  clientNameEn: string
  clientNameAr: string
  clientVatNumber: string | null
  clientCrNumber: string | null
  clientAddressEn: string | null
  clientAddressAr: string | null
  poRef: string | null
  contractRef: string | null
  projectEn: string | null
  projectAr: string | null
  paymentTermsEn: string | null
  paymentTermsAr: string | null
  paymentMethodEn: string | null
  paymentMethodAr: string | null
  issueDate: string
  supplyDate: string | null
  dueDate: string | null
  status: string
  subtotal: number
  totalDiscount: number
  taxableAmount: number
  vatAmount: number
  totalDue: number
  paidAmount: number
  notesEn: string | null
  notesAr: string | null
  arManualFlags: string[] // header field keys manually edited in Arabic (auto-translate must not overwrite)
  showReceiverSignature: boolean
  // ZATCA phase designation (per invoice): 1 = Generation, 2 = Integration
  zatcaPhase: number
  zatcaStatus: string | null // reported | cleared | rejected (Phase 2 submission outcome)
  zatcaSubmittedAt: string | null
  zatcaSubmissionMode: string | null // simulation | production
  relatedInvoiceId: string | null
  uuid: string | null
  icv: number | null
  invoiceHash: string | null
  previousHash: string | null
  issuedAt: string | null
  issuedByName: string | null
  signedCopyImage: string | null
  createdAt: string
  updatedAt: string
  // derived
  overdue: boolean
  clientName?: string // = clientNameEn (list display convenience)
  itemCount?: number
  items?: EInvoiceItemRow[]
  payments?: EInvoicePaymentRow[]
  relatedInvoiceNumber?: string | null
}
export type EInvoiceConfig = {
  letterhead: string
  topMm: number
  bottomMm: number
  signature: string
  stamp: string
  showReceiverSignature: boolean
  translateProvider: string
  translateApiKeySet: boolean
}
export type GlossaryTermRow = {
  id: string
  termEn: string
  termAr: string
  notes: string | null
  createdAt: string
}

// ── Name List module (worker deployment lists) ─────────────────────────────
export type NameListSubjectKind = 'interview' | 'mobilization'
export type NameListWorkerResult = 'selected' | 'rejected' | 'absent' | 'onhold'
export type NameListStatus = 'draft' | 'sent' | 'completed' | 'cancelled'

export type NameListSubjectRow = {
  id: string
  name: string
  color: string
  kind: NameListSubjectKind
  sortOrder: number
  isSystem: boolean
}

/** Worker row inside a list, with the staff fields the printouts need. */
export type NameListWorkerRow = {
  id: string
  staffId: string
  sortOrder: number
  result: NameListWorkerResult | null
  remarks: string | null
  staff: {
    id: string
    fullName: string
    phone: string | null
    position: string | null
    iqamaId: string
    iqamaExpiry: string | null
    passportNo: string | null
    nationality: string | null
    bloodGroup: string | null
    experienceYears: number | null
    deploymentStatus: string
    status: string
    categoryName: string | null
  }
}

/** Summary row (list index, today board, client tab). */
export type NameListRow = {
  id: string
  listNo: string
  date: string
  time: string | null
  clientId: string
  clientName: string
  location: string | null
  projectId: string | null
  projectName: string | null
  subjectId: string
  subjectName: string
  subjectColor: string
  subjectKind: NameListSubjectKind
  positions: string[]
  clientContact: string | null
  clientPhone: string | null
  transport: string | null
  refInterviewListId: string | null
  refInterviewListNo: string | null
  refPoNo: string | null
  notes: string | null
  status: NameListStatus
  workerCount: number
  resultCounts: { selected: number; rejected: number; absent: number; onhold: number; pending: number }
  signedCopyName: string | null
  createdByName: string | null
  createdAt: string
}

/** Full list for the editor / print (GET /api/name-lists/[id]). */
export type NameListDetail = NameListRow & {
  client: {
    id: string
    name: string
    contactPerson: string | null
    phone: string | null
    city: string | null
  } | null
  workers: NameListWorkerRow[]
  columns: NameListColumns | null
}

/** Visible-column toggles (# and Employee Name are always shown). */
export type NameListColumnKey =
  | 'trade'
  | 'experience'
  | 'nationality'
  | 'iqama'
  | 'passport'
  | 'mobile'
  | 'blood'
  | 'iqamaExpiry'
  | 'employeeId'
  | 'result'
  | 'remarks'

export type NameListColumns = Partial<Record<NameListColumnKey, boolean>>

/** Per-user warning returned when adding a worker (never a hard block). */
export type NameListWorkerWarning = {
  staffId: string
  staffName: string
  type: 'conflict' | 'deployed' | 'missing'
  message: string
}

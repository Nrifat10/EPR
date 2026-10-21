// Permission catalog — shared by backend validation and the Roles UI
export const MODULES: { module: string; label: string; actions: string[]; actionLabels: Record<string, string> }[] = [
  {
    module: 'dashboard',
    label: 'Dashboard',
    actions: ['view'],
    actionLabels: { view: 'View' },
  },
  {
    module: 'projects',
    label: 'Project Management',
    actions: ['view', 'create', 'edit', 'delete'],
    actionLabels: { view: 'View', create: 'Create', edit: 'Edit', delete: 'Delete' },
  },
  {
    module: 'clients',
    label: 'Client Management',
    actions: ['view', 'create', 'edit', 'delete'],
    actionLabels: { view: 'View', create: 'Create', edit: 'Edit', delete: 'Delete' },
  },
  {
    module: 'staff',
    label: 'Staff Management',
    actions: ['view', 'create', 'edit', 'delete'],
    actionLabels: { view: 'View', create: 'Create', edit: 'Edit', delete: 'Delete' },
  },
  {
    module: 'attendance',
    label: 'Attendance',
    actions: ['view', 'create', 'edit', 'delete'],
    actionLabels: { view: 'View', create: 'Create', edit: 'Edit', delete: 'Delete' },
  },
  {
    module: 'payroll',
    label: 'Payroll & Salary Sheets',
    actions: ['view', 'create', 'edit', 'delete', 'print'],
    actionLabels: { view: 'View', create: 'Create', edit: 'Edit', delete: 'Delete', print: 'Print' },
  },
  {
    module: 'advances',
    label: 'Worker Advances',
    actions: ['view', 'create', 'edit', 'delete'],
    actionLabels: { view: 'View', create: 'Add Advances', edit: 'Edit', delete: 'Delete' },
  },
  {
    module: 'accounts',
    label: 'Account Research',
    actions: ['view', 'create', 'edit', 'delete'],
    actionLabels: { view: 'View', create: 'Create', edit: 'Edit', delete: 'Delete' },
  },
  {
    module: 'vat',
    label: 'VAT Return Expense',
    actions: ['view', 'create', 'edit', 'delete'],
    actionLabels: { view: 'View', create: 'Create', edit: 'Edit', delete: 'Delete' },
  },
  {
    module: 'quotations',
    label: 'Quotations',
    actions: ['view', 'create', 'edit', 'delete'],
    actionLabels: { view: 'View', create: 'Create', edit: 'Edit', delete: 'Delete' },
  },
  {
    module: 'einvoices',
    label: 'E-Invoice',
    actions: ['view', 'create', 'edit', 'delete'],
    actionLabels: { view: 'View', create: 'Create', edit: 'Edit', delete: 'Delete' },
  },
  {
    module: 'namelist',
    label: 'Name List',
    actions: ['view', 'create', 'edit', 'delete'],
    actionLabels: { view: 'View', create: 'Create', edit: 'Edit', delete: 'Delete' },
  },
  {
    module: 'supplierpo',
    label: 'Supplier P.O.',
    actions: ['view', 'create', 'edit', 'delete'],
    actionLabels: { view: 'View', create: 'Create', edit: 'Edit', delete: 'Delete' },
  },
  {
    module: 'suppliers',
    label: 'Suppliers (Directory)',
    actions: ['view', 'create', 'edit', 'delete'],
    actionLabels: { view: 'View', create: 'Create', edit: 'Edit', delete: 'Delete' },
  },
  {
    module: 'agreements',
    label: 'Agreements',
    actions: ['view', 'create', 'edit', 'delete'],
    actionLabels: { view: 'View', create: 'Create', edit: 'Edit', delete: 'Delete' },
  },
  {
    module: 'ai',
    label: 'AI Assistant',
    actions: ['use', 'viewlogs', 'managesettings', 'seefullids'],
    actionLabels: {
      use: 'Use AI Assistant',
      viewlogs: 'View usage & logs',
      managesettings: 'Manage provider settings',
      seefullids: 'See full Iqama/Passport numbers in AI answers',
    },
  },
  {
    module: 'roles',
    label: 'Roles',
    actions: ['view', 'create', 'edit', 'delete'],
    actionLabels: { view: 'View', create: 'Create', edit: 'Edit', delete: 'Delete' },
  },
  {
    module: 'users',
    label: 'Users',
    actions: ['view', 'create', 'edit', 'delete'],
    actionLabels: { view: 'View', create: 'Create', edit: 'Edit', delete: 'Delete' },
  },
  {
    module: 'settings',
    label: 'Settings',
    actions: ['view', 'edit'],
    actionLabels: { view: 'View', edit: 'Edit' },
  },
  {
    module: 'activity',
    label: 'Activity Log',
    actions: ['view'],
    actionLabels: { view: 'View' },
  },
]

export const ALL_PERMISSIONS: string[] = MODULES.flatMap((m) =>
  m.actions.map((a) => `${m.module}.${a}`)
)

/**
 * Baseline permissions granted to EVERY signed-in user, regardless of role.
 *
 * COMPANY-WIDE FULL ACCESS (owner request): every user who logs in can open
 * and use ALL modules — view, create, edit and delete everywhere. Role
 * permissions stored on each role are kept for reference and only take
 * effect if this baseline is restricted again (e.g. back to
 * `new Set(['vat.view'])` for view-only VAT access for everyone).
 *
 * Enforced server-side (lib/auth.ts hasPermission) and client-side
 * (lib/store.ts can) — sidebar items, command palette, shortcuts, action
 * buttons and every API route check against this set first.
 */
export const BASELINE_PERMISSIONS: ReadonlySet<string> = new Set(ALL_PERMISSIONS)

export function isValidPermission(p: string): boolean {
  return p === '*' || ALL_PERMISSIONS.includes(p)
}

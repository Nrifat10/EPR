// Global client state (zustand): current user, settings, active view
import { create } from 'zustand'
import { BASELINE_PERMISSIONS } from '@/lib/permissions'
import type { AppSettings, SessionUser, ViewKey } from '@/lib/types'

const DEFAULT_SETTINGS: AppSettings = {
  companyName: 'Landmark Inter Gulf',
  companyNameAr: 'لاندمارك انتر جلف',
  address:
    'Al Suwedhi Business Centre, Office # 103, 1st Floor, P.O.Box 35712, Building 5526, 4th Street, Distt. Al Wahah, Jubail, Kingdom of Saudi Arabia',
  addressAr: 'مركز السويدي التجاري، مكتب 103، الدور الأول، ص.ب. 35712، مبنى 5526، الشارع الرابع، حي الوها، الجبيل، المملكة العربية السعودية',
  phone: '+966 13 847 2200',
  email: 'info@landmarkintergulf.com',
  logo: '/logo-mark.png', // default brand ML monogram (public/logo-mark.png)
  currency: 'SAR',
  defaultPayType: 'bank_transfer',
  authorizedSignatory: '',
  signatoryTitle: 'Authorized Signatory',
  vatNumber: '',
  crNumber: '',
  bankName: '',
  bankIban: '',
  bankAccountNumber: '',
  bankAccountName: '',
  bankSwiftCode: '',
  bankAddress: '',
  vatRate: 15, // percent — Saudi standard VAT for the VAT Return Expense module
}

export type ViewIntentPayload = {
  staffName?: string
  month?: number
  year?: number
}

type ViewIntent = {
  view: ViewKey
  /** create = deep-open the create dialog · print = open print preview · record = open a specific row */
  kind: 'create' | 'print' | 'record'
  /** Target record id for 'record' intents (e.g. staff/project id from the palette search) */
  recordId?: string
  /** Optional record context for 'record' intents (e.g. payroll staff name + period for deep filtering) */
  payload?: ViewIntentPayload
}

type AppState = {
  user: SessionUser | null
  settings: AppSettings
  view: ViewKey
  sidebarOpen: boolean
  /** One-shot navigation intent (e.g. open the create dialog / print preview right after switching view) */
  pendingIntent: ViewIntent | null
  setUser: (user: SessionUser | null) => void
  setSettings: (settings: AppSettings) => void
  setView: (view: ViewKey) => void
  setSidebarOpen: (open: boolean) => void
  setPendingIntent: (intent: ViewIntent | null) => void
  consumePendingIntent: (view: ViewKey, kind: ViewIntent['kind']) => boolean
}

export const useAppStore = create<AppState>((set, get) => ({
  user: null,
  settings: DEFAULT_SETTINGS,
  view: 'dashboard',
  sidebarOpen: false,
  pendingIntent: null,
  setUser: (user) => set({ user }),
  setSettings: (settings) => set({ settings }),
  setView: (view) => set({ view, sidebarOpen: false }),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  setPendingIntent: (pendingIntent) => set({ pendingIntent }),
  consumePendingIntent: (view, kind) => {
    const current = get().pendingIntent
    if (current && current.view === view && current.kind === kind) {
      set({ pendingIntent: null })
      return true
    }
    return false
  },
}))

export function can(
  user: SessionUser | null,
  permission: string
): boolean {
  // Baseline permissions apply to every signed-in user (company-wide full access)
  if (user && BASELINE_PERMISSIONS.has(permission)) return true
  const perms = user?.role?.permissions ?? []
  return perms.includes('*') || perms.includes(permission)
}

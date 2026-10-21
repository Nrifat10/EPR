'use client'

// Shared ZATCA UI primitives — used by the E-Invoice module's submission
// dialog (e-invoice-zatca-submit.tsx) and the Settings → ZATCA connection
// section (settings.tsx). Extracted from the retired classic Invoice module
// so those pieces survive its removal.
//
//   • ZatcaStatusBadge  — reported | cleared | rejected pill
//   • ZatcaChecksList   — severity-colored validation checklist
//   • ZatcaProfile / ZatcaCheck / ZatcaTestResult — API payload types
//   • ZATCA_ENV_GATEWAYS / ENV_LABELS — client-safe Fatoora gateway constants
import { CheckCircle2, XCircle } from 'lucide-react'

import { cn } from '@/lib/utils'

import { Badge } from '@/components/ui/badge'

export type ZatcaEnv = 'simulation' | 'preprod' | 'production'

/** Per-environment Fatoora gateway URLs (public constants — client-safe copy of the server-side ZATCA_ENV_BASES). */
export const ZATCA_ENV_GATEWAYS: Record<ZatcaEnv, string> = {
  simulation: 'https://gw-fatura.zatca.gov.sa/e-invoicing/simulation',
  preprod: 'https://gw-fatura.zatca.gov.sa/e-invoicing/developer-portal',
  production: 'https://gw-fatura.zatca.gov.sa/e-invoicing/core',
}

export const ENV_LABELS: Record<ZatcaEnv, string> = {
  simulation: 'Simulation',
  preprod: 'Pre-production',
  production: 'Production',
}

/** GET /api/zatca/profile — the raw CSID token never leaves the server. */
export type ZatcaProfile = {
  env: ZatcaEnv
  egsSerial: string
  csidTokenSet: boolean
  apiBase: string
  lastTest: {
    at: string
    ok: boolean
    mode: ZatcaEnv
    httpStatus?: number
    error?: string
    latencyMs: number
  } | null
}

export type ZatcaCheck = {
  name: string
  ok: boolean
  severity?: 'error' | 'warning'
  detail: string
}

/** POST /api/zatca/test-connection result. */
export type ZatcaTestResult = {
  ok: boolean
  mode: ZatcaEnv
  checks: ZatcaCheck[]
  note?: string
  error?: string
  httpStatus?: number
  latencyMs: number
}

/** Submission-status badge (used in e-invoice list rows and dialogs). */
export function ZatcaStatusBadge({
  status,
  className,
}: {
  status: string | null
  className?: string
}) {
  if (status === 'cleared') {
    return (
      <Badge
        className={cn(
          'gap-1 border-emerald-200 bg-emerald-50 font-medium text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300',
          className
        )}
      >
        <CheckCircle2 className="h-3 w-3" />
        Cleared
      </Badge>
    )
  }
  if (status === 'reported') {
    return (
      <Badge
        className={cn(
          'border-amber-200 bg-amber-50 font-medium text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300',
          className
        )}
      >
        Reported
      </Badge>
    )
  }
  if (status === 'rejected') {
    return (
      <Badge
        className={cn(
          'border-rose-200 bg-rose-50 font-medium text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-300',
          className
        )}
      >
        Rejected
      </Badge>
    )
  }
  return null
}

/** The validation checklist shared by the report + test-connection results. */
export function ZatcaChecksList({ checks }: { checks: ZatcaCheck[] }) {
  if (checks.length === 0) return null
  return (
    <ul className="space-y-1.5">
      {checks.map((c) => (
        <li
          key={c.name}
          className="flex items-start gap-2 rounded-md border bg-card p-2 text-xs"
        >
          {c.ok ? (
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          ) : (
            <XCircle
              className={cn(
                'mt-0.5 h-3.5 w-3.5 shrink-0',
                c.severity === 'warning'
                  ? 'text-amber-600 dark:text-amber-400'
                  : 'text-rose-600 dark:text-rose-400'
              )}
            />
          )}
          <div className="min-w-0">
            <p className="font-medium">
              {c.name}
              {!c.ok && c.severity === 'warning' ? (
                <span className="ml-1.5 rounded border border-amber-200 bg-amber-50 px-1 py-px text-[9px] font-bold uppercase tracking-wide text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
                  warning
                </span>
              ) : null}
              {!c.ok && c.severity !== 'warning' ? (
                <span className="ml-1.5 rounded border border-rose-200 bg-rose-50 px-1 py-px text-[9px] font-bold uppercase tracking-wide text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-300">
                  error
                </span>
              ) : null}
            </p>
            <p className="text-muted-foreground">{c.detail}</p>
          </div>
        </li>
      ))}
    </ul>
  )
}

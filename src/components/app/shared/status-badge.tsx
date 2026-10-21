'use client'

import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

export type BadgeKind =
  | 'active'      // navy (brand)
  | 'pending'     // amber
  | 'paid'        // green
  | 'inactive'    // gray
  | 'completed'   // green
  | 'income'      // green
  | 'expense'     // red
  | 'neutral'

export function StatusBadge({ kind, label, className }: { kind: BadgeKind; label?: string; className?: string }) {
  const styles: Record<BadgeKind, string> = {
    active: 'border-navy/25 bg-navy/8 text-primary dark:border-white/20 dark:bg-white/10 dark:text-white',
    pending: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300',
    paid: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300',
    inactive: 'border-gray-200 bg-gray-100 text-gray-600 dark:border-gray-800 dark:bg-gray-800/60 dark:text-gray-400',
    completed: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300',
    income: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300',
    expense: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-300',
    neutral: 'border-gray-200 bg-gray-50 text-gray-600 dark:border-gray-800 dark:bg-gray-800/40 dark:text-gray-400',
  }
  const labels: Record<BadgeKind, string> = {
    active: 'Active',
    pending: 'Pending',
    paid: 'Paid',
    inactive: 'Inactive',
    completed: 'Completed',
    income: 'Income',
    expense: 'Expense',
    neutral: '—',
  }
  return (
    <Badge variant="outline" className={cn('font-medium capitalize', styles[kind], className)}>
      {label ?? labels[kind]}
    </Badge>
  )
}

/** Small colored category chip used across lists */
export function CategoryChip({ label, className }: { label: string; className?: string }) {
  return (
    <Badge
      variant="secondary"
      className={cn(
        'max-w-[160px] truncate border-primary/20 bg-primary/10 font-medium text-primary hover:bg-primary/10',
        className
      )}
    >
      {label}
    </Badge>
  )
}

/**
 * IQAMA / passport validity badge (90-day alert window).
 * expired → rose, expiring (≤90 days) → amber, valid → neutral, unknown → muted dash.
 */
export function ExpiryBadge({
  status,
  daysLeft,
  className,
}: {
  status: 'expired' | 'expiring' | 'valid' | 'unknown'
  daysLeft?: number | null
  className?: string
}) {
  const styles = {
    expired:
      'border-rose-300 bg-rose-100 text-rose-800 dark:border-rose-800 dark:bg-rose-900/60 dark:text-rose-300',
    expiring:
      'border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-800 dark:bg-amber-900/60 dark:text-amber-300',
    valid:
      'border-gray-200 bg-gray-50 text-gray-600 dark:border-gray-800 dark:bg-gray-800/40 dark:text-gray-400',
    unknown:
      'border-gray-200 bg-gray-50 text-gray-400 dark:border-gray-800 dark:bg-gray-800/40 dark:text-gray-500',
  } as const
  const labels = {
    expired: 'Expired',
    expiring: daysLeft === null || daysLeft === undefined ? 'Expiring soon' : `In ${daysLeft}d`,
    valid: 'Valid',
    unknown: 'No date',
  } as const
  return (
    <Badge variant="outline" className={cn('whitespace-nowrap font-medium', styles[status], className)}>
      {labels[status]}
    </Badge>
  )
}

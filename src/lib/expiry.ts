// Shared IQAMA/passport expiry helpers — used by BOTH client (badges, chips)
// and server (filters, dashboard alerts). Pure functions only.

export const EXPIRY_WINDOW_DAYS = 90

export type ExpiryStatus = 'expired' | 'expiring' | 'valid' | 'unknown'

/** Whole days from today until `date` (negative = already past). Null when no date. */
export function daysUntil(date: string | Date | null | undefined): number | null {
  if (!date) return null
  const target = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(target.getTime())) return null
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  return Math.round((startOfDay(target) - startOfDay(new Date())) / 86_400_000)
}

/**
 * IQAMA validity for the 90-day alert window:
 * - 'expired'  → date is in the past
 * - 'expiring' → within the next EXPIRY_WINDOW_DAYS days
 * - 'valid'    → further out
 * - 'unknown'  → no date recorded
 */
export function expiryStatus(date: string | Date | null | undefined): ExpiryStatus {
  const days = daysUntil(date)
  if (days === null) return 'unknown'
  if (days < 0) return 'expired'
  if (days <= EXPIRY_WINDOW_DAYS) return 'expiring'
  return 'valid'
}

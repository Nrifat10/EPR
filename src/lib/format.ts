// Formatting helpers — used on both client and server
import { MONTHS } from './types'

/** Format a number as SAR money: 13390 → "SAR 13,390.00" */
export function formatMoney(n: number | null | undefined, currency = 'SAR'): string {
  if (n === null || n === undefined || isNaN(n)) return `${currency} 0.00`
  const neg = n < 0
  const abs = Math.abs(n)
  return `${neg ? '-' : ''}${currency} ${abs.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

/** Format money without currency prefix: 13390 → "13,390.00" */
export function formatNumber(n: number | null | undefined, decimals = 2): string {
  if (n === null || n === undefined || isNaN(n)) return (0).toFixed(decimals)
  return n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

/** Round to 2 decimals (money-safe) */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/** "2024-10-05T..." → "Oct 5, 2024" */
export function formatDate(d: string | Date | null | undefined): string {
  if (!d) return '—'
  const date = typeof d === 'string' ? new Date(d) : d
  if (isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/** "2024-10-05T14:30..." → "Oct 5, 2024, 2:30 PM" */
export function formatDateTime(d: string | Date | null | undefined): string {
  if (!d) return '—'
  const date = typeof d === 'string' ? new Date(d) : d
  if (isNaN(date.getTime())) return '—'
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/** yyyy-mm-dd for <input type=date> */
export function toDateInputValue(d: string | Date | null | undefined): string {
  if (!d) return ''
  const date = typeof d === 'string' ? new Date(d) : d
  if (isNaN(date.getTime())) return ''
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Convert an <input type=datetime-local> value to ISO string */
export function dateTimeLocalToISO(v: string): string | null {
  if (!v) return null
  const d = new Date(v)
  if (isNaN(d.getTime())) return null
  return d.toISOString()
}

/** ISO → value for <input type=datetime-local> */
export function isoToDateTimeLocal(d: string | null | undefined): string {
  if (!d) return ''
  const date = new Date(d)
  if (isNaN(date.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * Human duration from minutes: 8h 30m / 2w 1d 4h / 45m
 * (weeks = 5 working days per spec style "2w 1d")
 */
export function formatDuration(totalMinutes: number | null | undefined): string {
  if (totalMinutes === null || totalMinutes === undefined) return '—'
  if (totalMinutes < 1) return '0m'
  const weeks = Math.floor(totalMinutes / (7 * 24 * 60))
  let rem = totalMinutes % (7 * 24 * 60)
  const days = Math.floor(rem / (24 * 60))
  rem = rem % (24 * 60)
  const hours = Math.floor(rem / 60)
  const minutes = Math.round(rem % 60)
  const parts: string[] = []
  if (weeks > 0) parts.push(`${weeks}w`)
  if (days > 0) parts.push(`${days}d`)
  if (hours > 0) parts.push(`${hours}h`)
  if (minutes > 0) parts.push(`${minutes}m`)
  if (parts.length === 0) parts.push('0m')
  return parts.slice(0, 3).join(' ')
}

export function monthName(month: number): string {
  return MONTHS[month - 1] ?? String(month)
}

export function monthYearLabel(month: number, year: number): string {
  return `${monthName(month)} ${year}`
}

/** Duration in minutes between two ISO datetimes (null if checkout missing) */
export function minutesBetween(checkIn: string, checkOut: string | null): number | null {
  if (!checkOut) return null
  const a = new Date(checkIn).getTime()
  const b = new Date(checkOut).getTime()
  if (isNaN(a) || isNaN(b) || b <= a) return null
  return Math.round((b - a) / 60000)
}

/** Initials for avatar: "Muhammad Ali" → "MA" */
export function initials(name: string | null | undefined): string {
  if (!name) return '?'
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
}

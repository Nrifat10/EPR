// VAT helpers — shared by the vat-bills API routes.
// The rate lives in the `vatRate` Setting as a PERCENT string ("15");
// everywhere else it is handled as a FRACTION (0.15) like the rest of the app.
import 'server-only'
import { db } from '@/lib/db'
import { round2 } from '@/lib/format'

/** Saudi standard VAT (fallback when the Setting row is missing/invalid). */
export const DEFAULT_VAT_RATE = 0.15

/** Read the configured VAT rate fraction from the Settings table. */
export async function getVatRate(): Promise<number> {
  const row = await db.setting.findUnique({ where: { key: 'vatRate' } })
  if (!row) return DEFAULT_VAT_RATE
  const percent = parseFloat(row.value)
  if (isNaN(percent) || percent < 0 || percent > 100) return DEFAULT_VAT_RATE
  return percent / 100
}

/**
 * Split a bill grand total into its VAT breakdown (always server-side).
 *   withoutVat = withVat / (1 + rate)
 *   vat        = withVat - withoutVat
 * Rounded to 2 decimals so `withoutVat + vat === withVat` EXACTLY.
 */
export function splitVat(withVat: number, rate: number): {
  amountWithoutVat: number
  vatAmount: number
} {
  const amountWithoutVat = round2(withVat / (1 + rate))
  const vatAmount = round2(withVat - amountWithoutVat)
  return { amountWithoutVat, vatAmount }
}

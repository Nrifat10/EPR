// Amount-in-words (English) — shared by the quotation form live preview,
// the A4 print document and the Excel export so every surface shows the
// exact same wording. Currency label comes from Settings (SAR default);
// the fraction unit is "Halalas" (1/100 of a Saudi Riyal).

const ONES = [
  'Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
  'Seventeen', 'Eighteen', 'Nineteen',
]
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

function toWords(n: number): string {
  if (n < 0) return `Minus ${toWords(-n)}`
  if (n < 20) return ONES[n]
  if (n < 100) return `${TENS[Math.floor(n / 10)]}${n % 10 ? `-${ONES[n % 10]}` : ''}`
  if (n < 1000)
    return `${ONES[Math.floor(n / 100)]} Hundred${n % 100 ? ` ${toWords(n % 100)}` : ''}`
  if (n < 1_000_000)
    return `${toWords(Math.floor(n / 1000))} Thousand${n % 1000 ? ` ${toWords(n % 1000)}` : ''}`
  if (n < 1_000_000_000)
    return `${toWords(Math.floor(n / 1_000_000))} Million${n % 1_000_000 ? ` ${toWords(n % 1_000_000)}` : ''}`
  return `${toWords(Math.floor(n / 1_000_000_000))} Billion${n % 1_000_000_000 ? ` ${toWords(n % 1_000_000_000)}` : ''}`
}

/**
 * "SAR One Thousand Two Hundred Thirty-Four and 50/100 Halalas Only"
 * Handles negatives (rare), zero and halves. Safe for amounts up to billions.
 */
export function amountInWords(amount: number, currency = 'SAR'): string {
  const rounded = Math.round(amount * 100) / 100
  const units = Math.floor(rounded)
  const halalas = Math.round((rounded - units) * 100)
  let s = `${currency} ${toWords(units)}`
  if (halalas > 0) s += ` and ${toWords(halalas)} Halalas`
  return `${s} Only`
}

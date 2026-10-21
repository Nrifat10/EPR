// Amount-in-words (Arabic) — formal فصحى wording for Saudi-style cheques and
// bilingual ZATCA e-invoices, e.g.
//   116955 → "مائة وستة عشر ألفاً وتسعمائة وخمسة وخمسون ريالاً سعودياً فقط لا غير"
// Deterministic (pure function, no LLM). Masculine forms; the هللة (halala)
// fraction uses feminine agreement. Shared client/server (no imports beyond
// the existing English lib).

import { amountInWords } from './amount-words'

// ── Arabic number words (masculine) ─────────────────────────────────────────

const ONES = [
  '', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة',
]
const ONES_F = [
  '', 'واحدة', 'اثنتان', 'ثلاث', 'أربع', 'خمس', 'ست', 'سبع', 'ثمان', 'تسع',
]
const TEENS = [
  'عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر',
  'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر',
]
const TENS = [
  '', 'عشرة', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون',
]
const HUNDREDS = [
  '', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة',
  'ثمانمائة', 'تسعمائة',
]

/** A 0-999 group in words. `feminine` switches ones/tens agreement (هللة). */
function groupToWords(n: number, feminine = false): string {
  const h = Math.floor(n / 100)
  const rest = n % 100
  const parts: string[] = []
  if (h > 0) parts.push(HUNDREDS[h])
  if (rest > 0) {
    if (rest < 10) {
      parts.push(feminine ? ONES_F[rest] : ONES[rest])
    } else if (rest < 20) {
      // 10-19: feminine uses عشرة for 10 and keeps masculine teens otherwise
      parts.push(rest === 10 && feminine ? 'عشر' : TEENS[rest - 10])
    } else {
      const t = Math.floor(rest / 10)
      const o = rest % 10
      const ones = o > 0 ? (feminine ? ONES_F[o] : ONES[o]) : ''
      parts.push(ones ? `${ones} و${TENS[t]}` : TENS[t])
    }
  }
  return parts.join(' و')
}

/** How a counted noun follows its number (Arabic counted-noun agreement). */
type NounForm = { one: string; two: string; few: string; many: string }

/** Singular/dual/plural/accusative-singular forms per scale (thousands…). */
const SCALE_FORMS: NounForm[] = [
  { one: 'ألف', two: 'ألفان', few: 'آلاف', many: 'ألفاً' },
  { one: 'مليون', two: 'مليونان', few: 'ملايين', many: 'مليوناً' },
  { one: 'مليار', two: 'ملياران', few: 'مليارات', many: 'ملياراً' },
]

/** Render 1-999 group + its scale noun with correct agreement. */
function scaleGroupToWords(n: number, scale: number): string {
  const forms = SCALE_FORMS[scale]
  if (n === 1) return forms.one
  if (n === 2) return forms.two
  const words = groupToWords(n)
  if (n >= 3 && n <= 10) return `${words} ${forms.few}`
  return `${words} ${forms.many}`
}

/** Integer → formal Arabic words (handles up to billions). */
function integerToArabicWords(n: number): string {
  if (n === 0) return 'صفر'
  const groups: number[] = []
  let rest = Math.floor(n)
  while (rest > 0) {
    groups.push(rest % 1000)
    rest = Math.floor(rest / 1000)
  }
  const parts: string[] = []
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i]
    if (g === 0) continue
    if (i === 0) {
      parts.push(groupToWords(g))
    } else {
      parts.push(scaleGroupToWords(g, i - 1))
    }
  }
  return parts.join(' و')
}

// ── Currency forms ──────────────────────────────────────────────────────────

type ArabicCurrency = {
  code: string
  /** counted-noun forms for the main unit */
  unit: NounForm
  /** e.g. "ريالاً سعودياً" style adjectives that echo the agreement */
  adjective?: { one: string; two: string; few: string; many: string }
  /** fraction unit (feminine) forms */
  fraction: NounForm
}

const CURRENCIES: Record<string, ArabicCurrency> = {
  SAR: {
    code: 'SAR',
    unit: { one: 'ريال', two: 'ريالان', few: 'ريالات', many: 'ريالاً' },
    adjective: { one: 'سعودي', two: 'سعوديان', few: 'سعودية', many: 'سعودياً' },
    fraction: { one: 'هللة', two: 'هللتان', few: 'هللات', many: 'هللة' },
  },
  AED: {
    code: 'AED',
    unit: { one: 'درهم', two: 'درهمان', few: 'دراهم', many: 'درهماً' },
    adjective: { one: 'إماراتي', two: 'إماراتيان', few: 'إماراتية', many: 'إماراتياً' },
    fraction: { one: 'فلس', two: 'فلسان', few: 'فلوس', many: 'فلساً' },
  },
  USD: {
    code: 'USD',
    unit: { one: 'دولار', two: 'دولاران', few: 'دولارات', many: 'دولاراً' },
    fraction: { one: 'سنت', two: 'سنتان', few: 'سنتات', many: 'سنتاً' },
  },
  EUR: {
    code: 'EUR',
    unit: { one: 'يورو', two: 'يوروان', few: 'يوروات', many: 'يورو' },
    fraction: { one: 'سنت', two: 'سنتان', few: 'سنتات', many: 'سنتاً' },
  },
  GBP: {
    code: 'GBP',
    unit: { one: 'جنيه', two: 'جنيهان', few: 'جنيهات', many: 'جنيهاً' },
    adjective: { one: 'إسترليني', two: 'إسترلينيان', few: 'إسترلينية', many: 'إسترلينياً' },
    fraction: { one: 'بنس', two: 'بنسان', few: 'بنسات', many: 'بنساً' },
  },
  QAR: {
    code: 'QAR',
    unit: { one: 'ريال', two: 'ريالان', few: 'ريالات', many: 'ريالاً' },
    adjective: { one: 'قطري', two: 'قطريان', few: 'قطربية', many: 'قطرياً' },
    fraction: { one: 'درهم', two: 'درهمان', few: 'دراهم', many: 'درهماً' },
  },
  KWD: {
    code: 'KWD',
    unit: { one: 'دينار', two: 'ديناران', few: 'دنانير', many: 'ديناراً' },
    adjective: { one: 'كويتي', two: 'كويتيان', few: 'كويتية', many: 'كويتياً' },
    fraction: { one: 'فلس', two: 'فلسان', few: 'فلوس', many: 'فلساً' },
  },
  BHD: {
    code: 'BHD',
    unit: { one: 'دينار', two: 'ديناران', few: 'دنانير', many: 'ديناراً' },
    adjective: { one: 'بحريني', two: 'بحرينيان', few: 'بحرينية', many: 'بحرينياً' },
    fraction: { one: 'فلس', two: 'فلسان', few: 'فلوس', many: 'فلساً' },
  },
  OMR: {
    code: 'OMR',
    unit: { one: 'ريال', two: 'ريالان', few: 'ريالات', many: 'ريالاً' },
    adjective: { one: 'عماني', two: 'عمانيان', few: 'عمانية', many: 'عمانياً' },
    fraction: { one: 'بيسة', two: 'بيستان', few: 'بيسات', many: 'بيسة' },
  },
}

function currencyFor(code: string): ArabicCurrency {
  return CURRENCIES[(code || 'SAR').toUpperCase()] ?? CURRENCIES.SAR
}

/** Pick the right agreement form of a noun for a counted value 1-999. */
function nounFor(n: number, forms: NounForm): string {
  if (n === 1) return forms.one
  if (n === 2) return forms.two
  if (n >= 3 && n <= 10) return forms.few
  return forms.many
}

type AgreementForm = 'one' | 'two' | 'few' | 'many'

/**
 * Main-unit noun agreement looks at the FINAL number context:
 *  • ends with units 1 → singular
 *  • ends with units 2 → dual
 *  • ends with 3-10 (units group) → plural
 *  • ends with 11-99 → accusative singular
 *  • ends with exact hundreds/thousands (units group empty, or after a
 *    scale word like آلاف/ألفان/ألفاً) → singular
 */
function unitAgreement(whole: number): AgreementForm {
  if (whole === 1) return 'one'
  if (whole === 2) return 'two'
  const last2 = whole % 100
  if (last2 === 0) return 'one' // exact hundreds / exact thousands
  if (last2 >= 3 && last2 <= 10) return 'few'
  if (last2 >= 11) return 'many'
  return 'one' // last2 is 1 or 2 with higher groups — singular reads best
}

/**
 * Formal Arabic amount-in-words, e.g.
 *   amountToWordsArabic(116955)
 *   → "مائة وستة عشر ألفاً وتسعمائة وخمسة وخمسون ريالاً سعودياً فقط لا غير"
 *   amountToWordsArabic(1234.5)
 *   → "ألف ومائتان وأربعة وثلاثون ريالاً سعودياً وخمسون هللة فقط لا غير"
 */
export function amountToWordsArabic(amount: number, currency = 'SAR'): string {
  const cur = currencyFor(currency)
  const rounded = Math.round(amount * 100) / 100
  const negative = rounded < 0
  const abs = Math.abs(rounded)
  const units = Math.floor(abs)
  const fraction = Math.round((abs - units) * 100)

  const unitWords = integerToArabicWords(units)
  const form = unitAgreement(units)
  const unitNoun = cur.unit[form]
  const unitAdj = cur.adjective ? ` ${cur.adjective[form]}` : ''

  let phrase: string
  if (units === 0) {
    phrase = `${unitWords} ${unitNoun}` // "صفر ريال"
  } else if (units === 1) {
    phrase = `${unitNoun}${unitAdj} واحد` // "ريال سعودي واحد"
  } else {
    phrase = `${unitWords} ${unitNoun}${unitAdj}`
  }

  if (fraction > 0) {
    const fracWords = integerToArabicWords(fraction)
    const fracNoun = nounFor(fraction, cur.fraction)
    phrase += ` و${fracWords} ${fracNoun}`
  }
  if (negative) phrase = `سالب ${phrase}`
  return `${phrase} فقط لا غير`
}

/** Both languages at once — used by the bilingual print view. */
export function amountInWordsBoth(
  amount: number,
  currency = 'SAR'
): { en: string; ar: string } {
  return {
    en: amountInWords(amount, currency),
    ar: amountToWordsArabic(amount, currency),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// English → Arabic translation pipeline for the E-Invoice module (server-only).
// The boss types English only; Arabic is auto-translated and stays editable.
//
// Pipeline per entry (text trimmed):
//   1. Skip guard     — numbers, dates, VAT/CR numbers, IBAN, SWIFT, emails,
//                       phones, document references, already-Arabic text
//   2. Glossary       — fixed GlossaryTerm pairs ALWAYS win (exact match or
//                       longest-first phrase substitution inside longer text)
//   3. Memory         — TranslationMemory exact match (sourceText + context)
//                       with usage counting
//   4. Provider       — builtin (z-ai sdk, one batched chat completion) |
//                       google | deepl, configured via Settings
//                       (translate_provider / translate_api_key)
//
// NEVER throws — provider failures degrade to source:'failed' with an empty
// translation so the UI can warn and let the user type Arabic manually.
// ─────────────────────────────────────────────────────────────────────────────
import 'server-only'
import ZAI from 'z-ai-web-dev-sdk'
import { db } from '@/lib/db'

export type TranslateEntry = { key: string; text: string; context?: string }

export type TranslateResult = {
  key: string
  translated: string
  source: 'glossary' | 'memory' | 'provider' | 'skipped' | 'failed'
}

// ── Step 1: skip guards ─────────────────────────────────────────────────────

/** Pure numbers / amounts: "1,200.00", "42", "3.5%" */
const RE_PURE_NUMBER = /^[\d\s.,%+-]+$/
/** Currency amounts: "SAR 500", "500 SAR", "SAR 1,200.00" */
const RE_CURRENCY_AMOUNT = /^(sar|aed|usd|eur|gbp|sr|rs)\s*[\d,]+(\.\d+)?$/i
const RE_CURRENCY_AMOUNT_SUFFIX = /^[\d,]+(\.\d+)?\s*(sar|aed|usd|eur|gbp|sr|rs)$/i
/** ISO dates / datetimes and d/m/y forms */
const RE_ISO_DATE = /^\d{4}-\d{2}-\d{2}([T\s]\d{2}:\d{2}(:\d{2})?(\.\d+)?Z?)?$/
const RE_SLASH_DATE = /^\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}$/
/** Saudi VAT (15 digits starting & ending with 3) and CR (10 digits) */
const RE_VAT_NUMBER = /^3\d{13}3$/
const RE_CR_NUMBER = /^\d{10}$/
/** IBAN: SA + 22 chars, or generic 2-letter-country IBAN */
const RE_IBAN_SA = /^SA\d{22}$/i
const RE_IBAN_GENERIC = /^[A-Z]{2}\d{2}[A-Z0-9]{10,26}$/
/** SWIFT/BIC: 8 or 11 chars, uppercase alnum (always uppercase in practice) */
const RE_SWIFT = /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/
/** Email */
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
/** Phone: optional +, digits/space/parens/dashes */
const RE_PHONE = /^\+?[\d\s().-]{7,20}$/
/** Document references: contains INV- / PO- / CRN- / DBN- / QTN- / AGR- */
const RE_DOC_REFERENCE = /\b(inv|po|crn|dbn|qtn|agr)\s*-\s*\w+/i

/** True when the text needs no translation (returned unchanged, 'skipped'). */
export function shouldSkipTranslation(text: string): boolean {
  const t = text.trim()
  if (!t) return true
  if (RE_PURE_NUMBER.test(t)) return true
  if (RE_CURRENCY_AMOUNT.test(t) || RE_CURRENCY_AMOUNT_SUFFIX.test(t)) return true
  if (RE_ISO_DATE.test(t) || RE_SLASH_DATE.test(t)) return true
  if (RE_VAT_NUMBER.test(t) || RE_CR_NUMBER.test(t)) return true
  if (RE_IBAN_SA.test(t) || RE_IBAN_GENERIC.test(t)) return true
  if (RE_SWIFT.test(t)) return true
  if (RE_EMAIL.test(t)) return true
  if (RE_PHONE.test(t)) return true
  if (RE_DOC_REFERENCE.test(t)) return true
  // Mostly digits/punctuation (e.g. "#103", "A-102", "10/2"): ≤2 letters remain
  const letters = t.replace(/[^A-Za-z\u0600-\u06FF]/g, '')
  const digits = (t.match(/\d/g) ?? []).length
  if (digits >= 1 && letters.length <= 2) return true
  // Already Arabic-dominant — nothing to translate
  const arabic = (t.match(/[\u0600-\u06FF]/g) ?? []).length
  if (arabic > 0 && arabic / Math.max(1, t.replace(/\s/g, '').length) >= 0.3) return true
  return false
}

// ── Step 2: glossary ────────────────────────────────────────────────────────

type GlossaryPair = { lower: string; termEn: string; termAr: string }

async function loadGlossary(): Promise<GlossaryPair[]> {
  const rows = await db.glossaryTerm.findMany({ select: { termEn: true, termAr: true } })
  return rows.map((r) => ({ lower: r.termEn.trim().toLowerCase(), termEn: r.termEn, termAr: r.termAr }))
}

/**
 * Longest-first glossary substitution on word-ish boundaries.
 * Returns the substituted text and whether EVERY word got covered.
 */
function applyGlossary(text: string, glossary: GlossaryPair[]): { text: string; fullyCovered: boolean } {
  if (glossary.length === 0) return { text, fullyCovered: false }
  const sorted = [...glossary].sort((a, b) => b.lower.length - a.lower.length)
  let current = ` ${text} `
  let replaced = false
  for (const g of sorted) {
    if (!g.lower) continue
    // word-boundary-ish matching (non-letter neighbors), case-insensitive
    const pattern = new RegExp(
      `(?<![A-Za-z\\u0600-\\u06FF])${g.lower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z\\u0600-\\u06FF])`,
      'gi'
    )
    if (pattern.test(current)) {
      current = current.replace(pattern, g.termAr)
      replaced = true
    }
  }
  if (!replaced) return { text, fullyCovered: false }
  const out = current.trim()
  // fully covered when nothing but Arabic + punctuation/symbols remains
  const remainingLatin = out.replace(/[^A-Za-z]/g, '')
  return { text: out, fullyCovered: remainingLatin.length === 0 }
}

// ── Step 4: providers ───────────────────────────────────────────────────────

type ProviderConfig = { provider: string; apiKey: string }

async function readProviderConfig(): Promise<ProviderConfig> {
  const rows = await db.setting.findMany({
    where: { key: { in: ['translate_provider', 'translate_api_key'] } },
  })
  const map: Record<string, string> = {}
  for (const r of rows) map[r.key] = r.value
  const provider = map.translate_provider === 'google' || map.translate_provider === 'deepl'
    ? map.translate_provider
    : 'builtin'
  return { provider, apiKey: (map.translate_api_key ?? '').trim() }
}

/** Extract a JSON array from a model reply (handles ```json fences). */
function extractJsonArray(raw: string): unknown {
  let s = raw.trim()
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s)
  if (fence) s = fence[1].trim()
  const start = s.indexOf('[')
  const end = s.lastIndexOf(']')
  if (start === -1 || end === -1 || end <= start) throw new Error('No JSON array found')
  return JSON.parse(s.slice(start, end + 1))
}

/** One batched builtin (z-ai sdk) call for all remaining entries. */
async function translateWithBuiltin(
  entries: { key: string; text: string; context?: string }[],
  glossary: GlossaryPair[]
): Promise<Map<string, string>> {
  const zai = await ZAI.create()
  const glossaryBlock = glossary.length
    ? `\nApproved glossary (EN → AR) — these mappings are mandatory wherever the English term appears:\n${glossary
        .slice(0, 120)
        .map((g) => `- ${g.termEn} → ${g.termAr}`)
        .join('\n')}`
    : ''

  const system = `You are an expert English→Arabic translator for official Saudi tax invoices of a construction manpower supply company. Translate into formal business Arabic (فصحى) using construction/manpower industry terminology. Keep numbers, codes and references as-is. Some input texts may already contain Arabic glossary translations — keep those exactly as they are and translate only the remaining English around them.${glossaryBlock}`

  const user = `Translate the "text" of every object in this JSON array from English to Arabic. Return a STRICT JSON array — nothing else, no markdown, no commentary — of objects exactly like [{"key":"<same key>","ar":"<Arabic translation>"}]:\n${JSON.stringify(
    entries.map((e) => ({ key: e.key, text: e.text, context: e.context ?? 'generic' }))
  )}`

  const call = async (extraInstruction: string) => {
    const r = await zai.chat.completions.create({
      messages: [
        { role: 'assistant', content: system },
        { role: 'user', content: extraInstruction ? `${user}\n\n${extraInstruction}` : user },
      ],
      thinking: { type: 'disabled' },
    })
    return r.choices[0]?.message?.content ?? ''
  }

  let raw = ''
  try {
    raw = await call('')
    return parseBuiltinResults(raw, entries)
  } catch {
    // one retry demanding pure JSON, then give up gracefully
    raw = await call('Return ONLY valid JSON — no explanation, no markdown fences.')
    return parseBuiltinResults(raw, entries)
  }
}

function parseBuiltinResults(
  raw: string,
  entries: { key: string; text: string }[]
): Map<string, string> {
  const parsed = extractJsonArray(raw)
  if (!Array.isArray(parsed)) throw new Error('Parsed JSON is not an array')
  const validKeys = new Set(entries.map((e) => e.key))
  const out = new Map<string, string>()
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue
    const obj = item as { key?: unknown; ar?: unknown }
    if (typeof obj.key !== 'string' || typeof obj.ar !== 'string') continue
    if (!validKeys.has(obj.key)) continue
    if (!obj.ar.trim()) continue
    out.set(obj.key, obj.ar.trim())
  }
  if (out.size === 0) throw new Error('No usable translations in model reply')
  return out
}

/** Google Cloud Translation v2 (batched). */
async function translateWithGoogle(
  entries: { key: string; text: string }[],
  apiKey: string
): Promise<Map<string, string>> {
  const res = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: entries.map((e) => e.text), source: 'en', target: 'ar', format: 'text' }),
  })
  if (!res.ok) throw new Error(`Google Translate HTTP ${res.status}`)
  const json = (await res.json()) as {
    data?: { translations?: { translatedText?: string }[] }
  }
  const translations = json.data?.translations ?? []
  const out = new Map<string, string>()
  entries.forEach((e, i) => {
    const t = translations[i]?.translatedText?.trim()
    if (t) out.set(e.key, t)
  })
  if (out.size === 0) throw new Error('Google Translate returned no translations')
  return out
}

/** DeepL free API (batched). */
async function translateWithDeepl(
  entries: { key: string; text: string }[],
  apiKey: string
): Promise<Map<string, string>> {
  const res = await fetch('https://api-free.deepl.com/v2/translate', {
    method: 'POST',
    headers: { Authorization: `DeepL-Auth-Key ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: entries.map((e) => e.text), target_lang: 'AR' }),
  })
  if (!res.ok) throw new Error(`DeepL HTTP ${res.status}`)
  const json = (await res.json()) as { translations?: { text?: string }[] }
  const translations = json.translations ?? []
  const out = new Map<string, string>()
  entries.forEach((e, i) => {
    const t = translations[i]?.text?.trim()
    if (t) out.set(e.key, t)
  })
  if (out.size === 0) throw new Error('DeepL returned no translations')
  return out
}

// ── Memory ──────────────────────────────────────────────────────────────────

async function memoryLookup(sourceText: string, context: string): Promise<string | null> {
  // exact (sourceText, context) first, then the generic bucket
  const hit =
    (await db.translationMemory.findUnique({
      where: { sourceText_fieldContext: { sourceText, fieldContext: context } },
    })) ??
    (context !== 'generic'
      ? await db.translationMemory.findUnique({
          where: { sourceText_fieldContext: { sourceText, fieldContext: 'generic' } },
        })
      : null)
  if (!hit) return null
  await db.translationMemory
    .update({ where: { id: hit.id }, data: { usageCount: { increment: 1 } } })
    .catch(() => {})
  return hit.translatedText
}

async function memorySave(sourceText: string, translatedText: string, context: string): Promise<void> {
  await db.translationMemory
    .upsert({
      where: { sourceText_fieldContext: { sourceText, fieldContext: context } },
      update: { translatedText, usageCount: { increment: 1 } },
      create: { sourceText, translatedText, fieldContext: context, usageCount: 1 },
    })
    .catch(() => {})
}

// ── Pipeline entry point ────────────────────────────────────────────────────

/**
 * Translate a batch of English entries to Arabic. NEVER throws — provider
 * failures come back as source:'failed' plus a single providerError string.
 */
export async function translateEntries(entries: TranslateEntry[]): Promise<{
  results: TranslateResult[]
  providerError?: string
}> {
  const results: TranslateResult[] = []
  // keyed by original entry index for provider batching
  const pending = new Map<number, { key: string; text: string; context: string }>()

  const glossary = await loadGlossary()

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    const text = (e.text ?? '').trim()
    const context = (e.context ?? 'generic').trim() || 'generic'
    const key = e.key

    // 1. Skip guard
    if (shouldSkipTranslation(text)) {
      results[i] = { key, translated: '', source: 'skipped' }
      continue
    }

    // 2. Glossary — exact match first
    const exact = glossary.find((g) => g.lower === text.toLowerCase())
    if (exact) {
      results[i] = { key, translated: exact.termAr, source: 'glossary' }
      continue
    }

    // 3. Memory (before glossary substitution so identical raw text reuses)
    const remembered = await memoryLookup(text, context)
    if (remembered) {
      results[i] = { key, translated: remembered, source: 'memory' }
      continue
    }

    // 2b. Glossary phrase substitution for longer texts
    const sub = applyGlossary(text, glossary)
    if (sub.fullyCovered) {
      results[i] = { key, translated: sub.text, source: 'glossary' }
      continue
    }

    pending.set(i, { key, text: sub.text, context })
  }

  // 4. Provider — one batched call for everything still pending
  let providerError: string | undefined
  if (pending.size > 0) {
    const list = [...pending.entries()].map(([idx, p]) => ({ idx, ...p }))
    try {
      const cfg = await readProviderConfig()
      let translated: Map<string, string>
      if (cfg.provider === 'google') {
        if (!cfg.apiKey) throw new Error('Google Translate is selected but no API key is configured (Settings → E-Invoice)')
        translated = await translateWithGoogle(list, cfg.apiKey)
      } else if (cfg.provider === 'deepl') {
        if (!cfg.apiKey) throw new Error('DeepL is selected but no API key is configured (Settings → E-Invoice)')
        translated = await translateWithDeepl(list, cfg.apiKey)
      } else {
        translated = await translateWithBuiltin(list, glossary)
      }

      const saves: Promise<void>[] = []
      for (const [idx, p] of pending) {
        const ar = translated.get(p.key)
        if (ar) {
          results[idx] = { key: p.key, translated: ar, source: 'provider' }
          saves.push(memorySave(entries[idx].text.trim(), ar, p.context))
        } else {
          results[idx] = { key: p.key, translated: '', source: 'failed' }
        }
      }
      await Promise.all(saves)
      if ([...pending.values()].every((p) => !translated.has(p.key))) {
        providerError = 'The translation service returned no usable translations'
      }
    } catch (err) {
      // graceful degradation — never throw
      for (const [idx, p] of pending) {
        results[idx] = { key: p.key, translated: '', source: 'failed' }
      }
      providerError = err instanceof Error ? err.message : 'Translation provider failed'
    }
  }

  return { results, ...(providerError ? { providerError } : {}) }
}

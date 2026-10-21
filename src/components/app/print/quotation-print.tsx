'use client'

// Quotation print preview — the boss's "Quotation Mirror" A4 portrait template
// (upload/Quotation_Mirror (1).png), the same design family as the E-Invoice
// Mirror document:
//
//   • Striped letterhead placeholder zones (top 35mm / bottom 22mm, bilingual
//     captions) — replaced by the uploaded letterhead artwork when configured.
//   • 3-part title row: QUOTATION + gold subject subtitle left · navy pill
//     badge with a gold ring holding the quotation number centre · "Prepared
//     for" + client name right.
//   • Gold rule broken by a centre diamond.
//   • Cream date & currency bar (Date · Valid Until · Your Reference ·
//     Currency) with bilingual labels.
//   • FROM ◆ | TO ◆ cards (cream headers, white bodies, dotted field rows).
//   • Cream project info strip (Project/Site · Mobilization · Contract
//     Period · Working Hours).
//   • Centred quotation heading + polite intro, then the items table — navy
//     header with white English over gold Arabic two-line headers, gold-ring
//     index circles, horizontal-only row separators, subtle zebra. Hourly
//     manpower quotes use the mirror's 5-column set (# · Trade/Category ·
//     No. of Workers · Hourly Rate · Amount) with the workers/amount total
//     row and the "Amount = Workers × Rate × hours" note; generic quotes
//     fall back to Description/Qty/Unit/Unit Price/Line Total.
//   • SCOPE & TERMS ◆ card (Included in rates | Not included sub-columns +
//     auto-numbered terms) beside the FINANCIAL SUMMARY box (navy TOTAL row
//     with a gold amount + Contract Value), with the bilingual amount-in-
//     words line under the split.
//   • APPROVED BY | ACCEPTED BY signature boxes with dashed gold stamp
//     circles, and a "Page X of Y | صفحة X من Y" footer on every page.
//
// Pagination keeps the proven FLOW-FILL model: EXPLICIT A4 pages (210 ×
// 296.5mm — the 0.5mm slack prevents blank interleaved pages in Chrome's
// print pipeline), a conservative row-height estimator chunks items across
// pages, the thead repeats on every page, the tail (scope/summary split →
// signatures) flows block-by-block onto the last items page while it fits
// and continues on a fresh page from the TOP (signatures are never stranded
// alone), and each page's leftover room is handed back to its item rows so
// short documents fill the A4 nicely. Signature/stamp assets placed with the
// AssetPlacer canvas render on the last page at their saved coordinates.
import { Printer, FileSpreadsheet, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { usePageRule } from '@/components/app/print/print-page-rule'
import { amountInWordsBoth } from '@/lib/arabic-words'
import { formatMoney, formatNumber, round2 } from '@/lib/format'
import { useAppStore } from '@/lib/store'
import type {
  AppSettings,
  DocItemRow,
  LetterheadConfig,
  QuotationRow,
} from '@/lib/types'

/** Full quotation as returned by GET /api/quotations/[id] (items + client + assets). */
export type QuotationDetail = QuotationRow & {
  itemCount?: number
  client?: {
    id: string
    name: string
    contactPerson: string | null
    phone: string | null
    email: string | null
    address: string | null
    city: string | null
    crNumber: string | null
    vatNumber: string | null
  } | null
}

const DEFAULT_LETTERHEAD: LetterheadConfig = {
  mode: 'none',
  headerImage: null,
  footerImage: null,
  fullPageImage: null,
  showCompanyDetails: true,
  headerHeightMm: 30,
  footerHeightMm: 18,
}

export { DEFAULT_LETTERHEAD }

// ── Brand palette (same family as the E-Invoice Mirror module) ──────────────
const NAVY = '#132A4A'
const DARK_NAVY = '#0C1D33'
const GOLD = '#C0934C'
const LIGHT_GOLD = '#E1B169'
const DARK_GOLD = '#8E6420'
const LIGHT_BG = '#F2F5FA'
const BORDER = '#DDE3EC'
const ROW_SEP = '#E8ECF2'
const MUTED = '#6B7488'
// warm cream — the template's soft beige for bars and card headers
const CREAM = '#FBF9F3'
// striped letterhead placeholder hatching + caption tone
const STRIPE_A = '#F3F5F8'
const STRIPE_CAPTION = '#9AA5B5'

const DOC_FONT = "'Cairo', 'Tajawal', 'Segoe UI', Tahoma, sans-serif"

// ── A4 pagination geometry ──────────────────────────────────────────────────
const PAGE_W_MM = 210
const PAGE_H_MM = 296.5 // 0.5mm print-pipeline slack (see header comment)
const SIDE_PAD_MM = 8
const FOOTER_MM = 4 // page footer strip reserved above the bottom letterhead band
// "continued" strip reserved at the top of every page ≥ 2
const CONT_HEADER_MM = 8
// head-room required before a tail block may join the last items page
const PLACE_BUFFER_MM = 4
// slack kept in reserve when stretching rows (estimator safety)
const STRETCH_SAFE_MM = 5
// per-row stretch cap — keeps the stretched table tasteful
const MAX_ROW_STRETCH = 6.5
// items-table TOTAL row height
const TOTAL_ROW_MM = 6
// final-page slack tiers above which the tail breathes more
const ROOMY_SLACK_MM = 30 // tier 1 — roomier paddings/lines
const EXPANSIVE_SLACK_MM = 70 // tier 2 — grand signature area for sparse pages
// extra tail height per tier (over-estimate keeps row-stretch math safe)
const ROOMY_TAIL_DELTA = [0, 10, 26] as const

/** Arabic names for the currency cell of the date & currency bar. */
const CURRENCY_AR: Record<string, string> = {
  SAR: 'ريال سعودي',
  USD: 'دولار أمريكي',
  EUR: 'يورو',
  GBP: 'جنيه إسترليني',
  AED: 'درهم إماراتي',
}

/** DD / MM / YYYY — the mirror template's date format. */
function fmtDate(d: string | null | undefined): string {
  if (!d) return '—'
  const date = new Date(d)
  if (isNaN(date.getTime())) return '—'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(date.getDate())} / ${pad(date.getMonth() + 1)} / ${date.getFullYear()}`
}

/** Wrapped line count for a text block at ~charsPerLine characters per line. */
function estLines(text: string | null | undefined, charsPerLine: number): number {
  if (!text) return 0
  return text
    .split('\n')
    .reduce((n, line) => n + Math.max(1, Math.ceil(line.trim().length / charsPerLine)), 0)
}

/** Conservative table-row height estimate in mm (over-estimate = safe page breaks). */
function rowHeightMm(it: DocItemRow): number {
  // Trade / Description column ≈ 40% × 194mm ≈ 78mm ≈ 60 latin chars at
  // 8.5px — 48/56 keeps a safety margin against wrap drift. Compact mirror
  // rows: bold trade line + small grey sub-line ≈ 5.7mm rendered.
  const lines = Math.max(1, Math.ceil(it.description.length / 48))
  const subLines = it.subText ? Math.max(1, Math.ceil(it.subText.length / 56)) : 0
  return 4.2 + 2.4 * (lines - 1) + 2.0 * subLines
}

/** Split a bullet-list text into trimmed non-empty lines. */
function bulletLines(text: string | null | undefined): string[] {
  if (!text) return []
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
}

/**
 * Terms lines with automatic numbering — lines that already start with
 * "1." / "2)" keep their own number, plain lines get one assigned.
 */
function numberedTerms(terms: string): Array<{ n: string; text: string }> {
  const lines = terms
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  let auto = 0
  return lines.map((l) => {
    const m = /^(\d{1,2})[.)]\s*(.+)$/.exec(l)
    if (m) return { n: `${m[1]}.`, text: m[2] }
    auto += 1
    return { n: `${auto}.`, text: l }
  })
}

/** Bilingual label: English left, Arabic right (rtl). */
function BiLabel({ en, ar, center }: { en: string; ar: string; center?: boolean }) {
  return (
    <span
      className={`flex gap-1.5 text-[7px] font-semibold uppercase leading-tight tracking-[0.08em] ${center ? 'justify-center' : ''}`}
      style={{ color: MUTED }}
    >
      <span>{en}</span>
      <span className="text-neutral-300">|</span>
      <span lang="ar" dir="rtl" className="normal-case tracking-normal">
        {ar}
      </span>
    </span>
  )
}

/** Small solid gold diamond — the template's recurring ornament. */
function GoldDiamond({ size = 5 }: { size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-block shrink-0 rotate-45"
      style={{ width: `${size}px`, height: `${size}px`, background: GOLD }}
    />
  )
}

/** Rotated status stamp chip — floats over the letterhead zone's bottom-right
 *  corner (page-level absolute), clear of the document content. */
function StatusStamp({ status }: { status: string }) {
  const map: Record<string, { label: string; border: string; color: string }> = {
    draft: { label: 'DRAFT', border: '#737373', color: '#525252' },
    sent: { label: 'SENT', border: '#d97706', color: '#b45309' },
    accepted: { label: 'ACCEPTED', border: '#059669', color: '#047857' },
    rejected: { label: 'REJECTED', border: '#e11d48', color: '#be123c' },
    expired: { label: 'EXPIRED', border: '#a16207', color: '#854d0e' },
  }
  const entry = map[status] ?? map.draft
  return (
    <span
      className="inline-block rounded border-[2.5px] bg-white/95 px-2 py-px text-[8px] font-black uppercase tracking-[0.18em] shadow-[inset_0_0_0_1.5px_rgba(0,0,0,0.06)]"
      style={{ borderColor: entry.border, color: entry.color, transform: 'rotate(-3deg)' }}
    >
      {entry.label}
    </span>
  )
}

// ── Flow-fill pagination ────────────────────────────────────────────────────

/** Tail sections that flow after the items table, in document order. */
type TailBlock = 'scopeSummary' | 'signatures'

/** One explicit A4 page: its item chunk, stretched row height and tail blocks. */
type PagePlan = {
  items: DocItemRow[]
  /** extra mm given to every item row on this page (fills the A4 nicely) */
  rowExtraMm: number
  /** tail blocks rendered on this page, in order */
  blocks: TailBlock[]
  /** final-page roominess tier: 0 compact · 1 roomy · 2 expansive */
  roomyTier: 0 | 1 | 2
}

/**
 * Flow-fill pagination:
 *   1. chunk items across pages (conservative row estimates → safe breaks);
 *   2. flow the tail blocks, in order, onto the last items page while they
 *      fit (with a placement buffer); the rest continues on a fresh page
 *      that starts at the TOP — signatures never strand alone on a page;
 *   3. hand each page's leftover room back to its item rows (capped), so
 *      pages fill nicely instead of ending two-thirds down;
 *   4. flag a sparse final page so the bottom sections can breathe.
 */
function planPages(
  items: DocItemRow[],
  topMm: number,
  bottomMm: number,
  page1FixedMm: number,
  blockH: Record<TailBlock, number>
): PagePlan[] {
  const availFirst = PAGE_H_MM - topMm - (bottomMm + FOOTER_MM) - page1FixedMm
  const availRest = PAGE_H_MM - topMm - (bottomMm + FOOTER_MM) - CONT_HEADER_MM

  // 1) chunk items
  const chunks: DocItemRow[][] = []
  let cur: DocItemRow[] = []
  let used = 0
  let limit = availFirst
  for (const it of items) {
    const h = rowHeightMm(it)
    if (used + h > limit && cur.length > 0) {
      chunks.push(cur)
      cur = []
      used = 0
      limit = availRest
    }
    cur.push(it)
    used += h
  }
  chunks.push(cur)

  // 2) flow tail blocks onto the last items page while they fit
  const cap = chunks.length === 1 ? availFirst : availRest
  const order: TailBlock[] = ['scopeSummary', 'signatures']
  const blocks: TailBlock[] = []
  const deferred: TailBlock[] = []
  let flowing = true
  for (const b of order) {
    if (flowing && used + TOTAL_ROW_MM + blockH[b] + PLACE_BUFFER_MM <= cap) {
      blocks.push(b)
      used += blockH[b]
    } else {
      flowing = false
      deferred.push(b)
    }
  }
  // signatures should not be stranded alone on a fresh page
  if (deferred.length === 1 && deferred[0] === 'signatures' && blocks.length > 0) {
    deferred.unshift(blocks.pop() as TailBlock)
  }

  const pages: PagePlan[] = chunks.map((c) => ({
    items: c,
    rowExtraMm: 0,
    blocks: [] as TailBlock[],
    roomyTier: 0 as const,
  }))
  pages[pages.length - 1].blocks = blocks
  if (deferred.length > 0) {
    pages.push({ items: [], rowExtraMm: 0, blocks: deferred, roomyTier: 0 })
  }

  // 3) sparse final page → roomier tail tier (only when the extra height fits)
  const fin = pages[pages.length - 1]
  const finCap = pages.length === 1 ? availFirst : availRest
  const finRows =
    fin.items.reduce((s, it) => s + rowHeightMm(it), 0) + (fin.items.length ? TOTAL_ROW_MM : 0)
  const finBlocks = fin.blocks.reduce((s, b) => s + blockH[b], 0)
  const finSlack = finCap - finRows - finBlocks
  fin.roomyTier = finSlack > EXPANSIVE_SLACK_MM ? 2 : finSlack > ROOMY_SLACK_MM ? 1 : 0
  const tailDelta = ROOMY_TAIL_DELTA[fin.roomyTier]

  // 4) give leftover room back to the rows (fills the A4 nicely)
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i]
    if (p.items.length === 0) continue
    const pageCap = i === 0 ? availFirst : availRest
    const rowsMm = p.items.reduce((s, it) => s + rowHeightMm(it), 0) + TOTAL_ROW_MM
    const blocksMm =
      p.blocks.reduce((s, b) => s + blockH[b], 0) + (p === fin ? tailDelta : 0)
    const slack = pageCap - rowsMm - blocksMm
    if (slack > STRETCH_SAFE_MM) {
      p.rowExtraMm = Math.min((slack - STRETCH_SAFE_MM) / p.items.length, MAX_ROW_STRETCH)
    }
  }

  return pages
}

// ── Letterhead geometry ─────────────────────────────────────────────────────
// 'none' (default) renders the mirror template's striped placeholder zones at
// the full 35/22mm; artwork modes honour the configured heights instead.
function geometryFor(letterhead: LetterheadConfig): { topMm: number; bottomMm: number } {
  const hasFull = letterhead.mode === 'full' && letterhead.fullPageImage
  const hasHeader =
    (letterhead.mode === 'header' || letterhead.mode === 'header_footer') &&
    letterhead.headerImage
  const hasFooter = letterhead.mode === 'header_footer' && letterhead.footerImage
  if (hasFull) {
    return {
      topMm: letterhead.headerHeightMm + 4,
      bottomMm: Math.max(letterhead.footerHeightMm + 4, 12),
    }
  }
  if (hasHeader && hasFooter) {
    return { topMm: letterhead.headerHeightMm + 3, bottomMm: letterhead.footerHeightMm + 3 }
  }
  if (hasHeader) {
    return { topMm: letterhead.headerHeightMm + 3, bottomMm: 12 }
  }
  // 'none' — the boss's mockup: striped zones, top 35mm / bottom 22mm
  return { topMm: 35, bottomMm: 22 }
}

/**
 * Full-screen dialog rendering the paginated A4 quotation.
 * Purely presentational — the parent supplies the company letterhead config
 * (fetched in its open/preview event handlers) and the quotation document.
 * Print button calls window.print() — only the `.print-area` is printed.
 */
export function QuotationPrintDialog({
  quotation,
  letterhead,
  open,
  onOpenChange,
}: {
  quotation: QuotationDetail | null
  letterhead?: LetterheadConfig | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const settings = useAppStore((s) => s.settings)
  const user = useAppStore((s) => s.user)

  usePageRule(open, 'size: A4 portrait; margin: 0;')

  const isDraft = !quotation || quotation.id === 'draft'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[92vh] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-[900px] print:static print:max-h-none print:w-full print:max-w-none print:translate-x-0 print:translate-y-0 print:overflow-visible print:rounded-none print:border-0 print:p-0 print:shadow-none"
      >
        <DialogTitle className="sr-only">Quotation print preview</DialogTitle>
        <DialogDescription className="sr-only">
          Printable A4 quotation with letterhead zones, mirror title row, party cards, line items, scope and terms, financial summary, signature and stamp boxes.
        </DialogDescription>

        {/* Top button bar — hidden when printing */}
        <div className="print-hidden flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">
              {quotation ? `Quotation — ${quotation.quoteNumber}` : 'Quotation'}
              {isDraft && quotation ? (
                <span className="ml-2 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-700">
                  Draft preview
                </span>
              ) : null}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              A4 · Mirror template · EN/AR labels
              {quotation
                ? ` · ${quotation.clientName} · ${formatMoney(quotation.total, settings.currency || 'SAR')}`
                : ''}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {!isDraft ? (
              <Button variant="outline" size="sm" asChild>
                <a href={`/api/quotations/${quotation?.id}/excel`} download>
                  <FileSpreadsheet className="h-4 w-4" />
                  Excel
                </a>
              </Button>
            ) : null}
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              <X className="h-4 w-4" />
              Close
            </Button>
            <Button size="sm" onClick={() => window.print()} disabled={!quotation}>
              <Printer className="h-4 w-4" />
              Print / Save as PDF
            </Button>
          </div>
        </div>

        {/* Scrollable preview area — stacked A4 pages */}
        <div className="nice-scrollbar min-h-0 flex-1 overflow-auto bg-neutral-100 p-4 dark:bg-neutral-900 print:flex-none print:overflow-visible print:bg-transparent print:p-0">
          {quotation ? (
            <QuotationDocument
              quotation={quotation}
              letterhead={letterhead ?? DEFAULT_LETTERHEAD}
              settings={settings}
              preparedBy={user?.name ?? ''}
            />
          ) : (
            <div className="flex min-h-[300px] items-center justify-center bg-white p-16 text-sm text-neutral-400">
              No quotation selected.
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── The document ────────────────────────────────────────────────────────────

export function QuotationDocument({
  quotation,
  letterhead,
  settings,
  preparedBy,
}: {
  quotation: QuotationDetail
  letterhead: LetterheadConfig
  settings: AppSettings
  preparedBy: string
}) {
  const currency = settings.currency || 'SAR'
  const q = quotation
  const companyName = settings.companyName || 'Landmark Inter Gulf'
  const client = q.client
  const vatPercent = Math.round(q.vatRate * 100)
  const items = q.items ?? []
  const assets = (q.assets ?? []).filter((a) => a.visible)
  const netTotal = round2(q.subtotal - q.discount)
  const money = (n: number) => formatNumber(n) // template style: plain numbers — SAR lives in headers only
  const geo = geometryFor(letterhead)

  // Hourly manpower quotes get the mirror's 5-column card, others go generic
  const hasRateBasis = items.some((it) => it.ratePerHour != null || it.hoursPerMonth != null)
  const showDiscountCol = items.some((it) => (it.discount ?? 0) > 0) || q.discount > 0
  const totalWorkers = round2(items.reduce((s, it) => s + (hasRateBasis ? it.quantity : 0), 0))
  const inclusions = bulletLines(q.inclusions)
  const exclusions = bulletLines(q.exclusions)
  const terms = q.terms ? numberedTerms(q.terms) : []
  const contractMonths = q.contractMonths && q.contractMonths > 0 ? q.contractMonths : null
  const contractValue = contractMonths ? round2(q.total * contractMonths) : null
  const subjectLine = (q.subject || 'Manpower Supply Proposal').toUpperCase()
  const words = amountInWordsBoth(q.total, currency)
  const currencyAr = CURRENCY_AR[currency] ?? ''
  const printedAt = new Date()

  // uniform hours/month across hourly lines → drives the working-hours cell
  // and the "Amount = …" calculation note under the table
  const hoursVals = items
    .map((it) => it.hoursPerMonth)
    .filter((h): h is number => h != null && h > 0)
  const uniformHours =
    hoursVals.length > 0 && hoursVals.every((h) => h === hoursVals[0]) ? hoursVals[0] : null
  const workingHoursLabel = uniformHours
    ? uniformHours === 260
      ? '10 hrs × 26 days'
      : `${uniformHours} hrs / month`
    : hoursVals.length > 0
      ? 'As per trade'
      : '—'
  const contractPeriodLabel =
    q.contractPeriod || (contractMonths ? `${contractMonths} Months` : '—')

  // ── pagination ──
  // Page-1 fixed sections (title row + rule + date bar + cards + project
  // strip + heading + thead + gaps), calibrated against real Chrome A4
  // renders of the compacted mirror layout. The two party cards sit
  // side-by-side → only the TALLER card's wraps count.
  const fromAddress = settings.address || ''
  const toAddress = [client?.address, client?.city].filter(Boolean).join(', ')
  // card base ≈ 26.5mm (header + name + AR name + first line of each field);
  // each ADDITIONAL wrapped address line adds ~2.4mm; the TO card's Attention
  // row counts as one extra line. Only the TALLER card's wraps matter.
  const fromExtra = Math.max(0, estLines(fromAddress, 50) - 1)
  const toExtra = Math.max(0, estLines(toAddress, 50) - 1) + (client?.contactPerson ? 1 : 0)
  const cardsMm = 26.5 + 2.4 * Math.max(fromExtra, toExtra)
  const projectBarMm =
    9.5 +
    2.2 *
      Math.max(
        estLines(q.projectName, 20),
        estLines(q.projectLocation, 24),
        estLines(q.mobilization, 20),
        estLines(contractPeriodLabel, 20),
        estLines(workingHoursLabel, 20)
      )
  const page1FixedMm =
    10 + // title row
    3.5 + // gold rule
    10.5 + // date & currency bar
    cardsMm +
    projectBarMm +
    (hasRateBasis ? 6.5 : 5) + // centred heading + intro line
    7 + // two-line bilingual thead
    3 + // calculation note
    4 // inter-section margins

  // Tail block heights (over-estimate = safe breaks)
  const termsLines = terms.reduce((n, t) => n + estLines(t.text, 78), 0)
  const notesLines = estLines(q.notes, 78)
  const incLines = inclusions.reduce((n, l) => n + estLines(l, 34), 0)
  const excLines = exclusions.reduce((n, l) => n + estLines(l, 34), 0)
  const scopeMm =
    4.5 + // cream header
    3 + // included/not-included sub-headers
    Math.max(incLines, excLines) * 3 +
    2.5 + // dotted divider + padding
    termsLines * 3.3 +
    3.5 +
    (q.notes ? 4 + notesLines * 3.3 : 0) +
    2.5
  const summaryMm =
    (2 + (q.discount > 0 ? 2 : 0)) * 5.8 + // subtotal (+ discount + net)
    9.5 + // navy TOTAL / MONTH row
    (contractMonths ? 8.3 : 0) + // contract value row + sub-line
    5
  const blockH: Record<TailBlock, number> = {
    scopeSummary: Math.max(scopeMm, summaryMm) + 2.5 + 4, // + gap + words line
    signatures: 30,
  }

  const plans = planPages(items, geo.topMm, geo.bottomMm, page1FixedMm, blockH)
  // The last page that actually carries items — the table's TOTAL row goes there
  const lastItemsPageIdx = plans.reduce((acc, p, i) => (p.items.length > 0 ? i : acc), 0)

  // letterhead artwork layers (per the configured mode)
  const hasFullArt = letterhead.mode === 'full' && letterhead.fullPageImage
  const hasHeaderArt =
    (letterhead.mode === 'header' || letterhead.mode === 'header_footer') && letterhead.headerImage
  const hasFooterArt = letterhead.mode === 'header_footer' && letterhead.footerImage

  // table cell styles — mirror table: navy header (white EN over gold AR),
  // horizontal-only row separators, no vertical body lines.
  const th = 'px-1 py-[1px] text-center align-middle leading-[1.2]'
  const td = 'px-1 py-[1.5px] align-top text-[8.5px] leading-[1.25] text-neutral-900'
  const tdR = `${td} text-right tabular-nums`

  return (
    <div
      className="print-area mx-auto flex w-full flex-col items-center gap-6 bg-transparent [print-color-adjust:exact] [-webkit-print-color-adjust:exact] print:gap-0"
      style={{ fontFamily: DOC_FONT }}
    >
      {plans.map((plan, pageIdx) => {
        const chunk = plan.items
        const isLast = pageIdx === plans.length - 1
        return (
          <div
            key={pageIdx}
            className="doc-page relative shrink-0 overflow-hidden bg-white text-neutral-900 shadow-sm print:shadow-none"
            style={{
              width: `${PAGE_W_MM}mm`,
              height: `${PAGE_H_MM}mm`,
              breakAfter: isLast ? 'auto' : 'page',
              breakInside: 'avoid',
            }}
          >
            {/* ── letterhead artwork (configured modes) ── */}
            {hasFullArt ? (
              <img
                src={letterhead.fullPageImage as string}
                alt=""
                aria-hidden
                className="pointer-events-none absolute inset-0 z-0 h-full w-full object-fill"
              />
            ) : (
              <>
                {hasHeaderArt ? (
                  <img
                    src={letterhead.headerImage as string}
                    alt=""
                    aria-hidden
                    className="pointer-events-none absolute left-0 top-0 z-0 w-full object-fill"
                    style={{ height: `${letterhead.headerHeightMm}mm` }}
                  />
                ) : (
                  /* ── striped letterhead placeholder zone (the template look) ── */
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-x-0 top-0 z-0 flex flex-col items-center justify-center gap-[2px]"
                    style={{
                      height: `${geo.topMm}mm`,
                      background: `repeating-linear-gradient(45deg, ${STRIPE_A} 0px, ${STRIPE_A} 5px, #ffffff 5px, #ffffff 11px)`,
                      borderBottom: '1px dashed #C9D2DE',
                    }}
                  >
                    <p
                      className="text-center text-[7.5px] font-semibold uppercase tracking-[0.16em]"
                      style={{ color: STRIPE_CAPTION }}
                    >
                      Letterhead Header Area
                      <span className="mx-1.5 opacity-50">|</span>
                      <span lang="ar" dir="rtl" className="tracking-normal">
                        مساحة رأس الخطاب
                      </span>
                    </p>
                  </div>
                )}
                {hasFooterArt ? (
                  <img
                    src={letterhead.footerImage as string}
                    alt=""
                    aria-hidden
                    className="pointer-events-none absolute bottom-0 left-0 z-0 w-full object-fill"
                    style={{ height: `${letterhead.footerHeightMm}mm` }}
                  />
                ) : letterhead.mode !== 'header' ? (
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-x-0 bottom-0 z-0 flex flex-col items-center justify-center gap-[2px]"
                    style={{
                      height: `${geo.bottomMm}mm`,
                      background: `repeating-linear-gradient(45deg, ${STRIPE_A} 0px, ${STRIPE_A} 5px, #ffffff 5px, #ffffff 11px)`,
                      borderTop: '1px dashed #C9D2DE',
                    }}
                  >
                    <p
                      className="text-center text-[7.5px] font-semibold uppercase tracking-[0.16em]"
                      style={{ color: STRIPE_CAPTION }}
                    >
                      Letterhead Footer Area
                      <span className="mx-1.5 opacity-50">|</span>
                      <span lang="ar" dir="rtl" className="tracking-normal">
                        مساحة ذيل الخطاب
                      </span>
                    </p>
                  </div>
                ) : null}
              </>
            )}

            {/* ── status stamp — over the letterhead zone's bottom-right corner ── */}
            {pageIdx === 0 ? (
              <div
                className="pointer-events-none absolute z-20"
                style={{ top: `${Math.max(geo.topMm - 7, 2)}mm`, right: `${SIDE_PAD_MM}mm` }}
              >
                <StatusStamp status={q.status} />
              </div>
            ) : null}

            {/* ── DRAFT watermark (drafts only — subtle, behind content) ── */}
            {q.status === 'draft' ? (
              <div
                className="pointer-events-none absolute inset-0 z-[5] flex flex-col items-center justify-center gap-10"
                aria-hidden
              >
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="select-none whitespace-nowrap text-[46px] font-black uppercase tracking-[0.3em] text-neutral-400/20"
                    style={{ transform: `rotate(-22deg) scale(${i === 1 ? 1 : 0.55})` }}
                  >
                    DRAFT · <span lang="ar" dir="rtl">مسودة</span>
                  </span>
                ))}
              </div>
            ) : null}

            {/* ── content ── */}
            <div
              className="absolute inset-x-0 top-0 z-10 flex h-full flex-col"
              style={{
                paddingTop: `${geo.topMm}mm`,
                paddingBottom: `${geo.bottomMm + FOOTER_MM}mm`,
                paddingLeft: `${SIDE_PAD_MM}mm`,
                paddingRight: `${SIDE_PAD_MM}mm`,
              }}
            >
              {pageIdx === 0 ? (
                <>
                  {/* 1 ─ title row: QUOTATION + subject · pill badge · prepared for */}
                  <div className="relative flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <h1
                        className="text-[16px] font-extrabold uppercase leading-[1.15] tracking-[0.05em]"
                        style={{ color: NAVY }}
                      >
                        Quotation
                      </h1>
                      <p
                        className="mt-[0.8mm] whitespace-nowrap text-[7px] font-bold uppercase leading-none tracking-[0.2em]"
                        style={{ color: DARK_GOLD }}
                      >
                        {subjectLine}
                      </p>
                    </div>
                    {/* pill badge — gold ring outside, navy fill inside */}
                    <div className="shrink-0 rounded-full p-[2px]" style={{ background: GOLD }}>
                      <div
                        className={`rounded-full px-5 text-center ${plan.roomyTier >= 1 ? 'py-[5px]' : 'py-[3px]'}`}
                        style={{ background: NAVY }}
                      >
                        <p
                          className="whitespace-nowrap text-[6.5px] font-bold uppercase tracking-[0.16em]"
                          style={{ color: LIGHT_GOLD }}
                        >
                          Quotation No.{' '}
                          <span lang="ar" dir="rtl" className="tracking-normal">
                            رقم عرض السعر
                          </span>
                        </p>
                        <p className="whitespace-nowrap font-mono text-[12.5px] font-extrabold leading-tight text-white">
                          {q.quoteNumber}
                        </p>
                      </div>
                    </div>
                    <div className="min-w-0 flex-1 text-right">
                      <p className="text-[7px] font-semibold uppercase tracking-[0.08em]" style={{ color: MUTED }}>
                        Prepared for{' '}
                        <span className="mx-0.5 text-neutral-300">|</span>{' '}
                        <span lang="ar" dir="rtl" className="normal-case tracking-normal">
                          أُعدّ لصالح
                        </span>
                      </p>
                      <p
                        className="mt-[0.6mm] truncate text-[10.5px] font-extrabold leading-tight"
                        style={{ color: NAVY }}
                        title={q.clientName}
                      >
                        {q.clientName}
                      </p>
                    </div>
                  </div>

                  {/* 2 ─ gold rule broken by a centre diamond */}
                  <div className="mt-[5px] flex items-center gap-2">
                    <div className="h-[2px] flex-1 rounded-full" style={{ background: GOLD }} />
                    <GoldDiamond size={6} />
                    <div className="h-[2px] flex-1 rounded-full" style={{ background: GOLD }} />
                  </div>

                  {/* 3 ─ date & currency bar (cream, rounded, 4 cells) */}
                  <div
                    className={`mt-[5px] grid grid-cols-4 overflow-hidden rounded-lg border ${plan.roomyTier >= 1 ? 'mt-2' : ''}`}
                    style={{ borderColor: BORDER, background: CREAM }}
                  >
                    {(
                      [
                        ['Date', 'التاريخ', fmtDate(q.issueDate)],
                        ['Valid Until', 'صالح حتى', fmtDate(q.validityDate)],
                        ['Your Reference', 'مرجعكم', q.referenceNo || '—'],
                        [
                          'Currency',
                          'العملة',
                          currencyAr ? `${currency} · ${currencyAr}` : currency,
                        ],
                      ] as Array<[string, string, string]>
                    ).map(([en, ar, value]) => (
                      <div
                        key={en}
                        className={`border-r px-1.5 text-center last:border-r-0 ${plan.roomyTier >= 1 ? 'py-[7px]' : 'py-[3.5px]'}`}
                        style={{ borderColor: BORDER }}
                      >
                        <BiLabel en={en} ar={ar} center />
                        <p
                          className={`mt-0.5 whitespace-nowrap text-[9.5px] font-bold tabular-nums ${en === 'Currency' || en === 'Your Reference' ? '' : 'font-mono'}`}
                          style={{ color: NAVY }}
                        >
                          {value}
                        </p>
                      </div>
                    ))}
                  </div>

                  {/* 4 ─ FROM ◆ | TO ◆ cards (cream header, dotted field rows) */}
                  <div className={`grid grid-cols-2 gap-2.5 ${plan.roomyTier >= 1 ? 'mt-2' : 'mt-[5px]'}`}>
                    {/* FROM — the company (supplier) */}
                    <div
                      className="overflow-hidden rounded-lg border"
                      style={{ borderColor: BORDER, background: 'white' }}
                    >
                      <div
                        className="flex items-center justify-center gap-2 border-b px-2.5 py-[3.5px]"
                        style={{ borderColor: BORDER, background: CREAM }}
                      >
                        <p
                          className="text-[8.5px] font-extrabold uppercase tracking-[0.18em]"
                          style={{ color: DARK_GOLD }}
                        >
                          From
                        </p>
                        <GoldDiamond size={5} />
                        <p
                          lang="ar"
                          dir="rtl"
                          className="text-[9.5px] font-bold leading-none"
                          style={{ color: DARK_GOLD }}
                        >
                          من
                        </p>
                      </div>
                      <div className={`px-2.5 ${plan.roomyTier >= 1 ? 'space-y-[5px] py-[7px]' : 'space-y-[2px] py-[5px]'}`}>
                        <p className="text-[10px] font-bold leading-snug" style={{ color: NAVY }}>
                          {companyName}
                        </p>
                        {settings.companyNameAr ? (
                          <p
                            lang="ar"
                            dir="rtl"
                            className="text-[9.5px] font-semibold leading-snug"
                            style={{ color: NAVY }}
                          >
                            {settings.companyNameAr}
                          </p>
                        ) : null}
                        <div
                          className={`border-t border-dotted pt-[3px] text-[7.5px] leading-[1.35] ${plan.roomyTier >= 1 ? 'space-y-[4px]' : 'space-y-[2.5px]'}`}
                          style={{ borderColor: '#C7CFDC' }}
                        >
                          <p>
                            <span className="font-semibold" style={{ color: MUTED }}>
                              Address <span lang="ar" dir="rtl">العنوان</span>:{' '}
                            </span>
                            <span className="font-semibold" style={{ color: DARK_NAVY }}>
                              {fromAddress || '—'}
                            </span>
                          </p>
                          <p>
                            <span className="font-semibold" style={{ color: MUTED }}>
                              VAT / C.R. <span lang="ar" dir="rtl">الرقم الضريبي / السجل</span>:{' '}
                            </span>
                            <span className="font-mono font-semibold" style={{ color: DARK_NAVY }}>
                              {settings.vatNumber || '—'}
                              {settings.vatNumber && settings.crNumber ? ' · ' : ''}
                              {settings.crNumber || ''}
                            </span>
                          </p>
                          <p>
                            <span className="font-semibold" style={{ color: MUTED }}>
                              Contact <span lang="ar" dir="rtl">التواصل</span>:{' '}
                            </span>
                            <span className="font-semibold" style={{ color: DARK_NAVY }}>
                              {settings.phone || settings.email
                                ? [settings.phone, settings.email].filter(Boolean).join(' · ')
                                : '—'}
                            </span>
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* TO — the client (customer) */}
                    <div
                      className="overflow-hidden rounded-lg border"
                      style={{ borderColor: BORDER, background: 'white' }}
                    >
                      <div
                        className="flex items-center justify-center gap-2 border-b px-2.5 py-[3.5px]"
                        style={{ borderColor: BORDER, background: CREAM }}
                      >
                        <p
                          className="text-[8.5px] font-extrabold uppercase tracking-[0.18em]"
                          style={{ color: DARK_GOLD }}
                        >
                          To
                        </p>
                        <GoldDiamond size={5} />
                        <p
                          lang="ar"
                          dir="rtl"
                          className="text-[9.5px] font-bold leading-none"
                          style={{ color: DARK_GOLD }}
                        >
                          إلى
                        </p>
                      </div>
                      <div className={`px-2.5 ${plan.roomyTier >= 1 ? 'space-y-[5px] py-[7px]' : 'space-y-[2px] py-[5px]'}`}>
                        <p className="text-[10px] font-bold leading-snug" style={{ color: NAVY }}>
                          {q.clientName}
                        </p>
                        <div
                          className={`border-t border-dotted pt-[3px] text-[7.5px] leading-[1.35] ${plan.roomyTier >= 1 ? 'space-y-[4px]' : 'space-y-[2.5px]'}`}
                          style={{ borderColor: '#C7CFDC' }}
                        >
                          {client?.contactPerson ? (
                            <p>
                              <span className="font-semibold" style={{ color: MUTED }}>
                                Attention <span lang="ar" dir="rtl">عناية</span>:{' '}
                              </span>
                              <span className="font-semibold" style={{ color: DARK_NAVY }}>
                                {client.contactPerson}
                              </span>
                            </p>
                          ) : null}
                          <p>
                            <span className="font-semibold" style={{ color: MUTED }}>
                              Address <span lang="ar" dir="rtl">العنوان</span>:{' '}
                            </span>
                            <span className="font-semibold" style={{ color: DARK_NAVY }}>
                              {toAddress || '—'}
                            </span>
                          </p>
                          <p>
                            <span className="font-semibold" style={{ color: MUTED }}>
                              Contact <span lang="ar" dir="rtl">التواصل</span>:{' '}
                            </span>
                            <span className="font-semibold" style={{ color: DARK_NAVY }}>
                              {client?.phone || client?.email
                                ? [client?.phone, client?.email].filter(Boolean).join(' · ')
                                : '—'}
                            </span>
                          </p>
                          {client?.vatNumber || client?.crNumber ? (
                            <p>
                              <span className="font-semibold" style={{ color: MUTED }}>
                                VAT / C.R. <span lang="ar" dir="rtl">الرقم الضريبي / السجل</span>:{' '}
                              </span>
                              <span className="font-mono font-semibold" style={{ color: DARK_NAVY }}>
                                {client.vatNumber || ''}
                                {client.vatNumber && client.crNumber ? ' · ' : ''}
                                {client.crNumber || ''}
                              </span>
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* 5 ─ project info strip (cream, 4 cells) */}
                  <div
                    className={`grid grid-cols-4 overflow-hidden rounded-lg border ${plan.roomyTier >= 1 ? 'mt-2' : 'mt-[5px]'}`}
                    style={{ borderColor: BORDER, background: CREAM }}
                  >
                    <div
                      className={`border-r px-1.5 text-center ${plan.roomyTier >= 1 ? 'py-[7px]' : 'py-[3.5px]'}`}
                      style={{ borderColor: BORDER }}
                    >
                      <BiLabel en="Project / Site" ar="المشروع / الموقع" center />
                      <p
                        className="mt-0.5 break-words text-[9px] font-bold leading-snug"
                        style={{ color: NAVY }}
                      >
                        {q.projectName || '—'}
                      </p>
                      {q.projectLocation ? (
                        <p className="break-words text-[7.5px]" style={{ color: MUTED }}>
                          {q.projectLocation}
                        </p>
                      ) : null}
                    </div>
                    <div
                      className={`border-r px-1.5 text-center ${plan.roomyTier >= 1 ? 'py-[7px]' : 'py-[3.5px]'}`}
                      style={{ borderColor: BORDER }}
                    >
                      <BiLabel en="Mobilization" ar="التجهيز" center />
                      <p
                        className="mt-0.5 break-words text-[9px] font-semibold leading-snug"
                        style={{ color: NAVY }}
                      >
                        {q.mobilization || '—'}
                      </p>
                    </div>
                    <div
                      className={`border-r px-1.5 text-center ${plan.roomyTier >= 1 ? 'py-[7px]' : 'py-[3.5px]'}`}
                      style={{ borderColor: BORDER }}
                    >
                      <BiLabel en="Contract Period" ar="مدة العقد" center />
                      <p
                        className="mt-0.5 break-words text-[9px] font-semibold leading-snug"
                        style={{ color: NAVY }}
                      >
                        {contractPeriodLabel}
                      </p>
                    </div>
                    <div className={`px-1.5 text-center ${plan.roomyTier >= 1 ? 'py-[7px]' : 'py-[3.5px]'}`}>
                      <BiLabel en="Working Hours" ar="ساعات العمل" center />
                      <p
                        className="mt-0.5 break-words text-[9px] font-semibold leading-snug"
                        style={{ color: NAVY }}
                      >
                        {workingHoursLabel}
                      </p>
                    </div>
                  </div>

                  {/* 6 ─ centred quotation heading + polite intro (mirror) */}
                  <div className="mt-[1.6mm] text-center">
                    <p className="text-[10.5px] font-extrabold leading-tight" style={{ color: NAVY }}>
                      {hasRateBasis
                        ? 'Quotation for Supply of Skilled & Unskilled Manpower'
                        : 'Quotation Details'}
                    </p>
                    {hasRateBasis ? (
                      <p className="mt-[0.8mm] text-[7.5px] italic leading-snug" style={{ color: MUTED }}>
                        Dear Sir, we are pleased to submit our most competitive rates. All workers
                        are experienced, medically fit and hold valid Iqama.
                      </p>
                    ) : null}
                  </div>
                </>
              ) : (
                /* continuation header on EVERY later page (items or tail-only) */
                <div className="flex items-baseline justify-between border-b pb-[3px]" style={{ borderColor: BORDER }}>
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: NAVY }}>
                    {companyName} — Quotation <span className="font-mono">{q.quoteNumber}</span>
                  </p>
                  <p className="text-[8.5px] italic" style={{ color: MUTED }}>
                    continued · <span lang="ar" dir="rtl">تابع</span>
                  </p>
                </div>
              )}

              {/* 7 ─ items chunk — mirror table (thead repeats; tail-only pages skip) */}
              {chunk.length > 0 || pageIdx === 0 ? (
                <div
                  className="mt-[1.8mm] overflow-hidden rounded-lg border"
                  style={{ borderColor: BORDER, background: 'white' }}
                >
                  <table className="w-full table-fixed border-collapse" style={{ tableLayout: 'fixed' }}>
                    {hasRateBasis ? (
                      <colgroup>
                        <col style={{ width: '6%' }} />
                        <col style={{ width: '44%' }} />
                        <col style={{ width: '14%' }} />
                        <col style={{ width: '17%' }} />
                        <col style={{ width: '19%' }} />
                      </colgroup>
                    ) : (
                      <colgroup>
                        <col style={{ width: '5%' }} />
                        <col style={{ width: showDiscountCol ? '37%' : '41%' }} />
                        <col style={{ width: '9%' }} />
                        <col style={{ width: '10%' }} />
                        <col style={{ width: '13%' }} />
                        {showDiscountCol ? <col style={{ width: '9%' }} /> : null}
                        <col style={{ width: showDiscountCol ? '17%' : '22%' }} />
                      </colgroup>
                    )}
                    <thead style={{ display: 'table-header-group', background: DARK_NAVY }}>
                      {hasRateBasis ? (
                        <tr>
                          <th className={th}>
                            <p className="text-[7.5px] font-bold text-white">#</p>
                          </th>
                          <th className={`${th} text-left`}>
                            <p className="text-[7.5px] font-bold text-white">Trade / Category</p>
                            <p lang="ar" dir="rtl" className="text-[7px] font-semibold" style={{ color: LIGHT_GOLD }}>
                              المهنة / الفئة
                            </p>
                          </th>
                          <th className={th}>
                            <p className="text-[7.5px] font-bold text-white">No. of Workers</p>
                            <p lang="ar" dir="rtl" className="text-[7px] font-semibold" style={{ color: LIGHT_GOLD }}>
                              عدد العمال
                            </p>
                          </th>
                          <th className={th}>
                            <p className="text-[7.5px] font-bold text-white">Hourly Rate (SAR)</p>
                            <p lang="ar" dir="rtl" className="text-[7px] font-semibold" style={{ color: LIGHT_GOLD }}>
                              السعر بالساعة
                            </p>
                          </th>
                          <th className={th}>
                            <p className="text-[7.5px] font-bold text-white">Amount (SAR)</p>
                            <p lang="ar" dir="rtl" className="text-[7px] font-semibold" style={{ color: LIGHT_GOLD }}>
                              المبلغ
                            </p>
                          </th>
                        </tr>
                      ) : (
                        <tr>
                          <th className={th}>
                            <p className="text-[7.5px] font-bold text-white">#</p>
                          </th>
                          <th className={`${th} text-left`}>
                            <p className="text-[7.5px] font-bold text-white">Description</p>
                            <p lang="ar" dir="rtl" className="text-[7px] font-semibold" style={{ color: LIGHT_GOLD }}>
                              الوصف
                            </p>
                          </th>
                          <th className={th}>
                            <p className="text-[7.5px] font-bold text-white">Qty</p>
                            <p lang="ar" dir="rtl" className="text-[7px] font-semibold" style={{ color: LIGHT_GOLD }}>
                              الكمية
                            </p>
                          </th>
                          <th className={th}>
                            <p className="text-[7.5px] font-bold text-white">Unit</p>
                            <p lang="ar" dir="rtl" className="text-[7px] font-semibold" style={{ color: LIGHT_GOLD }}>
                              الوحدة
                            </p>
                          </th>
                          <th className={th}>
                            <p className="text-[7.5px] font-bold text-white">Unit Price</p>
                            <p lang="ar" dir="rtl" className="text-[7px] font-semibold" style={{ color: LIGHT_GOLD }}>
                              سعر الوحدة
                            </p>
                          </th>
                          {showDiscountCol ? (
                            <th className={th}>
                              <p className="text-[7.5px] font-bold text-white">Disc.</p>
                              <p lang="ar" dir="rtl" className="text-[7px] font-semibold" style={{ color: LIGHT_GOLD }}>
                                الخصم
                              </p>
                            </th>
                          ) : null}
                          <th className={th}>
                            <p className="text-[7.5px] font-bold text-white">Line Total</p>
                            <p lang="ar" dir="rtl" className="text-[7px] font-semibold" style={{ color: LIGHT_GOLD }}>
                              الإجمالي
                            </p>
                          </th>
                        </tr>
                      )}
                    </thead>
                    <tbody>
                      {chunk.length === 0 ? (
                        <tr>
                          <td
                            className={`${td} border-b py-2 text-center text-neutral-400`}
                            colSpan={hasRateBasis ? 5 : showDiscountCol ? 7 : 6}
                            style={{ borderColor: ROW_SEP }}
                          >
                            No line items yet
                          </td>
                        </tr>
                      ) : (
                        chunk.map((it, i) => (
                          <tr
                            key={it.id ?? `${it.sr}-${i}`}
                            className="break-inside-avoid"
                            style={{
                              background: i % 2 === 1 ? '#FAFBFD' : 'white',
                              borderBottom: `0.3mm solid ${ROW_SEP}`,
                              // flow-fill: leftover page room → taller, airier rows
                              ...(plan.rowExtraMm > 0.4
                                ? { height: `${rowHeightMm(it) + plan.rowExtraMm}mm` }
                                : null),
                            }}
                          >
                            <td className={`${td} text-center`}>
                              {/* index inside a thin gold ring — the template's touch */}
                              <span
                                className="inline-flex h-[13px] w-[13px] items-center justify-center rounded-full border-[1.3px] text-[7.5px] font-bold tabular-nums"
                                style={{ borderColor: GOLD, color: NAVY }}
                              >
                                {it.sr}
                              </span>
                            </td>
                            <td className={td}>
                              <p className="text-[8.5px] font-bold leading-[1.15]" style={{ color: DARK_NAVY }}>
                                {it.description}
                              </p>
                              {it.subText ? (
                                <p className="text-[7px] italic leading-[1.1]" style={{ color: MUTED }}>
                                  {it.subText}
                                </p>
                              ) : null}
                            </td>
                            {hasRateBasis ? (
                              <>
                                <td className={`${td} text-center text-[9px] font-semibold tabular-nums`}>
                                  {it.quantity.toLocaleString('en-US')}
                                </td>
                                <td className={`${tdR} text-[9px] font-bold`} style={{ color: DARK_NAVY }}>
                                  {it.ratePerHour != null ? money(it.ratePerHour) : '—'}
                                </td>
                                <td className={`${tdR} font-bold`} style={{ color: DARK_NAVY }}>
                                  {money(it.lineTotal)}
                                </td>
                              </>
                            ) : (
                              <>
                                <td className={`${td} text-center font-semibold tabular-nums`}>
                                  {it.quantity.toLocaleString('en-US')}
                                </td>
                                <td className={`${td} text-center`}>{it.unit ?? '—'}</td>
                                <td className={tdR}>{money(it.unitPrice)}</td>
                                {showDiscountCol ? (
                                  <td className={tdR}>
                                    {(it.discount ?? 0) > 0 ? `-${money(it.discount ?? 0)}` : '—'}
                                  </td>
                                ) : null}
                                <td className={`${tdR} font-bold`} style={{ color: DARK_NAVY }}>
                                  {money(it.lineTotal)}
                                </td>
                              </>
                            )}
                          </tr>
                        ))
                      )}
                      {/* total row on the last items chunk — hourly quotes
                          total the workers and amount columns (mirror) */}
                      {chunk.length > 0 && pageIdx === lastItemsPageIdx ? (
                        <tr
                          className="break-inside-avoid"
                          style={{ background: LIGHT_BG, borderTop: `0.6mm solid ${NAVY}` }}
                        >
                          {hasRateBasis ? (
                            <>
                              <td className={td} />
                              <td
                                className={`${td} text-[9px] font-extrabold uppercase tracking-wide`}
                                style={{ color: NAVY }}
                              >
                                Total <span lang="ar" dir="rtl" className="normal-case">الإجمالي</span>
                              </td>
                              <td
                                className={`${td} text-center text-[9px] font-extrabold tabular-nums`}
                                style={{ color: NAVY }}
                              >
                                {totalWorkers.toLocaleString('en-US')}
                              </td>
                              <td className={td} />
                              <td
                                className={`${tdR} text-[9.5px] font-extrabold`}
                                style={{ color: NAVY }}
                              >
                                {money(q.subtotal)}
                              </td>
                            </>
                          ) : (
                            <>
                              <td className={td} />
                              <td
                                className={`${td} text-[9px] font-extrabold uppercase tracking-wide`}
                                style={{ color: NAVY }}
                              >
                                Total Amount <span lang="ar" dir="rtl" className="normal-case">الإجمالي</span>
                              </td>
                              <td className={td} />
                              <td className={td} />
                              {showDiscountCol ? <td className={td} /> : null}
                              <td
                                className={`${tdR} text-[9.5px] font-extrabold`}
                                style={{ color: NAVY }}
                              >
                                {money(q.subtotal)}
                              </td>
                            </>
                          )}
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              ) : null}

              {/* calculation note under the items table (hourly quotes) */}
              {hasRateBasis && chunk.length > 0 ? (
                <p className="text-right text-[7px] italic mt-[1mm]" style={{ color: MUTED }}>
                  * Amount = No. of Workers × Hourly Rate ×{' '}
                  {uniformHours != null ? `${uniformHours} hours / month` : 'Hours / Month (per trade)'}
                </p>
              ) : null}

              {/* ── tail blocks — flow after the items table, page by page ── */}
              {plan.blocks.includes('scopeSummary') ? (
                <section
                  className={`mt-[1.5mm] grid grid-cols-[1fr_78mm] items-start gap-[2.5mm] break-inside-avoid`}
                >
                  {/* ── SCOPE & TERMS ◆ card (mirror left column) ── */}
                  <div
                    className="overflow-hidden rounded-lg border"
                    style={{ borderColor: BORDER, background: 'white' }}
                  >
                    <div
                      className="flex items-center justify-center gap-2 border-b px-2.5 py-[3.5px]"
                      style={{ borderColor: BORDER, background: CREAM }}
                    >
                      <p
                        className="text-[8.5px] font-extrabold uppercase tracking-[0.18em]"
                        style={{ color: DARK_GOLD }}
                      >
                        Scope &amp; Terms
                      </p>
                      <GoldDiamond size={5} />
                      <p
                        lang="ar"
                        dir="rtl"
                        className="text-[9.5px] font-bold leading-none"
                        style={{ color: DARK_GOLD }}
                      >
                        النطاق والشروط
                      </p>
                    </div>
                    <div className={`px-2.5 ${plan.roomyTier >= 1 ? 'py-[6px]' : 'py-[4px]'}`}>
                      {/* included | not included sub-columns (dotted divider) */}
                      {inclusions.length > 0 || exclusions.length > 0 ? (
                        <div className="grid grid-cols-2 gap-[3mm]">
                          <div>
                            <p
                              className="text-[7px] font-extrabold uppercase tracking-[0.1em]"
                              style={{ color: DARK_GOLD }}
                            >
                              Included in rates{' '}
                              <span lang="ar" dir="rtl" className="normal-case tracking-normal">
                                شامل في الأسعار
                              </span>
                            </p>
                            <ul className="mt-[1mm] space-y-[0.7mm]">
                              {inclusions.map((l) => (
                                <li
                                  key={l}
                                  className="flex gap-[1.5mm] text-[7.5px] leading-snug text-neutral-700"
                                >
                                  <span
                                    className="mt-[0.9mm] h-[1.1mm] w-[1.1mm] shrink-0 rotate-45"
                                    style={{ background: GOLD }}
                                  />
                                  <span>{l}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                          <div
                            className="border-l border-dotted pl-[3mm]"
                            style={{ borderColor: '#C7CFDC' }}
                          >
                            <p
                              className="text-[7px] font-extrabold uppercase tracking-[0.1em]"
                              style={{ color: MUTED }}
                            >
                              Not included{' '}
                              <span lang="ar" dir="rtl" className="normal-case tracking-normal">
                                غير شامل
                              </span>
                            </p>
                            <ul className="mt-[1mm] space-y-[0.7mm]">
                              {exclusions.map((l) => (
                                <li
                                  key={l}
                                  className="flex gap-[1.5mm] text-[7.5px] leading-snug text-neutral-600"
                                >
                                  <span
                                    className="mt-[0.9mm] h-[1.1mm] w-[1.1mm] shrink-0 rotate-45"
                                    style={{ background: '#B7BFCB' }}
                                  />
                                  <span>{l}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      ) : null}

                      {/* numbered terms below a dotted divider */}
                      <div
                        className={`border-t border-dotted ${inclusions.length > 0 || exclusions.length > 0 ? 'mt-[1.5mm] pt-[1.2mm]' : ''}`}
                        style={{ borderColor: '#C7CFDC' }}
                      >
                        {terms.length > 0 ? (
                          <ol className="space-y-[0.7mm]">
                            {terms.map((t) => (
                              <li
                                key={`${t.n}-${t.text.slice(0, 12)}`}
                                className="flex gap-[1.5mm] text-[7.5px] leading-snug text-neutral-700"
                              >
                                <span className="shrink-0 font-bold" style={{ color: DARK_GOLD }}>
                                  {t.n}
                                </span>
                                <span>{t.text}</span>
                              </li>
                            ))}
                          </ol>
                        ) : (
                          <p className="text-[7.5px]" style={{ color: MUTED }}>
                            As mutually agreed between the parties.
                          </p>
                        )}
                        {q.notes ? (
                          <p className="mt-[1.2mm] whitespace-pre-line text-[7.5px] italic leading-snug" style={{ color: MUTED }}>
                            {q.notes}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  {/* ── FINANCIAL SUMMARY box (mirror right column) ── */}
                  <div
                    className="overflow-hidden rounded-lg border"
                    style={{ borderColor: BORDER, background: 'white' }}
                  >
                    <div
                      className={`flex items-baseline justify-between gap-2 border-b px-2.5 ${plan.roomyTier >= 1 ? 'py-[6px]' : 'py-[3.5px]'} text-[9px]`}
                      style={{ borderColor: BORDER, background: LIGHT_BG }}
                    >
                      <span className="font-semibold" style={{ color: MUTED }}>
                        Monthly Subtotal{' '}
                        <span lang="ar" dir="rtl" className="text-[8px]">
                          المجموع الشهري
                        </span>
                      </span>
                      <span className="font-semibold tabular-nums" style={{ color: NAVY }}>
                        {money(q.subtotal)}
                      </span>
                    </div>
                    <p className="px-2.5 text-right text-[6.5px]" style={{ color: MUTED }}>
                      excl. VAT · {currency}
                    </p>
                    {q.discount > 0 ? (
                      <>
                        <div
                          className="flex items-baseline justify-between gap-2 border-b px-2.5 py-[3.5px] text-[9px]"
                          style={{ borderColor: BORDER, background: 'white' }}
                        >
                          <span className="font-semibold" style={{ color: MUTED }}>
                            Discount <span lang="ar" dir="rtl" className="text-[8px]">الخصم</span>
                          </span>
                          <span className="font-semibold tabular-nums text-rose-700">
                            -{money(q.discount)}
                          </span>
                        </div>
                        <div
                          className="flex items-baseline justify-between gap-2 border-b px-2.5 py-[3.5px] text-[9px]"
                          style={{ borderColor: BORDER, background: 'white' }}
                        >
                          <span className="font-semibold" style={{ color: MUTED }}>
                            Net Amount <span lang="ar" dir="rtl" className="text-[8px]">الصافي</span>
                          </span>
                          <span className="font-semibold tabular-nums" style={{ color: NAVY }}>
                            {money(netTotal)}
                          </span>
                        </div>
                      </>
                    ) : null}
                    <div
                      className={`flex items-baseline justify-between gap-2 border-b px-2.5 ${plan.roomyTier >= 1 ? 'py-[6px]' : 'py-[3.5px]'} text-[9px]`}
                      style={{ borderColor: BORDER, background: LIGHT_BG }}
                    >
                      <span className="font-semibold" style={{ color: MUTED }}>
                        VAT ({vatPercent}%){' '}
                        <span lang="ar" dir="rtl" className="text-[8px]">
                          ضريبة القيمة المضافة
                        </span>
                      </span>
                      <span className="font-semibold tabular-nums" style={{ color: NAVY }}>
                        {money(q.vatAmount)}
                      </span>
                    </div>
                    {/* TOTAL / MONTH — navy row, white label, gold amount */}
                    <div
                      className={`border-b px-2.5 ${plan.roomyTier >= 1 ? 'py-[8px]' : 'py-[5px]'}`}
                      style={{ borderColor: BORDER, background: DARK_NAVY }}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-[9.5px] font-extrabold uppercase tracking-wide text-white">
                          Total / Month{' '}
                          <span lang="ar" dir="rtl" className="normal-case tracking-normal">
                            الإجمالي شهرياً
                          </span>
                        </span>
                        <span
                          className="text-[13px] font-extrabold tabular-nums"
                          style={{ color: LIGHT_GOLD }}
                        >
                          {money(q.total)}
                        </span>
                      </div>
                      <p className="text-right text-[6.5px] font-semibold text-white/70">
                        incl. VAT · {currency}
                      </p>
                    </div>
                    {contractMonths && contractValue != null ? (
                      <div
                        className={`flex items-baseline justify-between gap-2 px-2.5 ${plan.roomyTier >= 1 ? 'py-[6px]' : 'py-[3.5px]'} text-[9px]`}
                        style={{ background: LIGHT_BG }}
                      >
                        <span className="font-semibold" style={{ color: MUTED }}>
                          Contract Value{' '}
                          <span lang="ar" dir="rtl" className="text-[8px]">
                            قيمة العقد
                          </span>
                        </span>
                        <span className="font-extrabold tabular-nums" style={{ color: NAVY }}>
                          {money(contractValue)}
                        </span>
                      </div>
                    ) : null}
                    {contractMonths && contractValue != null ? (
                      <p className="px-2.5 pb-[3px] text-right text-[6.5px]" style={{ color: MUTED }}>
                        {contractMonths} months · incl. VAT · {currency}
                      </p>
                    ) : null}
                  </div>
                </section>
              ) : null}

              {/* amount in words — slim bilingual line under the split */}
              {plan.blocks.includes('scopeSummary') ? (
                <p className="mt-[1mm] text-[7.5px] leading-snug" style={{ color: MUTED }}>
                  <span className="font-bold uppercase tracking-wide" style={{ color: DARK_GOLD }}>
                    Amount in Words <span lang="ar" dir="rtl" className="normal-case">المبلغ كتابةً</span>:
                  </span>{' '}
                  <span className="font-semibold" style={{ color: NAVY }}>
                    {words.en}
                  </span>{' '}
                  <span className="mx-1 text-neutral-300">|</span>{' '}
                  <span lang="ar" dir="rtl" className="font-semibold" style={{ color: NAVY }}>
                    {words.ar}
                  </span>
                </p>
              ) : null}

              {/* SIGNATURES — APPROVED BY | ACCEPTED BY boxes with dashed gold
                  stamp circles. On a well-filled items page they pin to the
                  foot (mt-auto); a sparse/roomy final page flows them right
                  after the content so the leftover space lands at the bottom
                  (natural document ending, no middle void). */}
              {plan.blocks.includes('signatures') ? (
                <div
                  className={chunk.length > 0 && plan.roomyTier === 0 ? 'mt-auto' : ''}
                  style={{
                    paddingTop:
                      plan.roomyTier === 2 ? '12mm' : plan.roomyTier === 1 ? '5mm' : '2mm',
                  }}
                >
                  <section className="grid grid-cols-2 gap-[5mm]">
                    {/* APPROVED BY — the company */}
                    <div
                      className="overflow-hidden rounded-lg border"
                      style={{ borderColor: BORDER, background: 'white' }}
                    >
                      <div
                        className="flex items-center justify-center gap-2 border-b px-2.5 py-[3.5px]"
                        style={{ borderColor: BORDER, background: CREAM }}
                      >
                        <p
                          className="text-[8px] font-extrabold uppercase tracking-[0.14em]"
                          style={{ color: DARK_GOLD }}
                        >
                          Approved By · {companyName}
                        </p>
                        <GoldDiamond size={4} />
                        <p
                          lang="ar"
                          dir="rtl"
                          className="text-[9px] font-bold leading-none"
                          style={{ color: DARK_GOLD }}
                        >
                          اعتماد الشركة
                        </p>
                      </div>
                      <div className="flex items-end justify-between gap-2 px-2.5 py-[5px]">
                        <div className="min-w-0 flex-1 space-y-[1.1mm]">
                          <div
                            className="border-b border-neutral-500"
                            style={{
                            height:
                              plan.roomyTier === 2 ? '13mm' : plan.roomyTier === 1 ? '9mm' : '6mm',
                          }}
                          />
                          <p className="text-[8px] text-neutral-700">
                            <span className="font-semibold" style={{ color: MUTED }}>Name: </span>
                            {settings.authorizedSignatory || q.createdByName || preparedBy || '_____________________'}
                            <span style={{ color: MUTED }}>
                              {' '}· {settings.signatoryTitle || 'Manager'}
                            </span>
                          </p>
                          <p className="text-[8px] text-neutral-700">
                            <span className="font-semibold" style={{ color: MUTED }}>Date: </span>
                            ____ / ____ / ________
                          </p>
                        </div>
                        <div
                          className={`flex ${plan.roomyTier === 2 ? 'h-[24mm] w-[24mm]' : plan.roomyTier === 1 ? 'h-[19mm] w-[19mm]' : 'h-[15mm] w-[15mm]'} shrink-0 items-center justify-center rounded-full border-[0.45mm] border-dashed text-center text-[6px] font-bold uppercase leading-tight tracking-wide`}
                          style={{ borderColor: GOLD, color: DARK_GOLD }}
                        >
                          Company
                          <br />
                          Stamp
                        </div>
                      </div>
                    </div>

                    {/* ACCEPTED BY — the client */}
                    <div
                      className="overflow-hidden rounded-lg border"
                      style={{ borderColor: BORDER, background: 'white' }}
                    >
                      <div
                        className="flex items-center justify-center gap-2 border-b px-2.5 py-[3.5px]"
                        style={{ borderColor: BORDER, background: CREAM }}
                      >
                        <p
                          className="text-[8px] font-extrabold uppercase tracking-[0.14em]"
                          style={{ color: DARK_GOLD }}
                        >
                          Accepted By · Client
                        </p>
                        <GoldDiamond size={4} />
                        <p
                          lang="ar"
                          dir="rtl"
                          className="text-[9px] font-bold leading-none"
                          style={{ color: DARK_GOLD }}
                        >
                          موافقة العميل
                        </p>
                      </div>
                      <div className="flex items-end justify-between gap-2 px-2.5 py-[5px]">
                        <div className="min-w-0 flex-1 space-y-[1.1mm]">
                          <div
                            className="border-b border-neutral-500"
                            style={{
                            height:
                              plan.roomyTier === 2 ? '13mm' : plan.roomyTier === 1 ? '9mm' : '6mm',
                          }}
                          />
                          <p className="text-[8px] text-neutral-700">
                            <span className="font-semibold" style={{ color: MUTED }}>Name: </span>
                            _____________________
                          </p>
                          <p className="text-[8px] text-neutral-700">
                            <span className="font-semibold" style={{ color: MUTED }}>Date: </span>
                            ____ / ____ / ________
                          </p>
                        </div>
                        <div
                          className={`flex ${plan.roomyTier === 2 ? 'h-[24mm] w-[24mm]' : plan.roomyTier === 1 ? 'h-[19mm] w-[19mm]' : 'h-[15mm] w-[15mm]'} shrink-0 items-center justify-center rounded-full border-[0.45mm] border-dashed text-center text-[6px] font-bold uppercase leading-tight tracking-wide`}
                          style={{ borderColor: GOLD, color: DARK_GOLD }}
                        >
                          Client
                          <br />
                          Stamp
                        </div>
                      </div>
                    </div>
                  </section>

                  <p className="mt-[1.2mm] text-center text-[7px]" style={{ color: MUTED }}>
                    This is a computer-generated quotation from {companyName} ·{' '}
                    <span lang="ar" dir="rtl">
                      عرض سعر مُنشأ آلياً من {settings.companyNameAr || companyName}
                    </span>
                  </p>
                </div>
              ) : null}
            </div>

            {/* ── signature / stamp assets (percent-of-page, last page) ── */}
            {isLast
              ? assets.map((a, i) => (
                  <img
                    key={a.id ?? `${a.type}-${i}`}
                    src={a.dataUrl}
                    alt={a.type === 'stamp' ? 'Company stamp' : 'Authorized signature'}
                    className="pointer-events-none absolute"
                    style={{
                      left: `${a.posX}%`,
                      top: `${a.posY}%`,
                      width: `${a.width}%`,
                      transform: `rotate(${a.rotation}deg)`,
                      transformOrigin: 'center',
                      zIndex: 20,
                    }}
                  />
                ))
              : null}

            {/* ── page footer strip — sits above the reserved bottom band ── */}
            <div
              className="pointer-events-none absolute inset-x-[8mm] flex items-center justify-between gap-2 border-t pt-[1mm] text-[7px]"
              style={{ bottom: `${geo.bottomMm + 1}mm`, borderColor: BORDER, color: MUTED }}
            >
              <span className="truncate">
                {companyName} · {q.quoteNumber}
                {q.referenceNo ? ` · Ref ${q.referenceNo}` : ''}
              </span>
              <span className="shrink-0 tabular-nums">
                Page {pageIdx + 1} of {plans.length}{' '}
                <span className="mx-0.5 text-neutral-300">|</span>{' '}
                <span lang="ar" dir="rtl">
                  صفحة {pageIdx + 1} من {plans.length}
                </span>
              </span>
              <span className="shrink-0 tabular-nums">Printed {fmtDate(printedAt.toISOString())}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

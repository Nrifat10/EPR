'use client'

// Supplier P.O. print preview — the boss's template design
// (upload/Manpower_PO_Simple.png) rendered as a multi-page A4 portrait
// manpower purchase order document.
//
//   • Title block — gold accent bar + "Manpower" (thin serif) +
//     "Purchase Order" (large bold navy) on the left; PO NUMBER label +
//     number (large bold navy) on the right; solid dark rule below.
//   • ORDER — PO Date / Quotation Ref. / Payment Terms / Currency.
//   • PARTIES — "Issued by" (company letterhead info) | "Supplier"
//     (name, address, VAT · C.R., contact).
//   • ASSIGNMENT — Work Site / Start Date / Duration / Working Hours.
//   • MANPOWER table — TRADE/CATEGORY | NO. OF WORKERS | HOURLY RATE (SAR) |
//     AMOUNT (SAR), zebra rows, bold Total row + formula note
//     "Amount = No. of Workers × Hourly Rate × 260 hours / month".
//     Direct-amount P.O.s (no hours/month) fall back to classic columns.
//   • SUMMARY — Monthly Subtotal | VAT | TOTAL / MONTH (navy box) |
//     PO Value (N Months).
//   • TERMS — two numbered columns.
//   • APPROVAL — "Authorized by — Company" | "Accepted by — Supplier"
//     signature lines with "Signature, Stamp & Date".
//
// Every section carries a small gold uppercase label on the far left —
// the template's signature look.
//
// Pagination model: EXPLICIT A4 pages (210 × 296.5mm — 0.5mm slack prevents
// blank interleaved pages in Chrome's print pipeline). Items are chunked with
// a conservative row-height estimator. The tail (summary → terms → approval)
// then FLOWS block-by-block onto the last items page while it fits, and
// continues on a fresh page that starts at the TOP under a "Continued" strip.
// Leftover room on each items page is given back to the table rows (capped
// stretch) so short documents fill the A4 nicely. Every page repeats the
// table header and carries a "Page X of Y" footer.
//
// Letterhead modes: 'none' (styled typed header, compact 12/14mm margins —
// no blank reserved zones) | 'header' | 'header_footer' | 'full' (artwork
// uploaded via Settings; content is padded inside the reserved bands).
import { Printer, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { usePageRule } from '@/components/app/print/print-page-rule'
import { formatNumber, round2 } from '@/lib/format'
import { useAppStore } from '@/lib/store'
import type { AppSettings, DocItemRow, LetterheadConfig, SupplierPoRow } from '@/lib/types'

/** Full supplier P.O. as returned by GET /api/supplier-pos/[id] (with items). */
export type SupplierPoDetail = SupplierPoRow & { itemCount?: number }

const DEFAULT_LETTERHEAD: LetterheadConfig = {
  mode: 'none',
  headerImage: null,
  footerImage: null,
  fullPageImage: null,
  showCompanyDetails: true,
  headerHeightMm: 35, // template reserved zones: top 35 mm
  footerHeightMm: 22, // … bottom 22 mm
}

export { DEFAULT_LETTERHEAD }

// ── Brand palette (same family as the E-Invoice / Quotation modules) ───────
const NAVY = '#132A4A'
const DARK_NAVY = '#0C1D33'
const GOLD = '#C0934C'
const DARK_GOLD = '#8E6420'
const LIGHT_BG = '#F2F5FA'
const BORDER = '#DDE3EC'
const MUTED = '#6B7488'

// ── A4 pagination geometry ──────────────────────────────────────────────────
const PAGE_W_MM = 210
const PAGE_H_MM = 296.5 // 0.5mm print-pipeline slack (see header comment)
const SIDE_PAD_MM = 12

// "Continued" strip reserved at the top of every page ≥ 2
const CONT_HEADER_MM = 12
// head-room required before a tail block may join the last items page
const PLACE_BUFFER_MM = 5
// slack kept in reserve when stretching rows (estimator safety)
const STRETCH_SAFE_MM = 5
// per-row stretch cap — keeps the stretched table tasteful
const MAX_ROW_STRETCH = 5
// items-table Total row + the formula note under it
const TOTAL_ROW_MM = 12
// approval section (signature lines + labels) — calibrated against prints
const APPROVAL_MM = 32
// a final page with this much slack gets the roomier signature treatment
const ROOMY_SLACK_MM = 60

type PageGeometry = {
  padTop: number
  padBottom: number
  page1Fixed: number
}

// page1Fixed = everything that always sits on page 1 above the items table.
// Calibrated against real Chrome A4 prints of this template: typed header
// (none mode only) ≈ 18mm + title block ≈ 18mm + ORDER ≈ 12mm + PARTIES ≈ 29mm
// + ASSIGNMENT ≈ 12mm + thead ≈ 7mm + inter-section margins ≈ 7mm ≈ 96mm
// (none) / 82mm (artwork — no typed header). Over-reserving is safe (rows
// are themselves over-estimated); under-reserving clips content.
function geometryFor(letterhead: LetterheadConfig): PageGeometry {
  switch (letterhead.mode) {
    case 'full':
      return {
        padTop: letterhead.headerHeightMm + 4,
        padBottom: Math.max(letterhead.footerHeightMm + 4, 12),
        page1Fixed: 88,
      }
    case 'header':
      return {
        padTop: letterhead.headerHeightMm + 3,
        padBottom: 12,
        page1Fixed: 88,
      }
    case 'header_footer':
      return {
        padTop: letterhead.headerHeightMm + 3,
        padBottom: letterhead.footerHeightMm + 3,
        page1Fixed: 88,
      }
    default:
      // no artwork → compact margins so the P.O. fills the A4 nicely
      return { padTop: 12, padBottom: 14, page1Fixed: 96 }
  }
}

/** Conservative table-row height estimate in mm (over-estimate = safe breaks). */
function rowHeightMm(it: DocItemRow): number {
  const CHARS_PER_LINE = 46
  const lines = Math.max(1, Math.ceil(it.description.length / CHARS_PER_LINE))
  return 7 + 4 * (lines - 1)
}

/** Wrapped line count for a text block at ~charsPerLine characters per line. */
function lineCount(text: string | null | undefined, charsPerLine: number): number {
  if (!text) return 0
  return text
    .split('\n')
    .reduce((n, line) => n + Math.max(1, Math.ceil(line.trim().length / charsPerLine)), 0)
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

/** Template date style: "20 / 10 / 2026". */
function dmy(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())} / ${p(d.getMonth() + 1)} / ${d.getFullYear()}`
}

/** Tail sections that flow after the items table, in document order. */
type TailBlock = 'summary' | 'terms' | 'approval'

/** One explicit A4 page: its item chunk, stretched row height and tail blocks. */
type PagePlan = {
  items: DocItemRow[]
  /** extra mm given to every item row on this page (fills the A4 nicely) */
  rowExtraMm: number
  /** tail blocks rendered on this page, in order */
  blocks: TailBlock[]
  /** final page with lots of slack → roomier signature area */
  roomy: boolean
}

/**
 * Flow-fill pagination:
 *   1. chunk items across pages (conservative row estimates → safe breaks);
 *   2. flow the tail blocks, in order, onto the last items page while they
 *      fit (with a placement buffer); the rest continues on a fresh page
 *      that starts at the TOP — signatures never strand alone on a page;
 *   3. hand each page's leftover room back to its item rows (capped), so
 *      pages fill nicely instead of ending two-thirds down;
 *   4. flag a sparse final page so the signature area can breathe.
 */
function planPages(
  items: DocItemRow[],
  geo: PageGeometry,
  tail: { summary: number; terms: number; hasTerms: boolean }
): PagePlan[] {
  const availFirst = PAGE_H_MM - geo.padTop - geo.padBottom - geo.page1Fixed
  const availRest = PAGE_H_MM - geo.padTop - geo.padBottom - CONT_HEADER_MM

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
  const blockH: Record<TailBlock, number> = {
    summary: tail.summary,
    terms: tail.terms,
    approval: APPROVAL_MM,
  }
  const order: TailBlock[] = [
    'summary',
    ...(tail.hasTerms ? (['terms'] as TailBlock[]) : []),
    'approval',
  ]
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
  if (deferred.length === 1 && deferred[0] === 'approval' && blocks.length > 0) {
    deferred.unshift(blocks.pop() as TailBlock)
  }

  const pages: PagePlan[] = chunks.map((c) => ({
    items: c,
    rowExtraMm: 0,
    blocks: [] as TailBlock[],
    roomy: false,
  }))
  pages[pages.length - 1].blocks = blocks
  if (deferred.length > 0) {
    pages.push({ items: [], rowExtraMm: 0, blocks: deferred, roomy: false })
  }

  // 3) give leftover room back to the rows (fills the A4 nicely)
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i]
    if (p.items.length === 0) continue
    const pageCap = i === 0 ? availFirst : availRest
    const rowsMm = p.items.reduce((s, it) => s + rowHeightMm(it), 0) + TOTAL_ROW_MM
    const blocksMm = p.blocks.reduce((s, b) => s + blockH[b], 0)
    const slack = pageCap - rowsMm - blocksMm
    if (slack > STRETCH_SAFE_MM) {
      p.rowExtraMm = Math.min((slack - STRETCH_SAFE_MM) / p.items.length, MAX_ROW_STRETCH)
    }
  }

  // 4) sparse final page → roomier signature treatment
  const fin = pages[pages.length - 1]
  const finCap = pages.length === 1 ? availFirst : availRest
  const finRows =
    fin.items.reduce((s, it) => s + rowHeightMm(it), 0) + (fin.items.length ? TOTAL_ROW_MM : 0)
  const finBlocks = fin.blocks.reduce((s, b) => s + blockH[b], 0)
  fin.roomy = finCap - finRows - finBlocks > ROOMY_SLACK_MM

  return pages
}

/** Status stamp — rotated bordered chip on the document header. */
function StatusStamp({ status }: { status: string }) {
  const styles: Record<string, string> = {
    received:
      'border-emerald-600 text-emerald-700 shadow-[inset_0_0_0_1.5px_rgba(5,150,105,0.35)]',
    ordered: 'border-sky-600 text-sky-700 shadow-[inset_0_0_0_1.5px_rgba(2,132,199,0.35)]',
    cancelled: 'border-rose-600 text-rose-700 shadow-[inset_0_0_0_1.5px_rgba(225,29,72,0.35)]',
    draft: 'border-neutral-500 text-neutral-600 shadow-[inset_0_0_0_1.5px_rgba(115,115,115,0.3)]',
  }
  const labels: Record<string, string> = {
    received: 'Received',
    ordered: 'Ordered',
    cancelled: 'Cancelled',
    draft: 'Draft',
  }
  return (
    <span
      className={`inline-block -rotate-6 rounded-md border-[3px] bg-white/85 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-[0.2em] ${styles[status] ?? styles.draft}`}
    >
      {labels[status] ?? status}
    </span>
  )
}

/**
 * Full-screen dialog rendering the paginated A4 manpower purchase order.
 * Print button calls window.print() — only the `.print-area` is printed.
 */
export function SupplierPoPrintDialog({
  po,
  letterhead,
  open,
  onOpenChange,
}: {
  po: SupplierPoDetail | null
  letterhead?: LetterheadConfig | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const settings = useAppStore((s) => s.settings)
  const user = useAppStore((s) => s.user)

  usePageRule(open, 'size: A4 portrait; margin: 0;')

  const isDraft = !po || po.id === 'draft'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[92vh] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-[900px] print:static print:max-h-none print:w-full print:max-w-none print:translate-x-0 print:translate-y-0 print:overflow-visible print:rounded-none print:border-0 print:p-0 print:shadow-none"
      >
        <DialogTitle className="sr-only">Purchase order print preview</DialogTitle>
        <DialogDescription className="sr-only">
          Printable A4 manpower purchase order with company header, supplier block, assignment
          details, manpower rates table, summary boxes, terms and signature lines.
        </DialogDescription>

        {/* Top button bar — hidden when printing */}
        <div className="print-hidden flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">
              {po ? `Purchase Order — ${po.poNumber}` : 'Purchase Order'}
              {isDraft && po ? (
                <span className="ml-2 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-700">
                  Draft preview
                </span>
              ) : null}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {po
                ? `${po.supplierName} · ${formatNumber(po.total)} ${settings.currency || 'SAR'} / month incl. VAT`
                : 'Select a purchase order to preview the document'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              <X className="h-4 w-4" />
              Close
            </Button>
            <Button size="sm" onClick={() => window.print()} disabled={!po}>
              <Printer className="h-4 w-4" />
              Print / Save as PDF
            </Button>
          </div>
        </div>

        {/* Scrollable preview area — stacked A4 pages */}
        <div className="nice-scrollbar min-h-0 flex-1 overflow-auto bg-neutral-100 p-4 dark:bg-neutral-900 print:flex-none print:overflow-visible print:bg-transparent print:p-0">
          {po ? (
            <SupplierPoDocument
              po={po}
              letterhead={letterhead ?? DEFAULT_LETTERHEAD}
              settings={settings}
              orderedBy={user?.name ?? ''}
            />
          ) : (
            <div className="flex min-h-[300px] items-center justify-center bg-white p-16 text-sm text-neutral-400">
              No purchase order selected.
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── The document ────────────────────────────────────────────────────────────

/** Small gold uppercase section label — the template's signature element. */
function SectionLabel({ children }: { children: string }) {
  return (
    <p
      className="pt-[0.4mm] text-[8px] font-extrabold uppercase leading-tight tracking-[0.22em]"
      style={{ color: DARK_GOLD }}
    >
      {children}
    </p>
  )
}

/** Grey meta label + bold value column (ORDER / ASSIGNMENT strips). */
function MetaCol({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[7.5px] font-semibold uppercase tracking-[0.1em]" style={{ color: MUTED }}>
        {label}
      </p>
      <p
        className="mt-[0.6mm] truncate text-[10px] font-bold leading-snug text-neutral-900"
        title={value}
      >
        {value}
      </p>
    </div>
  )
}

export function SupplierPoDocument({
  po,
  letterhead,
  settings,
  orderedBy,
}: {
  po: SupplierPoDetail
  letterhead: LetterheadConfig
  settings: AppSettings
  orderedBy: string
}) {
  const currency = settings.currency || 'SAR'
  const p = po
  const companyName = settings.companyName || 'Landmark Inter Gulf'
  const vatPercent = Math.round(p.vatRate * 100)
  const items = p.items ?? []
  const money = (n: number) => formatNumber(n) // template style: plain numbers — SAR lives in labels
  const geo = geometryFor(letterhead)

  // manpower mode: hourly rate basis (workers × rate × hours/month)
  const isManpower = p.hoursPerMonth != null
  const hoursPerMonth = p.hoursPerMonth ?? 0
  const totalWorkers = round2(items.reduce((s, it) => s + it.quantity, 0))
  const durationMonths = p.durationMonths && p.durationMonths > 0 ? p.durationMonths : null
  const poValue = durationMonths ? round2(p.total * durationMonths) : null

  const terms = p.notes ? numberedTerms(p.notes) : []
  // split into two balanced columns (1-4 left, 5-7 right — template layout)
  const termsLeft = terms.slice(0, Math.ceil(terms.length / 2))
  const termsRight = terms.slice(Math.ceil(terms.length / 2))

  // Tail block heights — calibrated against real Chrome A4 prints (kept a
  // touch generous so page breaks stay safe), fed to the flow-fill paginator.
  const summaryMm = 21
  const termsColLines = Math.max(
    termsLeft.reduce((n, t) => n + lineCount(t.text, 52), 0),
    termsRight.reduce((n, t) => n + lineCount(t.text, 52), 0)
  )
  const termsMm = 9 + termsColLines * 4.4
  const plans = planPages(items, geo, {
    summary: summaryMm,
    terms: termsMm,
    hasTerms: terms.length > 0,
  })
  // The last page that actually carries items — the table's Total row goes there
  const lastItemsPageIdx = plans.reduce((acc, pl, i) => (pl.items.length > 0 ? i : acc), 0)

  const thCls =
    'pb-[1.2mm] pt-[0.8mm] text-left align-bottom text-[8px] font-bold uppercase tracking-[0.1em] text-neutral-600'
  const tdCls = 'py-[1.6mm] pr-[2mm] align-top'

  // assignment strip is skipped entirely when nothing is filled in
  const hasAssignment = Boolean(p.workSite || p.startDate || durationMonths || p.workingHours)

  return (
    <div className="print-area mx-auto flex w-full flex-col items-center gap-6 bg-transparent [print-color-adjust:exact] [-webkit-print-color-adjust:exact] print:gap-0">
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
            {/* ── letterhead artwork ── */}
            {letterhead.mode === 'full' && letterhead.fullPageImage ? (
              <img
                src={letterhead.fullPageImage}
                alt=""
                aria-hidden
                className="pointer-events-none absolute inset-0 h-full w-full object-fill"
              />
            ) : null}
            {letterhead.mode !== 'none' && letterhead.mode !== 'full' && letterhead.headerImage ? (
              <img
                src={letterhead.headerImage}
                alt=""
                aria-hidden
                className="pointer-events-none absolute left-0 top-0 w-full object-fill"
                style={{ height: `${letterhead.headerHeightMm}mm` }}
              />
            ) : null}
            {letterhead.mode === 'header_footer' && letterhead.footerImage ? (
              <img
                src={letterhead.footerImage}
                alt=""
                aria-hidden
                className="pointer-events-none absolute bottom-0 left-0 w-full object-fill"
                style={{ height: `${letterhead.footerHeightMm}mm` }}
              />
            ) : null}

            {/* ── content ── */}
            <div
              className="absolute inset-x-0 top-0 flex flex-col"
              style={{
                paddingTop: `${geo.padTop}mm`,
                paddingBottom: `${geo.padBottom}mm`,
                paddingLeft: `${SIDE_PAD_MM}mm`,
                paddingRight: `${SIDE_PAD_MM}mm`,
                height: '100%',
              }}
            >
              {pageIdx === 0 ? (
                <>
                  {/* typed header for 'none' mode */}
                  {letterhead.mode === 'none' ? (
                    <header
                      className="flex items-start justify-between gap-3 border-b pb-[1.8mm]"
                      style={{ borderColor: BORDER }}
                    >
                      <div className="flex items-start gap-[2.5mm]">
                        <img
                          src={settings.logo ?? '/logo-mark.png'}
                          alt={`${companyName} logo`}
                          className="h-[11mm] w-[11mm] shrink-0 object-contain"
                        />
                        <div className="min-w-0">
                          <h2
                            className="text-[13.5px] font-extrabold uppercase tracking-wide"
                            style={{ color: NAVY }}
                          >
                            {companyName}
                          </h2>
                          {letterhead.showCompanyDetails && settings.address ? (
                            <p
                              className="mt-px max-w-[105mm] text-[8px] leading-relaxed"
                              style={{ color: MUTED }}
                            >
                              {settings.address}
                            </p>
                          ) : null}
                          {letterhead.showCompanyDetails ? (
                            <div
                              className="mt-px flex flex-wrap gap-x-[3mm] gap-y-0.5 text-[8px]"
                              style={{ color: MUTED }}
                            >
                              {settings.phone ? <span>Tel: {settings.phone}</span> : null}
                              {settings.email ? <span>Email: {settings.email}</span> : null}
                            </div>
                          ) : null}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1.5 pt-1">
                        <StatusStamp status={p.status} />
                      </div>
                    </header>
                  ) : (
                    /* artwork modes: status stamp floats right, clear of the artwork */
                    <div className="flex justify-end pb-1">
                      <StatusStamp status={p.status} />
                    </div>
                  )}

                  {/* ── title block ── */}
                  <div className="mt-[2.5mm] flex items-end justify-between gap-[6mm] pb-[2.2mm]">
                    <div className="min-w-0">
                      {/* gold accent bar above the title — template signature */}
                      <div
                        className="h-[1.6mm] w-[14mm] rounded-[1px]"
                        style={{ background: GOLD }}
                        aria-hidden
                      />
                      <p
                        className="mt-[1.4mm] font-serif text-[12px] italic leading-none tracking-wide"
                        style={{ color: DARK_GOLD }}
                      >
                        Manpower
                      </p>
                      <h1
                        className="mt-[0.8mm] text-[24px] font-extrabold leading-none tracking-tight"
                        style={{ color: NAVY }}
                      >
                        Purchase Order
                      </h1>
                    </div>
                    <div className="shrink-0 pb-[0.5mm] text-right">
                      <p
                        className="text-[7.5px] font-bold uppercase tracking-[0.24em]"
                        style={{ color: MUTED }}
                      >
                        PO Number
                      </p>
                      <p
                        className="mt-[1mm] font-mono text-[16px] font-extrabold leading-none"
                        style={{ color: NAVY }}
                      >
                        {p.poNumber}
                      </p>
                    </div>
                  </div>
                  {/* solid dark rule under the title block */}
                  <div
                    className="h-[0.8mm] w-full"
                    style={{ background: DARK_NAVY }}
                    aria-hidden
                  />

                  {/* ── ORDER ── */}
                  <div
                    className="grid grid-cols-[20mm_1fr_1fr_1fr_0.6fr] items-center gap-[3mm] border-b py-[2.2mm]"
                    style={{ borderColor: BORDER }}
                  >
                    <SectionLabel>Order</SectionLabel>
                    <MetaCol label="PO Date" value={dmy(p.issueDate)} />
                    <MetaCol label="Quotation Ref." value={p.quotationRef || '—'} />
                    <MetaCol label="Payment Terms" value={p.paymentTerms || '—'} />
                    <MetaCol label="Currency" value={currency} />
                  </div>

                  {/* ── PARTIES ── */}
                  <div
                    className="grid grid-cols-[20mm_1fr_1fr] items-start gap-[3mm] border-b py-[2.4mm]"
                    style={{ borderColor: BORDER }}
                  >
                    <SectionLabel>Parties</SectionLabel>
                    {/* Issued by — the company (letterhead info) */}
                    <div className="min-w-0">
                      <p
                        className="text-[7.5px] font-semibold uppercase tracking-[0.1em]"
                        style={{ color: MUTED }}
                      >
                        Issued by
                      </p>
                      <p
                        className="mt-[0.6mm] text-[11px] font-bold leading-tight"
                        style={{ color: NAVY }}
                      >
                        {companyName}
                      </p>
                      {settings.address ? (
                        <p className="mt-[0.5mm] text-[8.5px] leading-snug text-neutral-700">
                          {settings.address}
                        </p>
                      ) : null}
                      {settings.vatNumber || settings.crNumber ? (
                        <p className="mt-[0.5mm] text-[8.5px] leading-snug" style={{ color: MUTED }}>
                          {settings.vatNumber ? `VAT ${settings.vatNumber}` : ''}
                          {settings.vatNumber && settings.crNumber ? ' · ' : ''}
                          {settings.crNumber ? `C.R. ${settings.crNumber}` : ''}
                        </p>
                      ) : null}
                      {settings.phone || settings.email ? (
                        <p className="mt-[0.4mm] text-[8.5px] leading-snug text-neutral-700">
                          {[settings.phone, settings.email].filter(Boolean).join(' · ')}
                        </p>
                      ) : null}
                    </div>
                    {/* Supplier */}
                    <div className="min-w-0">
                      <p
                        className="text-[7.5px] font-semibold uppercase tracking-[0.1em]"
                        style={{ color: MUTED }}
                      >
                        Supplier
                      </p>
                      <p
                        className="mt-[0.6mm] text-[11px] font-bold leading-tight"
                        style={{ color: NAVY }}
                      >
                        {p.supplierName}
                      </p>
                      {p.supplierAddress ? (
                        <p className="mt-[0.5mm] text-[8.5px] leading-snug text-neutral-700">
                          {p.supplierAddress}
                        </p>
                      ) : null}
                      {p.supplierVat || p.supplierCr ? (
                        <p className="mt-[0.5mm] text-[8.5px] leading-snug" style={{ color: MUTED }}>
                          {p.supplierVat ? `VAT ${p.supplierVat}` : ''}
                          {p.supplierVat && p.supplierCr ? ' · ' : ''}
                          {p.supplierCr ? `C.R. ${p.supplierCr}` : ''}
                        </p>
                      ) : null}
                      {p.attention || p.supplierPhone ? (
                        <p className="mt-[0.4mm] text-[8.5px] leading-snug text-neutral-700">
                          {[p.attention, p.supplierPhone].filter(Boolean).join(' · ')}
                        </p>
                      ) : null}
                    </div>
                  </div>

                  {/* ── ASSIGNMENT (skipped when empty) ── */}
                  {hasAssignment ? (
                    <div
                      className="grid grid-cols-[20mm_1.4fr_1fr_0.8fr_1fr] items-center gap-[3mm] border-b py-[2.2mm]"
                      style={{ borderColor: BORDER }}
                    >
                      <SectionLabel>Assignment</SectionLabel>
                      <MetaCol label="Work Site" value={p.workSite || '—'} />
                      <MetaCol label="Start Date" value={dmy(p.startDate)} />
                      <MetaCol
                        label="Duration"
                        value={durationMonths ? `${durationMonths} Months` : '—'}
                      />
                      <MetaCol label="Working Hours" value={p.workingHours || '—'} />
                    </div>
                  ) : null}
                </>
              ) : (
                /* continuation strip on EVERY later page — items or tail-only */
                <div
                  className="mb-[3mm] flex items-center justify-between gap-3 border-b-2 pb-[1.8mm]"
                  style={{ borderColor: NAVY }}
                >
                  <div className="flex min-w-0 items-center gap-[2.5mm]">
                    {letterhead.mode === 'none' ? (
                      <img
                        src={settings.logo ?? '/logo-mark.png'}
                        alt=""
                        aria-hidden
                        className="h-[8mm] w-[8mm] shrink-0 object-contain"
                      />
                    ) : null}
                    <p
                      className="truncate text-[11px] font-extrabold uppercase tracking-[0.12em]"
                      style={{ color: NAVY }}
                    >
                      {companyName} — Purchase Order <span className="font-mono">{p.poNumber}</span>
                      <span className="mx-[2mm] font-normal" style={{ color: MUTED }}>
                        ·
                      </span>
                      <span
                        className="font-semibold normal-case tracking-normal"
                        style={{ color: DARK_NAVY }}
                      >
                        {p.supplierName}
                      </span>
                    </p>
                  </div>
                  <p
                    className="shrink-0 rounded-[2px] px-[2mm] py-[0.7mm] text-[7.5px] font-bold uppercase tracking-[0.22em] text-white"
                    style={{ background: GOLD }}
                  >
                    Continued
                  </p>
                </div>
              )}

              {/* items chunk — thead repeats on every page (tail-only pages skip the table) */}
              {chunk.length > 0 || pageIdx === 0 ? (
                <table className="mt-[1.5mm] w-full border-collapse text-[10px]">
                  <thead>
                    <tr style={{ borderBottom: `0.45mm solid ${DARK_NAVY}` }}>
                      {isManpower ? (
                        <>
                          {/* manpower template columns */}
                          <th className={thCls}>Trade / Category</th>
                          <th className={`${thCls} w-[30mm] text-center`}>No. of Workers</th>
                          <th className={`${thCls} w-[34mm] text-right`}>Hourly Rate (SAR)</th>
                          <th className={`${thCls} w-[36mm] text-right`}>Amount (SAR)</th>
                        </>
                      ) : (
                        <>
                          {/* direct-amount fallback */}
                          <th className={`${thCls} w-[8mm] text-center`}>Sr</th>
                          <th className={thCls}>Description</th>
                          <th className={`${thCls} w-[22mm] text-center`}>Qty</th>
                          <th className={`${thCls} w-[32mm] text-right`}>Unit Price</th>
                          <th className={`${thCls} w-[36mm] text-right`}>Line Total</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {chunk.length === 0 ? (
                      <tr>
                        <td
                          className="py-[2mm] text-center text-[9.5px]"
                          style={{ color: MUTED }}
                          colSpan={isManpower ? 4 : 5}
                        >
                          No line items recorded.
                        </td>
                      </tr>
                    ) : (
                      chunk.map((it, i) => (
                        <tr
                          key={it.id ?? `${it.sr}-${it.description.slice(0, 12)}`}
                          className="break-inside-avoid"
                          style={{
                            background: i % 2 === 1 ? LIGHT_BG : '#FFFFFF',
                            borderBottom: `0.3mm solid ${BORDER}`,
                            // flow-fill: leftover page room → taller, airier rows
                            ...(plan.rowExtraMm > 0.4
                              ? { height: `${rowHeightMm(it) + plan.rowExtraMm}mm` }
                              : null),
                          }}
                        >
                          {isManpower ? (
                            <>
                              <td className={tdCls}>
                                <p className="text-[10.5px] font-bold" style={{ color: DARK_NAVY }}>
                                  {it.description}
                                </p>
                              </td>
                              <td
                                className={`${tdCls} text-center text-[10.5px] tabular-nums`}
                              >
                                {it.quantity.toLocaleString('en-US')}
                              </td>
                              <td
                                className={`${tdCls} text-right text-[10.5px] tabular-nums`}
                              >
                                {money(it.unitPrice)}
                              </td>
                              <td
                                className={`${tdCls} text-right text-[10.5px] font-bold tabular-nums`}
                                style={{ color: DARK_NAVY }}
                              >
                                {money(it.lineTotal)}
                              </td>
                            </>
                          ) : (
                            <>
                              <td
                                className={`${tdCls} text-center tabular-nums`}
                                style={{ color: MUTED }}
                              >
                                {it.sr}
                              </td>
                              <td className={tdCls}>
                                <p className="text-[10.5px] font-bold" style={{ color: DARK_NAVY }}>
                                  {it.description}
                                </p>
                              </td>
                              <td
                                className={`${tdCls} text-center text-[10.5px] tabular-nums`}
                              >
                                {it.quantity.toLocaleString('en-US')}
                              </td>
                              <td
                                className={`${tdCls} text-right text-[10.5px] tabular-nums`}
                              >
                                {money(it.unitPrice)}
                              </td>
                              <td
                                className={`${tdCls} text-right text-[10.5px] font-bold tabular-nums`}
                                style={{ color: DARK_NAVY }}
                              >
                                {money(it.lineTotal)}
                              </td>
                            </>
                          )}
                        </tr>
                      ))
                    )}
                    {/* Total row on the last items chunk */}
                    {chunk.length > 0 && pageIdx === lastItemsPageIdx ? (
                      <tr
                        className="break-inside-avoid"
                        style={{ background: LIGHT_BG, borderTop: `0.6mm solid ${NAVY}` }}
                      >
                        {isManpower ? (
                          <>
                            <td
                              className="py-[1.8mm] pr-[2mm] text-[10.5px] font-extrabold uppercase tracking-wide"
                              style={{ color: NAVY }}
                            >
                              Total
                            </td>
                            <td
                              className="py-[1.8mm] text-center text-[10.5px] font-extrabold tabular-nums"
                              style={{ color: NAVY }}
                            >
                              {totalWorkers.toLocaleString('en-US')}
                            </td>
                            <td />
                            <td
                              className="py-[1.8mm] pr-[2mm] text-right text-[10.5px] font-extrabold tabular-nums"
                              style={{ color: NAVY }}
                            >
                              {money(p.subtotal)}
                            </td>
                          </>
                        ) : (
                          <>
                            <td />
                            <td
                              className="py-[1.8mm] pr-[2mm] text-[10.5px] font-extrabold uppercase tracking-wide"
                              style={{ color: NAVY }}
                            >
                              Total
                            </td>
                            <td />
                            <td />
                            <td
                              className="py-[1.8mm] pr-[2mm] text-right text-[10.5px] font-extrabold tabular-nums"
                              style={{ color: NAVY }}
                            >
                              {money(p.subtotal)}
                            </td>
                          </>
                        )}
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              ) : null}

              {/* ── tail blocks — flow after the items table, page by page ── */}
              {plan.blocks.includes('summary') ? (
                <section className="mt-[2.5mm]">
                  {/* formula note — the template's line under the table */}
                  {isManpower ? (
                    <p className="text-[8px] leading-snug" style={{ color: MUTED }}>
                      Amount = No. of Workers × Hourly Rate × {hoursPerMonth} hours / month
                    </p>
                  ) : null}

                  {/* SUMMARY boxes */}
                  <div
                    className={`mt-[1.6mm] grid gap-[3mm] ${durationMonths ? 'grid-cols-4' : 'grid-cols-3'}`}
                  >
                    <div
                      className="rounded-[3px] border py-[2.2mm] text-center"
                      style={{ borderColor: BORDER, background: '#FFFFFF' }}
                    >
                      <p
                        className="px-[1mm] text-[7px] font-bold uppercase tracking-[0.14em]"
                        style={{ color: MUTED }}
                      >
                        {isManpower ? 'Monthly Subtotal' : 'Subtotal'}
                      </p>
                      <p
                        className="mt-[0.8mm] text-[12.5px] font-extrabold tabular-nums"
                        style={{ color: NAVY }}
                      >
                        {money(p.subtotal)}
                      </p>
                    </div>
                    <div
                      className="rounded-[3px] border py-[2.2mm] text-center"
                      style={{ borderColor: BORDER, background: '#FFFFFF' }}
                    >
                      <p
                        className="px-[1mm] text-[7px] font-bold uppercase tracking-[0.14em]"
                        style={{ color: MUTED }}
                      >
                        VAT {vatPercent}%
                      </p>
                      <p
                        className="mt-[0.8mm] text-[12.5px] font-extrabold tabular-nums"
                        style={{ color: NAVY }}
                      >
                        {money(p.vatAmount)}
                      </p>
                    </div>
                    {/* TOTAL / MONTH — the navy highlight box */}
                    <div
                      className="rounded-[3px] py-[2.2mm] text-center"
                      style={{ background: NAVY }}
                    >
                      <p
                        className="px-[1mm] text-[7px] font-bold uppercase tracking-[0.14em] text-white/75"
                      >
                        {isManpower ? `Total / Month (${currency})` : `Total (${currency})`}
                      </p>
                      <p className="mt-[0.8mm] text-[15px] font-extrabold leading-none tabular-nums text-white">
                        {money(p.total)}
                      </p>
                    </div>
                    {durationMonths && poValue != null ? (
                      <div
                        className="rounded-[3px] border py-[2.2mm] text-center"
                        style={{ borderColor: BORDER, background: '#FFFFFF' }}
                      >
                        <p
                          className="px-[1mm] text-[7px] font-bold uppercase tracking-[0.14em]"
                          style={{ color: MUTED }}
                        >
                          PO Value ({durationMonths} Months)
                        </p>
                        <p
                          className="mt-[0.8mm] text-[12.5px] font-extrabold tabular-nums"
                          style={{ color: NAVY }}
                        >
                          {money(poValue)}
                        </p>
                      </div>
                    ) : null}
                  </div>
                </section>
              ) : null}

              {/* TERMS — two numbered columns */}
              {plan.blocks.includes('terms') ? (
                <section
                  className="mt-[2.5mm] grid grid-cols-[20mm_1fr_1fr] items-start gap-[3mm] border-t py-[2.2mm]"
                  style={{ borderColor: BORDER }}
                >
                  <SectionLabel>Terms</SectionLabel>
                  <ol className="space-y-[1mm]">
                    {termsLeft.map((t) => (
                      <li
                        key={`${t.n}-${t.text.slice(0, 12)}`}
                        className="flex gap-[1.5mm] text-[8.5px] leading-snug text-neutral-700"
                      >
                        <span className="shrink-0 font-bold" style={{ color: DARK_GOLD }}>
                          {t.n}
                        </span>
                        <span>{t.text}</span>
                      </li>
                    ))}
                  </ol>
                  <ol className="space-y-[1mm]">
                    {termsRight.map((t) => (
                      <li
                        key={`${t.n}-${t.text.slice(0, 12)}`}
                        className="flex gap-[1.5mm] text-[8.5px] leading-snug text-neutral-700"
                      >
                        <span className="shrink-0 font-bold" style={{ color: DARK_GOLD }}>
                          {t.n}
                        </span>
                        <span>{t.text}</span>
                      </li>
                    ))}
                  </ol>
                </section>
              ) : null}

              {/* APPROVAL — signature lines pinned to the page foot.
                  mt-auto pins them; on a sparse final page (roomy) the space
                  above the line grows so the document bottom carries weight. */}
              {plan.blocks.includes('approval') ? (
                <div className="mt-auto" style={{ paddingTop: plan.roomy ? '12mm' : '5mm' }}>
                  <section
                    className="grid grid-cols-[20mm_1fr_1fr] items-end gap-[3mm] border-t pt-[2.4mm]"
                    style={{ borderColor: BORDER }}
                  >
                    <SectionLabel>Approval</SectionLabel>
                    {/* Authorized by — the company */}
                    <div className="min-w-0">
                      <div style={{ height: plan.roomy ? '14mm' : '10mm' }} aria-hidden />
                      <div className="border-t-[0.35mm] border-neutral-800" />
                      <p
                        className="mt-[1.2mm] truncate text-[9.5px] font-bold"
                        style={{ color: DARK_NAVY }}
                        title={`Authorized by — ${companyName}`}
                      >
                        Authorized by — {companyName}
                      </p>
                      <p className="text-[8px]" style={{ color: MUTED }}>
                        Signature, Stamp &amp; Date
                        {settings.authorizedSignatory ? ` · ${settings.authorizedSignatory}` : ''}
                      </p>
                    </div>
                    {/* Accepted by — the supplier */}
                    <div className="min-w-0">
                      <div style={{ height: plan.roomy ? '14mm' : '10mm' }} aria-hidden />
                      <div className="border-t-[0.35mm] border-neutral-800" />
                      <p
                        className="mt-[1.2mm] truncate text-[9.5px] font-bold"
                        style={{ color: DARK_NAVY }}
                        title={`Accepted by — ${p.supplierName}`}
                      >
                        Accepted by — Supplier
                      </p>
                      <p className="text-[8px]" style={{ color: MUTED }}>
                        Signature, Stamp &amp; Date · {p.supplierName}
                      </p>
                    </div>
                  </section>

                  <p className="mt-[2mm] text-center text-[8px]" style={{ color: MUTED }}>
                    This is a computer-generated purchase order from {companyName}. Please quote the
                    P.O. number on all deliveries, invoices and correspondence.
                    {orderedBy ? ` Prepared by ${orderedBy}.` : ''}
                  </p>
                </div>
              ) : null}
            </div>

            {/* ── page footer strip ── */}
            <div
              className="pointer-events-none absolute inset-x-[12mm] bottom-[3.5mm] flex items-center justify-between border-t pt-[1mm] text-[8px]"
              style={{ borderColor: BORDER, color: MUTED }}
            >
              <span className="truncate">
                {companyName} · {p.poNumber}
                {p.quotationRef ? ` · Ref ${p.quotationRef}` : ''}
              </span>
              <span className="shrink-0 tabular-nums">
                Page {pageIdx + 1} of {plans.length}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

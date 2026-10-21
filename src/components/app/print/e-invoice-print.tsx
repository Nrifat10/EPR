'use client'

// E-Invoice print preview — the boss's "Mirror EN-AR" A4 portrait template:
// striped letterhead placeholder zones (top/bottom bands), a 3-part mirror
// title row (TAX INVOICE left · navy pill badge with a gold ring holding the
// invoice number center · Arabic title right), a gold rule broken by a centre
// diamond, a cream date & currency bar, SUPPLIER ◆ / CUSTOMER ◆ cards on
// cream headers, a project info strip, a 9-column items table (navy header —
// white English over gold Arabic, gold-ring index circles, horizontal-only
// row separators), the Amount-in-words + bank details split with the totals
// column (navy TOTAL DUE with a gold amount) and the closing row with the
// 32mm ZATCA QR, dual signature lines and a dashed gold stamp circle.
//
// Pagination keeps the proven FLOW-FILL model from quotation-print.tsx:
// EXPLICIT A4 pages (210mm × 296.5mm — the 0.5mm slack prevents blank
// interleaved pages in Chrome's print pipeline), a conservative row-height
// estimator chunks items across pages, the thead repeats on every page, each
// page's leftover room is handed back to its item rows (taller, airier rows),
// a sparse final page gets the roomier bottom treatment, and the bottom split
// + signature row live on the LAST page only. Letterhead artwork, when
// uploaded, replaces the striped placeholder bands on every page; each page
// also carries a "Page X of Y | صفحة X من Y" footer.
//
// The component is purely presentational: the parent (e-invoices view)
// fetches the document, the e-invoice print config (letterhead / margins /
// signature / stamp) and the ZATCA QR data URL and passes them as props —
// no data fetching happens in here (lint forbids fetch-in-effect in dialogs).
import { useState } from 'react'
import { Paperclip, Printer, X } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { usePageRule } from '@/components/app/print/print-page-rule'
import { amountInWordsBoth } from '@/lib/arabic-words'
import { formatNumber, round2 } from '@/lib/format'
import { useAppStore } from '@/lib/store'
import type { AppSettings, EInvoiceConfig, EInvoiceItemRow, EInvoiceRow } from '@/lib/types'

// ── Brand palette (exact codes from the boss) ───────────────────────────────
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

export const DEFAULT_EI_CONFIG: EInvoiceConfig = {
  letterhead: '',
  topMm: 35,
  bottomMm: 22,
  signature: '',
  stamp: '',
  showReceiverSignature: true,
  translateProvider: 'builtin',
  translateApiKeySet: false,
}

// ── A4 pagination geometry ──────────────────────────────────────────────────
const PAGE_W_MM = 210
const PAGE_H_MM = 296.5 // 0.5mm print-pipeline slack (see header comment)
const SIDE_PAD_MM = 8
const FOOTER_MM = 6 // page footer strip reserved above the bottom letterhead band

const DOC_TITLES: Record<string, { en: string; ar: string }> = {
  invoice: { en: 'TAX INVOICE', ar: 'فاتورة ضريبية' },
  credit_note: { en: 'CREDIT NOTE', ar: 'إشعار دائن' },
  debit_note: { en: 'DEBIT NOTE', ar: 'إشعار مدين' },
}

/** Arabic names for the currency cell of the date & currency bar. */
const CURRENCY_AR: Record<string, string> = {
  SAR: 'ريال سعودي',
  USD: 'دولار أمريكي',
  EUR: 'يورو',
  GBP: 'جنيه إسترليني',
  AED: 'درهم إماراتي',
}

/** DD / MM / YYYY — the e-invoice document date format. */
function fmtDate(d: string | null | undefined): string {
  if (!d) return '—'
  const date = new Date(d)
  if (isNaN(date.getTime())) return '—'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(date.getDate())} / ${pad(date.getMonth() + 1)} / ${date.getFullYear()}`
}

/** Quantity: integers stay clean, fractions keep 2 decimals. */
function fmtQty(n: number): string {
  return Number.isInteger(n) ? n.toLocaleString('en-US') : formatNumber(n)
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

/** Rotated status stamp chip — floats over the title row's right side. */
function StatusStamp({ status, overdue }: { status: string; overdue: boolean }) {
  const map: Record<string, { label: string; border: string; color: string }> = {
    draft: { label: 'DRAFT', border: '#737373', color: '#525252' },
    issued: { label: 'ISSUED', border: '#d97706', color: '#b45309' },
    partially_paid: { label: 'PARTIALLY PAID', border: '#0d9488', color: '#0f766e' },
    paid: { label: 'PAID', border: '#059669', color: '#047857' },
  }
  const entry = overdue
    ? { label: 'OVERDUE', border: '#e11d48', color: '#be123c' }
    : (map[status] ?? map.draft)
  return (
    <span
      className="absolute -top-3 right-0 z-20 inline-block rounded border-[2.5px] bg-white/95 px-2 py-px text-[8px] font-black uppercase tracking-[0.18em] shadow-[inset_0_0_0_1.5px_rgba(0,0,0,0.06)]"
      style={{ borderColor: entry.border, color: entry.color, transform: 'rotate(-3deg)' }}
    >
      {entry.label}
    </span>
  )
}

// ── Height estimators (conservative — over-estimate = safe page breaks) ─────
// Calibrated against real Chrome A4 prints of this template (title row ≈ 13mm,
// divider ≈ 2.5mm, date & currency bar ≈ 10mm, supplier/customer cards ≈ 37mm
// + wrapped address lines, project strip ≈ 9.5mm, 2-line thead ≈ 11mm,
// inter-section margins ≈ 10mm).
function estLines(text: string | null | undefined, charsPerLine: number): number {
  if (!text) return 0
  return text
    .split('\n')
    .reduce((n, line) => n + Math.max(1, Math.ceil(line.length / charsPerLine)), 0)
}

function rowHeightMm(it: EInvoiceItemRow): number {
  // Description column ≈ 27% × 194mm ≈ 52mm ≈ 46 latin chars at 8.5px —
  // 42/36 keeps a safety margin against wrap drift (over-estimate = safe
  // page breaks; the page box clips, so never under-estimate).
  const lines = Math.max(
    1,
    estLines(it.descriptionEn, 42),
    estLines(it.descriptionAr, 36),
  )
  return 8 + 3.4 * (lines - 1)
}

// ── Flow-fill pagination constants ───────────────────────────────────────────
// slack kept in reserve when stretching rows (estimator safety)
const STRETCH_SAFE_MM = 5
// per-row stretch cap — keeps the stretched table tasteful
const MAX_ROW_STRETCH = 8
// final-page slack above which the tail gets the roomier treatment
const ROOMY_SLACK_MM = 34
// extra height the roomy treatment adds (tail padding + header breathing —
// over-estimate keeps the row-stretch math from over-allocating; the roomy
// gate ROOMY_SLACK_MM > 34 guarantees this always fits)
const ROOMY_TAIL_DELTA_MM = 12

/** One explicit A4 page: its item chunk, stretched row height, roominess. */
type PagePlan = {
  items: EInvoiceItemRow[]
  /** extra mm handed to every item row on this page (fills the A4 nicely) */
  rowExtraMm: number
  /** sparse final page → roomier bottom sections */
  roomy: boolean
}

/**
 * Flow-fill pagination:
 *   1. chunk items across pages (conservative row estimates → safe breaks);
 *   2. the tail (bottom split + signature row) must fit on the final items
 *      page — if not, it flows to a fresh page that renders FROM THE TOP;
 *   3. hand each page's leftover room back to its item rows (capped), so a
 *      typical invoice fills ONE A4 page instead of ending two-thirds down;
 *   4. flag a sparse final page so the bottom sections can breathe.
 */
function planPages(
  items: EInvoiceItemRow[],
  topMm: number,
  bottomMm: number,
  page1FixedMm: number,
  tailMm: number
): PagePlan[] {
  const availFirst = PAGE_H_MM - topMm - (bottomMm + FOOTER_MM) - page1FixedMm
  const availRest = PAGE_H_MM - topMm - (bottomMm + FOOTER_MM) - 9 // continuation strip

  // 1) greedy chunking
  const chunks: EInvoiceItemRow[][] = []
  let cur: EInvoiceItemRow[] = []
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

  // 2) tail must fit on the final items page — otherwise it gets a fresh page
  const lastAvail = chunks.length === 1 ? availFirst : availRest
  if (used + tailMm > lastAvail) {
    chunks.push([]) // empty items chunk = tail-only page
  }

  // 3) sparse final page → roomier tail (only when the extra height fits)
  const finIdx = chunks.length - 1
  const finCap = finIdx === 0 ? availFirst : availRest
  const finRows = chunks[finIdx].reduce((s, it) => s + rowHeightMm(it), 0)
  const roomy = finCap - finRows - tailMm > ROOMY_SLACK_MM
  const tailEffMm = roomy ? tailMm + ROOMY_TAIL_DELTA_MM : tailMm

  // 4) leftover room → taller, airier rows on every items page
  const pages: PagePlan[] = chunks.map((chunk, i) => {
    const cap = i === 0 ? availFirst : availRest
    const rowsMm = chunk.reduce((s, it) => s + rowHeightMm(it), 0)
    const tailOnPage = i === finIdx ? tailEffMm : 0
    const slack = cap - rowsMm - tailOnPage
    const rowExtraMm =
      chunk.length > 0 && slack > STRETCH_SAFE_MM
        ? Math.min((slack - STRETCH_SAFE_MM) / chunk.length, MAX_ROW_STRETCH)
        : 0
    return { items: chunk, rowExtraMm, roomy: i === finIdx && roomy }
  })

  return pages
}

// ── Print dialog ────────────────────────────────────────────────────────────

/**
 * Full-screen dialog rendering the paginated A4 e-invoice. Parent supplies:
 * the full EInvoiceRow (items included), the e-invoice print config, and the
 * ZATCA QR data URL (null for the unsaved-draft preview → placeholder box).
 * Print button calls window.print() — only the `.print-area` is printed.
 */
export function EInvoicePrintDialog({
  invoice,
  config,
  qrDataUrl,
  open,
  onOpenChange,
}: {
  invoice: EInvoiceRow | null
  config: EInvoiceConfig | null
  qrDataUrl: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const settings = useAppStore((s) => s.settings)
  const [signedOpen, setSignedOpen] = useState(false)

  usePageRule(open, 'size: A4 portrait; margin: 0;')

  const isDraft = !invoice || invoice.id === 'draft'

  function handlePrint() {
    toast.info("Choose 'Save as PDF' in the print dialog for the PDF copy")
    window.print()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[92vh] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-[900px] print:static print:max-h-none print:w-full print:max-w-none print:translate-x-0 print:translate-y-0 print:overflow-visible print:rounded-none print:border-0 print:p-0 print:shadow-none"
      >
        <DialogTitle className="sr-only">E-Invoice print preview</DialogTitle>
        <DialogDescription className="sr-only">
          Printable A4 bilingual tax invoice with letterhead, items, totals, ZATCA QR and signatures.
        </DialogDescription>

        {/* Top button bar — hidden when printing */}
        <div className="print-hidden flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">
              {invoice ? `E-Invoice — ${invoice.invoiceNumber}` : 'E-Invoice'}
              {isDraft && invoice ? (
                <span className="ml-2 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-700">
                  Draft preview
                </span>
              ) : null}
              {invoice && (invoice.zatcaPhase ?? 1) === 2 ? (
                <span className="ml-2 rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
                  Phase 2
                </span>
              ) : null}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              A4 · Bilingual EN/AR · ZATCA QR
              {invoice ? ` · ${invoice.clientNameEn}` : ''}
              {invoice?.zatcaStatus
                ? ` · ZATCA ${invoice.zatcaStatus}${
                    invoice.zatcaSubmittedAt
                      ? ` (${new Date(invoice.zatcaSubmittedAt).toLocaleDateString('en-GB')})`
                      : ''
                  }`
                : ''}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {invoice?.signedCopyImage ? (
              <Button variant="outline" size="sm" onClick={() => setSignedOpen(true)}>
                <Paperclip className="h-4 w-4" />
                Signed copy
              </Button>
            ) : null}
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              <X className="h-4 w-4" />
              Close
            </Button>
            <Button size="sm" onClick={handlePrint} disabled={!invoice}>
              <Printer className="h-4 w-4" />
              Print / Save PDF
            </Button>
          </div>
        </div>

        {/* Scrollable preview area — stacked A4 pages */}
        <div className="nice-scrollbar min-h-0 flex-1 overflow-auto bg-neutral-100 p-4 dark:bg-neutral-900 print:flex-none print:overflow-visible print:bg-transparent print:p-0">
          {invoice ? (
            <EInvoiceDocument
              invoice={invoice}
              config={config ?? DEFAULT_EI_CONFIG}
              settings={settings}
              qrDataUrl={qrDataUrl}
            />
          ) : (
            <div className="flex min-h-[300px] items-center justify-center bg-white p-16 text-sm text-neutral-400">
              No e-invoice selected.
            </div>
          )}
        </div>

        {/* Signed copy preview (proof of delivery) */}
        {invoice?.signedCopyImage ? (
          <Dialog open={signedOpen} onOpenChange={setSignedOpen}>
            <DialogContent className="sm:max-w-md">
              <DialogTitle className="text-base">
                Signed copy — {invoice.invoiceNumber}
              </DialogTitle>
              <DialogDescription>
                Signed / stamped delivery copy attached to this issued e-invoice.
              </DialogDescription>
              <div className="overflow-hidden rounded-lg border bg-white">
                { }
                <img
                  src={invoice.signedCopyImage}
                  alt={`Signed copy of ${invoice.invoiceNumber}`}
                  className="max-h-[60vh] w-full object-contain"
                />
              </div>
            </DialogContent>
          </Dialog>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

// ── The document ────────────────────────────────────────────────────────────

export function EInvoiceDocument({
  invoice,
  config,
  settings,
  qrDataUrl,
}: {
  invoice: EInvoiceRow
  config: EInvoiceConfig
  settings: AppSettings
  qrDataUrl: string | null
}) {
  const currency = settings.currency || 'SAR'
  const inv = invoice
  const items = inv.items ?? []
  const title = DOC_TITLES[inv.docType] ?? DOC_TITLES.invoice
  const companyName = settings.companyName || 'Landmark Inter Gulf'
  const balanceDue = round2(inv.totalDue - inv.paidAmount)

  // Supplier identity from the shared company settings (ZATCA role: supplier)
  const supplier = {
    nameEn: companyName,
    nameAr: settings.companyNameAr || '',
    vat: settings.vatNumber || '',
    cr: settings.crNumber || '',
    addressEn: settings.address || '',
    addressAr: settings.addressAr || '',
  }

  // Actual VAT rate label — mixed rates collapse to a plain "VAT" label
  const rates = [...new Set(items.map((it) => Math.round(it.vatPercent)))]
  const vatLabel = rates.length === 1 ? `${rates[0]}%` : ''

  const words = amountInWordsBoth(inv.totalDue, currency)

  const money = (n: number) => formatNumber(n)

  // ---- pagination ----
  // The letterhead bands are part of this template's design: artwork fills
  // them when uploaded; otherwise the striped placeholder zones print at the
  // configured sizes. Either way the content area honours topMm/bottomMm.
  const topMm = config.topMm
  const bottomMm = config.bottomMm

  // Page-1 fixed sections (title row + divider + date/currency bar + cards +
  // project strip + thead + inter-section gaps). The two party cards sit
  // side-by-side, so only the TALLER card's address wraps drive the height.
  const cardsMm =
    34 +
    Math.max(
      2.6 * estLines(supplier.addressEn, 52) + 2.2 * estLines(supplier.addressAr, 46),
      2.6 * estLines(inv.clientAddressEn, 52) + 2.2 * estLines(inv.clientAddressAr, 46),
    )
  const projectBarMm =
    9 +
    2.4 *
      Math.max(
        estLines(inv.poRef, 18),
        estLines(inv.projectEn, 22),
        estLines(inv.projectAr, 20),
        estLines(inv.paymentTermsEn, 22),
        estLines(inv.paymentTermsAr, 20),
        estLines(inv.paymentMethodEn, 22),
        estLines(inv.paymentMethodAr, 20),
      )
  const page1FixedMm =
    11 + (inv.relatedInvoiceNumber ? 4.5 : 0) + 2.5 + 10.5 + cardsMm + projectBarMm + 8 + 8

  // Tail = bottom split + signature row (last page only)
  const tailMm = 48 + 42 + 4

  const pages = planPages(items, topMm, bottomMm, page1FixedMm, tailMm)

  // ---- table cell styles ----
  // Mirror-template table: navy header (white EN over gold AR), horizontal-
  // only row separators, no vertical body lines.
  const th = 'px-1 py-[3px] text-center align-middle leading-[1.3]'
  const td = 'px-1 py-[3px] align-top text-[8.5px] leading-[1.35] text-neutral-900'
  const tdR = `${td} text-right tabular-nums`

  const currencyAr = CURRENCY_AR[currency] ?? ''
  const printedAt = new Date()

  return (
    <div
      className="print-area mx-auto flex w-full flex-col items-center gap-6 bg-transparent [print-color-adjust:exact] [-webkit-print-color-adjust:exact] print:gap-0"
      style={{ fontFamily: DOC_FONT }}
    >
      {pages.map((plan, pageIdx) => {
        const isLast = pageIdx === pages.length - 1
        const chunk = plan.items
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
            {/* ── letterhead artwork (full-page A4 design, every page) ── */}
            {config.letterhead ? (
              
              <img
                src={config.letterhead}
                alt=""
                aria-hidden
                className="pointer-events-none absolute inset-0 z-0 h-full w-full object-fill"
              />
            ) : (
              <>
                {/* ── striped letterhead placeholder zones (the template look) ── */}
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 top-0 z-0 flex flex-col items-center justify-center gap-[2px]"
                  style={{
                    height: `${topMm}mm`,
                    background: `repeating-linear-gradient(45deg, ${STRIPE_A} 0px, ${STRIPE_A} 5px, #ffffff 5px, #ffffff 11px)`,
                    borderBottom: `1px dashed #C9D2DE`,
                  }}
                >
                  <p className="text-center text-[7.5px] font-semibold uppercase tracking-[0.16em]" style={{ color: STRIPE_CAPTION }}>
                    Letterhead Header Area
                    <span className="mx-1.5 opacity-50">|</span>
                    <span lang="ar" dir="rtl" className="tracking-normal">مساحة رأس الخطاب</span>
                  </p>
                </div>
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 bottom-0 z-0 flex flex-col items-center justify-center gap-[2px]"
                  style={{
                    height: `${bottomMm}mm`,
                    background: `repeating-linear-gradient(45deg, ${STRIPE_A} 0px, ${STRIPE_A} 5px, #ffffff 5px, #ffffff 11px)`,
                    borderTop: `1px dashed #C9D2DE`,
                  }}
                >
                  <p className="text-center text-[7.5px] font-semibold uppercase tracking-[0.16em]" style={{ color: STRIPE_CAPTION }}>
                    Letterhead Footer Area
                    <span className="mx-1.5 opacity-50">|</span>
                    <span lang="ar" dir="rtl" className="tracking-normal">مساحة ذيل الخطاب</span>
                  </p>
                </div>
              </>
            )}

            {/* ── DRAFT watermark (drafts only — subtle, behind content) ── */}
            {inv.status === 'draft' ? (
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
                paddingTop: `${topMm}mm`,
                paddingBottom: `${bottomMm + FOOTER_MM}mm`,
                paddingLeft: `${SIDE_PAD_MM}mm`,
                paddingRight: `${SIDE_PAD_MM}mm`,
              }}
            >
              {pageIdx === 0 ? (
                <>
                  {/* 1 ─ mirror title row: EN title · invoice-no pill badge · AR title */}
                  <div className="relative flex items-center justify-between gap-3">
                    <StatusStamp status={inv.status} overdue={inv.overdue} />
                    <h1
                      className="text-[16px] font-extrabold uppercase leading-[1.15] tracking-[0.05em]"
                      style={{ color: NAVY }}
                    >
                      {title.en}
                    </h1>
                    {/* pill badge — gold ring outside, navy fill inside */}
                    <div className="shrink-0 rounded-full p-[2px]" style={{ background: GOLD }}>
                      <div
                        className={`rounded-full px-5 text-center ${plan.roomy ? 'py-[5px]' : 'py-1'}`}
                        style={{ background: NAVY }}
                      >
                        <p
                          className="whitespace-nowrap text-[6.5px] font-bold uppercase tracking-[0.16em]"
                          style={{ color: LIGHT_GOLD }}
                        >
                          {title.en.includes('TAX') ? 'Invoice No.' : 'Document No.'}{' '}
                          <span lang="ar" dir="rtl" className="tracking-normal">
                            رقم الفاتورة
                          </span>
                        </p>
                        <p className="whitespace-nowrap font-mono text-[12.5px] font-extrabold leading-tight text-white">
                          {inv.invoiceNumber}
                        </p>
                      </div>
                    </div>
                    <h1
                      lang="ar"
                      dir="rtl"
                      className="text-[16px] font-extrabold leading-[1.3]"
                      style={{ color: NAVY }}
                    >
                      {title.ar}
                    </h1>
                  </div>
                  {inv.relatedInvoiceNumber ? (
                    <p className="mt-1 text-center text-[8.5px] font-semibold" style={{ color: MUTED }}>
                      Original Invoice:{' '}
                      <span className="font-mono font-bold" style={{ color: NAVY }}>
                        {inv.relatedInvoiceNumber}
                      </span>
                      <span className="mx-1.5 text-neutral-300">|</span>
                      <span lang="ar" dir="rtl">الفاتورة الأصلية: </span>
                      <span lang="ar" dir="rtl" className="font-mono font-bold" style={{ color: NAVY }}>
                        {inv.relatedInvoiceNumber}
                      </span>
                    </p>
                  ) : null}

                  {/* 2 ─ gold rule broken by a centre diamond */}
                  <div className="mt-2 flex items-center gap-2">
                    <div className="h-[2px] flex-1 rounded-full" style={{ background: GOLD }} />
                    <GoldDiamond size={6} />
                    <div className="h-[2px] flex-1 rounded-full" style={{ background: GOLD }} />
                  </div>

                  {/* 3 ─ date & currency bar (cream, rounded, 4 cells) */}
                  <div
                    className={`mt-2.5 grid grid-cols-4 overflow-hidden rounded-lg border ${plan.roomy ? 'mt-3' : ''}`}
                    style={{ borderColor: BORDER, background: CREAM }}
                  >
                    {(
                      [
                        ['Issue Date', 'تاريخ الإصدار', fmtDate(inv.issueDate)],
                        ['Supply Date', 'تاريخ التوريد', fmtDate(inv.supplyDate)],
                        ['Due Date', 'تاريخ الاستحقاق', fmtDate(inv.dueDate)],
                        ['Currency', 'العملة', currencyAr ? `${currency} · ${currencyAr}` : currency],
                      ] as Array<[string, string, string]>
                    ).map(([en, ar, value]) => (
                      <div
                        key={en}
                        className={`border-r px-1.5 text-center last:border-r-0 ${plan.roomy ? 'py-2.5' : 'py-1.5'}`}
                        style={{ borderColor: BORDER }}
                      >
                        <BiLabel en={en} ar={ar} center />
                        <p
                          className={`mt-0.5 whitespace-nowrap text-[10px] font-bold tabular-nums ${en === 'Currency' ? '' : 'font-mono'}`}
                          style={{ color: NAVY }}
                        >
                          {value}
                        </p>
                      </div>
                    ))}
                  </div>

                  {/* 4 ─ SUPPLIER ◆ | CUSTOMER ◆ cards (cream header, dotted fields) */}
                  <div className={`grid grid-cols-2 gap-2.5 ${plan.roomy ? 'mt-3' : 'mt-2.5'}`}>
                    {(
                      [
                        {
                          label: 'Supplier',
                          labelAr: 'المورد',
                          nameEn: supplier.nameEn,
                          nameAr: supplier.nameAr,
                          vat: supplier.vat,
                          cr: supplier.cr,
                          addressEn: supplier.addressEn,
                          addressAr: supplier.addressAr,
                        },
                        {
                          label: 'Customer',
                          labelAr: 'العميل',
                          nameEn: inv.clientNameEn,
                          nameAr: inv.clientNameAr,
                          vat: inv.clientVatNumber,
                          cr: inv.clientCrNumber,
                          addressEn: inv.clientAddressEn,
                          addressAr: inv.clientAddressAr,
                        },
                      ] as Array<{
                        label: string
                        labelAr: string
                        nameEn: string
                        nameAr: string
                        vat: string | null
                        cr: string | null
                        addressEn: string | null
                        addressAr: string | null
                      }>
                    ).map((box) => (
                      <div
                        key={box.label}
                        className="overflow-hidden rounded-lg border"
                        style={{ borderColor: BORDER, background: 'white' }}
                      >
                        <div
                          className="flex items-center justify-center gap-2 border-b px-2.5 py-[5px]"
                          style={{ borderColor: BORDER, background: CREAM }}
                        >
                          <p
                            className="text-[8.5px] font-extrabold uppercase tracking-[0.18em]"
                            style={{ color: DARK_GOLD }}
                          >
                            {box.label}
                          </p>
                          <GoldDiamond size={5} />
                          <p
                            lang="ar"
                            dir="rtl"
                            className="text-[9.5px] font-bold leading-none"
                            style={{ color: DARK_GOLD }}
                          >
                            {box.labelAr}
                          </p>
                        </div>
                        <div className={`px-2.5 ${plan.roomy ? 'space-y-1.5 py-2.5' : 'space-y-1 py-2'}`}>
                          <p className="text-[10.5px] font-bold leading-snug" style={{ color: NAVY }}>
                            {box.nameEn || '—'}
                          </p>
                          {box.nameAr ? (
                            <p
                              lang="ar"
                              dir="rtl"
                              className="text-[10px] font-semibold leading-snug"
                              style={{ color: NAVY }}
                            >
                              {box.nameAr}
                            </p>
                          ) : null}
                          <div
                            className="space-y-[3px] border-t border-dotted pt-1 text-[8.5px] leading-[1.4]"
                            style={{ borderColor: '#C7CFDC' }}
                          >
                            <p>
                              <span className="font-semibold" style={{ color: MUTED }}>
                                VAT No. <span lang="ar" dir="rtl">الرقم الضريبي</span>:{' '}
                              </span>
                              <span className="font-mono font-semibold">{box.vat || '—'}</span>
                            </p>
                            <p>
                              <span className="font-semibold" style={{ color: MUTED }}>
                                C.R. No. <span lang="ar" dir="rtl">السجل التجاري</span>:{' '}
                              </span>
                              <span className="font-mono font-semibold">{box.cr || '—'}</span>
                            </p>
                            <p>
                              <span className="font-semibold" style={{ color: MUTED }}>
                                Address <span lang="ar" dir="rtl">العنوان</span>:{' '}
                              </span>
                              <span className="text-neutral-800">{box.addressEn || '—'}</span>
                            </p>
                            {box.addressAr ? (
                              <p lang="ar" dir="rtl" className="text-neutral-800">
                                {box.addressAr}
                              </p>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* 5 ─ project info strip (P.O. · Project · Terms · Method) */}
                  <div
                    className={`grid grid-cols-4 overflow-hidden rounded-lg border ${plan.roomy ? 'mt-3' : 'mt-2.5'}`}
                    style={{ borderColor: BORDER, background: CREAM }}
                  >
                    <div
                      className={`border-r px-1.5 text-center last:border-r-0 ${plan.roomy ? 'py-2.5' : 'py-1.5'}`}
                      style={{ borderColor: BORDER }}
                    >
                      <BiLabel en="P.O. / Contract Ref" ar="رقم أمر الشراء" center />
                      <p className="mt-0.5 break-words text-[9px] font-bold" style={{ color: NAVY }}>
                        {inv.poRef || '—'}
                      </p>
                      {inv.contractRef ? (
                        <p className="break-words text-[8px]" style={{ color: MUTED }}>
                          Contract <span lang="ar" dir="rtl">العقد</span>: {inv.contractRef}
                        </p>
                      ) : null}
                    </div>
                    <div
                      className={`border-r px-1.5 text-center last:border-r-0 ${plan.roomy ? 'py-2.5' : 'py-1.5'}`}
                      style={{ borderColor: BORDER }}
                    >
                      <BiLabel en="Project" ar="المشروع" center />
                      <p className="mt-0.5 break-words text-[9px] font-semibold" style={{ color: NAVY }}>
                        {inv.projectEn || '—'}
                      </p>
                      {inv.projectAr ? (
                        <p
                          lang="ar"
                          dir="rtl"
                          className="break-words text-[8.5px]"
                          style={{ color: MUTED }}
                        >
                          {inv.projectAr}
                        </p>
                      ) : null}
                    </div>
                    <div
                      className={`border-r px-1.5 text-center last:border-r-0 ${plan.roomy ? 'py-2.5' : 'py-1.5'}`}
                      style={{ borderColor: BORDER }}
                    >
                      <BiLabel en="Payment Terms" ar="شروط الدفع" center />
                      <p className="mt-0.5 break-words text-[9px] font-semibold" style={{ color: NAVY }}>
                        {inv.paymentTermsEn || '—'}
                      </p>
                      {inv.paymentTermsAr ? (
                        <p
                          lang="ar"
                          dir="rtl"
                          className="break-words text-[8.5px]"
                          style={{ color: MUTED }}
                        >
                          {inv.paymentTermsAr}
                        </p>
                      ) : null}
                    </div>
                    <div className={`px-1.5 text-center ${plan.roomy ? 'py-2.5' : 'py-1.5'}`}>
                      <BiLabel en="Payment Method" ar="طريقة الدفع" center />
                      <p className="mt-0.5 break-words text-[9px] font-semibold" style={{ color: NAVY }}>
                        {inv.paymentMethodEn || '—'}
                      </p>
                      {inv.paymentMethodAr ? (
                        <p
                          lang="ar"
                          dir="rtl"
                          className="break-words text-[8.5px]"
                          style={{ color: MUTED }}
                        >
                          {inv.paymentMethodAr}
                        </p>
                      ) : null}
                    </div>
                  </div>

                  {/* 6 ─ items table heading spacing */}
                  <div className={plan.roomy ? 'mt-3' : 'mt-2.5'} />
                </>
              ) : (
                /* continuation header on EVERY later page (items or tail-only) */
                <div className="flex items-baseline justify-between border-b pb-1" style={{ borderColor: BORDER }}>
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: NAVY }}>
                    {companyName} — {title.en} <span className="font-mono">{inv.invoiceNumber}</span>
                  </p>
                  <p className="text-[8.5px] italic" style={{ color: MUTED }}>
                    continued · <span lang="ar" dir="rtl">تابع</span>
                  </p>
                </div>
              )}

              {/* 6 ─ items chunk — mirror-template table (thead repeats, tail-only pages skip) */}
              {chunk.length > 0 || pageIdx === 0 ? (
                <div
                  className="overflow-hidden rounded-lg border"
                  style={{ borderColor: BORDER, background: 'white' }}
                >
                  <table className="w-full table-fixed border-collapse" style={{ tableLayout: 'fixed' }}>
                    <colgroup>
                      <col style={{ width: '4.5%' }} />
                      <col style={{ width: '27%' }} />
                      <col style={{ width: '7.5%' }} />
                      <col style={{ width: '6.5%' }} />
                      <col style={{ width: '9.5%' }} />
                      <col style={{ width: '8.5%' }} />
                      <col style={{ width: '11%' }} />
                      <col style={{ width: '12.5%' }} />
                      <col style={{ width: '13%' }} />
                    </colgroup>
                    <thead style={{ display: 'table-header-group', background: DARK_NAVY }}>
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
                          <p className="text-[7.5px] font-bold text-white">Unit</p>
                          <p lang="ar" dir="rtl" className="text-[7px] font-semibold" style={{ color: LIGHT_GOLD }}>
                            الوحدة
                          </p>
                        </th>
                        <th className={th}>
                          <p className="text-[7.5px] font-bold text-white">Qty</p>
                          <p lang="ar" dir="rtl" className="text-[7px] font-semibold" style={{ color: LIGHT_GOLD }}>
                            الكمية
                          </p>
                        </th>
                        <th className={th}>
                          <p className="text-[7.5px] font-bold text-white">Unit Price</p>
                          <p lang="ar" dir="rtl" className="text-[7px] font-semibold" style={{ color: LIGHT_GOLD }}>
                            سعر الوحدة
                          </p>
                        </th>
                        <th className={th}>
                          <p className="text-[7.5px] font-bold text-white">Discount</p>
                          <p lang="ar" dir="rtl" className="text-[7px] font-semibold" style={{ color: LIGHT_GOLD }}>
                            الخصم
                          </p>
                        </th>
                        <th className={th}>
                          <p className="text-[7.5px] font-bold text-white">Taxable</p>
                          <p lang="ar" dir="rtl" className="text-[7px] font-semibold" style={{ color: LIGHT_GOLD }}>
                            القيمة الخاضعة
                          </p>
                        </th>
                        <th className={th}>
                          <p className="text-[7.5px] font-bold text-white">{`VAT${vatLabel ? ` ${vatLabel}` : ''}`}</p>
                          <p lang="ar" dir="rtl" className="text-[7px] font-semibold" style={{ color: LIGHT_GOLD }}>
                            الضريبة
                          </p>
                        </th>
                        <th className={th}>
                          <p className="text-[7.5px] font-bold text-white">{`Total (${currency})`}</p>
                          <p lang="ar" dir="rtl" className="text-[7px] font-semibold" style={{ color: LIGHT_GOLD }}>
                            الإجمالي
                          </p>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {chunk.length === 0 ? (
                        <tr>
                          <td
                            className={`${td} border-b py-2 text-center text-neutral-400`}
                            colSpan={9}
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
                              // flow-fill: leftover page room → taller, airier rows
                              ...(plan.rowExtraMm > 0.4
                                ? { height: `${rowHeightMm(it) + plan.rowExtraMm}mm` }
                                : null),
                            }}
                          >
                            <td
                              className={`${td} border-b text-center`}
                              style={{ borderColor: ROW_SEP }}
                            >
                              {/* index inside a thin gold ring — the template's touch */}
                              <span
                                className="inline-flex h-[13px] w-[13px] items-center justify-center rounded-full border-[1.3px] text-[7.5px] font-bold tabular-nums"
                                style={{ borderColor: GOLD, color: NAVY }}
                              >
                                {it.sr}
                              </span>
                            </td>
                            <td className={`${td} border-b`} style={{ borderColor: ROW_SEP }}>
                              <p className="text-neutral-900">{it.descriptionEn}</p>
                              {it.descriptionAr ? (
                                <p
                                  lang="ar"
                                  dir="rtl"
                                  className="mt-px text-[8px]"
                                  style={{ color: MUTED }}
                                >
                                  {it.descriptionAr}
                                </p>
                              ) : null}
                            </td>
                            <td className={`${td} border-b text-center`} style={{ borderColor: ROW_SEP }}>
                              <p>{it.unitEn || '—'}</p>
                              {it.unitAr ? (
                                <p
                                  lang="ar"
                                  dir="rtl"
                                  className="text-[7.5px]"
                                  style={{ color: MUTED }}
                                >
                                  {it.unitAr}
                                </p>
                              ) : null}
                            </td>
                            <td className={`${tdR} border-b`} style={{ borderColor: ROW_SEP }}>
                              {fmtQty(it.quantity)}
                            </td>
                            <td className={`${tdR} border-b`} style={{ borderColor: ROW_SEP }}>
                              {money(it.unitPrice)}
                            </td>
                            <td className={`${tdR} border-b`} style={{ borderColor: ROW_SEP }}>
                              {it.discount > 0 ? `-${money(it.discount)}` : '—'}
                            </td>
                            <td className={`${tdR} border-b`} style={{ borderColor: ROW_SEP }}>
                              {money(it.taxableAmount)}
                            </td>
                            <td className={`${tdR} border-b`} style={{ borderColor: ROW_SEP }}>
                              {money(it.vatAmount)}
                              {rates.length > 1 ? (
                                <p className="text-[7px]" style={{ color: MUTED }}>
                                  {Math.round(it.vatPercent)}%
                                </p>
                              ) : null}
                            </td>
                            <td
                              className={`${tdR} border-b font-bold`}
                              style={{ borderColor: ROW_SEP }}
                            >
                              {money(it.lineTotal)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              ) : null}

              {/* 7 + 8 ─ bottom split + signature row — last page only.
                  Shares the items page → pinned to the page foot (mt-auto);
                  fresh tail-only page → flows from the top (no top void). */}
              {isLast ? (
                <div className={`${chunk.length > 0 ? 'mt-auto ' : ''}flex flex-col`}>
                  <div className="mt-3 grid grid-cols-5 gap-2.5 break-inside-avoid">
                    {/* ── left column (60%): amount in words + bank details ── */}
                    <div className={`col-span-3 ${plan.roomy ? 'space-y-2.5' : 'space-y-2'}`}>
                      <div
                        className={`rounded-lg border ${plan.roomy ? 'p-3.5' : 'p-2.5'}`}
                        style={{ borderColor: BORDER, background: 'white' }}
                      >
                        <p
                          className="flex items-center gap-2 text-[8px] font-extrabold uppercase tracking-[0.14em]"
                          style={{ color: DARK_GOLD }}
                        >
                          Amount in Words
                          <GoldDiamond size={4} />
                          <span lang="ar" dir="rtl" className="tracking-normal">
                            المبلغ كتابةً
                          </span>
                        </p>
                        <p
                          className="mt-1 text-[9.5px] font-semibold leading-snug"
                          style={{ color: NAVY }}
                        >
                          {words.en}
                        </p>
                        <p
                          lang="ar"
                          dir="rtl"
                          className="mt-0.5 text-[10.5px] font-semibold leading-snug"
                          style={{ color: NAVY }}
                        >
                          {words.ar}
                        </p>
                      </div>

                      <div
                        className={`rounded-lg border ${plan.roomy ? 'p-3.5' : 'p-2.5'}`}
                        style={{ borderColor: BORDER, background: 'white' }}
                      >
                        <p
                          className="flex items-center gap-2 text-[8px] font-extrabold uppercase tracking-[0.14em]"
                          style={{ color: DARK_GOLD }}
                        >
                          Bank Details
                          <GoldDiamond size={4} />
                          <span lang="ar" dir="rtl" className="tracking-normal">
                            بيانات البنك
                          </span>
                        </p>
                        {settings.bankName ||
                        settings.bankIban ||
                        settings.bankAccountNumber ||
                        settings.bankAccountName ||
                        settings.bankSwiftCode ? (
                          <div
                            className={`mt-1.5 grid grid-cols-2 gap-x-4 ${plan.roomy ? 'gap-y-2' : 'gap-y-1.5'} text-[8.5px] leading-[1.35]`}
                          >
                            <div>
                              <p className="font-semibold" style={{ color: MUTED }}>
                                Account Name · <span lang="ar" dir="rtl">اسم الحساب</span>
                              </p>
                              <p className="font-semibold" style={{ color: NAVY }}>
                                {settings.bankAccountName || '—'}
                              </p>
                            </div>
                            <div>
                              <p className="font-semibold" style={{ color: MUTED }}>
                                Bank · <span lang="ar" dir="rtl">البنك</span>
                              </p>
                              <p className="font-semibold" style={{ color: NAVY }}>
                                {settings.bankName || '—'}
                              </p>
                            </div>
                            <div>
                              <p className="font-semibold" style={{ color: MUTED }}>
                                Account No. · <span lang="ar" dir="rtl">رقم الحساب</span>
                              </p>
                              <p className="font-mono font-semibold" style={{ color: NAVY }}>
                                {settings.bankAccountNumber || '—'}
                              </p>
                            </div>
                            <div>
                              <p className="font-semibold" style={{ color: MUTED }}>
                                SWIFT · <span lang="ar" dir="rtl">السويفت</span>
                              </p>
                              <p className="font-mono font-semibold" style={{ color: NAVY }}>
                                {settings.bankSwiftCode || '—'}
                              </p>
                            </div>
                            <div className="col-span-2">
                              <p className="font-semibold" style={{ color: MUTED }}>
                                IBAN · <span lang="ar" dir="rtl">الآيبان</span>
                              </p>
                              <p className="break-all font-mono font-semibold" style={{ color: NAVY }}>
                                {settings.bankIban || '—'}
                              </p>
                            </div>
                          </div>
                        ) : (
                          <p className="mt-1 text-[8.5px]" style={{ color: MUTED }}>
                            —
                          </p>
                        )}
                      </div>
                    </div>

                    {/* ── right column (40%): totals box ── */}
                    <div
                      className="col-span-2 overflow-hidden rounded-lg border"
                      style={{ borderColor: BORDER, background: 'white' }}
                    >
                      {(
                        [
                          ['Subtotal', 'المجموع', money(inv.subtotal)],
                          ['Discount', 'الخصم', inv.totalDiscount > 0 ? `-${money(inv.totalDiscount)}` : money(0)],
                          ['Taxable Amount', 'المبلغ الخاضع للضريبة', money(inv.taxableAmount)],
                          [`VAT ${vatLabel}`.trim(), 'ضريبة القيمة المضافة', money(inv.vatAmount)],
                        ] as Array<[string, string, string]>
                      ).map(([en, ar, value]) => (
                        <div
                          key={en}
                          className={`flex items-center justify-between gap-2 border-b px-2.5 ${plan.roomy ? 'py-[7px]' : 'py-[5px]'} text-[9px]`}
                          style={{ borderColor: BORDER, background: LIGHT_BG }}
                        >
                          <span className="font-semibold" style={{ color: MUTED }}>
                            {en} <span lang="ar" dir="rtl">{ar}</span>
                          </span>
                          <span className="font-semibold tabular-nums" style={{ color: NAVY }}>
                            {value}
                          </span>
                        </div>
                      ))}
                      {/* TOTAL DUE — navy row, white label, gold amount */}
                      <div
                        className={`flex items-center justify-between gap-2 border-b px-2.5 ${plan.roomy ? 'py-[9px]' : 'py-[7px]'}`}
                        style={{ borderColor: BORDER, background: DARK_NAVY }}
                      >
                        <span
                          className="text-[9.5px] font-extrabold uppercase tracking-wide text-white"
                        >
                          Total Due <span lang="ar" dir="rtl" className="tracking-normal">الإجمالي المستحق</span>
                        </span>
                        <span
                          className="text-[13px] font-extrabold tabular-nums"
                          style={{ color: LIGHT_GOLD }}
                        >
                          {money(inv.totalDue)}
                        </span>
                      </div>
                      <div
                        className={`flex items-center justify-between gap-2 border-b px-2.5 ${plan.roomy ? 'py-[7px]' : 'py-[5px]'} text-[9px]`}
                        style={{ borderColor: BORDER, background: 'white' }}
                      >
                        <span className="font-semibold" style={{ color: MUTED }}>
                          Amount Paid <span lang="ar" dir="rtl">المدفوع</span>
                        </span>
                        <span className="font-semibold tabular-nums" style={{ color: NAVY }}>
                          {money(inv.paidAmount)}
                        </span>
                      </div>
                      <div
                        className={`flex items-center justify-between gap-2 px-2.5 ${plan.roomy ? 'py-[8px]' : 'py-[6px]'} text-[9.5px]`}
                        style={{ background: LIGHT_BG }}
                      >
                        <span className="font-bold" style={{ color: NAVY }}>
                          Balance Due <span lang="ar" dir="rtl">الرصيد المستحق</span>
                        </span>
                        <span className="font-extrabold tabular-nums" style={{ color: NAVY }}>
                          {money(balanceDue)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* 8 ─ signature row: QR | Receiver | Authorized | dashed stamp */}
                  <div
                    className={`mt-3 grid items-end ${plan.roomy ? 'gap-4' : 'gap-3'} ${
                      inv.showReceiverSignature ? 'grid-cols-4' : 'grid-cols-3'
                    }`}
                  >
                    {/* ZATCA QR — 32×32mm, pure black/white, no frame inside the quiet zone */}
                    <div className="flex flex-col items-center">
                      {qrDataUrl ? (
                        
                        <img
                          src={qrDataUrl}
                          alt="ZATCA QR code"
                          style={{ width: '32mm', height: '32mm' }}
                        />
                      ) : (
                        <div
                          className="flex flex-col items-center justify-center gap-1 rounded border border-dashed p-2 text-center"
                          style={{ width: '32mm', height: '32mm', borderColor: BORDER }}
                        >
                          <span className="text-[7px] font-semibold" style={{ color: MUTED }}>
                            QR available
                            <br />
                            after save
                          </span>
                          <span lang="ar" dir="rtl" className="text-[7px]" style={{ color: MUTED }}>
                            الرمز بعد الحفظ
                          </span>
                        </div>
                      )}
                      <p className="mt-1 text-center text-[7px] leading-tight" style={{ color: MUTED }}>
                        Scan to verify <span className="mx-0.5 text-neutral-300">|</span>{' '}
                        <span lang="ar" dir="rtl">امسح للتحقق</span>
                      </p>
                    </div>

                    {/* Receiver signature (only when enabled) */}
                    {inv.showReceiverSignature ? (
                      <div className="flex flex-col justify-end">
                        <p className="text-center text-[8px] font-bold" style={{ color: NAVY }}>
                          Receiver Signature <span className="mx-1 text-neutral-300">|</span>{' '}
                          <span lang="ar" dir="rtl">توقيع المستلم</span>
                        </p>
                        <div
                          className={`${plan.roomy ? 'mt-12' : 'mt-9'} w-full border-t-2`}
                          style={{ borderColor: NAVY }}
                        />
                        <p className="mt-1 text-center text-[7px]" style={{ color: MUTED }}>
                          Name &amp; Date <span className="mx-1 text-neutral-300">|</span>{' '}
                          <span lang="ar" dir="rtl">الاسم والتاريخ</span>
                        </p>
                      </div>
                    ) : null}

                    {/* Authorized signature */}
                    <div className="flex flex-col justify-end">
                      <div className={`${plan.roomy ? 'h-14' : 'h-12'} flex items-end justify-center`}>
                        {config.signature ? (
                          
                          <img
                            src={config.signature}
                            alt="Authorized signature"
                            className={`${plan.roomy ? 'max-h-14' : 'max-h-12'} object-contain`}
                          />
                        ) : null}
                      </div>
                      <div className="mt-1 w-full border-t-2" style={{ borderColor: NAVY }} />
                      <p className="mt-1 text-center text-[8px] font-bold" style={{ color: NAVY }}>
                        Authorized Signature <span className="mx-1 text-neutral-300">|</span>{' '}
                        <span lang="ar" dir="rtl">التوقيع المعتمد</span>
                      </p>
                      <p className="text-center text-[7px]" style={{ color: MUTED }}>
                        Name &amp; Date <span className="mx-1 text-neutral-300">|</span>{' '}
                        <span lang="ar" dir="rtl">الاسم والتاريخ</span>
                      </p>
                    </div>

                    {/* Company stamp — dashed gold circle, per the template */}
                    <div className="flex flex-col items-center justify-end">
                      <div
                        className={`${plan.roomy ? 'h-24 w-24' : 'h-20 w-20'} flex items-center justify-center overflow-hidden rounded-full border-2 border-dashed`}
                        style={{ borderColor: GOLD }}
                      >
                        {config.stamp ? (
                          
                          <img
                            src={config.stamp}
                            alt="Company stamp"
                            className={`${plan.roomy ? 'h-[86px] w-[86px]' : 'h-[70px] w-[70px]'} object-contain`}
                          />
                        ) : (
                          <p
                            className="px-2 text-center text-[6px] font-bold uppercase leading-[1.3]"
                            style={{ color: DARK_GOLD }}
                          >
                            Company Stamp
                            <br />
                            <span lang="ar" dir="rtl" className="normal-case">
                              ختم الشركة
                            </span>
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            {/* ── page footer strip — sits above the reserved bottom band ── */}
            <div
              className="pointer-events-none absolute inset-x-[8mm] flex items-center justify-between border-t pt-[1mm] text-[7px]"
              style={{ bottom: `${bottomMm + 1}mm`, borderColor: BORDER, color: MUTED }}
            >
              <span className="truncate">
                {companyName} · {inv.invoiceNumber}
              </span>
              <span className="shrink-0 tabular-nums">
                Page {pageIdx + 1} of {pages.length} <span className="mx-0.5 text-neutral-300">|</span>{' '}
                <span lang="ar" dir="rtl">
                  صفحة {pageIdx + 1} من {pages.length}
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

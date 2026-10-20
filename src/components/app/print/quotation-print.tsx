'use client'

// Quotation print preview — A4 portrait business document for a single
// quotation. Opened from the Quotations table (Print button per row).
// Rendered inside a full-screen dialog following the advance-receipt shell:
// the document is wrapped in `.print-area` (globals.css) so window.print()
// outputs ONLY the quotation, always white/black for print fidelity.
// Company letterhead (logo + name + address from settings), quote info,
// client block, items table, totals with VAT, notes & terms, signature lines.
import { Printer, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { usePageRule } from '@/components/app/print/print-page-rule'
import { formatDate, formatMoney, round2 } from '@/lib/format'
import { useAppStore } from '@/lib/store'
import type { AppSettings, QuotationRow } from '@/lib/types'

/** Full quotation as returned by GET /api/quotations/[id] (items + linked client). */
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
  } | null
}

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
  return `${toWords(Math.floor(n / 1_000_000))} Million${n % 1_000_000 ? ` ${toWords(n % 1_000_000)}` : ''}`
}

function amountInWords(amount: number, currency: string): string {
  const rounded = Math.round(amount * 100) / 100
  const units = Math.floor(rounded)
  const halalas = Math.round((rounded - units) * 100)
  let s = `${currency} ${toWords(units)}`
  if (halalas > 0) s += ` and ${toWords(halalas)} Halalas`
  return `${s} Only`
}

/** Status stamp — rotated bordered chip on the document header. */
function StatusStamp({ status }: { status: string }) {
  const styles: Record<string, string> = {
    accepted:
      'border-emerald-600 text-emerald-700 shadow-[inset_0_0_0_1.5px_rgba(5,150,105,0.35)]',
    sent: 'border-sky-600 text-sky-700 shadow-[inset_0_0_0_1.5px_rgba(2,132,199,0.35)]',
    rejected: 'border-rose-600 text-rose-700 shadow-[inset_0_0_0_1.5px_rgba(225,29,72,0.35)]',
    expired: 'border-amber-500 text-amber-600 shadow-[inset_0_0_0_1.5px_rgba(217,119,6,0.35)]',
    draft: 'border-neutral-500 text-neutral-600 shadow-[inset_0_0_0_1.5px_rgba(115,115,115,0.3)]',
  }
  const labels: Record<string, string> = {
    accepted: 'Accepted',
    sent: 'Sent',
    rejected: 'Rejected',
    expired: 'Expired',
    draft: 'Draft',
  }
  return (
    <span
      className={`mt-2 inline-block -rotate-6 rounded-md border-[3px] px-2.5 py-0.5 text-xs font-black uppercase tracking-[0.2em] ${styles[status] ?? styles.draft}`}
    >
      {labels[status] ?? status}
    </span>
  )
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">{label}</p>
      <p className="truncate text-sm font-medium text-neutral-900" title={value}>
        {value}
      </p>
    </div>
  )
}

function SignatureBlock({ label, name, sub }: { label: string; name: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <div className="flex h-12 items-end">
        <div className="w-full border-t border-neutral-800" />
      </div>
      <p className="mt-1.5 text-[11px] font-bold uppercase tracking-widest text-neutral-900">{label}</p>
      {name ? (
        <p className="truncate text-sm font-semibold text-neutral-900" title={name}>
          {name}
        </p>
      ) : (
        <p className="text-sm italic text-neutral-400">Signature &amp; name</p>
      )}
      {sub ? (
        <p className="truncate text-xs text-neutral-500" title={sub}>
          {sub}
        </p>
      ) : null}
      <p className="mt-1 text-xs text-neutral-500">Date: ______________</p>
    </div>
  )
}

/**
 * Full-screen dialog rendering an A4-style quotation document.
 * Print button calls window.print() — only the `.print-area` is printed.
 */
export function QuotationPrintDialog({
  quotation,
  open,
  onOpenChange,
}: {
  quotation: QuotationDetail | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const settings = useAppStore((s) => s.settings)
  const user = useAppStore((s) => s.user)
  usePageRule(open, 'size: A4 portrait; margin: 12mm;')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[92vh] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl print:static print:max-h-none print:w-full print:max-w-none print:translate-x-0 print:translate-y-0 print:overflow-visible print:rounded-none print:border-0 print:p-0 print:shadow-none"
      >
        <DialogTitle className="sr-only">Quotation print preview</DialogTitle>
        <DialogDescription className="sr-only">
          Printable A4 quotation with company letterhead, line items, totals, terms and signature
          lines.
        </DialogDescription>

        {/* Top button bar — hidden when printing */}
        <div className="print-hidden flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">
              {quotation ? `Quotation — ${quotation.quoteNumber}` : 'Quotation'}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {quotation
                ? `${quotation.clientName} · ${formatMoney(quotation.total, settings.currency || 'SAR')}`
                : 'Select a quotation to preview the document'}
            </p>
          </div>
          <div className="flex items-center gap-2">
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

        {/* Scrollable preview area */}
        <div className="nice-scrollbar min-h-0 flex-1 overflow-auto bg-neutral-100 p-4 dark:bg-neutral-900 print:flex-none print:overflow-visible print:bg-transparent print:p-0">
          {quotation ? (
            <QuotationDocument quotation={quotation} settings={settings} preparedBy={user?.name ?? ''} />
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

function QuotationDocument({
  quotation,
  settings,
  preparedBy,
}: {
  quotation: QuotationDetail
  settings: AppSettings
  preparedBy: string
}) {
  const currency = settings.currency || 'SAR'
  const q = quotation
  const companyName = settings.companyName || 'Landmark Inter Gulf'
  const client = q.client
  const vatPercent = Math.round(q.vatRate * 100)
  const items = q.items ?? []
  const netTotal = round2(q.subtotal - q.discount)
  const money = (n: number) => formatMoney(n, currency)

  const th =
    'border border-neutral-300 bg-neutral-100 px-1.5 py-1.5 text-left font-semibold text-neutral-800'
  const thR = `${th} text-right`
  const td = 'border border-neutral-300 px-1.5 py-1.5 align-top text-neutral-900'
  const tdR = `${td} text-right tabular-nums`

  return (
    <div className="print-area relative mx-auto w-full min-w-[680px] max-w-[210mm] bg-white p-6 text-neutral-900 shadow-sm sm:min-w-0 [print-color-adjust:exact] [-webkit-print-color-adjust:exact]">
      {/* HEADER — brand letterhead: logo mark + navy rule + gold accent */}
      <header className="flex flex-col gap-4 border-b-2 border-[#0F1F3D] pb-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-4">
          <img
            src={settings.logo ?? '/logo-mark.png'}
            alt={`${companyName} logo`}
            className="h-20 w-20 shrink-0 object-contain"
          />
          <div className="min-w-0">
            <h2 className="text-xl font-bold uppercase tracking-wide text-[#0F1F3D]">{companyName}</h2>
            {settings.address ? (
              <p className="mt-1 max-w-[340px] text-xs leading-relaxed text-neutral-500">{settings.address}</p>
            ) : null}
            <div className="mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-neutral-500">
              {settings.phone ? <span>Tel: {settings.phone}</span> : null}
              {settings.email ? <span>Email: {settings.email}</span> : null}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3 sm:flex-col sm:items-end sm:gap-2">
          <span className="rounded-md border-l-4 border-[#D4AF37] bg-[#0F1F3D] px-3 py-1.5 text-xs font-bold tracking-widest text-white">
            QUOTATION
          </span>
          <span className="text-xs font-medium text-neutral-600">
            Quote No: <span className="font-mono font-semibold">{q.quoteNumber}</span>
          </span>
          <span className="text-xs text-neutral-600">Issue Date: {formatDate(q.issueDate)}</span>
          {q.validityDate ? (
            <span className="text-xs text-neutral-600">Valid Until: {formatDate(q.validityDate)}</span>
          ) : null}
          <StatusStamp status={q.status} />
        </div>
      </header>
      {/* gold accent segment under the navy header rule */}
      <div className="mt-[3px] h-[3px] w-24 bg-[#D4AF37]" aria-hidden />

      {/* CLIENT + SUBJECT BLOCK */}
      <section className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 rounded-lg border border-neutral-200 bg-neutral-50 p-4 sm:grid-cols-3">
        <div className="sm:col-span-1">
          <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">
            Quotation For
          </p>
          <p className="mt-0.5 text-base font-bold text-[#0F1F3D]">{q.clientName}</p>
          {client?.contactPerson ? (
            <p className="text-xs text-neutral-600">Attn: {client.contactPerson}</p>
          ) : null}
          {client?.phone ? <p className="text-xs text-neutral-600">Tel: {client.phone}</p> : null}
          {client?.email ? <p className="text-xs text-neutral-600">Email: {client.email}</p> : null}
          {client?.address || client?.city ? (
            <p className="mt-0.5 text-xs leading-relaxed text-neutral-600">
              {[client?.address, client?.city].filter(Boolean).join(', ')}
            </p>
          ) : null}
          {client?.crNumber ? (
            <p className="text-xs text-neutral-600">CR No: {client.crNumber}</p>
          ) : null}
        </div>
        <div className="sm:col-span-2">
          <InfoItem label="Subject" value={q.subject || '—'} />
        </div>
      </section>

      {/* ITEMS TABLE */}
      <section className="mt-4">
        <h3 className="mb-2 text-xs font-bold uppercase tracking-widest text-neutral-500">
          Description of Goods / Services
        </h3>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className={`${th} w-[36px]`}>Sr</th>
              <th className={th}>Description</th>
              <th className={`${th} w-[70px]`}>Unit</th>
              <th className={`${thR} w-[60px]`}>Qty</th>
              <th className={`${thR} w-[95px]`}>Unit Price</th>
              <th className={`${thR} w-[105px]`}>Line Total</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td className={td} colSpan={6}>
                  No line items recorded.
                </td>
              </tr>
            ) : (
              items.map((it) => (
                <tr key={it.id ?? it.sr} className="break-inside-avoid">
                  <td className={`${td} text-center tabular-nums`}>{it.sr}</td>
                  <td className={td}>{it.description}</td>
                  <td className={td}>{it.unit ?? '—'}</td>
                  <td className={tdR}>{it.quantity.toLocaleString('en-US')}</td>
                  <td className={tdR}>{money(it.unitPrice)}</td>
                  <td className={`${tdR} font-semibold`}>{money(it.lineTotal)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      {/* TOTALS */}
      <section className="mt-4 break-inside-avoid">
        <div className="ml-auto w-full max-w-[340px] sm:w-[340px]">
          <table className="w-full border-collapse text-sm">
            <tbody>
              <tr>
                <td className="border border-neutral-300 bg-neutral-50 px-2.5 py-1.5 font-medium">
                  Subtotal
                </td>
                <td className={`${tdR} border border-neutral-300 px-2.5 py-1.5`}>{money(q.subtotal)}</td>
              </tr>
              {q.discount > 0 ? (
                <tr>
                  <td className="border border-neutral-300 bg-neutral-50 px-2.5 py-1.5 font-medium">
                    Discount
                  </td>
                  <td className={`${tdR} border border-neutral-300 px-2.5 py-1.5 text-rose-700`}>
                    -{money(q.discount)}
                  </td>
                </tr>
              ) : null}
              <tr>
                <td className="border border-neutral-300 bg-neutral-50 px-2.5 py-1.5 font-medium">
                  Net Amount
                </td>
                <td className={`${tdR} border border-neutral-300 px-2.5 py-1.5`}>{money(netTotal)}</td>
              </tr>
              <tr>
                <td className="border border-neutral-300 bg-neutral-50 px-2.5 py-1.5 font-medium">
                  VAT ({vatPercent}%)
                </td>
                <td className={`${tdR} border border-neutral-300 px-2.5 py-1.5`}>{money(q.vatAmount)}</td>
              </tr>
            </tbody>
          </table>
          <div className="mt-1.5 flex items-center justify-between bg-[#0F1F3D] px-3 py-2.5 text-white">
            <span className="text-sm font-bold tracking-wide">TOTAL</span>
            <span className="text-lg font-bold tabular-nums">{money(q.total)}</span>
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-neutral-600">
            <span className="font-semibold uppercase tracking-wide">Amount in words:</span>{' '}
            {amountInWords(q.total, currency)}
          </p>
        </div>
      </section>

      {/* NOTES + TERMS */}
      {q.notes || q.terms ? (
        <section className="mt-4 space-y-3">
          {q.notes ? (
            <div className="break-inside-avoid rounded-lg border border-neutral-300 p-3.5">
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">Notes</h3>
              <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-neutral-700">{q.notes}</p>
            </div>
          ) : null}
          {q.terms ? (
            <div className="break-inside-avoid rounded-lg border border-neutral-300 p-3.5">
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">
                Terms &amp; Conditions
              </h3>
              <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-neutral-700">{q.terms}</p>
            </div>
          ) : null}
        </section>
      ) : null}

      {/* VALIDITY REMINDER + SIGNATURES */}
      <p className="mt-4 text-xs text-neutral-600">
        {q.validityDate
          ? `This quotation is valid until ${formatDate(q.validityDate)}. Prices are subject to change after the validity date.`
          : 'Prices quoted are valid for acceptance as mutually agreed.'}
      </p>

      <div className="mt-6 grid grid-cols-1 gap-x-10 gap-y-5 sm:grid-cols-2">
        <SignatureBlock
          label="Prepared By"
          name={q.createdByName || preparedBy}
          sub={`${companyName} — Accounts Department`}
        />
        <SignatureBlock label="Accepted By" name="" sub="For the client — name, signature & company stamp" />
      </div>

      <p className="mt-3 text-center text-[10px] text-neutral-400">
        This is a computer-generated quotation from {companyName}.
      </p>
    </div>
  )
}

'use client'

// TAX INVOICE print document — A4 portrait, ZATCA simplified (Phase 1) layout:
//   • company letterhead (logo + name + address from Settings)
//   • TAX INVOICE title block: number, issue date, due date, status stamp
//   • "Bill To" block (client name + address when linked to a Client record)
//   • line-items table + Subtotal / VAT / TOTAL bar (+ Amount Paid / Balance Due)
//   • ZATCA Phase-1 QR code — simplified TLV encoding of the 5 mandatory tags
//     (seller name, VAT number, timestamp, total with VAT, VAT total)
//   • notes, Authorized By signature block, computer-generated footer
// Print via the browser (Ctrl+P → "Save as PDF" for the PDF export).
import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { Printer, QrCode, X } from 'lucide-react'

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
import type { AppSettings, DocItemRow, InvoiceRow } from '@/lib/types'

/** Linked client info returned by GET /api/invoices/[id] (null = free-text client). */
export type InvoiceClientInfo = {
  id: string
  name: string
  address: string | null
  city: string | null
  phone: string | null
  email: string | null
  crNumber: string | null
} | null

/** Full invoice payload with items + linked client — the print source of truth. */
export type InvoicePrintData = InvoiceRow & {
  client: InvoiceClientInfo
  items: DocItemRow[]
}

/**
 * ZATCA Phase-1 (simplified) TLV encoder: each field is encoded as
 *   [tagId (1 byte)][length (2 bytes, big-endian)][UTF-8 value]
 * and the concatenated byte stream is returned as base64 for the QR code.
 */
function tlvBase64(entries: { tag: number; value: string }[]): string {
  const encoder = new TextEncoder()
  const parts: Uint8Array[] = []
  for (const { tag, value } of entries) {
    const valueBytes = encoder.encode(value)
    const head = new Uint8Array(3)
    head[0] = tag & 0xff
    head[1] = (valueBytes.length >> 8) & 0xff
    head[2] = valueBytes.length & 0xff
    parts.push(head, valueBytes)
  }
  const totalLength = parts.reduce((n, p) => n + p.length, 0)
  const merged = new Uint8Array(totalLength)
  let offset = 0
  for (const p of parts) {
    merged.set(p, offset)
    offset += p.length
  }
  let binary = ''
  for (const byte of merged) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/** VAT registration number — not yet a Settings key, so read it defensively. */
function sellerVatNumber(settings: AppSettings): string {
  const raw = (settings as unknown as { vatNumber?: string | null }).vatNumber
  return typeof raw === 'string' ? raw.trim() : ''
}

export function InvoicePrintDialog({
  open,
  onOpenChange,
  invoice,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  invoice: InvoicePrintData | null
}) {
  const settings = useAppStore((s) => s.settings)
  const user = useAppStore((s) => s.user)
  usePageRule(open, 'size: A4 portrait; margin: 12mm;')

  // ZATCA QR (Phase-1 TLV) — regenerated whenever the invoice or company data changes
  const [qrUrl, setQrUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!open || !invoice) return
    let cancelled = false
    const payload = tlvBase64([
      { tag: 1, value: settings.companyName || 'Landmark Inter Gulf' }, // seller name
      { tag: 2, value: sellerVatNumber(settings) }, // seller VAT number
      { tag: 3, value: new Date(invoice.issueDate).toISOString() }, // timestamp
      { tag: 4, value: invoice.total.toFixed(2) }, // total with VAT
      { tag: 5, value: invoice.vatAmount.toFixed(2) }, // VAT total
    ])
    QRCode.toDataURL(payload, { margin: 0, width: 240, errorCorrectionLevel: 'M' })
      .then((url) => {
        if (!cancelled) setQrUrl(url)
      })
      .catch(() => {
        if (!cancelled) setQrUrl(null)
      })
    return () => {
      cancelled = true
    }
  }, [open, invoice, settings])

  if (!open) return null

  const currency = settings.currency || 'SAR'
  const money = (n: number) => formatMoney(n, currency)
  const i = invoice
  const vatPercent = Math.round((i?.vatRate ?? 0.15) * 100)
  const balanceDue = i ? round2(i.total - i.paidAmount) : 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[92vh] max-h-[92vh] w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1000px] print:static print:h-auto print:max-h-none print:w-full print:translate-x-0 print:translate-y-0 print:overflow-visible print:rounded-none print:border-0 print:p-0 print:shadow-none"
      >
        <DialogTitle className="sr-only">Tax invoice print preview</DialogTitle>
        <DialogDescription className="sr-only">
          Printable ZATCA-style tax invoice with line items, VAT breakdown and verification QR
          code.
        </DialogDescription>

        {/* Toolbar (hidden when printing) */}
        <div className="print-hidden flex flex-wrap items-center justify-between gap-3 border-b bg-card px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">
              {i ? `Tax Invoice — ${i.invoiceNumber}` : 'Tax Invoice'}
            </h2>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <QrCode className="h-3.5 w-3.5" />
              A4 portrait · ZATCA Phase-1 QR included · {vatPercent}% VAT
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              <X className="h-4 w-4" />
              Close
            </Button>
            <Button onClick={() => window.print()} disabled={!i}>
              <Printer className="h-4 w-4" />
              Print / Save PDF
            </Button>
          </div>
        </div>

        {/* Scrollable preview / printable page */}
        <div className="nice-scrollbar print-area flex-1 overflow-y-auto bg-neutral-100 p-4 print:overflow-visible print:bg-white print:p-0">
          {i ? (
            <div className="mx-auto w-full max-w-[820px] bg-white p-8 text-neutral-900 shadow-sm [print-color-adjust:exact] [-webkit-print-color-adjust:exact] print:max-w-none print:p-0 print:shadow-none">
              {/* ---- Letterhead ---- */}
              <header className="flex items-start justify-between gap-4 border-b-2 border-[#0F1F3D] pb-4">
                <div className="flex min-w-0 items-start gap-4">
                  <img
                    src={settings.logo ?? '/logo-mark.png'}
                    alt={`${settings.companyName} logo`}
                    className="h-16 w-16 shrink-0 object-contain"
                  />
                  <div className="min-w-0">
                    <p className="text-lg font-bold uppercase tracking-wide text-[#0F1F3D]">
                      {settings.companyName}
                    </p>
                    {settings.address ? (
                      <p className="mt-1 max-w-[380px] text-[10px] leading-relaxed text-neutral-600">
                        {settings.address}
                      </p>
                    ) : null}
                    <div className="mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[10px] text-neutral-600">
                      {settings.phone ? <span>Tel: {settings.phone}</span> : null}
                      {settings.email ? <span>Email: {settings.email}</span> : null}
                    </div>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <p className="rounded-md border-l-4 border-[#D4AF37] bg-[#0F1F3D] px-3 py-1.5 text-sm font-bold tracking-widest text-white">
                    TAX INVOICE
                  </p>
                  <p className="mt-2 text-[11px] text-neutral-700">
                    Invoice No:{' '}
                    <span className="font-mono font-bold text-neutral-900">{i.invoiceNumber}</span>
                  </p>
                  <p className="text-[11px] text-neutral-600">
                    Issue Date: {formatDate(i.issueDate)}
                  </p>
                  <p className="text-[11px] text-neutral-600">
                    Due Date: {i.dueDate ? formatDate(i.dueDate) : '—'}
                  </p>
                  {/* status stamp */}
                  {i.status === 'paid' ? (
                    <p className="mt-2 inline-block -rotate-6 rounded-md border-[3px] border-emerald-600 px-2.5 py-0.5 text-xs font-black uppercase tracking-[0.2em] text-emerald-700">
                      Paid
                    </p>
                  ) : i.status === 'issued' ? (
                    <p className="mt-2 inline-block -rotate-6 rounded-md border-[3px] border-amber-500 px-2.5 py-0.5 text-xs font-black uppercase tracking-[0.2em] text-amber-600">
                      Issued
                    </p>
                  ) : i.status === 'cancelled' ? (
                    <p className="mt-2 inline-block -rotate-6 rounded-md border-[3px] border-rose-500 px-2.5 py-0.5 text-xs font-black uppercase tracking-[0.2em] text-rose-600">
                      Cancelled
                    </p>
                  ) : (
                    <p className="mt-2 inline-block -rotate-6 rounded-md border-[3px] border-neutral-400 px-2.5 py-0.5 text-xs font-black uppercase tracking-[0.2em] text-neutral-500">
                      Draft
                    </p>
                  )}
                </div>
              </header>
              {/* gold accent segment under the navy header rule */}
              <div className="mt-[3px] h-[3px] w-24 bg-[#D4AF37]" aria-hidden />

              {/* ---- Bill To ---- */}
              <section className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">
                    Bill To
                  </p>
                  <p className="mt-1 text-sm font-bold text-neutral-900">{i.clientName}</p>
                  {i.client ? (
                    <div className="mt-1 space-y-0.5 text-[11px] leading-relaxed text-neutral-600">
                      {i.client.address ? <p>{i.client.address}</p> : null}
                      {i.client.city ? <p>{i.client.city}</p> : null}
                      {i.client.phone ? (
                        <p>
                          Tel:{' '}
                          <span className="tabular-nums">{i.client.phone}</span>
                        </p>
                      ) : null}
                      {i.client.email ? <p>{i.client.email}</p> : null}
                      {i.client.crNumber ? (
                        <p>
                          CR No: <span className="tabular-nums">{i.client.crNumber}</span>
                        </p>
                      ) : null}
                    </div>
                  ) : (
                    <p className="mt-1 text-[11px] italic text-neutral-400">
                      (unregistered customer)
                    </p>
                  )}
                </div>
                <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">
                    Invoice Details
                  </p>
                  <div className="mt-1 space-y-0.5 text-[11px] text-neutral-600">
                    <p>
                      Subject:{' '}
                      <span className="font-medium text-neutral-900">{i.subject ?? '—'}</span>
                    </p>
                    <p>
                      Currency: <span className="font-medium text-neutral-900">{currency}</span>
                    </p>
                    <p>
                      VAT Rate:{' '}
                      <span className="font-medium tabular-nums text-neutral-900">
                        {vatPercent}%
                      </span>
                    </p>
                    <p>
                      Prepared By:{' '}
                      <span className="font-medium text-neutral-900">
                        {i.createdByName ?? user?.name ?? 'Accounts'}
                      </span>
                    </p>
                  </div>
                </div>
              </section>

              {/* ---- Items table ---- */}
              <table className="mt-4 w-full border-collapse text-[11px]">
                <thead>
                  <tr>
                    <th className="w-[34px] border border-neutral-300 bg-neutral-100 px-1.5 py-1.5 text-left font-semibold text-neutral-800">
                      Sr
                    </th>
                    <th className="border border-neutral-300 bg-neutral-100 px-1.5 py-1.5 text-left font-semibold text-neutral-800">
                      Description
                    </th>
                    <th className="w-[80px] border border-neutral-300 bg-neutral-100 px-1.5 py-1.5 text-left font-semibold text-neutral-800">
                      Unit
                    </th>
                    <th className="w-[60px] border border-neutral-300 bg-neutral-100 px-1.5 py-1.5 text-right font-semibold text-neutral-800">
                      Qty
                    </th>
                    <th className="w-[90px] border border-neutral-300 bg-neutral-100 px-1.5 py-1.5 text-right font-semibold text-neutral-800">
                      Unit Price
                    </th>
                    <th className="w-[100px] border border-neutral-300 bg-neutral-100 px-1.5 py-1.5 text-right font-semibold text-neutral-800">
                      Line Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {i.items.map((it) => (
                    <tr key={it.id ?? it.sr} className="break-inside-avoid">
                      <td className="border border-neutral-300 px-1.5 py-1.5 text-center tabular-nums text-neutral-600">
                        {it.sr}
                      </td>
                      <td className="border border-neutral-300 px-1.5 py-1.5 align-top text-neutral-900">
                        {it.description}
                      </td>
                      <td className="border border-neutral-300 px-1.5 py-1.5 align-top text-neutral-600">
                        {it.unit ?? '—'}
                      </td>
                      <td className="border border-neutral-300 px-1.5 py-1.5 text-right tabular-nums text-neutral-900">
                        {it.quantity}
                      </td>
                      <td className="border border-neutral-300 px-1.5 py-1.5 text-right tabular-nums text-neutral-900">
                        {it.unitPrice.toFixed(2)}
                      </td>
                      <td className="border border-neutral-300 px-1.5 py-1.5 text-right font-semibold tabular-nums text-neutral-900">
                        {it.lineTotal.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* ---- Totals bar ---- */}
              <div className="mt-3 flex justify-end">
                <table className="w-full max-w-[320px] border-collapse text-[11px] sm:w-[320px]">
                  <tbody>
                    <tr>
                      <td className="border border-neutral-300 bg-neutral-50 px-2.5 py-1.5 font-medium">
                        Subtotal
                      </td>
                      <td className="w-[120px] border border-neutral-300 px-2.5 py-1.5 text-right tabular-nums">
                        {i.subtotal.toFixed(2)}
                      </td>
                    </tr>
                    <tr>
                      <td className="border border-neutral-300 bg-neutral-50 px-2.5 py-1.5 font-medium">
                        VAT ({vatPercent}%)
                      </td>
                      <td className="border border-neutral-300 px-2.5 py-1.5 text-right tabular-nums">
                        {i.vatAmount.toFixed(2)}
                      </td>
                    </tr>
                    <tr className="bg-[#0F1F3D] font-bold text-white">
                      <td className="border border-[#0F1F3D] px-2.5 py-2">TOTAL</td>
                      <td className="border border-[#0F1F3D] px-2.5 py-2 text-right text-sm tabular-nums">
                        {money(i.total)}
                      </td>
                    </tr>
                    {i.paidAmount > 0 ? (
                      <>
                        <tr>
                          <td className="border border-neutral-300 bg-neutral-50 px-2.5 py-1.5 font-medium">
                            Amount Paid
                          </td>
                          <td className="border border-neutral-300 px-2.5 py-1.5 text-right tabular-nums text-emerald-700">
                            {money(i.paidAmount)}
                          </td>
                        </tr>
                        <tr className="font-bold">
                          <td className="border border-neutral-300 bg-neutral-50 px-2.5 py-1.5">
                            Balance Due
                          </td>
                          <td className="border border-neutral-300 px-2.5 py-1.5 text-right tabular-nums text-[#0F1F3D]">
                            {money(balanceDue)}
                          </td>
                        </tr>
                      </>
                    ) : null}
                  </tbody>
                </table>
              </div>

              {/* ---- Notes ---- */}
              {i.notes ? (
                <section className="mt-4 break-inside-avoid rounded-lg border border-neutral-200 p-3">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">
                    Notes
                  </p>
                  <p className="mt-1 whitespace-pre-line text-[11px] leading-relaxed text-neutral-700">
                    {i.notes}
                  </p>
                </section>
              ) : null}

              {/* ---- QR + signatures ---- */}
              <div className="mt-6 flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
                {/* ZATCA Phase-1 verification QR */}
                <div className="shrink-0 text-center">
                  {qrUrl ? (
                    <img
                      src={qrUrl}
                      alt="ZATCA invoice verification QR code"
                      className="h-[110px] w-[110px]"
                    />
                  ) : (
                    <div className="flex h-[110px] w-[110px] items-center justify-center border border-dashed border-neutral-300 text-[9px] text-neutral-400">
                      QR
                    </div>
                  )}
                  <p className="mt-1 max-w-[130px] text-[9px] leading-tight text-neutral-500">
                    Scan to verify (ZATCA Phase 1)
                  </p>
                </div>

                <div className="flex min-w-0 flex-1 justify-end gap-10">
                  <div className="min-w-[180px]">
                    <div className="flex h-12 items-end">
                      <div className="w-full border-t border-neutral-800" />
                    </div>
                    <p className="mt-1.5 text-[10px] font-bold uppercase tracking-widest text-neutral-900">
                      Authorized By
                    </p>
                    <p className="text-[10px] text-neutral-600">
                      {settings.authorizedSignatory || settings.companyName}
                    </p>
                    <p className="text-[10px] text-neutral-600">
                      {settings.signatoryTitle || 'Authorized Signatory'}
                    </p>
                  </div>
                </div>
              </div>

              <p className="mt-4 border-t border-neutral-200 pt-2 text-center text-[9px] text-neutral-400">
                This is a computer-generated tax invoice issued by {settings.companyName}.
              </p>
            </div>
          ) : (
            <div className="flex min-h-[300px] items-center justify-center bg-white p-16 text-sm text-neutral-400">
              No invoice selected.
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

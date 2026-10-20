'use client'

// Agreement print preview — A4 portrait, multi-page-ready contract document:
//   • company letterhead (logo + name + address from Settings)
//   • "AGREEMENT" title, ref number, date range and a status stamp
//   • parties block (BETWEEN Landmark Inter Gulf LLC AND the client)
//   • type + contract value summary bar (navy/gold company styling)
//   • Scope & Pricing items table (detailed) or the "price as per P.O." line
//   • installments schedule (with paid ticks) and numbered clauses
//   • signature blocks for both parties
// Print via the browser (Ctrl+P → "Save as PDF" for the PDF export).
import { Printer, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { usePageRule } from '@/components/app/print/print-page-rule'
import { formatDate, formatMoney, formatNumber } from '@/lib/format'
import { useAppStore } from '@/lib/store'
import type { AgreementRow } from '@/lib/types'

const TYPE_LABELS: Record<string, string> = {
  labor_supply: 'Labor Supply',
  service: 'Service',
  subcontract: 'Subcontract',
}

const STATUS_STAMPS: Record<string, { label: string; cls: string }> = {
  draft: {
    label: 'DRAFT',
    cls: 'border-neutral-500 text-neutral-600 shadow-[inset_0_0_0_1.5px_rgba(115,115,115,0.3)]',
  },
  final: {
    label: 'FINAL',
    cls: 'border-amber-500 text-amber-600 shadow-[inset_0_0_0_1.5px_rgba(217,119,6,0.35)]',
  },
  signed: {
    label: 'SIGNED',
    cls: 'border-emerald-600 text-emerald-700 shadow-[inset_0_0_0_1.5px_rgba(5,150,105,0.35)]',
  },
  expired: {
    label: 'EXPIRED',
    cls: 'border-neutral-400 text-neutral-500 shadow-[inset_0_0_0_1.5px_rgba(168,162,158,0.35)]',
  },
}

/**
 * Full-screen preview dialog for a single agreement. `agreement` must be the
 * FULL row (items / installments / clauses included — GET /api/agreements/[id]).
 * The document is wrapped in `.print-area` so window.print() outputs ONLY it.
 */
export function AgreementPrintDialog({
  agreement,
  open,
  onOpenChange,
}: {
  agreement: AgreementRow | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const settings = useAppStore((s) => s.settings)
  usePageRule(open, 'size: A4 portrait; margin: 14mm;')

  const currency = settings.currency || 'SAR'
  const companyName = settings.companyName || 'Landmark Inter Gulf LLC'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[92vh] max-h-[92vh] w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1000px] print:static print:h-auto print:max-h-none print:w-full print:translate-x-0 print:translate-y-0 print:overflow-visible print:rounded-none print:border-0 print:p-0 print:shadow-none"
      >
        <DialogTitle className="sr-only">Agreement print preview</DialogTitle>
        <DialogDescription className="sr-only">
          Printable agreement document — letterhead, parties, scope and pricing, installment
          schedule, clauses and signature blocks.
        </DialogDescription>

        {/* Toolbar (hidden when printing) */}
        <div className="print-hidden flex flex-wrap items-center justify-between gap-3 border-b bg-card px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold">
              {agreement ? `Agreement ${agreement.refNumber}` : 'Agreement'}
            </h2>
            <p className="truncate text-xs text-muted-foreground">
              {agreement
                ? `${agreement.title} · ${agreement.clientName} · ${formatMoney(agreement.value, currency)}`
                : 'A4 portrait contract document'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              <X className="h-4 w-4" />
              Close
            </Button>
            <Button onClick={() => window.print()} disabled={!agreement}>
              <Printer className="h-4 w-4" />
              Print / Save PDF
            </Button>
          </div>
        </div>

        {/* Printable page */}
        <div className="nice-scrollbar print-area flex-1 overflow-y-auto bg-neutral-100 p-4 print:overflow-visible print:bg-white print:p-0">
          {agreement ? (
            <div className="mx-auto w-full max-w-[820px] bg-white p-8 text-neutral-900 shadow-sm print:max-w-none print:p-0 print:shadow-none">
              <AgreementDocument
                agreement={agreement}
                companyName={companyName}
                currency={currency}
              />
            </div>
          ) : (
            <div className="flex min-h-[300px] items-center justify-center bg-white p-16 text-sm text-neutral-400">
              No agreement selected.
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function AgreementDocument({
  agreement,
  companyName,
  currency,
}: {
  agreement: AgreementRow
  companyName: string
  currency: string
}) {
  const settings = useAppStore((s) => s.settings)
  const a = agreement
  const partyAName = a.partyA || companyName
  const typeLabel = TYPE_LABELS[a.type] ?? a.type
  const stamp = STATUS_STAMPS[a.status] ?? STATUS_STAMPS.draft
  const items = a.items ?? []
  const installments = a.installments ?? []
  const clauses = a.clauses ?? []
  const installmentTotal = installments.reduce((s, i) => s + (i.amount || 0), 0)

  const th = 'border border-neutral-300 bg-neutral-100 px-1.5 py-1.5 text-left font-semibold text-neutral-800'
  const thR = `${th} text-right`
  const td = 'border border-neutral-300 px-1.5 py-1.5 align-top text-neutral-900'
  const tdR = `${td} text-right tabular-nums`

  return (
    <div className="text-neutral-900 [print-color-adjust:exact] [-webkit-print-color-adjust:exact]">
      {/* ---- Letterhead ---- */}
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
              <p className="mt-1 text-xs leading-relaxed text-neutral-500">{settings.address}</p>
            ) : null}
            <div className="mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-neutral-500">
              {settings.phone ? <span>Tel: {settings.phone}</span> : null}
              {settings.email ? <span>Email: {settings.email}</span> : null}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3 sm:flex-col sm:items-end sm:gap-2">
          <span className="rounded-md border-l-4 border-[#D4AF37] bg-[#0F1F3D] px-3 py-1.5 text-xs font-bold tracking-widest text-white">
            AGREEMENT
          </span>
          <span className="text-xs font-medium text-neutral-600">
            Ref No: <span className="font-mono font-semibold">{a.refNumber}</span>
          </span>
          <span className="text-xs text-neutral-500">
            Period: {formatDate(a.startDate)}{a.endDate ? ` — ${formatDate(a.endDate)}` : ' onwards'}
          </span>
          <span
            className={`mt-2 inline-block -rotate-6 rounded-md border-[3px] px-2.5 py-0.5 text-xs font-black uppercase tracking-[0.2em] ${stamp.cls}`}
          >
            {stamp.label}
          </span>
        </div>
      </header>
      {/* gold accent segment under the navy header rule */}
      <div className="mt-[3px] h-[3px] w-24 bg-[#D4AF37]" aria-hidden />

      {/* ---- Title ---- */}
      <div className="mt-6 text-center">
        <h1 className="text-lg font-bold uppercase tracking-[0.25em] text-[#0F1F3D]">
          {typeLabel} Agreement
        </h1>
        <p className="mt-1 text-sm font-semibold text-neutral-800">{a.title}</p>
      </div>

      {/* ---- Parties ---- */}
      <section className="mt-5">
        <p className="text-center text-[11px] font-bold uppercase tracking-[0.3em] text-neutral-500">
          — BETWEEN —
        </p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-neutral-300 bg-neutral-50 p-3.5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">
              First Party (Party A)
            </p>
            <p className="mt-1 text-sm font-bold text-[#0F1F3D]">{partyAName}</p>
            {settings.address ? (
              <p className="mt-1 text-xs leading-relaxed text-neutral-600">{settings.address}</p>
            ) : null}
            <p className="mt-1 text-xs text-neutral-500">
              hereinafter referred to as &quot;the First Party&quot;
            </p>
          </div>
          <div className="rounded-lg border border-neutral-300 bg-neutral-50 p-3.5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">
              Second Party (Party B)
            </p>
            <p className="mt-1 text-sm font-bold text-[#0F1F3D]">{a.clientName}</p>
            {a.clientId ? null : (
              <p className="mt-1 text-xs text-neutral-500">&nbsp;</p>
            )}
            <p className="mt-1 text-xs text-neutral-500">
              hereinafter referred to as &quot;the Second Party&quot;
            </p>
          </div>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-neutral-700">
          This Agreement is made and entered into by and between the First Party and the Second
          Party on {formatDate(a.startDate)}
          {a.endDate ? `, effective through ${formatDate(a.endDate)}` : ', effective from the date above'},
          under the terms and conditions set forth herein.
        </p>
      </section>

      {/* ---- Type + value summary bar ---- */}
      <div className="mt-5 flex flex-col items-center gap-1 bg-[#0F1F3D] px-4 py-3 text-white sm:flex-row sm:items-center sm:justify-between">
        <span className="text-sm font-bold tracking-wide">{typeLabel.toUpperCase()} AGREEMENT</span>
        <span className="text-xs text-neutral-300">
          {formatDate(a.startDate)}
          {a.endDate ? ` — ${formatDate(a.endDate)}` : ' — ongoing'}
        </span>
        <span className="text-xl font-bold tabular-nums">
          {formatMoney(a.value, currency)}
        </span>
      </div>

      {/* ---- Scope & pricing ---- */}
      {a.layoutStyle === 'detailed' ? (
        <section className="mt-5 break-inside-avoid">
          <h3 className="text-[13px] font-bold uppercase tracking-wider">Scope &amp; Pricing</h3>
          <table className="mt-2 w-full border-collapse text-[11px]">
            <thead>
              <tr>
                <th className={th}>Sr</th>
                <th className={th}>Description</th>
                <th className={th}>Unit</th>
                <th className={thR}>Qty</th>
                <th className={thR}>Unit Price</th>
                <th className={thR}>Line Total</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td className={td} colSpan={6}>
                    No items recorded.
                  </td>
                </tr>
              ) : (
                items.map((it) => (
                  <tr key={it.id ?? it.sr} className="break-inside-avoid">
                    <td className={td}>{it.sr}</td>
                    <td className={td}>{it.description}</td>
                    <td className={td}>{it.unit ?? '—'}</td>
                    <td className={tdR}>{formatNumber(it.quantity)}</td>
                    <td className={tdR}>{formatMoney(it.unitPrice, currency)}</td>
                    <td className={`${tdR} font-semibold`}>{formatMoney(it.lineTotal, currency)}</td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot>
              <tr className="bg-neutral-100 font-bold">
                <td className={td} colSpan={5}>
                  TOTAL CONTRACT VALUE
                </td>
                <td className={tdR}>{formatMoney(a.value, currency)}</td>
              </tr>
            </tfoot>
          </table>
        </section>
      ) : (
        <section className="mt-5 break-inside-avoid">
          <h3 className="text-[13px] font-bold uppercase tracking-wider">Contract Value</h3>
          <p className="mt-2 rounded-lg border border-neutral-300 bg-neutral-50 px-4 py-3 text-sm font-semibold text-neutral-900">
            Contract Value:{' '}
            <span className="tabular-nums text-[#0F1F3D]">{formatMoney(a.value, currency)}</span>{' '}
            <span className="font-normal italic text-neutral-600">(price as per Purchase Order)</span>
          </p>
        </section>
      )}

      {/* ---- Installments ---- */}
      {installments.length > 0 ? (
        <section className="mt-6 break-inside-avoid">
          <h3 className="text-[13px] font-bold uppercase tracking-wider">Payment Schedule</h3>
          <table className="mt-2 w-full border-collapse text-[11px]">
            <thead>
              <tr>
                <th className={th}>Sr</th>
                <th className={th}>Installment</th>
                <th className={th}>Due Date</th>
                <th className={thR}>Amount</th>
                <th className={`${th} text-center`}>Paid</th>
              </tr>
            </thead>
            <tbody>
              {installments.map((ins) => (
                <tr key={ins.id ?? ins.sr} className="break-inside-avoid">
                  <td className={td}>{ins.sr}</td>
                  <td className={td}>{ins.label}</td>
                  <td className={td}>{ins.dueDate ? formatDate(ins.dueDate) : '—'}</td>
                  <td className={tdR}>{formatMoney(ins.amount, currency)}</td>
                  <td className={`${td} text-center`}>{ins.paid ? '✓' : '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-neutral-100 font-bold">
                <td className={td} colSpan={3}>
                  TOTAL
                </td>
                <td className={tdR}>{formatMoney(installmentTotal, currency)}</td>
                <td className={td} />
              </tr>
            </tfoot>
          </table>
        </section>
      ) : null}

      {/* ---- Clauses ---- */}
      {clauses.length > 0 ? (
        <section className="mt-6">
          <h3 className="text-[13px] font-bold uppercase tracking-wider">Terms &amp; Conditions</h3>
          <ol className="mt-2 space-y-3">
            {clauses.map((c) => (
              <li key={c.id ?? c.sr} className="break-inside-avoid">
                <p className="text-[12px] font-bold text-neutral-900">
                  {c.sr}. {c.title ?? ''}
                </p>
                <p className="mt-0.5 whitespace-pre-line text-[11px] leading-relaxed text-neutral-700">
                  {c.body}
                </p>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {/* ---- Notes ---- */}
      {a.notes ? (
        <section className="mt-6 break-inside-avoid">
          <h3 className="text-[13px] font-bold uppercase tracking-wider">Notes</h3>
          <p className="mt-1.5 whitespace-pre-line text-[11px] leading-relaxed text-neutral-700">
            {a.notes}
          </p>
        </section>
      ) : null}

      {/* ---- Signatures ---- */}
      <div className="mt-10 break-inside-avoid">
        <p className="text-center text-[11px] font-semibold text-neutral-600">
          IN WITNESS WHEREOF, the parties have executed this Agreement on the date first written
          above.
        </p>
        <div className="mt-8 flex gap-10">
          <div className="min-w-0 flex-1">
            <div className="flex h-14 items-end">
              <div className="w-full border-t border-neutral-800" />
            </div>
            <p className="mt-1.5 text-[10px] font-bold uppercase tracking-widest text-neutral-900">
              For {partyAName}
            </p>
            <p className="text-[10px] text-neutral-600">Name / Signature: ____________________</p>
            <p className="text-[10px] text-neutral-600">Date: ______________</p>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex h-14 items-end">
              <div className="w-full border-t border-neutral-800" />
            </div>
            <p className="mt-1.5 text-[10px] font-bold uppercase tracking-widest text-neutral-900">
              For {a.clientName}
            </p>
            <p className="text-[10px] text-neutral-600">Name / Signature: ____________________</p>
            <p className="text-[10px] text-neutral-600">Date: ______________</p>
          </div>
        </div>
      </div>

      <p className="mt-6 text-center text-[10px] text-neutral-400">
        This is a computer-generated agreement. Ref {a.refNumber}
        {a.createdByName ? ` · Prepared by ${a.createdByName}` : ''}.
      </p>
    </div>
  )
}

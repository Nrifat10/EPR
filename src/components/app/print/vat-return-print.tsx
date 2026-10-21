'use client'

// VAT Return Expense print preview — A4 portrait report for filing support:
//   • company letterhead (name, address, period, VAT rate)
//   • the FILTERED bills table with a totals row
//   • quarterly breakdown of the report year (Q1..Q4 input VAT)
//   • signature lines (prepared by / authorized by)
// Print via the browser (Ctrl+P → "Save as PDF" for the PDF export).
import { Printer, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { usePageRule } from '@/components/app/print/print-page-rule'
import { formatDate, formatMoney, monthName } from '@/lib/format'
import { useAppStore } from '@/lib/store'
import type { VatBillRow, VatBillTotals, VatSummaryData } from '@/lib/types'

export function VatReturnPrintDialog({
  open,
  onOpenChange,
  bills,
  totals,
  summary,
  periodLabel,
  quarter,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** All bills matching the current list filters (already fetched, every page) */
  bills: VatBillRow[]
  /** Totals matching the same filter */
  totals: VatBillTotals
  /** Yearly summary for the quarterly breakdown section (null hides it) */
  summary: VatSummaryData | null
  /** Human description of the filter, e.g. "Q1 2026" or "March 2026" or "All bills" */
  periodLabel: string
  /** Selected quarter for the highlighted quarter row (1-4) */
  quarter: number
}) {
  const settings = useAppStore((s) => s.settings)
  usePageRule(open, 'size: A4 portrait; margin: 12mm;')

  if (!open) return null
  const money = (n: number) => formatMoney(n, settings.currency)
  const vatPercent = summary ? Math.round(summary.vatRate * 100) : settings.vatRate

  const th =
    'border border-neutral-300 bg-neutral-100 px-1.5 py-1.5 text-left font-semibold text-neutral-800'
  const thR = `${th} text-right`
  const td = 'border border-neutral-300 px-1.5 py-1.5 align-top text-neutral-900'
  const tdR = `${td} text-right tabular-nums`

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[92vh] max-h-[92vh] w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1000px] print:static print:h-auto print:max-h-none print:w-full print:translate-x-0 print:translate-y-0 print:overflow-visible print:rounded-none print:border-0 print:p-0 print:shadow-none"
      >
        <DialogTitle className="sr-only">VAT return expense report print preview</DialogTitle>
        <DialogDescription className="sr-only">
          Printable VAT expense report — company header, filtered bill table, totals and the
          quarterly breakdown.
        </DialogDescription>

        {/* Toolbar (hidden when printing) */}
        <div className="print-hidden flex flex-wrap items-center justify-between gap-3 border-b bg-card px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold">VAT Return Expense Report — {periodLabel}</h2>
            <p className="text-xs text-muted-foreground">
              A4 portrait · {bills.length} bill{bills.length === 1 ? '' : 's'} · VAT {vatPercent}%
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              <X className="h-4 w-4" />
              Close
            </Button>
            <Button onClick={() => window.print()}>
              <Printer className="h-4 w-4" />
              Print / Save PDF
            </Button>
          </div>
        </div>

        {/* Printable page */}
        <div className="nice-scrollbar print-area flex-1 overflow-y-auto bg-neutral-100 p-4 print:overflow-visible print:bg-white print:p-0">
          <div className="mx-auto w-full max-w-[820px] bg-white p-8 text-neutral-900 shadow-sm print:max-w-none print:p-0 print:shadow-none">
            {/* ---- Letterhead ---- */}
            <div className="flex items-start justify-between gap-4 border-b-2 border-neutral-800 pb-4">
              <div className="min-w-0">
                <p className="text-xl font-bold tracking-tight">{settings.companyName}</p>
                <p className="mt-1 max-w-[420px] text-[11px] leading-relaxed text-neutral-600">
                  {settings.address}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm font-bold uppercase tracking-widest">VAT Return Expense</p>
                <p className="mt-1 text-[11px] text-neutral-600">Period: {periodLabel}</p>
                <p className="text-[11px] text-neutral-600">VAT Rate: {vatPercent}%</p>
                <p className="text-[11px] text-neutral-600">
                  Generated: {formatDate(new Date())}
                </p>
              </div>
            </div>

            {/* ---- Bills table ---- */}
            <h3 className="mt-5 text-[13px] font-bold uppercase tracking-wider">
              Expense Bills with VAT
            </h3>
            <table className="mt-2 w-full border-collapse text-[11px]">
              <thead>
                <tr>
                  <th className={th}>#</th>
                  <th className={th}>Date</th>
                  <th className={th}>Bill No</th>
                  <th className={th}>Supplier</th>
                  <th className={thR}>With VAT</th>
                  <th className={thR}>Without VAT</th>
                  <th className={thR}>VAT Amount</th>
                </tr>
              </thead>
              <tbody>
                {bills.length === 0 ? (
                  <tr>
                    <td className={td} colSpan={7}>
                      No bills recorded for this period.
                    </td>
                  </tr>
                ) : (
                  bills.map((b, i) => (
                    <tr key={b.id} className="break-inside-avoid">
                      <td className={td}>{i + 1}</td>
                      <td className={`${td} whitespace-nowrap`}>{formatDate(b.billDate)}</td>
                      <td className={td}>{b.billNumber}</td>
                      <td className={td}>
                        {b.supplierName ?? '—'}
                        {b.supplierVatNumber ? (
                          <span className="block text-[10px] text-neutral-500">
                            VAT No: {b.supplierVatNumber}
                          </span>
                        ) : null}
                      </td>
                      <td className={tdR}>{money(b.amountWithVat)}</td>
                      <td className={tdR}>{money(b.amountWithoutVat)}</td>
                      <td className={`${tdR} font-semibold`}>{money(b.vatAmount)}</td>
                    </tr>
                  ))
                )}
              </tbody>
              <tfoot>
                <tr className="bg-neutral-100 font-bold">
                  <td className={td} colSpan={4}>
                    TOTAL ({totals.count} bill{totals.count === 1 ? '' : 's'})
                  </td>
                  <td className={tdR}>{money(totals.withVat)}</td>
                  <td className={tdR}>{money(totals.withoutVat)}</td>
                  <td className={tdR}>{money(totals.vat)}</td>
                </tr>
              </tfoot>
            </table>

            {/* ---- Quarterly breakdown ---- */}
            {summary ? (
              <>
                <h3 className="mt-6 text-[13px] font-bold uppercase tracking-wider">
                  Quarterly VAT Breakdown — {summary.year}
                </h3>
                <table className="mt-2 w-full border-collapse text-[11px]">
                  <thead>
                    <tr>
                      <th className={th}>Quarter</th>
                      <th className={th}>Months</th>
                      <th className={thR}>Bills</th>
                      <th className={thR}>With VAT</th>
                      <th className={thR}>Without VAT</th>
                      <th className={thR}>Input VAT (claimable)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.quarters.map((q) => (
                      <tr
                        key={q.quarter}
                        className={q.quarter === quarter ? 'bg-amber-50 font-semibold' : undefined}
                      >
                        <td className={td}>Q{q.quarter}</td>
                        <td className={td}>
                          {q.months.map((m) => monthName(m.month).slice(0, 3)).join(' – ')}
                        </td>
                        <td className={tdR}>{q.count}</td>
                        <td className={tdR}>{money(q.withVat)}</td>
                        <td className={tdR}>{money(q.withoutVat)}</td>
                        <td className={tdR}>{money(q.vat)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-neutral-100 font-bold">
                      <td className={td} colSpan={2}>
                        YEAR TOTAL
                      </td>
                      <td className={tdR}>{summary.yearTotals.count}</td>
                      <td className={tdR}>{money(summary.yearTotals.withVat)}</td>
                      <td className={tdR}>{money(summary.yearTotals.withoutVat)}</td>
                      <td className={tdR}>{money(summary.yearTotals.vat)}</td>
                    </tr>
                  </tfoot>
                </table>
                <p className="mt-2 text-[10px] italic text-neutral-600">
                  Input VAT shown above is the recoverable VAT on purchase expenses for the period
                  — transfer it to the &quot;Input VAT&quot; section of the VAT return form.
                </p>
              </>
            ) : null}

            {/* ---- Signatures ---- */}
            <div className="mt-10 flex gap-10">
              <div className="min-w-0 flex-1">
                <div className="flex h-12 items-end">
                  <div className="w-full border-t border-neutral-800" />
                </div>
                <p className="mt-1.5 text-[10px] font-bold uppercase tracking-widest text-neutral-900">
                  Prepared By
                </p>
                <p className="text-[10px] text-neutral-600">Accounts Department</p>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex h-12 items-end">
                  <div className="w-full border-t border-neutral-800" />
                </div>
                <p className="mt-1.5 text-[10px] font-bold uppercase tracking-widest text-neutral-900">
                  {settings.signatoryTitle || 'Authorized Signatory'}
                </p>
                <p className="text-[10px] text-neutral-600">
                  {settings.authorizedSignatory || settings.companyName}
                </p>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

'use client'

// Worker expense statement print preview — "who spent how much, every month".
// Two layouts:
//   • Single spender (spenderId given): A4 PORTRAIT — one block with a month-by-month
//     table (entries, receipts attached, total) + year total + amount in words.
//   • All spenders: A4 LANDSCAPE — matrix table (workers × Jan..Dec + Year Total)
//     with a Company/Unassigned row and a grand total row.
// Styled after the company letterhead (navy rule + gold accent), signature lines at
// the bottom so the printed / saved-as-PDF statement can be physically signed.
import { Printer, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { usePageRule } from '@/components/app/print/print-page-rule'
import { formatDateTime, formatMoney, monthName } from '@/lib/format'
import { useAppStore } from '@/lib/store'
import type { ExpenseStatement } from '@/lib/types'

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

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

function SignatureCell({ label, title }: { label: string; title: string }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="flex h-12 items-end">
        <div className="w-full border-t border-neutral-800" />
      </div>
      <p className="mt-1.5 text-[10px] font-bold uppercase tracking-widest text-neutral-900">{label}</p>
      <p className="text-[10px] text-neutral-600">{title}</p>
    </div>
  )
}

export function ExpenseStatementPrintDialog({
  open,
  onOpenChange,
  statement,
  spenderId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  statement: ExpenseStatement | null
  /** null/undefined = print ALL spenders; a staff id = print that worker only */
  spenderId?: string | null
}) {
  const settings = useAppStore((s) => s.settings)
  const single = spenderId ? (statement?.spenders.find((s) => s.spender.id === spenderId) ?? null) : null
  const isSingle = Boolean(spenderId)

  // Portrait for a single worker's statement; landscape for the year matrix
  usePageRule(open, isSingle ? 'size: A4 portrait; margin: 12mm;' : 'size: A4 landscape; margin: 10mm;')

  if (!statement) return null
  const money = (n: number) => formatMoney(n, settings.currency)

  const th =
    'border border-neutral-300 bg-neutral-100 px-1.5 py-1.5 text-left font-semibold text-neutral-800'
  const thR = `${th} text-right`
  const td = 'border border-neutral-300 px-1.5 py-1.5 align-top text-neutral-900'
  const tdR = `${td} text-right tabular-nums`

  const heading = isSingle
    ? single?.spender.fullName
      ? `Worker Expense Statement — ${single.spender.fullName}`
      : 'Worker Expense Statement'
    : `Worker Expense Statement — ${statement.year}`

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[92vh] max-h-[92vh] w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1000px] print:static print:h-auto print:max-h-none print:w-full print:translate-x-0 print:translate-y-0 print:overflow-visible print:rounded-none print:border-0 print:p-0 print:shadow-none"
      >
        <DialogTitle className="sr-only">Worker expense statement print preview</DialogTitle>
        <DialogDescription className="sr-only">
          Printable yearly expense statement — who spent how much every month.
        </DialogDescription>

        {/* Toolbar (hidden when printing) */}
        <div className="print-hidden flex flex-wrap items-center justify-between gap-3 border-b bg-card px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold">{heading}</h2>
            <p className="text-xs text-muted-foreground">
              Year {statement.year} · {isSingle ? 'A4 portrait' : 'A4 landscape'} ·{' '}
              {statement.spenders.length} worker{statement.spenders.length === 1 ? '' : 's'} with
              expenses
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

        {/* Scrollable preview */}
        <div className="nice-scrollbar flex-1 overflow-auto bg-neutral-100 p-3 sm:p-6 print:overflow-visible print:bg-white print:p-0">
          <div className="print-area mx-auto min-w-[620px] max-w-[860px] bg-white p-6 text-neutral-900 shadow-sm print:min-w-0 print:max-w-none print:p-0">
            {/* Company letterhead — brand navy rule + gold accent */}
            <div className="flex items-start justify-between gap-6 border-b-2 border-[#0F1F3D] pb-4">
              <div className="flex items-center gap-3">
                <img
                  src={settings.logo ?? '/logo-mark.png'}
                  alt={`${settings.companyName} logo`}
                  className="h-16 w-16 rounded object-contain"
                />
                <div>
                  <h1 className="text-xl font-bold uppercase tracking-wide text-[#0F1F3D]">
                    {settings.companyName}
                  </h1>
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#B8942C]">
                    Worker Expense Statement
                  </p>
                  {settings.address ? (
                    <p className="text-[10px] text-neutral-500">{settings.address}</p>
                  ) : null}
                  <p className="text-[10px] text-neutral-500">
                    {[settings.phone, settings.email].filter(Boolean).join(' · ')}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-neutral-500">
                  Statement Year
                </p>
                <p className="text-base font-bold text-[#0F1F3D]">{statement.year}</p>
                <p className="mt-2 text-[10px] font-semibold uppercase tracking-widest text-neutral-500">
                  {isSingle ? 'Worker Total' : 'Grand Total'}
                </p>
                <p className="text-xl font-bold tabular-nums">
                  {money(isSingle ? (single?.total ?? 0) : statement.grandTotal)}
                </p>
                <p className="mt-1 text-[9px] text-neutral-400">
                  Generated: {formatDateTime(new Date())}
                </p>
              </div>
            </div>
            <div className="mt-[3px] h-[3px] w-28 bg-[#D4AF37]" aria-hidden />

            {isSingle && single ? (
              <>
                {/* Worker identity block */}
                <div className="mt-5 flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-neutral-500">
                      Worker
                    </p>
                    <p className="mt-0.5 text-base font-bold text-[#0F1F3D]">
                      {single.spender.fullName}
                    </p>
                    <p className="text-[11px] text-neutral-600">
                      {[
                        `IQAMA: ${single.spender.iqamaId}`,
                        single.spender.position,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                  <div className="text-right text-[11px] text-neutral-600">
                    <p>
                      <span className="font-semibold text-neutral-800">Entries:</span>{' '}
                      {single.totalCount}
                    </p>
                    <p>
                      <span className="font-semibold text-neutral-800">Receipts attached:</span>{' '}
                      {single.receipts} of {single.totalCount}
                    </p>
                    <p>
                      <span className="font-semibold text-neutral-800">Months with expenses:</span>{' '}
                      {single.months.length}
                    </p>
                  </div>
                </div>

                {/* Month-by-month table */}
                <table className="mt-4 w-full border-collapse text-[11px]">
                  <thead>
                    <tr>
                      <th className={`${th} text-center`}>SN</th>
                      <th className={th}>Month</th>
                      <th className={thR}>Entries</th>
                      <th className={thR}>Receipts</th>
                      <th className={thR}>Total ({settings.currency})</th>
                    </tr>
                  </thead>
                  <tbody>
                    {single.months.map((m, i) => (
                      <tr key={m.month} className="break-inside-avoid">
                        <td className={`${td} text-center tabular-nums`}>{i + 1}</td>
                        <td className={`${td} font-medium`}>
                          {monthName(m.month)} {statement.year}
                        </td>
                        <td className={tdR}>{m.count}</td>
                        <td className={tdR}>{m.receipts ?? 0}</td>
                        <td className={`${tdR} font-semibold`}>{money(m.total)}</td>
                      </tr>
                    ))}
                    <tr className="break-inside-avoid bg-neutral-50">
                      <td className={`${td} font-bold`} colSpan={2}>
                        YEAR TOTAL — {statement.year}
                      </td>
                      <td className={`${tdR} font-bold`}>{single.totalCount}</td>
                      <td className={`${tdR} font-bold`}>{single.receipts}</td>
                      <td className={`${tdR} text-base font-bold`}>{money(single.total)}</td>
                    </tr>
                  </tbody>
                </table>

                <p className="mt-3 text-[10px] italic text-neutral-600">
                  Amount in words: {amountInWords(single.total, settings.currency)}
                </p>
                <p className="mt-1 text-[9px] text-neutral-400">
                  Bill receipts for each entry are attached to the expense records and available on request.
                </p>

                <div className="mt-10 flex items-start gap-10">
                  <SignatureCell label="Prepared By" title="Accounts Department" />
                  <SignatureCell label="Approved By" title="General Manager" />
                  <SignatureCell label="Received By" title={single.spender.fullName} />
                </div>
              </>
            ) : (
              <>
                {/* All workers — year matrix */}
                <p className="mt-4 text-[11px] leading-relaxed text-neutral-600">
                  Monthly totals per worker for {statement.year}. The &ldquo;Company / No Worker&rdquo;
                  row collects expenses that are not attributed to any worker.
                </p>

                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[760px] border-collapse text-[10px]">
                    <thead>
                      <tr>
                        <th className={`${th} text-center`}>SN</th>
                        <th className={th}>Worker</th>
                        <th className={th}>Position</th>
                        {MONTHS_SHORT.map((m) => (
                          <th key={m} className={`${thR} text-center`}>
                            {m}
                          </th>
                        ))}
                        <th className={thR}>Year Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {statement.spenders.map((s, i) => {
                        const byMonth = new Map(s.months.map((m) => [m.month, m.total]))
                        return (
                          <tr key={s.spender.id} className="break-inside-avoid">
                            <td className={`${td} text-center tabular-nums`}>{i + 1}</td>
                            <td className={td}>
                              <span className="font-semibold">{s.spender.fullName}</span>
                              <span className="block text-[9px] text-neutral-500">
                                IQAMA: {s.spender.iqamaId}
                              </span>
                            </td>
                            <td className={td}>{s.spender.position ?? '—'}</td>
                            {MONTHS_SHORT.map((_, mi) => {
                              const v = byMonth.get(mi + 1)
                              return (
                                <td key={mi} className={`${tdR} text-right`}>
                                  {v ? money(v) : <span className="text-neutral-300">—</span>}
                                </td>
                              )
                            })}
                            <td className={`${tdR} font-bold`}>{money(s.total)}</td>
                          </tr>
                        )
                      })}
                      {statement.unassigned.total > 0 ? (
                        <tr className="break-inside-avoid bg-neutral-50">
                          <td className={`${td} text-center tabular-nums`}>—</td>
                          <td className={`${td} italic`}>Company / No Worker</td>
                          <td className={`${td} italic`}>—</td>
                          {MONTHS_SHORT.map((_, mi) => {
                            const v = statement.unassigned.months.find((m) => m.month === mi + 1)
                            return (
                              <td key={mi} className={`${tdR} text-right`}>
                                {v ? money(v.total) : <span className="text-neutral-300">—</span>}
                              </td>
                            )
                          })}
                          <td className={`${tdR} font-bold italic`}>
                            {money(statement.unassigned.total)}
                          </td>
                        </tr>
                      ) : null}
                      <tr className="break-inside-avoid bg-neutral-100">
                        <td className={`${td} font-bold`} colSpan={3}>
                          GRAND TOTAL — {statement.year}
                        </td>
                        {MONTHS_SHORT.map((_, mi) => {
                          const v =
                            statement.spenders.reduce(
                              (s, sp) => s + (sp.months.find((m) => m.month === mi + 1)?.total ?? 0),
                              0
                            ) +
                            (statement.unassigned.months.find((m) => m.month === mi + 1)?.total ?? 0)
                          return (
                            <td key={mi} className={`${tdR} font-bold`}>
                              {v ? money(v) : <span className="text-neutral-300">—</span>}
                            </td>
                          )
                        })}
                        <td className={`${tdR} text-base font-bold`}>{money(statement.grandTotal)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <p className="mt-3 text-[10px] italic text-neutral-600">
                  Amount in words: {amountInWords(statement.grandTotal, settings.currency)}
                </p>

                <div className="mt-10 flex items-start gap-10">
                  <SignatureCell label="Prepared By" title="Accounts Department" />
                  <SignatureCell label="Approved By" title="General Manager" />
                </div>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

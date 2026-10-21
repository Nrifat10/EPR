'use client'

// Per-client billing statement print preview — one company's monthly manpower
// summary: every billed worker with their PAYROLL hours for the month (regular +
// overtime, exactly the same numbers as the salary sheet) and the manually-
// entered client rate per hour, then Subtotal + 15% VAT + Grand Total. Styled
// after the company letterhead (navy rule + gold accent), A4 portrait.
import { Fragment, useMemo } from 'react'
import { Printer, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { usePageRule } from '@/components/app/print/print-page-rule'
import { formatDateTime, formatMoney, formatNumber, monthName } from '@/lib/format'
import { useAppStore } from '@/lib/store'
import type { ClientSalaryGroup } from '@/lib/types'

/** "212" | "212.5" — integers stay clean, fractions keep 2dp */
function fmtHours(n: number): string {
  return Number.isInteger(n) ? String(n) : formatNumber(n, 2)
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

/** "SAR Twenty-Three Thousand Four Hundred Fifty and 50 Halalas Only" */
function amountInWords(amount: number, currency: string): string {
  const rounded = Math.round(amount * 100) / 100
  const units = Math.floor(rounded)
  const halalas = Math.round((rounded - units) * 100)
  let s = `${currency} ${toWords(units)}`
  if (halalas > 0) s += ` and ${toWords(halalas)} Halalas`
  return `${s} Only`
}

const SIGNATURES = [
  { label: 'Prepared By', title: 'Accounts Department' },
  { label: 'Approved By', title: 'General Manager' },
  { label: 'Accepted By', title: 'Client Representative' },
]

export function ClientSummaryPrintDialog({
  open,
  onOpenChange,
  group,
  month,
  year,
  vatRate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  group: ClientSalaryGroup | null
  month: number
  year: number
  vatRate: number
}) {
  const settings = useAppStore((s) => s.settings)

  // Force A4 portrait for this statement
  usePageRule(open, 'size: A4 portrait; margin: 12mm;')

  const money = (n: number) => formatMoney(n, settings.currency)
  const vatPercent = Math.round(vatRate * 100)

  // Rows grouped by project (rates are entered per worker inside each project)
  const byProject = useMemo(() => {
    if (!group) return []
    const map = new Map<string, { name: string; rows: typeof group.rows }>()
    for (const r of group.rows) {
      let p = map.get(r.projectId)
      if (!p) {
        p = { name: r.projectName, rows: [] }
        map.set(r.projectId, p)
      }
      p.rows.push(r)
    }
    return Array.from(map.values())
  }, [group])

  const hasOt = (group?.otHours ?? 0) > 0 || (group?.rows.some((r) => r.otHours > 0) ?? false)

  if (!group) return null

  const periodLabel = `${monthName(month)} ${year}`
  const th =
    'border border-neutral-300 bg-neutral-100 px-1.5 py-1.5 text-left font-semibold text-neutral-800'
  const thR = `${th} text-right`
  const td = 'border border-neutral-300 px-1.5 py-1 align-top text-neutral-900'
  const tdR = `${td} text-right tabular-nums`

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[92vh] max-h-[92vh] w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[900px] print:static print:h-auto print:max-h-none print:w-full print:translate-x-0 print:translate-y-0 print:overflow-visible print:rounded-none print:border-0 print:p-0 print:shadow-none"
      >
        <DialogTitle className="sr-only">Client summary print preview</DialogTitle>
        <DialogDescription className="sr-only">
          Printable monthly billing summary for {group.clientName}
        </DialogDescription>

        {/* Toolbar (hidden when printing) */}
        <div className="print-hidden flex flex-wrap items-center justify-between gap-3 border-b bg-card px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold">{group.clientName} — Billing Statement</h2>
            <p className="text-xs text-muted-foreground">
              {periodLabel} · {group.workerCount} worker{group.workerCount === 1 ? '' : 's'} ·{' '}
              {fmtHours(group.hours)} hours
              {group.otHours > 0 ? ` + ${fmtHours(group.otHours)} OT` : ''} · A4 portrait
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
          <div className="print-area mx-auto min-w-[640px] max-w-[820px] bg-white p-6 text-neutral-900 shadow-sm print:min-w-0 print:max-w-none print:p-0">
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
                    Client Salary Summary — Manpower Billing
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
                  Billing Period
                </p>
                <p className="text-base font-bold text-[#0F1F3D]">{periodLabel}</p>
                <p className="mt-2 text-[10px] font-semibold uppercase tracking-widest text-neutral-500">
                  Grand Total (incl. {vatPercent}% VAT)
                </p>
                <p className="text-xl font-bold tabular-nums">{money(group.grandTotal)}</p>
              </div>
            </div>
            <div className="mt-[3px] h-[3px] w-28 bg-[#D4AF37]" aria-hidden />

            {/* Bill-To block */}
            <div className="mt-5 flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-neutral-500">
                  Bill To
                </p>
                <p className="mt-0.5 text-base font-bold text-[#0F1F3D]">{group.clientName}</p>
                <p className="text-[11px] leading-relaxed text-neutral-600">
                  {[
                    group.address,
                    group.city,
                    group.contactPerson ? `Attn: ${group.contactPerson}` : null,
                    group.phone,
                    group.email,
                    group.crNumber ? `CR No: ${group.crNumber}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ') || '—'}
                </p>
              </div>
              <div className="text-right text-[11px] text-neutral-600">
                <p>
                  <span className="font-semibold text-neutral-800">Workers:</span>{' '}
                  {group.workerCount}
                </p>
                <p>
                  <span className="font-semibold text-neutral-800">Projects:</span>{' '}
                  {group.projectCount}
                </p>
                <p>
                  <span className="font-semibold text-neutral-800">Total Hours:</span>{' '}
                  {fmtHours(group.hours)}
                  {group.otHours > 0 ? ` + ${fmtHours(group.otHours)} OT` : ''}
                </p>
                <p className="text-[9px] text-neutral-400">
                  Generated: {formatDateTime(new Date())}
                </p>
              </div>
            </div>

            {/* Billing table — one line per worker (× project) */}
            <table className="mt-4 w-full border-collapse text-[11px]">
              <thead>
                <tr>
                  <th className={`${th} text-center`}>SN</th>
                  <th className={th}>Worker</th>
                  <th className={th}>Position</th>
                  <th className={th}>Project</th>
                  <th className={thR}>Hours</th>
                  <th className={thR}>OT Hrs</th>
                  <th className={thR}>Rate / Hr</th>
                  <th className={thR}>OT Rate</th>
                  <th className={thR}>Amount ({settings.currency})</th>
                </tr>
              </thead>
              <tbody>
                {byProject.map((p) => (
                  <Fragment key={p.name}>
                    {p.rows.map((r, i) => (
                      <tr key={`${r.staffId}-${r.projectId}`} className="break-inside-avoid">
                        <td className={`${td} text-center tabular-nums`}>{i + 1}</td>
                        <td className={td}>
                          <span className="font-semibold">{r.fullName}</span>
                          <span className="block text-[9px] text-neutral-500">
                            IQAMA: {r.iqamaId}
                          </span>
                        </td>
                        <td className={td}>{r.position ?? '—'}</td>
                        <td className={td}>
                          <span className="font-medium">{r.projectName}</span>
                        </td>
                        <td className={tdR}>{fmtHours(r.hours)}</td>
                        <td className={tdR}>{r.otHours > 0 ? fmtHours(r.otHours) : '—'}</td>
                        <td className={tdR}>{formatNumber(r.clientRate)}</td>
                        <td className={tdR}>{r.otHours > 0 ? formatNumber(r.clientOtRate) : '—'}</td>
                        <td className={`${tdR} font-semibold`}>{money(r.amount)}</td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className={`${td} bg-neutral-50`} colSpan={4}>
                    <span className="font-semibold">SUBTOTAL — {group.workerCount} worker{group.workerCount === 1 ? '' : 's'}</span>
                  </td>
                  <td className={`${tdR} bg-neutral-50 font-semibold`}>{fmtHours(group.hours)}</td>
                  <td className={`${tdR} bg-neutral-50 font-semibold`}>
                    {group.otHours > 0 ? fmtHours(group.otHours) : '—'}
                  </td>
                  <td className={`${tdR} bg-neutral-50`}></td>
                  <td className={`${tdR} bg-neutral-50`}></td>
                  <td className={`${tdR} bg-neutral-50 font-semibold`}>
                    {money(group.billedAmount)}
                  </td>
                </tr>
                <tr>
                  <td
                    className={`${td} bg-neutral-50`}
                    colSpan={8}
                  >
                    <span className="font-semibold">VAT ({vatPercent}%)</span>
                  </td>
                  <td className={`${tdR} bg-neutral-50 font-semibold`}>{money(group.vatAmount)}</td>
                </tr>
                <tr className="bg-[#0F1F3D] font-bold text-white">
                  <td className="border border-[#0F1F3D] px-1.5 py-1.5" colSpan={8}>
                    GRAND TOTAL (incl. {vatPercent}% VAT)
                  </td>
                  <td className="border border-[#0F1F3D] px-1.5 py-1.5 text-right tabular-nums">
                    {money(group.grandTotal)}
                  </td>
                </tr>
              </tfoot>
            </table>

            {/* Amount in words */}
            <p className="mt-3 text-[11px] text-neutral-700">
              <span className="font-semibold">Amount in Words: </span>
              <span className="uppercase">{amountInWords(group.grandTotal, settings.currency)}</span>
            </p>

            {/* Payment note */}
            <p className="mt-2 text-[10px] leading-relaxed text-neutral-500">
              This statement covers manpower supply services for {periodLabel}: each worker&apos;s
              payroll hours (regular{hasOt ? ' + overtime' : ''}) × the agreed client rate per hour.
              Hours match the {periodLabel} payroll exactly. Worker salaries are disbursed separately
              by {settings.companyName} under its own payroll.
            </p>

            {/* Signature blocks */}
            <div className="mt-12 grid grid-cols-3 gap-8">
              {SIGNATURES.map((s) => (
                <div key={s.label}>
                  <div className="h-10" aria-hidden="true" />
                  <div className="border-t border-dashed border-neutral-600" />
                  <p className="mt-1.5 text-xs font-semibold">{s.label}</p>
                  <p className="text-[10px] text-neutral-500">{s.title}</p>
                </div>
              ))}
            </div>

            {/* Footer note */}
            <p className="mt-8 border-t border-neutral-200 pt-2 text-center text-[9px] text-neutral-400">
              This client salary summary is computer-generated by the {settings.companyName}{' '}
              Workforce, Payroll &amp; Accounts System · Generated on{' '}
              {formatDateTime(new Date())}
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

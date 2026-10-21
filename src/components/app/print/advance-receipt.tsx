'use client'

// Advance Payment Receipt — printable A4 portrait document for a single worker
// advance. Opened from the Worker Advances table (Receipt button per row) and
// auto-opened right after recording a NEW advance, so the money handler can
// print / save-as-PDF a receipt the worker physically signs ("Received By").
// Styled after the company letterhead (navy rule + gold accent) like the
// salary slip, with amount in words, the salary recovery schedule and
// signature blocks (Received By / Prepared By / Approved By).
import { Printer, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { usePageRule } from '@/components/app/print/print-page-rule'
import { formatDate, formatMoney, monthName, round2 } from '@/lib/format'
import {
  advanceRef,
  lastInstallmentMonth,
  monthlyInstallment,
} from '@/lib/advances'
import { useAppStore } from '@/lib/store'
import type { AdvanceRow, AppSettings } from '@/lib/types'

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

/**
 * Full-screen dialog rendering an A4-style advance payment receipt.
 * The receipt itself is wrapped in `.print-area` (globals.css) so that
 * window.print() outputs ONLY the receipt, always white/black for fidelity.
 */
export function AdvanceReceiptDialog({
  advance,
  open,
  onOpenChange,
}: {
  advance: AdvanceRow | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const settings = useAppStore((s) => s.settings)
  usePageRule(open, 'size: A4 portrait; margin: 12mm;')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[92vh] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl print:static print:max-h-none print:w-full print:max-w-none print:translate-x-0 print:translate-y-0 print:overflow-visible print:rounded-none print:border-0 print:p-0 print:shadow-none"
      >
        <DialogTitle className="sr-only">Advance Payment Receipt</DialogTitle>
        <DialogDescription className="sr-only">
          Printable advance payment receipt with the worker&apos;s acknowledgment and signature lines.
        </DialogDescription>

        {/* Top button bar — hidden when printing */}
        <div className="print-hidden flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">
              {advance ? `Advance Receipt — ${advanceRef(advance.id)}` : 'Advance Receipt'}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {advance
                ? `${advance.staff.fullName} · ${formatMoney(advance.amount, settings.currency || 'SAR')}`
                : 'Select an advance to preview the receipt'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              <X className="h-4 w-4" />
              Close
            </Button>
            <Button size="sm" onClick={() => window.print()} disabled={!advance}>
              <Printer className="h-4 w-4" />
              Print / Save as PDF
            </Button>
          </div>
        </div>

        {/* Scrollable preview area */}
        <div className="nice-scrollbar min-h-0 flex-1 overflow-auto bg-neutral-100 p-4 dark:bg-neutral-900 print:flex-none print:overflow-visible print:bg-transparent print:p-0">
          {advance ? (
            <AdvanceReceiptDocument advance={advance} settings={settings} />
          ) : (
            <div className="flex min-h-[300px] items-center justify-center bg-white p-16 text-sm text-neutral-400">
              No advance selected.
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
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

/**
 * One signature cell: empty space to physically sign, a ruled line, the
 * uppercase role label, the printed name (or a blank hint) and a date line.
 */
function SignatureBlock({
  label,
  name,
  sub,
  emphasize = false,
}: {
  label: string
  name: string
  sub?: string
  emphasize?: boolean
}) {
  return (
    <div className="min-w-0">
      <div className="flex h-12 items-end">
        <div className="w-full border-t border-neutral-800" />
      </div>
      <p
        className={`mt-1.5 text-[11px] font-bold uppercase tracking-widest ${
          emphasize ? 'text-neutral-900' : 'text-neutral-600'
        }`}
      >
        {label}
      </p>
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

function AdvanceReceiptDocument({ advance, settings }: { advance: AdvanceRow; settings: AppSettings }) {
  const user = useAppStore((s) => s.user)
  const currency = settings.currency || 'SAR'
  const a = advance

  const share = monthlyInstallment(a)
  const last = lastInstallmentMonth(a)
  const remaining = round2(a.amount - a.deductedAmount)
  const installments = Math.max(1, Math.round(a.installments || 1))
  const paymentLabel = a.paymentMethod === 'bank_transfer' ? 'Bank Transfer' : 'Cash'
  const companyName = settings.companyName || 'Landmark Inter Gulf'
  const signatory = settings.authorizedSignatory?.trim() || ''
  const signatoryTitle = settings.signatoryTitle?.trim() || 'Authorized Signatory'

  const scheduleRows: { label: string; value: string; strong?: boolean }[] = [
    { label: 'Total Advance Amount', value: formatMoney(a.amount, currency) },
    {
      label: 'Recovery Starts',
      value: `${monthName(a.deductionMonth)} ${a.deductionYear}`,
    },
    {
      label: 'Deduction Plan',
      value:
        installments > 1
          ? `${installments} monthly installments × ${formatMoney(share, currency)}`
          : 'Single deduction from salary',
    },
  ]
  if (installments > 1) {
    scheduleRows.push({
      label: 'Last Installment',
      value: `${monthName(last.month)} ${last.year}`,
    })
  }
  scheduleRows.push(
    { label: 'Recovered So Far', value: formatMoney(a.deductedAmount, currency) },
    { label: 'Remaining Balance', value: formatMoney(remaining, currency), strong: true }
  )

  return (
    <div className="print-area relative mx-auto w-full min-w-[620px] max-w-[210mm] bg-white p-6 text-neutral-900 shadow-sm sm:min-w-0 [print-color-adjust:exact] [-webkit-print-color-adjust:exact]">
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
            ADVANCE RECEIPT
          </span>
          <span className="text-xs font-medium text-neutral-600">
            Receipt No: <span className="font-mono font-semibold">{advanceRef(a.id)}</span>
          </span>
          <span className="text-xs text-neutral-500">Issued: {formatDate(new Date())}</span>
          {a.status === 'deducted' ? (
            <span className="mt-2 inline-block -rotate-6 rounded-md border-[3px] border-emerald-600 px-2.5 py-0.5 text-xs font-black uppercase tracking-[0.2em] text-emerald-700 shadow-[inset_0_0_0_1.5px_rgba(5,150,105,0.35)]">
              Recovered
            </span>
          ) : a.status === 'partially_deducted' ? (
            <span className="mt-2 inline-block -rotate-6 rounded-md border-[3px] border-amber-500 px-2.5 py-0.5 text-xs font-black uppercase tracking-[0.2em] text-amber-600 shadow-[inset_0_0_0_1.5px_rgba(217,119,6,0.35)]">
              Partially Recovered
            </span>
          ) : (
            <span className="mt-2 inline-block -rotate-6 rounded-md border-[3px] border-neutral-500 px-2.5 py-0.5 text-xs font-black uppercase tracking-[0.2em] text-neutral-600 shadow-[inset_0_0_0_1.5px_rgba(115,115,115,0.3)]">
              Pending Recovery
            </span>
          )}
        </div>
      </header>
      {/* gold accent segment under the navy header rule */}
      <div className="mt-[3px] h-[3px] w-24 bg-[#D4AF37]" aria-hidden />

      {/* WORKER + PAYMENT INFO BLOCK */}
      <section className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 rounded-lg border border-neutral-200 bg-neutral-50 p-4 sm:grid-cols-3">
        <InfoItem label="Worker Name" value={a.staff.fullName} />
        <InfoItem label="Iqama ID" value={a.staff.iqamaId} />
        <InfoItem label="Position" value={a.staff.position || '—'} />
        <InfoItem label="Date Given" value={formatDate(a.givenDate)} />
        <InfoItem label="Payment Method" value={paymentLabel} />
        <InfoItem label="Reference / Notes" value={a.reference || '—'} />
      </section>

      {/* AMOUNT BAR */}
      <div className="mt-4 flex flex-col items-center gap-1 bg-[#0F1F3D] px-4 py-3 text-white sm:flex-row sm:items-center sm:justify-between">
        <span className="text-sm font-bold tracking-wide">TOTAL ADVANCE PAID</span>
        <span className="text-xs text-neutral-300">
          {paymentLabel} · {formatDate(a.givenDate)}
        </span>
        <span className="text-2xl font-bold tabular-nums">{formatMoney(a.amount, currency)}</span>
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-neutral-600">
        <span className="font-semibold uppercase tracking-wide">Amount in words:</span>{' '}
        {amountInWords(a.amount, currency)}
      </p>

      {/* SALARY RECOVERY SCHEDULE */}
      <section className="mt-4">
        <h3 className="mb-2 text-xs font-bold uppercase tracking-widest text-neutral-500">
          Salary Recovery Schedule
        </h3>
        <table className="w-full border-collapse text-sm">
          <tbody>
            {scheduleRows.map((r) => (
              <tr key={r.label}>
                <td className="w-[45%] border border-neutral-300 bg-neutral-50 px-2.5 py-1.5 font-medium">
                  {r.label}
                </td>
                <td
                  className={`border border-neutral-300 px-2.5 py-1.5 tabular-nums ${
                    r.strong ? 'font-bold text-[#0F1F3D]' : ''
                  }`}
                >
                  {r.value}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* WORKER ACKNOWLEDGMENT — printed with the receipt so the worker
          receiving the money can physically sign it */}
      <section className="mt-4 break-inside-avoid rounded-lg border border-neutral-300 p-4">
        <h3 className="text-xs font-bold uppercase tracking-widest text-neutral-500">
          Worker Acknowledgment
        </h3>
        <p className="mt-1.5 text-xs leading-relaxed text-neutral-700">
          I, <span className="font-semibold">{a.staff.fullName}</span> (Iqama No.{' '}
          <span className="font-semibold tabular-nums">{a.staff.iqamaId}</span>), hereby acknowledge
          that I have received an advance payment of{' '}
          <span className="font-semibold tabular-nums">{formatMoney(a.amount, currency)}</span> (
          {amountInWords(a.amount, currency).replace(' Only', '')}) from {companyName} on{' '}
          {formatDate(a.givenDate)} by {paymentLabel}
          {a.reference ? ` (Ref: ${a.reference})` : ''}. I understand and agree that this advance
          will be recovered from my salary{' '}
          {installments > 1 ? (
            <>
              in {installments} monthly installments of{' '}
              <span className="font-semibold tabular-nums">{formatMoney(share, currency)}</span>{' '}
              each, starting {monthName(a.deductionMonth)} {a.deductionYear}, with the last
              installment in {monthName(last.month)} {last.year}
            </>
          ) : (
            <>
              in full from my {monthName(a.deductionMonth)} {a.deductionYear} salary
            </>
          )}
          , and I have no objection to these deductions.
        </p>

        <div className="mt-5 grid grid-cols-1 gap-x-10 gap-y-5 sm:grid-cols-3">
          <SignatureBlock
            label="Received By"
            name={a.staff.fullName}
            sub={`Iqama: ${a.staff.iqamaId}`}
            emphasize
          />
          <SignatureBlock label="Prepared By" name={user?.name ?? ''} sub="Accounts Department" />
          <SignatureBlock label="Approved By" name={signatory} sub={signatoryTitle} />
        </div>
      </section>

      <p className="mt-3 text-center text-[10px] text-neutral-400">
        This is a computer-generated advance payment receipt.
      </p>
    </div>
  )
}

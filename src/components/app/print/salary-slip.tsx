'use client'

import { Printer, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { formatDate, formatMoney, monthName, round2 } from '@/lib/format'
import { useAppStore } from '@/lib/store'
import { PAY_TYPE_LABELS, type AppSettings, type PayrollRow } from '@/lib/types'

export type SlipPayroll = PayrollRow & { otherDeductionAmount?: number }

/**
 * Full-screen dialog rendering an A4-style salary pay slip.
 * The slip itself is wrapped in `.print-area` (globals.css) so that
 * window.print() outputs ONLY the slip, always on white/black for fidelity.
 * The document ends with an Approval & Acknowledgment block: Approved By
 * (authorized signatory) and Received By (the staff member who collects the
 * money) each get a signature line + date, so the printed / saved-as-PDF
 * slip can be physically signed.
 */
export function SalarySlipDialog({
  payroll,
  open,
  onOpenChange,
}: {
  payroll: SlipPayroll | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const settings = useAppStore((s) => s.settings)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[92vh] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl print:static print:max-h-none print:w-full print:max-w-none print:translate-x-0 print:translate-y-0 print:overflow-visible print:rounded-none print:border-0 print:p-0 print:shadow-none"
      >
        <DialogTitle className="sr-only">Salary Slip</DialogTitle>
        <DialogDescription className="sr-only">
          Printable salary pay slip document with approval and receipt signature lines.
        </DialogDescription>

        {/* Top button bar — hidden when printing */}
        <div className="print-hidden flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">
              {payroll ? `Salary Slip — ${monthName(payroll.month)} ${payroll.year}` : 'Salary Slip'}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {payroll ? payroll.staff.fullName : 'Select a payroll to preview the slip'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              <X className="h-4 w-4" />
              Close
            </Button>
            <Button size="sm" onClick={() => window.print()} disabled={!payroll}>
              <Printer className="h-4 w-4" />
              Print / Save as PDF
            </Button>
          </div>
        </div>

        {/* Scrollable preview area */}
        <div className="nice-scrollbar min-h-0 flex-1 overflow-auto bg-neutral-100 p-4 dark:bg-neutral-900 print:flex-none print:overflow-visible print:bg-transparent print:p-0">
          {payroll ? (
            <SalarySlipDocument payroll={payroll} settings={settings} />
          ) : (
            <div className="flex min-h-[300px] items-center justify-center bg-white p-16 text-sm text-neutral-400">
              No payroll selected.
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
      {/* Signing space above the ruled line */}
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

function SalarySlipDocument({ payroll, settings }: { payroll: SlipPayroll; settings: AppSettings }) {
  const user = useAppStore((s) => s.user)
  const currency = settings.currency || 'SAR'
  const p = payroll

  // Computed line items (server values are the source of truth for totals)
  const regularPay = round2(p.totalHours * p.hourlyRateSnapshot)
  const overtimePay = round2(p.overtimeHours * p.overtimeRateSnapshot)
  const otherDedAmount =
    p.otherDeductionAmount ??
    (p.otherDeductionType === 'percent'
      ? round2((p.grossPay * p.otherDeductionValue) / 100)
      : round2(p.otherDeductionValue))

  const companyName = settings.companyName || 'Landmark Inter Gulf'
  const signatory = settings.authorizedSignatory?.trim() || ''
  const signatoryTitle = settings.signatoryTitle?.trim() || 'Authorized Signatory'

  return (
    <div className="print-area relative mx-auto w-full min-w-[700px] max-w-[210mm] bg-white p-6 text-neutral-900 shadow-sm sm:min-w-0 [print-color-adjust:exact] [-webkit-print-color-adjust:exact]">
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
            SALARY PAY SLIP
          </span>
          <span className="text-xs text-neutral-500">Issued: {formatDate(new Date())}</span>
          {p.status === 'paid' ? (
            <span className="mt-3 inline-block -rotate-6 rounded-md border-[3px] border-emerald-600 px-3 py-1 shadow-[inset_0_0_0_1.5px_rgba(5,150,105,0.35)] text-sm font-black uppercase tracking-[0.25em] text-emerald-700">
              Paid
            </span>
          ) : (
            <span className="mt-3 inline-block rounded border-2 border-amber-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.2em] text-amber-600">
              Pending
            </span>
          )}
        </div>
      </header>
      {/* gold accent segment under the navy header rule */}
      <div className="mt-[3px] h-[3px] w-24 bg-[#D4AF37]" aria-hidden />

      {/* INFO BLOCK */}
      <section className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 rounded-lg border border-neutral-200 bg-neutral-50 p-4 sm:grid-cols-3">
        <InfoItem label="Staff Name" value={p.staff.fullName} />
        <InfoItem label="Iqama ID" value={p.staff.iqamaId} />
        <InfoItem label="Category" value={p.staff.staffCategory?.name ?? '—'} />
        <InfoItem label="Pay Period" value={`${monthName(p.month)} ${p.year}`} />
        <InfoItem label="Pay Date" value={formatDate(p.payDate)} />
        <InfoItem label="Payment Method" value={PAY_TYPE_LABELS[p.payType] ?? p.payType} />
        <InfoItem label="Hourly Rate" value={`${formatMoney(p.hourlyRateSnapshot, currency)}/hr`} />
        <InfoItem label="Assigned Project" value={p.project?.name ?? '—'} />
        <InfoItem label="Client Company" value={p.project?.clientName ?? '—'} />
      </section>

      {/* EARNINGS + DEDUCTIONS — side by side so the slip fits one A4 page */}
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <section>
          <h3 className="mb-2 text-xs font-bold uppercase tracking-widest text-neutral-500">
            Earnings
          </h3>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="border border-neutral-300 bg-neutral-100 px-2.5 py-1.5 text-left font-semibold">
                  Description
                </th>
                <th className="w-[120px] border border-neutral-300 bg-neutral-100 px-2.5 py-1.5 text-right font-semibold">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border border-neutral-300 px-2.5 py-1.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                    <span className="font-medium">Regular Work Hours</span>
                    <span className="text-[11px] tabular-nums text-neutral-500">
                      {p.totalHours.toFixed(1)} hrs @ {formatMoney(p.hourlyRateSnapshot, currency)}/hr
                    </span>
                  </div>
                </td>
                <td className="border border-neutral-300 px-2.5 py-1.5 text-right font-medium tabular-nums">
                  {formatMoney(regularPay, currency)}
                </td>
              </tr>
              <tr>
                <td className="border border-neutral-300 px-2.5 py-1.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                    <span className="font-medium">Overtime Hours</span>
                    <span className="text-[11px] tabular-nums text-neutral-500">
                      {p.overtimeHours.toFixed(1)} hrs @ {formatMoney(p.overtimeRateSnapshot, currency)}
                      /hr
                    </span>
                  </div>
                </td>
                <td className="border border-neutral-300 px-2.5 py-1.5 text-right font-medium tabular-nums">
                  {formatMoney(overtimePay, currency)}
                </td>
              </tr>
              <tr>
                <td className="border border-neutral-300 px-2.5 py-1.5 font-medium">
                  Other Earnings / Bonus
                </td>
                <td className="border border-neutral-300 px-2.5 py-1.5 text-right font-medium tabular-nums">
                  {formatMoney(p.otherEarnings, currency)}
                </td>
              </tr>
              <tr>
                <td className="border border-t-2 border-t-neutral-800 border-neutral-300 px-2.5 py-1.5 font-bold">
                  TOTAL GROSS PAY
                </td>
                <td className="border border-t-2 border-t-neutral-800 border-neutral-300 px-2.5 py-1.5 text-right font-bold tabular-nums">
                  {formatMoney(p.grossPay, currency)}
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-bold uppercase tracking-widest text-neutral-500">
            Deductions
          </h3>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="border border-neutral-300 bg-neutral-100 px-2.5 py-1.5 text-left font-semibold">
                  Description
                </th>
                <th className="w-[120px] border border-neutral-300 bg-neutral-100 px-2.5 py-1.5 text-right font-semibold">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border border-neutral-300 px-2.5 py-1.5">Advance Deduction</td>
                <td className="border border-neutral-300 px-2.5 py-1.5 text-right tabular-nums">
                  {formatMoney(p.advance, currency)}
                </td>
              </tr>
              <tr>
                <td className="border border-neutral-300 px-2.5 py-1.5">Absent Penalty</td>
                <td className="border border-neutral-300 px-2.5 py-1.5 text-right tabular-nums">
                  {formatMoney(p.absentPenalty, currency)}
                </td>
              </tr>
              <tr>
                <td className="border border-neutral-300 px-2.5 py-1.5">PT</td>
                <td className="border border-neutral-300 px-2.5 py-1.5 text-right tabular-nums">
                  {formatMoney(p.ptAmount, currency)}
                </td>
              </tr>
              <tr>
                <td className="border border-neutral-300 px-2.5 py-1.5">Union Fees</td>
                <td className="border border-neutral-300 px-2.5 py-1.5 text-right tabular-nums">
                  {formatMoney(p.unionFees, currency)}
                </td>
              </tr>
              <tr>
                <td className="border border-neutral-300 px-2.5 py-1.5">
                  {p.otherDeductionType === 'percent'
                    ? `Other Deductions (${p.otherDeductionValue}%)`
                    : 'Other Deductions'}
                </td>
                <td className="border border-neutral-300 px-2.5 py-1.5 text-right tabular-nums">
                  {formatMoney(otherDedAmount, currency)}
                </td>
              </tr>
              <tr>
                <td className="border border-t-2 border-t-neutral-800 border-neutral-300 px-2.5 py-1.5 font-bold text-red-600">
                  TOTAL DEDUCTIONS
                </td>
                <td className="border border-t-2 border-t-neutral-800 border-neutral-300 px-2.5 py-1.5 text-right font-bold tabular-nums text-red-600">
                  {formatMoney(p.totalDeductions, currency)}
                </td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>

      {/* NET PAYABLE BAR */}
      <div className="mt-4 flex flex-col items-center gap-1 bg-neutral-900 px-4 py-2.5 text-white sm:flex-row sm:items-center sm:justify-between">
        <span className="text-sm font-bold tracking-wide">NET SALARY PAYABLE</span>
        <span className="text-xs text-neutral-300">
          Disbursement for {monthName(p.month)} {p.year}
        </span>
        <span className="text-xl font-bold tabular-nums">{formatMoney(p.netPay, currency)}</span>
      </div>

      {/* APPROVAL & ACKNOWLEDGMENT — printed with the slip so the approver
          and the staff member receiving the money can physically sign */}
      <section className="mt-4 break-inside-avoid rounded-lg border border-neutral-300 p-4">
        <h3 className="text-xs font-bold uppercase tracking-widest text-neutral-500">
          Approval &amp; Acknowledgment
        </h3>
        <p className="mt-1.5 text-xs leading-relaxed text-neutral-700">
          I hereby acknowledge that I have received my full and final net salary of{' '}
          <span className="font-semibold tabular-nums">{formatMoney(p.netPay, currency)}</span> for{' '}
          {monthName(p.month)} {p.year} by {PAY_TYPE_LABELS[p.payType] ?? p.payType}
          {p.project ? <> for my work on {p.project.name}{p.project.clientName ? <> at {p.project.clientName}</> : null}</> : null}. I confirm the
          earnings and deductions stated on this slip are correct and I have no further claims
          against {companyName} for this period.
        </p>

        <div className="mt-5 grid grid-cols-1 gap-x-10 gap-y-5 sm:grid-cols-3">
          <SignatureBlock
            label="Prepared By"
            name={user?.name ?? ''}
            sub="Payroll Department"
          />
          <SignatureBlock label="Approved By" name={signatory} sub={signatoryTitle} />
          <SignatureBlock
            label="Received By"
            name={p.staff.fullName}
            sub={`Iqama: ${p.staff.iqamaId}`}
            emphasize
          />
        </div>
      </section>

      <p className="mt-3 text-center text-[10px] text-neutral-400">
        This is a computer-generated pay slip.
      </p>
    </div>
  )
}

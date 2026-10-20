'use client'

// Name List print report — A4 portrait company directory:
//   • company letterhead (logo + name + address from Settings)
//   • the FILTERED companies table (name, type, contact, phone, email, CR, city)
//   • counts by type footer (clients / suppliers / subcontractors / others)
//   • signature lines (prepared by / authorized by)
// Print via the browser (Ctrl+P → "Save as PDF" for the PDF export).
import { Printer, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { usePageRule } from '@/components/app/print/print-page-rule'
import { formatDate } from '@/lib/format'
import { useAppStore } from '@/lib/store'
import type { NameListRow } from '@/lib/types'

export type NameListTypeCounts = {
  client: number
  supplier: number
  subcontractor: number
  other: number
}

export function NameListPrintDialog({
  open,
  onOpenChange,
  entries,
  counts,
  filterLabel,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** All entries matching the current list filters (already fetched, every page) */
  entries: NameListRow[]
  /** Per-type counts matching the search/status filters (type cards' numbers) */
  counts: NameListTypeCounts
  /** Human description of the active filters, e.g. "Suppliers · active" or "All entries" */
  filterLabel: string
}) {
  const settings = useAppStore((s) => s.settings)
  usePageRule(open, 'size: A4 portrait; margin: 12mm;')

  if (!open) return null

  const typeLabel = (t: string) =>
    t === 'client'
      ? 'Client'
      : t === 'supplier'
        ? 'Supplier'
        : t === 'subcontractor'
          ? 'Subcontractor'
          : 'Other'

  const th =
    'border border-neutral-300 bg-neutral-100 px-1.5 py-1.5 text-left font-semibold text-neutral-800'
  const td = 'border border-neutral-300 px-1.5 py-1.5 align-top text-neutral-900'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[92vh] max-h-[92vh] w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1000px] print:static print:h-auto print:max-h-none print:w-full print:translate-x-0 print:translate-y-0 print:overflow-visible print:rounded-none print:border-0 print:p-0 print:shadow-none"
      >
        <DialogTitle className="sr-only">Name list print preview</DialogTitle>
        <DialogDescription className="sr-only">
          Printable company directory with per-type counts and signature lines.
        </DialogDescription>

        {/* Toolbar (hidden when printing) */}
        <div className="print-hidden flex flex-wrap items-center justify-between gap-3 border-b bg-card px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold">Name List — {filterLabel}</h2>
            <p className="text-xs text-muted-foreground">
              A4 portrait · {entries.length} entr{entries.length === 1 ? 'y' : 'ies'}
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
          <div className="mx-auto w-full max-w-[820px] bg-white p-8 text-neutral-900 shadow-sm [print-color-adjust:exact] [-webkit-print-color-adjust:exact] print:max-w-none print:p-0 print:shadow-none">
            {/* ---- Letterhead ---- */}
            <div className="flex items-start justify-between gap-4 border-b-2 border-neutral-800 pb-4">
              <div className="flex min-w-0 items-start gap-4">
                <img
                  src={settings.logo ?? '/logo-mark.png'}
                  alt={`${settings.companyName} logo`}
                  className="h-14 w-14 shrink-0 object-contain"
                />
                <div className="min-w-0">
                  <p className="text-xl font-bold tracking-tight">{settings.companyName}</p>
                  <p className="mt-1 max-w-[420px] text-[11px] leading-relaxed text-neutral-600">
                    {settings.address}
                  </p>
                </div>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm font-bold uppercase tracking-widest">Name List</p>
                <p className="mt-1 text-[11px] text-neutral-600">Filter: {filterLabel}</p>
                <p className="text-[11px] text-neutral-600">
                  Generated: {formatDate(new Date())}
                </p>
              </div>
            </div>

            {/* ---- Directory table ---- */}
            <h3 className="mt-5 text-[13px] font-bold uppercase tracking-wider">
              Company Directory
            </h3>
            <table className="mt-2 w-full border-collapse text-[11px]">
              <thead>
                <tr>
                  <th className={th}>#</th>
                  <th className={th}>Name</th>
                  <th className={th}>Type</th>
                  <th className={th}>Contact Person</th>
                  <th className={th}>Phone</th>
                  <th className={th}>Email</th>
                  <th className={th}>CR No</th>
                  <th className={th}>City</th>
                  <th className={th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {entries.length === 0 ? (
                  <tr>
                    <td className={td} colSpan={9}>
                      No entries match the current filters.
                    </td>
                  </tr>
                ) : (
                  entries.map((e, i) => (
                    <tr key={e.id} className="break-inside-avoid">
                      <td className={`${td} text-center tabular-nums text-neutral-600`}>{i + 1}</td>
                      <td className={`${td} font-semibold`}>{e.name}</td>
                      <td className={td}>{typeLabel(e.type)}</td>
                      <td className={td}>{e.contactPerson ?? '—'}</td>
                      <td className={`${td} tabular-nums`}>{e.phone ?? '—'}</td>
                      <td className={td}>{e.email ?? '—'}</td>
                      <td className={`${td} tabular-nums`}>{e.crNumber ?? '—'}</td>
                      <td className={td}>{e.city ?? '—'}</td>
                      <td
                        className={`${td} capitalize ${
                          e.status === 'active' ? 'text-emerald-700' : 'text-neutral-500'
                        }`}
                      >
                        {e.status}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            {/* ---- Counts by type ---- */}
            <h3 className="mt-6 text-[13px] font-bold uppercase tracking-wider">
              Counts by Type
            </h3>
            <table className="mt-2 w-full border-collapse text-[11px]">
              <tbody>
                <tr className="bg-neutral-100 font-bold">
                  <td className={td}>Clients</td>
                  <td className={td}>Suppliers</td>
                  <td className={td}>Subcontractors</td>
                  <td className={td}>Others</td>
                  <td className={td}>Total (filtered)</td>
                </tr>
                <tr>
                  <td className={`${td} text-center tabular-nums`}>{counts.client}</td>
                  <td className={`${td} text-center tabular-nums`}>{counts.supplier}</td>
                  <td className={`${td} text-center tabular-nums`}>{counts.subcontractor}</td>
                  <td className={`${td} text-center tabular-nums`}>{counts.other}</td>
                  <td className={`${td} text-center font-semibold tabular-nums`}>
                    {entries.length}
                  </td>
                </tr>
              </tbody>
            </table>

            {/* ---- Signatures ---- */}
            <div className="mt-10 flex gap-10">
              <div className="min-w-0 flex-1">
                <div className="flex h-12 items-end">
                  <div className="w-full border-t border-neutral-800" />
                </div>
                <p className="mt-1.5 text-[10px] font-bold uppercase tracking-widest text-neutral-900">
                  Prepared By
                </p>
                <p className="text-[10px] text-neutral-600">Administration</p>
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

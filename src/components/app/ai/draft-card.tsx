'use client'

// Draft card — renders an AI-prepared draft (quotation / invoice / PO /
// email / letter) inside the chat. "Open as Draft" opens a review dialog
// with a document-style preview. The AI NEVER saves anything — the user
// reviews, copies the details, and creates the record themselves via the
// normal module screens (the dialog can deep-link there).
import { useMemo, useState } from 'react'
import {
  Bot,
  Check,
  ClipboardCopy,
  FileSignature,
  FileText,
  Mail,
  Package,
  Printer,
  Sparkles,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { useAppStore } from '@/lib/store'
import type { AiDraft, ViewKey } from '@/lib/types'
import { copyText, fmtMoney, printAnswer } from './export-helpers'

const TYPE_META: Record<
  AiDraft['type'],
  { label: string; icon: React.ComponentType<{ className?: string }>; module?: ViewKey; moduleLabel?: string; tint: string }
> = {
  quotation: { label: 'Quotation', icon: FileText, module: 'quotations', moduleLabel: 'Quotations', tint: 'text-amber-700 bg-amber-500/10 border-amber-500/30' },
  invoice: { label: 'Invoice', icon: FileSignature, module: 'e-invoices', moduleLabel: 'E-Invoice', tint: 'text-emerald-700 bg-emerald-500/10 border-emerald-500/30' },
  po: { label: 'Purchase Order', icon: Package, module: 'supplier-pos', moduleLabel: 'Supplier P.O.', tint: 'text-sky-700 bg-sky-500/10 border-sky-500/30' },
  email: { label: 'Email', icon: Mail, tint: 'text-rose-700 bg-rose-500/10 border-rose-500/30' },
  letter: { label: 'Letter', icon: Printer, tint: 'text-violet-700 bg-violet-500/10 border-violet-500/30' },
}

export function DraftCard({ draft }: { draft: AiDraft }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const meta = TYPE_META[draft.type] ?? TYPE_META.letter

  return (
    <div className="my-3">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group flex w-full items-center gap-3 rounded-xl border border-gold/40 bg-gold-soft/60 p-3 text-left transition-all hover:border-gold hover:shadow-md"
      >
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border ${meta.tint}`}>
          <meta.icon className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="text-sm font-semibold">Draft {meta.label}</span>
            <Badge variant="outline" className="h-5 gap-1 border-gold/50 bg-gold/10 px-1.5 text-[10px] font-semibold text-gold-deep">
              <Sparkles className="h-3 w-3" /> AI prepared
            </Badge>
          </span>
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
            {draft.title}
          </span>
        </span>
        <span className="shrink-0 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground opacity-90 transition-opacity group-hover:opacity-100">
          Open as Draft
        </span>
      </button>

      <DraftReviewDialog
        draft={draft}
        open={open}
        onOpenChange={setOpen}
        copied={copied}
        setCopied={setCopied}
      />
    </div>
  )
}

function DraftReviewDialog({
  draft,
  open,
  onOpenChange,
  copied,
  setCopied,
}: {
  draft: AiDraft
  open: boolean
  onOpenChange: (v: boolean) => void
  copied: boolean
  setCopied: (v: boolean) => void
}) {
  const meta = TYPE_META[draft.type] ?? TYPE_META.letter
  const setView = useAppStore((s) => s.setView)
  const setPendingIntent = useAppStore((s) => s.setPendingIntent)
  const d = draft.data

  const summary = useMemo(() => computeSummary(draft), [draft])

  const handleCopy = async () => {
    const ok = await copyText(draftToText(draft))
    if (ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
      toast.success('Draft details copied — paste into the create form')
    }
  }
  const handleGoModule = async () => {
    if (!meta.module) return
    // Copy the details first so the user can paste into the create dialog
    await copyText(draftToText(draft))
    setPendingIntent({ view: meta.module, kind: 'create' })
    setView(meta.module)
    onOpenChange(false)
    toast.success(`Opening ${meta.moduleLabel} — draft details copied to your clipboard`)
  }
  const handlePrint = () => {
    printAnswer(`Draft ${meta.label} — ${draft.title}`, draftToMarkdown(draft))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] w-[95vw] max-w-2xl overflow-y-auto nice-scrollbar">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <meta.icon className="h-5 w-5 text-gold-deep" />
            Draft {meta.label}
            <Badge variant="secondary" className="font-normal text-muted-foreground">
              Review &amp; save yourself — nothing is saved yet
            </Badge>
          </DialogTitle>
          <DialogDescription>{draft.title}</DialogDescription>
        </DialogHeader>

        <div className="rounded-xl border border-border/70 bg-card p-4 text-sm shadow-sm">
          {draft.type === 'email' ? (
            <div className="space-y-3">
              <Field label="To" value={String(d.to ?? '—')} />
              <Field label="Subject" value={String(d.subject ?? '—')} />
              <div>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Body
                </p>
                <pre className="nice-scrollbar max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg bg-muted/50 p-3 font-sans text-[13px] leading-relaxed">
                  {String(d.body ?? '')}
                </pre>
              </div>
            </div>
          ) : draft.type === 'letter' ? (
            <div className="space-y-3">
              <Field label="Title" value={String(d.title ?? '—')} />
              <pre className="nice-scrollbar max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg bg-muted/50 p-3 font-sans text-[13px] leading-relaxed">
                {String(d.body ?? '')}
              </pre>
            </div>
          ) : (
            <DocumentPreview draft={draft} summary={summary} />
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={handleCopy}>
            {copied ? <Check className="mr-1.5 h-4 w-4 text-emerald-600" /> : <ClipboardCopy className="mr-1.5 h-4 w-4" />}
            {copied ? 'Copied' : 'Copy details'}
          </Button>
          <Button size="sm" variant="outline" onClick={handlePrint}>
            <Printer className="mr-1.5 h-4 w-4" /> Print / PDF
          </Button>
          {meta.module ? (
            <Button size="sm" onClick={handleGoModule} className="ml-auto">
              Open in {meta.moduleLabel} →
            </Button>
          ) : null}
        </div>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          <Bot className="mr-1 inline h-3 w-3" />
          This draft was prepared by the AI Assistant for your review. It has <strong>not</strong> been
          saved, issued or sent. Verify all figures, then create the record yourself in the module.
        </p>
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2 text-[13px]">
      <span className="w-20 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="min-w-0 break-words font-medium">{value}</span>
    </div>
  )
}

// ── document (quotation / invoice / po) preview ─────────────────────────────

type DraftSummary = {
  partyLabel: string
  party: string
  rows: { description: string; qty: string; unitPrice: number; lineTotal: number }[]
  subtotal: number
  vat: number
  total: number
  extra: { label: string; value: string }[]
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? 0))
  return isFinite(n) ? n : 0
}

function computeSummary(draft: AiDraft): DraftSummary {
  const d = draft.data
  const items = Array.isArray(d.items) ? (d.items as Record<string, unknown>[]) : []
  const rows = items.map((it) => {
    const qty = num(it.quantity) || 1
    const ratePerHour = num(it.ratePerHour)
    const hoursPerMonth = num(it.hoursPerMonth) || (ratePerHour ? 260 : 0)
    // unitPrice (monthly amount per worker) — explicit, else rate × hours
    const unitPrice =
      num(it.unitPrice) || (ratePerHour ? Math.round(ratePerHour * hoursPerMonth * 100) / 100 : 0)
    const line = num(it.lineTotal) || Math.round(qty * unitPrice * 100) / 100
    return {
      description: String(it.description ?? '—'),
      qty: ratePerHour
        ? `${qty} × ${hoursPerMonth}h @ ${ratePerHour}/h`
        : String(it.quantity ?? 1),
      unitPrice,
      lineTotal: line,
    }
  })
  const subtotal = Math.round(rows.reduce((s, r) => s + r.lineTotal, 0) * 100) / 100
  const vatPct = num(d.vatPercent ?? 15)
  const vat = Math.round(subtotal * (vatPct / 100) * 100) / 100
  const extra: { label: string; value: string }[] = []
  if (draft.type === 'quotation') {
    if (d.contractMonths) extra.push({ label: 'Contract', value: `${num(d.contractMonths)} months` })
    if (d.validityDays) extra.push({ label: 'Valid for', value: `${num(d.validityDays)} days` })
    if (d.notes) extra.push({ label: 'Notes', value: String(d.notes) })
  }
  if (draft.type === 'po') {
    if (d.paymentTerms) extra.push({ label: 'Payment terms', value: String(d.paymentTerms) })
    if (d.notes) extra.push({ label: 'Terms', value: String(d.notes) })
  }
  if (draft.type === 'invoice' && d.dueDays) {
    extra.push({ label: 'Payment due', value: `within ${num(d.dueDays)} days` })
  }
  return {
    partyLabel: draft.type === 'po' ? 'Supplier' : 'Client',
    party: String(d.clientName ?? d.supplierName ?? d.to ?? '—'),
    rows,
    subtotal,
    vat,
    total: Math.round((subtotal + vat) * 100) / 100,
    extra,
  }
}

function DocumentPreview({ draft, summary }: { draft: AiDraft; summary: DraftSummary }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border/60 pb-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {summary.partyLabel}
          </p>
          <p className="text-sm font-bold">{summary.party}</p>
          {draft.data.subject ? (
            <p className="text-xs text-muted-foreground">{String(draft.data.subject)}</p>
          ) : null}
        </div>
        <Badge variant="outline" className="border-gold/50 bg-gold/10 text-gold-deep">
          DRAFT — not saved
        </Badge>
      </div>
      {summary.rows.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-border/60">
          <table className="w-full text-[12.5px]">
            <thead className="bg-primary text-primary-foreground">
              <tr>
                <th className="px-3 py-1.5 text-left font-semibold">Description</th>
                <th className="px-3 py-1.5 text-right font-semibold">Qty</th>
                <th className="px-3 py-1.5 text-right font-semibold">Unit Price</th>
                <th className="px-3 py-1.5 text-right font-semibold">Line Total</th>
              </tr>
            </thead>
            <tbody>
              {summary.rows.map((r, i) => (
                <tr key={i} className="border-b border-border/40 even:bg-muted/40">
                  <td className="px-3 py-1.5">{r.description}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{r.qty}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{fmtMoney(r.unitPrice)}</td>
                  <td className="px-3 py-1.5 text-right font-medium tabular-nums">{fmtMoney(r.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No line items in this draft.</p>
      )}
      <div className="ml-auto w-full max-w-64 space-y-1 text-[13px]">
        <Row label="Subtotal (excl. VAT)" value={fmtMoney(summary.subtotal)} />
        <Row label="VAT 15%" value={fmtMoney(summary.vat)} />
        <div className="my-1 border-t border-gold/50" />
        <Row label="Total" value={fmtMoney(summary.total)} bold />
      </div>
      {summary.extra.length > 0 ? (
        <div className="space-y-1 rounded-lg bg-muted/40 p-2.5 text-xs">
          {summary.extra.map((e) => (
            <p key={e.label}>
              <span className="font-semibold">{e.label}:</span> {e.value}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className={bold ? 'font-bold' : 'text-muted-foreground'}>{label}</span>
      <span className={`tabular-nums ${bold ? 'text-base font-bold text-primary' : 'font-medium'}`}>
        {value}
      </span>
    </div>
  )
}

// ── text/markdown serialization (clipboard + print) ─────────────────────────

export function draftToText(draft: AiDraft): string {
  const d = draft.data
  if (draft.type === 'email' || draft.type === 'letter') {
    const head = draft.type === 'email' ? `To: ${d.to ?? '—'}\nSubject: ${d.subject ?? '—'}` : `Title: ${d.title ?? '—'}`
    return `${head}\n\n${String(d.body ?? '')}`
  }
  const s = computeSummary(draft)
  const lines: string[] = []
  lines.push(`${s.partyLabel}: ${s.party}`)
  if (d.subject) lines.push(`Subject: ${String(d.subject)}`)
  lines.push('')
  lines.push('Description\tQty\tUnit Price\tLine Total')
  for (const r of s.rows) {
    lines.push(`${r.description}\t${r.qty}\t${r.unitPrice.toFixed(2)}\t${r.lineTotal.toFixed(2)}`)
  }
  lines.push('')
  lines.push(`Subtotal: ${s.subtotal.toFixed(2)}`)
  lines.push(`VAT: ${s.vat.toFixed(2)}`)
  lines.push(`Total: ${s.total.toFixed(2)}`)
  for (const e of s.extra) lines.push(`${e.label}: ${e.value}`)
  return lines.join('\n')
}

export function draftToMarkdown(draft: AiDraft): string {
  const d = draft.data
  if (draft.type === 'email' || draft.type === 'letter') {
    const head = draft.type === 'email' ? `**To:** ${d.to ?? '—'}  \n**Subject:** ${d.subject ?? '—'}` : `**${d.title ?? ''}**`
    return `${head}\n\n${String(d.body ?? '')}`
  }
  const s = computeSummary(draft)
  const lines: string[] = [`**${s.partyLabel}:** ${s.party}`]
  if (d.subject) lines.push(`**Subject:** ${String(d.subject)}`)
  lines.push('')
  if (s.rows.length) {
    lines.push('| Description | Qty | Unit Price | Line Total |')
    lines.push('|---|---:|---:|---:|')
    for (const r of s.rows) {
      lines.push(`| ${r.description} | ${r.qty} | ${r.unitPrice.toFixed(2)} | ${r.lineTotal.toFixed(2)} |`)
    }
    lines.push('')
    lines.push(`**Subtotal:** SAR ${s.subtotal.toFixed(2)}  `)
    lines.push(`**VAT:** SAR ${s.vat.toFixed(2)}  `)
    lines.push(`**Total:** SAR ${s.total.toFixed(2)}`)
  }
  for (const e of s.extra) lines.push(`\n**${e.label}:** ${e.value}`)
  return lines.join('\n')
}

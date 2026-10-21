// Shared server-side helpers for the Agreements API (zod body schema,
// child normalization + contract-value computation). Server-only — imported
// by /api/agreements and /api/agreements/[id].
import 'server-only'
import { Agreement, Prisma } from '@prisma/client'
import { z } from 'zod'
import { round2 } from '@/lib/format'
import { parseDate } from '@/lib/api-helpers'
import type { AgreementRow, DocItemRow } from '@/lib/types'

export const agreementBodySchema = z.object({
  title: z.string().trim().min(1, 'Agreement title is required'),
  clientId: z.string().trim().optional().nullable(),
  clientName: z.string().trim().min(1, 'Client name (Party B) is required'),
  type: z.enum(['labor_supply', 'service', 'subcontract']).optional(),
  layoutStyle: z.enum(['detailed', 'simple']).optional(),
  startDate: z.string().min(1, 'Start date is required'),
  endDate: z.string().optional().nullable(),
  status: z.enum(['draft', 'final', 'signed', 'expired']).optional(),
  notes: z.string().optional().nullable(),
  /** Only used when layoutStyle = 'simple' (price as per P.O.) */
  value: z.coerce.number().min(0, 'Contract value cannot be negative').max(1_000_000_000).optional(),
  items: z
    .array(
      z.object({
        description: z.string().trim().min(1, 'Item description is required'),
        unit: z.string().trim().optional().nullable(),
        quantity: z.coerce.number().min(0, 'Quantity cannot be negative').max(1_000_000_000),
        unitPrice: z.coerce.number().min(0, 'Unit price cannot be negative').max(1_000_000_000),
      })
    )
    .optional(),
  installments: z
    .array(
      z.object({
        label: z.string().trim().min(1, 'Installment label is required'),
        dueDate: z.string().optional().nullable(),
        amount: z.coerce.number().min(0, 'Installment amount cannot be negative').max(1_000_000_000),
        paid: z.boolean().optional(),
      })
    )
    .optional(),
  clauses: z
    .array(
      z.object({
        title: z.string().trim().optional().nullable(),
        body: z.string().trim().min(1, 'Clause text is required'),
      })
    )
    .optional(),
})

export type AgreementBody = z.infer<typeof agreementBodySchema>

/** Normalized children + the computed contract value, shared by POST and PUT. */
export function normalizeAgreementChildren(body: AgreementBody): {
  value: number
  items: {
    sr: number
    description: string
    unit: string | null
    quantity: number
    unitPrice: number
    lineTotal: number
  }[]
  installments: { sr: number; label: string; dueDate: Date | null; amount: number; paid: boolean }[]
  clauses: { sr: number; title: string | null; body: string }[]
} {
  const layoutStyle = body.layoutStyle ?? 'detailed'

  // Items — only meaningful for the detailed layout; value is always derived
  const items =
    layoutStyle === 'detailed'
      ? (body.items ?? []).map((it, idx) => {
          const quantity = Number(it.quantity) || 0
          const unitPrice = round2(Number(it.unitPrice) || 0)
          return {
            sr: idx + 1,
            description: it.description,
            unit: it.unit?.trim() || null,
            quantity,
            unitPrice,
            lineTotal: round2(quantity * unitPrice),
          }
        })
      : []

  const value =
    layoutStyle === 'detailed'
      ? round2(items.reduce((sum, it) => sum + it.lineTotal, 0))
      : round2(Number(body.value ?? 0) || 0)

  const installments = (body.installments ?? []).map((ins, idx) => ({
    sr: idx + 1,
    label: ins.label,
    dueDate: parseDate(ins.dueDate ?? undefined),
    amount: round2(Number(ins.amount) || 0),
    paid: Boolean(ins.paid),
  }))

  const clauses = (body.clauses ?? []).map((c, idx) => ({
    sr: idx + 1,
    title: c.title?.trim() || null,
    body: c.body,
  }))

  return { value, items, installments, clauses }
}

/** Field-level checks that deserve friendly error messages (run post-zod). */
export function validateAgreementBody(
  body: AgreementBody,
  startDate: Date,
  endDate: Date | null
): string | null {
  if (body.layoutStyle === 'detailed' && (body.items ?? []).length === 0) {
    return 'Add at least one priced item, or switch the layout to Simple and enter the contract value.'
  }
  if (body.layoutStyle === 'simple' && !(Number(body.value ?? 0) > 0)) {
    return 'Enter the contract value (price as per Purchase Order) for a simple agreement.'
  }
  if (endDate && endDate.getTime() < startDate.getTime()) {
    return 'End date cannot be before the start date.'
  }
  return null
}

/** Next AGR-YYYY-NNNN reference for the given year (call inside the tx). */
export async function nextRefNumber(
  tx: Prisma.TransactionClient,
  year: number
): Promise<string> {
  const prefix = `AGR-${year}-`
  const rows = await tx.agreement.findMany({
    where: { refNumber: { startsWith: prefix } },
    select: { refNumber: true },
  })
  let max = 0
  for (const r of rows) {
    const n = parseInt(r.refNumber.slice(prefix.length), 10)
    if (Number.isInteger(n) && n > max) max = n
  }
  return `${prefix}${String(max + 1).padStart(4, '0')}`
}

// ---------------------------------------------------------------------------
// Include + row mapping (shared by list / detail / create / update endpoints)
// ---------------------------------------------------------------------------

/** Children eager-load with deterministic sr ordering. */
export const agreementFullInclude = {
  items: { orderBy: { sr: 'asc' as const } },
  installments: { orderBy: { sr: 'asc' as const } },
  clauses: { orderBy: { sr: 'asc' as const } },
} satisfies Prisma.AgreementInclude

export type AgreementFull = Prisma.AgreementGetPayload<{ include: typeof agreementFullInclude }>
export type AgreementLean = Agreement

/** Prisma row → API AgreementRow (children included only when eager-loaded). */
export function mapAgreement(a: AgreementFull | AgreementLean): AgreementRow {
  const base: AgreementRow = {
    id: a.id,
    refNumber: a.refNumber,
    title: a.title,
    partyA: a.partyA,
    clientId: a.clientId,
    clientName: a.clientName,
    type: a.type,
    layoutStyle: a.layoutStyle,
    startDate: a.startDate.toISOString(),
    endDate: a.endDate ? a.endDate.toISOString() : null,
    status: a.status,
    value: round2(a.value),
    currency: a.currency,
    notes: a.notes,
    createdByName: a.createdByName,
    createdAt: a.createdAt.toISOString(),
  }
  if ('items' in a && a.items) {
    base.items = a.items.map(
      (i): DocItemRow => ({
        id: i.id,
        sr: i.sr,
        description: i.description,
        unit: i.unit,
        quantity: i.quantity,
        unitPrice: round2(i.unitPrice),
        lineTotal: round2(i.lineTotal),
      })
    )
  }
  if ('installments' in a && a.installments) {
    base.installments = a.installments.map((i) => ({
      id: i.id,
      sr: i.sr,
      label: i.label,
      dueDate: i.dueDate ? i.dueDate.toISOString() : null,
      amount: round2(i.amount),
      paid: i.paid,
    }))
  }
  if ('clauses' in a && a.clauses) {
    base.clauses = a.clauses.map((c) => ({
      id: c.id,
      sr: c.sr,
      title: c.title,
      body: c.body,
    }))
  }
  return base
}

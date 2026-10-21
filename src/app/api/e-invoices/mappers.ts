// Shared mapping helpers + schemas for the e-invoice API routes (list + [id]
// + sub-routes). Kept OUTSIDE route.ts because Next.js only allows HTTP
// handler exports there (same convention as quotations/mappers.ts).
import type { EInvoice, EInvoiceItem, EInvoicePayment } from '@prisma/client'
import { z } from 'zod'
import { db } from '@/lib/db'
import { round2 } from '@/lib/format'
import { computeItemTotals, isEInvoiceOverdue } from '@/lib/e-invoice'
import type { EInvoiceItemRow, EInvoicePaymentRow, EInvoiceRow } from '@/lib/types'

export const EINVOICE_DOC_TYPES = ['invoice', 'credit_note', 'debit_note'] as const
export const EINVOICE_STATUSES = ['draft', 'issued', 'partially_paid', 'paid'] as const
export const EINVOICE_FILTER_STATUSES = [...EINVOICE_STATUSES, 'overdue'] as const

/** Prisma include for list rows (item count + related invoice number). */
export const eInvoiceListInclude = {
  _count: { select: { items: true } },
  relatedInvoice: { select: { id: true, invoiceNumber: true, docType: true } },
} as const

/** Prisma include for full detail rows (items + payments + related + client). */
export const eInvoiceDetailInclude = {
  items: true,
  payments: { orderBy: { paymentDate: 'desc' as const } },
  relatedInvoice: { select: { id: true, invoiceNumber: true, docType: true } },
  client: {
    select: {
      id: true,
      name: true,
      nameAr: true,
      contactPerson: true,
      phone: true,
      email: true,
      address: true,
      addressAr: true,
      city: true,
      crNumber: true,
      vatNumber: true,
    },
  },
} as const

/** Parse the stored arManualFlags JSON string safely → string[]. */
export function parseArManualFlags(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((v): v is string => typeof v === 'string')
  } catch {
    return []
  }
}

export type EItemRecord = EInvoiceItem
export type EPaymentRecord = EInvoicePayment

function mapItem(it: EItemRecord): EInvoiceItemRow {
  return {
    id: it.id,
    sr: it.sr,
    descriptionEn: it.descriptionEn,
    descriptionAr: it.descriptionAr,
    descArManual: it.descArManual,
    unitEn: it.unitEn,
    unitAr: it.unitAr,
    unitArManual: it.unitArManual,
    quantity: round2(it.quantity),
    unitPrice: round2(it.unitPrice),
    discount: round2(it.discount),
    vatPercent: round2(it.vatPercent),
    taxableAmount: round2(it.taxableAmount),
    vatAmount: round2(it.vatAmount),
    lineTotal: round2(it.lineTotal),
  }
}

function mapPayment(p: EPaymentRecord): EInvoicePaymentRow {
  return {
    id: p.id,
    amount: round2(p.amount),
    paymentDate: p.paymentDate.toISOString(),
    methodEn: p.methodEn,
    methodAr: p.methodAr,
    reference: p.reference,
    notes: p.notes,
    createdByName: p.createdByName,
    createdAt: p.createdAt.toISOString(),
  }
}

type MapExtras = {
  _count?: { items: number }
  relatedInvoice?: { invoiceNumber: string } | null
  items?: EItemRecord[]
  payments?: EPaymentRecord[]
  client?: unknown
}

/** Prisma EInvoice row → API row (EInvoiceRow + derived overdue + extras). */
export function mapEInvoice(
  inv: EInvoice & MapExtras
): EInvoiceRow & {
  itemCount?: number
  clientName?: string
  relatedInvoiceNumber?: string | null
  items?: EInvoiceItemRow[]
  payments?: EInvoicePaymentRow[]
  client?: unknown
} {
  const row: EInvoiceRow & {
    itemCount?: number
    clientName?: string
    relatedInvoiceNumber?: string | null
    items?: EInvoiceItemRow[]
    payments?: EInvoicePaymentRow[]
    client?: unknown
  } = {
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    docType: inv.docType,
    clientId: inv.clientId,
    clientNameEn: inv.clientNameEn,
    clientNameAr: inv.clientNameAr,
    clientVatNumber: inv.clientVatNumber,
    clientCrNumber: inv.clientCrNumber,
    clientAddressEn: inv.clientAddressEn,
    clientAddressAr: inv.clientAddressAr,
    poRef: inv.poRef,
    contractRef: inv.contractRef,
    projectEn: inv.projectEn,
    projectAr: inv.projectAr,
    paymentTermsEn: inv.paymentTermsEn,
    paymentTermsAr: inv.paymentTermsAr,
    paymentMethodEn: inv.paymentMethodEn,
    paymentMethodAr: inv.paymentMethodAr,
    issueDate: inv.issueDate.toISOString(),
    supplyDate: inv.supplyDate ? inv.supplyDate.toISOString() : null,
    dueDate: inv.dueDate ? inv.dueDate.toISOString() : null,
    status: inv.status,
    subtotal: round2(inv.subtotal),
    totalDiscount: round2(inv.totalDiscount),
    taxableAmount: round2(inv.taxableAmount),
    vatAmount: round2(inv.vatAmount),
    totalDue: round2(inv.totalDue),
    paidAmount: round2(inv.paidAmount),
    notesEn: inv.notesEn,
    notesAr: inv.notesAr,
    arManualFlags: parseArManualFlags(inv.arManualFlags),
    showReceiverSignature: inv.showReceiverSignature,
    zatcaPhase: inv.zatcaPhase ?? 1,
    zatcaStatus: inv.zatcaStatus ?? null,
    zatcaSubmittedAt: inv.zatcaSubmittedAt ? inv.zatcaSubmittedAt.toISOString() : null,
    zatcaSubmissionMode: inv.zatcaSubmissionMode ?? null,
    relatedInvoiceId: inv.relatedInvoiceId,
    uuid: inv.uuid,
    icv: inv.icv,
    invoiceHash: inv.invoiceHash,
    previousHash: inv.previousHash,
    issuedAt: inv.issuedAt ? inv.issuedAt.toISOString() : null,
    issuedByName: inv.issuedByName,
    signedCopyImage: inv.signedCopyImage,
    createdAt: inv.createdAt.toISOString(),
    updatedAt: inv.updatedAt.toISOString(),
    overdue: isEInvoiceOverdue(inv),
    clientName: inv.clientNameEn, // list display convenience (= En)
  }
  if (inv._count) row.itemCount = inv._count.items
  if (inv.relatedInvoice !== undefined) {
    row.relatedInvoiceNumber = inv.relatedInvoice?.invoiceNumber ?? null
  }
  if (inv.items) row.items = [...inv.items].sort((a, b) => a.sr - b.sr).map(mapItem)
  if (inv.payments) row.payments = inv.payments.map(mapPayment)
  if (inv.client !== undefined) row.client = inv.client
  return row
}

/** Overdue WHERE fragment (Prisma-compatible part of the derived status). */
export function overdueWhere(now = new Date()) {
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return {
    dueDate: { lt: todayStart },
    status: { in: ['issued', 'partially_paid'] as string[] },
  }
}

// ── Shared request schemas ──────────────────────────────────────────────────

export const eItemSchema = z.object({
  descriptionEn: z
    .string()
    .min(1, 'Item description (English) is required')
    .max(500, 'Item description is too long'),
  descriptionAr: z.string().max(500, 'Arabic description is too long').optional(),
  descArManual: z.boolean().optional(),
  unitEn: z.string().max(40, 'Unit is too long').nullable().optional(),
  unitAr: z.string().max(40, 'Arabic unit is too long').nullable().optional(),
  unitArManual: z.boolean().optional(),
  quantity: z.coerce
    .number()
    .positive('Quantity must be greater than 0')
    .max(1_000_000, 'Quantity is too large'),
  unitPrice: z.coerce
    .number()
    .min(0, 'Unit price cannot be negative')
    .max(1_000_000_000, 'Unit price is too large'),
  discount: z.coerce
    .number()
    .min(0, 'Line discount cannot be negative')
    .max(1_000_000_000, 'Line discount is too large')
    .optional(),
  vatPercent: z.coerce
    .number()
    .min(0, 'VAT percent cannot be negative')
    .max(100, 'VAT percent cannot exceed 100')
    .optional(),
})

export const eInvoiceSchema = z.object({
  docType: z.enum(EINVOICE_DOC_TYPES).optional(),
  clientId: z.string().trim().nullable().optional(),
  clientNameEn: z.string().min(1, 'Client name (English) is required').max(160, 'Client name is too long'),
  clientNameAr: z.string().max(160, 'Arabic client name is too long').optional(),
  clientVatNumber: z.string().max(15, 'VAT number cannot exceed 15 digits').nullable().optional(),
  clientCrNumber: z.string().max(20, 'CR number is too long').nullable().optional(),
  clientAddressEn: z.string().max(500, 'Client address is too long').nullable().optional(),
  clientAddressAr: z.string().max(500, 'Arabic address is too long').nullable().optional(),
  poRef: z.string().max(80, 'P.O. reference is too long').nullable().optional(),
  contractRef: z.string().max(80, 'Contract reference is too long').nullable().optional(),
  projectEn: z.string().max(160, 'Project name is too long').nullable().optional(),
  projectAr: z.string().max(160, 'Arabic project name is too long').nullable().optional(),
  paymentTermsEn: z.string().max(300, 'Payment terms are too long').nullable().optional(),
  paymentTermsAr: z.string().max(300, 'Arabic payment terms are too long').nullable().optional(),
  paymentMethodEn: z.string().max(120, 'Payment method is too long').nullable().optional(),
  paymentMethodAr: z.string().max(120, 'Arabic payment method is too long').nullable().optional(),
  issueDate: z.string().min(1, 'Issue date is required'),
  supplyDate: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  notesEn: z.string().max(2000, 'Notes are too long').nullable().optional(),
  notesAr: z.string().max(2000, 'Arabic notes are too long').nullable().optional(),
  showReceiverSignature: z.boolean().optional(),
  // Per-invoice ZATCA phase designation — 1 = Generation, 2 = Integration.
  // Only editable while the document is a draft; locked at issue time.
  zatcaPhase: z.union([z.literal(1), z.literal(2)]).optional(),
  arManualFlags: z.array(z.string().max(40)).max(20).optional(),
  relatedInvoiceId: z.string().nullable().optional(),
  items: z
    .array(eItemSchema)
    .min(1, 'At least one line item is required')
    .max(200, 'Too many line items'),
})

export type EInvoiceBody = z.infer<typeof eInvoiceSchema>
export type EItemBody = z.infer<typeof eItemSchema>

/** Normalized item ready for persistence (server-computed money math). */
export type NormalizedEItem = {
  sr: number
  descriptionEn: string
  descriptionAr: string
  descArManual: boolean
  unitEn: string | null
  unitAr: string | null
  unitArManual: boolean
  quantity: number
  unitPrice: number
  discount: number
  vatPercent: number
  taxableAmount: number
  vatAmount: number
  lineTotal: number
}

/**
 * Normalize line items: recompute taxable/vat/lineTotal server-side via
 * computeItemTotals. Returns { error } when a discount exceeds the gross.
 */
export function normalizeEItems(
  raw: EItemBody[]
): { items: NormalizedEItem[]; error?: undefined } | { items?: undefined; error: string } {
  const out: NormalizedEItem[] = []
  for (let i = 0; i < raw.length; i++) {
    const it = raw[i]
    const quantity = round2(it.quantity)
    const unitPrice = round2(it.unitPrice)
    const discount = round2(it.discount ?? 0)
    if (discount > round2(quantity * unitPrice)) {
      return { error: `Line ${i + 1}: discount cannot be greater than the line amount` }
    }
    const totals = computeItemTotals({ quantity, unitPrice, discount, vatPercent: it.vatPercent ?? 15 })
    out.push({
      sr: i + 1,
      descriptionEn: it.descriptionEn.trim(),
      descriptionAr: (it.descriptionAr ?? '').trim(),
      descArManual: it.descArManual ?? false,
      unitEn: it.unitEn?.trim() || null,
      unitAr: it.unitAr?.trim() || null,
      unitArManual: it.unitArManual ?? false,
      quantity,
      unitPrice,
      discount,
      vatPercent: round2(it.vatPercent ?? 15),
      taxableAmount: totals.taxableAmount,
      vatAmount: totals.vatAmount,
      lineTotal: totals.lineTotal,
    })
  }
  return { items: out }
}

/**
 * Backfill the linked Client's Arabic fields (persist translations for reuse)
 * when the invoice carries Arabic the client record is missing.
 */
export async function backfillClientArabic(
  clientId: string,
  clientNameAr: string,
  clientAddressAr: string | null
): Promise<void> {
  const client = await db.client.findUnique({
    where: { id: clientId },
    select: { id: true, nameAr: true, addressAr: true },
  })
  if (!client) return
  const data: { nameAr?: string; addressAr?: string } = {}
  if (!client.nameAr && clientNameAr.trim()) data.nameAr = clientNameAr.trim()
  if (!client.addressAr && clientAddressAr && clientAddressAr.trim()) {
    data.addressAr = clientAddressAr.trim()
  }
  if (Object.keys(data).length === 0) return
  await db.client.update({ where: { id: clientId }, data }).catch(() => {})
}

// Shared mapping helpers + schemas for the quotation API routes (list + [id]).
// Kept OUTSIDE route.ts because Next.js only allows HTTP handler + config
// exports from route files.
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { round2 } from '@/lib/format'
import { validateImageDataUrl } from '@/lib/image-data-url'
import type { DocItemRow, QuotationAssetRow, QuotationRow } from '@/lib/types'

export const quoteInclude = {
  client: {
    select: {
      id: true,
      name: true,
      contactPerson: true,
      phone: true,
      email: true,
      address: true,
      city: true,
      crNumber: true,
      vatNumber: true,
    },
  },
  assets: true,
  _count: { select: { items: true } },
} satisfies Prisma.QuotationInclude

export type ClientBrief = {
  id: string
  name: string
  contactPerson: string | null
  phone: string | null
  email: string | null
  address: string | null
  city: string | null
  crNumber: string | null
  vatNumber: string | null
}

export type QuotationItemRecord = {
  id: string
  sr: number
  description: string
  unit: string | null
  quantity: number
  unitPrice: number
  discount: number
  lineTotal: number
  subText?: string | null
  ratePerHour?: number | null
  hoursPerMonth?: number | null
}

export type QuotationAssetRecord = {
  id: string
  type: string
  dataUrl: string
  posX: number
  posY: number
  width: number
  rotation: number
  visible: boolean
}

function mapItems(items: QuotationItemRecord[]): DocItemRow[] {
  return items.map((it) => ({
    id: it.id,
    sr: it.sr,
    description: it.description,
    unit: it.unit,
    quantity: round2(it.quantity),
    unitPrice: round2(it.unitPrice),
    discount: round2(it.discount ?? 0),
    lineTotal: round2(it.lineTotal),
    subText: it.subText ?? null,
    ratePerHour: it.ratePerHour != null ? round2(it.ratePerHour) : null,
    hoursPerMonth: it.hoursPerMonth != null ? round2(it.hoursPerMonth) : null,
  }))
}

function mapAssets(assets: QuotationAssetRecord[]): QuotationAssetRow[] {
  return assets.map((a) => ({
    id: a.id,
    type: a.type === 'stamp' ? 'stamp' : 'signature',
    dataUrl: a.dataUrl,
    posX: a.posX,
    posY: a.posY,
    width: a.width,
    rotation: a.rotation,
    visible: a.visible,
  }))
}

/** Prisma quotation → API row (QuotationRow + itemCount, client + items + assets). */
export function mapQuotation(
  q: Prisma.QuotationGetPayload<{ include: typeof quoteInclude }> & {
    items?: QuotationItemRecord[]
  },
  withItems = false
): QuotationRow & {
  itemCount: number
  client?: ClientBrief | null
  items?: DocItemRow[]
  assets?: QuotationAssetRow[]
} {
  const base: QuotationRow & { itemCount: number; client?: ClientBrief | null; assets?: QuotationAssetRow[] } = {
    id: q.id,
    quoteNumber: q.quoteNumber,
    clientId: q.clientId,
    clientName: q.clientName,
    subject: q.subject,
    referenceNo: q.referenceNo ?? null,
    issueDate: q.issueDate.toISOString(),
    validityDate: q.validityDate ? q.validityDate.toISOString() : null,
    status: q.status,
    subtotal: round2(q.subtotal),
    discount: round2(q.discount),
    vatRate: q.vatRate,
    vatAmount: round2(q.vatAmount),
    total: round2(q.total),
    notes: q.notes,
    terms: q.terms,
    projectName: q.projectName ?? null,
    projectLocation: q.projectLocation ?? null,
    contractPeriod: q.contractPeriod ?? null,
    contractMonths: q.contractMonths ?? null,
    mobilization: q.mobilization ?? null,
    inclusions: q.inclusions ?? null,
    exclusions: q.exclusions ?? null,
    createdByName: q.createdByName,
    createdAt: q.createdAt.toISOString(),
    itemCount: q._count.items,
    client: q.client,
    assets: mapAssets(q.assets ?? []),
  }
  if (withItems && q.items) {
    base.items = mapItems([...q.items].sort((a, b) => a.sr - b.sr))
  }
  return base
}

// ── Shared request schemas ─────────────────────────────────────────────────

export const QUOTE_STATUSES = ['draft', 'sent', 'accepted', 'rejected', 'expired'] as const

export const itemSchema = z.object({
  description: z.string().min(1, 'Item description is required').max(500, 'Item description is too long'),
  unit: z.string().nullable().optional(),
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
  // ---- quotation template columns ----
  subText: z.string().max(300, 'Sub-text is too long').nullable().optional(),
  ratePerHour: z.coerce.number().min(0).max(100_000, 'Rate per hour is too large').nullable().optional(),
  hoursPerMonth: z.coerce.number().min(0).max(1_000, 'Hours per month is too large').nullable().optional(),
})

export const assetSchema = z.object({
  type: z.enum(['signature', 'stamp']),
  dataUrl: z.string().min(22, 'Asset image is required'),
  posX: z.coerce.number().min(-10).max(115),
  posY: z.coerce.number().min(-10).max(115),
  width: z.coerce.number().min(3, 'Asset width is too small').max(80, 'Asset width is too large'),
  rotation: z.coerce.number().min(-180).max(180),
  visible: z.boolean().optional(),
})

export type AssetInput = z.infer<typeof assetSchema>
export type ItemInput = z.infer<typeof itemSchema>

/**
 * Validate + normalize signature/stamp assets for persistence.
 * Returns { error } when an image fails validation (PNG/JPEG ≤ 2 MB).
 */
export function normalizeAssets(
  raw: AssetInput[]
): { assets: NormalizedQuotationAsset[]; error?: undefined } | { assets?: undefined; error: string } {
  const out: NormalizedQuotationAsset[] = []
  for (const a of raw) {
    const valid = validateImageDataUrl(a.dataUrl)
    if (!valid) {
      return {
        error: `${a.type === 'stamp' ? 'Stamp' : 'Signature'} image must be a PNG or JPEG of at most 2 MB`,
      }
    }
    out.push({
      type: a.type,
      dataUrl: valid.dataUrl,
      posX: round2(a.posX),
      posY: round2(a.posY),
      width: round2(a.width),
      rotation: round2(a.rotation),
      visible: a.visible ?? true,
    })
  }
  return { assets: out }
}

/** Normalized line item ready for persistence (server-computed lineTotal). */
export type NormalizedQuotationItem = {
  sr: number
  description: string
  unit: string | null
  quantity: number
  unitPrice: number
  discount: number
  lineTotal: number
  subText: string | null
  ratePerHour: number | null
  hoursPerMonth: number | null
}

export type NormalizedQuotationAsset = QuotationAssetRow

/**
 * Normalize line items: recompute every lineTotal server-side
 * (qty × unitPrice − per-line discount). Returns { error } when a line
 * discount exceeds the gross amount.
 */
export function normalizeItems(
  raw: ItemInput[]
): { items: NormalizedQuotationItem[]; error?: undefined } | { items?: undefined; error: string } {
  const out: NormalizedQuotationItem[] = []
  for (let i = 0; i < raw.length; i++) {
    const it = raw[i]
    const quantity = round2(it.quantity)
    const unitPrice = round2(it.unitPrice)
    const discount = round2(it.discount ?? 0)
    const gross = round2(quantity * unitPrice)
    if (discount > gross) {
      return { error: `Line ${i + 1}: discount cannot be greater than the line amount` }
    }
    out.push({
      sr: i + 1,
      description: it.description.trim(),
      unit: it.unit?.trim() || null,
      quantity,
      unitPrice,
      discount,
      lineTotal: round2(gross - discount),
      subText: it.subText?.trim() || null,
      ratePerHour: it.ratePerHour != null ? round2(it.ratePerHour) : null,
      hoursPerMonth: it.hoursPerMonth != null ? round2(it.hoursPerMonth) : null,
    })
  }
  return { items: out }
}

/** Server-side math — single source of truth for every money figure. */
export function computeTotals(
  items: { lineTotal: number }[],
  discount: number,
  vatRate: number
) {
  const subtotal = round2(items.reduce((sum, it) => sum + it.lineTotal, 0))
  const vatAmount = round2((subtotal - discount) * vatRate)
  const total = round2(subtotal - discount + vatAmount)
  return { subtotal, vatAmount, total }
}

/** Next quote number for a year: {PREFIX}-YYYY-NNNN (max existing + 1). */
export async function nextQuoteNumber(
  tx: Prisma.TransactionClient,
  year: number,
  prefix = 'QTN'
): Promise<string> {
  const p = `${prefix}-${year}-`
  const existing = await tx.quotation.findMany({
    where: { quoteNumber: { startsWith: p } },
    select: { quoteNumber: true },
  })
  let max = 0
  for (const row of existing) {
    const n = parseInt(row.quoteNumber.slice(p.length), 10)
    if (Number.isInteger(n) && n > max) max = n
  }
  return `${p}${String(max + 1).padStart(4, '0')}`
}

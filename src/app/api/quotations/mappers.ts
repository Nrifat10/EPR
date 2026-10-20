// Shared mapping helpers for the quotation API routes (list + [id]).
// Kept OUTSIDE route.ts because Next.js only allows HTTP handler + config
// exports from route files.
import { Prisma } from '@prisma/client'
import { round2 } from '@/lib/format'
import type { DocItemRow, QuotationRow } from '@/lib/types'

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
    },
  },
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
}

export type QuotationItemRecord = {
  id: string
  sr: number
  description: string
  unit: string | null
  quantity: number
  unitPrice: number
  lineTotal: number
}

function mapItems(items: QuotationItemRecord[]): DocItemRow[] {
  return items.map((it) => ({
    id: it.id,
    sr: it.sr,
    description: it.description,
    unit: it.unit,
    quantity: round2(it.quantity),
    unitPrice: round2(it.unitPrice),
    lineTotal: round2(it.lineTotal),
  }))
}

/** Prisma quotation → API row (QuotationRow + itemCount, optional client + items). */
export function mapQuotation(
  q: Prisma.QuotationGetPayload<{ include: typeof quoteInclude }> & {
    items?: QuotationItemRecord[]
  },
  withItems = false
): QuotationRow & { itemCount: number; client?: ClientBrief | null; items?: DocItemRow[] } {
  const base: QuotationRow & { itemCount: number; client?: ClientBrief | null } = {
    id: q.id,
    quoteNumber: q.quoteNumber,
    clientId: q.clientId,
    clientName: q.clientName,
    subject: q.subject,
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
    createdByName: q.createdByName,
    createdAt: q.createdAt.toISOString(),
    itemCount: q._count.items,
    client: q.client,
  }
  if (withItems && q.items) {
    base.items = mapItems([...q.items].sort((a, b) => a.sr - b.sr))
  }
  return base
}

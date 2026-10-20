// Shared mapping helpers for the supplier P.O. API routes (list + [id]).
// Kept OUTSIDE route.ts because Next.js only allows HTTP handler + config
// exports from route files.
import { Prisma } from '@prisma/client'
import { round2 } from '@/lib/format'
import type { DocItemRow, SupplierPoRow } from '@/lib/types'

export const poInclude = {
  _count: { select: { items: true } },
} satisfies Prisma.SupplierPoInclude

export type PoItemRecord = {
  id: string
  sr: number
  description: string
  unit: string | null
  quantity: number
  unitPrice: number
  lineTotal: number
}

function mapItems(items: PoItemRecord[]): DocItemRow[] {
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

/** Prisma supplier PO → API row (SupplierPoRow + itemCount, optional items). */
export function mapPo(
  p: Prisma.SupplierPoGetPayload<{ include: { _count: { select: { items: true } } } }> & {
    items?: PoItemRecord[]
  },
  withItems = false
): SupplierPoRow & { itemCount: number; items?: DocItemRow[] } {
  const base: SupplierPoRow & { itemCount: number } = {
    id: p.id,
    poNumber: p.poNumber,
    supplierName: p.supplierName,
    supplierPhone: p.supplierPhone,
    attention: p.attention,
    issueDate: p.issueDate.toISOString(),
    expectedDate: p.expectedDate ? p.expectedDate.toISOString() : null,
    status: p.status,
    subtotal: round2(p.subtotal),
    vatRate: p.vatRate,
    vatAmount: round2(p.vatAmount),
    total: round2(p.total),
    notes: p.notes,
    createdByName: p.createdByName,
    createdAt: p.createdAt.toISOString(),
    itemCount: p._count.items,
  }
  if (withItems && p.items) {
    base.items = mapItems([...p.items].sort((a, b) => a.sr - b.sr))
  }
  return base
}

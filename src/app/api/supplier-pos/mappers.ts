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
    supplierId: p.supplierId,
    supplierName: p.supplierName,
    supplierPhone: p.supplierPhone,
    attention: p.attention,
    issueDate: p.issueDate.toISOString(),
    expectedDate: p.expectedDate ? p.expectedDate.toISOString() : null,
    status: p.status,
    quotationRef: p.quotationRef,
    paymentTerms: p.paymentTerms,
    workSite: p.workSite,
    startDate: p.startDate ? p.startDate.toISOString() : null,
    durationMonths: p.durationMonths,
    workingHours: p.workingHours,
    hoursPerMonth: p.hoursPerMonth,
    supplierAddress: p.supplierAddress,
    supplierVat: p.supplierVat,
    supplierCr: p.supplierCr,
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

/**
 * Resolve the supplier directory link for a P.O. save (runs INSIDE the P.O.
 * transaction):
 *  • explicit supplierId → validated against the Supplier table
 *  • saveSupplier=true → find by exact trimmed name; when missing, create the
 *    directory entry seeded from the P.O. fields ("save this supplier for
 *    future P.O.s"); when present, only blank profile fields get filled in
 *    so existing data is never overwritten by a one-off P.O.
 */
export async function resolveSupplierLink(
  tx: Prisma.TransactionClient,
  opts: {
    supplierId?: string | null
    saveSupplier?: boolean
    name: string
    phone?: string | null
    attention?: string | null
    address?: string | null
    vat?: string | null
    cr?: string | null
    createdByName?: string | null
  }
): Promise<string | null> {
  if (opts.supplierId) {
    const found = await tx.supplier.findUnique({
      where: { id: opts.supplierId },
      select: { id: true },
    })
    return found ? found.id : null
  }
  if (!opts.saveSupplier) return null
  const name = opts.name.trim()
  if (!name) return null

  const existing = await tx.supplier.findUnique({ where: { name } })
  if (existing) {
    const patch: Record<string, string> = {}
    if (!existing.contactPerson && opts.attention) patch.contactPerson = opts.attention
    if (!existing.phone && opts.phone) patch.phone = opts.phone
    if (!existing.address && opts.address) patch.address = opts.address
    if (!existing.vatNumber && opts.vat) patch.vatNumber = opts.vat
    if (!existing.crNumber && opts.cr) patch.crNumber = opts.cr
    if (Object.keys(patch).length > 0) {
      await tx.supplier.update({ where: { id: existing.id }, data: patch })
    }
    return existing.id
  }

  const created = await tx.supplier.create({
    data: {
      name,
      contactPerson: opts.attention || null,
      phone: opts.phone || null,
      address: opts.address || null,
      vatNumber: opts.vat || null,
      crNumber: opts.cr || null,
      createdByName: opts.createdByName || null,
    },
    select: { id: true },
  })
  return created.id
}

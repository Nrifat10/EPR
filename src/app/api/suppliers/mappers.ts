// Shared mapping + validation helpers for the suppliers directory API routes
// (list + [id]). Kept OUTSIDE route.ts because Next.js only allows HTTP
// handler + config exports from route files.
import { z } from 'zod'
import type { SupplierRow } from '@/lib/types'

const nullableTrim = (v: unknown) =>
  typeof v === 'string' ? (v.trim() === '' ? null : v.trim()) : v === undefined ? null : v

/** POST/PUT body for a saved supplier (directory entry). */
export const supplierSchema = z.object({
  name: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim() : ''),
    z.string().min(1, 'Supplier name is required').max(160, 'Supplier name is too long')
  ),
  contactPerson: z.preprocess(nullableTrim, z.string().max(120).nullable()),
  phone: z.preprocess(nullableTrim, z.string().max(40).nullable()),
  email: z.preprocess(nullableTrim, z.string().max(120).nullable()),
  address: z.preprocess(nullableTrim, z.string().max(300).nullable()),
  vatNumber: z.preprocess(nullableTrim, z.string().max(20).nullable()),
  crNumber: z.preprocess(nullableTrim, z.string().max(30).nullable()),
  status: z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? undefined : v),
    z.enum(['active', 'inactive'], { error: 'Status must be active or inactive' }).optional()
  ),
  notes: z.preprocess(nullableTrim, z.string().max(2000).nullable()),
})

export const supplierInclude = {
  _count: { select: { purchaseOrders: true } },
} as const

export type SupplierWithCount = {
  id: string
  name: string
  contactPerson: string | null
  phone: string | null
  email: string | null
  address: string | null
  vatNumber: string | null
  crNumber: string | null
  status: string
  notes: string | null
  createdByName: string | null
  createdAt: Date
  _count: { purchaseOrders: number }
}

/** Prisma supplier + P.O. count → API row. */
export function toSupplierRow(s: SupplierWithCount): SupplierRow {
  return {
    id: s.id,
    name: s.name,
    contactPerson: s.contactPerson,
    phone: s.phone,
    email: s.email,
    address: s.address,
    vatNumber: s.vatNumber,
    crNumber: s.crNumber,
    status: s.status,
    notes: s.notes,
    createdByName: s.createdByName,
    createdAt: s.createdAt.toISOString(),
    poCount: s._count.purchaseOrders,
  }
}

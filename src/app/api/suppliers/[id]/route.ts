// Suppliers directory API — PUT (update) / DELETE a single saved supplier.
// Deleting a supplier keeps its purchase orders (SupplierPo.supplierId is
// SetNull) — the P.O. keeps its own copy of the supplier details for print.
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import {
  ok,
  badRequest,
  conflict,
  notFound,
  serverError,
  requirePermission,
  isResponse,
  logActivity,
} from '@/lib/api-helpers'
import { supplierSchema, supplierInclude, toSupplierRow } from '../mappers'

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const auth = await requirePermission('suppliers.view')
    if (isResponse(auth)) return auth
    const { id } = await params

    const supplier = await db.supplier.findUnique({
      where: { id },
      include: supplierInclude,
    })
    if (!supplier) return notFound('Supplier not found')
    return ok(toSupplierRow(supplier))
  } catch (err) {
    console.error('[api/suppliers/[id] GET]', err)
    return serverError()
  }
}

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const auth = await requirePermission('suppliers.edit')
    if (isResponse(auth)) return auth
    const { id } = await params

    const existing = await db.supplier.findUnique({ where: { id } })
    if (!existing) return notFound('Supplier not found')

    let raw: unknown
    try {
      raw = await req.json()
    } catch {
      return badRequest('Invalid JSON body')
    }
    const parsed = supplierSchema.safeParse(raw)
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? 'Invalid request body')
    }
    const data = parsed.data

    if (data.name !== existing.name) {
      const duplicate = await db.supplier.findUnique({ where: { name: data.name } })
      if (duplicate) return conflict(`A supplier named "${data.name}" already exists`)
    }

    const supplier = await db.supplier.update({
      where: { id },
      data: {
        name: data.name,
        contactPerson: data.contactPerson,
        phone: data.phone,
        email: data.email,
        address: data.address,
        vatNumber: data.vatNumber,
        crNumber: data.crNumber,
        status: data.status ?? existing.status,
        notes: data.notes,
      },
      include: supplierInclude,
    })

    await logActivity({
      user: auth,
      action: 'updated',
      module: 'supplier',
      description: `Updated supplier: ${supplier.name}`,
    })

    return ok(toSupplierRow(supplier))
  } catch (err) {
    console.error('[api/suppliers/[id] PUT]', err)
    return serverError()
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const auth = await requirePermission('suppliers.delete')
    if (isResponse(auth)) return auth
    const { id } = await params

    const existing = await db.supplier.findUnique({
      where: { id },
      include: { _count: { select: { purchaseOrders: true } } },
    })
    if (!existing) return notFound('Supplier not found')

    // Linked P.O.s survive — supplierId is SetNull, each P.O. keeps its own
    // copy of the supplier details (needed for reprints).
    await db.supplier.delete({ where: { id } })

    await logActivity({
      user: auth,
      action: 'deleted',
      module: 'supplier',
      description: `Deleted supplier: ${existing.name}${
        existing._count.purchaseOrders
          ? ` (${existing._count.purchaseOrders} linked P.O.s kept)`
          : ''
      }`,
    })

    return ok({ deleted: true })
  } catch (err) {
    console.error('[api/suppliers/[id] DELETE]', err)
    return serverError()
  }
}

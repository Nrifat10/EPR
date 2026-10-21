// Suppliers directory API — GET (paginated list + totals) / POST (create).
// The boss asked for an "add supplier" option inside the Supplier P.O. module:
// suppliers saved here appear in a dropdown when creating P.O.s and their
// details (contact, phone, address, VAT, C.R.) auto-fill the P.O. form.
//   • GET  ?search ?status ?sort=name ?page ?pageSize — active first, then A→Z
//   • POST — name (unique) + contact / phone / email / address / VAT / C.R.
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import {
  ok,
  badRequest,
  conflict,
  serverError,
  requireAuth,
  requirePermission,
  isResponse,
  parsePagination,
  paginatedResponse,
  logActivity,
} from '@/lib/api-helpers'
import { supplierSchema, supplierInclude, toSupplierRow } from './mappers'

const SUPPLIER_STATUSES = ['active', 'inactive']

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth()
    if (isResponse(auth)) return auth

    const sp = req.nextUrl.searchParams
    const p = parsePagination(sp)
    const search = (sp.get('search') ?? '').trim()
    const status = (sp.get('status') ?? '').trim()
    const sort = sp.get('sort') === 'name' ? 'name' : 'default'

    const where: Record<string, unknown> = {}
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { contactPerson: { contains: search } },
        { phone: { contains: search } },
        { email: { contains: search } },
        { address: { contains: search } },
        { vatNumber: { contains: search } },
        { crNumber: { contains: search } },
      ]
    }
    if (status && SUPPLIER_STATUSES.includes(status)) where.status = status

    const [total, suppliers, activeCount, allCount] = await Promise.all([
      db.supplier.count({ where }),
      db.supplier.findMany({
        where,
        orderBy: sort === 'name' ? { name: 'asc' } : [{ status: 'asc' }, { name: 'asc' }],
        skip: p.skip,
        take: p.take,
        include: supplierInclude,
      }),
      db.supplier.count({ where: { status: 'active' } }),
      db.supplier.count(),
    ])

    return paginatedResponse(suppliers.map(toSupplierRow), total, p, {
      activeCount,
      inactiveCount: Math.max(0, allCount - activeCount),
    })
  } catch (err) {
    console.error('[api/suppliers GET]', err)
    return serverError()
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requirePermission('suppliers.create')
    if (isResponse(auth)) return auth

    let raw: unknown
    try {
      raw = await req.json()
    } catch {
      return badRequest('Invalid JSON body')
    }
    const parsed = supplierSchema.safeParse(raw)
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? 'Invalid request data')
    }
    const data = parsed.data

    const duplicate = await db.supplier.findUnique({ where: { name: data.name } })
    if (duplicate) return conflict(`A supplier named "${data.name}" already exists`)

    const supplier = await db.supplier.create({
      data: {
        name: data.name,
        contactPerson: data.contactPerson,
        phone: data.phone,
        email: data.email,
        address: data.address,
        vatNumber: data.vatNumber,
        crNumber: data.crNumber,
        status: data.status ?? 'active',
        notes: data.notes,
        createdByName: auth.name,
      },
      include: supplierInclude,
    })

    await logActivity({
      user: auth,
      action: 'created',
      module: 'supplier',
      description: `Created supplier: ${supplier.name}`,
    })

    return ok(toSupplierRow(supplier), 201)
  } catch (err) {
    console.error('[api/suppliers POST]', err)
    return serverError()
  }
}

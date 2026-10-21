// Name List API — company/person directory (clients, suppliers, subcontractors,
// others). GET (paginated list + per-type counts) / POST (create).
// Filters: ?search (name / contact person / phone / email / CR no) ?type ?status
import { NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { db } from '@/lib/db'
import type { NameListEntryRow } from '@/lib/types'
import {
  ok,
  badRequest,
  conflict,
  serverError,
  requirePermission,
  isResponse,
  parsePagination,
  paginatedResponse,
  logActivity,
} from '@/lib/api-helpers'

const NAME_LIST_TYPES = ['client', 'supplier', 'subcontractor', 'other'] as const
type NameListType = (typeof NAME_LIST_TYPES)[number]

type NameListTypeCounts = Record<NameListType, number>

const entrySchema = z.object({
  name: z.string().min(1, 'Name is required').max(160, 'Name is too long'),
  type: z.enum(NAME_LIST_TYPES, { error: 'Type must be client, supplier, subcontractor or other' }),
  contactPerson: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  crNumber: z.string().nullable().optional(),
  vatNumber: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  status: z.enum(['active', 'inactive']).optional(),
  notes: z.string().nullable().optional(),
})

function mapEntry(e: {
  id: string
  name: string
  type: string
  contactPerson: string | null
  phone: string | null
  email: string | null
  crNumber: string | null
  vatNumber: string | null
  address: string | null
  city: string | null
  status: string
  notes: string | null
  createdAt: Date
}): NameListEntryRow {
  return {
    id: e.id,
    name: e.name,
    type: e.type,
    contactPerson: e.contactPerson,
    phone: e.phone,
    email: e.email,
    crNumber: e.crNumber,
    vatNumber: e.vatNumber,
    address: e.address,
    city: e.city,
    status: e.status,
    notes: e.notes,
    createdAt: e.createdAt.toISOString(),
  }
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requirePermission('namelist.view')
    if (isResponse(auth)) return auth

    const sp = req.nextUrl.searchParams
    const p = parsePagination(sp)

    // Search + status apply everywhere; the type filter applies to the LIST only
    // so the per-type count cards keep showing every type's count.
    const base: Prisma.NameListEntryWhereInput = {}
    const search = sp.get('search')?.trim()
    if (search) {
      base.OR = [
        { name: { contains: search } },
        { contactPerson: { contains: search } },
        { phone: { contains: search } },
        { email: { contains: search } },
        { crNumber: { contains: search } },
      ]
    }
    const status = sp.get('status')?.trim()
    if (status === 'active' || status === 'inactive') base.status = status

    const where: Prisma.NameListEntryWhereInput = { ...base }
    const type = sp.get('type')?.trim()
    if (type && (NAME_LIST_TYPES as readonly string[]).includes(type)) {
      where.type = type
    }

    const [rows, total, typeGroups] = await Promise.all([
      db.nameListEntry.findMany({
        where,
        orderBy: [{ name: 'asc' }],
        skip: p.skip,
        take: p.take,
      }),
      db.nameListEntry.count({ where }),
      db.nameListEntry.groupBy({
        by: ['type'],
        where: base,
        _count: { _all: true },
      }),
    ])

    const counts: NameListTypeCounts = { client: 0, supplier: 0, subcontractor: 0, other: 0 }
    for (const g of typeGroups) {
      if ((NAME_LIST_TYPES as readonly string[]).includes(g.type)) {
        counts[g.type as NameListType] = g._count._all
      }
    }

    return paginatedResponse(rows.map(mapEntry), total, p, { ...counts })
  } catch {
    return serverError()
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requirePermission('namelist.create')
    if (isResponse(auth)) return auth

    let raw: unknown
    try {
      raw = await req.json()
    } catch {
      return badRequest('Invalid JSON body')
    }
    const parsed = entrySchema.safeParse(raw)
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? 'Invalid request body')
    }
    const body = parsed.data

    const name = body.name.trim()
    if (!name) return badRequest('Name is required')

    // Same name + same type is almost certainly a duplicate entry
    const duplicate = await db.nameListEntry.findFirst({
      where: { name, type: body.type },
      select: { id: true },
    })
    if (duplicate) {
      return conflict(
        `A ${body.type} named "${name}" already exists in the name list.`
      )
    }

    const created = await db.nameListEntry.create({
      data: {
        name,
        type: body.type,
        contactPerson: body.contactPerson?.trim() || null,
        phone: body.phone?.trim() || null,
        email: body.email?.trim() || null,
        crNumber: body.crNumber?.trim() || null,
        vatNumber: body.vatNumber?.trim() || null,
        address: body.address?.trim() || null,
        city: body.city?.trim() || null,
        status: body.status ?? 'active',
        notes: body.notes?.trim() || null,
      },
    })

    await logActivity({
      user: auth,
      action: 'created',
      module: 'namelist',
      description: `Name list entry — ${name} (${body.type})`,
    })
    return ok(mapEntry(created), 201)
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return conflict('Name list entry already exists')
    }
    return serverError()
  }
}

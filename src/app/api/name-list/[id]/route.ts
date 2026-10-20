// Name List entry API — GET / PUT / DELETE a single directory entry.
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import type { NameListRow } from '@/lib/types'
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

const NAME_LIST_TYPES = ['client', 'supplier', 'subcontractor', 'other'] as const

const entryUpdateSchema = z.object({
  name: z.string().min(1, 'Name is required').max(160, 'Name is too long').optional(),
  type: z.enum(NAME_LIST_TYPES, { error: 'Type must be client, supplier, subcontractor or other' }).optional(),
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
}): NameListRow {
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

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const auth = await requirePermission('namelist.view')
    if (isResponse(auth)) return auth
    const { id } = await params

    const entry = await db.nameListEntry.findUnique({ where: { id } })
    if (!entry) return notFound('Name list entry not found')
    return ok(mapEntry(entry))
  } catch {
    return serverError()
  }
}

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const auth = await requirePermission('namelist.edit')
    if (isResponse(auth)) return auth
    const { id } = await params

    const existing = await db.nameListEntry.findUnique({ where: { id } })
    if (!existing) return notFound('Name list entry not found')

    let raw: unknown
    try {
      raw = await req.json()
    } catch {
      return badRequest('Invalid JSON body')
    }
    const parsed = entryUpdateSchema.safeParse(raw)
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? 'Invalid request body')
    }
    const body = parsed.data

    const name = body.name !== undefined ? body.name.trim() : existing.name
    if (!name) return badRequest('Name is required')
    const type = body.type ?? existing.type

    /** undefined = keep, null/'' = clear */
    const opt = (v: string | null | undefined): string | null | undefined =>
      v === undefined ? undefined : (v ?? '').trim() || null

    // Duplicate check (same name + same type), excluding the row being edited
    if (name !== existing.name || type !== existing.type) {
      const duplicate = await db.nameListEntry.findFirst({
        where: { name, type },
        select: { id: true },
      })
      if (duplicate && duplicate.id !== id) {
        return conflict(`A ${type} named "${name}" already exists in the name list.`)
      }
    }

    const updated = await db.nameListEntry.update({
      where: { id },
      data: {
        name,
        type,
        contactPerson: opt(body.contactPerson),
        phone: opt(body.phone),
        email: opt(body.email),
        crNumber: opt(body.crNumber),
        vatNumber: opt(body.vatNumber),
        address: opt(body.address),
        city: opt(body.city),
        status: body.status ?? undefined,
        notes: opt(body.notes),
      },
    })

    await logActivity({
      user: auth,
      action: 'updated',
      module: 'namelist',
      description: `Name list entry — ${updated.name} (${updated.type})`,
    })
    return ok(mapEntry(updated))
  } catch {
    return serverError()
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const auth = await requirePermission('namelist.delete')
    if (isResponse(auth)) return auth
    const { id } = await params

    const existing = await db.nameListEntry.findUnique({ where: { id } })
    if (!existing) return notFound('Name list entry not found')

    await db.nameListEntry.delete({ where: { id } })

    await logActivity({
      user: auth,
      action: 'deleted',
      module: 'namelist',
      description: `Name list entry — ${existing.name} (${existing.type})`,
    })
    return ok({ deleted: true })
  } catch {
    return serverError()
  }
}

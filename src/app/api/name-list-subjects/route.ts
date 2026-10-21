// Name List subjects API — the 5 system subjects (Interview, Trade Test,
// Medical, Mobilization, Demobilization) ship with the module; admins can add
// more custom subjects here (Settings > Name List).
// GET: list all (namelist.view) · POST: create custom (admin only).
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import type { NameListSubjectKind, NameListSubjectRow } from '@/lib/types'
import {
  ok,
  badRequest,
  conflict,
  serverError,
  requirePermission,
  isResponse,
  logActivity,
} from '@/lib/api-helpers'

export function isAdminUser(user: { role: { name: string } | null }): boolean {
  const n = user.role?.name?.toLowerCase() ?? ''
  return n === 'admin' || n === 'super admin' || n === 'administrator'
}

const createSchema = z.object({
  name: z.string().min(1, 'Name is required').max(40, 'Name is too long'),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, 'Colour must be a hex value like #2F6FB0')
    .optional(),
  kind: z.enum(['interview', 'mobilization']),
  sortOrder: z.number().int().min(0).max(999).optional(),
})

export function mapSubject(s: {
  id: string
  name: string
  color: string
  kind: string
  sortOrder: number
  isSystem: boolean
}): NameListSubjectRow {
  return {
    id: s.id,
    name: s.name,
    color: s.color,
    kind: (s.kind === 'mobilization' ? 'mobilization' : 'interview') as NameListSubjectKind,
    sortOrder: s.sortOrder,
    isSystem: s.isSystem,
  }
}

export async function GET() {
  try {
    const auth = await requirePermission('namelist.view')
    if (isResponse(auth)) return auth

    const rows = await db.nameListSubject.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    })
    return ok(rows.map(mapSubject))
  } catch {
    return serverError()
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requirePermission('namelist.view')
    if (isResponse(auth)) return auth
    if (!isAdminUser(auth)) {
      return badRequest('Only Admin can add Name List subjects.')
    }

    let raw: unknown
    try {
      raw = await req.json()
    } catch {
      return badRequest('Invalid JSON body')
    }
    const parsed = createSchema.safeParse(raw)
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? 'Invalid request body')
    }
    const body = parsed.data

    const name = body.name.trim()
    if (!name) return badRequest('Name is required')

    const duplicate = await db.nameListSubject.findUnique({ where: { name } })
    if (duplicate) return conflict(`Subject "${name}" already exists.`)

    const maxOrder = await db.nameListSubject.aggregate({ _max: { sortOrder: true } })
    const created = await db.nameListSubject.create({
      data: {
        name,
        color: body.color?.trim() || '#6B7488',
        kind: body.kind,
        sortOrder: body.sortOrder ?? (maxOrder._max.sortOrder ?? 0) + 1,
        isSystem: false,
      },
    })

    await logActivity({
      user: auth,
      action: 'created',
      module: 'namelist',
      description: `Name List subject — ${name} (${body.kind})`,
    })
    return ok(mapSubject(created), 201)
  } catch {
    return serverError()
  }
}

// Roles API — GET (all roles w/ user counts + parsed permissions) / POST (create)
import { NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { db } from '@/lib/db'
import { isValidPermission } from '@/lib/permissions'
import {
  ok,
  badRequest,
  conflict,
  serverError,
  requirePermission,
  isResponse,
  logActivity,
} from '@/lib/api-helpers'

function parsePermissions(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

const roleInclude = { _count: { select: { users: true } } } satisfies Prisma.RoleInclude

type RoleWithCount = Prisma.RoleGetPayload<{ include: typeof roleInclude }>

function mapRole(r: RoleWithCount) {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    permissions: parsePermissions(r.permissions),
    userCount: r._count.users,
    createdAt: r.createdAt.toISOString(),
  }
}

const roleSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().nullable().optional(),
  permissions: z.array(z.string()).default([]),
})

export async function GET() {
  try {
    const auth = await requirePermission('roles.view')
    if (isResponse(auth)) return auth

    const roles = await db.role.findMany({
      orderBy: { name: 'asc' },
      include: roleInclude,
    })
    return ok({ data: roles.map(mapRole) })
  } catch {
    return serverError()
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requirePermission('roles.create')
    if (isResponse(auth)) return auth

    let raw: unknown
    try {
      raw = await req.json()
    } catch {
      return badRequest('Invalid JSON body')
    }
    const parsed = roleSchema.safeParse(raw)
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? 'Invalid request body')
    }

    const name = parsed.data.name.trim()
    if (!name) return badRequest('Name is required')

    const invalid = parsed.data.permissions.filter((p) => !isValidPermission(p))
    if (invalid.length > 0) {
      return badRequest(`Invalid permissions: ${invalid.join(', ')}`)
    }

    const allRoles = await db.role.findMany({ select: { name: true } })
    if (allRoles.some((r) => r.name.toLowerCase() === name.toLowerCase())) {
      return conflict('A role with this name already exists')
    }

    const created = await db.role.create({
      data: {
        name,
        description: parsed.data.description?.trim() || null,
        permissions: JSON.stringify(parsed.data.permissions),
      },
      include: roleInclude,
    })
    await logActivity({
      user: auth,
      action: 'created',
      module: 'role',
      description: `Role created: ${name}`,
    })
    return ok(mapRole(created), 201)
  } catch {
    return serverError()
  }
}

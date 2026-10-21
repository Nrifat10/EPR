// Role [id] API — PUT / DELETE (with Super Admin protection)
import { NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { db } from '@/lib/db'
import { isValidPermission } from '@/lib/permissions'
import {
  ok,
  badRequest,
  conflict,
  forbidden,
  notFound,
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

const roleUpdateSchema = z.object({
  name: z.string().min(1, 'Name is required').optional(),
  description: z.string().nullable().optional(),
  permissions: z.array(z.string()).optional(),
})

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requirePermission('roles.edit')
    if (isResponse(auth)) return auth

    const { id } = await params
    const existing = await db.role.findUnique({ where: { id } })
    if (!existing) return notFound('Role not found')

    let raw: unknown
    try {
      raw = await req.json()
    } catch {
      return badRequest('Invalid JSON body')
    }
    const parsed = roleUpdateSchema.safeParse(raw)
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? 'Invalid request body')
    }
    const body = parsed.data

    // Super Admin protection: cannot rename it or drop the "*" permission
    if (existing.name === 'Super Admin') {
      const newName = body.name !== undefined ? body.name.trim() : existing.name
      const newPerms = body.permissions ?? parsePermissions(existing.permissions)
      if (newName !== 'Super Admin' || !newPerms.includes('*')) {
        return forbidden('The Super Admin role cannot be modified in this way.')
      }
    }

    const name = body.name !== undefined ? body.name.trim() : existing.name
    if (body.name !== undefined && !name) return badRequest('Name is required')

    if (body.permissions) {
      const invalid = body.permissions.filter((p) => !isValidPermission(p))
      if (invalid.length > 0) {
        return badRequest(`Invalid permissions: ${invalid.join(', ')}`)
      }
    }

    const allRoles = await db.role.findMany({ select: { id: true, name: true } })
    if (
      allRoles.some(
        (r) => r.id !== id && r.name.toLowerCase() === name.toLowerCase()
      )
    ) {
      return conflict('A role with this name already exists')
    }

    const updated = await db.role.update({
      where: { id },
      data: {
        name,
        description:
          body.description !== undefined
            ? body.description?.trim() || null
            : undefined,
        permissions:
          body.permissions !== undefined
            ? JSON.stringify(body.permissions)
            : undefined,
      },
      include: roleInclude,
    })
    await logActivity({
      user: auth,
      action: 'updated',
      module: 'role',
      description: `Role updated: ${updated.name}`,
    })
    return ok(mapRole(updated))
  } catch {
    return serverError()
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requirePermission('roles.delete')
    if (isResponse(auth)) return auth

    const { id } = await params
    const existing = await db.role.findUnique({
      where: { id },
      include: roleInclude,
    })
    if (!existing) return notFound('Role not found')

    if (existing.name === 'Super Admin') {
      return forbidden('The Super Admin role cannot be deleted.')
    }
    if (existing._count.users > 0) {
      return conflict(
        `Cannot delete: role is assigned to ${existing._count.users} users.`
      )
    }

    await db.role.delete({ where: { id } })
    await logActivity({
      user: auth,
      action: 'deleted',
      module: 'role',
      description: `Role deleted: ${existing.name}`,
    })
    return ok({ success: true })
  } catch {
    return serverError()
  }
}
